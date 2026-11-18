# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### U1 — 大纲树章行标签预览

契约见 `docs/ui/DESIGN.md` `outline-page`「章行标签预览」/ `data-row` / `tag`（已更新）。

#### 范围
- 新建 `packages/client/src/lib/outline-tags.ts`：
  - `outlineTagsFromData(data: unknown): string[]`——`data.tags` 非数组 → `[]`；数组内只留非空字符串（`typeof t === "string" && t !== ""`）；不 trim、不改写、不去重（与现有 `outline-canvas-layout.ts` 的 `tagList` 同口径）。
  - `OUTLINE_TAG_PREVIEW_LIMIT = 2`（行内预览条数唯一来源）。
  - `previewOutlineTags(tags: readonly string[]): { visible: string[]; overflow: number }`——`visible = tags.slice(0, LIMIT)`，`overflow = tags.length - visible.length`。
- `packages/client/src/lib/outline-canvas-layout.ts`：删私有 `tagList`，`tags` 改用 `outlineTagsFromData(data)`（视觉零变化）。
- `packages/client/src/lib/outline-detail.ts`：`chapterTagPool` 内联的 tags 取数改用 `outlineTagsFromData(node.data)`（行为不变）。
- `packages/client/src/components/outline-canvas/ChapterCard.tsx`：`slice(0, 2)` / 减法改用 `previewOutlineTags(card.tags)`（视觉零变化）。
- `packages/client/src/pages/Outline.tsx`：章行（`node.type === "chapter"`）在摘要后渲染标签行：
  - 缩进复用现有占位链：`-ml-2 w-6 shrink-0` + 编号徽标占位（`numberLabel !== undefined ? "min-w-14" : "w-7"`，与摘要行一致）；
  - 每个标签 = `#tag` 的 tinted 文本（`tagTintClass` + `min-w-0 truncate rounded-sm px-1 text-xs`），`title` = 完整标签名；
  - 最多 `OUTLINE_TAG_PREVIEW_LIMIT` 个；超出显示 `+N`（`shrink-0 text-xs text-muted-foreground`），`title` = 全部标签 `#a #b #c`；
  - 无标签 / 非章 → 不渲染该行；不改第一行、行尾操作、拖拽、编辑、选中逻辑。
- 测试：
  - 新建 `packages/client/src/lib/outline-tags.test.ts`：`outlineTagsFromData` 的 undefined / 非数组 / 混杂类型 / 空串；`previewOutlineTags` 0/1/2/3/5 个。
  - `packages/client/src/pages/outline.test.tsx` SSR：章 1 个标签可见；章 3 个标签 = 前 2 个 + `+1`，`+1` 的 `title` 含全部 3 个；无标签章不出现标签行；场景带标签不显示；卷行不显示。
- **不做**：筛选、显示开关、状态 / 叙事功能 / 张力度、场景标签、树内编辑、画布改动。

#### 完成判据
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 浏览器实测（ui-verifier）：rail 280 / 320 / 600px 三档；0 / 1 / 2 / 5 个标签；24 字长标签截断且 `title` 完整；场景带标签不显示；浅 / 深色；点标签进详情；从标签处起拖仍能拖行。
- 硬判据：`git log -1` 有新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。
