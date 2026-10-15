# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 作家文风练习改版（2026-10）— 进行中

**契约**：`docs/design/60-practice.md`（设计）、`docs/api/120-api-practice.md`（端点）、`docs/db/schema.md`「练习三表」与「project.json」（字段）、`docs/ui/DESIGN.md`「作家文风练习区」/「根首页」/「导航与外壳」（视觉）、`docs/api/tool-calling.md`（工具面）、`docs/api/80-api-chat.md`（注入）。

**链内红窗（有意，已登记）**：这是同一功能的**模型重建**——旧常量、旧端点（`/practice/targets*`）与旧练习表被删，消费方在后续卡里跟上。**中间卡允许全仓 `pnpm typecheck` 变红**；每卡判据 = **本包 build + 本包测试 + 本卡改动范围**；全仓 `typecheck` / `lint` / `pnpm -r test` 由**卡 8 收口**。

**卡序重切（2026-10，文件冲突驱动的调整）**：原 3–6 拆分会让多张卡同时写 `shared/types/api.ts`、`server/routes/practice.ts`、`client/lib/api.ts`（同一批文件），worktree 并行反而要人工解冲突 ⇒ 收成「一张端点卡 + 三张客户端卡」并改为顺序推进（**不并行 worktree**）。原「卡 1」已通过独立验证并清卡（commit `6955d833`）。

**每卡硬完成判据（缺一不可，汇报必附原始输出）**：
1. `git log --oneline -1` 含**本卡的新 commit**（无 commit 不许报 PASS），`git status --porcelain` 干净；
2. 本卡「验收命令」全绿（命令与输出摘要一并附上）；
3. 汇报写明改动的文件清单 + 与卡内任一条不对应的实现说明（如有）。

---

### 卡 2：迁移 013 + 练习查询层重建（db）— 进行中

**改动范围**：`packages/db/src/migrations/013_author_practice.ts`（新建）、`migrations/index.ts`、迁移测试、`packages/db/src/schema.ts`（`SCHEMA_VERSION` → 13）、`packages/db/src/tables.ts`（三表声明 + `CREATE_TABLES_SQL`）、`packages/db/src/queries/practice.ts`（重写）+ `queries/practice.test.ts`、`packages/db/src/schema.test.ts` 对齐断言。**不得改 server / tools / client / agent / shared**。

**实现**（契约 = `docs/db/schema.md`「练习三表」+ `120-api-practice.md`）：迁移 013（drop 旧 `practice_targets` / 旧形状 `practice_samples`（含索引）→ 建三张新表，DDL 与 `tables.ts` 逐字同形、三表**不建索引**）；查询层 helper（样本五项 / 自由练习七项 / 素材包三项，库写入唯一入口、`queryDb`、JSON 防御解析、列表只出投影、`charCount` 走 SQL `length`、删除幂等）。

**验收命令**：`pnpm -r build`（其它包红窗只需报告）→ `pnpm --filter @whispering233/ai-editor-db test`。

**Commit**：`feat(db): 练习数据模型重建（迁移 013 + 三表查询层）`

---

### 卡 3：全部端点 + shared 契约（服务端 + 契约层）

**改动范围**：`packages/shared/src/types/api.ts`（练习三组端点 schema 全量重写 + `projectListRes` 条目 `authorId` / `projectConfigRes` `authorId` / `projectCreateReq` `author_id`）、`packages/shared/src/types/project.ts`（`author_id`）、`packages/server/src/routes/practice.ts`（全量重写）+ `practice.test.ts`、`packages/server/src/routes/project.ts` + `project.test.ts`、`packages/client/src/lib/api.ts`（练习新端点的客户端函数；**页面卡片只消费它，不再各自改它**）。**不得改任何页面 / 组件 / 导航**。

