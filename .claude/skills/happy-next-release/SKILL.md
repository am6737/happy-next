---
name: happy-next-release
description: Cuts a happy-next release (CLI / App + Docker / iOS / full combo). Command-only — invoked via /happy-next-release.
---

# Happy Next 发布流程

## Overview

发版前先询问用户本次发哪条线，只展开对应 checklist。各发布线版本号**互相独立**：CLI 可单独发；手机 App、Docker 和桌面客户端绑定同一 tag；iOS 提审依赖对应 tag 已存在。全套（A + B + C）必须**按 A → B → C 顺序**走，否则 App tag 会漏掉 CLI 的 version bump commit，iOS 提审也会找不到 tag。

**不要默认全发**。含 A（CLI）或 C（iOS）的分支还要再问触发方式，见下方「触发方式」小节。

## 发布线一览（4 个目标，对应入口 A/B/C）

| 发布对象 | 版本源 | 触发方式 | Workflow |
|---|---|---|---|
| happy-next-cli（npm） | `packages/happy-cli/package.json` | 手动 `workflow_dispatch` | `cli-publish.yml` |
| 手机 App（APK/AAB/IPA） | git tag 去掉 `v` 前缀 | 推 tag `v*` | `release.yml` |
| Docker 镜像（server/webapp/voice/docs） | git tag | 推 tag `v*`（同上） | `docker-publish.yml` |
| 桌面客户端（macOS Universal / Windows x64 / Windows ARM64） | git tag 去掉 `v` 前缀 | 推 tag `v*`（同上） | `release.yml` |
| iOS App Store 提审 | 手动输入 | 手动 `workflow_dispatch` | `release.yml`（submit-ios 分支） |

## 入口：问用户本次发什么

用 AskUserQuestion 或 options，让用户从以下选择：

- **A. 仅 CLI**（改动只动了 `packages/happy-cli/`）
- **B. App + Docker + Desktop**（改动涉及 happy-app / happy-server / happy-voice / happy-docs；同一个 tag 同时发布桌面安装包和更新清单）
- **C. 仅 iOS App Store**（之前 tag 已发过，现在要提审）
- **D. 全套**（A + B + C，按序执行）

根据选择跳到对应小节，**只展开该分支的 checklist**，用 TodoWrite 建 todo 跟踪。

选了 **A、C 或 D** 时，在进入第一个手动触发步骤前，再问一次触发方式（手动 / `gh`），见下节。

---

## 共用前置检查（所有分支开头都跑）

```bash
git status           # 工作区必须干净
git branch --show-current  # 应在 main
git pull origin main # 拉最新
```

如果工作区不干净，询问用户是否先 commit 或 stash，不要自作主张。

---

## 触发方式：手动 vs `gh`（仅 A / C / D 用到）

CLI 发布（A）和 iOS 提审（C）都靠手动 `workflow_dispatch`。进入这些步骤前，询问用户：

- **手动触发**：我把网页链接和要填的字段给你，你自己点 Run，完成后回我"已触发"。
- **AI 用 `gh` 触发**：我直接在终端跑 `gh workflow run`，并用 `gh run watch` 盯进度。

注意：

- `gh` 触发会**真实推送一次发布**（npm publish / ASC 提审），和网页点 Run 等价、不可撤销。**跑命令前必须把完整命令和版本号展示给用户，等用户确认**。
- 选 **D（全套）** 时，A 步骤和 C 步骤各问一次（或开头一次性确认整轮都用同一种方式）。
- 默认仓库为 `origin`（`hitosea/happy-next`），`gh` 命令无需 `-R`。

各步骤里都给了「手动」和「`gh`」两套指令，按用户的选择执行其一即可。

---

## 版本号 bump 规则（A、B 共用）

基于待发布的 commit 类型给出建议，让用户确认或覆盖：

- 只有 `fix(...)` / `chore(...)` / `docs(...)` → 建议 **patch**
- 出现 `feat(...)` → 建议 **minor**
- commit 里带 `BREAKING CHANGE` 或 `!:` → 建议 **major**

---

## 分支 A：仅 CLI

### A1. 确认改动范围

```bash
git log origin/main~5..origin/main --stat -- packages/happy-cli/
```

向用户展示最近几个 commit 涉及的文件，确认是否仅 CLI 改动。如果混入了 App/Server 改动但用户只想发 CLI，**警告用户**——version bump commit 会混入 main，可能让后续 App tag release notes 变乱。

### A2. 本地 typecheck

