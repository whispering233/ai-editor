# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### C3 — 画布视图初始化与缩放分级（LOD）

#### 范围
- `packages/client/src/lib/outline-canvas-layout.ts`：
  - `CANVAS_CHAPTERS_PER_ROW` 8 → **5**；新增 `CANVAS_INITIAL_MIN_ZOOM = 0.85`、`CANVAS_VIEW_PADDING = 24`。
  - 新增 `canvasLodLevel(zoom): "full" | "compact" | "far"`（阈值常量同处：`z >= 0.85` full、`0.72 <= z < 0.85` compact、其余 far）。
  - 新增 `canvasContentBounds(positions): { x, y, width, height }`（按 `CANVAS_CARD_WIDTH/HEIGHT` 求外包，零章返回 `null`）。
  - 新增 `resolveInitialViewport(bounds, canvas: { width, height }): { x, y, zoom }`：`zoom = min(1, (w-2*PAD)/bw, (h-2*PAD)/bh)`；`zoom >= 0.85` → 居中；否则 `zoom = 0.85`、`x = PAD - bounds.x*zoom`、`y = PAD - bounds.y*zoom`（左上角起步，不居中裁切）。
  - 存储：`writeCanvasState` 落盘时补 `version: 2`；`parseCanvasState` 只在 `version === 2` 时接受 `viewport`，其余（v1 无 version / 旧 `{nodes,zoom}`）只取 `nodes`。
- `packages/client/src/pages/OutlineCanvas.tsx`：
  - `fitViewOptions` 改为 `{ padding: 0.1, minZoom: CANVAS_MIN_ZOOM, maxZoom: 1 }`（只服务 Controls 的「适应视图」）。
  - 去掉 `fitView` prop 与 `fitViewOptions` 对首帧的作用：有存量视口 → `defaultViewport`；无 → 渲染一个 `<CanvasViewportController bounds={…} enabled />` 子组件（`useReactFlow().setViewport` + `useStore(s => s.width/height)`，宽度就绪后跑一次，`useRef` 防重）按 `resolveInitialViewport` 落视口。
  - 新增 `<CanvasLodTracker onChange={setLod} />` 子组件（`useOnViewportChange({ onChange })` → `canvasLodLevel(zoom)`），父层 `useState` 初值 = `canvasLodLevel(saved.viewport?.zoom ?? 1)`；只在档位变化时 `setState`（`canvasLodLevel` 结果相同就返回原 state）。
  - 包 `<ReactFlow>` 的那层 `div`（`min-h-0 flex-1`）加类：`lod-full` / `lod-compact` / `lod-far`。
- `packages/client/src/components/outline-canvas/ChapterCard.tsx`：三段加 `data-lod="head" | "title" | "meta"`；卡片根加 `data-written={card.textLength > 0}`；新增一份**始终在 DOM、非 far 档隐藏**的大章号 `<span data-lod="far-label">第N章</span>`。
- `packages/client/src/components/outline-canvas/canvas-theme.css`：`.lod-compact` 隐藏 `[data-lod="meta"]`；`.lod-far` 隐藏 head / title / meta 并显示 far-label（26px、居中、`flex:1`）；`.lod-compact, .lod-far` 隐藏 `.react-flow__edge-text` 与 `.react-flow__edge-textbg`；`.lod-far [data-written="false"]` 用 `act: var(--accent)` 底色（token，不引新色）。
- 测试：每行 5 张（更新既有网格用例）；`canvasLodLevel` 边界（0.85 / 0.849 / 0.72 / 0.719 / 0.25）；`resolveInitialViewport` 两分支（装得下居中 / 装不下 0.85 左上）；`canvasContentBounds`；`parseCanvasState`：v2 保视口、v1 丢视口只留 nodes、旧 `{nodes, zoom}` 丢 zoom。
- `CHANGELOG.md`：`[Unreleased] → Changed` 补一条（每行 5 张、首屏可读下界与左上起步、缩放分级、旧视口一次性丢弃）。

#### 完成判据
- `pnpm -r build` → `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 浏览器实测（24 章书）：首屏 zoom ≥ 0.85 且首卡在画布内（x ≥ 画布左缘）；缩到 0.7 以下只有大章号、元信息与边标签消失；缩回恢复；刷新后视口沿用。
- 硬判据：`git log -1` 有新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。
