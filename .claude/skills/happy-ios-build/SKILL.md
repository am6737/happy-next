---
name: happy-ios-build
description: Builds a happy-app iOS IPA on the Mac mini and drops it into appdown for OTA install — 正式版 (production, Ad Hoc, receives production push) or 开发版 (HappyNextdev Debug dev client). Pushes the current commit to origin/dev first. Use when the user asks to build/package an iOS 正式版 or 开发版 for testing on their phone.
---

# happy-app iOS 测试包构建

在 Mac mini 上把 happy-app 打成 IPA，放进 `~/wwwroot/appdown/builds/`，用户在 https://8083-weiyi.dootask.com/ 扫码安装。

| 模式 | 用户说法 | 产物 | 签名 / 推送 |
|---|---|---|---|
| `prod` | 正式版、生产版、能收推送的 | `HappyNext-<版本>-<构建号>-<sha>-<标签>-<时间>.ipa`，`com.hitosea.happy`，不含 Watch App | EAS 上现有的 Ad Hoc 证书，主 App 和分享扩展各一个描述文件，`aps-environment=production`，只能装在 Ad Hoc 描述文件里的设备上 |
| `dev` | 开发版、调试版、dev client | `HappyNextdev-<版本>-<sha>-<标签>-<时间>.ipa`，`com.hitosea.happy.dev`，Debug 开发客户端，打开后要连 Metro，不含 Watch App | Apple Development 证书 + 团队描述文件 `com.hitosea.happy.dev` 和 `com.hitosea.happy.dev.share-extension`，`aps-environment=development` |

真正的构建由仓库里的脚本完成，它们在 Mac mini 上运行：

- `scripts/build-prod.sh [标签]`：正式版。从 EAS 拉 production 环境变量和 Ad Hoc 凭证，生产 prebuild，archive，导出，校验，发布。不管成功还是失败，都会还原开发用的 iOS 工程、Watch target、`eas.json`，并删除临时凭证、钥匙串和描述文件。
- `scripts/build-dev.sh [标签]`：开发版。按需执行 yarn install、prebuild、pod install，然后不签名做 Debug 构建，再手动签名、打成 IPA 并发布。
- 两个脚本最后都会输出 `RESULT_*=` 行，汇报就以这些行为准。两个脚本共用一把锁，同时只能跑一个。

调用本技能，就等于授权执行下面「流程」里的全部操作，包括把 HEAD 推送到 origin/dev。流程之外的操作要单独确认。

## 流程

### 1. 确定模式和标签

- 模式：用户说了正式版或开发版就照着来；没说清楚就用 AskUserQuestion 问，给出「正式版」「开发版」两个选项。
- 标签：用 2–3 个英文词概括这次要测的内容（例如 `stagebar`、`chat-scroll`），会出现在文件名里。用户给了就用用户的。

### 2. 本地推送到 origin/dev

```bash
git status --porcelain --untracked-files=no
git push origin HEAD:dev
```

- 有未提交的已跟踪改动：停下来问用户，选项为「先提交再构建」和「只构建已提交的部分」。不要自己决定提交。
- push 被拒（origin/dev 有 HEAD 里没有的提交）：停下来，把 `git log --oneline HEAD..origin/dev` 给用户看，问怎么处理。不要 force push。
- 记下 `git rev-parse HEAD`，第 3 步要用它核对。

### 3. Mac mini 拉到这个提交

先用 `orchestrator_get_context` 找到名为 `Mac mini` 的机器（要求 `shellReady: true`），再用 `orchestrator_exec` 执行：

```bash
cd ~/wwwroot/happy-next && git fetch -q origin \
&& if [ -n "$(git status --porcelain --untracked-files=no)" ]; then git stash push -q -m "happy-ios-build autostash $(date +%Y%m%d-%H%M%S)" && echo STASHED; fi \
&& { git switch -q dev 2>/dev/null || git switch -q -c dev --track origin/dev; } \
&& git merge -q --ff-only origin/dev && git rev-parse HEAD
```

