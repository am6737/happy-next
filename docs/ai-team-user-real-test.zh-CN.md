# 用户真实测试操作清单

测试仓库为 **`am6737/happy-next`**，默认分支 `main`。2026-10-08 主会话只读 GitHub API 已确认仓库可访问且当前 CLI 账号有 push 权限。此前 `happt-next` 的 404 是旧拼写查询，已不再阻塞当前仓库。

本地自动验收已完成，但完整生产清单尚未通过。以下项目供真人验收；每项记录账号、版本、任务 ID、预期与实际结果。状态显示 Completed 后仍须核对答复、Git diff 与实际交付。

## 开始前

最新实测：用户启动服务后App/Server均HTTP200；PR repository webhook已配置且GitHub真实ping返回200。测试运营公钥已写入env（私钥在仓库外测试私有目录），当前Server还需重启加载新公钥。下方502或公钥/secret未填的描述为此前状态；完整OAuth/PR/CI/设备真人验收仍待执行。

最新配置：用户地址已写入三个本地env文件，webhook secret已生成，WebAuthn RP/origin已配置；运营信任公钥仍缺。Server /health 与App外部探测均502，先确认服务可用。下方关于配置未填的描述为此前检查结果，当前以此段为准。

进一步核对确认根目录 `.env` 与 Server `.env` 已配置OAuth client、secret、回调和APP_URL；标准dev命令同时加载Server `.env` 与 `.env.dev`，无需重复申请或填写这些已有OAuth配置。`GITHUB_WEBHOOK_SECRET` 仍为空，需要为真实webhook配置；实体WebAuthn的三项配置也仍缺失。独立测试启动若仅加载 `.env.dev`，需明确加载已有OAuth配置并保持测试数据库隔离。OAuth入口为认证 `GET /v1/connect/github/params`，回调为 `GET /v1/connect/github/callback`，正式webhook接收路径为 `POST /v1/connect/github/webhook`。

1. 使用持续运行的独立测试 Server、数据库和 App，CLI 连接同一 Server，并确认 Codex 机器在线。此前验收的临时服务和账号已清理，不能把旧临时地址当成当前可用测试环境。
2. 准备两个独立 Happy 账号，分别测试所有者和普通成员。测试账号只操作自有测试数据；同一数据库中连接已有 GitHub 身份可能迁移其 Happy 关联，先确认账号与数据库隔离。
3. 在 Happy 内完成 GitHub OAuth 连接，再确认仓库列表出现 `am6737/happy-next`。终端 `gh` 登录不代表 Happy 已连接。若提示 OAuth 未配置，先由环境维护者检查 Server 的 OAuth client、secret 与 callback 配置，不把 token 粘贴到聊天或日志。
4. 在 Project 中选择正确仓库、执行机器与能力范围。测试仅创建专用分支、Issue 和待审 PR，不合并或上线。

## 第一轮：单任务与真实 GitHub 交付

先在本地测试 Project 提交只读任务：“读取 README，说明项目如何启动，并列出你实际读取的文件。”核对答复原文与工作树没有改动。

随后在 GitHub Project 的工作分配流程提交一个仅新增测试文档的任务，例如：

> 在专用测试分支新增 packages/happy-cli/docs/ai-agent-user-smoke.txt，文件内容精确为 HAPPY_NEXT_USER_SMOKE 加一个换行。创建关联本次 Issue 的 PR，运行仓库现有检查，保持 PR 待审，不合并、不部署。

核对实际 Issue、WorkItem、执行任务和 PR 的关联；PR 必须指向 `am6737/happy-next` 的 `main`，测试分支和 commit 必须一致，文件逐字节正确，CI 检查属于该 commit 且成功。现有 CLI Smoke Test 对 `packages/happy-cli/**` 的 PR 改动触发，因此选择该包内测试文档；根目录 docs-only 改动不会触发此检查。仓库没有真实 CI 时记录未通过，不以人工创建 success status 代替。

GitHub API 独立校验命令（替换本次真实参数）：

```bash
node scripts/verifyAiGithubDelivery.mjs am6737/happy-next ISSUE_NUMBER PR_NUMBER BRANCH FULL_COMMIT_SHA packages/happy-cli/docs/ai-agent-user-smoke.txt EXPECTED_LOCAL_FILE
```

该命令不验证 Happy UI、账号连接或真实 webhook。还须确认 GitHub 实际投递经过配置的正式 HTTP webhook，WorkItem/PR 状态在 DB 和 App 中一致；合成签名 payload 的旧测试不能代替实际投递。

## 第二轮：协作与权限

1. 建立一个 Leader 和两个成员，提交需要成员协作的工作；检查子任务、依赖、答复汇总与最终 diff。
2. 分别批准、拒绝、取消一个需审批的操作，核对拒绝和取消后没有继续写文件。
3. 执行中断开 daemon 再恢复，核对任务恢复或明确失败，且没有重复执行、重复 commit 或重复 PR。
4. 用成员账号测试 Workspace grant，再撤权；核对撤权后的读取和审批受阻，冲突刷新后展示服务端实际权限。
5. 发布 Team Skill v1 后启动任务，再发布 v2 启动第二个任务；核对各任务冻结对应版本。回滚不能改旧任务；解绑先取消确认，再实际确认，核对绑定状态。

## 第三轮：必须由真人或实体环境验收

在真实手机/电脑测试后台、断网重连、通知和审批恢复。实体 WebAuthn 登记后仍需独立运营审查与签署信任授权，操作见 [独立运营端设备信任审查](ai-team-human-enrollment-operations.zh-CN.md)。由真实接收人确认告警到达并记录时间。

Gemini 当前账号/provider 资格仍被拒绝；Codex 验收成功不代表 Gemini 通过。跨平台长时运行、签名发行及实际升级回滚也仍待验。自动合并和上线没有授权，任何上述测试成功均不自动开放这两项操作。
