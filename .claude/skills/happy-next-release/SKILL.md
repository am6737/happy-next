---
name: happy-next-release
description: Cuts a happy-next release through explicit CLI, GitHub Release, Docker, iOS App Store, or full release paths. Command-only — invoked via /happy-next-release.
---

# Happy Next 发布流程

## 总则

每次调用先让用户选择一条发布线，只展开对应 checklist：

- **A. 仅 CLI**
- **B. GitHub Release（App + Desktop）**
- **C. Docker**
- **D. iOS App Store**
- **E. 全部**

版本关系：

- CLI 使用 `packages/happy-cli/package.json` 中的独立 npm 版本。
- B、C、D 使用同一个不可变的 `vX.Y.Z` git tag 和同一个源代码 commit。
- B 包含 Android APK/AAB、iOS IPA、macOS Universal、Windows x64、Windows ARM64 和 `latest.json`。
- D 不重新构建 IPA，只提交 B 已发布的同一份 IPA。
- 推送 tag 本身不会发布 GitHub Release 或 Docker；必须显式触发相应 workflow。
- 不再提供“仅桌面追加到既有 Release”入口。

不要默认发布全部。任何会真实发布、提交 App Store、创建 tag、覆盖 Secret 或修改 Release 的操作，都必须先展示目标版本和完整命令并等待用户确认。

触发任何 GitHub Actions workflow 后，立即返回 Run URL 并在后台监控；不得同步阻塞等待，运行结束后报告结果。

## 共用前置检查

```bash
git status --short --branch
git branch --show-current
git fetch origin --tags
git pull --ff-only origin main
```

要求：

- 工作区干净；
- 当前分支为 `main`；
- 本地 `main` 与远端同步；
- 不得自行 stash、覆盖用户修改或强制推送。

如果不干净，提供“先提交指定改动 / 用户自行处理”选项，不要自作主张。

## 发布入口选择

询问用户：

- A. 仅 CLI
- B. GitHub Release（App + Desktop）
- C. Docker
- D. iOS App Store
- E. 全部

选择后只执行对应分支。

---

# A. 仅 CLI

## A1. 审计 CLI 改动

```bash
LAST_CLI=$(git log --oneline --grep='^release: happy-next-cli' | head -1 | awk '{print $1}')
RANGE="${LAST_CLI:+${LAST_CLI}..HEAD}"
git log ${RANGE:--30} --oneline --no-merges -- packages/happy-cli packages/happy-wire
```

展示 CLI/wire 改动。如果没有需要发布的 CLI 改动，建议取消。

## A2. 校验

```bash
cd packages/happy-cli
yarn build
```

修改过 `happy-wire` 时还必须：

```bash
cd packages/happy-wire
yarn build
```

## A3. 决定 CLI 版本

```bash
node -e "
const v = require('./packages/happy-cli/package.json').version.split('.').map(Number);
console.log('当前: ' + v.join('.'));
console.log('patch: ' + v[0] + '.' + v[1] + '.' + (v[2] + 1));
console.log('minor: ' + v[0] + '.' + (v[1] + 1) + '.0');
console.log('major: ' + (v[0] + 1) + '.0.0');
"
```

建议规则：

- `fix/chore/docs`：patch
- `feat`：minor
- `BREAKING CHANGE` 或 `!:`：major

把当前版本、候选版本、建议和依据交给用户确认。

## A4. 发布

执行前展示并确认：

```bash
gh workflow run cli-publish.yml \
  -f version={CLI版本} \
  -f dry-run=false
```

确认后执行并监听：

```bash
RUN_ID=$(gh run list --workflow=cli-publish.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID"
```

成功后：

```bash
git pull --ff-only origin main
node -p "require('./packages/happy-cli/package.json').version"
```

---

# B. GitHub Release（App + Desktop）

## B1. 审计待发布改动

```bash
LAST=$(git tag --sort=-version:refname | grep '^v[0-9]' | head -1)
git log "${LAST}..HEAD" --oneline --no-merges
```

如果没有用户可感知变化，建议不发布。

## B2. 检查发布 Secrets

只检查名称，不读取值：

```bash
gh secret list --app actions | cut -f1
```

要求：