- 输出的 HEAD 必须等于本地 HEAD，否则停下。
- Mac mini 上的未提交改动只能 stash，不能 checkout 或 reset 丢掉。这些改动通常是之前用 transfer 传过去的文件。出现 STASHED 时要在汇报里说明。
- `--ff-only` 失败说明 Mac mini 本地的 dev 有额外提交。停下来，把情况告诉用户。

### 4. 运行构建

```
orchestrator_exec  machineIds=[Mac mini]  workingDirectory=~/wwwroot/happy-next
command: bash .claude/skills/happy-ios-build/scripts/build-prod.sh <标签>    # 正式版，约 15–20 分钟
command: bash .claude/skills/happy-ios-build/scripts/build-dev.sh <标签>     # 开发版，增量构建几分钟，需要 prebuild 时更久
waitMs=0
```

调用后先告诉用户已经开始构建、大约要多久，然后等 `<orchestrator-callback>`，再调用一次 `orchestrator_pend`（`include="all_tasks"`，`timeoutMs=0`）取结果。输出太长时，结果里会给出保存路径，用 `grep -n RESULT_` 或 `tail -n 60` 读。

### 5. 汇报

用中文汇报，以 `RESULT_*` 行为准：

- 文件名、大小、版本（构建号）、对应提交，以及下载页 `RESULT_PAGE` 是否列出了它。
- 正式版：推送环境是否为 production，DooPush 配置是否和 EAS 一致，两个描述文件（`RESULT_PROFILE`、`RESULT_EXT_PROFILE`）的有效期，能装的设备（`RESULT_DEVICES`），不含 Watch App，`RESULT_REPO` 和 `RESULT_DEV_PROJECT` 是否都已还原。
- 开发版：说明它是 Debug 开发客户端，打开后要连 Metro；分享扩展的描述文件见 `RESULT_EXT_PROFILE`。
- 如果第 3 步做了 stash，告诉用户 stash 的名字。

失败时：把脚本输出的 `ERROR:` 和其上方的报错原样给用户，对照下面的「坑」判断原因。正式版脚本已经自动还原了 Mac mini 的状态，汇报 `RESULT_REPO` 和 `RESULT_DEV_PROJECT` 即可。不要盲目重试；需要改脚本时，先改仓库里的脚本，再走一遍第 2–4 步。

## 禁止

- 不运行 `release-production.sh`、`eas build`、`eas submit`：它们会走 EAS 云端，或者提交到 App Store。
- 不新建、不吊销任何证书或描述文件。`eas credentials` 只用于下载。
- 不对 origin/dev 做 force push；不在 Mac mini 上用 checkout、reset 或 clean 丢弃改动。
- 不删除 `~/wwwroot/appdown/builds/` 里的旧包。

## 坑（脚本已处理，排错时对照）