```bash
cd packages/happy-cli && yarn build
```

失败就停下，不要继续发。

### A3. 决定 version bump 类型

先跑这段脚本，把当前版本和三个候选版本一次性算出来：

```bash
node -e "
const v = require('./packages/happy-cli/package.json').version.split('.').map(Number);
console.log('当前: ' + v.join('.'));
console.log('patch → ' + v[0] + '.' + v[1] + '.' + (v[2]+1));
console.log('minor → ' + v[0] + '.' + (v[1]+1) + '.0');
console.log('major → ' + (v[0]+1) + '.0.0');
"
```

再扫描自上次 CLI 发布以来的 commit 类型，给出建议的 bump 类型：

```bash
LAST_CLI=$(git log --oneline --grep='^release: happy-next-cli' | head -1 | awk '{print $1}')
# 首次发布或找不到历史 CLI release commit 时，回退看最近 30 条 CLI 相关 commit
RANGE="${LAST_CLI:+${LAST_CLI}..HEAD}"
git log ${RANGE:--30} --oneline --no-merges -- packages/happy-cli packages/happy-wire
```

按「版本号 bump 规则」判断建议类型，把"当前版本 / 三个候选 / 建议 bump 类型 / 判断依据"一起展示给用户，让用户确认或覆盖。

### A4. ⏸ 触发 workflow（按「触发方式」小节用户的选择二选一）

**手动触发：**

> 请打开 <https://github.com/hitosea/happy-next/actions/workflows/cli-publish.yml> → 点 **Run workflow** → `Version to publish` 填 `{用户选的版本}` → `Dry run` 保持 `false`（默认） → 点绿色 Run workflow。完成后告诉我"已触发"。
>
> **等用户确认。不要继续。**

**AI 用 `gh` 触发**（先把命令展示给用户、等确认后再跑）：

```bash
gh workflow run cli-publish.yml -f version={用户选的版本} -f dry-run=false
```

字段名照抄：版本是 `version`、关 dry run 是 `dry-run=false`（注意是中划线）。

### A5. 监控 + 收尾

告知用户 workflow 会自动：bump 版本 → 跑测试 → `npm publish` → 提交 `release: happy-next-cli v{X.Y.Z}` 回 main。

若是 `gh` 触发，可直接盯进度：

```bash
gh run watch $(gh run list --workflow=cli-publish.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

等 workflow 成功后（手动方式则等用户确认）：

```bash
git pull origin main   # 拉回 CI 提交的 version bump
node -p "require('./packages/happy-cli/package.json').version"  # 核对新版本号
```

向用户展示新版本号，确认本次发版完成。

---

## 分支 B：App + Docker + Desktop

### B1. 确认上一个 tag + 累积改动

```bash
git tag --sort=-creatordate | grep '^v[0-9]' | head -5    # 最近几个 vX.Y.Z 格式 tag
LAST=$(git tag --sort=-creatordate | grep '^v[0-9]' | head -1)
git log ${LAST}..HEAD --oneline --no-merges
```

向用户展示累积 commit 列表，让用户决定是否值得发版。如果没什么用户可感知的变化，劝退。

如果本次包含桌面发布，再检查 Actions Secret **名称是否存在**（不要读取或打印值）：

```bash
gh secret list --app actions | cut -f1
```

桌面发布必须具备：

- updater：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Developer ID：`APPLE_CERTIFICATE_BASE64`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_KEYCHAIN_PASSWORD`、`APPLE_SIGNING_IDENTITY`
- notarization：`ASC_API_KEY_ID`、`ASC_API_KEY_P8_BASE64`、`ASC_ISSUER_ID`

缺少 Secret 时停在这里，列出缺少的**名称**并让用户配置；不得要求用户把值发到聊天中，也不得把值写入日志。上传或替换 Secret、证书或私钥前必须再次确认。

### B2. 决定新 tag 版本号

先跑这段脚本，把最近的 tag 和三个候选版本一次性算出来：

```bash
LAST=$(git tag --sort=-creatordate | grep '^v[0-9]' | head -1)
node -e "
const v = '$LAST'.replace(/^v/, '').split('.').map(Number);
console.log('当前: $LAST');
console.log('patch → v' + v[0] + '.' + v[1] + '.' + (v[2]+1));
console.log('minor → v' + v[0] + '.' + (v[1]+1) + '.0');
console.log('major → v' + (v[0]+1) + '.0.0');
"
```