**实现**（契约 = `120-api-practice.md` 全篇、`10-api-project.md`、`60-practice.md` §2）：
1. 练习前置守卫：`kind !== "practice"` → 400 `KIND_MISMATCH`；`author_id` 解析不到预置作家 → 400 `VALIDATION_ERROR`「练习工作区未关联预置作家」（单点函数，两组端点共用）。
2. 样本五端点（列表投影 / 新建含 `work_id` 校验与 `excerpt_label` / 详情 / PUT 写稿 / DELETE）、素材包三端点（GET 生效内容 + `customized` / PUT strict 非空 / DELETE 幂等恢复预置）、自由练习五端点（列表 / 新建含 `topic_source` 两种分支 / 详情 / PUT 写稿 / DELETE）。
3. project 侧：`POST /project/create` 接受并落 `author_id`（仅 `kind = "practice"`；novel 传入或值不在预置清单 → 400 `VALIDATION_ERROR`）；`GET /project/list` 条目回 `authorId`；`GET /project/config` 回 `authorId`（无 → `null`）。
4. `client/lib/api.ts`：新端点函数（含 `ApiError` 语义与既有风格一致）。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-shared test` → `pnpm --filter @whispering233/ai-editor-server test`。

**Commit**：`feat(practice): 端点契约全量改版（样本 / 风格说明 / 自由练习 + author_id）`

---

### 卡 4：客户端 A — 文风练习两页 + 新建样本弹窗 + 范文导入

**改动范围**：`packages/client/src/pages/Practice.tsx`、`packages/client/src/pages/PracticeDetail.tsx`、`packages/client/src/components/practice/create-sample-dialog.tsx`（`create-target-dialog.tsx` 及其测试**删除**）、`packages/client/src/lib/practice.ts`、`packages/client/src/lib/document-io.ts`（`readTextFile` 编码回落）+ 各自测试。**不碰 `main.tsx` / `nav-items.tsx`（路由注册在卡 6）**。

**实现**（契约 = `DESIGN.md`「文风练习列表 / 练习详情 / 新建样本弹窗」、`60-practice.md` §9）：
1. 列表：按作品分组（预置作品清单顺序 + 末尾「其他」组，无样本的组不渲染，组内 `updatedAt` 倒序）；组内 `[+ 新建样本]` 预选该作品；页头右端 `[+ 新建样本]`（默认「其他」）；行 = 片段说明（空则留空）+ 状态徽标 + 相对时间；删「新建目标」与本页空态分支。
2. 详情：页头 title = 片段说明（空则作品名，`truncateTitle`）+ description = 作品名 + 作家名（删「文风目标 / 我的观察」）；三段保持（范文只读 → 我的稿 + 保存 + `Ctrl/Cmd+S` → 点评卡 + 「让 AI 点评」）。
3. 弹窗：关联作品 `select`（预置作品 + 「其他」，必选默认「其他」，`popupMatchSelectWidth={false}`）+ 片段说明 `input`（上限常量）+ 范文 `TextArea`（上限常量，`最多 N 字` 由常量插值）+ 「导入文本文件」（`.txt` / `.md`）。
4. `readTextFile`：`new TextDecoder("utf-8", { fatal: true })` 抛错 → `new TextDecoder("gb18030")`；**超上限不静默截断**（框内可见错误 + 保留原输入）；文件名去扩展名预填「片段说明」。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-client test`。

**Commit**：`feat(practice): 文风练习两页改版与范文文件导入`

---

### 卡 5：客户端 B — 自由练习两页 + 让 AI 出题

**改动范围**：`packages/client/src/pages/Free.tsx`（新建）、`packages/client/src/pages/FreeDetail.tsx`（新建）、`packages/client/src/components/practice/create-piece-dialog.tsx`（新建）、`packages/client/src/lib/free-practice.ts`（新建）+ 各自测试。**不碰 `main.tsx`（路由注册在卡 6）**；**不改** `lib/practice.ts`（卡面组件与判定从它导入）。

