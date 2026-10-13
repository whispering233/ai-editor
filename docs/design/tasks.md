# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 文风仿写练习 · 批次 0（地基）

> 契约依据：`docs/design/60-practice.md`、`docs/design/00-master-design.md`（工作区抽象）、`docs/design/architecture.md`（kind 与能力收窄）、`docs/db/schema.md`（两张练习表）、`docs/api/120-api-practice.md`、`docs/ui/DESIGN.md`（根首页分区 / 文风练习区）。**契约已先行更新——卡内不再自行发明口径，发现矛盾先停下提问。**

- [ ] **卡 1 · `kind` 贯通（shared + server）**
  - 范围：`ProjectFileConfig.kind?` / `ProjectConfig.kind`（恒下发）；shared 常量表 `WORKSPACE_DIRS`（`novel → books`、`practice → practice`）；`POST /project/create` 接受 `config.kind`（缺省 novel）；`GET /project/list` 扫两个目录 + 每项带 `kind`（字段名保留 `books`）。
  - 依赖：无（可与卡 2 并行）。
  - 硬完成判据：旧 `project.json`（无 kind）读为 `novel`；`create` 带 `kind: "practice"` 后 `project.json` 有该键；`list` 同时列出两个目录且带 `kind`；`pnpm typecheck` / `pnpm lint` / 单包测试绿。
- [ ] **卡 2 · 迁移 012 + 两张练习表 + db helper**
  - 范围：`CREATE_TABLES_SQL` 加两表 + 索引（与迁移 DDL **逐字同形**）；`migrations/012_practice.ts`；`SCHEMA_VERSION` 11 → 12；db 包练习 helper（列表 / 详情 / 建 / 改 / 物理删 + 删目标级联删样本；`feedback` JSON 列**防御解析**，禁用 drizzle `mode:'json'`）。
  - 依赖：无（可与卡 1 并行）。
  - 硬完成判据：空库建表结构快照与迁移路径建出的结构一致（既有对齐断言）；迁移幂等（重跑不报错）；坏 JSON 的 `feedback` 不抛错且列表照常返回；级联删计数正确。
- [ ] **卡 3 · `requireKind` 守卫 + 两个新错误码**
  - 范围：中间件按路由组校验当前工作区 `kind`（novel 语义组：entity / outline / manuscript / relation / delta / trash / names；practice 组：practice；通用组不挂：project / chat / backup / cloud / settings）；shared `ERROR_CODES` 加 `KIND_MISMATCH`（400）与 `PRACTICE_NOT_FOUND`（404）；`export-novel` 与 `PUT /project/config` 的 `current_position` / `deduction_nodes` 按 kind 拒绝。
  - 依赖：卡 1。
  - 硬完成判据：练习工作区访问小说端点 → 400 `KIND_MISMATCH`（含 `export-novel`、含写 `current_position`）；小说工作区访问 `/practice/*` → 400；通用端点两种工作区均正常。
- [ ] **卡 4 · AI 侧按 kind 收窄（工具 scope + 提示词分叉）**
  - 范围：`ToolDefinition` 加 `scope`（`novel` / `practice` / `common`）并**逐个盘点全部既有工具**；装配层按当前工作区 `kind` 过滤（`createCustomTools` 加过滤参数）；练习版内核提示词常量（只做诊断、必须提交点评卡、不改写稿件）并在装配处按 kind 选提示词。
  - 依赖：卡 1。
  - 硬完成判据：练习工作区装配出的工具名集合 = 卡 6 的三个工具（且**无** `propose_*`）；小说工作区工具集合与本卡前一致（数量与名称逐个断言）；两种提示词各自断言关键段落存在/不存在。

## 批次 1（练习业务面）

- [ ] **卡 5 · practice REST 端点**
  - 范围：`/practice/targets`（列表 / 建 / 改 / 删）与 `/practice/samples`（列表 / 建 / 详情 / 改稿 / 删）；请求 snake_case、响应 camelCase；长度上限常量（建议 `MAX_PRACTICE_OBSERVATION_CHARS = 500`、`MAX_PRACTICE_SOURCE_LABEL_CHARS = 100`、`MAX_PRACTICE_SAMPLE_CHARS = 20000`、`MAX_PRACTICE_DRAFT_CHARS = 20000`）；`PUT` 稿件为 **strict 单字段**。
  - 依赖：卡 1、2、3。
  - 硬完成判据：目标/样本 CRUD 全绿；超限 → 400 `VALIDATION_ERROR`；不存在 → 404 `PRACTICE_NOT_FOUND`；删目标级联删样本且返回计数；稿件端点拒绝额外字段；请求字段名 snake_case（断言非法 camelCase 字段被拒）。
