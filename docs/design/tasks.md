# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### C2 — 画布主题层（底纹 / MiniMap / Controls / 边箭头 / 卡片状态）

#### 范围
- `packages/client/src/pages/OutlineCanvas.tsx`：新增 `<Background variant="dots" gap={24} size={1} />`（不传 `color`；变量已在 `canvas-theme.css` 映射）；`MiniMap` 补 `style={{ width: 160, height: 108 }}`（v12 由 `style.width/height` 决定 SVG 尺寸，别改用 props）；`Controls` 补 `ariaLabelConfig` 四键中文（`controls.zoomIn.ariaLabel` / `controls.zoomOut.ariaLabel` / `controls.fitView.ariaLabel` / `controls.ariaLabel`）；`flowEdges` 每条补 `markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 }`（不传 `color` → 走 `--xy-edge-stroke`）。
- `packages/client/src/components/outline-canvas/ChapterCard.tsx`：`selected`（`NodeProps.selected`）时 `border-primary`，否则 `border-border hover:border-input`；不填充、不加阴影。
- `packages/client/src/components/outline-canvas/canvas-theme.css`（只补未对齐处）：MiniMap 节点色 `--muted-foreground` → `--border`、节点描边 → `transparent`、遮罩 `--background` → `--surface` 55%、遮罩描边 → `--input`，`.react-flow__minimap` 加 1px `--border` 边框 + 6px 圆角 + `box-sizing: border-box`；Controls 按钮 26 → 28px；handle 保持 8px、默认 `opacity: .45`、hover / `.connectingfrom` / `.connectingto` 恢复 1。
- 测试：无新增逻辑；`design-discipline.test.ts` / `antd-tokens.test.ts` 保持绿。

#### 完成判据
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 浏览器实测截图（1440×900 与对话栏打开两种宽度）：点阵底纹可见、MiniMap 160×108 且不再是默认灰块、Controls 28px 且中文 aria-label、卡片 hover / 选中描边可见、边有箭头与短标签。
- 硬判据：`git log -1` 有新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。

### C3 — 画布视图初始化与缩放分级（LOD）

#### 范围
- `packages/client/src/lib/outline-canvas-layout.ts`：`CANVAS_CHAPTERS_PER_ROW` 8 → **5**；`CANVAS_INITIAL_MIN_ZOOM = 0.85`；`CANVAS_LOD_THRESHOLDS`（全量 / 精简 / 俯瞰三档）+ `canvasLodLevel(zoom)`；`canvasContentBounds(positions)` 与 `resolveInitialViewport(bounds, canvas)`（装得下 → 居中；装不下 → 0.85 + 左上 24px）纯函数。
- `parseCanvasState` / `writeCanvasState`：写侧 `version: 2`；读侧 v1（无 `version`）只取 `nodes`、视口丢弃。
- `packages/client/src/pages/OutlineCanvas.tsx`：`fitViewOptions` 改为 `{ padding: 0.1, minZoom: CANVAS_MIN_ZOOM, maxZoom: 1 }`（只留给 Controls 的适应按钮）；有存量视口 → `defaultViewport`；无 → `onInit` 后按 `resolveInitialViewport` 调 `setViewport`（无动画）。
- LOD：`useOnViewportChange({ onChange })` 内比较档位，仅跨档 `setState`；容器类名 `lod-full` / `lod-compact` / `lod-far`；`canvas-theme.css` 落显隐（`lod-compact` 隐藏 meta 行；`lod-far` 隐藏章名 / 徽标 / 勾标、26px 章号、`[data-written="false"]` 用 `--accent` 底、边文字隐藏）。
- 测试：每行 5 张；`canvasLodLevel` 边界（0.85 / 0.849 / 0.72 / 0.719）；`resolveInitialViewport` 两分支；`parseCanvasState` 的 v1 → 只留 nodes；`canvasContentBounds`。
- `CHANGELOG.md` `[Unreleased] → Changed` 补一条（可并入 C1 那条）。

#### 完成判据
- `pnpm -r build` → `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 浏览器实测：24 章首屏在 0.85 可读且从左上开始（首卡 x ≥ 画布左缘）；缩到 0.7 以下切俯瞰档（只有章号）；缩回去恢复；无每帧重渲染（React DevTools 或 console 计数自证）。
- 硬判据：`git log -1` 有新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。