再基于 B1 已列出的 commit，按「版本号 bump 规则」判断建议类型，把"当前 tag / 三个候选 / 建议 bump 类型 / 判断依据"一起展示给用户，让用户确认或覆盖。

### B3. 更新 CHANGELOG + README + docs（6 个文件）

| # | 文件 | 方式 |
|---|------|------|
| 1 | `packages/happy-app/CHANGELOG.md` | 手写新版本条目 |
| 2 | `packages/happy-app/sources/changelog/changelog.json` | 运行脚本自动生成 |
| 3 | `README.md` | 合并新功能进已有章节 |
| 4 | `README.zh-CN.md` | 合并新功能进已有章节 |
| 5 | `docs/changes-from-happy.md` | 合并新功能进已有章节 |
| 6 | `docs/changes-from-happy.zh-CN.md` | 合并新功能进已有章节 |

先把 B1 列出的 commit 按功能领域分类，向用户展示分类结果，**等用户确认**后再开始写入。

#### B3.1 编写 CHANGELOG.md

文件：`packages/happy-app/CHANGELOG.md`

先读文件顶部最新的 `## Version N` 条目，连同本轮 commit 一起，**询问用户：新增一个版本条目，还是在最后一个版本上更新内容**。更新模式沿用原 Version 号、日期改今天；新增模式 N+1、插到顶部。

格式要求（参考已有版本风格）：

- 标题：`## Version N - YYYY-MM-DD`（N 是顺序号，不是 tag 名；日期是今天）
- 一句话摘要（英文）
- Bullet points，每条以功能领域开头，简洁描述用户可感知的变化
- 不写技术实现细节，面向用户

先把草稿（新增条目或合并后的完整条目）展示给用户确认，再写入文件。

#### B3.2 生成 changelog.json

```bash
cd packages/happy-app
npx tsx sources/scripts/parseChangelog.ts
```

自动生成 `packages/happy-app/sources/changelog/changelog.json`。核对 `latestVersion` 已更新。

#### B3.3 更新 README（中英文）

文件：`README.md` + `README.zh-CN.md`

**关键原则**：这两个文件展示的是「Happy Next 相比 Happy 的完整功能」，**不按版本分**。

- 将新功能合并进已有章节（如 DooTask 新功能并入「DooTask Integration」章节）
- 全新功能领域加为新的独立章节（不加版本标签）
- 同步更新 "Why Happy Next" 亮点列表（带 emoji 的那段）
- 中英文内容保持一致

#### B3.4 更新 changes-from-happy 文档（中英文）

文件：`docs/changes-from-happy.md` + `docs/changes-from-happy.zh-CN.md`

**关键原则**：同样**不按版本分**，是 Happy Next 相对 Happy 的完整变更记录。

- 更新顶部 TL;DR 概览表格
- 将新功能合并进已有章节
- 全新功能领域加为独立章节（不加版本标签）
- 更新 bug 修复计数
- 中英文内容保持一致

#### B3 注意事项

- CHANGELOG.md 是唯一按版本记录的文件，其余 4 个 md 文件都是功能总览
- 中英文文档结构和内容必须对齐
- 版本号中提到的依赖版本（如 Codex vX.Y.Z）需确认是最新的

### B4. 提交 changelog 改动并推送

```bash
git add packages/happy-app/CHANGELOG.md packages/happy-app/sources/changelog/changelog.json README.md README.zh-CN.md docs/changes-from-happy.md docs/changes-from-happy.zh-CN.md
git commit -m "docs: changelog for {新版本号}"
git push origin main
```

### B5. 打 tag 并推送

**注意**：下面命令里的 `{版本号}` 是占位符，必须替换成 B2 中用户确认的实际 tag（形如 `v2.1.0`）。**不要**原样执行。

```bash
VERSION={版本号}   # 例如 VERSION=v2.1.0
git tag $VERSION
git push origin $VERSION
```

**推送 tag 会同时触发 `release.yml` 和 `docker-publish.yml` 两条流水线**，无法撤销。推送前再次跟用户确认版本号。

### B6. ⏸ 监控构建

给用户：

> 流水线正在跑：<https://github.com/hitosea/happy-next/actions>
> - `Release`：~45-90 分钟，并行构建 Android APK/AAB、iOS IPA、macOS Universal、Windows x64 和 Windows ARM64，完成后自动创建 GitHub Release
> - `Docker Publish`：~10-20 分钟，推 4 个镜像到 Docker Hub `kuaifan/*`
>
> 完成后告诉我结果，或告诉我某条失败了。

**等用户确认。**

### B7. 校验 Release 页

