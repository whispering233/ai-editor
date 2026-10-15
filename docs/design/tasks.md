# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 作家文风练习改版（2026-10）— 进行中

**契约**：`docs/design/60-practice.md`（设计）、`docs/api/120-api-practice.md`（端点）、`docs/db/schema.md`「练习三表」与「project.json」（字段）、`docs/ui/DESIGN.md`「作家文风练习区」/「根首页」/「导航与外壳」（视觉）、`docs/api/tool-calling.md`（工具面）、`docs/api/80-api-chat.md`（注入）。

**链内红窗（有意，已登记）**：这是同一功能的**模型重建**——旧常量（`MAX_PRACTICE_TARGET_NAME_CHARS` 等）与旧端点（`/practice/targets*`）被删，消费方在下游卡里跟上。**中间卡允许全仓 `pnpm typecheck` 变红**；每卡判据 = **本包 build + 本包测试 + 本卡改动范围**；全仓 `typecheck` / `lint` / `pnpm -r test` 由**卡 10 收口**。

**每卡硬完成判据（缺一不可，汇报必附原始输出）**：
1. `git log --oneline -1` 含**本卡的新 commit**（无 commit 不许报 PASS），`git status --porcelain` 干净；
2. 本卡「验收命令」全绿（命令与输出摘要一并附上）；
3. 汇报写明改动的文件清单 + 与卡内任一条不对应的实现说明（如有）。

**派工顺序**：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10（3–6 可并行于各自 worktree，文件集互不相交；7 需 4 合回、8 需 3 合回）。

---

### 卡 1：预置作家素材目录 + 练习常量改版（shared）

**改动范围**：`packages/shared/src/authors/`（新建：`types.ts` / `jiangnan.ts` / `catalog.ts` / `index.ts` / `authors.test.ts`）、`packages/shared/src/index.ts`（barrel 导出）、`packages/shared/src/constants/practice.ts`、`packages/shared/src/constants/constants.test.ts`。**不得改下游包**。

**实现**（契约 = `60-practice.md` §3、`120-api-practice.md` 顶部「长度上限」）：
1. 类型：`PracticeWork = { id: string; name: string; intro: string }`；`AuthorEntry = { id: string; name: string; intro: string; works: readonly PracticeWork[]; styleNotes: string }`；`AuthorId = keyof typeof AUTHOR_CATALOG`。
2. 江南素材（**原创撰写，不得逐字搬运百科/豆瓣**）：`intro` 200–400 字；`works` 8 条（slug id + 中文名 + 1–2 句原创介绍）= 此间的少年 / 九州缥缈录 / 上海堡垒 / 龙族 / 涿鹿 / 刺客王朝·葵 / 光明皇帝 / 龙与少年游；`styleNotes` markdown（分节：语言纹理 / 句长与节奏 / 叙述视角与距离 / 意象与用典 / 结构习惯 / 常见瑕疵；**不引作品原文长段**）。
3. `catalog.ts`：`AUTHOR_CATALOG: Record<string, AuthorEntry>`、`AUTHOR_IDS`、`resolveAuthor(value: unknown): AuthorEntry | null`、`resolveWork(authorId: string, workId: string): PracticeWork | null`、`PRACTICE_OTHER_WORK_LABEL = "其他"`（「其他」兜底文案唯一定义处）。
4. 常量：删 `MAX_PRACTICE_TARGET_NAME_CHARS` / `MAX_PRACTICE_OBSERVATION_CHARS` / `MAX_PRACTICE_SOURCE_LABEL_CHARS`；新增 `MAX_PRACTICE_EXCERPT_LABEL_CHARS = 100` / `MAX_PRACTICE_TOPIC_CHARS = 100` / `MAX_PRACTICE_BRIEF_CHARS = 500` / `MAX_PRACTICE_STYLE_PACK_CHARS = 100000`；`MAX_PRACTICE_SAMPLE_CHARS` 20000 → **100000**；`MAX_PRACTICE_DRAFT_CHARS` 保持 20000（仿写稿与自由稿**共用同一常量**）；`MAX_FEEDBACK_DIMENSIONS` 不变。注释里的语义说明同步改（数值单源：注释不复述数字）。
5. 测试：清单非空且 id 稳定、作品 id 全局唯一且 slug 形状、每部作品 name/intro 非空、`resolveAuthor` 未知值 → null、`resolveWork` 跨作者 / 未知 id → null；常量测试删旧断言、补新值断言。

**验收命令**：`pnpm --filter @whispering233/ai-editor-shared build` → `pnpm --filter @whispering233/ai-editor-shared test`。

