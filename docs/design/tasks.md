# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 会话状态栏（输入区底行观测层）

> 契约依据：`docs/api/80-api-chat.md` §会话用量字段、`docs/ui/DESIGN.md` `session-status-bar`、`docs/design/20-context.md` §2 / §2.1。卡 1–6（契约定稿 → schema/agent 模块 → 帧与历史下发 → client store → 状态栏组件 → 端到端验收）已完成并进 CHANGELOG。

- [ ] **卡 7｜历史会话的占用段窗口**（端到端验收发现）：`docs/design/20-context.md` §2.1 承诺历史会话的占用段渲染 `? · 窗口`，但历史响应不带 `contextUsage` ⇒ 实际整段隐藏（与契约不符）。修法 = 历史端点只补「窗口」不重建占用：`server/src/routes/chat.ts` 历史响应填 `contextUsage: { tokens: null, percent: null, contextWindow }`（窗口取当前激活模型目录；无模型 / 无窗口 → **省略该键**）；`shared/src/types/api.ts` 的 `chatMessagesResSchema` 增**可选** `contextUsage`；`client/src/stores/chat.ts` 的 `loadMessages` 解析进 `contextUsage`（缺省 / 非法 → `null`，与 usage 同一 `seq` 守卫内）；`docs/api/80-api-chat.md` 历史响应注记改写（「不承诺 `contextUsage`」→「只带窗口、不重建占用」）。
  - 判据：`pnpm -r build` 绿；server 测试断言「有模型 → 响应带 `tokens`/`percent` 为 `null` 的 `contextUsage`」「无模型 → 省略键」；client 测试断言 `loadMessages` 写入该值 / 缺省置 `null`；`pnpm typecheck` / `pnpm lint` 绿；浏览器复验历史会话占用段显示 `? · 1M` 且不画条。

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
