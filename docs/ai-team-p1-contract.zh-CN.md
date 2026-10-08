# AI Team P1 服务端协作契约

更新：2026-10-07。此文件由 server 维护，列出 app/CLI/wire 集成输入；字段实施状态以服务端结果报告为准。所有写接口均按认证账号隔离，外部请求携带稳定 `clientMessageId`。

公开 `/v1/orchestrator/submit` 的 `metadata` 只允许普通客户端注释字段；`ai*`、`coordinator*`、`github*` 内部身份键以及 `conversationId` 被拒绝（HTTP 400）。内部 Coordinator Run 必须由服务端已校验的路径创建。旧 Run 的 finish 也独立验证账号、会话、Agent 和成员绑定。主会话已更新真实 public submit 安全脚本，现 exit 0。

## App → Server

- `POST /v1/ai-team/conversations/:id/messages`：`{clientMessageId,text,targetWorkItemId?,targetTaskId?,mode?:"new"|"continue"|"steer",assigneeId?,clarificationId?}`。`new` 强制新任务；`continue` 要求同账号/会话、终态可 resume 的 WorkItem 和原机器/工作区身份；`steer` 要求运行中 WorkItem，团队多活动任务时还须 `targetTaskId`。无目标的 continue 返回持久澄清，不能猜最近一个。显式 `@Agent` 按同账号同团队 enabled 成员解析；名称歧义返回候选 `agentId`。
- 响应按 `chat|clarify|create_task|update_task` 分类；模型内部协议还可识别 `delegate`，真正委派只走受限 API。`clarify` 含 `clarificationId`、问题和候选项。补充回答带 `clarificationId`，沿用原需求和原 conversation。`steer` 返回 HTTP 202、`steeringId`、`status:"queued"`，仅表示持久入队；`GET /v1/ai-team/work-items/:id/steering/:steeringId` 查 `pending|processing|delivered|blocked`，`POST .../retry` 仅重排 blocked。相同 `(account,conversation,clientMessageId)` 与同请求内容返回持久相同响应，不同内容为 409。
- `GET /v1/ai-team/work-items/:id/collaboration` 返回同 run 的任务 ID、父任务、成员、依赖、角色、状态、branch/commit、截断的 `finalResponse` 和重分派审计。运行诊断只出现在受限详情，不得作为聊天消息。wire 请求/响应类型须在字段稳定后更新并先 build。

## CLI → Server

- 同账号在线 machine 注册 `${machineId}:ai-structured-model` RPC，输入 `{prompt:string,timeoutMs:number,maxResponseBytes:number}`，只提供纯推理、无 shell/MCP/私有目录读取。成功只返回 `{text:string}`；错误返回非成功状态。Server 校验账号 socket、大小、超时和 JSON schema；无此 RPC 时 fail closed，不退回 `:bash`。
- 同账号 machine 另注册 `${machineId}:orchestrator-steer` RPC，输入 `{steeringId,executionId,dispatchToken,message}`，成功仅返回 `{accepted:true}`。CLI 必须按 `steeringId` 持久去重并确认注入到匹配 execution；断线/超时会以同一 ID 重投，server 不把排队视为送达。
- dispatch payload 保留已有 `runId/taskId/executionId/dispatchToken/provider/prompt/workingDirectory/permissionMode`，新增可选 `assignedAgentId,parentTaskId,teamId,delegationDepth,integrationPolicy:"review_and_cherry_pick"`。Server 在 aggregate 派发前要求每个成员有独立 branch、完整 commit 和共同 base；CLI 集成仅 cherry-pick 明确子提交，冲突停为 blocked，重新验证后才交付统一 PR。CLI 不得凭 prompt 自行突破授权。
- finish 使用现有 `POST /v1/orchestrator/executions/:id/finish`，`dispatchToken` 必须匹配；新增 `finalResponse` 只表示 runtime 的明确最终 agent_message。`outputText/outputSummary/errorMessage/stderr/diagnostics` 是日志和任务详情，不进入聊天。重复相同 execution/token 幂等；失败或缺少 `finalResponse` 不产生 agent 聊天消息。
- aggregate `completed` finish 必须带 `integrationProof:{baseCommit,aggregateCommit,members:[{taskId,branchName,sourceCommit,integratedCommit}]}`；成员集合和 branch/commit/base 必须与同 run 已完成 delegated 任务及 aggregate 依赖精确匹配，否则 409。服务端当前只校验数据库身份与结构，仍需独立 Git patch/文件字节证明才能将结果视为可信交付。
- Server 接受匹配 proof 后持久化 `AiIntegrationVerification` 为 `pending`，aggregate task/run 暂不 completed。后台 worker 用 DB 的 execution/token 和所有成员 machine/branch/base/SHA 生成 expected 快照及规范 hash，调用 `${machineId}:orchestrator-verify-integration` 只读 RPC；CLI 校验独立 workspace/Git patch/改动文件字节。响应须 `{verified:true,expectedHash}` 且 hash 匹配，server 才推进 aggregate；错误/超时重试，`patch_missing|file_mismatch|conflict|identity_changed` blocked。`GET /v1/ai-team/work-items/:id/integration-verification` 查询状态，`POST .../retry` 只重排 blocked。
- verification worker 领取 45 秒 lease；最后 DB 读取后派发前以及 ACK 提交时都以数据库实际时钟校验同一 owner/有效 lease。ACK 事务锁 Run、Task、Execution 与验证行，复核 expected hash、原 dispatchToken、最新 attempt 及 running Run/Task；失租退回 pending，不能将过期 ACK 推进 aggregate。RPC 已发但 ACK 失租时可能重投，CLI 必须按 execution/expectedHash 本地幂等验证。
- `GET /v1/ai-team/tasks/:id/git-identity` 账号隔离返回 machine、仓库 grant 名称/ID、base/branch/commit，不返回别的账号私有目录。`GET /v1/ai-team/conversations/:id/clarifications?status=pending` 恢复待回答问题/候选。`POST /v1/ai-team/work-items/:id/cancel|retry` 要求稳定 `clientRequestId`；`changes_requested` 要求 `clientMessageId` 并在原 WorkItem 上 resume，返回同一 WorkItem 的新 executionId。

