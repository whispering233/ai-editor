# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 批次：章摘要回填闭环（N1）+ 伏笔到期提示（N2）

**依赖**：C1 是闸门（它定义 `data.result_summary` 与提案工具）；C2 / C3 / C4 依赖 C1；C5 独立。
`backlog.md` 与 `CHANGELOG.md` 由主会话在合并后统一改，**卡内不要碰这两个文件**。

---

## C1 · `propose_update_outline_node` + 章 `result_summary`

- **目标**：AI 能提案修改既有大纲节点的标题 / 计划摘要 / 实际摘要，人工确认后落库。
- **口径（已定稿）**
  1. 工具参数：`{ node_id, patches: { title?, summary?, result_summary? } }`，patches **至少一个键**；`.strict()`。
  2. `result_summary` **仅章**：卷 / 场带该键 → 抛错（不是静默忽略）。它进 `data`（`chapterDataSchema` 加字段，长度上限用**常量单源**，不写字面量）。
  3. 快照 = 节点 `updated_at`（与实体提案同口径；删除会推进 `updated_at` ⇒ 自动挡住「给已删节点写摘要」；`move` 只推父节点 ⇒ 移动不会误杀文本提案，位置与文本正交，**这是有意口径**）。
  4. 节点不存在 / 软删 → 抛错（执行侧失败，不是提案）。
  5. 空串 = 清空该字段（`""` 与「无摘要」等价）。
  6. executor 复用 `updateOutlineNodeInfo(dir, id, { title?, summary?, data? }, nowIso())`（`db/src/queries/outline-ops.ts`）。**`data` 是浅合并**——这是本卡最关键的前提，必须有用例钉住。
  7. 提案 permission = `proposal`；`content` 只给 `proposal_id` + 一句话摘要，预览走 `details`。
- **触点**：`shared/src/types/api.ts`（`chapterDataSchema` + 长度常量）· `tools/src/schemas/outline.ts`（TypeBox 参数）· `tools/src/proposal/outline.ts`（build/run）· `tools/src/index.ts`（注册 + description 注明「result_summary 仅章」）· server 的提案执行分支 · `docs/api/tool-calling.md` · `docs/design/30-agent-loop.md`
- **判据（硬）**：**「写 `result_summary` 不覆盖 `tags` / `status`」必须有一条落库用例**；`get_outline` 能带出 `result_summary`（`data` 原样透传，一行断言）；卷 / 场带 `result_summary` 抛错；快照不一致走既有冲突码。`pnpm -r build` + `pnpm typecheck` + `pnpm lint` + `pnpm --filter @whispering233/ai-editor-tools test` + `pnpm --filter @whispering233/ai-editor-server test`（本机 Windows 的 `EPERM` 平台红除外，见 backlog）全绿；新 commit + `git status` 干净。

---

## C2 · 写作页「回填本章摘要」

- **口径**：页头加一枚按钮 → `sendMessage(CHAPTER_SUMMARY_MESSAGE, { focus_node_id })` + `requestFocusInput()`（照 `PracticeDetail.tsx` 的既有姿势，**不新增端点、不新增通道**）。消息常量与「按钮可用」判定放 `client/src/lib/writing-summary.ts`（纯函数 + 单测），文案讲「让 AI 读本章正文后提案更新实际摘要」。
- **触点**：`client/src/lib/writing-summary.ts`(+test) · 写作页页头动作区 · `docs/ui/DESIGN.md`（写作页页头动作）
- **不做的**：不加详情页旁的第二入口；不改聊天流。
- **判据（硬）**：`pnpm typecheck` + `pnpm lint` + `pnpm --filter @whispering233/ai-editor-client test` 绿；新 commit；`git status` 干净。

---

## C3 · 聚焦注入「实际摘要」

- **口径**：`server/src/routes/chat.ts` 的 `buildFocusText` 在「摘要：<计划>」之后补一段「实际摘要：<result_summary>」——仅当存在；不改其他注入层，不预载正文。
- **触点**：`server/src/routes/chat.ts` · `server/src/routes/chat.test.ts` · `docs/design/20-context.md`（聚焦上下文一行）
- **判据（硬）**：`chat.test.ts` 里有「有 result_summary → 注入；无 → 不出现该段」两条；`pnpm typecheck` + `pnpm lint` 绿；新 commit；`git status` 干净。

---

## C4 · 章详情「实际摘要」字段

- **口径**：只在大纲页章详情表单里出现（`summary` 下方），**大纲树行不动**。dirty 判定与保存前归一必须走 `lib/outline-detail.ts` 的 `normalizeOutlineDataForm`（末行空串 / 缺省值不得一进表单就 dirty）。
- **触点**：`pages/OutlineDetail.tsx` · `lib/outline-detail.ts`(+test) · `docs/ui/DESIGN.md`（章详情卡片）
- **判据（硬）**：纯函数测试覆盖「空串 → 不写键」「有值 → 进 patches」；`pnpm typecheck` + `pnpm lint` + client 测试绿；新 commit；`git status` 干净。

---

## C5 · 写作页「本章待回收伏笔」

- **口径**
  1. 查询：`entities(type='hook')` 中 `data.expected_resolve_node_id === 当前章 id` 且未软删、状态仍未回收。**JSON 提取必须带 `json_valid` 守卫**（裸 `json_extract` 遇坏 JSON 会打挂整表查询）。
  2. 端点：新增 `GET /hook/expected?node_id=`（**不走**泛型 `listEntities` 的 `filters`，避免 hook 专属语义混进通用查询面）；文档进 `docs/api/30-api-entity.md`。
  3. UI：写作页左栏卷章导航栏的**当前章**下方一块可折叠小列表（「本章待回收 · N」），条目显示伏笔名 + 状态下标，点击跳 `#/hooks/:id`；无命中整块不渲染。
  4. 只做**字面相等**（不做过期派生）。
- **触点**：`db` 查询 · `server` 路由 + 测试 · `client` 写作页 rail（`components/writing/chapter-rail` 一带）· `docs/api/30-api-entity.md` · `docs/ui/DESIGN.md`
- **判据（硬）**：坏 JSON 行不打挂列表（有用例）；空命中不渲染；`pnpm typecheck` + `pnpm lint` + 相关包测试绿；新 commit；`git status` 干净。