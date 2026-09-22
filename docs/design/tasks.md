# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 会话状态栏（输入区底行观测层）

> 契约依据：`docs/api/80-api-chat.md` §会话用量字段、`docs/ui/DESIGN.md` `session-status-bar`、`docs/design/20-context.md` §2 / §2.1。依赖链 1 → 2 → 3 → 4 → 5 → 6，**不并行**（后卡吃前卡的字段名）。

- [ ] **卡 1｜契约文档更新**：把口径落成文档（`docs/api/80-api-chat.md` 帧表 + §会话用量字段 + 历史响应 + `contextUsage` 允许 `null`；`docs/ui/DESIGN.md` `usage-bar` → `session-status-bar`；`docs/design/20-context.md` §2 占用 `null` 语义 + §2.1 用量口径；`docs/design/backlog.md` 延期项）。
  - 判据：文档间互不矛盾；无「卡 N / 批次 N」编号；阈值/上限一律引用常量名、**不复述数字**；`git log` 含新 commit 且 `git status` 干净。
- [ ] **卡 2｜shared schema + agent 模块**：`chatContextUsageSchema`（`tokens`/`percent` 容许 `null`）、`chatUsageSchema`（6 字段 + `cacheHitRate?` + `subscription`）、`chatMessagesResSchema` 增 `usage`；新增 `agent/src/runtime/usage.ts`（`sessionUsage(entries, { isUsingOAuth })`）与 `agent/src/runtime/speed.ts`（`createSpeedMeter({ now })`）+ 单测。**纯新增，无消费方**。
  - 判据：`pnpm -r build` 绿；`pnpm --filter @whispering233/ai-editor-agent test` 绿（守卫分支逐条有用例：命中率分母 0 / 订阅判定 / 无增量 / `output<=0` / 时长低于常量 / `error`·`aborted`）；汇报附 commit hash 与命令输出。
- [ ] **卡 3｜帧与历史端点下发**：`agent/src/runtime/events.ts` 增 `getSessionUsage` / `speedMeter` 选项并在 `turn_end` / `agent_end` 附 `usage`、assistant `message_end` 附 `speed`（含「纯函数」注释不变式修订）；`server/src/routes/chat.ts` 每流建 meter + 历史响应填 `usage`，`contextUsageField` 与帧同源。
  - 判据：`pnpm --filter @whispering233/ai-editor-server test` 绿（断言帧含 `usage`/`speed`、历史含 `usage`、`tokens=null` **不丢帧**）；`pnpm typecheck` / `pnpm lint` 绿。
- [ ] **卡 4｜client store 状态与解析**：`stores/chat.ts` 增 `usage` / `speed` 状态 + 解析（非法即 `null`；`contextUsage` 的 `tokens`/`percent` 放宽为可 `null`）+ 帧处理（`turn_end` / `agent_end` / `message_end`）+ 四处清零点（切会话 / 新会话 / 切项目；流开始**不**清）。
  - 判据：`pnpm --filter @whispering233/ai-editor-client test` 绿（含 `tokens=null` 三态用例与清零点用例）。
- [ ] **卡 5｜状态栏组件 + 配置行剥离**：新增 `client/src/lib/session-status.ts`（格式化 / 阈值常量 / 三态视图 / 项清单与优先级 / title 组装，`usageBarView` 迁入）与 `components/chat/session-status-bar.tsx`；`ChatPanel.tsx` 把占用条从配置行移出、输入区末尾渲染状态栏、`usageBarView` 导出迁走。**含容器查询最小验证**（Tailwind v4 `@container` + 两级阈值；不通则回退 `index.css` 手写 CSS——面板宽 ≠ 视口，media query 不可替代）。
  - 判据：`pnpm typecheck` / `lint` / client 测试绿；SSR 走查覆盖三态 / 整行无数据不渲染 / 拆解只读不渲染；浏览器像素核窄栏两级隐藏与一行几何。
- [ ] **卡 6｜端到端验收（真实数据）**：真实会话跑一轮，数字与 pi 侧对账（TUI footer 或 `/session`）；压缩后 `? · 窗口` 态；历史会话（有账目、无速度、占用 `?`）；拆解只读会话无状态栏；切项目清零；窄栏两级隐藏。
  - 判据：实拍证据 + 数字与上游一致；**不以单测代替**；新发现的问题进 `backlog.md`。

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
