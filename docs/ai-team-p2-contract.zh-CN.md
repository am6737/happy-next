# AI Team P2 服务端契约

## Agent 模板版本（服务端已落地）

- `GET /v1/ai-team/agents/archived?limit=1..100&cursor=` 只列当前账号已归档 Agent 的 `id,name,role,archivedAt,enabled`；错误 cursor 400，不返回 settings/指令/工作目录。已有 `POST /agents/:id/restore` 成功后从列表移除且保持 disabled，重新启用须显式编辑。

- `GET/POST /v1/ai-team/agent-templates`、`GET /agent-templates/:id`、`GET /agent-templates/:id/versions/:version`、`POST /agent-templates/:id/versions`：仅模板所属账号可访问，外账号为 404。创建和新增版本均为不可变草稿，内容 SHA-256 随版本返回。内容仅有 `role,description,emoji,skills,responsibilities,instructions`；请求夹带 runtime、model、workingDirectory、permissionMode、allowDelegation 被严格拒绝。
- `POST /agent-templates/:id/versions/:version/publish` 与 `POST /agent-templates/:id/rollback` 要求 `{confirmed:true}`；仅最新草稿可首次发布，当前版本发布重试幂等；历史版本不能借 publish 切换，须 rollback。rollback 仅能选已发布版本。`currentVersion` 在模板行锁事务中更新，历史版本内容不变。
- `POST /v1/ai-team/agents/:agentId/apply-template` body `{templateId,expectedVersion,confirmed:true}`：版本必须是当前已发布版本，旧版本返回 `409 AGENT_TEMPLATE_VERSION_CHANGED`；同账号且未归档 Agent 才可应用。仅更新上列内容及 `settings.instructions`，保留该 Agent 的 engine/model/workingDirectory/permissionMode/allowDelegation/enabled，并保存 `templateVersionId` 来源。普通 `PUT /agents/:id` 清除此绑定。模板不代表自动获得 runtime 或工具权限。
- `GET /v1/ai-team/agents/:agentId/template-source` 返回 `{source:null|{templateId,templateName,version,contentHash,current}}`，同账号未归档 Agent 可读，外账号 404。刷新后可显示应用来源；手工 PUT 后为 null。
- 迁移 `20261007360000_ai_agent_templates` 与 `20261007370000_ai_agent_template_account_fk` 仅新增表、Agent 可空来源 FK 与账号级联 FK。模板应用不修改已有 Run/Task 冻结快照；新任务仍通过原机器能力和权限门禁。此轮没有 Agent 提议审查流、模板运行配置或跨团队模板共享。

更新：2026-10-07。此文档由 server 维护；以下接口以实际落地状态和 `docs/ai-team-p0-server-result.zh-CN.md` 为准。App/CLI/wire 只读此契约，由主会话协调共享类型。所有 ID 均从认证账号范围查询，客户端给出的 path、repositoryId、installationId、Agent/Team ID 不能直接授予权限。

## Project / Workspace

- `POST /v1/ai-team/projects` 以 `clientRequestId` 幂等建立账号项目，输入 `name`、已验证仓库 grant ID、目标 machine ID、已注册仓库规范路径及 default branch。服务端检查同账号 machine、GitHub grant/installation、路径经 machine 只读 Git 身份 RPC 核验；返回 `projectId/version`。
- Project create/PATCH 的受信机器验证 RPC 若明确报告 Redis bridge 不可用，返回固定 `503 {errorCode:"AI_RPC_BRIDGE_UNAVAILABLE"}` 与 `Retry-After: 2`，不把基础设施故障包装为业务 409，也不返回私有 Redis/路径信息。create 在验证失败时尚未写 Project/Run；调用方可保留同一 `clientRequestId` 与完全相同请求字节稍后重试，成功只建一版。仓库身份、授权、版本或幂等 payload 冲突仍按既有 409；503 不表示已有机器副作用可盲目重放其他动作。真实 managed daemon/Redis 暂停的完整正例待 root 独立复验。
- `GET /v1/ai-team/projects`、`GET /:id` 返回版本化仓库/machine/base 身份快照和关联工作项摘要。`PATCH /:id` 以 `expectedVersion` 乐观更新；版本冲突 409。停用项目阻止新任务但保留历史。
- App 现有 `UserKVStore` 的 `repos:{machineId}` 只供导入候选；导入时逐项核验，不能把 KV 路径视为执行授权。任务创建固定 projectVersion/repositoryId/machineId/baseBranch/baseCommit；后续项目更新不暗改已有任务。