**Commit**：`feat(practice): 预置作家素材目录与练习常量改版`

---

### 卡 2：迁移 013 + 练习查询层重建（db）

**改动范围**：`packages/db/src/migrations/013_author_practice.ts`（新建）、`packages/db/src/migrations/index.ts`、`packages/db/src/migrations/012_practice.test.ts` 对齐或新增 `013` 测试、`packages/db/src/schema.ts`（`SCHEMA_VERSION` → 13）、`packages/db/src/tables.ts`（三表声明 + `CREATE_TABLES_SQL`）、`packages/db/src/queries/practice.ts`（重写）、`packages/db/src/queries/practice.test.ts`、`packages/db/src/schema.test.ts`（DDL 对齐断言）。**不得改 server/tools/client**。

**实现**（契约 = `docs/db/schema.md`「练习三表」+ `120-api-practice.md`）：
1. 迁移 013：drop `practice_targets` / 旧 `practice_samples`（含索引 `idx_practice_samples_target`）→ 建三张新表（`practice_samples` 新形状 / `practice_free_pieces` / `practice_style_packs`），DDL 与 `tables.ts` **逐字同形**；纯 DDL 无数据搬移。
2. 查询层（**库写入唯一入口**，禁止绕过直接写表；列表只出投影、`charCount` 走 SQL `length(...)`、`feedback` 沿用防御解析）：
   - 样本：`listPracticeSamples` / `createPracticeSample`（`work_id` 可空、`excerpt_label`、`text` 不可变）/ `getPracticeSample` / `updatePracticeSampleDraft` / `deletePracticeSample`；
   - 自由练习：`listPracticePieces` / `createPracticePiece`（`topic` / `brief` / `topic_source`）/ `getPracticePiece` / `updatePracticePieceDraft` / `updatePracticePieceTopic`（出题工具用）/ `updatePracticePieceFeedback` / `deletePracticePiece`；
   - 素材包：`getStylePack(author_id)` / `upsertStylePack(author_id, content)` / `deleteStylePack(author_id)`（幂等）；
   - 点评卡写入：样本与自由练习各自的 `updatePracticeFeedback`（只写 `feedback`，形状校验在调用侧）。
3. 测试：迁移推进到 v13 且重跑幂等、旧表已消失、新表可读写；三表 helper 的投影形状与边界（空串 / 可空 `work_id` / 无行时返回 null / 坏 JSON `feedback` 不打挂列表 / 删除幂等）。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-db test`。

**Commit**：`feat(db): 练习数据模型重建（迁移 013 + 三表查询层）`

---

### 卡 3：风格说明素材包端点 + 风格说明页

**改动范围**：`packages/shared/src/types/api.ts`（`style-pack` 三端点 schema + 类型，**只加这三个端点**）、`packages/server/src/routes/practice.ts`（删 targets 相关端点与 helper、加 author 解析守卫与 style-pack 三端点）、`packages/server/src/routes/practice.test.ts`、`packages/client/src/lib/api.ts`（三个客户端函数）、`packages/client/src/pages/` 风格说明页（新建）+ 其测试。**不碰 `main.tsx` / `nav-items.tsx`（路由注册在卡 8）**。

**实现**（契约 = `120-api-practice.md`「作家风格说明素材包」、`docs/ui/DESIGN.md`「作家风格说明」面）：
1. 前置守卫：`kind !== "practice"` → 400 `KIND_MISMATCH`；`author_id` 解析不到预置作家（shared `resolveAuthor`）→ 400 `VALIDATION_ERROR`「练习工作区未关联预置作家」。
2. `GET /practice/style-pack`（生效内容 = 用户覆盖 `??` 预置 + `customized` + `updatedAt`）、`PUT`（trim 非空 + 上限常量；strict）、`DELETE`（恢复预置，幂等 200）。
3. 页面（纯展示 + 容器）：默认 markdown 渲染（`@ant-design/x-markdown`，测试同 `chat-panel.test.tsx` 的 `vi.mock` 先例）；`[编辑]` → `Input.TextArea`（md 源码）+ `[保存]`（失败原样返回 `false`，接入既有 `useSaveShortcut`）+ `[取消]`；`[导入 .md]` 与 `[恢复预置]` 走受控确认框（danger）；有覆盖时一行 `caption-text`「当前为自定义版本」。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-server test` → `pnpm --filter @whispering233/ai-editor-client test`。

**Commit**：`feat(practice): 风格说明素材包端点与页面`

---

### 卡 4：样本端点重整 + 文风练习列表页 + 范文导入