- [ ] **卡 6 · 三个练习工具（2 只读 + 1 提交）**
  - 范围：`get_practice_sample` / `get_practice_draft`（`offset` / `max_chars` 分页 + `truncated` 续读提示）/ `submit_style_feedback`（写 `feedback`）；**分页常量语义提升**：`DEFAULT_CHAPTER_TEXT_CHARS` / `MAX_CHAPTER_TEXT_CHARS` 改名（如 `DEFAULT_TEXT_PAGE_CHARS` / `MAX_TEXT_PAGE_CHARS`），两处引用（工具描述插值与实现 clamp）同改；`MAX_FEEDBACK_DIMENSIONS = 6`（描述由常量插值）；引用子串校验（范文 / 稿件）。
  - 依赖：卡 2、4。
  - 硬完成判据：分页截断时**显式告知**且续读提示不被外层截断切掉（实测 `stringifyToolResult` → `truncateToolResultText` 路径，留白 ≥10%）；无效引用被丢弃并计入 `dropped_quotes`；维度超上限被拒；改上游 `shared` / `tools` 后先 `pnpm -r build` 再跑测试。
- [ ] **卡 7 · 点评链路（`/chat` 注入 + 卡片下发 + 落库）**
  - 范围：`chatRequestSchema.context.practice_sample_id`；服务端现读目标名 + `observation` 注入本轮（**不接受客户端传入观察文本**）；样本不存在静默省略；卡片随 `tool_execution_end` 的 `details` 下发；前端即时渲染 + 刷新从 `GET /practice/samples/:id` 读。
  - 依赖：卡 5、6。
  - 硬完成判据：**SSE 帧集零新增**（与 `docs/api/80-api-chat.md` 一致）；一轮后 `feedback` 已落库；重载页面卡片仍在；注入文本含目标名与观察、**不含范文/稿件全文**（断言）。

## 批次 2（UI）

- [ ] **卡 8 · 根首页分区 + 新建弹窗 kind + 左栏按 kind**
  - 范围：`#/` 两分区（小说 / 文风练习，空分区给引导文案）；新建弹窗加 kind；NavRail 按 kind 渲染项集与顶部标识文案（练习 = 顶部「文风练习」+ 一级导航「文风练习」+ 无回收站）；练习工作区下 novel 页面路由不可达。
  - 依赖：卡 1。
  - 硬完成判据：浏览器像素核对（`ui-verifier` 子代理）：两个分区可见、当前工作区高亮按 id、练习工作区左栏无八项导航、无控制台报错。
- [ ] **卡 9 · 练习列表页（`#/practice`）**
  - 范围：目标分组 + 样本行（来源说明 / 状态徽标 / 相对时间）+ 新建目标 / 新建样本弹窗 + 空态；页头常驻模板。
  - 依赖：卡 5、8。
  - 硬完成判据：浏览器核对：建目标 → 建样本 → 列表出现且状态徽标随稿/点评变化；空态文案可见。
- [ ] **卡 10 · 练习页（`#/practice/:sampleId`）**
  - 范围：范文（只读）→ 我的稿（`TextArea`，间接引用 `--writing-*`，不引 `--paper-bg`）→ 点评卡；保存按钮 + `Ctrl/Cmd+S`（接入既有注册栈，失败 `return false`）；「让 AI 点评」按钮。
  - 依赖：卡 7、9。
  - 硬完成判据：浏览器核对：三段几何（页头常驻、正文区可滚）；`Ctrl+S` 触发保存（失败路径阻断存档）；点评后卡片即时出现且重载仍在；窄幅下不溢出。

## 批次 3（收尾）

- [ ] **卡 11 · 导出 / 删除 / 备份在练习工作区上的口径 + 冒烟**
  - 范围：根首页导出弹窗按 kind 隐藏「小说文档」项（服务端已有 `KIND_MISMATCH`）；删练习工作区走既有 `/project/delete`（含云前置推送与目录约束）；确认备份文件名统计段在练习工作区自然为 `0-0-0`（`getBackupStats` 空库口径）且不做特殊分支；启动冒烟；**同步 `README.md` 的根首页 / 左栏描述**（README 描述产品当前状态，不提前改）。
  - 依赖：卡 3、8。
  - 硬完成判据：练习工作区导出三文件包成功、`export-novel` → 400；删练习工作区后书架/根首页刷新正确；练习工作区自动备份产出的文件名可被解析（格式未变）；`pnpm -r test` 全绿。

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
