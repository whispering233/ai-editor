# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### U1 写作页：新增 `PanelHeader`，卷章栏 + 正文页头统一

状态：待办

- 契约：`docs/ui/DESIGN.md` §Layout「工作台子栏页头（panel-header）」「panel-header 操作口径」，以及 `writing-page` 的「工作台 rail 头」「宽度与收起」两条。
- 新建 `packages/client/src/components/ui/panel-header.tsx`：
  - `{ title, leading?, actions?, meta?, className? }`；标题行 `flex h-10 min-w-0 items-center gap-2`，标题 16px/600 单行 `truncate`（不用 `PageTitle` 的 20px）；元信息行恒渲染 `flex h-6 min-w-0 items-center gap-2`（无内容时留白 24px）；末尾 `PageDivider`；组件自带 `mb-4`（与 `PageHeader` 的节奏一致）、`shrink-0`。
  - 24px 图标按钮沿用 `icon-button` 契约，由调用方传入 `actions`。
- `packages/client/src/components/writing/chapter-rail.tsx`：标题条换 `PanelHeader`（`className="px-3"`、无 actions、`meta` 留空）；删除自绘 40px 行与 `border-b`；删除不再使用的 `Typography` 导入。
- `packages/client/src/pages/Writing.tsx`：正文列桌面端 `p-6` → `pt-0`（窄屏保持 `p-6`）；骨架 / 坏章 / 桌面无章空态 / 正文分支的 `PageHeader` 全部换 `PanelHeader`（标题「写作」/章名），`className="mb-4 -mx-6 px-6"`。
- `packages/client/src/components/manuscript/chapter-editor.tsx`：`PageHeader` → `PanelHeader`（`title={chapterTitle ?? "正文"}`、`leading` 原样、`meta={statusText}`、`className="mb-4 -mx-6 px-6"`）；正文操作改 24px 图标：`ArrowLeftOutlined` 上一章 / `ArrowRightOutlined` 下一章（禁用与 `disabledReason` 逻辑不变）、`ImportOutlined` 导入（隐藏 input 不变）、`ExportOutlined` 导出（`Dropdown` 触发器改图标，去掉 `DownOutlined` 与文字）；每枚带 `aria-label`、`title`（上一章/下一章 `title` 保留相邻章名）。
- 非目标：不动 rail 宽度 / 收起、不加右侧详情收起（U4）、不动大纲 / 设定、不改专注模式。
- 测试：新增 `packages/client/src/components/ui/panel-header.test.tsx`（标题行 40 / 元信息行恒 24 / 分割线 / 截断）；`writing.test.tsx`、`chapter-rail.test.tsx` 按新 DOM 与 `aria-label` 修正断言。
- 完成判据（硬）：`pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿；`git log --oneline -1` 为本卡 commit；`git status --short` 为空；汇报附 commit hash 与命令输出末尾。

### U2 大纲页：卷章栏头 + 详情页头统一，元信息单行

状态：待办

- 契约：`docs/ui/DESIGN.md` `outline-page`「工作台 rail 头」「详情页头」两条。
- `packages/shared/src/utils/format.ts` 增 `formatMonthDay(iso?: string | null): string`（`MM-DD`，非法值 `--`，与 `formatTimestamp` 同源），按现有方式导出；补对应单测。改完 shared 先 `pnpm -r build`。
- `packages/client/src/pages/Outline.tsx`：rail 头换 `PanelHeader`（`px-3`、右侧保留现有 `[清除推演][全部折叠/展开][+新建卷]`、`meta` 留空）；详情列桌面端 `p-6` → `pt-0`；空态 / 坏 id / 加载态 / 主详情的页头全部换 `PanelHeader`（`-mx-6 px-6`，标题 16px）。
- `packages/client/src/pages/OutlineDetail.tsx`：页头换 `PanelHeader`；写正文 / 阅读进度 / 推演保持 24px 图标；保存改 `type="primary" size="small" icon={<SaveOutlined />}`（`loading` 保留、`aria-label="保存"`）；元信息行改单行：类型徽标 + `更新于 {formatMonthDay(updatedAt)}`（`title` 放完整 `formatTimestamp`）+ 字数 + 推演/阅读进度徽标，去掉 `flex-wrap`，文字与徽标 `shrink-0`，超宽尾部截断。
- 非目标：不加右侧详情收起（U5）、不动设定 / 写作页、不改 rail 宽度持久化。
- 测试：`outline.test.tsx` 修正元信息与保存按钮断言（全量时间不再可见，改断 `title`）。
- 完成判据（硬）：`pnpm -r build`（shared 改动后）、`pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿；`git log --oneline -1` 为本卡 commit；`git status --short` 为空；汇报附 commit hash 与命令输出末尾。

### U3 设定页：rail 按钮右移 + 详情紧凑页头 + 图标操作

状态：待办

- 契约：`docs/ui/DESIGN.md` `setting-page`「工作台 rail 头」「详情页头」两条与「panel-header 操作口径」。
- `packages/client/src/components/entity/setting-rail.tsx`：标题条换 `PanelHeader`（`px-3`）；右侧组顺序改为 `[全部折叠/展开][+新建][收起/展开右侧详情]`（详情钮最右端），行为不变。
- `packages/client/src/pages/SettingWorkbench.tsx`：详情列桌面端 `p-6` → `pt-0`；空态 `PageHeader` → `PanelHeader`（标题「详情」、`-mx-6 px-6`）；向 `EntityDetail` 传 `compact`。
- `packages/client/src/pages/EntityDetail.tsx`：新增 `compact?: boolean`；`compact` 时页头用 `PanelHeader`（`-mx-6 px-6`，标题 16px），操作 = 保存（`type="primary" size="small"` 图标、`loading`、`aria-label="保存"`）+ 移入回收站（`DeleteOutlined`、`color="default" variant="text" size="small"`、`aria-label="移入回收站"`）；元信息单行 `创建于 {formatMonthDay} · 更新于 {formatMonthDay}`（`title` 放完整时间）+「变更记录 N 条」按钮 `shrink-0`。非 `compact`（地点/伏笔/时间轴）保持 `PageHeader` 原样。
- 非目标：不加设定页右侧详情收起（已有，仅调按钮位置）、不动写作 / 大纲。
- 测试：`setting.test.tsx` 断按钮顺序、`aria-label`、元信息单行文本。
- 完成判据（硬）：`pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿；`git log --oneline -1` 为本卡 commit；`git status --short` 为空；汇报附 commit hash 与命令输出末尾。

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
