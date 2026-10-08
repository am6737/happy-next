# AI Team Runtime 本轮部署边界

2026-10-07。这是当前代码的运行约束与验证方法，**不是生产可用证明**。最终验收见 `ai-team-production-handoff.zh-CN.md`。

## 已验证的宿主能力

本轮 workspace 创建和执行期锁使用 util-linux 的 `flock`，在本机 Linux、本地文件系统中验证了双进程争用和持锁进程被强杀后的释放。锁文件不能按 PID/mtime 删除，inode 必须保留。没有 `flock` 时 Runtime 明确拒绝运行；目前没有 macOS/Windows 等价实现的验收，也没有 NFS/跨宿主共享锁保证。

在每台准备接收任务的机器执行只读检查：

```bash
git --version
flock --version
codex --version
```

安装与启动 Runtime 的系统账号应拥有自己的私有 Happy/Codex 配置目录。本机 finish queue 按服务器 URL 和账号公钥分开；切换服务器或账号不会把上一账号的队列发给新账号。旧版未隔离的 queue 不能直接搬入新账号目录。认证文件和测试副本必须是私有权限；日志和验收证据只包含非秘密身份及错误代码。

## 权限与恢复的当前语义

- Codex `read_only` 使用只读沙箱，`guarded_auto` 使用 workspace-write 沙箱。真实 provider 的沙箱仍须在目标宿主实际验证。
- 通用 `runOneShot` headless `approval` 仍明确拒绝；Codex 已有专用 app-server 逐操作审批路径，须按 operationId/actionHash/实际 cwd 与命令、Decision 版本和本地 journal 验收。不能将该专用路径外推到 Claude/Gemini，也不能把受控 fixture 或单次批准称为真实 UI 全流程已通过。
- Gemini `read_only` 当前明确拒绝：其 default 审批模式既不保证只读，也可能等待人工交互。不能以参数名称当权限证明。
- 新任务获得新 task workspace；恢复必须匹配原 task/session/repository/branch/base commit。跨机器恢复尚须服务端机器绑定或经过验证的迁移协议。
- GC 当前只提供 dry-run 候选检查。没有自动删除或磁盘容量治理的完整验收，不能承诺无限保留而不监控空间。

前序宿主手动将 bwrap 设为 setuid 的观察不构成仓库可复现部署方案。本轮没有执行 setuid/privileged 修改，也没有全局绕过 Codex sandbox。容器/目标发行版沙箱方案仍须实测支持，再纳入正式安装文档。

## 数据库与验收入口

本机开发连接使用 `packages/happy-server/.env.dev`；默认 `.env` 的插值和凭证曾导致 P1000，不应据此报告整个现有数据库不可用。迁移不使用 reset：

```bash
cd packages/happy-server
npx dotenv -e .env.dev -- prisma migrate status
npx dotenv -e .env.dev -- prisma migrate deploy
```

主会话已实际应用 `20261007100000_ai_team_p0_delivery`；后续新增迁移以各子任务和 migration status 的实际结果为准。

真实 DB + 本地签名 HTTP（synthetic GitHub payload，不调用外部 GitHub、不合并 PR）：

```bash
npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/aiTeamP0RealDb.mts
```

模型网关真实 loopback HTTP provider fixture（不是可用 LLM 证明）：

```bash
npx tsx --tsconfig tsconfig.json ../../scripts/verifyAiModelGateway.mts
```

GitHub 交付独立断言从仓库根运行，全部身份、CI 和文件字节通过才 exit 0：

```bash
node scripts/verifyAiGithubDelivery.mjs owner/repo issue pr branch full-commit-sha repository-file expected-local-file
```

指定仓库 `am6737/happt-next` 当前不可解析；没有因此改写另一个仓库。没有自动合并或发布操作。

## 纯推理路径与本轮新增验收

CLI新增account socket作用域的 `machineId:ai-structured-model` handler，经配置中的HTTP provider直接推理，request显式无tools/tool_choice=none；server无该RPC时安全失败，不再退回bash执行Codex。主会话已实际调用该handler并确认现有provider/model返回确切结构JSON。当前handler只支持明确配置的OpenAI兼容responses/chat provider及可用API key；OAuth-only、本机复杂provider配置、CLI profile切换的一致性尚须终版验收，不能承诺所有runtime已支持。凭证始终在runtime读取，不回传server。

从仓库根执行真实纯HTTP推理（输出仅验收标记）：

```bash
npx tsx --tsconfig packages/happy-cli/tsconfig.json scripts/verifyAiPureModelReal.mts
```

新增真实DB/loopback HTTP澄清与委派测试（无模型、无外部写入；认证主体通过fixture注入，不是生产JWT中间件验收）：

```bash
cd packages/happy-server
npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/verifyAiClarificationRealDb.mts
npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/verifyAiDelegationRealDb.mts
```

澄清脚本已通过；委派脚本目前精确发现错误token幂等重放漏洞，尚未通过全部断言。跨成员真实Git汇总从根运行 `node scripts/verifyAiTeamIntegration.mjs manifest.json`；manifest示例与文件所有权见 `docs/ai-team-wire-handoff.zh-CN.md`。其断言器真实Git正反fixture通过，不能代替daemon双成员E2E。

## P3 发布候选、独立迁移与恢复演练

本节工具不会部署、合并、迁移共享 `handy`，也不会读取或备份其他账号数据。`scripts/aiTeamProductionPreflight.mjs` 只读工作树和包文件；`scripts/verifyAiTeamDatabaseRestore.mts` 在同一 PostgreSQL 实例创建两个随机 `happy_ai_restore_<16位hex>_{source,target}` 测试库，只迁移源测试库，备份/还原自身 fixture 后删除两库。它们不是生产备份策略或 daemon 恢复证明。

从仓库根生成可审阅的候选 manifest，文件应保存在发布工单或受控产物目录，不写入含凭证的环境文件：

```bash
node scripts/aiTeamProductionPreflight.mjs --write /tmp/happy-ai-team-release-candidate.json
node scripts/aiTeamProductionPreflight.mjs --check /tmp/happy-ai-team-release-candidate.json
node scripts/aiTeamProductionPreflight.mjs --check /tmp/happy-ai-team-release-candidate.json --evidence /path/to/compatibility-evidence.json --strict
```

manifest 固定 Git HEAD/脏工作树状态、App/CLI/Server/Voice/Wire 包版本与 package.json SHA-256、五包源码树摘要、根 `yarn.lock`/Compose/Dockerfile/`.dockerignore`、Prisma schema、TS 配置、CLI 入口和本轮验收脚本摘要，以及每条 Prisma `migration.sql` 的 SHA-256 与有序清单摘要。现有 wire/CLI dist 和 App Web dist 若存在，记录目录内代码文件数与内容摘要；Server/Voice 为源码运行或镜像构建，镜像 digest 在此工作树不可得，标为 `provenance: unknown`，**不默认已验证**。`--write` 独占创建，`--check` 重算逐字段比较。源码/构建产物摘要只固定内容，不能证明产物来自这份源码；构建日志、镜像 digest 需另行审阅。输出使用 `artifactConsistencyReady`、`compatibilityEvidenceReady`，`productionReady` 固定为 false：preflight 不代替人工发布批准。

`--strict` 需要干净工作树、所有关键文件、wire/CLI dist 及独立 `--evidence`。证据文件格式为 `happy-ai-team-compatibility-evidence-v1`，必须绑定当前输出的 `candidateSha256`，并列出 `wire-build`、`old-cli-new-server`、`new-cli-old-server`、`app-server`、`isolated-db-restore`、`migration-plan-review` 六项。每项引用同目录简单文件名的 JSON 报告及 SHA-256；报告须有 `format: happy-ai-team-check-v1`、相同候选摘要、check ID、`exitCode: 0`、`result: passed`、执行命令与完成时间。脚本只校验结构、摘要与覆盖率，**不能证明报告真实执行或兼容矩阵充分**；负责人仍须检查实际命令、日志、独立测试范围与发布包来源。无证据或证据与候选漂移时严格模式 exit 1，不能仅凭 semver 或手填最低版本放行。

