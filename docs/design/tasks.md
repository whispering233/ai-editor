# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡
### K0 — 抽出共享 `TagsEditor`（纯重构，零行为变化）

契约见 `DESIGN.md` `outline-page`（章标签编辑复用实体页的标签编辑器）。当前 `TagsEditor` 在 `pages/EntityDetail.tsx:65` 与 `components/character/character-detail.tsx:83` 各有一份（后者无 `suggestions` / `quickTags`）。

#### 范围
- 新建 `packages/client/src/components/ui/tags-editor.tsx`：取 `EntityDetail` 版超集（`values` / `onChange` / `placeholder?` / `suggestions?` / `quickTags?`），继续消费 `lib/tags-editor.ts` 的 `enterBehavior` / `moveArrayItem`。
- 迁移 `EntityDetail.tsx`、`character-detail.tsx` 两处调用点，删本地副本；不改 props 行为、不改样式类。
- **不做**：章详情接入（K1）。

#### 完成判据
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿（既有实体页 / 人物页标签测试不改也应绿）。
- 浏览器抽查一处标签新增 / 删除 / 拖拽排序行为不变。
- 硬判据：`git log -1` 出现本卡新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。

### K1 — 章字段 schema + 详情页编辑（状态 / 剧情线标签 / 叙事功能 / 张力度）

契约见 `docs/design/10-data-model.md` §8、`docs/api/60-api-outline.md`（节点 `data`）、`DESIGN.md` `outline-page`「章的结构化信息」。

#### 范围
- `packages/shared/src/types/api.ts`：`nodeTagsSchema`（`z.array(z.string().trim().min(1).max(24)).max(5)`）；`chapterDataSchema` 增 `tags` / `status` / `function` / `tension`（均可选）；`sceneDataSchema` 增 `tags`（仅开 schema）。枚举值来自新常量，不手抄字面量。
- 新建 `packages/shared/src/constants/outline.ts`：`OUTLINE_STATUS` / `CHAPTER_FUNCTIONS` / `CHAPTER_TENSIONS` + 中文标签表（`Record<Value, string>`），从 shared index 导出。
- `packages/client/src/lib/outline-detail.ts`：`NodeFieldControl` 增 `"select"` / `"tags"`；章字段表变 6 项（状态 → 剧情线标签 → 叙事功能 → 张力度 → 章末反转 → 章高潮场景），`select` 复用 `options` / `optionsLabels`；新增 `chapterTagPool(tree)`（遍历全书章 + 场景标签 → 去重 + 按使用次数降序 + 同频按字典序）。
- `packages/client/src/pages/OutlineDetail.tsx`：`select` 用 antd `Select`、`tags` 用共享 `TagsEditor`（候选 = `chapterTagPool`）；**默认状态归一**：diff 前把 baseline 缺失的 `status` 视为 `"draft"`（否则默认值一进表单就永久 dirty）；清空标签提交 `[]`（`diffData` 把 `[]` 与缺失都规约为 null，只有显式 `[]` 才真正清除）。
- 测试：shared schema（接受 / 拒绝超 5 个 / 超长 / 非法枚举）；`detailFieldsForNodeType("chapter")` 顺序与控件类型；`chapterTagPool` 排序；`isOutlineDetailDirty` 在 status 缺省且表单为 `draft` 时为 false。
- **不做**：场景标签表单（K3 之后单独排），画布呈现（K2）。

#### 完成判据
- `pnpm -r build` → `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 浏览器实测（大纲页章详情）：四个控件渲染、选状态 / 加两个标签 / 选功能与张力 → 保存 → 刷新仍在；底座回显正确；清标签保存后 `outline.json` 里 `data.tags` 为空数组。
- 硬判据：`git log -1` 有新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。

### K2 — 画布卡面第三行（状态 + 剧情线标签）

契约见 `DESIGN.md` `outline-canvas`「节点 = 章」第③行。

#### 范围
- `packages/client/src/lib/outline-canvas-layout.ts`：`CanvasChapterCard` 增 `tags: string[]` / `status?` / `function?` / `tension?`（`node.data` 是 `Record<string, unknown>`，加窄化 helper，非法枚举按未设置处理）；删卡片上的 `textLength` / `updatedAt` 依赖（字数 / 更新时间**保留**在 `metadata` 里，卡片不再读）。
- `packages/client/src/components/outline-canvas/ChapterCard.tsx`：第③行 = 状态（仅非草稿：`修正中` / `定稿`，全部走 token 类）+ 标签（`#tag`，≤ 2 个，超出 `+N`；色相复用 `tagTintClass`）；`第N卷` / `N 场` 移入 `title`；状态与标签皆空 → 第③行不渲染；`data-lod` 保持（compact 隐藏第③行、far 只留章号）。
- 测试：`outline-canvas-layout.test.ts` 整卡断言更新；卡片 `renderToString` 断言（非草稿状态可见、草稿不可见、3 个标签出 `+1`、全空不出第③行）。
- **不做**：筛选（K3）。

#### 完成判据
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 浏览器实测（24 章验收书）：给第 1 章加两个标签 + 定稿，第 2 章留空；截图确认第 1 章第三行出现状态与标签、第 2 章不出现空行，`title` 提示含卷号与场数。
- 硬判据：`git log -1` 有新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。

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