- `EXPO_TOKEN`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_KEYCHAIN_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `ASC_API_KEY_ID`
- `ASC_API_KEY_P8_BASE64`
- `ASC_ISSUER_ID`

缺少任何 Secret 都停止。不得让用户在聊天中粘贴私钥、证书或密码。

## B3. 决定 App 版本

```bash
LAST=$(git tag --sort=-version:refname | grep '^v[0-9]' | head -1)
node -e "
const v = '$LAST'.replace(/^v/, '').split('.').map(Number);
console.log('当前: $LAST');
console.log('patch: v' + v[0] + '.' + v[1] + '.' + (v[2] + 1));
console.log('minor: v' + v[0] + '.' + (v[1] + 1) + '.0');
console.log('major: v' + (v[0] + 1) + '.0.0');
"
```

按 commit 类型给出 patch/minor/major 建议，让用户确认最终 `vX.Y.Z`。

确认该 tag 和 Release 均不存在：

```bash
git rev-parse "refs/tags/{tag}" 2>/dev/null || true
gh release view "{tag}" 2>/dev/null || true
```

已使用的版本不得覆盖或重建，改用更高版本。

## B4. 更新 changelog 和产品文档

涉及文件：

1. `packages/happy-app/CHANGELOG.md`
2. `packages/happy-app/sources/changelog/changelog.json`
3. `README.md`
4. `README.zh-CN.md`
5. `docs/changes-from-happy.md`
6. `docs/changes-from-happy.zh-CN.md`

先将 commit 按用户可感知的功能领域分类并展示草稿，等待用户确认。

规则：

- `CHANGELOG.md` 按版本记录；
- 其余四个 md 是完整功能总览，不增加版本标题；
- 中英文结构与含义保持一致；
- 不写仅对开发者有意义的实现细节。

生成 JSON：

```bash
cd packages/happy-app
npx tsx sources/scripts/parseChangelog.ts
```

运行校验：

```bash
yarn typecheck
yarn test --run
```

只提交这六个文档文件：

```bash
git add \
  packages/happy-app/CHANGELOG.md \
  packages/happy-app/sources/changelog/changelog.json \
  README.md README.zh-CN.md \
  docs/changes-from-happy.md \
  docs/changes-from-happy.zh-CN.md
git commit -m "docs: changelog for {tag}"
git push origin main
```

## B5. 创建不可变 tag

展示并再次确认：

```bash
git tag {tag}
git push origin {tag}
```

tag 必须指向已经推送的 `main` commit。不得移动、删除或强推已发布 tag。

## B6. 触发 GitHub Release

workflow 输入：

- `release_tag={tag}`
- `confirmation=PUBLISH-RELEASE`

展示命令并等待确认：

```bash
gh workflow run release.yml \
  -f release_tag={tag} \
  -f confirmation=PUBLISH-RELEASE
```

确认后执行并监听：

```bash
RUN_ID=$(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID"
```

## B7. 验证 Release

```bash
gh release view {tag} --json tagName,assets,url
```

除 `latest.json` 外，所有附件必须以 `happy-next-{tag}-` 开头：

```text
happy-next-vX.Y.Z-android.apk
happy-next-vX.Y.Z-android.aab
happy-next-vX.Y.Z-ios.ipa
happy-next-vX.Y.Z-macos-universal.dmg
happy-next-vX.Y.Z-macos-universal.zip
happy-next-vX.Y.Z-macos-universal.app.tar.gz
happy-next-vX.Y.Z-macos-universal.app.tar.gz.sig
happy-next-vX.Y.Z-windows-x64-setup.exe
happy-next-vX.Y.Z-windows-x64-setup.exe.sig
happy-next-vX.Y.Z-windows-x64.msi
happy-next-vX.Y.Z-windows-x64.msi.sig
happy-next-vX.Y.Z-windows-arm64-setup.exe
happy-next-vX.Y.Z-windows-arm64-setup.exe.sig
happy-next-vX.Y.Z-windows-arm64.msi
happy-next-vX.Y.Z-windows-arm64.msi.sig
happy-next-vX.Y.Z-desktop-metadata.json
happy-next-vX.Y.Z-sha256sums.txt
latest.json
```

必须下载并检查 `latest.json`：