## Skills

- `POST /v1/ai-team/skills` 建草稿；`POST /:id/versions` 上传 `SKILL.md` 与支持文件，限制总字节和路径，拒绝绝对路径、`..`、链接及非法编码。服务端按规范化内容算 SHA-256，不可变版本；内容变化只能新增版本。
- `POST /:id/versions/:version/publish` 需账号人工确认；`POST /:id/rollback` 只切换当前已发布版本，不改历史。`POST /:id/proposals` 存经验提议待人工审查，模型输出不会自动发布。
- Team/Agent 绑定按同账号授权，并在 task 创建时冻结 `skillId/version/hash` 清单。CLI 使用绑定 execution/token 的只读下载 API 获取快照，逐文件复核 hash 后安装到隔离工作区；下载接口不得泄露其他账号草稿或未授权版本。

## Autopilot

- `POST /v1/ai-team/autopilots` 建停用草稿，字段含 projectId、trigger (`cron+timezone`、`manual` 或签名 webhook)、action (`create_issue|run_only`)、并发策略 (`skip|queue|replace`)、catchup 上限与 Agent/Team。启用前核验项目、仓库和运行权限。
- `POST /:id/run` 人工触发须有幂等 `clientRequestId`；签名 webhook 先验签再持久 claim。cron 使用 IANA timezone 生成 `plannedAt`，以 `(autopilotId,triggerKey,plannedAt)` 唯一。多实例在 DB 中 claim owner/lease，失效 owner 不得完成新 owner 的 run。
- `GET /:id/runs` 返回计划、claim、重试、执行 Run/Issue intent 和终态历史。停用阻止新 claim；既有运行按明确取消策略处理。`create_issue` 复用 durable intent/reconcile，不确定结果不得盲目重建；`run_only` 不创建 Issue。

## P1 可信集成与运行控制

- aggregate finish 的 `integrationProof` 持久化，但仅是 CLI 声明。Server 从 DB 构造预期 run/task/execution/token、同账号 machine、repo/base、完整成员 branch/commit 列表，再调用 `${machineId}:orchestrator-verify-integration` 只读 RPC。RPC 只接受服务端预期身份，不接受 prompt 任意路径；CLI 复核独立 workspace 记录、Git common dir、祖先、每个 patch 和全部改动文件字节。Server 持久保存结果、验证时间和错误码；缺 proof、超时、冲突保持待验证/blocked，不能 approved。
- `GET /v1/ai-team/tasks/:id/git-identity` 只向同账号返回 task 的 machine/repository 身份、base/branch/commit，不给其他账号私有路径。`GET /v1/ai-team/conversations/:id/clarifications?status=pending` 可恢复待澄清记录。取消、重试、changes_requested 应作用于同一 WorkItem 的确定任务/执行身份，并携带幂等 clientRequestId。

## WorkItem 协作