**迁移是单独受控步骤。** 先确认候选清单与目标当前 `_prisma_migrations`，备份并测试可还原，再执行目标环境的迁移 job；检查 migration status 后才逐步启动新 Server/worker。根 [docker-compose.yml](../docker-compose.yml#L17) 现已将 API command 改为仅 `start`，并在第 71 行新增 `maintenance` profile 的 `happy-server-migrate` 独立 job：`docker compose --profile maintenance run --rm happy-server-migrate`。主会话已对配置/profile/命令做只读断言 exit 0，**未启动容器或迁移共享库**；部署平台仍需确认迁移 job 使用同一镜像 digest、单实例执行、失败不启动新 API，不能把 Compose config 检查当实际迁移。数据库变更按 expand→应用兼容窗口→contract 分阶段，旧 CLI finish queue/Server outbox、processing lease 在停领新任务后保留。回滚首先回退应用至仍支持扩展 schema 的已验证版本；**不自动执行 down migration**，删列/重建表后的数据回退必须有独立备份、恢复点、写入冻结与人工验证。Server worker 当前随 API 同进程启动，不能据此声称已有 drain 或无损跨版本切换。

本地真实恢复演练从 `packages/happy-server` 执行（要求 Docker、`postgres:16-alpine` 客户端镜像、`.env.dev` 对同一实例有建/删自有测试库权限）：

```bash
npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/verifyAiTeamDatabaseRestore.mts
```

脚本对随机源库运行当前 Prisma migrations，插入自有 Account/Run/Task/Execution、processing inbound lease 和 pending integration verification；另外保存 owner Workspace/membership、绑定运行中 execution 的 capability/authRevision、pending DecisionRequest 与 running Run 的预算 reservation。用标准 `pg_dump -Fc`/`pg_restore --exit-on-error` 还原到随机目标库，以 Prisma 核对主体、claim owner/lease 时间、状态、expectedHash/attempts、授权 revision、pending 决策与预算金额/版本。随后把实际 Server db singleton 指向**还原后的自有目标库**：真实 capability 校验在相同 revision 下通过，修改 workspace revision 后旧 token 被拒；真实 budget/decision worker 对 running/pending 且无 RPC 的对象保持 reservation/pending；四轮 `integrationVerificationTick` 无 RPC 时应保持 pending、attempts 0、Task/Run 不完成；实际 `claimInbound` 在 lease 到期后重领，旧 owner 的 `failInbound` 不得改新 owner；给本 fixture 账号注册拒绝结果的 mock connected RPC，过期 integration lease 经真实 worker 重领，mock 回调内用旧 owner CAS 写入须为 0，新一轮 attempts 1 但 Task/Run 仍不完成。mock RPC 仅触发 worker 的失败/失租路径，不是 daemon/Git/人类审批恢复。运行失败必须非零，finally 仅对符合本轮随机前缀的源/目标库执行 drop，并核验两库确实不存在；生产备份仍需时间点恢复、加密/访问限制、保留期、恢复时长与对象存储一致性。

本轮实际运行：新版 preflight 候选生成 exit 0；当前候选普通 `--check` exit 0，旧候选 `--check` 返回 `PREFLIGHT_MANIFEST_MISMATCH` exit 1；当前候选 `--strict` 因脏工作树与兼容证据 unknown **exit 1**，输出 `artifactConsistencyReady=false, compatibilityEvidenceReady=false, productionReady=false`。缺失证据路径的严格负例亦 exit 1；本轮没有伪造通过报告来让门禁变绿。并行迁移目录从 77 增至 78 条，manifest 清单摘要随之变化，说明旧候选必须重签，不把任一工作中摘要当最终发布值。`docker compose --profile maintenance config --format json` 的 API start/独立 migrate command/profile 断言 exit 0，未启动容器。隔离库增强恢复演练 **exit 0**，依次输出 `AI_TEAM_ISOLATED_DATABASE_RESTORE_OK`、`AI_TEAM_RESTORED_PENDING_NO_RPC_OK ticks=4 attempts=0 noCompletion=true`、`AI_TEAM_RESTORED_EXPIRED_LEASE_FENCED_OK inbound=reclaimed oldOwner=denied verificationAttempts=1 noCompletion=true mockRpc=rejected`，最终 `FIXTURE_CLEANUP databases=2 residual=0 archive=removed`。这仍不证明真实 daemon/外部 GitHub 或生产全量恢复。

### 候选字节与链接边界（本轮补验）

`aiTeamProductionPreflight.mjs` 现在仅扫描明确列出的五包 `src`/`sources`、wire/CLI/App `dist`、App `public`/`plugins`/`modules` 和两处 `patches` 树，不递归工作树根或依赖安装目录。App 构建产物里已有 `dist/assets/node_modules` 路径，它属于被指定的 dist，必须计入，不能按名称跳过。每个 regular file 的相对路径、全部字节 SHA-256 和 POSIX mode 都参与树摘要，因而 HTML/CSS/wasm/字体/图片与可执行位均能改变候选。源码及构建产物遇 symlink 拒绝；patch 树允许现有 `patches/expo+54.0.32.patch` 指向 App patch，但记录链接文本、目标字节和 mode，并拒绝越出仓库或 patch 范围、指向非 regular file 的链接。根 `yarn.lock`、Prisma schema、Compose/Dockerfile、Web 镜像 `entrypoint.sh`、`.dockerignore`、各包 TS、App Metro/Babel/EAS、patch 树及 preflight 自身均受清单约束。App `app.config.js`、`app.config.ts` 与 `app.json` 是备选配置入口：三者的 present/missing 和摘要都写入候选，只要其中一个存在且是 regular file 就满足该入口；全部缺失才产生 `app_config_entrypoint_missing`。当前采用 `app.config.js`，其他入口的 missing 不再误判为必需输入缺失。该候选不是安装依赖树或镜像层 digest；Server/Voice 镜像来源及原生 iOS/Android 发布产物依然 unknown。

独立 `/tmp` 临时树复验实际 exit 0：真实 helper 对 CSS、二进制和 chmod mode 变化均产生不同摘要，对构建产物 symlink 与 patch 树越界 symlink 均拒绝；备选配置入口全缺、仅 JS、仅 TS、仅 JSON、全部存在分别得到拒绝、接受、接受、接受、接受。临时树已删除，未改真实包文件。这些仅证明 helper 的自身断言，不证明包构建、镜像或生产部署。当前工作树 `--write` exit 0、`--check` exit 0、篡改候选的 `--check` exit 1；修正配置入口后执行 `node scripts/aiTeamProductionPreflight.mjs --strict` **exit 1**，输出 `productionReady=false`，原因是 dirty worktree 与兼容证据未知，不再有 `release_input_missing`。兼容报告的 SHA-256 只约束其文件内容与候选的关系，**不认证执行来源**；发布责任人必须从可信测试 harness 的原始命令、日志、退出码与产物来源核验报告，手写 `passed` JSON 不构成测试证明。当前仍未取得完整兼容矩阵、镜像 digest 或人工放行，不能把 preflight 输出解读为生产可发布。

### 旧新协议兼容实跑（局部范围）

固定 old 为 Git commit `08030b85829f85f4d6db32abf28c96f8e5a52329`（CLI `0.10.0`、Server `0.0.0`）；new 为执行开始和结束时一致的当前候选 `candidateSha256`，包版本仍为 CLI `0.10.0`、Server `0.0.0`，因此**不能靠 semver 区分**。`scripts/verifyAiTeamCompatibilityReal.mts` 从该 commit 的固定路径归档旧 CLI/Server 源码至自有临时目录，复用当前已安装 `node_modules` 和 `happy-wire` dist，不修改活跃包/dist，也不整仓安装。只在同一 PostgreSQL 实例新建 `happy_ai_compat_<随机16位hex>` 隔离库，运行当前 migrations、插入自有 Account/Run/Task/Execution，并最终删除该库。旧 Server 运行在**新扩展 schema** 上；未测试旧 DB 下新 Server。Fastify 只监听 `127.0.0.1` 随机端口，认证为自有 fixture token，不是生产认证中间件；实际调用两版 `ApiClient.reportOrchestratorExecutionFinish`，核对 DB durable finish、重复请求与错误 token。RPC 只调用两版 Server `invokeUserRpc`，用 mock connected listener 核对 `rpc-request` envelope/ACK；**未经过 Socket.IO 真实 daemon**。不调用 provider、GitHub 或指定仓库 `am6737/happt-next`。

从 `packages/happy-server` 执行，报告目录必须事先不存在：

```bash
npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/verifyAiTeamCompatibilityReal.mts --old-revision 08030b85829f85f4d6db32abf28c96f8e5a52329 --report-dir /tmp/ai-team-compat-owned-run
```

报告目录以私有权限保存 `matrix.json`、`harness-log.json` 和仅限通过的**局部** `*-http-finish.json`；矩阵记录旧 revision/包版本、新 HEAD/包版本、候选前后 SHA-256、测试命令、实际 exit、harness 与日志 SHA-256、schema/依赖/RPC 限制。候选漂移时所有结果改为 `unknown`，不写通过报告；任一断言失败则整体 exit 1。局部 HTTP 报告的 check ID 带 `-http-finish`，不能代替 preflight 要求的完整 `old-cli-new-server`/`new-cli-old-server`；preflight 对完整兼容报告还要求同一矩阵、日志、harness hash 和 `rpc=verified-daemon`。这些 hash 只能防止无意混搭或漂移，不能认证手写报告的执行来源，必须由可信 CI/harness 和人工复核原始运行证据。`--verify-report` 可只读复核目录与当前候选；失败、漂移或 RPC 未证明时必须 exit 1。

早期 `/tmp/ai-team-compat-real-20261007-e/i` fixture 为检查新列，故意把 `outputText` 与 `finalResponse` 设为不同文本。它们只证明旧 Server 不持久化新列，**不能**推出当前 daemon 用户回复丢失；当前 daemon 实际把同一 `outputText` 同时写进两字段（[run.ts](../packages/happy-cli/src/daemon/run.ts#L374)）。旧 Server 的旧 `outputText` 路径可保留该文本。先前关于“回退必然丢用户回复”的解释已撤销。完整旧依赖、生产 JWT、旧 DB→新 Server、真实 daemon/Socket.IO/provider/GitHub 仍 unknown。

修正后的稳定候选 `/tmp/ai-team-compat-real-20261007-l` 两向 canonical HTTP finish 均 exitCode 0：新 CLI→旧 Server 的 `outputText` 与实际最终文本相同并已持久；**非 daemon canonical** 的 `finalResponse` 单字段请求被旧 Server 接受却无最终文本落盘，单独记协议扩展不兼容。当前 CLI 真实队列函数另建 usage/event/finish 三条本地持久记录；旧 Server 对两个新遥测 capability 请求分别 404，按 daemon 相同 flush 顺序阻止 finish。新 CLI 第二独立进程重放后仍各一条、Task/Execution running，矩阵 `telemetry_404_blocks_durable_finish`，总体 exit **1**。该次候选前后 SHA-256 同为 `59102144dbd42f68d9dae9ebe3f954fb011ba0268ec5158d1477566ce41eca5d`，`harness-log.json` SHA-256 为 `2a65073686252335ae28556735b7aee4fd4d2334dca23951cb91e975e02121f0`，`matrix.json` SHA-256 为 `aadf0da9a7dde097fcc4e9cee3030f82df1ce34db3b747279f4d2c2b3707a086`，隔离库查询残留 0。命令为上述 `npx dotenv ... verifyAiTeamCompatibilityReal.mts --old-revision ... --report-dir /tmp/ai-team-compat-real-20261007-l`；只读 `--verify-report` exit **1**，`node scripts/aiTeamProductionPreflight.mjs --evidence /tmp/ai-team-compat-real-20261007-l/matrix.json --strict` exit **1**，`productionReady=false`（脏工作树、兼容证据未知）。它真实运行了 `ApiClient`/队列与 loopback HTTP，**没有**完整 daemon Socket.IO；RPC 仍只是注册表 fixture。先前目录 `k` 因候选漂移降为 unknown，不能并入此证据。后续候选变化必须重跑，不能复用此摘要。

增强恢复脚本实际命令仍为本节上述 `npx dotenv ... verifyAiTeamDatabaseRestore.mts`，本轮 exit **0**，捕获的 stdout/stderr SHA-256 为 `faa29a72ca45fcbe55f015f73fefaa7f702416d58668d507d6c17735ec3bc52b`。新增输出 `AI_TEAM_RESTORED_P3_DURABLE_STATE_OK decision=pending budget=reserved capabilityRevision=3`、`AI_TEAM_RESTORED_P3_WORKER_AND_REVOCATION_OK pendingDecision=true reservedBudget=true oldCapability=denied`，原 inbound/integration worker 断言仍通过；两库与归档残留 0。只证明自有隔离库状态及指定 worker 恢复，不证明真实人类审批、provider 或外部服务恢复。

### 兼容门禁与迁移目录增量（工作中快照）

增强版 harness 最初对照 daemon `retryFinishes` 的 `flushUsage`→`flushEvents`→`flushFinishes` 调用及两个 pending 集合条件；CLI 抽出 `flushTelemetryAndFinishes` 后，harness 已改为直接调用同一 helper，并守卫 daemon 的调用入口与 helper 顺序。旧 Server 的真实 capability 404 以**跨进程重放后 finish 到达、遥测记录仍可追踪**为通过条件，不再把永久阻断写成正例。另以 loopback Fastify 故障注入 401、403、业务 404、500、断线和“capability mint 200 后写入 409”检查这些错误不得通用降级。最后一种仅模拟过期后的 HTTP 拒绝，**不是**真实 DB 过期 capability 的端到端验证。完整 daemon Socket.IO、旧依赖、旧 schema→新 Server、provider/GitHub 仍 unknown；局部 canonical finish 通过不能掩盖完整矩阵的未知项。

Preflight 现在把 `prisma/migrations/migration_lock.toml` 及每个迁移目录的所有 regular file 字节与 mode 纳入候选摘要，并对缺少 `migration.sql` 的目录记录 `migration_inventory_incomplete`，严格模式拒绝。并行 Server 增迁移后，本次 preflight 读到 84 个完整目录；`node scripts/aiTeamProductionPreflight.mjs --strict` exit **1**，`productionReady=false`，原因仍是脏工作树与兼容证据未知。该清单只固定待审阅文件，不判断 SQL 是否可逆、锁耗时、在线 DDL 或旧版本在扩展 schema 的行为；迁移计划、备份恢复点、worker drain 和旧新镜像 digest 仍须独立证据。

临时 `/tmp` 迁移树调用实际 `inventoryMigrations`，缺 `migration.sql` 被判不完整、chmod 改变 SHA-256、指向树外的 SQL symlink 被拒，命令 exit **0** 并输出 `MIGRATION_TREE_NEGATIVES_OK`；临时树已删除。增强兼容矩阵的稳定运行 `/tmp/ai-team-compat-real-20261007-n` 使用固定 old revision `08030b85829f85f4d6db32abf28c96f8e5a52329`，候选前后 SHA-256 `75dbdd03995f6539a1f2feb2d23cae514ae1b33ccb0aa1da15d8a0f9e6902692`；canonical 两向通过，旧 404 durable finish 恢复和 finalResponse-only 扩展仍失败，401/403/500/断线/模拟写入 409 的阻断负例通过，整体 exit **1**，隔离库残留 0。`harness-log.json` SHA-256 `c4c182d669248cfb103b70f9cc64ef1a564178ecacefdb4c732ddaad206a542f`，`matrix.json` SHA-256 `58fc1f6154375e8027159fdf5c8adebb50a07fce17c14350ec5f57a0411480de`。同目录 `--verify-report` exit **1**，`--evidence .../matrix.json --strict` exit **1** 且 `productionReady=false`。这是当前源码快照与隔离 HTTP/DB fixture，不是完整 daemon 或生产升级批准。
迁移树负例已固化为 `node scripts/aiTeamProductionMigrationTreeTest.mjs`（exit **0**，输出 `MIGRATION_TREE_NEGATIVES_OK`）；脚本自身也纳入 release inputs。上述 `n` 候选是固化该脚本之前的运行快照，不能在候选变更后复用其摘要。

固化后再次执行相同兼容命令，报告目录 `/tmp/ai-team-compat-real-20261007-o`，候选前后 SHA-256 `496754b503e229a2eec828715f45eb0e821236d9b0d7fada094cd4587bcf7cec` 一致。两项 canonical 通过，旧 404 恢复目标与 finalResponse-only 扩展失败，五项 HTTP 故障负例通过，整体 exit **1**、隔离库残留 0。日志 SHA-256 `c4c182d669248cfb103b70f9cc64ef1a564178ecacefdb4c732ddaad206a542f`，矩阵 SHA-256 `4b8998ecb39e71645bf8de16ccf38461c8f9879afe1ee5aef6d6171e7cc0e29a`；`--verify-report` 和严格 preflight 各 exit **1**，`productionReady=false`。并行包继续修改时这些摘要只代表该次起止一致的源码窗口。

CLI 后续把 daemon 重试抽成 `flushTelemetryAndFinishes`，harness 现直接调用同一函数，并核对 daemon 调用入口与 helper 内的 usage→events→finish 顺序。稳定 `/tmp/ai-team-compat-real-20261007-p` 候选前后 SHA-256 `4c421a52a4f864fa01b3c21e02c24185872dd731abfc49524743c3525389bda7`：旧 Server 真 404 经 `unsupported` 保留遥测后投递 `failed/TELEMETRY_ENDPOINT_UNSUPPORTED` finish，第二进程确认无待投递 finish；401/403、业务 404、500、断线及模拟过期写入 409 均继续阻断。canonical 两向通过，finalResponse-only 扩展负例仍失败，因此矩阵整体 exit **1**，隔离库残留 0。日志 SHA-256 `313c4f39d4cd8b499f6a3bd45a45457f5b9f8b342fa3e340a82fc4dbd86559fe`，矩阵 SHA-256 `25b8b0b12bf6b5fa2f51b4c3bde9c6f5cdebd40d8cc0dce22e1070ca5f372d36`；`--verify-report` 与严格 preflight 各 exit **1**，`productionReady=false`。这只证实已产生的 durable 记录有可解释终态；不证明新 CLI 能在旧 Server 上开始完整新执行，也不证明真实 daemon Socket.IO 或生产回滚。

### 真实 Socket.IO 与旧库迁移（局部范围）

兼容 harness 已新增实际 `startSocket`/`rpcHandler` 与 `ApiMachineClient` 双进程测试，真实 JWT 仅供自有账号/机器的 loopback fixture 使用，不打印 token。固定旧 CLI/Server 源码仍为 `08030b85829f85f4d6db32abf28c96f8e5a52329`；稳定 `/tmp/ai-team-compat-real-20261007-q` 候选前后 SHA-256 `19cfc56b303a6e770ac4c9462db9f86275cb1dc70912c285ea00758dbcbd487a`，旧 CLI→新 Server、新 CLI→旧 Server 均经真实 Socket.IO `rpc-register`、dispatch/cancel ACK，通过项 exitCode 0。machine handler 只校验 fixture execution/token 并返回 ACK，不运行 managed daemon/model/工作区。机器只连新 Server A 时，独立新 Server B 的受控 HTTP→实际 `invokeUserRpc` 返回 503，矩阵将跨实例路由标 failed；这不是完整 scoped run 或模型入口复现。总体 exit **1**，隔离库残留 0；`harness-log.json` SHA-256 `a04d05793cc5e26a38abce1fdd31ca7c274dfd4796f473da2a44300a580a2c09`，`matrix.json` SHA-256 `0ff481eefe31e1e723ac1bac2aa8d5d267beb74a2b80e0246808a3c17e892a3a`。

同一工具随后新增旧 `prisma` 归档与隔离库旧→新迁移序列。`/tmp/ai-team-compat-real-20261007-s` 实际旧 58 条迁移再当前 84 条迁移，命令 exit 0，库残留 0；但候选运行中改变，正式矩阵全为 `unknown`，不能与 `q` 拼成同一候选通过。工具现还要求当前 schema 的 `prisma migrate status` exit 0，记录两次 deploy 与 status 的输出 hash；此新增断言**尚无稳定候选运行证据**。多副本机器路由、EventRouter 跨实例、完整 daemon、旧依赖和生产迁移锁耗时仍未通过门禁，`productionReady=false`。

`/tmp/ai-team-compat-real-20261007-t/u` 又执行真实 public submit 与账号限定的实际 scheduler tick：机器只连 A 时，B tick 后任务 queued、Execution 0，A tick 后 dispatching、Execution 1。B 的 HTTP Bearer 为 fixture 认证；A 的 scheduler 回调 ACK 未观察到，不能称任务已运行。两次运行候选均漂移，正式矩阵全部 unknown，自有隔离库残留 0。harness 将此边界作为独立跨实例检查，待稳定源码窗口复验；它与 `q` 的真实 Socket 直接 RPC 成功/失败证据属于不同候选快照。

最新稳定 `v` 候选的兼容矩阵实际 exit 1：旧 58→84 条迁移、canonical HTTP、直接 Socket ACK 与遥测队列局部通过，跨实例 RPC 503、B public submit→B scheduler queued/0、user-scoped 机器 RPC 注册抢占及 finalResponse-only 扩展失败；A scheduler ACK 未观察到。其 candidate SHA-256 为 `a33cfeea67911dcca787cc528c85ba6ada97f3987ae859bc573039a2ac018ef4`，matrix/log SHA-256 分别为 `ccfe3a5ca6e9a407c74abfb0da435d58255394ec7039d52bfe8e1a805d234e80` 和 `b86f462766cf5547a2ff6853fb94b304547edce5b251860239ed26794dea41cf`。后续 `w` 在机器注册阶段超时 exit 1，未形成矩阵；隔离库残留 0，不能拼接为新候选通过。Server 正在修复身份和跨实例路由，统一稳定源码窗口之前兼容门禁维持失败/unknown。

独立容量演练命令为 `cd packages/happy-server && npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/verifyAiTeamCapacityReal.mts`。它仅创建并迁移随机自有 `happy_ai_capacity_<16hex>` 数据库；实测各 200 条事件/usage/Decision、重复键、分页、Index 查询计划、事件 retention、账号限定无 RPC worker 和固定指标标签；最新 exit 1 的具体原因是 95% 预算 fixture 无高水位指标，输出 `residual=0`。告警规则、HTTP 背压、真实 RPC worker 与长期容量均未验证。它不连接生产队列、不证明多副本性能或 provider 恢复；这些未知项不得填为发布通过。

扩展后的最新容量运行仍 exit 1、自有库残留 0：实际原 HTTP 路由下事件/Decision 各 4×50 页，事件 `limit=101` 和 8001 字符 summary 均 400；32 并发事件 GET 全 200、p95 136 ms，**未观察到 429/503 背压**。隔离库事件/usage/Decision 的 `EXPLAIN ANALYZE` 均选 Index，执行时间 0.082/0.060/0.231 ms；200 行本地结果不是发布容量指标。95% 预算水位仍无对应指标，告警规则/真实 RPC worker 未验证。发布前需要固定标签的全局最大预算使用比例、0.8/0.9/1.0 水位政策数、队列最老年龄和拒绝/重试计数，另有可实际触发及恢复的告警规则；指标不得带账号、workspace、run 或 execution ID。当前严格 preflight 继续失败，不能以容量 fixture 局部通过项抵消兼容与告警未知。

容量 harness 现纳入 preflight 的 release input 摘要；修改脚本会改变候选 SHA-256。当前 `node scripts/aiTeamProductionPreflight.mjs --strict` 实际 exit 1，`productionReady=false`，原因 `dirty_worktree`、`compatibility_evidence_unknown`；该次候选 SHA-256 `38461f81ae4a9170e999a1581146f447bbbe3cda9e8805f3ceb28bdce9d522d0` 仅是运行时快照，Server/CLI/App 仍在变动，不可当稳定发布候选。`node scripts/aiTeamProductionMigrationTreeTest.mjs` exit 0，证明独立迁移树负例工具仍拒绝缺 SQL、mode 改变与 symlink。

旧 Server revision `08030b85829f85f4d6db32abf28c96f8e5a52329` 只读/HTTP fixture 接受旧 `outputText`；新 CLI daemon 当前 canonical finish 把相同文本放入 `outputText` 与 `finalResponse`，局部旧接口可保留该文本。**禁止把只发送 `finalResponse` 的客户端与此旧 Server 组合作为可用版本**：旧 Server 对该字段不持久化，即使 HTTP 返回 200，也不能算字段兼容。兼容准入必须核对实际 CLI finish payload 与 durable 旧字段及用户可见回复，不以 HTTP 状态单独放行。当前 `aa` 双实例运行候选中途漂移，19 项正式矩阵全 unknown；原始 B→A RPC/EventRouter 局部现象与缺失 scheduler ACK 不能拼成发布证明。自有 DB 和精确 Redis fixture 键清理完成，无全局 Redis 删除。

容量脚本新增受限错误分类后，隔离库实际 HTTP 32 并发事件 GET 两次出现 Prisma `P2037`：19×200/13×500 与 14×200/18×500，两次均 exit 1、各自隔离库 residual=0。它证明本测试环境的有限连接预算下请求以 500 失败，尚无有界 429/503/Retry-After；不代表生产连接上限，也不能反推较早无错误码的首分页 500。上线容量门禁需固定每实例连接池和 DB 总连接预算、双实例负载、可重试超载响应及恢复后分页无漏/重复；预算高水位指标和实际告警触发/恢复仍缺，严格 preflight 保持失败。

### 固定连接预算与告警证据

上述“95% 水位指标缺失”是旧候选结果。最新容量脚本先在自有隔离库创建 95% policy，再调用实际 `updateDatabaseMetrics()`；`highWaterMetricPresent=true`。健康阶段各类 200 条、事件及 Decision 各 4×50 HTTP 分页、32 个 GET 全 200/p95 113 ms，只证明该阶段未饱和。受控负例另创建随机自有 PostgreSQL LOGIN role、限制 `CONNECTION LIMIT 2`，两条真实 `pg_sleep(8)` 查询占满连接且由 `pg_stat_activity` 确认；独立进程使用该角色访问原事件 GET 路由，8 个请求全部 HTTP 500，释放连接后同路由恢复 200。脚本仍 exit **1**，因为 oracle 要求饱和时仅 429/503、至少一个 `Retry-After`、无 500/网络丢失，且释放后恢复 200。输出确认自有数据库与角色各 `residual=0`。这是隔离的连接耗尽复现，不是生产吞吐测量；健康 burst 无 429 也不是背压缺陷的证据。

候选摘要已逐文件包含 `monitoring/ai-team-alerts.yml`、`monitoring/ai-team-alerts.test.yml`、`scripts/verifyAiTeamAlertsReal.mts` 和 `docs/ai-team-alerts.zh-CN.md`。主会话报告固定 digest 的 Prometheus 3.5.0 `promtool` 六规则/四组时序单测 exit 0；该证据属于合成时序。主反馈另记录先前一次实际自有 PostgreSQL→生产 `/metrics`→原始 5 分钟规则演练 exit 0：预算 95% 与 blocked Decision 两项真实 firing，恢复至 45% 与 delivered 后告警解除，隔离库 residual=0。那次没有绑定稳定候选摘要和可审核机器报告；不能由文件存在、旧轮成功或手写报告改绿容量脚本。Server 的最小验收还需固定实例连接预算下返回可重试的有界过载响应，并提供低基数拒绝计数；真实告警报告须核对被执行规则的 digest、采集数据、触发与恢复时间及完整日志。该范围也未发送人类通知或证明通知链路。

带报告文件的 live 演练现已结束：原始 5 分钟规则的 firing 335410 ms、恢复 60067 ms、`chainVerified=true`、自有库清理完成，但其 `candidateStable=false`、`result=unknown`。容量脚本的 `--verify-alert-report PATH` 可独立核对当前候选与规则 hash、固定镜像、告警名/时长、清理和结果；该报告实际返回 exit **1**，不会因 live 链路局部成功放行。完整 `--alert-report PATH` 隔离容量演练也实际 exit **1**：8 个受控饱和请求仍全部 500，释放后 200，恢复分页 4×50 且 seq 1..200 无漏/重复；自有库与角色 residual=0。报告校验是内容约束，不是执行证明；正式发布还需要稳定候选、可信运行日志与独立审核，且不能以没有真实 RPC 的 worker tick 冒充 RPC 恢复。

双实例真实 daemon 局部诊断可从 Server 目录执行 `npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/verifyAiTeamCompatibilityReal.mts --managed-daemon-diagnostic /tmp/NEW-REPORT.json`。它在随机隔离库和端口启动两个实际 Server，真实 CLI daemon Socket 连 A、HTTP 本地 Project/public submit 连 B；CLI 临时 HOME/Git 与当前 Codex 配置仅用于该自有 fixture。报告要求 B 的 Run/Task/Execution completed、capability v1、持久 commit/finalResponse/event/usage，并核对前后 preflight 候选；只清理自有库、HOME、子进程及账号/机器对应的精确 Redis route/epoch 键。最新一次真实执行 CLI exit 0、提交 29 字节、event 7、usage 1，但候选运行中漂移，诊断最终 exit **1**、`result=unknown`、自有库 residual=0。此入口使用当前 `bin/happy.mjs`，在活跃构建窗口不能证明 binary 与当前源码一致；正式矩阵需消费者终态后固定源码和产物摘要。它也不代替 owner 切换、Redis 离线、旧版本回退或人工审批 UI 验收。

更新后的诊断将 A 固定为生产 `startApi()`/认证/Socket 的 API-only 测试 bootstrap，只有 B 的实际 `main.ts` 启动 scheduler；不改 Server 源码或移除 A 的 Socket 权限。最新本地 Project 运行中，真实 daemon 连 A，B 唯一 scheduler 产生的 Run/Task/Execution completed、capability v1、29 字节 commit、7 条 event 和 1 条 usage 均在自有库核对，库/HOME/精确 Redis 键清理完成。但候选运行中漂移，报告 `candidateStable=false`、整体 exit **1**；稳定候选和旧新二进制矩阵仍须单独验收。

preflight 现将 managed 诊断真实执行的 `packages/happy-cli/scripts/ai-team-p0-real-e2e.mjs` 与其 P1 分支调用的 `scripts/verifyAiTeamIntegration.mjs` 纳入必需发布输入。自有临时副本追加一字节后的候选摘要变化已实际验证，未改活跃 helper。这个清单固定源码/脚本字节；CLI dist 的构建来源、安装依赖字节和旧新二进制对应关系仍需受信构建日志与产物摘要。现有 Socket 版本矩阵的客户端是实际 `ApiMachineClient` 回调，并非 managed daemon；B 唯一 scheduler 的 managed 诊断则只覆盖当前版本本地 Project。二者不得跨候选合并为完整升级/回滚通过。

Socket/Redis 专项可执行 `npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/verifyAiTeamCompatibilityReal.mts --socket-boundary-diagnostic /tmp/NEW-REPORT.json`。它创建随机自有数据库、两个实际 Socket Server fixture、`ApiMachineClient` 和独立本地 Redis 容器，不触碰共享 Redis 键。最新候选起止一致的运行中，跨实例 RPC、replacement owner、旧 ACK 503/`owner_changed`、旧连接断开后路由及 31 秒 TTL 均通过；仅暂停自有 Redis 时 RPC 在 2.5 秒内无 503、客户端超时，恢复后 200，因此整体 **exit 1**。这要求 Server 给 Redis bridge 的不可达/阻塞路径设置有界超时并输出可重试 503；它不是 daemon 离线 finish 恢复测试，也不能让 `rpc=verified-daemon` 变绿。

Compose 的 opt-in Prometheus 使用 `monitoring/prometheus.yml`；此实际挂载文件现纳入 preflight 必需输入。自有临时副本追加换行后候选摘要确实变化，原配置未修改。七规则/七组 promtool 通过是规则引擎证据；真实采集端口离线/重开首轮 `chainVerified=true` 但候选漂移，不能代替预算/Decision 告警的稳定报告或人类通知证明。容量脚本另可加 `--worker-rpc`，在自有隔离库先验无 RPC attempts=0，再以真实 Server Socket 和 machine-scoped Socket.IO fixture 让四个 Decision worker tick 竞争一次投递；本轮 delivered、attempts=1、ACK=1、重复 tick 无新增，Redis 只清该机器方法的精确键。它未运行 managed daemon/provider；整容量脚本仍因告警证据未知 exit 1，不应将该局部 worker 结果填为完整恢复通过。

受控连接容量的最新结果已从早前 8×500 变为 8×503/Retry-After，释放后事件 4×50 分页无漏重。`httpBackpressureVerified=true` 只由已确认两条 SQL 占满、全部饱和响应有界、无 500/网络丢失及恢复完整性推导；健康 32×200 另记 `backpressureObserved=false`，两者不矛盾。整脚本仍 exit **1**：此次未提供稳定候选告警报告，真实 RPC worker 也未验证。当前隔离测试不能代替多副本连接预算或生产告警放行。
# 旧版产物来源门禁补充

`verifyAiTeamCompatibilityReal.mts --old-source-provenance 08030b85829f85f4d6db32abf28c96f8e5a52329` 为只读拒绝诊断：旧 commit 的 lockfile 与当前不同，旧树没有跟踪的 CLI/Server/wire dist，故退出 1。现有兼容 harness 使用旧源码和当前安装依赖/wire dist，只证明其明确报告的局部 HTTP/Socket 行为。正式回滚准入还需固定旧发行包或镜像 digest、依赖/构建来源，以及隔离库内旧 daemon 与新 Server、新 daemon 与旧 Server 的真实协议及持久队列回放。没有产物时此项保持 unknown，不能用同名 package version 或源码 commit 代替。

**更新：**兼容矩阵现要求 `--old-root /tmp/ai-team-old-source-...`，拒绝共享依赖；`--verify-old-root` 核对旧 Git 全树、lockfile、隔离依赖和 wire/CLI 构建物摘要。该旧树可由固定 commit `git archive`、隔离 Yarn 1 `--frozen-lockfile --ignore-scripts`、旧 wire `yarn build`、旧 Server `yarn generate` 构成。本轮旧 CLI 正式 `yarn build` 因源码自带测试 TS2554 **exit 2**；单独 `yarn pkgroll` 的产物只准诊断，不能作为正式发行证据。旧 daemon→当前 Server 实际 HTTP 409、建单前失败；旧源码没有 features handler。发布门禁必须拒绝这个组合，且仍需真实已发布旧包/镜像和反向 managed daemon 证据。上段所述“现有 harness 复用当前依赖”仅描述此前历史矩阵，不适用于新 `--old-root` 入口。

`--managed-daemon-diagnostic NEW_REPORT --daemon-finish-restart` 通过当前 CLI helper 实际阻断 finish HTTP、等待本地队列落盘、强杀 daemon、同 HOME 重启并核对原执行持久完成；本轮功能断言通过但候选漂移，整体 exit 1/unknown。该开关不暂停 Redis，不涵盖跨版本 owner 迁移。正式兼容验收仍需固定消费者候选、旧版正式构建/发行产物和两向 daemon 队列回放；不能将这项当前版本恢复与旧版 Socket fixture 拼接放行。

现已找到 npm 正式 `happy-next-cli@0.10.0`，其 integrity 在隔离目录校验通过；registry `gitHead=7f15e2...` 与旧源码测试 commit `08030b...` 不同。`--verify-published-old-root` 固定 tarball SHA-512、包内入口/dist 字节和隔离依赖路径；`--managed-daemon-diagnostic ... --published-old-root PACKAGE` 使用真实发行 daemon。实际公开 Project 创建 HTTP409、未建单；普通 orchestrator 任务虽持久 completed，回复命中内部运行文本泄漏断言；finish HTTP 暂停后旧队列/重启演练失败。该 npm 版本不能列为当前 AI Project/WorkItem 的自动升级或回滚准入版本。独立 npm install 生成的 package-lock 仅描述本轮解析，不能替代发行时依赖来源、旧 Server 镜像或完整生产回滚证据。

反向当前 daemon→固定旧 Server 源码 `main.ts` 的 generic 路径也已真实失败：当前 CLI 在 workspace preparation 无条件下载 task skills，旧 Server 回 HTTP404，原 Task/Execution 以 `WORKSPACE_PREPARATION_FAILED` 结束。旧 Server 不是已发布镜像；实际失败已足以拒绝该源码组合的自动回滚。版本准入应同时固定两侧产物和所需 endpoint/capability 集，执行中队列须先 drain 到双方均支持的协议，再切换；不能把未知 endpoint 当空结果绕过授权或技能一致性。

当前 managed daemon 的独立 Redis 暂停实测还存在生产路由状态分类问题：local Project 创建在 `RpcBridgeUnavailableError` 时返回409且无Retry-After，虽然数据库在第一次拒绝后无Project/Run。代理恢复 Redis 并同字节重放后真实 daemon 完成且只一份Run/Execution；这是测试代理补救，不是产品自动恢复。owner A→B 的实际daemon route epoch更新、单执行完成和运行中取消已分别有局部证据，但在途旧ACK回收未被触发，严格报告仍failed。发布/回滚需Server修正可重试503合同，并在稳定候选窗口补真实daemon旧ACK屏障与恢复轮；Socket fixture不等于daemon。

**后续状态：**实际 daemon 取消 ACK 的受控屏障现已在稳定候选中 exit0：A 持有真实 daemon 返回的 ACK，route 迁到 B 后释放，Redis bridge 对同一请求 ID 回 `RPC owner changed`；原 provider 取消、仅一个 Execution、目标文件缺席与精确清理均核对。测试 shim 只改 A 测试进程的 ACK 返回时序，不进入发布包或用户 daemon。Project Redis 错误分类的源码修复后，真实暂停轮首次503+Retry-After+固定错误码、重放后唯一任务和Git字节局部满足，但候选漂移，整体 unknown；正式发布门禁仍需稳定同候选复验及客户端自身重试语义。
# 固定旧 Server 回退准入更新（2026-10-07）

当前真实 daemon 对固定源码旧 Server `08030b85829f85f4d6db32abf28c96f8e5a52329` 的 generic 任务仍失败：旧 Server 对 `POST /v1/ai-team/tasks/:taskId/skills/download` 返回404，实际 Run/Task/Execution 以 `WORKSPACE_PREPARATION_FAILED` 结束，未进入 provider。隔离旧源码与锁文件构建验证通过；该产物不是正式发布的 Server 镜像。独立报告 `/tmp/ai-team-new-daemon-old-server-20261007-path.json` 的候选稳定、测试 **exit1**、自有库清理0残留。回退矩阵该格保持 failed，生产 `productionReady` 保持 false；不能用旧接口的 HTTP200 代替实际 daemon 完成。无技能的旧协议任务需由 CLI 实际跳过新下载路由并完成持久 finish；需要新 Skills 能力的任务应在旧 Server 上明确拒绝准入。

该 Skills404 轮使用的是旧共享 CLI `dist`。显式选用隔离 CLI bundle SHA-256 `2ed8294601c4c42977160d796b144324f6d44901475f4d529ab5ea4c26d8d6f7` 后，Skills404消失，但实际旧 Server execution capability 接口404，Run以 `TELEMETRY_CAPABILITY_UNAVAILABLE` 失败，仍无provider/commit/finish；报告 `/tmp/ai-team-new-daemon-old-server-20261007-explicit.json` **exit1**。因此普通generic回退仍不兼容；应以显式bundle来源、真实daemon完成和持久finish为准入证据，并单独验证AI identity拒绝旧协议。隔离测试bundle也不等于正式CLI发行包。

隔离数据库恢复脚本在最新 worker 身份合同下调整了fixture：同Run的活动 capability/Decision 与待验证已完成execution分属两个task，后者仍为其task最新attempt。真实 `pg_dump/pg_restore` 和实际worker复验 **exit0**，两库/归档残留0；其RPC仍为自有fixture，不包含daemon恢复。容量脚本 `--worker-rpc` 已验证两槽饱和8×503/恢复分页、一次实际Socket RPC ACK、95%预算指标，但因无同候选告警报告总 **exit1**。独立原5分钟Prometheus演练在 `/tmp/ai-team-alert-review-20261007-2025.json` 实际触发并恢复两条目标告警、清理残留0；候选运行中漂移，报告及容量验证均 **exit1/unknown**。稳定候选的规则触发/恢复报告、真人通知渠道和完整兼容矩阵仍是生产预检必需输入，不能由局部fixture替代。

正式本地CLI `pkgroll` 入口只是chunk loader。兼容 harness现将入口SHA、64文件整棵dist SHA和root构建报告/根锁摘要成对校验并在运行后复算；本地构建仍非发行签名证明。此固定产物→隔离旧源码Server普通generic真实daemon仍因旧Server capability404以`TELEMETRY_CAPABILITY_UNAVAILABLE`失败；AI Project旧入口404/DB零副作用通过，但不涵盖派发token。反向正式npm `happy-next-cli@0.10.0`→当前Server generic虽写出completed，最终回复为空且`outputText`含内部运行文本，真实helper **exit1**。双向旧版准入保持failed，不能用这些局部状态放行回滚。

旧源码 Server 的自定义404 body为`{error:"Not found",path,method}`，现CLI只接受Fastify默认404 body，故旧capability404尚不能进入legacy分支；此前直接归因于技能身份判定的复核结论已撤回。独立兼容oracle现区分`processCompleted`、`durableFinish`、`answerCandidatePassesLeakScreen`、`trustedAnswerVerified`和`deliveryVerified`，只有真实helper通过才计可信回答，且只输出旧404的固定形状枚举，不记录旧handler可能打印的headers。Project入口404仅证明公共路由无副作用；含Coordinator且无WorkItem的AI dispatch仍须实际daemon/provider前`UPGRADE_REQUIRED`且无retry的单独probe，不得与Project404合并。

兼容脚本的404形状及交付oracle定向自检 **exit0**，实际旧Server形状捕获要等固定新正式whole-dist重跑；现有DB身份布尔值不等于加密RPC中的实际dispatch payload。根同候选原5分钟告警报告 `/tmp/ai-team-alert-formal-root-20261007-2108.json` 亦passed/stable/chainVerified、容量整轮exit0，但两者均不能替代旧版回复或AI升级身份门禁。生产预检仍须保持false。

兼容工具的独立`aiDispatchUpgrade` oracle要求实际scheduler领取、Coordinator存在、WorkItem缺失、精确`UPGRADE_REQUIRED`、provider未启动及零retry/副作用；旧Project404只能输出`scheduler_attempt_not_observed/verified=false`。旧daemon缺features时门禁发生在派发RPC之前，不声称它已收到AI payload。当前候选摘要`b8960a4c7efa6824543263ba94255921627946ae4788089b6dbbc0716fab50c9`与此前c225告警报告不同，不能跨候选复用其放行状态。

真实旧npm daemon→当前Server升级门禁现有隔离DB fixture证据：报告 `/tmp/ai-team-old-client-ai-upgrade-review-20261007-b.json` **exit0**、SHA-256 `108925223b4925dca8a822c9752b407a5e6965254b706d292421cce76d5e3f8a`。旧daemon注册dispatch但不注册features；实际scheduler对无WorkItem Coordinator和有WorkItem内部任务分别产生一个`UPGRADE_REQUIRED` failed attempt，另4次真实tick不重试，未进入provider，Git/事件/usage/commit零副作用。完整候选`0c4bf6fab54ba323d62d8d8d60f4b250871b061bb147883b4da61122f9984b9c`起止稳定，所有自有DB/HOME/Redis清理0残留。这里是**派发前拒绝**，无nonce RPC或daemon dispatch ACK；内部任务由DB fixture创建，不等同公开入口E2E。根发布预检仍需正式候选整矩阵、旧发行Server来源、公开工作流、人类通知及外部交付证据。

在固定候选 `c225ffa05a5d3e4ab3dc9fb256a6ea11eb5a1390427399ffd9bbf068b781e651` 上，隔离备份/恢复worker **exit0**；原5分钟预算高水位与Decision blocked告警真实Prometheus firing/恢复报告 `/tmp/ai-team-alert-formal-review-20261007.json` **exit0、candidateStable=true**；容量工具接同报告加 `--worker-rpc` **exit0**，受控两槽饱和8×503/恢复分页、实际fixture Socket ACK和95%预算指标通过。各自库/role清理残留0。告警没有证明真人通知，容量RPC不是managed daemon；严格生产放行仍因双向旧版兼容等缺口为false。

## 当前根锁的完整隔离依赖来源

新增 `scripts/aiTeamProductionFrozenDeps.mjs` 提供 `prepare|install|verify /tmp/ai-team-frozen-deps-ID`。`prepare` 只复制六份 workspace/root package manifest、正式根锁和三个patch元数据，逐字节及mode核验；`install` 在该自有树使用 Yarn 1.22.22 `--frozen-lockfile --ignore-scripts --non-interactive`、自有HOME/cache及空用户npm配置；`verify` 从实际安装树解析运行时、optional和peer依赖及根锁selector。保留的独立树 `/tmp/ai-team-frozen-deps-c78451e005` 安装 **exit0**，326920ms，输入SHA `82b96ed1b53f635b2fbaafafb0c2f2101569c7a6cb25be52d4de052069da0e30`，根锁SHA `54b3d9ecc080405cf89794efb44fab0be0022a093edbc691c3fcce7a1d936f4c`。原始`verification-report-v2.json`保留，但将`typed-emitter`的包内optional `rxjs@*`误当锁selector；正式锁记录`rxjs@^7.5.2`且实际7.8.2一致。修正检查器后新`verification-report-v3.json` SHA-256 `dd89fb9492caa835ea0c023dc3ebc19fd2578c6f57e16bbbb4563c7a16761888`，图验证仍 **exit1**：2556 selector、7131包实例、13029运行时边无缺包/错版本/缺selector，peer为5条必需缺失、1条必需版本不兼容、1条无效声明范围；155条optional缺失、2条optional不兼容单独计数。完整逐项归属及最小manifest建议见独立复核报告。约10GB隔离树仅可在root复核后按精确路径删除，共享缓存与工作区依赖不可清理。

这是**完整根锁依赖安装来源**，不是源码构建或发行镜像。忽略脚本使patch-package、原生编译、Prisma生成都未执行，故patch元数据一致不能当作patch已应用。等所有源码owner终态后，应在新的同候选隔离构建树复制已冻结的源码、核对源树和依赖输入SHA，执行实际wire build、Prisma generate、Server/CLI/App规定构建，并以完整artifact树摘要、运行回归及兼容报告重新绑定候选；不能在目前的metadata-only树声称这些步骤已完成。根严格`productionReady`保持false。

FrozenDeps支持 `verify ROOT NEW_REPORT.json`，报告必须直接位于该自有fresh树、使用`wx`不可覆盖；默认v3路径不变。root可运行 `node scripts/aiTeamProductionFrozenDeps.mjs verify /tmp/ai-team-frozen-deps-c78451e005 /tmp/ai-team-frozen-deps-c78451e005/verification-root-NONCE.json` 独立扫描同一安装图。本轮实际新报告 `verification-root-independent-20261007.json` **exit1**，仍为运行时图通过、必需peer未通过，重复写及树外路径均拒绝。`aiTeamProductionFrozenDeps.mjs`和`aiTeamProductionSourceSnapshot.mjs`现列入preflight候选输入；两项各自在内存改变1字节均改变候选SHA，未触碰活跃源码。root的源码快照工具当前只读审查、未物化fresh树：它递归扫描包括脚本、Prisma迁移与patch链接；宽范围文件应在读取前拒绝凭证路径，复制中途失败的部分目标树不可复用。后续正式构建须在同一冻结候选且root确认安全边界后运行；`productionReady=false`。

补充：`install`/`verify`现在也拒绝把fresh根目录替换成symlink。加固后在原依赖树新建`verification-root-independent-20261007-b.json`实际重新扫描 **exit1**；最新preflight候选为`4adb4274b562d697d2dfda60c720d1b51150a8ceb760909c83774eef14e8da87`、严格 **exit1**。来源工具字节敏感验证的最新两替代摘要见独立复核报告；任何此前候选摘要只对应当时工具版本。

根 `aiTeamProductionTree.mjs` 现提供可选 `inventoryTree(root, directory, { validatePath(relativePath), readFile })`。回调对基础目录、每个递归entry和内部symlink目标都在`lstat`/`realpath`/目标读取前执行；`readFile`默认原实现，独立fixture注入计数证实`auth.json`、`.npmrc`和patch链接目标拒绝时读取0。root应在其独占SourceSnapshot调用处传`validatePath`，再物化同候选fresh树；该消费尚未发生。若物化中途失败，应标记自有目标树污染并弃用，不能接着构建。Tree/Migration负例exit0；修改后的严格preflight candidate为`e59c4e9182a538deb68a8fd582e0f9747c5cb21f34a767d84b98e10301a5e9cc`，`productionReady=false`。

后续release input补齐：preflight显式核`packages/happy-app/doopush.config.js`，并以`scriptTrees`覆盖root/CLI/App/Server的scripts目录（当前68/21/9/26文件，含Git忽略的26个Server fixture），逐文件bytes/mode、拒绝scripts树中symlink及敏感路径段，四树缺失即拒绝。临时忽略文件fixture证明二进制字节和mode变更均改变摘要，五个敏感名在读取前拒绝；按真实manifest公式模拟修改App配置和被忽略Server脚本一字节均改变candidate。当前严格preflight **exit1**，candidate `623b6648328ba29a3d0f555f8e6ae2da935a56a745f4c6d8da89bf3bb5f20bf2`，`productionReady=false`。root源码快照仍漏App根`expo-env.d.ts`（tsconfig显式include），须由其owner补入后重新冻结候选；本轮未物化或构建fresh树。

状态更新：root已把`expo-env.d.ts`加入SourceSnapshot；preflight现显式核它与`nativewind-env.d.ts`，并以严格`cliRuntimeTrees`覆盖CLI `bin`及`tools`全部字节/mode、拒symlink和敏感路径。CLI manifest的`happy`/`happy-mcp`两个bin逐一核对，空树或入口缺失不满足严格门禁。当前bin 3文件、tools 19文件，含14归档、2许可证、3个unpacked工具。根锁SHA已变为`f4e1414c34f5a34cf4d1e388b7059c3aeea3ecd0fc54aedc652ac6159a4b0dae`；本轮未改锁或fresh依赖树。最新严格preflight **exit1**，candidate `1af1a4542e930e51ee5bf48f31ff9e87dc1ac0d5ba5225947297df74e5c0901e`，`productionReady=false`；App类型声明、CLI bin和工具归档的字节/mode六项内存扰动均改变候选SHA。SourceSnapshot实际物化和正常构建仍待root同候选窗口完成。

## 正式fresh构建的双根绑定待实装

上述“SourceSnapshot尚未物化”是此前状态；root现已在自有 `/tmp/ai-team-frozen-deps-rootccb00a964acf` 完成2504文件物化、正式根锁f4e141冻结安装、postinstall/Prisma/wire/Server/CLI/App/Voice检查及Expo web export。独立只读核验命令 `node scripts/aiTeamProductionSourceSnapshot.mjs check /tmp/ai-team-source-snapshot-formal-root-20261007-2306.json` **exit0**；另逐项核fresh源文件2504/2504 bytes/mode/link匹配、九份构建日志SHA匹配、补丁后依赖图ready。机器证据 `/tmp/ai-team-preflight-fresh-binding-review-20261007.json` SHA-256 `f2bfb4fefb02b2d60a49b2c93ac1336d67a56fa57c7473d298cb16c78c7768b8`，未写原仓库或fresh树。注意快照文件本身SHA是`2054df99fd7f9cd5941792c502541639c2d2c1e35c8ab01fb718bbd5466e36df`，内部2504文件清单摘要才是`0a0b18bc37c96b0037871b0013a716a1b6aaa564ec17fed543e06a42369ad98f`。

当前preflight只能以脚本所在脏工作区为source和artifact双根，故虽然fresh CLI/wire/App web整树分别为`84e9c7d6b4d953a32996aaa8ba71371f80c5b63d91f7de858b8fee52d208ec95`、`d2cdceb51791f864cd8a5db7e08f24da8e9ed9a37b83052168562492b4ada7fd`、`9c46aa9bbe47c3a7a6ec849bf8daf345722666afeb25c1a8f95db98d14f6f99d`，它生成的CLI/App摘要仍来自旧工作区dist。自有精确patch候选 `/tmp/ai-team-preflight-fresh-binding-proposal-20261007.md` SHA-256 `8384cbd7c8aee29f8a91cf3ce75d4668c1475c0939b33c134ca6991cc174a234` 规定sourceRoot保持原repo、显式artifactRoot为fresh、两端快照逐项与锁/安装/补丁/构建日志/整树产物闭环，新candidate包含全部摘要，dirty仍拒绝生产放行。兼容、原始5分钟告警和容量工具目前均只调用无参workspace preflight；需先统一新候选上下文，才可按同候选依次重跑旧npm新AI、managed恢复、告警及消费告警报告的容量workerRPC。隔离fixture准备可并行，正式candidate-bound报告不能拼历史证据。未验证native/image/外部交付、人类通知，`productionReady=false`。

状态更新：双根校验已在`aiTeamProductionArtifactBinding.mjs`及preflight实际接线。调用可传四项 `--source-snapshot FILE --artifact-root ROOT --fresh-build-report FILE --app-web-report FILE`，或唯一 `--artifact-context /tmp/ai-team-artifact-context-*.json`；三个长跑harness以 `AI_TEAM_ARTIFACT_CONTEXT_FILE` 指向该具体文件，逐次传参并记录context SHA。context格式为`happy-ai-team-artifact-context-v1`，字段包括`sourceRoot`、四个路径与 `sourceSnapshotSha256/freshBuildReportSha256/appWebReportSha256/installEvidenceSha256/graphReportSha256`。原repo dirty仍使严格生产门禁为false；helper核完整snapshot、锁/安装/图/日志、三棵产物树及前后稳定，拒报告/资产链接和异根路径。当前正式0a fresh因源码已变`BINDING_SOURCE_DRIFT`，必须由root下一窗口重新冻结。

下一轮构建报告还需写`consumer-build-report-root.json.artifacts.cliDist/wireDist`各自的完整`{files,sha256}`，及`app-web-build-report-root.json.artifactTreeSha256/artifactFiles`；没有构建时的整树基线，preflight会拒绝，不能拿当前旧报告补手写passed。自有最小fixture1正12负实际通过；真实同候选旧npm→新AI、managed恢复、原5分钟告警与容量workerRPC仍待新fresh和context报告，native/image/外部交付及人类通知仍unknown。`productionReady=false`。

绑定 helper 的 frozen metadata 读取前门禁已补齐：`input-inventory.json` 只允许固定十项manifest/根锁/patch元数据，逐项对应统一SourceSnapshot清单，核清单摘要与安装/依赖图报告的来源字段；任何可疑路径在对该条目调用文件系统前拒绝。自有canary fixture实际1正24负exit0，六类敏感或越界路径的读取计数为0。该修复使此前合法伪造`.env`造成读取尝试的反例关闭；尚未生成新正式fresh或执行完整兼容/告警/容量矩阵，严格生产预检继续拒绝。

fresh context 的运行代码合同现要求两根分工：脚本所在原仓库只承担preflight、Git历史和控制器；被测Server、CLI、监控、worker模块及其Prisma/Fastify依赖、tsx/迁移进程必须从完整验证的`runtimeRoot`加载。三个验收脚本调用共用`aiTeamProductionRuntime.mjs`，子进程继承context并重新验证；报告显式记`sourceRoot/runtimeRoot`，前后重算candidate。自有双根模块解析fixture的独立子进程实际加载fresh模块URL和fresh依赖标记，原树依赖污染未被消费。该局部验收没有运行真实DB/daemon/原5分钟Prometheus；正式fresh仍须重新冻结并按同candidate跑完整矩阵，`productionReady=false`。
