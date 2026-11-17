# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡 1 · `use-setting-rail` hook

- **范围**：新增 `packages/client/src/hooks/use-setting-rail.ts` + `use-setting-rail.test.ts`。参照 `hooks/use-outline-rail.ts` 的结构（拖动 / 收起 / 持久化同一套写法），**不改任何页面**。
- **契约**：
  - `export interface SettingRailLayout { width: number | null; collapsed: boolean; detailCollapsed: boolean }`
  - `SETTING_RAIL_KEY = "ai-editor:setting-rail"`、`SETTING_RAIL_MIN = 280`、`SETTING_RAIL_MAX = 720`。
  - 默认 `{ width: null, collapsed: false, detailCollapsed: false }`（`width: null` = 由 CSS 给 `max(320px, 中栏 1/2)`）。
  - `parseSettingRailLayout(raw: string | null): SettingRailLayout`：坏 JSON / 非对象 / 数组 → 全默认；`width` 非有限数字 → null，数字则收敛到 `[280, 720]`；`collapsed` / `detailCollapsed` 仅严格 `=== true` 为真。
  - `useSettingRail(desktop: boolean)` 返回 `{ layout, resizing, railRef, startResize, moveResize, endResize, toggleCollapse, toggleDetail }`；拖动过程只改内存，`pointerup` / 拖动结束一次写 localStorage；收起 / 展开立即写；`desktop === false` 时不绑定 window 监听、不写。
- **验收**：`pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-client test` 全绿；测试覆盖默认值 / 坏 JSON / 数组 / width 越界 / 非数字 width / 布尔严格性。
- **硬判据**：`git log --oneline -1` 有新 commit（`feat(setting): ...`）、`git status --porcelain` 为空。

### 卡 2 · `EntityDetail` 宿主通信

- **范围**：`packages/client/src/pages/EntityDetail.tsx`。**只加可选回调，不改任何既有行为 / 路由**；`EntityList`、地点详情、hook 详情零改动。
- **契约**：
  - 新增 `leading?: ReactNode`（透传 `PageHeader` 的 `leading`）。
  - 新增 `onDirtyChange?: (dirty: boolean) => void`：dirty = `detail !== null && form !== null && diffData(detail.data, form) !== null`；变化时 effect 上报一次（卸载时上报 `false` 可选，但不得在渲染期回调）。
  - 在 `handleSetParent` / `handleClearParent` 成功后、`CreateRelationDialog` 的 `onCreated`、`handleDeleteRelation` 成功后补调 `onSaved?.()`（与既有 refresh 并列，不替换）。
- **验收**：`pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-client test` 全绿；`git diff` 只动 `EntityDetail.tsx`。
- **硬判据**：新 commit（`feat(setting): ...`）+ 干净工作区。

### 卡 3 · 设定页 master-detail 主切片

- **范围**：`components/entity/setting-tree.tsx` → 重命名 `components/entity/setting-rail.tsx`（组件 `SettingRail`）；新增 `pages/SettingWorkbench.tsx` + `pages/setting.test.tsx`；改 `main.tsx`（`case "setting"` 统一渲染 `<SettingWorkbench id={second} />`）、`pages/EntityList.tsx`（删 setting 分支 / import / `viewOwnsToolbar` 的 setting 条件）。
- **rail**：
  - 40px header（`setting` + `[全部折叠/展开] [+ 新建]`，`icon-button`）替换原 `PageHeader` + `PageDivider`；`+ 新建` 保留原顶栏新建根级逻辑（`kind` 推断、选中+聚焦+3s 高亮）。
  - header 下常驻控件行：搜索 `flex-1 min-w-40` + 标签 + 排序 + 描述开关（原控件状态原样搬，不重新设计）。
  - 行区 `p-2` 自身滚动；去掉树外层 `rounded-md border` 卡片。
  - 选中改由 prop `nodeId: string | null` 驱动；行体单击 → `onSelect(node.id)`（同 id 幂等）；标题 / 摘要单击只 `startEdit`（`stopPropagation`）；**删除 `handleRowDoubleClick`** 与行 `title` 里「双击查看详情」文案；空白区单击 → `onSelect(null)`；行 `aria-current="page"` 取 `nodeId`。
  - 新建成功后 `onSelect(newId)`（替代内部 `setSelectedId`），高亮 / 聚焦 / 展开链保持。
  - 新增 props：`nodeId`、`onSelect(id: string | null)`、`onDetailCollapsedChange` 不需要（卡 4 再加）、`confirmDiscard: () => Promise<boolean>`（新建前守卫用）、`detailCollapsed` 由卡 4 引入（本卡不做）。
- **壳**：`-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden`；左列 `ResizeHandle`（`label="调整设定树宽度"`）+ rail 右 1px 边线；右列 `p-6` 独立滚动；`useSettingRail(isDesktop)`（卡 1）；`useDataRefresh` 在壳内累计 tick 传给 rail，`onSaved` 时 `tick+1`；`detailDirty` + `confirmDiscard()`（`useUiStore.getState().confirm`）用于切行 / 清选中 / 新建导航 / 窄屏返回条；`EntityDetail key={`setting:${id}`}` 传 `onDirtyChange` / `onSaved`。
- **窄屏 <1024**：`#/setting` rail 全宽（无详情列 / 拖拽）；`#/setting/:id` 详情全宽 + 32px「设定树」返回条（带守卫）。
- **空态**：无选中 → 页头「详情」+「从左侧选择一个设定查看详情」；空树 → 「还没有设定」+ 指向左侧新建；坏 id → 详情列「该实体不存在或已被删除」+ 返回设定 / 去回收站。
- **SSR 测试**（无 jsdom，参照 `outline.test.tsx`）：header 图标组存在、无选中空态文案、窄屏 `#/setting/:id` 只渲染详情 + 返回条、深链 id 传给 `EntityDetail`、`#/setting` 不自动选中（不出现 `entity-detail`）。
- **验收**：上述三命令全绿。
- **硬判据**：新 commit + 干净工作区。

### 卡 4 · 右侧详情收起

- **范围**：`SettingRail` header 增加详情收起 / 展开按钮（`RightOutlined` / `LeftOutlined`，`aria-label` / `title`）；壳消费 `layout.detailCollapsed`：为真时不渲染详情列、rail 吸收全宽、URL 选中保留、**点行不自动展开**；点击按钮前若 `detailDirty` 先 `confirmDiscard`；窄屏不渲染该按钮。
- **验收**：SSR 测试追加两条（收起态无详情列 / 再点展开仍显示原 URL 选中）；三命令全绿。
- **硬判据**：新 commit + 干净工作区。

### 卡 5 · 文档收尾与全量验证

- **范围**：复核 `docs/ui/DESIGN.md`（`setting-page` / §Layout / `data-row` / `outline-page` / §详情页布局）与 `docs/design/backlog.md` 已与实现一致（不一致就改文档，不改代码语义）；`CHANGELOG.md` Unreleased · Changed 加一条；跑 `pnpm typecheck` / `pnpm lint` / `pnpm -r test`；派 `ui-verifier` 浏览器核对 **≤12 条**（空态 / 深链 / 改名 / 新建 / 拖拽 / 删除 / 切行守卫 / 宽度拖拽 / 两档收起 / 刷新持久化 / 窄屏两级）。
- **硬判据**：新 commit + 干净工作区 + 验证命令输出附在汇报里。
