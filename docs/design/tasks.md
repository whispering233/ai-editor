# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

## 卡 7：详情页头「写正文」未保存守卫

**问题**：详情表单 dirty 时，「写正文」用普通 `<a href="#/writing/:id">` 直接离开，未保存修改静默丢失。

**目标**：点击「写正文」先走壳的 `confirmDiscard()`；取消留在详情且表单不丢；确认再 `navigate('/writing/:id')`。浏览器后退不处理（backlog 保留）。

**实现**：
- `packages/client/src/pages/OutlineDetail.tsx`：新增可选 `onNavigate?: (path: string) => void | Promise<void>`；「写正文」按钮 `onClick` `preventDefault()` 后调用 `onNavigate(`/writing/${node.id}`)`；无回调时保留 `href` fallback。
- `packages/client/src/pages/Outline.tsx`：传 `onNavigate={async (path) => { if (await confirmDiscard()) navigate(path); }}`。
- `packages/client/src/pages/outline.test.tsx`：dirty 点写正文 → 取消留在详情且输入保留；确认 → 到写作页；干净 → 直接走。
- `docs/ui/DESIGN.md`、`docs/design/backlog.md` 已按「写正文走同一确认、浏览器后退不拦」收窄；`CHANGELOG.md` 的 `Unreleased` 加 `### Fixed` 一条。

**允许改动的文件**：`packages/client/src/pages/OutlineDetail.tsx`、`packages/client/src/pages/Outline.tsx`、`packages/client/src/pages/outline.test.tsx`、`docs/ui/DESIGN.md`、`docs/design/backlog.md`、`CHANGELOG.md`。

**硬完成判据**：
- `pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering2333/ai-editor-client test` 全绿；
- `git status --porcelain` 空；
- 必须产生新 commit（汇报附 hash 与命令输出）；
- 独立 code reviewer 通过；ui-verifier 用真实浏览器验证 dirty 点写正文（取消 / 确认 / 干净三条）通过后清卡。

**顺序**：先卡 6，后卡 7；卡内不做另一卡或写作页的顺手改动。
