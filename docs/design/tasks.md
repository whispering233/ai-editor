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

批次 B：对话历史从 `chat_messages` 表迁到项目目录 `sessions/*.jsonl`（契约已改：`docs/db/schema.md`、`docs/design/10-data-model.md` §1/§10/§11、`docs/api/80-api-chat.md`、`docs/api/error-code.md`、`docs/api/20-api-backup.md`、`docs/design/30-agent-loop.md` §4、`docs/design/architecture.md`、`docs/ui/DESIGN.md`）。**API 响应结构不变（除新增 DELETE）**。

### B1 `db` 包会话 JSONL 存储模块

新增 `packages/db/src/sessions.ts`（纯 fs，不经 drizzle）+ 单测。契约：`docs/db/schema.md`「sessions/*.jsonl」节（行格式 + 读取容忍规则 + 列表口径）。

导出：`isValidSessionId` / `SESSION_ID_PATTERN`、`appendSessionMessage`（文件不存在 → 先写 header 再追加消息行）、`readSessionRows`（未知 type 跳过、坏行跳过、缺 `created_at` 跳过、header 缺失或 `version > 1` 整文件跳过）、`listSessionSummaries`（扫目录聚合 `ChatSessionSummary`，排序/截断口径同现状）、`deleteSessionFile`（返回是否删除）、`writeSessionFile`（整文件重写，供迁移用，幂等）、`sessionsDirPath`。id 非法 → 抛错/返回 null，**绝不拼接路径**。

### B2 迁移 006（导出 + DROP 表）+ 迁移框架透传项目目录

- `Migration.up` 签名扩为 `(db, ctx: { projectRoot })`（现有迁移少参可赋值，不改它们）；`runMigrations` / `ensureSchemaCompatible` 把项目目录传下去。
- `006_sessions_jsonl.ts`：读 `chat_messages`（`ORDER BY session_id, created_at, rowid`）→ 按 session 分组 → `writeSessionFile` → `DROP TABLE chat_messages`；导出按表重写 ⇒ 幂等（崩溃重跑不脏）。
- `SCHEMA_VERSION` 5 → 6；`tables.ts` 移除 `chat_messages` 定义与 DDL（`schema.test.ts` 对齐断言同步）；`queries/chat.ts` 随之删除（若还有纯函数被消费，移到消费方或 B3 处理）。
- 测试：v5 库带旧表 → 迁后文件在、表没了、内容/顺序与旧查询一致；v1→v6 链路仍通；迁移失败可重试。

### B3 server 接线 + 删除端点

- `routes/chat.ts`：落库/列表/历史读全部改走 `sessions.ts`（`ChatMessageRow[]` 形态不变 → `agent` 包零改动）。
- `DELETE /api/v1/chat/sessions/:id`：400 `VALIDATION_ERROR`（id 形态非法）/ 404 `SESSION_NOT_FOUND` / 409 `SESSION_BUSY`（会话有在途流）/ 200 `{ deleted: true }`；在途集合与 SSE 生命周期同生共死。
- `shared`：`ERROR_CODES` 补两码 + 删除响应 schema。

### B4 备份管道接 `sessions/`

白名单（`sessions/` 前缀且拒 `..`）、打包（递归）、变更判定（`sessions/` 文件 mtime 参与「有变更才备份」）、恢复/导入整体覆盖（清本地残留——与 `references/` 同语义）。删除 `migrateChatMessagesProject` 相关路径与 `project.ts` 调用点。

### B5 client 会话删除入口

`Conversations` 的 `menu` → 「删除会话」→ `ConfirmDialog`（danger、「删除后无法恢复」）→ `DELETE` 接口 → 列表移除；删的是当前会话 → 回「新会话」；`streaming` 期间禁用。契约：`docs/ui/DESIGN.md` `chat-session-item-menu`。验证含 headless 像素走查。

---

（A1-A3 已完成并验证：上下文预算配置化 / 工具结果上限 + 裁剪护栏 / 占用条改生效预算——见 `CHANGELOG.md` Unreleased 与本文件 git 历史。）