## Delegation / DAG

- Leader 在运行中通过 `POST /v1/ai-team/tasks/:id/delegations` 提交 `{dispatchToken,delegationKey,assignedAgentId,title,requirements,dependsOnTaskIds[]}`。Server 核验同账号、同 team、成员 enabled、Leader `allowDelegation`、深度 1、最多 8 个成员任务、兼容 runtime/权限和同 run 依赖；`(parentTaskId,delegationKey)` 唯一且 hash 冲突 409。`PATCH /v1/ai-team/tasks/:id/assignee` 仅允许排队成员任务重分派并写审计。
- Leader 首轮完成只表示规划完成。聚合审查任务显式依赖全部子任务和集成结果；任一失败/取消按 DAG 传播，整体不可提前 completed。子结果以只读摘要及 commit 身份回流到聚合任务；重分派产生新的受审计 attempt，不偷偷改派既有执行。取消沿 parent/child 传播。
- 跨实例 scheduler 仅可领取本实例可路由的 machine RPC；不可见 machine 保持 queued，不能记录 `RPC_DISPATCH_FAILED`。共享路由上线后才允许跨实例领取。

## 当前集成边界

Server 已在对话路由解析共享 Context/Decision；模型给出 `update_task` 时仍按账号/会话核验 WorkItem，`create_task` 核验成员，`delegate` 在普通聊天中返回 409，真正创建必须由持有活跃 Leader execution token 的受限 delegation API 提交。CLI 已独立验证真实 Leader MCP、双成员、steering、cherry-pick、冲突与只读集成验证函数。Server 的 43115 DB/HTTP fixture 使用模拟 RPC 验证 pending/verified/blocked 转换；跨进程 server→真实 daemon 验证 RPC 闭环与共享五动作真实模型/DB 决策尚未验收。外部 GitHub E2E 也未完成。
## 审计投影增量（2026-10-07）

Server 的普通 `AiExecution.id` 保留历史 task control ID 语义；当任务已有 attempt，额外输出 `orchestratorExecutionId` 为最新实际 `OrchestratorExecution.id`，供 App 获取执行事件与 capability 绑定审计。不要把原 `id` 改成 attempt ID；没有 attempt 时新字段省略。共享 wire 类型由主会话在消费者构建窗口同步，此文件只公布服务端已返回的可选字段。

Workspace scoped WorkItem 列表与详情现在也返回 `orchestratorTaskId`（控制 ID）及 `orchestratorExecutionId`（最新实际 attempt，可为 null），成员仍需 Project 或 Agent `canView` grant。CLI 在 running 时通过 `POST /v1/orchestrator/executions/:id/identity` 固定 `dispatchToken,machineId,childSessionId,worktreePath,branchName`；同值重放 200、异值/旧 attempt 409，Project 冻结快照仍须有效。随后 operation Decision 请求使用该 DB 身份；finish 不可覆盖已绑定身份。人工验收 approved 请求应传 `reviewedExecutionId`，与 UI 实际审看的 attempt 一致；旧客户端缺字段只允许首个 attempt，返修后缺字段 409。取消在无 RPC/无子进程 ACK 时经过 60 秒宽限期终态为 cancelled/`CANCEL_ACK_TIMEOUT`，不能解释为远端进程已经被操作系统杀死。
