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

批次 B：对话历史从 `chat_messages` 表迁到项目目录 `sessions/*.jsonl`（B1/B2/B3 已完成并验证：会话 JSONL 存储模块 + 存储切换 + 删除会话端点）（契约已改：`docs/db/schema.md`、`docs/design/10-data-model.md` §1/§10/§11、`docs/api/80-api-chat.md`、`docs/api/error-code.md`、`docs/api/20-api-backup.md`、`docs/design/30-agent-loop.md` §4、`docs/design/architecture.md`、`docs/ui/DESIGN.md`）。**API 响应结构不变（除新增 DELETE）**。

### B4 备份管道接 `sessions/`

白名单（`sessions/` 前缀且拒 `..`）、打包（递归）、变更判定（`sessions/` 文件 mtime 参与「有变更才备份」）、恢复/导入整体覆盖（清本地残留——与 `references/` 同语义）。

### B5 client 会话删除入口

`Conversations` 的 `menu` → 「删除会话」→ `ConfirmDialog`（danger、「删除后无法恢复」）→ `DELETE` 接口 → 列表移除；删的是当前会话 → 回「新会话」；`streaming` 期间禁用。契约：`docs/ui/DESIGN.md` `chat-session-item-menu`。验证含 headless 像素走查。

---

（A1-A3 已完成并验证：上下文预算配置化 / 工具结果上限 + 裁剪护栏 / 占用条改生效预算——见 `CHANGELOG.md` Unreleased 与本文件 git 历史。）
