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

### A1 上下文预算配置化（`context_budget`）+ 生效预算随 done 帧下发

**契约**（已改文档）：`docs/design/config.md`「可配 / 不可配边界」、`docs/api/90-api-settings.md` 字段表、`docs/api/80-api-chat.md` done 帧、`docs/design/20-context.md` §1 预算口径表。

**改动面**：

1. `shared/types/api.ts`：新增 `contextBudgetSchema`（`history_ratio` ∈ (0,1]、`tool_result_max_tokens` 正整数，均可选）；`userConfigFileSchema` 加 `context_budget` 字段——**必须是宽松读取**（`.catch({})` 之类）：`context_budget` 非法不得让整份用户配置回落空（否则用户 provider/model/api_keys 会静默丢失）；`sseDoneEventSchema` 加可选 `context_budget: { history: number; total: number }`。
2. `server/routes/settings.ts`：导出 `getContextBudget()`（默认 `history_ratio 0.15` / `tool_result_max_tokens 8000`，非法/缺失回落默认）与 `resolveContextBudgets(contextWindow)`：总闸 `gate = window × 0.5`，历史预算 = `min(window × ratio, gate − 8000)`，被 clamp 时记日志。
3. `server/routes/chat.ts`：用激活的 provider/model 取 `contextWindow`（`resolveModelInfo`）→ 算 budgets 与 `tokenBudget` 传 `runAgent`；`done` SSE 帧转发 `context_budget`。
4. `agent/context.ts`：`AssembledContext` 新增生效预算字段（`{ history, total }`，`total` = history 预算 + system + toolList + focus 四层之和）；`agent/run.ts` 在 `done` 事件携带（新轮到才计算，无需额外请求）。

**验证**：单测（配置回落、clamp、done 事件字段、SSE 帧字段）+ `pnpm typecheck` / `pnpm lint` / `pnpm -r test`。

### A2 工具结果上限接线 + 裁剪护栏

**契约**（已改文档）：`docs/api/error-code.md` `TOOL_RESULT_TOO_LARGE` 行、`docs/design/30-agent-loop.md` §1、`docs/design/20-context.md` §1 不变式。

**改动面**：

1. `agent/run.ts`：工具结果回填前调 `truncateToolResult(content, toolResultMaxTokens)`（**已实现**于 `llm/src/token.ts:60-95`，全仓无消费者——本次接线）；阈值经 `RunAgentInput` 传入（默认 8000）；截断时写调试日志（usage 类别）；**不得**因截断终止对话。
2. `agent/context.ts` + `agent/session.ts`：裁剪护栏——`trimHistoryToBudget` 二分结果为 0 时**保住最后一个配对块**（宁可略超预算，不得发无历史的请求）；`meta` 增护栏命中标记。

**验证**：单测（超限截断含提示文案、未超限原样、护栏命中、单块超预算不裁空）+ 三命令。

### A3 前端占用条改「生效预算」口径

**契约**（已改文档）：`docs/ui/DESIGN.md` `usage-bar` 条目。

**改动面**：`client/src/stores/chat.ts`（`contextBudget` 状态 + done 帧读取）、`client/src/components/chat/ChatPanel.tsx`（占用条分母改 `contextBudget.total`；`title` 改 `本轮 tokens / 生效预算 tokens`；**未收到 `context_budget` 时隐藏占用条**，不回退窗口分母）。

**验证**：单测 + headless 像素走查（subAgent）。

---

（上一轮任务卡已全部完成并清理：见 `CHANGELOG.md` Unreleased 与本文件 git 历史。）