- 迁移 `20261007350000_ai_work_item_collaboration` 给 WorkItem 增加 `priority:low|normal|high|urgent`（旧行默认 normal）、最多 20 个标签、nullable `dueDate` 与 `metadataRevision`；旧执行快照、仓库和机器身份不随这些字段改变。`GET /v1/ai-team/work-items/:id/metadata` 返回字段、revision、当前 actor 的 `subscribed`。`PATCH /metadata` body `{expectedRevision,priority?,labels?,dueDate?}`，至少改一项；同 WorkItem 的 Agent 与 Project（有项目时）双 `canView+canRun`，行锁内 CAS，旧版本 `409 WORK_ITEM_REVISION_CHANGED`，重复标签 400，同值返回 `duplicate:true`。跨账号/撤权 404。
- `GET /work-items/:id/comments?cursor=&limit=1..100`、`POST /comments` body `{clientRequestId,body}`：GET 需双资源 canView，POST 需双资源 canRun，`(workItemId,actorAccountId,clientRequestId)` 唯一；同内容重放 200，不同内容 409。`PUT/DELETE /work-items/:id/subscription` 仅变更当前 actor 的订阅，需双 canView，同值幂等。订阅是持久偏好，目前没有邮件/推送 fanout，不应称通知已送达。
- `GET /work-items/:id/audit?cursor=&limit=1..100` 需双 canView，按时间和 ID 分页，游标必须属于本 WorkItem。元数据、评论、订阅，以及 cancel/retry/steering/approved/changes_requested 的状态审计在各自原事务内追加 actor 与有限 before/after；未覆盖所有后台 scheduler/verification 状态变化，不能称完整事件溯源。以上协作接口不接收任意 runtime/path/权限字段；历史行使用默认 priority/revision。

当前文档先定义下游契约，未落地条目不能作为已完成 API 调用。外部 GitHub E2E 仍受指定仓库权限阻断；本地 DB/Git/HTTP 验证独立推进。

## 当前实现映射

### 本轮增量接口（实施中）

- Project 创建/更新新增 `kind: "local" | "github"`，省略时沿用 `github`。`local` 不接受 repositoryId/GitHub grant，也不授予 Issue/PR 写权限；要求同账号 active machine 上的可信只读注册仓库身份 RPC 返回 `registeredRepoId`、规范路径、Git common identity、目标分支和 base SHA，并将它们冻结到版本。`run_only` 可以引用 local 项目；`create_issue` 只能引用经 OAuth/grant 验证的 github 项目。客户端 KV 版本只用于并发检测，不能单独证明加密 KV 中包含该注册仓库。CLI 需提供账号范围 `:orchestrator-verify-registered-repo` RPC；入参为注册 ID、路径、分支，返回规范路径/common identity/base SHA，不暴露跨账号路径。
- Skills 刷新接口：`GET /v1/ai-team/skills/:id` 返回当前版本、团队授权及版本摘要；`GET /v1/ai-team/skills/:id/versions/:version` 返回不可变 hash/发布状态和支持文件内容；`GET /v1/ai-team/skills/:id/proposals` 返回待审/已审提议及审核结果。均要求同账号并复核 team 归属，文件内容仅给技能拥有账号。

当前 server 已实现上述三个 Skills GET；版本 GET 返回 `skillId,version,hash,publishedAt,isCurrent,files[{path,sha256,size,contentBase64}]`，外账号为 404。Project `kind=local` 已有数据库/HTTP 路由和模拟机器 RPC 的真实 DB 验收，但 CLI 尚未提供 `:orchestrator-verify-registered-repo`，真实机器会 fail closed，不能把模拟响应视为已验证本地注册关系。GitHub 项目省略 kind 时保持原行为。Autopilot local 项目仅允许 `run_only`；原始 payload SHA-256 已写入 webhook run，同 delivery ID 异内容验签后返回 409。两个新增迁移为 `20261007230000_ai_autopilot_webhook_payload_hash` 和 `20261007240000_ai_local_project_identity`。