告知用户检查 <https://github.com/hitosea/happy-next/releases/tag/{新版本号}>：

- 有 APK/AAB/IPA、macOS Universal DMG/ZIP、Windows x64 MSI/NSIS、Windows ARM64 MSI/NSIS
- 有各桌面平台的 updater archive、`.sig`、`latest.json` 和 `SHA256SUMS.txt`
- `latest.json` 包含 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`、`windows-aarch64`
- Release notes 自动生成合理

CI 构建成功只代表产物生成成功，不能写成真机安装或升级验证成功。macOS、Windows x64、Windows ARM64 未在真实设备测试时必须明确标注“未验证”。

### B8. 两版本桌面升级验收（首次接入或 updater 变更时必做）

1. 先发布版本 A，并从 GitHub Release 下载对应架构的正式安装包。
2. 在真实设备安装 A，启动并确认客户端显示版本 A。
3. 再发布更高版本 B；等待客户端后台下载完成。
4. 未登录时确认右下角出现“更新”，已登录时确认设置图标后出现“更新”。
5. 点击“更新”，确认安装、重启并显示版本 B，且登录状态与本地数据保持正常。
6. macOS 至少在 Apple Silicon 真机完成；Intel、Windows x64、Windows ARM64 分别记录结果，缺少设备就标注“未验证”。
7. 不要删除、覆盖或重建已发布的 Release 来伪造升级测试；若 A/B 任何一个构建失败，使用新的更高版本修复。

---

## 分支 C：仅 iOS App Store

前提：对应 tag 的 `release.yml` 已跑完，IPA 已在 GitHub Release 里（若刚走完分支 B，等其 `Release` 流水线跑完即可）。

### C1. ⏸ 触发（按「触发方式」小节用户的选择二选一）

**手动触发：**

> 请打开 <https://github.com/hitosea/happy-next/actions/workflows/release.yml> → **Run workflow** → `version` 填要提审的版本号（不带 `v` 前缀，如 `2.0.4`） → Run。完成后告诉我"已触发"。
>
> **等用户确认。**

**AI 用 `gh` 触发**（先把命令和版本号展示给用户、等确认后再跑）：

```bash
gh workflow run release.yml -f version={提审版本号，不带 v}
gh run watch $(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

该触发只跑 `submit-ios` 任务（tag-push 才跑的 build 任务会因 `if` 跳过）：重新本地构建 IPA → 通过 ASC API 提审。

---

## 分支 D：全套（A + B + C）

**顺序敏感**——必须按 A → B → C，不能并行：

1. 走完**分支 A**全部步骤（CLI 发布 + A5 的 `git pull` 拿到 CI 推回的版本号 commit）
2. 走完**分支 B**（更新 changelog → commit → 打 tag → 推送，触发手机 App + Docker + Desktop 发布）
3. 等 B 的 `Release` 流水线跑完、IPA 已在 Release 页后，走**分支 C**（用 B 刚推的版本号提审 iOS）

为什么这个顺序：

- A 先于 B —— 否则 CLI 的 version bump commit 不在 App tag 里，用户在 App 看到的 release notes 会缺这条。
- C 在 B 之后 —— iOS 提审需要对应 tag 已存在；提审版本号用 B2 里确认的 tag（去掉 `v`）。

触发方式：A 步和 C 步都是手动 `workflow_dispatch`，按「触发方式」小节用户的选择执行（建议开头一次性问清整轮用手动还是 `gh`）。

---

## 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| `cli-publish.yml` 报 `npm whoami` 失败 | `NPM_TOKEN` secret 过期 | 让用户到仓库 Settings → Secrets 更新 |
| Tag 已推但 Release 页没出现 | iOS/Android 构建失败，`needs` 卡住 | 看 Actions 日志，修复后 delete + retag |
| Docker 镜像没推成功 | Docker Hub token 过期 | `DOCKERHUB_TOKEN` secret 更新 |
| `git push origin v2.0.4` 失败：already exists | 该版本号已用过 | 确认是误操作还是版本冲突；选新号或 `git push origin :refs/tags/v2.0.4` 先删再推（慎用，若已触发过 workflow 会重复发布） |

## 不要做的事

- 不要手动改 `packages/happy-cli/package.json` 的 version——`cli-publish.yml` 会自动 bump
- 不要手动改 `app.config.js` 里的 `version` 默认值——它读的是 `APP_VERSION` 环境变量（从 tag 名注入）
- 不要在 tag 已推送后再去改那个 commit——tag 指针会不匹配