**改动范围**：`packages/shared/src/types/api.ts`（样本五端点 schema）、`packages/server/src/routes/practice.ts` + `practice.test.ts`、`packages/client/src/lib/api.ts`、`packages/client/src/lib/practice.ts`、`packages/client/src/lib/document-io.ts`（`readTextFile` 编码回落）、`packages/client/src/pages/Practice.tsx`、`packages/client/src/components/practice/create-sample-dialog.tsx` + 测试（`create-sample-dialog.test.tsx`、`practice.test.tsx`、`lib/practice.test.ts`）。

**实现**（契约 = `120-api-practice.md`「范文样本」、`DESIGN.md`「文风练习列表」「新建样本弹窗」）：
1. 删 `GET/POST /practice/targets*` 全部端点；加 `GET /practice/samples`（本工作区全部，投影不带正文与卡体）、`POST /practice/samples`（`work_id` 可空且给了必须在预置作品清单内 → 否则 400 `VALIDATION_ERROR`；`excerpt_label` 可空；`text` 非空且 ≤ 上限）、`GET/PUT/DELETE /practice/samples/:id`（保留语义：PUT = 唯一用户写稿入口；404 文案「练习样本不存在」）。
2. 列表页：**按作品分组**（预置作品清单顺序 + 末尾「其他」组，无样本的组不渲染，组内 `updatedAt` 倒序）；组内 `[+ 新建样本]` 预选该作品；页头右端 `[+ 新建样本]`（默认「其他」）；样本行 = 片段说明（空则留空）+ 状态徽标 + 相对时间；删「新建目标」入口与相关组件文件（`create-target-dialog.tsx` 及其测试**一并删除**）。
3. 新建样本弹窗：关联作品 `select`（预置作品 + 「其他」，必选默认「其他」，`popupMatchSelectWidth={false}`）+ 片段说明 `input`（可空，上限常量）+ 范文 `TextArea`（上限常量）+ 「导入文本文件」按钮（`.txt` / `.md`）。
4. `readTextFile`：先 `new TextDecoder("utf-8", { fatal: true })` 解码，抛错 → `new TextDecoder("gb18030")`；**超上限不静默截断**（框内可见错误 + 保留原输入）；文件名（去扩展名）预填「片段说明」。
5. 测试：端点（含 work_id 校验、404 文案、列表投影）、列表分组口径（纯函数层）、导入解码两条路径 + 超限错误。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-server test` → `pnpm --filter @whispering233/ai-editor-client test`。

**Commit**：`feat(practice): 样本端点重整、按作品分组列表与范文导入`

---

### 卡 5：样本详情页改造

**改动范围**：`packages/client/src/pages/PracticeDetail.tsx`、`packages/client/src/pages/practice-detail.test.tsx`（如断言需要）、`packages/client/src/lib/practice.ts`（如派生函数需随新响应形状调整）。

**实现**（契约 = `DESIGN.md`「练习详情」）：页头 title = 片段说明（空则作品名，`truncateTitle`）+ description = 作品名 + 作家名（**删掉「文风目标 / 我的观察」行**）；三段保持（范文只读 → 我的稿 + 保存 + `Ctrl/Cmd+S` → 点评卡 + 「让 AI 点评」）；点评帧刷新与 404 / 加载失败两态不变。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-client test`。

**Commit**：`feat(practice): 样本详情页改用作品与片段说明`

---

### 卡 6：自由练习端点 + 自由练习两页

**改动范围**：`packages/shared/src/types/api.ts`（自由练习五端点 schema）、`packages/server/src/routes/practice.ts` + `practice.test.ts`、`packages/client/src/lib/api.ts`、`packages/client/src/pages/Free.tsx`（新建）、`packages/client/src/pages/FreeDetail.tsx`（新建）、`packages/client/src/components/practice/create-piece-dialog.tsx`（新建）、`packages/client/src/lib/free-practice.ts`（新建：状态四态派生 / 触发文案）+ 各自测试。**不碰 `main.tsx`（路由注册在卡 8）**。

