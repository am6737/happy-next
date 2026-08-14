# 自托管（Docker Compose）

[🇬🇧 English](self-host.md)

本指南说明如何使用根目录的 `docker-compose.yml` 私有化部署 Happy Next。

包含服务：

- `happy-app`：Web 应用，默认端口 `3030`
- `happy-server`：API + WebSocket，默认端口 `3031`
- `happy-voice`：语音网关，默认端口 `3040`
- `postgres`、`redis`、`minio`

## 快速开始

1. 创建环境文件：

```bash
cp .env.example .env
```

2. 编辑 `.env`。

本地跑通最少需要设置：

```env
HANDY_MASTER_SECRET=请改成随机值
POSTGRES_PASSWORD=请改成随机值
S3_SECRET_KEY=请改成随机值
VOICE_AUTH_SECRET=请改成随机值
```

如果要使用语音功能，还需要填写火山引擎相关配置：

```env
VOLC_RTC_APP_ID=
VOLC_RTC_APP_KEY=
VOLC_ACCESS_KEY_ID=
VOLC_SECRET_ACCESS_KEY=
VOLC_TTS_APP_ID=
VOLC_TTS_TOKEN=
ARK_API_KEY=
```

3. 启动：

```bash
docker-compose up -d
```

首次启动会自动执行数据库迁移，并自动创建 MinIO bucket。

4. 打开：

- Web：`http://localhost:3030`
- API：`http://localhost:3031`
- Voice：`http://localhost:3040`
- MinIO：`http://localhost:3050`

## 地址配置逻辑

前端启动时使用：

```env
EXPO_PUBLIC_HAPPY_SERVER_URL=http://localhost:3031
```

然后前端会请求 API 的 `/v1/app-config`，获取服务端返回的真实地址：

```env
PUBLIC_API_BASE_URL=
PUBLIC_VOICE_BASE_URL=http://localhost:3040
```

说明：

- `PUBLIC_API_BASE_URL` 留空时，前端继续使用入口 API 地址。
- `PUBLIC_VOICE_BASE_URL` 留空时，语音功能不会自动启用。
- `APP_URL` 是 Web 应用地址，用于部分回跳/连接流程。
- `S3_PUBLIC_URL` 必须是浏览器/移动端能访问的资源地址。

## 远程/公网部署

如果不是本机访问，不要使用 `localhost`。需要改成你的公网域名：

```env
APP_URL=https://app.example.com
EXPO_PUBLIC_HAPPY_SERVER_URL=https://api.example.com
PUBLIC_API_BASE_URL=https://api.example.com
PUBLIC_VOICE_BASE_URL=https://voice.example.com
S3_PUBLIC_URL=https://s3.example.com/happy-server
GITHUB_REDIRECT_URL=https://api.example.com/v1/connect/github/callback
```

同时确保这些端口或域名能访问：

- Web：`3030`
- API：`3031`
- Voice：`3040`
- MinIO/S3：`3050`

## 语音说明

语音不再支持前端自定义语音地址和 key。

现在的链路是：

1. 前端请求 API 获取临时语音 token。
2. 前端用临时 token 请求 `happy-voice`。
3. `happy-server` 和 `happy-voice` 通过同一个 `VOICE_AUTH_SECRET` 校验。

所以：

```env
VOICE_AUTH_SECRET=必须在 happy-server 和 happy-voice 中一致
```

Docker Compose 已经自动把同一个环境变量传给两个服务。

## GitHub 登录/连接

如果不使用 GitHub 功能，可以留空。

如果使用，需要配置：

```env
GITHUB_APP_ID=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URL=https://api.example.com/v1/connect/github/callback
GITHUB_WEBHOOK_SECRET=
GITHUB_PRIVATE_KEY=
```

## 常用命令

查看状态：

```bash
docker-compose ps
```

查看日志：

```bash
docker-compose logs -f happy-server
docker-compose logs -f happy-voice
```

手动执行数据库迁移：

```bash
docker-compose exec happy-server yarn --cwd packages/happy-server prisma migrate deploy
```

停止：

```bash
docker-compose down
```

## 故障排查

验证 API 配置：

```bash
curl http://localhost:3031/v1/app-config
```

验证语音网关：

```bash
curl http://localhost:3040/healthz
```

如果浏览器提示跨域，优先检查：

- 前端实际请求的 API 地址是否正确
- 代理是否转发了 `OPTIONS`
- 请求是否返回了 `502/500/重定向`
- 是否带了 credentials/cookie
