# 独立运营端设备信任审查

设备在 App 完成 WebAuthn 注册后仍为 `pending`。独立运营人员核对账号、设备登记及人类身份后，才为该设备签署一次短期信任授权。账号登录凭据或恢复申请本身不能代替这次审查。离线签名工具不会核验人的身份，也不会请求 Server。

运营端使用独立保管的 Ed25519 PKCS#8 PEM 私钥；私钥不得进入 App、daemon、Server、仓库或验收日志。Server 只配置对应公钥的 DER SPKI base64：`AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI`。已有密钥应通过运营密钥管理流程提供，本工具不自动生成生产密钥。配置空公钥会阻止新的信任提升，不会撤销已经 trusted 的设备。

在运营人员控制的目录中准备权限为 `0600` 的私钥与审批 JSON 文件。JSON 必须恰有以下六个字符串字段：

| 字段 | 内容 |
|---|---|
| `accountId` | 已核对的账号 ID |
| `credentialId` | 该账号登记的设备记录 ID（HTTP 路径所用 ID） |
| `approvalNonce` | 本次审查的新 UUID；不要复用旧审批 |
| `actorLabel` | 真实独立审查者的审计名称，3–200 字符 |
| `evidenceHash` | 独立保管的审查证据的 SHA-256，小写 64 位十六进制；原始材料不上传 |
| `expiresAt` | UTC ISO 时间，签署及 Server 接收时均须未过期，且至多在未来 5 分钟 |

字段顺序由工具按 Server 合同重建；原始 JSON 的重复字段（含 Unicode 转义后同名）、额外字段、过期授权、非 Ed25519 私钥、公开可读或非当前用户所有的文件、私钥末级软链均拒绝。审批只接受扁平字符串对象。工具要求支持 `getuid` 和 `O_NOFOLLOW` 的宿主；运营人员必须控制私有父目录，末级文件检查不等于完整路径防竞争。签名输出只包含审批与签名，以 `0600` 新建，已有目标文件不会覆盖：

```bash
node scripts/aiHumanTrustSign.mjs --private-key /operator/private/enrollment.pem --approval /operator/private/approval.json --out /operator/private/signed-approval.json
```

命令成功只表示已签署。审查者应再次确认输出的账号和设备身份，再将输出体交给该账号已认证的受控请求流程，调用 `POST /v1/ai-team/human-credentials/:credentialId/trust`。本工具不代发请求，不保存账号 token。Server 核验签名、账号和设备绑定、当前 pending 状态、期限和 nonce，并原子写入 trusted 状态及审计；重复或冲突请求拒绝。需要重新审查时新建 nonce 和期限，不能修改已签署内容。

设备提升信任后，每一代恢复申请仍需新的 WebAuthn UP/UV assertion；信任授权不授予重新执行未知工具副作用的权限。设备撤销通过已有 revoke API 完成，不能以删除运营公钥替代设备撤销。

`verifyAiHumanTrustOperatorReal.mts` 在随机自有账号与 pending 设备 fixture 上验证真实离线命令→正式 HTTP→PostgreSQL 的签名、字段顺序、跨账号/篡改拒绝、nonce 重放、一次审计及私有文件边界。fixture 不是 WebAuthn 登记、实体设备或真实运营人类身份核验；完整生产清单仍须独立验收。

## 本次用户授权的测试密钥

2026-10-08 用户明确要求生成其余配置后，主会话为当前测试环境生成了Ed25519密钥对。私钥保存在仓库外 `/home/coder/.local/share/happy-next-test-operator/enrollment.pem`（0600，父目录0700）；公钥文件为同目录 `enrollment.spki.base64`，并已写入三个env的 `AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI`。这是同宿主的测试保管，生产运营应在独立运营端生成和保管私钥。Server启动在本次写公钥之前，需重启加载；本次没有授信任何设备或签署真人核验结果。
