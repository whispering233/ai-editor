# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡
### U6 — 画布远档改为只留章名

契约见 `docs/ui/DESIGN.md` `outline-canvas`「缩放分级（LOD）」句；用户诉求 = 缩小后不再只剩「第N章」，至少能看出是哪一章。

#### 范围
- `packages/client/src/components/outline-canvas/canvas-theme.css`：
  - 删除 `[data-lod="far-label"]` 的两条规则（全量档隐藏 + far 档显示）。
  - far 块：`head` / `status` 在 far 档 `display: none`；`title` 从隐藏列表移出，改为 26px / 600 / 行高 1.2 / `text-align: center` / `margin-block: auto`（在 68 / 92px 卡内垂直居中）；保留 `truncate` 单行省略。
  - 保留 `.lod-far [data-written="false"]` 的未写底色、`.lod-far .react-flow__edge-text*` 的连线标签隐藏；不改 `--xy-*` 映射与设计 token。
  - 块注释同步：far = 只留章名（+ 在读条）。
- `packages/client/src/components/outline-canvas/ChapterCard.tsx`：删除 `data-lod="far-label"` 的 `<span>` 及其注释；`data-lod="head" / "title" / "status"` 与 `title` 属性保持原样（显隐全由 CSS 切档）。
- `packages/client/src/lib/outline-canvas-layout.ts`：只改注释——`CANVAS_LOD_FULL_MIN_ZOOM` 的「26px 章号」、`canvasLodLevel` JSDoc、文件头 ④ 的「只留大章号」统一改为「只留章名」；阈值 / 类型 / 函数行为一律不动。
- 不动：`OutlineCanvas.tsx` 的 LOD 追踪与类切换、`written` 字段、筛选、坐标 / 视口、服务端 / API / DB；不新增第三档、不改 0.72。
- 测试：现有 `outline-canvas-layout.test.ts` / `ChapterCard.test.tsx` 不改断言（没有 far-label 断言）；CSS 显隐无法单测，交给 ui-verifier。

#### 完成判据
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 浏览器实测（ui-verifier；最多 6 张截图 / 2 个缩放档）：
  1. z ≥ 0.72：卡片仍显示「第N章」徽标 + 章名 + 状态 / 标签，与改前一致。
  2. z < 0.72（如 0.5）：只显示大号章名（26px 量级、居中、单行），不显示「第N章」徽标、状态 / 标签行、伏笔徽标；卡片悬停 `title` 仍含「卷·章 名称 / 场数」。
  3. 68px（无状态无标签）与 92px（有状态或标签）两种卡在 far 档都不裁切、不溢出。
  4. 已写 / 未写底色与连线标签隐藏行为不变（可并入第 2 条截图）。
- 硬判据：`git log -1` 有新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。
