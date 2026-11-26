# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 本轮：每日目标与连续天数（客户端派生，零新增表 / 端点）

契约（先读，卡内不得自行发明口径）：
`docs/api/130-api-writing-stats.md`「每日目标与连续天数」→ `docs/ui/DESIGN.md`「码字统计页 · 今日目标」与 `writing-page`「卷章导航栏 · 今日目标元信息行」→ `docs/design/config.md` §1 的 `ai-editor:writing-goal:{projectId}`。

#### 依赖顺序与并行度

- `K1 → K2 →（K3 ∥ K4）`。K1 与 K2 串行（K2 消费 K1 的常量与类型）；K3 / K4 改不同文件，可并行；基座 = K1 + K2。
- 每卡一 commit，卡内不做卡外顺手改动。验证命令：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`（单包 filter 与 package.json 的 `name` 逐字一致）。

---

### K1 · 目标与连续天数的纯函数 + 常量

- **改动面**：新增 `packages/client/src/lib/writing-goal.ts` 与其 `.test.ts`。不改任何现有文件的行为。
- **内容**：
  - `WRITING_GOAL_PRESETS`（档位表，**单一定义**；首项取 `WRITING_HEAT_THRESHOLDS[1]`，**严禁写数字字面量**）。
  - 偏好形状 `{ goal, enabled, writingDays }` + 缺省值（首档 / 开启 / 全勾）。
  - `parseWritingGoalPreference(raw)`：坏 JSON / 缺字段 / 非有限 / 负数 / 非法周序号 → 回落缺省。
  - `goalProgress(days, today, goal)` → `{ chars, reached }`；`currentStreak(days, today, goal, writingDays)` → 天数；写作日判定（空集合按全勾）。
- **口径（不得偏离）**：严格连续；未勾的写作日既不要求也不中断；`today` 尚未达标不算断签；只消费 `days[]` + `today`，**不自行生成「今天」**。
- **判据**：单测覆盖 断日 / 跨月 / 闰日 / 未勾写作日 / 今天未达标 / 空 `days` / 坏偏好 / 空 `writingDays`。`pnpm typecheck` + `pnpm lint` + `pnpm --filter ai-editor-client test` 绿。

### K2 · 目标偏好 hook

- **改动面**：新增 `packages/client/src/hooks/use-writing-goal.ts`（照 `use-setting-desc.ts` 模板：解析纯函数 + 读写 `try/catch`，隐私模式静默）。
- **内容**：key = `ai-editor:writing-goal:{projectId}`（**按书隔离**，`projectId` 变化即重读）；对外给 `{ preference, setGoal, setEnabled, setWritingDays }`；写回走 K1 的解析归一。
- **判据**：无 localStorage / 坏值 / 切书三种情形行为明确（坏值回落缺省、不抛）；`pnpm typecheck` + `pnpm lint` + `pnpm --filter ai-editor-client test` 绿。

### K3 · 统计页「今日目标」卡

- **改动面**：`packages/client/src/pages/WritingStats.tsx` + 新建 `packages/client/src/components/stats/goal-card.tsx`（+ SSR 走查测试）。
- **内容（照 `DESIGN.md`「码字统计页 · 今日目标」，逐条对齐）**：位置 = 摘要四卡之后、码字日历之前；关闭态整卡只留标题 + 「每日目标已关闭」，**开关仍在**；进度条自绘（宽度百分比 + `bg-primary`，**不引入 antd `Progress`**）；`{今日字数} / {目标} 字` + `连续 N 天`；达标态主色 + `✓`；`Segmented` 档位（常量取值）+ 写作日 `Checkbox.Group`。今日 0 字照常渲染，不打 `EmptyState`。**达成不弹 toast、不发系统通知**。
- **判据**：契约要素全部到位且有 SSR 走查断言；不新增色值 / 字号（`design-discipline.test.ts` / `antd-tokens.test.ts` 绿）；三命令全绿。

### K4 · 写作页 rail 元信息行「今日目标」

- **改动面**：写作页 rail 页头（`packages/client/src/pages/Writing.tsx` / `components/manuscript/` 下承载 `PanelHeader` 的组件）+ 节流判定的纯函数与单测。
- **内容（照 `DESIGN.md` `writing-page`「卷章导航栏 · 今日目标元信息行」）**：`今日 {已写} / {目标} 字 · 连续 {N} 天`，`caption-text` + `tabular-nums` + 单行 `truncate`；达标态主色 + `✓`。数据源 = `GET /writing-stats` 的**第二个消费点**：进页拉一次 + 保存成功后按节流窗口刷新（窗口常量单源）；**不做**「服务端 today + 客户端本次增量」相加。目标关闭 / 未打开项目 / 拉取失败 / 无数据 → 整行不渲染（失败静默）。**不加任何浮层**。
- **判据**：节流判定是纯函数且有单测；行在四种不渲染情形下确实不渲染（SSR 走查）；三命令全绿。