**实现**（契约 = `DESIGN.md`「自由练习列表 / 详情 / 新建题目弹窗」、`60-practice.md` §4）：
1. 列表：平铺 `data-row`（题目 / 「（待出题）」+ 四态徽标 + 相对时间）；页头右端 `[+ 新建题目]` + `[让 AI 出题]`。
2. 详情：三段 = 题目卡（题目 + 写作要求；空题态 `[让 AI 出题]` + 一行引导）→ 我的稿（`--writing-*`、保存、`Ctrl/Cmd+S`、字数）→ 点评卡（**复用卡 4 导出的卡面组件**，行标签「风格特征 / 你的写法」）。
3. 「让 AI 出题」：建空题行 → 发普通用户消息 + 聚焦聊天；`tool_execution_end` 的 details 帧刷新（出题与点评共用同款守卫）。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-client test`。

**Commit**：`feat(practice): 自由练习两页（自拟题 / AI 出题 / 按风格说明点评）`

---

### 卡 6：客户端 C — 根首页分区 + 左栏五项 + 路由守卫 + 三素材页

**改动范围**：`packages/client/src/pages/Dashboard.tsx`、`packages/client/src/stores/project.ts`、`packages/client/src/lib/workspace.ts`、`packages/client/src/components/nav/nav-items.tsx`、`packages/client/src/main.tsx`、`packages/client/src/hooks/use-route.ts`、`packages/client/src/lib/workspace-route-guard.ts`、`packages/client/src/pages/AuthorIntro.tsx`（新建）、`packages/client/src/pages/Works.tsx`（新建）、`packages/client/src/pages/StyleNotes.tsx`（新建，若卡 3 未建）+ 各自测试。

**实现**（契约 = `DESIGN.md`「根首页」「导航与外壳」「作家介绍 / 作品介绍 / 作家风格说明」、`60-practice.md` §9）：
1. 根首页练习分区：**预置作家卡**（全部预置作者；名字 + 一行介绍摘录 + 状态行 [未开始 / `N 篇范文 · 最近更新 …`]；排序 = 有数据 `updatedAt` 倒序在前、未开始按清单顺序垫后）；未识别 `authorId` 的练习项**不列出**（客户端过滤，服务端照列）；点未开始卡 = 懒创建（`name` = 作家名 + `author_id` + `kind: "practice"`，落 `#/practice`）；点已有卡 = 打开；**删「新建练习区」入口**。
2. 左栏练习态五项（作家介绍 `#/author` / 作品介绍 `#/works` / 作家风格说明 `#/style` / 文风练习 `#/practice` / 自由练习 `#/free`；图标走 `@ant-design/icons`）；路由注册五页 + `#/practice/:sampleId` / `#/free/:pieceId`。
3. 守卫：**练习专属首段清单单一定义**（上述五段）；练习工作区按允许清单放行（+ `#/` + `preferences`），小说工作区挡任一段 → `#/`；落点仍是 `#/practice`。
4. 三素材页：作家介绍（markdown 只读 `card`）、作品介绍（每部作品一卡）、作家风格说明（渲染 + 编辑 + 导入 `.md` + 恢复预置；导入 / 恢复走 danger 确认框；有覆盖时一行「当前为自定义版本」），编辑态 `TextArea` + 保存失败 `return false` 阻断存档。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-client test`。

**Commit**：`feat(practice): 根首页预置作家卡、左栏五项与素材三页`

---

### 卡 7：AI 工具面与内核提示词改版

**改动范围**：`packages/agent/src/runtime/system-prompt.ts`（**只重写 `PRACTICE_KERNEL_PROMPT`**）+ `system-prompt.test.ts`、`packages/tools/src/schemas/practice.ts` / `query/practice.ts` / `registry.ts` + 测试、`packages/shared/src/constants/tool.ts`（`TOOL_DETAILS_TO_CLIENT`）+ `constants.test.ts`、`packages/server/src/routes/chat.ts`（`context.practice_free_piece_id` + 注入展开）+ `chat.test.ts`、`packages/agent/src/runtime/{tools,project-runtime}.test.ts` 相关断言。

**实现**（契约 = `tool-calling.md` 练习段、`60-practice.md` §7 / §8、`80-api-chat.md`）：
1. 七件工具（四只读 + 三写 AI 产出），全部 `scope: "practice"`；点评工具 dimensions 上限与出题工具 topic / brief 上限**由常量插值**进描述。
2. 引用校验：仿写 = 范文 `或` 稿件子串；自由练习 = 风格说明（用户覆盖 `??` 预置）`或` 稿件子串；不匹配丢弃并计 `dropped_quotes`；空串 / 纯空白同路径。
3. `submit_practice_topic`：题目非空 → 抛错拒写。
4. 三个写工具的 `details` 进 `TOOL_DETAILS_TO_CLIENT`。
5. chat 注入：`practice_free_piece_id`（篇 id + 作家名 + 题目 + 写作要求；不存在 → 静默省略）；`practice_sample_id` 改为「样本 id + 作家名 + 作品名 + 片段说明」。
6. `PRACTICE_KERNEL_PROMPT` 重写（仿写点评者 + 自由练习点评者 + 出题者；保留不代写 / 引用须逐字 / 先读后评 / 维度自定 / 长度截断须知；新增「出题要给可执行的写作要求」；仿写以范文为主、可按需读风格说明）。
7. **硬判据（oracle 独立核）**：小说版 `KERNEL_PROMPT` **零 diff**；小说工具 schema/description 与小说注入分支无改动。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-tools test` → `pnpm --filter @whispering233/ai-editor-agent test` → `pnpm --filter @whispering233/ai-editor-server test`。

**Commit**：`feat(practice): AI 工具面与内核提示词改版（自由练习点评 / 出题）`

---

### 卡 8：全链路收口与验证

**改动范围**：缺陷修复（仅限改版链路内的真实缺陷）、`docs/design/tasks.md` 清卡、`CHANGELOG.md` 校对。**不新增功能**。

**实现**：
1. `pnpm -r build` → `pnpm typecheck` → `pnpm lint` → `pnpm -r test` **全绿**（红窗在此关闭）；把命令与输出摘要写进汇报。
2. 逐条核对实现 ↔ 文档（`60-practice.md` / `120-api-practice.md` / `schema.md` / `DESIGN.md`），发现漂移就地修并在汇报中列出。
3. **浏览器像素走查委托 `ui-verifier`**（核验项：根首页练习分区预置卡与懒创建 / 左栏五项 / 风格说明渲染与编辑 / 文风练习分组列表与新建样本（含导入文件）/ 自由练习出题与点评 / 详情页排版）；发现问题回到对应卡修完再复验。
4. 清空本批卡片；确认 `CHANGELOG.md` Unreleased 段与最终实现一致（含迁移 013 说明）。

**验收命令**：上列四条 + ui-verifier 报告（无未 proven 项）。

**Commit**：`chore(practice): 改版收口（全量回归与文档对齐）`

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。