**实现**（契约 = `120-api-practice.md`「自由练习」、`60-practice.md` §4、`DESIGN.md`「自由练习列表 / 详情」「新建题目弹窗」）：
1. `GET /practice/free`（列表投影）、`POST /practice/free`（`topic_source: "user" | "ai"`；`"user"` 必填 topic；`"ai"` 必须空题）、`GET/PUT/DELETE /practice/free/:id`（PUT = 唯一用户写稿入口；404 文案「自由练习不存在」）。
2. 列表页：平铺 `data-row`（题目 / 「（待出题）」+ 四态徽标 + 相对时间）；页头右端 `[+ 新建题目]`（弹窗：题目必填 + 写作要求可空）+ `[让 AI 出题]`（建空题行 → 发普通用户消息 + 聚焦聊天）。
3. 详情页：三段 = 题目卡（题目 + 要求；空题态 `[让 AI 出题]`）→ 我的稿（同仿写稿形态：`--writing-*`、保存、`Ctrl/Cmd+S`、字数）→ 点评卡（**复用 `PracticeDetail` 导出的卡面组件**，行标签「风格特征 / 你的写法」）；点评触发 `context.practice_free_piece_id`；`tool_execution_end` details 帧刷新（出题帧也要刷新）。
4. 测试：端点（两种 `topic_source` 的分支校验、404）、四态派生纯函数、页面 SSR（空题态 / 有题态）、帧刷新守卫（沿用 `shouldRefreshPracticeCard` 同款逻辑即可）。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-server test` → `pnpm --filter @whispering233/ai-editor-client test`。

**Commit**：`feat(practice): 自由练习端点与两页（出题 / 按风格说明点评）`

---

### 卡 7：`author_id` 贯通 + 根首页练习分区

**改动范围**：`packages/shared/src/types/project.ts`（`ProjectFileConfig.author_id`）、`packages/shared/src/types/api.ts`（`projectCreateReq` 加 `author_id`、`projectListRes` 条目加 `authorId`、`projectConfigRes` 加 `authorId`）、`packages/server/src/routes/project.ts` + `project.test.ts`、`packages/client/src/stores/project.ts`、`packages/client/src/pages/Dashboard.tsx`、`packages/client/src/lib/workspace.ts`、测试（`workspace.test.ts`、`dashboard-partitions.test.ts`、`stores/project.test.ts`、server `project.test.ts`）。

**实现**（契约 = `10-api-project.md`、`DESIGN.md`「根首页」）：
1. 服务端：`POST /project/create` 接受 `author_id`（仅 `kind = "practice"`；`novel` 传入或值不在预置清单 → 400 `VALIDATION_ERROR`）并落 `project.json`；`GET /project/list` 条目回 `authorId`（`project.json` 缺 → `null`）；`GET /project/config` 回 `authorId`（小说工作区 / 缺字段 → `null`）。
2. 客户端：`partitionWorkspaces` 丢弃 `authorId` 解析不到预置作家的练习项（**服务端照列**）；练习分区渲染**预置作家卡**（全部预置作者：未开始 / `N 篇范文 · 最近更新 …`；排序 = 有数据的 `updatedAt` 倒序在前、未开始按清单顺序垫后）；点未开始卡 = **懒创建**（`name` = 作家名 + `author_id` + `kind: "practice"`，落 `#/practice`）；点已有卡 = 打开；**删「新建练习区」入口与 `PRACTICE_EMPTY_HINT` 相关空态分支**（分区恒有预置卡）。
3. 测试：创建参数校验（novel 传 author_id → 400；未知 id → 400）、list/config 的 `authorId` 值、过滤与排序纯函数、Dashboard 源码守卫断言更新。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-server test` → `pnpm --filter @whispering233/ai-editor-client test`。

**Commit**：`feat(practice): author_id 贯通与根首页预置作家卡`

---

### 卡 8：左栏五项 + 路由 + 守卫 + 作家介绍 / 作品介绍页

**改动范围**：`packages/client/src/components/nav/nav-items.tsx` + `nav-items.test.ts`、`packages/client/src/main.tsx`、`packages/client/src/hooks/use-route.ts` + `use-route.test.ts`、`packages/client/src/lib/workspace-route-guard.ts` + `workspace-route-guard.test.ts`、`packages/client/src/pages/AuthorIntro.tsx` / `Works.tsx`（新建）+ 其测试、`packages/client/src/lib/workspace.ts`（落点常量如需）。

**实现**（契约 = `DESIGN.md`「导航与外壳」、`60-practice.md` §9）：
1. 练习态左栏五项（顺序：作家介绍 `#/author` / 作品介绍 `#/works` / 作家风格说明 `#/style` / 文风练习 `#/practice` / 自由练习 `#/free`；图标走 `@ant-design/icons`）；顶部标识与工具区/书名按钮口径不变。
2. 路由注册五页 + `#/practice/:sampleId` / `#/free/:pieceId`（卡 3 / 5 / 6 已建页面组件）。
3. 守卫：**练习专属首段清单单一定义**（`author` / `works` / `style` / `practice` / `free`）；练习工作区按允许清单放行（+ `#/` + `preferences`），小说工作区挡任一段 → `#/`；落点常量仍是 `#/practice`。
4. 作家介绍页（`card` + markdown 只读）与作品介绍页（每部作品一卡：作品名 + 介绍 markdown）。
5. 测试：导航项集、守卫双向（含新段在小说态被挡）、路由解析、两页 SSR。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-client test`。

**Commit**：`feat(practice): 左栏五项、路由与作家 / 作品介绍页`

---

### 卡 9：AI 工具面与内核提示词改版

**改动范围**：`packages/agent/src/runtime/system-prompt.ts`（**只重写 `PRACTICE_KERNEL_PROMPT`**）+ `system-prompt.test.ts`、`packages/tools/src/schemas/practice.ts` / `query/practice.ts` / `registry.ts` + 测试、`packages/shared/src/constants/tool.ts`（`TOOL_DETAILS_TO_CLIENT`）+ `constants.test.ts`、`packages/server/src/routes/chat.ts`（`context.practice_free_piece_id` + 注入展开）+ `chat.test.ts`、`packages/agent/src/runtime/{tools,project-runtime}.test.ts` 相关断言。

**实现**（契约 = `tool-calling.md` 练习段、`60-practice.md` §7 / §8、`80-api-chat.md`）：
1. 七件工具：四个只读（`get_practice_sample` / `get_practice_draft` / `get_free_draft` / `get_style_notes`）+ 三个写 AI 产出（`submit_style_feedback` / `submit_free_feedback` / `submit_practice_topic`）；全部 `scope: "practice"`；两个点评工具的 dimensions 上限由 `MAX_FEEDBACK_DIMENSIONS` **插值**进描述，出题工具的 topic / brief 上限同源插值。
2. 引用校验：仿写 = 范文 `或` 稿件的子串；自由练习 = **风格说明（用户覆盖 `??` 预置）** `或` 稿件的子串；不匹配丢弃并计 `dropped_quotes`；空串 / 纯空白同路径。
3. `submit_practice_topic`：题目非空 → **抛错拒写**（`execute` 抛错即失败）。
4. 三个写工具的 `details` 进 `TOOL_DETAILS_TO_CLIENT`（点评两个 + 出题一个）。
5. chat：`context.practice_free_piece_id`（现读注入：篇 id + 作家名 + 题目 + 写作要求；不存在 → 静默省略）；`practice_sample_id` 注入改为「样本 id + 作家名 + 作品名 + 片段说明」。
6. 内核提示词：重写 `PRACTICE_KERNEL_PROMPT`（仿写点评者 + 自由练习点评者 + 出题者；保留「不代写 / 引用须逐字 / 先读后评 / 维度自定 / 长度截断须知」条款；新增「出题要给可执行的写作要求」；仿写以范文为主、可按需读风格说明）。
7. **硬判据（oracle 独立核）**：`KERNEL_PROMPT`（小说版）**零 diff**；小说侧工具 schema/description 与小说注入分支无改动（`git diff` 断言）。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-tools test` → `pnpm --filter @whispering233/ai-editor-agent test` → `pnpm --filter @whispering233/ai-editor-server test`。

