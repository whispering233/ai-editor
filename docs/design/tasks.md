# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 卡 21.8 — 前端入口（书架按钮 + 拆解对话框 + api client）

- **背景**：入口在书架页：选文件 → 预览 → 填书名 → 开始拆解。
- **契约**：`docs/ui/DESIGN.md` §拆解小说（入口形态 / 预览三态 / token 复用，不新增色值字号圆角）。
- **范围**：`packages/client/src/lib/api.ts` 增 analyze / start（原始字节 POST，与既有 JSON 请求分支并存）；新增 `packages/client/src/components/decompose/decompose-dialog.tsx`（三态 + 可滚动章列表 + 范围 + 预估 + 书名）；`pages/Dashboard.tsx` 书架「新建一本…」行加 `button-default`「拆解小说」；错误文案入 `lib/error-messages.ts`。
- **判据**：单测（书名派生与校验复用 / 预估文案格式化 / 错误码 → 文案映射）；`pnpm --filter @whispering233/ai-editor-client test` / `pnpm typecheck` / `pnpm lint` 绿；浏览器走查**交 subagent**（选文件 → 预览 → 开始 → 跳转进度页）；`design-discipline.test.ts` 绿。

---

## 卡 21.9 — 前端进度页 `#/decompose` + 概览卡片 + 书架徽标

- **背景**：进度面（阶段条 / 进度条 / 批列表 / 展开看结果 / 重跑 / 中止续拆 / 完成总结）。
- **契约**：`docs/ui/DESIGN.md` §拆解小说（进度页结构、**页头常驻模板**、antd `Progress` 无组件级覆盖）；`docs/api/120-api-decompose.md`。
- **范围**：新增 `packages/client/src/pages/Decompose.tsx` + `hooks/use-decompose-job.ts`（轮询，终态停止）；`hooks/use-route.ts` 的 `KNOWN_ROUTE_SEGMENTS` + `main.tsx` 路由分支（含路由表注释）；`pages/Dashboard.tsx` 概览态增拆解任务卡 + 书架当前书行徽标。
- **判据**：单测（轮询终止条件 / 阶段映射 / 进度文案 / 批状态徽标映射 / 完成总结计数）；浏览器像素走查**交 subagent**（展开看结果、`done` 批重跑二次确认、中止 / 续拆、完成总结卡、概览卡片、书架徽标）；`design-discipline.test.ts` + `components/antd-tokens.test.ts` 绿。

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
