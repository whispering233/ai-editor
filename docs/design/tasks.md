# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### U4 写作页：右侧详情收起

状态：待办

- 契约：`docs/ui/DESIGN.md` `writing-page`「工作台 rail 头」「宽度与收起」。
- `packages/client/src/hooks/use-writing-rail.ts`：布局改 `{ width, collapsed, detailCollapsed }`，默认 `detailCollapsed: false`，解析只认 `=== true`，新增 `toggleDetail`，沿用既有 localStorage key；补/改 hook 单测。
- `packages/client/src/components/writing/chapter-rail.tsx`：新增 `detailCollapsed?` / `onToggleDetail?`，在 `PanelHeader` 的 actions 最右端渲染（仅传了 `onToggleDetail` 时）：展开态 `LeftOutlined`、收起态 `RightOutlined`，`aria-label="收起右侧详情" / "展开右侧详情"`，`aria-expanded`。
- `packages/client/src/pages/Writing.tsx`：`detailHidden = isDesktop && !layout.collapsed && layout.detailCollapsed`；隐藏时 rail 全宽（`width` 不传、`w-full border-r-0`）、不渲染 `ResizeHandle`、不渲染正文列（`bodyContent` 随列卸载，自动保存 flush 保持原样）；不自动展开；给 `ChapterRail` 传详情钮（桌面且 rail 未收起时）。
- 非目标：不动大纲 / 设定；不新增 dirty 守卫（写作页自动保存）。
- 测试：hook 单测 + `writing.test.tsx`（点按钮后正文列消失、rail 全宽；再点恢复；窄屏无按钮）。
- 完成判据（硬）：`pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿；`git log --oneline -1` 为本卡 commit；`git status --short` 为空；汇报附 commit hash 与命令输出末尾。

### U5 大纲页：右侧详情收起（含未保存守卫）

状态：待办

- 契约：`docs/ui/DESIGN.md` `outline-page`「工作台 rail 头」「宽度与收起」。
- `packages/client/src/hooks/use-outline-rail.ts`：布局改 `{ width, collapsed, detailCollapsed }`，默认 `detailCollapsed: false`，解析只认 `=== true`，新增 `toggleDetail`；补/改 hook 单测。
- `packages/client/src/pages/Outline.tsx`：`detailHidden`；`toggleDetailWithGuard`（展开直接切；收起先 `confirmDiscard()`，取消则不动）；隐藏时 rail 全宽、无手柄、不渲染详情列、不自动展开；给 rail 传 `detailCollapsed` / `onToggleDetail`（桌面且 rail 未收起时）；rail 的详情钮排在 `[清除推演][全部折叠/展开][+新建卷]` 之后的最右端。
- 非目标：不动写作 / 设定；复用既有 `detailDirty` / `confirmDiscard`，不新造守卫。
- 测试：hook 单测 + `outline.test.tsx`（点按钮隐藏详情列；dirty 时取消保留、确认收起；空态下可收起）。
- 完成判据（硬）：`pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿；`git log --oneline -1` 为本卡 commit；`git status --short` 为空；汇报附 commit hash 与命令输出末尾。
