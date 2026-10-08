# AI Team 告警规则与验证

规则在 `monitoring/ai-team-alerts.yml`，仅使用固定 queue/status 和采集端的 job/instance 标签，不包含账号、工作项、命令或路径。当前 Server 的五种 `ai_workflow_queue_items` 标签为 decision/pending、decision_delivery/pending、decision_delivery/blocked、budget/reserved、budget/unknown。

| 告警 | 条件 | 持续时间 |
|---|---|---|
| AiServerMetricsUnavailable | happy-server采集失败，或整个采集job缺失 | 5 分钟 |
| AiWorkflowMetricsMissing | happy-server 采集成功但审批队列指标缺失 | 5 分钟 |
| AiBudgetWatermarkMetricsMissing | happy-server 采集成功但预算水位指标缺失 | 5 分钟 |
| AiBudgetHighWater | ai_budget_max_utilization_ratio 超过 0.9 | 5 分钟 |
| AiDecisionDeliveryBlocked | blocked 投递数量大于 0 | 5 分钟 |
| AiDecisionDeliveryBacklog | pending 投递数量大于 10 | 10 分钟 |
| AiBudgetUnknownCost | unknown 预算数量大于 0 | 30 分钟 |

队列数量告警表示持续积压，不证明某一记录的年龄；需要 oldest-age 指标才能验收个别任务滞留。unknown 成本仍需管理员核对，不以告警自动补价、释放额度或删除审计。阈值是初始可配置值，须依据实际负载调整。

采集失败和job缺失由独立availability规则覆盖；原Missing规则继续只在up=1时检查应用指标，避免把离线误报为字段缺失。availability规则有官方promtool实际引擎测试（未满5m不触发、5m触发、恢复消失、job完全缺失、健康目标），并已有原始5m真实生产metrics端口停止/重开实采局部证据，详见下文；候选漂移使正式结果仍unknown。Prometheus自身停止时不能靠自身规则报警，采集器可用性仍需部署平台独立监控。

预算水位采用 review 提议的 `ai_budget_max_utilization_ratio`：当前有效 period 的每条预算 policy 计算 `(usedMicros+reservedMicros)/limitMicros`，取最大值；必须保留大于 1 的超支比例，不将未知价格记作 0。Server 后续已加入该指标，root 最新容量 fixture 的 actual DB→指标 95% 水位验证通过；完整容量脚本仍 exit1，背压与实际告警证据未闭环。root 的原始五分钟规则实采验证已完整 exit0：实际95%水位与 blocked 告警在355415ms后 firing，预算45%和 delivered恢复后告警消失，自有隔离库残留0。

验证使用官方 Prometheus 3.5.0 的 promtool，固定镜像摘要；只启动无网络的临时验证容器，不启动应用、采集器、通知接收器或生产服务：

```bash
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  -v "$PWD/monitoring:/rules:ro" --entrypoint /bin/promtool \
  prom/prometheus@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996 \
  test rules /rules/ai-team-alerts.test.yml
```

七组实际规则引擎测试覆盖采集失败/job缺失/健康目标、缺指标、目标离线不误报为字段缺失、95% 水位、blocked/pending 队列、unknown 成本的持续时间、触发及恢复。最初只读容器未提供 scratch `/tmp`，promtool 无法创建测试存储并 exit1；补独立 tmpfs 后 exit0/SUCCESS。这属于 Prometheus 合成时序单元验证，另有真实 Server `/metrics` → Prometheus 采集 → 原始5m水位/blocked告警触发/恢复的独立 exit0 证据；新availability规则实采亦已完成但候选漂移，尚未接入人类通知。

仓库现提供默认不开启的 Compose `monitoring` profile，配置为 `monitoring/prometheus.yml`，使用名为 happy-server 的采集 job、容器内 `happy-server:9090/metrics` 和上面固定摘要的官方镜像。Server Compose 显式启用内部9090指标，不将该端口映射到宿主。Prometheus UI 只绑定宿主 `127.0.0.1:9091`，只读规则挂载、drop ALL/no-new-privileges；本地命名卷保留最多15天或2GB时序数据，先达到的保留条件生效。该设置适用于当前单Server Compose，多副本部署须逐实例配置采集目标，不能把一个负载均衡地址当全部副本。

本轮只验证配置与规则，没有启动该profile、发送通知或上线。经最终稳定候选和环境验收并批准部署后，操作者可执行 `docker compose --profile monitoring up -d prometheus`；该命令也可能启动依赖的 happy-server，不能当成无副作用的配置检查。未配置Alertmanager或外部接收器，人类通知仍待明确目的地和独立验收。发布候选须纳入新增prometheus.yml摘要；完整生产验收仍未通过。

真实实采重跑命令（至少约六分钟，只操作自有隔离数据库与临时容器）：

```bash
cd packages/happy-server
npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/verifyAiTeamAlertsReal.mts
```

2026-10-07 15:55 主会话收取完整 exit0 与 fixture cleanup residual=0。该轮未记录运行前后完整候选摘要，因此只作为链路验证；稳定发布候选仍须独立捕获源摘要、规则摘要、触发/恢复和清理证据。

脚本现支持 `--report-file /tmp/NEW_REPORT.json`：启动时以 exclusive create 拒绝覆盖既有证据，记录前后完整 preflight candidateSha256、规则 SHA256、固定镜像、真实触发/恢复时间及清理状态；候选变化时结果 unknown 且 exit1。恢复要求两条目标告警均消失，不仅退出 firing。该增强需新一轮实采验证，旧轮通过不回填新证据。

## 采集端口离线与恢复的独立实采

从Server目录运行 `npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/verifyAiTeamAlertsReal.mts --target-outage-report /tmp/NEW_REPORT.json`。它先确认本轮隔离库的生产`createMetricsServer()`被真实Prometheus成功采集，再实际关闭自有metrics端口，等待原始5m规则；触发时查询真实up=0并断言没有将目标离线误报为应用指标字段缺失。随后在同一端口重开生产metrics、核对up=1且availability告警消失。只清理随机自有库/容器/临时目录，不停止API服务或共享采集器，不发送人类通知。

主会话最终版报告`/tmp/ai-team-metrics-outage-root-20261007-1726-final.json`：原始5m触发310338ms、恢复60060ms，targetScrapeVerified/actualTargetStopped/targetDownVerified/actualTargetRestarted/targetRecoveryScrapeVerified与chainVerified/fixtureCleaned均true；SHA256 `84b2aac8cc72cc8182737295e10a4d5942b69024bd6b28be779f5f573dbcabc6`。候选运行中漂移，整体exit1/resultunknown，不属于正式稳定候选放行。报告格式是`happy-ai-team-metrics-outage-real-v1`，不能当预算/blocked告警报告输入容量脚本。此测试停止的是实际生产metrics监听器，不是完整API/worker进程；整个Prometheus服务离线、job缺失实采、人类通知和多副本部署仍待验收。
