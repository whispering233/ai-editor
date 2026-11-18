# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### C2 — 画布主题层（底纹 / MiniMap / Controls / 边箭头 / 卡片状态）

#### 范围
- `packages/client/src/pages/OutlineCanvas.tsx`：`<Background variant="dots" gap={24} size={1} />`（不传 `color`）；`<MiniMap style={{ width: 160, height: 108 }} pannable zoomable />`；`ariaLabelConfig` 五个键中文（`controls.zoomIn.ariaLabel` / `controls.zoomOut.ariaLabel` / `controls.fitView.ariaLabel` / `controls.ariaLabel` / `minimap.ariaLabel`）；边补 `markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 }`（不传 color，走 `--xy-edge-stroke`）。
- `packages/client/src/components/outline-canvas/ChapterCard.tsx`：hover = `hover:border-input`；选中 / 聚焦（`NodeProps.selected`）= `border-primary`（`cn` 二选一，不叠加）；不填充、不加阴影。
- `packages/client/src/components/outline-canvas/canvas-theme.css`：MiniMap 皮肤（`--xy-minimap-background-color-props` = `{colors.canvas}`、`--xy-minimap-mask-background-color` = `{colors.surface}` 55% + `--xy-minimap-mask-stroke-*` = `{colors.hairline-strong}` 1px、节点 `{colors.hairline}`（`nodeStrokeWidth: 0`）、1px `{colors.hairline}` 边框 + `{rounded.sm}`）；Controls 按钮 28px + hover 底；handle 8 → 6px、常显 45% 不透明、hover 恢复 100%；attribution 10px `{colors.tertiary}`。
- 测试：无新增逻辑，`design-discipline.test.ts` / `antd-tokens.test.ts` 保持绿（不得为验收去改守卫）。
- **不做**：卡片内容与尺寸（C1）、LOD 与视口（C3）。

#### 完成判据
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 浏览器实测截图（1440×900 与对话栏打开两种宽度）：点阵底纹可见、MiniMap 尺寸 160×108 且不再是默认灰块、Controls 28px、卡片 hover / 选中描边可见、边有箭头与短标签。
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