1. **Watch target 没有 Ad Hoc 凭证。** EAS 会报 `Some of the build targets don't have credentials ... HappyWatch`。必须在 `eas credentials` 之前把 `targets/watch*` 移出去，因此正式版不含 Watch App。开发版 prebuild 后 `.app` 里会带 `Watch/HappyWatch.app`，其中的 Widget 扩展（`com.hitosea.happy.dev.watchkitapp.widget`）没有描述文件，所以脚本签名前会删掉 `Watch/`，开发版也不含 Watch App。
2. **`eas credentials` 没有非交互的下载方式**（eas-cli 18.x）。只能用 `eas-creds.exp` 模拟按键选菜单：先按 `ARROWS` 次下箭头选中临时 profile（这个 profile 追加在 `eas.json` 的最后），再按 3 次下箭头选「credentials.json」，然后选「Download」。脚本会检查文件是否真的写到了磁盘上。EAS 菜单变了就调整这个 exp。
3. **Expo 生成的 `Info.plist` 把 `CFBundleVersion` 写死成 1**，`CURRENT_PROJECT_VERSION` 改不动它，必须在 archive 之前用 `plutil` 改。构建号取三者最大值再加 1：EAS 远端值、builds 目录里最大的本地包号、`~/.happy-ios-build/prod-build-number`。
4. **Mac mini 只有已经过期的 WWDR G1**，分发证书是 G3 签发的，所以要把 G3 导入临时钥匙串，否则会出现「0 valid identities」。
5. **钥匙串搜索列表要写死路径**（login、临时钥匙串、System），不要解析 `security list-keychains` 的输出。还原时要先恢复搜索列表，再删除钥匙串。
6. **生产环境变量要在 prebuild 和 archive 时各 source 一次。** `EXPO_PUBLIC_*` 是在 archive 的打包 JS 阶段才内联进去的。`APP_ENV=production` 不在 prod.env 里，要单独 export。`CI=1` 用来避免 prebuild 停下来问问题。
7. **正式版流程中不要跑 `yarn install`**，它会清掉 `react-native-audio-api` 的 iOS 预编译库（之后要靠 pod install 重新下载）。开发版只在 `yarn.lock` 变化时跑一次 yarn install，并且之后一定会跑 pod install。
8. **`eas env:pull` 拿不到两个仅 Android 用的 secret 文件变量**（HMS / Honor）。这对 iOS 没有影响。
9. **appdown 的路由使用去掉 `.ipa` 的文件名**：`/b/<名字>/manifest.plist`。
10. **exportArchive 日志里的 `missing Xcode-Username` 警告无害**，以退出码为准。
11. **全局 `eas` 在 `/usr/local/bin/eas`**，`npx eas` 找不到它。
12. **`ios/` 不受 git 跟踪。** `git status` 干净不代表开发工程已经还原，所以脚本会单独检查 `ios/HappyNextdev.xcworkspace` 是否存在。
13. **开发版什么时候重新 prebuild：** `ios/` 不存在、没有上次的构建记录（`~/.happy-ios-build/dev-commit`），或者从上次构建到现在改动了 `yarn.lock`、`patches/`、`packages/happy-app/{package.json,app.config.js,plugins,modules,targets,patches}` 中的任何一个。Debug 构建的中间产物缓存在 `/tmp/hn-dd`，用来做增量构建。
14. **设备范围：** 正式版的 Ad Hoc 描述文件只包含 `00008130-001E38501406001C` 和 `00008101-000C686902BA001E` 两台设备，iPad 装不了。开发版的团队描述文件包含全部已注册设备。
15. **分享扩展（expo-share-intent 生成的 `ShareExtension` target）要单独签名。** 它在 `PlugIns/ShareExtension.appex`，bundle id 是 `<主 App>.share-extension`，和主 App 一样带 App Group `group.<主 App>`，靠它把分享的内容交给 App。所以：
    - 两个描述文件都必须带这个 App Group，脚本会检查，缺了就停下。
    - 正式版：EAS 上要有扩展的 Ad Hoc 凭证。此时 `credentials.json` 每个 target 各占一项，由 `adhoc-creds.py` 按描述文件里的 bundle id 认出来；两个描述文件的设备列表必须一致。描述文件不能放在 xcodebuild 命令行上（会同时套到两个 target 上），由 `set-profiles.py` 写进各 target 的 build settings。扩展的 `CFBundleVersion` 必须和主 App 一致，脚本会校验。
    - 开发版：扩展用 Xcode 团队描述文件 `iOS Team Provisioning Profile: com.hitosea.happy.dev.share-extension`，在 Xcode 里给 ShareExtension target 签一次名就会生成。签名时由内向外：先签扩展里的代码和扩展，再签 App。`PlugIns/` 里出现别的扩展时脚本会停下。
    - 这些凭证和描述文件由用户自己创建，本技能不创建（见「禁止」）。
16. **开发版 `.app` 顶层的 `HappyNextdev.debug.dylib` / `__preview.dylib` 也要签名。** Debug 构建把 App 自己的代码放在这里；`codesign --verify --deep` 不检查它们，所以校验能过，但 dyld 拒绝加载未签名的库，App 一打开就退出（`Library not loaded ... missing code signature`），而且不会留下崩溃报告。

## 状态文件（Mac mini）

`~/.happy-ios-build/` 下保存这些文件：`lock`（构建锁）、`prod-build-number`、`dev-commit`、`yarn.lock.sha`。每次构建的日志放在 `RESULT_LOGS` 指向的目录里。
