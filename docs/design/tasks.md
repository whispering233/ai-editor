# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡
### U7 — 画布远档加纯数字章号角标

契约见 `docs/ui/DESIGN.md` `outline-canvas`「缩放分级（LOD）」句 +「节点 = 章」① 句。用户诉求 = 远档只靠悬停才知道第几章；除章名外，左上角常显纯数字章号（只显示 `n`，不显示「第/章」）。数字必须与全量档「第N章」同源，不从标签文案解析。

#### 范围
- `packages/shared/src/utils/outline-numbering.ts`：`OutlineChapterNumber` 增加 `chapterNumber: number`（1-based，与 `chapterLabel` 同源）；`chapters.push` 里写 `chapterNumber: i + 1`。不改编号顺序 / 卷号逻辑。
- `packages/shared/src/utils/outline-numbering.test.ts`：章序断言加入 `chapterNumber`；`ch-9` 的 `toEqual` 对象补 `chapterNumber: 4`（直挂 root 章仍占号）。
- `packages/client/src/lib/outline-canvas-layout.ts`：`CanvasChapterCard` 增加 `chapterNumber: number`；`canvasChapterCards` 映射 `chapterNumber: chapter.chapterNumber`。不改布局 / 高度 / LOD。
- `packages/client/src/components/outline-canvas/ChapterCard.tsx`：在卡片根内加 far-only 角标 `<span data-lod="far-number">{card.chapterNumber}</span>`（纯数字，无「第/章」）；`head` / `title` / `status` 钩子与 `title` 属性不动。
- `packages/client/src/components/outline-canvas/canvas-theme.css`：
  - 默认 `[data-lod="far-number"] { display: none; }`（全量档不显示）。
  - far 档 `.lod-far [data-lod="far-number"]`：`display:block; position:absolute; top:2px; left:8px; font-size:14px; font-weight:500; line-height:1; font-variant-numeric:tabular-nums; color:var(--muted-foreground);`；无底色 / 无边框（不抢 26px 章名）。
  - 保留现有 far 章名、未写底色、边标签隐藏规则；更新块注释（far = 章名 + 左上角数字）。
- 测试同步：`ChapterCard.test.tsx` 的 `card()` fixture 补 `chapterNumber: 3`，并加一条断言 far-number 文本为 3；`outline-canvas-filter.test.ts` fixture 补 `chapterNumber: 1`；`outline-canvas-layout.test.ts` 所有 `canvasChapterCards` 期望对象补对应 `chapterNumber`（按章序 1/2/3…）。
- 不动：`OutlineCanvas.tsx` 的 LOD 追踪 / 类切换、阈值 0.72、`written`、筛选、坐标 / 视口、服务端 / API / DB；不新增组件 / 依赖 / 第三档。

#### 完成判据
- 因改了 shared `src`：先 `pnpm -r build`，再 `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 全绿。
- 浏览器实测（ui-verifier；最多 6 张截图 / 2 个缩放档）：
  1. z ≥ 0.72：仍显示「第N章」徽标 + 章名 + 状态 / 标签；左上角数字角标不可见。
  2. z < 0.72（如 0.5）：只显示 26px 章名 + 左上角纯数字（1/2/3，与章序一致）；不显示「第N章」徽标、状态 / 标签行、伏笔徽标；数字不带「第/章」。
  3. 68px 与 92px 两种卡在 far 档数字角标与章名不重叠、不裁切、不溢出。
  4. 悬停 `title` 仍含「卷·章 名称 / 场数 / 标签」完整信息；已写 / 未写底色与连线标签隐藏不变。
- 硬判据：`git log -1` 有新 commit 且 `git status` 干净；汇报附 commit hash + 命令输出。
