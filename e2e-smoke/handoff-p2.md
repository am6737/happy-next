handoff p2 e2e

# P2 E2E smoke：交接与审查打回循环

本流程验证 [issue #29](https://github.com/am6737/happy-next/issues/29) 从
Builder 交接 draft PR 到指定 Reviewer，再经历打回、修订、复审、通过。
全程使用同一个 PR；首轮提交刻意不包含最终修订标记。

## 前置条件

- 仓库为 `am6737/happy-next`，目标分支为 `main`。
- Builder 为 `@builder`，指定审查人为 `@reviewer`；负责人确认两者能接收任务。
- Builder 的 worker 有 GitHub 访问权限，工作树干净，能提交并推送当前任务分支。
- 已阅读根目录及相关目录的 `AGENTS.md`、`CLAUDE.md`、`.claude/rules`、
  `CONTRIBUTING.md` 和 README；本任务只新增 `e2e-smoke/handoff-p2.md`。
- 首行必须严格等于 `handoff p2 e2e`，不能改成 Markdown 标题。
- GitHub 评论和 PR 描述必须以执行者的 Happy Agent 身份签名结尾。
  Builder 使用精确签名：`— 🤖 Builder (Happy Agent)`。

## 责任人与证据

| 责任人 | 职责 | 必须保留的证据 |
| --- | --- | --- |
| Lead / 负责人 | 确认任务范围、指定 Reviewer、处理阻塞、决定合并 | issue URL、任务状态、最终 PR URL |
| Builder / `@builder` | 认领、委派 worker、复核 diff 和检查、交接及修订 | worker 会话、commit SHA、检查命令与结果、同一个 draft PR |
| Reviewer / `@reviewer` | 首轮打回、复审修订后的提交、给出结论 | 每轮关联的 SHA、`changes_requested` / `approved`、原因 |

证据放在任务记录和 PR 中，保留可点击链接及退出码。截图和日志应去除令牌、
凭据和私有内容；不要用口头“已通过”代替检查结果或审查记录。

## Smoke 步骤

1. **认领并交接实现（Builder）**：在任务线程用 `task_comment` 认领 issue，
   用 `work_session_start`、`work_session_send` 将仓库、分支、文件路径、首行、
   签名及两轮审查要求交给 worker。用 `work_session_list`、`work_session_read`
   读取结果；GitHub 写入由 worker 执行。

2. **尽早开 draft PR（worker）**：写入本流程，首轮暂不追加最终标记。
   只提交此文件，以 `docs: add handoff p2 E2E smoke document` 为标题，
   PR 描述沿用仓库的 Summary / Changes / Testing / Related issues 格式，
   包含 `Closes #29`，并以 Builder 精确签名结尾。记录 PR URL 与首轮 SHA。

3. **检查并交接审查（Builder）**：复核 diff、首行、范围和文档检查结果。
   仓库当前没有针对该目录的 Markdown lint 或文档 CI；执行下一节的检查，
   将未运行或不适用的检查写明。适用 CI 若失败，先修复再请求审查。
   用 `task_update(status='in_review', prUrl=PR_URL)` 交接。
   服务器会路由给指定 `@reviewer`，无需另外创建审查任务。

4. **首轮打回（Reviewer）**：审查首轮 SHA，确认文件末尾尚无最终标记，
   给出 `changes_requested`，理由明确为“文件末尾还需要追加一行
   `round 2 fixed`”。记录 review / 任务结论链接和被审查的 SHA。
   此轮打回是预期 smoke 结果，不能直接跳到通过。

5. **修订同一 PR（Builder）**：收到打回后读取具体反馈，让 worker 在文件末尾
   追加一行 `round 2 fixed`，保持首行不变。提交修订并推送到原 PR 分支，
   重新运行文档检查，记录新 SHA、结果及首轮反馈链接。
   用 `task_comment` 说明修订，再次设置 `task_update(status='in_review')`。

6. **复审（Reviewer）**：审查新 SHA，确认最后一行严格等于 `round 2 fixed`，
   首行仍正确，修订没有引入其他文件或依赖，检查通过后给出 `approved`。
   若仍有阻塞点，再给出 `changes_requested`，重复步骤 5–6，保留每轮证据。

7. **最终交接（Builder）**：报告原 draft PR URL、改动文件、验证结果和两轮
   审查证据。明确告知负责人 PR 可供合并；由负责人决定合并，Agent 不合并。

## 文档检查

从仓库根目录执行；lint 工具通过 `npx` 临时运行，不写入依赖或 lockfile。
因 issue 要求首行是普通文本，仅对此文件关闭 MD041（首行标题规则）。

```bash
cat > /tmp/handoff.markdownlint-cli2.jsonc <<'EOF'
{
  "config": {
    "MD041": false,
    "MD013": false
  }
}
EOF
npx --yes markdownlint-cli2@0.18.1 --config /tmp/handoff.markdownlint-cli2.jsonc e2e-smoke/handoff-p2.md
git diff --check origin/main...HEAD
test "$(head -n 1 e2e-smoke/handoff-p2.md)" = 'handoff p2 e2e'
test "$(git diff --name-only origin/main...HEAD)" = 'e2e-smoke/handoff-p2.md'
```

所有命令应退出 0；最后一条断言确保只变更本文件。首轮记录最终标记缺失，
修订后额外执行以下断言，必须退出 0：

```bash
test "$(tail -n 1 e2e-smoke/handoff-p2.md)" = 'round 2 fixed'
```

## 验收标准

- 文件路径、首行及最终末行严格符合 issue，变更仅涉及本文件。
- 同一个 draft PR 关联 #29，Builder 的描述和评论以精确签名结尾。
- 证据按时间顺序覆盖：首轮 SHA → `changes_requested` → 修订 SHA → `approved`。
- 复审结论针对最新提交；检查结果包含命令、退出码和适用 CI 状态。
- `approved` 后已交接负责人，PR 保持 draft，未由 Agent 合并。

## 失败处理

- **worker 失败或失联**：读取会话输出，记录失败原因；恢复同一工作分支，
  避免丢失已有 diff。需要停止时使用 `work_session_stop`。
- **推送、权限或检查失败**：保留命令、退出码和错误摘要，修复后重跑。
  CI 因服务故障未启动时记为阻塞，不标记为通过。
- **审查未路由**：核对指定 Reviewer、任务的 `in_review` 状态与 PR URL；
  由负责人排查服务器路由，不重复创建已有审查任务，也不由 Builder 自批。
- **首轮误通过或提前出现最终标记**：本次循环不满足验收。记录偏差并请负责人
  决定是否重新执行首轮；不能伪造或补写过去的打回结论。
- **复审再次打回**：逐项修订、重跑检查并重新交接同一 PR，直到最新提交通过。
  达到系统审查轮数上限时停止推进，请负责人选择继续修订或调整范围。
- **报告缺少证据**：补齐 SHA、链接和检查结果后再交接，不把“已推送”当作通过。

round 2 fixed