更新：CLI 已实现注册仓库 RPC。Server scheduler 从 WorkItem 固定的 Project ID/version 读取历史版本，核对 Run metadata、task path/machine/base 和版本 hash，dispatch 增加 `projectId` 与 `projectSnapshot`；invalid task 标记 `PROJECT_SNAPSHOT_INVALID`，不派发。Snapshot 含 `projectId,version,kind,repositoryId,repositoryFullName,commonGitDirHash,machineId,registeredRepoId,registeredKvVersion,workingDirectory,defaultBranch,baseCommit,snapshotHash`（旧 GitHub hash 兼容省略 kind）。finish 重新核对同一历史版本。root `verifyAiLocalProjectRealDb.mts` 真实 DB/HTTP→CLI KV/临时 Git 与 scheduler/CLI 快照门禁 exit 0；原上一段“CLI 尚未提供 RPC”是历史状态，不再作为当前阻断。

- Project 已有 `POST/GET /v1/ai-team/projects`、`GET/PATCH /:id`。GitHub 创建需 `clientRequestId,name,repositoryId,machineId,registeredRepoId,registeredKvVersion,workingDirectory,defaultBranch`；PATCH 再需 `expectedVersion`。GitHub 路径经账号 OAuth 核验仓库 ID、写权限与当前 default branch，并用机器 `:bash` 只读 Git remote/远端分支 SHA 核验，版本冲突 409。local 路径省略 repositoryId，必须用账号机器的注册仓库验证 RPC 回传 ID/path/common hash/base。加密 UserKV 只验证同账号 `repos:{machineId}` 记录及版本，不能在服务端解密候选列表；当前每版固定单一 machine/path。Autopilot 建单将 projectId/version 固定到 WorkItem 与 Run metadata，finish 核验 machine/base。
- Skills 已有 `POST/GET /v1/ai-team/skills`、`POST /:id/versions`、`POST /:id/versions/:version/publish`、`POST /:id/rollback`、`POST /:id/bindings`、`POST /:id/proposals`、`POST /:id/proposals/:proposalId/review`。发布、回滚、提议审查的 body 需 `confirmed:true`。上传文件为 `{path,contentBase64}`；必须含有效 UTF-8 `SKILL.md`，限制 16 文件、单文件 256 KB、总 1 MB，路径不可绝对/穿越/重复。任务创建冻结 Agent 绑定版本/hash；CLI 用 `POST /v1/ai-team/tasks/:id/skills/download` body `{executionId,dispatchToken}` 获取 `{items:[{skillId,version,hash,files}]}`，不得在 URL 放 token。CLI 本地安装器已按文件与包 hash 核验，但跨进程下载安装尚需验收。
- Autopilot 已有 `POST/GET /v1/ai-team/autopilots`、`PATCH /:id/status`、`POST /:id/run`、签名 `POST /:id/webhook`、`GET /:id/runs`。创建 body 指定 project/Agent/可选 team、prompt、triggerKind、cronExpression/timezone、action、concurrencyPolicy、catchupLimit；初始 disabled。Webhook 创建时仅返回一次 secret，之后 body `{deliveryId,timestamp,payloadBase64,signature}`，HMAC-SHA256 对 `${timestamp}.${deliveryId}.` 加原始 payload 字节签名，5 分钟窗口，先验签再 upsert。cron 使用 `cron-parser` IANA timezone；DB 唯一 triggerKey、CAS 计划、owner/lease/fencing 领取、失败退避和历史回收。`run_only` 建单有固定项目快照且明确不要求 runtime 创建 Issue/PR，已真实 DB/模拟 machine RPC 验收；`create_issue` 复用 durable intent，但指定外部仓库仍 404，未做真实 GitHub 写入。

已落地不等于生产验收：Project 当前只支持每版一个 machine/path；本地 fixture 的 GitHub 默认分支响应为注入模拟，未对指定外部仓库完成真实 OAuth 验收。Autopilot webhook secret 为数据库字节列，仍需部署级加密/轮换；cron 漏期超过 catchupLimit 的记录未逐条入历史；多副本长时程和外部 GitHub 仍待测。`cron-parser` 已加 server package，主会话需同步根 `yarn.lock` 后方可冻结安装。
