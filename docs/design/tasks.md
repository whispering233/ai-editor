# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡
### K4 — 卡片按内容定高 + 行距按行计算（存储 v3）

契约见 `DESIGN.md` `outline-canvas`「节点 = 章」卡片高度句 +「平铺卡片、无容器」行距句 +「缩放分级」两档 +「坐标与视口」v3。

#### 范围
- `packages/client/src/lib/outline-canvas-layout.ts`：
  - `CANVAS_CARD_HEIGHT` 改义为「**有状态或标签**时的高度 = 92」，新增 `CANVAS_CARD_HEIGHT_BASE = 68`；新增纯函数 `canvasCardHeight(card)`（`status` 非 `draft` 或 `tags` 非空 → 92，否则 68）。
  - `layoutCanvasChapters`：仍每行 5 张，但**行距按行算**——该行最高卡片 + `CANVAS_CARD_GAP`（全短行 92、含高卡 116）。
  - `canvasContentBounds`：接受每卡高度（或直接收 cards），`maxY` 不再一律加 92。
  - `CANVAS_STATE_VERSION = 3`；`parseCanvasState` 对 `version !== 3`（含 v1 无 version / v2）**整体返回空状态**（nodes 空、无 viewport）——一次性重排。
  - `canvasLodLevel`：合并为两档（`≥ CANVAS_LOD_FULL_MIN_ZOOM` 全量 / 更低 far），删除 compact 档与相关常量；`CANVAS_LOD_FULL_MIN_ZOOM = 0.72`。
- `packages/client/src/pages/OutlineCanvas.tsx`：node `style.height` 用 `canvasCardHeight(card)`；容器类只剩 `lod-full` / `lod-far`；`resolveInitialViewport` 传每卡高度。
- `packages/client/src/components/outline-canvas/canvas-theme.css`：删 `.lod-compact` 规则。
- `packages/client/src/components/outline-canvas/ChapterCard.tsx`：确认 68px 下两行排布正常（`py-2` + `gap-1` 不溢出），无第三行时不留空白。
- 测试：行距两分支（全短行 92 / 混合行 116）、`canvasCardHeight` 四态（draft+无标签 / draft+有标签 / final / revision）、`canvasContentBounds` 短卡、`parseCanvasState` v3 接受 / v2 丢弃 / v1 丢弃、`canvasLodLevel` 0.72 边界与两档、卡片 `renderToString` 在 68px 容器内不溢出（断言两行存在、第三行缺失）。

#### 完成判据
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 浏览器实测（ui-verifier）：无状态无标签的卡高度 68、有状态的卡 92、行距 92 / 116 两分支、卡片无空行、远档仍只剩章号。
- 硬判据：`git log -1` 有新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。
