# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 卡 21.2 — 抽取结果契约 + 校验与归并纯逻辑

- **背景**：S2 产出必须逐章对齐、字段收窄；S3 归并要能脱离 LLM 与 db 单测。
- **契约**：`docs/design/60-decompose.md` §5（字段口径表 + 落库阈值）、§6（三层归并）、§6.1（`merge_written` 三路比对）；`docs/api/120-api-decompose.md`（响应结构）。
- **范围**：`packages/shared/src/types/api.ts` 增拆解请求/响应 schema 与抽取结果类型（client 消费）；新增 `packages/server/src/decompose/extract.ts`（逐章对齐校验 / 条数上限截断 / 关系类型白名单 / 引用名字存在性 / 字段长度上限）+ `packages/server/src/decompose/merge.ts`（name 归一化去重 / 关系聚合与对称归一（判据 = shared `RELATION_TYPE_META.symmetric`）/ 别名组硬校验 / 三路比对 → 写入计划）+ 各自单测。
- **判据**：单测覆盖：缺章报错 / 超条数截断 / 白名单外关系丢弃 / 不存在名字丢弃 / 别名组五条硬校验（名字必须存在 / 不重复分组 / 组 ≥ 2 / 组大小上限 / 候选截断）/ 三路比对四分支（含 `updated_at` 变化 → 不动）/ 对称关系方向归一 / 跨章阈值；改 shared 后先 `pnpm -r build` 再 `pnpm typecheck`（下游读 dist）。

---

## 卡 21.3 — DB 迁移 009 + db 层 helper

- **背景**：job 状态与批结果要随备份/导出/云走，放 `data.db`（不新增项目目录）。
- **契约**：`docs/db/schema.md` §decompose_jobs / decompose_batches（含不变式表）。
- **范围**：`packages/db/src/tables.ts` 两表声明（JSON 列 text 模式）；`packages/db/src/migrations/009_decompose.ts`（纯 DDL，幂等）+ `schema.ts` 的 `SCHEMA_VERSION` → 9；`packages/db/src/queries/decompose.ts`（job 读写 / 批读写 / `running` → `paused` 归一 / `merge_written` 读写）。
- **判据**：迁移测试（v8 → v9 升级、重复执行幂等、全新空库短路不重建）+ queries 单测；`pnpm --filter @whispering233/ai-editor-db test` 绿；`pnpm -r build` 后 `pnpm typecheck` 绿。

---

## 卡 21.4 — POST /decompose/analyze（切分预览，无状态）

- **背景**：客户端 POST 原始字节，服务端切分并返回预览 + 预估（范围变更 = 客户端重传，服务端无状态）。
- **契约**：`docs/api/120-api-decompose.md` §analyze；`docs/api/api-public.md` 请求侧原始字节例外。
- **范围**：`packages/server/src/routes/decompose.ts`（analyze 分支：体积上限 → 切分 → 预览 + 预估）+ 路由注册；预估读 pi 模型目录 `Model.cost`（经 `getModelRuntime()`，**不自建定价表**，未配置模型/凭据时 `costApprox = null`）；新增错误码入 `middleware/error.ts` 的 `SERVER_ERROR_CODES`。
- **判据**：路由测试：正常预览（编码/章数/统计/警告）/ 超体积 400 `DECOMPOSE_FILE_TOO_LARGE` / 解码失败或空文本 400 `DECOMPOSE_FILE_INVALID` / **不要求项目打开** / 范围参数只影响 `estimate`；**统计只展示 `totalChars`**（章字数和恒小于总字数——切片 trim 掉分隔换行，并排展示会让用户以为丢了字）；`pnpm --filter @whispering233/ai-editor-server test` 绿。

---

## 卡 21.5 — POST /decompose/start + job 骨架（S0/S1）

- **背景**：建档 + 导入正文 + 批规划落库；S1 同步完成后返回，客户端跳进度页。
- **契约**：`docs/api/120-api-decompose.md` §start / §job / §batches；`docs/design/60-decompose.md` §2 / §4。
- **范围**：`packages/server/src/decompose/job.ts`（job 创建 / 组批装箱 / 建大纲（卷→章）/ 逐章导入正文段落块（复用参考资料执行器的段落块形态）/ 写 `decompose_batches`）；`routes/decompose.ts` 的 start / job / batches 分支；凭据校验在建项目**之前**；副作用 = 打开项目 + 写创作根 `lastProject`。
  - **硬提醒（切分 oracle 实测登记）**：**不得拿 split 返回的 `charCount` 当偏移量裁文本**——它是近似计数（退化路径不含空行分隔符、正常路径 trim 掉分隔换行），当偏移量用会错位或丢字符；要裁文本必须自己按真实切片位置算。
- **判据**：路由测试：建档成功（`outline.json` 卷章数 / `document_records` 行数 / `decompose_batches` 行数三向断言）/ 书名冲突 409 / 凭据缺失 400 且**不留半成品项目** / 范围只影响批规划而正文**全量导入** / `GET /job` 不含批结果正文；`pnpm --filter @whispering233/ai-editor-server test` 绿。

---

## 卡 21.6 — S2 批执行器 + 暂停 / 续拆 / 重启归一

- **背景**：LLM 调用、逐章对齐护栏、重试与失败标记、状态机与取消。
- **契约**：`docs/design/60-decompose.md` §4 / §7；`docs/api/120-api-decompose.md` §pause / §resume。
- **范围**：`packages/server/src/decompose/runner.ts`（串行批循环、`DECOMPOSE_CONCURRENCY` 常量、逐章对齐校验、重试上限 `DECOMPOSE_BATCH_MAX_ATTEMPTS`、失败批继续、滚动故事圣经、取消通道）；暂停挂点 = `setCurrentProject` 单点（与 `disposeProjectRuntime` 同一处）；打开项目时 `running` → `paused` 归一；pause / resume 端点。
- **判据**：**faux provider 端到端**（注入假 LLM 返回固定 JSON，跑通 start → 全部批 `done`，断言批结果形状与状态）；暂停 / 续拆（跳过 `done` 批）；切书自动暂停；重启归一（直调归一函数断言 `running` → `paused`）；缺章重试与失败批不阻塞后续批；`pnpm --filter @whispering233/ai-editor-server test` 绿。

---

## 卡 21.7 — S3 归并 + S4 报告 + 幂等与单批重跑

- **背景**：归并写业务表 + 报告；重跑必须幂等且不覆盖用户手工编辑。
- **契约**：`docs/design/60-decompose.md` §6 / §6.1；`docs/api/120-api-decompose.md` §rerun。
- **范围**：`packages/server/src/decompose/merge.ts` 的写入执行（实体 / 关系 / 章摘要回写 `outline.json` / 报告 reference + 其块文档）+ 一次别名归并 LLM 调用（**纯逻辑已由 merge.ts 提供：去重 → 应用别名组 → 阈值 → 悬空关系过滤**，本卡只负责调 LLM 与按写入计划落库）+ `merge_written` 更新；rerun 端点（`done` 批重跑 → job 回 `running` → 重建归并与报告）。
- **判据**：**幂等回归**（同一份批结果跑两遍 S3 → 实体/关系数量不变）；`updated_at` 变化过的实体不被覆盖、不被软删；新产物里消失的实体被软删（回收站可还原）；章摘要回写大纲节点；报告 reference 不重复建；faux provider 全流程跑通；`pnpm --filter @whispering233/ai-editor-server test` 绿。

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
