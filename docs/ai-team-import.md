# AI Team 本地导入

使用本地脚本创建默认的 Happy 小型研发团队。脚本通过真实的 `/v1/ai-team/*` API 创建 Agent 和 Team，不直接访问数据库。

## 环境变量

```bash
export HAPPY_SERVER_URL=http://localhost:3005
export HAPPY_TOKEN='当前 Happy 账号的 Bearer token'
```

可选的 `HAPPY_WORKING_DIRECTORY` 用于设置五个 Agent 的默认工作目录，默认是运行脚本时的当前目录。

## 预览

```bash
yarn ai-team:seed --dry-run
```

## 创建

```bash
yarn ai-team:seed
```

脚本是幂等的：同名 Agent 或 Team 已存在时默认保留现有配置。确认需要用模板覆盖现有配置时，显式使用：

```bash
yarn ai-team:seed --update-existing
```

凭证只从当前 shell 环境读取，不会写入文件或 Git。
