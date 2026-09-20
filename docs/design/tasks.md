# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 卡 21.6 — S2 批执行器 + 暂停 / 续拆 / 重启归一

- **背景**：LLM 调用、逐章对齐护栏、重试与失败标记、状态机与取消。
- **契约**：`docs/design/60-decompose.md` §4 / §7；`docs/api/120-api-decompose.md` §pause / §resume。
- **范围**：`packages/server/src/decompose/runner.ts`（串行批循环、`DECOMPOSE_CONCURRENCY` 常量、逐章对齐校验、重试上限 `DECOMPOSE_BATCH_MAX_ATTEMPTS`、失败批继续、滚动故事圣经、取消通道）；暂停挂点 = `setCurrentProject` 单点（与 `disposeProjectRuntime` 同一处）；打开项目时 `running` → `paused` 归一（**只归一 job 行**，见 `docs/db/schema.md` 不变式表）；pause / resume 端点。
  - **硬提醒**：续拆取批必须取「**第一个未完成批**」（含重启后残留的 `running` 批），不能只取 `pending`；读 `decompose_batches.result` 前自行守卫形状（db 层不做形状校验，`[1,2]` 这类值会原样透出）。
  - **本卡必须收口的两件（21.5 oracle 实测登记）**：
    1. **旧 job 暂停挂点**：`pauseRunningJobs` 目前全仓无调用点（21.5 未挂）；`api/120 §start` 已把「暂停旧项目上的 job」写成 start 的既有语义 ⇒ 本卡必须在 `setCurrentProject` 单点接线并有断言（否则会出现「A 书 job 永远 running」）。
    2. **stage = `merge` 的口径**：零批 job（`batchCount = 0`，空批数组 `every` 为真）stage 直接为 `merge`；本卡若以 stage 决定是否跑 S3，必须明确该口径并加断言。
- **判据**：**faux provider 端到端**（注入假 LLM 返回固定 JSON，跑通 start → 全部批 `done`，断言批结果形状与状态）；暂停 / 续拆（跳过 `done` 批）；切书自动暂停；重启归一（直调归一函数断言 `running` → `paused`）；缺章重试与失败批不阻塞后续批；`pnpm --filter @whispering233/ai-editor-server test` 绿。

---

## 卡 21.7 — S3 归并 + S4 报告 + 幂等与单批重跑

- **背景**：归并写业务表 + 报告；重跑必须幂等且不覆盖用户手工编辑。
- **契约**：`docs/design/60-decompose.md` §6 / §6.1；`docs/api/120-api-decompose.md` §rerun。
- **范围**：`packages/server/src/decompose/merge.ts` 的写入执行（实体 / 关系 / 章摘要回写 `outline.json` / 报告 reference + 其块文档）+ 一次别名归并 LLM 调用（**纯逻辑已由 merge.ts 提供：去重 → 应用别名组 → 阈值 → 悬空关系过滤**，本卡只负责调 LLM 与按写入计划落库）+ `merge_written` 更新；rerun 端点（`done` 批重跑 → job 回 `running` → 重建归并与报告）。
- **判据**：**幂等回归**（同一份批结果跑两遍 S3 → 实体/关系数量不变）；`updated_at` 变化过的实体不被覆盖、不被软删；新产物里消失的实体被软删（回收站可还原）；章摘要回写大纲节点；报告 reference 不重复建；faux provider 全流程跑通；`pnpm --filter @whispering233/ai-editor-server test` 绿。
- **必守调用顺序（merge oracle 登记）**：必须**先 `validateAliasGroups`，只把 `accepted` 传进 `applyAliasGroups`**——`mergeCandidates` 不重跑校验，直接传原始组可以发明实体名。
- **`AliasCandidate` 需补 `summary` 字段**（契约 §6 第 2 层要求 LLM 看到「短摘要」；当前类型无此字段）——取该人物出现章里最完整的一条 `description` 截断，勿让提示词输入与契约漂移。

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
