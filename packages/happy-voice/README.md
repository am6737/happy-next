# happy-voice

Happy Next 的**语音网关**：基于火山引擎「AI 音视频互动方案」(2025-06-01, ArkV3 内置豆包) 的 Fastify 服务。

为客户端（happy-app）提供两类能力：

1. **实时语音通话**——网关签发火山 RTC 进房 token 并调用 OpenAPI `StartVoiceChat` 拉起 AIGC 智能体。之后 ASR → 豆包(LLM, 流式) → 双向流式 TTS 全部在火山机房内完成；客户端只负责进同一个 RTC 房间收发音频。**function call 在客户端执行**（网关不碰）。
2. **消息朗读 TTS**——`「朗读消息」`功能，调用火山大模型 TTS，按句流式返回 mp3。

> 迁移历史：早期基于 LiveKit + Cartesia/OpenAI，现已全量切到火山 RTC + 豆包。

## 架构

```
happy-app ──HTTP──> happy-voice (本服务)
   │                   │  签发 RTC token
   │                   └─ OpenAPI StartVoiceChat ──> 火山 AIGC(ASR→豆包→TTS)
   └──────── RTC 音频 ───────────────────────────────> 同一房间
```

- 实时对话的音频/控制消息走 **RTC**（不经过本服务）。
- 本服务只做：进房鉴权(token)、起/停智能体、消息朗读 TTS、文本清洗。
- 会话状态存在内存 `sessionStore`，定时清理过期项。

## HTTP 接口

所有 `/v1/*` 接口需带 `Authorization: Bearer <short-lived voice token>`；token 由 happy-server 的 `/v1/voice/token` 签发。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/healthz` | 健康检查 |
| POST | `/v1/voice/session/start` | 起一个语音会话：返回 `appId/roomId/uid/agentUid/rtcToken/gatewaySessionId`，并调用 StartVoiceChat |
| POST | `/v1/voice/session/stop` | 停止会话（StopVoiceChat） |
| GET  | `/v1/voice/session/:gatewaySessionId/status` | 查询会话状态 |
| POST | `/v1/voice/tts` | 一次性合成（返回 base64 mp3） |
| POST | `/v1/voice/tts/stream` | 流式合成（SSE，按句返回 mp3，供「朗读消息」边合成边播放） |
| GET  | `/test` | 仅 dev：浏览器测试台，验证 RTC 音频闭环 |

`AGENT_WELCOME_MESSAGE` 支持用 `|` 分隔多条，每次进房随机选一条。客户端也可在 `session/start` 里传 `welcomeMessage` 覆盖（同样支持 `|`）。

## 环境变量

见 `.env.example`，分为**必填**（无默认值，缺失则启动报错）与**可调**（均有默认值）。

必填 7 项：
`VOICE_AUTH_SECRET`、`VOLC_RTC_APP_ID`、`VOLC_RTC_APP_KEY`、`VOLC_ACCESS_KEY_ID`、`VOLC_SECRET_ACCESS_KEY`、`VOLC_TTS_APP_ID`、`VOLC_TTS_TOKEN`。

- 火山 RTC 应用**必须是「AI 智能体」类型**。
- `VOLC_ACCESS_KEY_ID/SECRET` 是 IAM 访问密钥，用于 OpenAPI 签名（Start/StopVoiceChat）。
- `VOLC_TTS_APP_ID/TOKEN` 是大模型 TTS（朗读消息用）。

完整变量与默认值以 `sources/runtime/env.ts` 为准。

## 运行

默认端口 **3040**（`PORT`）。

```bash
# 开发（读取 .env.local）
cp .env.example .env.local   # 填好必填项
yarn dev

# 生产
yarn start

# 类型检查
yarn typecheck
```

Docker（仓库根的 `docker-compose.yml` / `deploy/docker-compose.yml` 已包含本服务）：

```bash
docker compose up -d happy-voice
```

## 目录

```
sources/
  main.ts              # Fastify 启动 + dev 测试台
  api/routes.ts        # HTTP 接口
  runtime/
    env.ts             # 环境变量 schema（唯一真源）
    rtcToken.ts        # 火山 RTC 进房 token 签发
    rtcOpenApi.ts      # StartVoiceChat / StopVoiceChat（OpenAPI 签名）
    ark.ts             # 豆包/Ark 调用（文本清洗等）
    tts.ts             # 大模型 TTS 合成
    prompts.ts         # 系统 prompt 渲染
    sessionStore.ts    # 内存会话存储
  types/voice.ts       # 类型
prompts/               # 系统 prompt 模板
```