**Commit**：`feat(practice): AI 工具面与内核提示词改版（自由练习点评 / 出题）`

---

### 卡 10：全链路收口与验证

**改动范围**：缺陷修复（仅限改版链路内的真实缺陷）、`docs/design/tasks.md` 清卡、`CHANGELOG.md` 校对。**不新增功能**。

**实现**：
1. `pnpm -r build` → `pnpm typecheck` → `pnpm lint` → `pnpm -r test` **全绿**（红窗在此关闭）；把命令与输出摘要写进汇报。
2. 逐条核对实现 ↔ 文档（`60-practice.md` / `120-api-practice.md` / `schema.md` / `DESIGN.md`），发现漂移就地修文档或代码并在汇报中列出。
3. **浏览器像素走查委托 `ui-verifier`**（核验项：根首页练习分区预置卡与懒创建 / 左栏五项 / 风格说明渲染与编辑 / 文风练习分组列表与新建样本（含导入文件）/ 自由练习出题与点评 / 详情页排版）；发现问题回到对应卡修完再复验。
4. 清空 `docs/design/tasks.md` 的本批卡片；确认 `CHANGELOG.md` Unreleased 段与最终实现一致（含迁移 013 说明）。

**验收命令**：上列四条 + ui-verifier 报告（无未 proven 项）。

**Commit**：`chore(practice): 改版收口（全量回归与文档对齐）`

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。