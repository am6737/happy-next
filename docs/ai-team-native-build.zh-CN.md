# 在另一台机器构建原生开发包

使用 `am6737/happy-next` 的 `feat/ai-team-real-implementation` 分支及同一份根 `yarn.lock`。本次包含 AI Team 源码、共享 wire、数据库迁移和原生启动修复；本地环境密钥、运营签名私钥、依赖备份及本机配置不随 Git 提交。

在已有 checkout 的根目录执行（先保留构建机器自己的未提交改动）：

```bash
git fetch origin
git switch feat/ai-team-real-implementation
git pull --ff-only origin feat/ai-team-real-implementation
yarn install --frozen-lockfile
yarn workspace happy-wire build
```

使用 Yarn 1.22.22。Unistyles 必须为本次精确锁定的 `3.0.22`，可核对实际安装：

```bash
node -p "require('./packages/happy-app/node_modules/react-native-unistyles/package.json').version"
```

在有 Xcode 和签名配置的 Mac 上构建并安装到设备：

```bash
EXPO_PUBLIC_HAPPY_SERVER_URL=https://3031--main--am--am6737.coder.dootask.com yarn workspace happy-app ios:dev --device
```

该命令本地构建开发包，不执行 App Store 发布。若用 Android 构建环境，对应命令为 `yarn workspace happy-app android:dev`，同样需设置上述公开 Server 地址。

构建后完全关闭并重新打开开发 App，连接提供本次相同代码的 Metro。本工作区的 Metro 在 9091 已带 `--clear` 重启；另一个 Metro 也应在依赖或配置改变后清缓存重启。仅刷新 JS 不能升级开发包内的原生模块；若旧包仍报原生版本不匹配，需重建并重新安装。

本次源码类型检查及 Babel/Metro 解析检查已通过；实体设备恢复和完整当前候选的生产清单尚未验收通过。配置本地开发包不表示授权合并、发布或上线。
