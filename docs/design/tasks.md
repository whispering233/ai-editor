# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

## 卡 6：大纲拖拽支持空卷 / 折叠卷 / 空章落为子级

**问题**：拖其他卷下的章到「没有章的卷」行上无落点；根因是 `handleDragOver` / `handleDrop` 只把「目标行的父」当目标父——空卷行父 = root，章不能进 root，`canMoveTo` 直接失败。空章拖场、折叠卷同理。

**目标**：目标行自身可承载拖拽类型、但目标行的父不合法时，整行落点 = 追加为该行子级末尾；上 / 下半仍保持同级前后；卷 → 卷仍为同级前后。

**实现**：
- `packages/client/src/lib/outline-tree.ts`：新增纯函数 `resolveDropPlan`，返回 `{ parentId, insert, target }`；`DragTarget` 增加 `{ kind: "inside"; nodeId }`；优先按目标行父判定 before / after，父不合法时回退到目标行自身 + `{ kind: "end" }`，否则 `null`。
- `packages/client/src/pages/Outline.tsx`：`handleDragOver` / `handleDrop` 共用 `resolveDropPlan`；`inside` 行体 primary 10% 淡染 + 1px primary 30% 描边，不画插入线；`dropInsertOrder` / `isNoopDrop` 继续复用。
- `packages/client/src/lib/outline-tree.test.ts`：覆盖章 → 空卷、章 → 折叠卷、场 → 空章、章 → 非空卷、卷 → 卷仍同级、非法落点为 null。
- `packages/client/src/pages/outline.test.tsx`：至少一条拖拽回归（空卷落为子级、父 id / order 正确）。
- `docs/ui/DESIGN.md` 已补「行拖拽落点」语义；`CHANGELOG.md` 的 `Unreleased` 加 `### Fixed` 一条。

**允许改动的文件**：`packages/client/src/lib/outline-tree.ts`、`packages/client/src/lib/outline-tree.test.ts`、`packages/client/src/pages/Outline.tsx`、`packages/client/src/pages/outline.test.tsx`、`docs/ui/DESIGN.md`、`CHANGELOG.md`。

**硬完成判据**：
- `pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-client test` 全绿；
- `git status --porcelain` 空；
- 必须产生新 commit（汇报附 hash 与命令输出）；
- 独立 code reviewer 通过；ui-verifier 用真实浏览器验证拖章到空卷（桌面 1440 + 至少 1 个折叠卷场景），通过后清卡。

## 卡 7：详情页头「写正文」未保存守卫

**问题**：详情表单 dirty 时，「写正文」用普通 `<a href="#/writing/:id">` 直接离开，未保存修改静默丢失。

**目标**：点击「写正文」先走壳的 `confirmDiscard()`；取消留在详情且表单不丢；确认再 `navigate('/writing/:id')`。浏览器后退不处理（backlog 保留）。

**实现**：
- `packages/client/src/pages/OutlineDetail.tsx`：新增可选 `onNavigate?: (path: string) => void | Promise<void>`；「写正文」按钮 `onClick` `preventDefault()` 后调用 `onNavigate(`/writing/${node.id}`)`；无回调时保留 `href` fallback。
- `packages/client/src/pages/Outline.tsx`：传 `onNavigate={async (path) => { if (await confirmDiscard()) navigate(path); }}`。
- `packages/client/src/pages/outline.test.tsx`：dirty 点写正文 → 取消留在详情且输入保留；确认 → 到写作页；干净 → 直接走。
- `docs/ui/DESIGN.md`、`docs/design/backlog.md` 已按「写正文走同一确认、浏览器后退不拦」收窄；`CHANGELOG.md` 的 `Unreleased` 加 `### Fixed` 一条。

**允许改动的文件**：`packages/client/src/pages/OutlineDetail.tsx`、`packages/client/src/pages/Outline.tsx`、`packages/client/src/pages/outline.test.tsx`、`docs/ui/DESIGN.md`、`docs/design/backlog.md`、`CHANGELOG.md`。

**硬完成判据**：
- `pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering2333/ai-editor-client test` 全绿；
- `git status --porcelain` 空；
- 必须产生新 commit（汇报附 hash 与命令输出）；
- 独立 code reviewer 通过；ui-verifier 用真实浏览器验证 dirty 点写正文（取消 / 确认 / 干净三条）通过后清卡。

**顺序**：先卡 6，后卡 7；卡内不做另一卡或写作页的顺手改动。