- version 等于 tag；
- 四个平台键齐全；
- URL 中没有空格或 `%20`；
- 每个 URL 返回 HTTP 200；
- 签名非空。

CI 成功不能描述为真机安装或升级成功。未测试的平台明确标记 **未验证**。

---

# C. Docker

## C1. 选择 tag

Docker 必须使用现有不可变 `vX.Y.Z` tag。

如果是 B 同版本，复用 B 创建的 tag；如果是 Docker-only 新版本，先审计改动、确认版本，并按 B5 创建 tag，但不要触发 B。

## C2. 决定是否更新 latest

- 发布最新正式版本：`publish_latest=true`
- 重建旧版本或补历史镜像：`publish_latest=false`

如果目标 tag 不是当前最高正式版本，默认建议 `false`。

## C3. 触发

展示并等待确认：

```bash
gh workflow run docker-publish.yml \
  -f release_tag={tag} \
  -f publish_latest={true|false} \
  -f confirmation=PUBLISH-DOCKER
```

确认后执行并监听：

```bash
RUN_ID=$(gh run list --workflow=docker-publish.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID"
```

成功后核对五个镜像的版本标签与架构：

- `kuaifan/happy-server`
- `kuaifan/happy-app`
- `kuaifan/happy-voice`
- `kuaifan/happy-docs`
- `kuaifan/happy-web`

---

# D. iOS App Store

## D1. 前置检查

必须已有 B 创建的 GitHub Release，且包含：

```text
happy-next-{tag}-ios.ipa
```

检查：

```bash
gh release view {tag} --json assets --jq '.assets[].name'
```

没有该 IPA 时停止，不允许 D 分支重新构建一个不同的 IPA。

## D2. 触发提审

这是不可逆的外部发布操作。展示并等待确认：

```bash
gh workflow run ios-submit.yml \
  -f release_tag={tag} \
  -f confirmation=SUBMIT-IOS
```

确认后执行并监听：

```bash
RUN_ID=$(gh run list --workflow=ios-submit.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID"
```

workflow 会下载 GitHub Release 中的同一份 IPA，并通过 EAS 提交 App Store Connect。

成功只代表上传/提交请求完成；审核状态需要在 App Store Connect 中另行核对。

---

# E. 全部

全套包含 A + B + C + D。

## E1. 确认两个版本

分别确认：

- CLI npm 版本；
- App/Docker `vX.Y.Z` tag。

二者互相独立，不强制相同。

## E2. 执行顺序

1. 完成 A，拉回 CLI workflow 写入 main 的版本提交。
2. 完成 B1-B5，创建包含 CLI 版本提交的 App/Docker tag。
3. 同时触发 B6 与 C3；它们使用同一 tag 和 commit，可以并行。
4. B 完成并验证 IPA 后，执行 D。
5. 最终核对 npm、GitHub Release、Docker Hub、App Store Connect。

A 必须先于 App/Docker tag，D 必须晚于 B。B 与 C 可以并行。

---

# 首次完整桌面升级验收

首次正式验证或 updater 发生变化时，必须发布两个真实的新版本，不得向历史 Release 追加当前源码构建的桌面文件。

1. 发布较低版本 A 的完整 B Release。
2. 从 GitHub 下载并安装 A。
3. 确认客户端显示版本 A。
4. 发布较高版本 B 的完整 B Release。
5. 等待后台下载，检查未登录和已登录布局中的更新按钮。
6. 点击更新并确认重启到 B。
7. 检查登录状态、本地数据、通知、图片、麦克风和摄像头。
8. Apple Silicon、Intel、Windows x64、Windows ARM64 分别记录；没有真机就标记 **未验证**。

不要删除或覆盖已成功发布的版本来伪造升级测试；失败时使用新的更高版本修复。

# 禁止事项

- 不提交或输出证书、Token、密码、私钥。
- 不使用 `--clobber` 覆盖 Release 附件。
- 不移动或强推正式 tag。
- 不把 CI 成功等同于真机验证成功。
- 不在 D 分支重新构建 IPA。
- 不让推送 tag 隐式触发未选择的发布线。
- 不手动修改 `app.config.js` 的默认版本。
- 不手动修改 CLI package version；CLI workflow 负责版本提交。
