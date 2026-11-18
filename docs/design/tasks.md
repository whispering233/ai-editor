# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡
### K3 — 画布筛选（状态 + 剧情线标签）

契约见 `DESIGN.md` `outline-canvas`「筛选」。

#### 范围
- 新建 `packages/client/src/lib/outline-canvas-filter.ts`：`CanvasFilter = { statuses: string[]; tags: string[] }`（空数组 = 不限制）；`matchCanvasChapterFilter(card, filter)`（状态 OR、标签 OR、跨维度 AND；`draft` 命中缺省状态）；`canvasTagOptions(cards)`（去重 + 使用次数降序）；`isCanvasFilterActive(filter)`。
- `packages/client/src/pages/OutlineCanvas.tsx`：左上角一个竖向容器 = 筛选按钮（激活时主色描边 + 小圆点）+ Popover（状态三复选框 / 标签多选 / 清除）+ 现有 `Controls`；未命中卡 `opacity: .25`（`data-filtered="true"` + CSS）、端点被筛掉的边不渲染；空结果提示「没有符合条件的章节」。`Controls` 内 Panel 的 `margin` 在 `canvas-theme.css` 归零（嵌套不双层留白）。
- 测试：`matchCanvasChapterFilter` 的 AND / OR / 空筛 / 缺省状态矩阵；`canvasTagOptions` 排序；`isCanvasFilterActive`。
- **不做**：筛选持久化（不写 `localStorage`、不进 URL）、标签管理页（backlog）。

#### 完成判据
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 浏览器实测（24 章验收书）：勾「定稿」只剩命中卡可见（其余淡出）、勾两个标签为 OR、状态 + 标签叠加为 AND、端点被筛掉的连线消失、清除恢复、刷新后筛选清空。
- 硬判据：`git log -1` 有新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。
