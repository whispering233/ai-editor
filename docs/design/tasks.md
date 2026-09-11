# 开发任务清单（Task Cards）

开发任务卡，**垂直切片**组织。契约依据：`docs/api/`、`docs/db/schema.md`（字段/端点）、`docs/ui/DESIGN.md`（**视觉与布局唯一契约**：颜色/字号/圆角/组件外观 + antd token 覆盖表）。

**执行纪律**：

- 一次只做一张卡，验证通过（含测试）才算完成，然后独立 commit（一卡一 commit，回滚 = revert 该 commit）；卡内不做卡外顺手改动。
- 契约以 `docs/api`、`docs/db` 为准；发现文档之间或文档与代码矛盾，先停下提问，不要自行发明。
- 验证：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`；**视觉改动额外跑** `designmd lint docs/ui/DESIGN.md` + `packages/client` 的 `design-discipline.test.ts`（14 条源码守卫）与 `antd-tokens.test.ts`（5 条派生 token 守卫）。
- **视觉改动顺序**：先改 `docs/ui/DESIGN.md`（契约）→ 再改 `AntdProvider.tsx`（token 唯一入口）→ 最后改调用点。
- **改完必须看像素**：类型检查与既有测试对 antd 的静默失效（无层 CSS 覆盖、cssVar 作用域、`color`+`variant`、派生 token 对比度）完全无感——headless 探针或 `pnpm start:test-project` 实测一次。
- 并行卡片用临时分支 + git worktree（细节见根 `AGENTS.md`）。

---

## 当前任务卡

批次 B：对话历史从 `chat_messages` 表迁到项目目录 `sessions/*.jsonl`（B1 已完成并验证：`db` 包会话 JSONL 存储模块）（契约已改：`docs/db/schema.md`、`docs/design/10-data-model.md` §1/§10/§11、`docs/api/80-api-chat.md`、`docs/api/error-code.md`、`docs/api/20-api-backup.md`、`docs/design/30-agent-loop.md` §4、`docs/design/architecture.md`、`docs/ui/DESIGN.md`）。**API 响应结构不变（除新增 DELETE）**。

### B2 存储切换（原子：迁移 006 + 框架透传 + server 接线）

**必须一次落地**（拆开会中途红：DROP 表后旧查询仍在用）。

- `Migration.up` 签名扩为 `(db, ctx: { projectRoot })`（现有迁移少参可赋值，不改它们）；`runMigrations` / `ensureSchemaCompatible` 把项目目录传下去。
- `006_sessions_jsonl.ts`：读 `chat_messages`（`ORDER BY session_id, created_at, rowid`）→ 按 session 分组 → `writeSessionFile`（B1）→ `DROP TABLE chat_messages`；按表整文件重写 ⇒ 幂等；**id 不合法（不匹配 `sess_` 白名单）的旧会话跳过并计数**，不阻断迁移。
- `SCHEMA_VERSION` 5 → 6；`tables.ts` 移除 `chat_messages` 定义与 DDL（`schema.test.ts` 对齐断言同步）；删除 `queries/chat.ts`（`parseToolCalls`/`reassembleMessages` 若无消费者一并删）。
- `server/routes/chat.ts`：`insertChatMessage` → `appendSessionMessage`；`listMessageRows` → `readSessionRows`（**去掉 `project_id` 过滤**——会话归属由目录表达，该过滤会把历史静默过滤成空）；`listSessions` → `listSessionSummaries`；`listMessages` → 由 rows 构造 `ChatMessage`（`sessionId` 填当前传入 id、`projectId` 填当前项目 id）。
- `server/backup.ts`：删除 `migrateChatMessagesProject` 调用点（会话不再依赖 project_id 归属；其余备份改造在 B4）。
- 测试：v5 库带旧表 → 迁后文件在、表没了、内容顺序与旧查询一致；旧会话 id 非法时跳过；server chat 路由全链路（落库 → 列表 → 历史）走文件。

### B3 删除会话端点

`DELETE /api/v1/chat/sessions/:id`：400 `VALIDATION_ERROR`（id 形态非法）/ 404 `SESSION_NOT_FOUND` / 409 `SESSION_BUSY`（会话有在途 SSE 流）/ 200 `{ deleted: true }`；在途集合与 SSE 生命周期同生共死。`shared`：`ERROR_CODES` 补两码 + 删除响应 schema。

### B4 备份管道接 `sessions/`

白名单（`sessions/` 前缀且拒 `..`）、打包（递归）、变更判定（`sessions/` 文件 mtime 参与「有变更才备份」）、恢复/导入整体覆盖（清本地残留——与 `references/` 同语义）。

### B5 client 会话删除入口

`Conversations` 的 `menu` → 「删除会话」→ `ConfirmDialog`（danger、「删除后无法恢复」）→ `DELETE` 接口 → 列表移除；删的是当前会话 → 回「新会话」；`streaming` 期间禁用。契约：`docs/ui/DESIGN.md` `chat-session-item-menu`。验证含 headless 像素走查。

---

（A1-A3 已完成并验证：上下文预算配置化 / 工具结果上限 + 裁剪护栏 / 占用条改生效预算——见 `CHANGELOG.md` Unreleased 与本文件 git 历史。）
