# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 移除「小说拆解」功能（4 卡）

**背景与决策（2026-09，用户定）**：拆解与「小说正文生成」是一体两面——超长小说无论怎么工程优化，都绕不开 LLM 会话上下文窗口爆满 / 腐化 / 漂移，产出物可信度无法自证；不可信的产出物不是本项目交付物。故整功能移除。已定口径：

- **D1**：加迁移 **011** `DROP TABLE` `decompose_jobs` / `decompose_batches`，`SCHEMA_VERSION` → 11（迁移 009/010 文件保留 = 旧库迁移链）。
- **D2**：`origin` 字段与书架分组**彻底删**（含 `PROJECT_ORIGINS` / `ProjectOrigin` / list 响应字段 / `lib/shelf.ts` 的 `groupShelfBooks`）；书架直接渲染 `bookshelf.books`。保留 `isCurrentBook`（按 id 判定当前书，与 origin 无关）。存量 `project.json` 里的 `origin` 残留键读侧忽略、不再写。
- **D3**：`decompose-` 会话只读守卫（前缀 409 + job 在跑禁删 + client 只读条/徽标）**全删**——无真实用户，拆解会话全是测试会话。`chatSessionSummary.name`（pi `session_info` 通用字段）**保留字段**、只改注释措辞。
- **D4**：`llm-discipline.test.ts` **删除**（拆解管线删后 server 侧已无 LLM 调用点），纪律只留 `AGENTS.md` 一条硬约束。
- **D5**：文档逐处清引用；`00-master-design.md` 保留一段**边界声明**（不做超长正文生成、也不做批量拆解导入）；`CHANGELOG` **现在写**（删 `Unreleased` 里从未发布的拆解条目 + 加 `Removed` 段），历史版本段一字不动。
- **D6**：存量拆解书数据一字不动（当普通书打开）；`sessions/decompose-*.jsonl`、`references/` 样本、`test-project` 的 `decompose` 配置段都不动；**.txt 导入建书路径整体消失**（用户已接受，不做替代）。

**执行纪律**：以下卡片按依赖顺序，卡 1 / 卡 2 **可并行**（worktree + 临时分支，验证后合回 main）；卡 3 依赖卡 1 与卡 2 合入后的 main；卡 4 收尾。一卡一 commit，回滚 = revert 该 commit。

---

### 卡 1：client 拆解面移除

**范围**：`packages/client/src` 里的拆解专属面 + `docs/ui/DESIGN.md` 的拆解小节。**不碰** `shared` / `db` / `server`（那是卡 2、卡 3）。

**删文件**：`pages/Decompose.tsx`、`pages/decompose-page.test.ts`、`pages/dashboard-decompose.test.ts`、`components/decompose/`（整目录 6 文件）、`hooks/use-decompose-job.ts` + `.test.ts`、`lib/decompose.ts` + `.test.ts`。

**改文件**：

- `main.tsx`：`Decompose` import、`case "decompose"` 分支（`#/decompose` 落回未知 hash 兜底 `#/`）。
- `hooks/use-route.ts`：`KNOWN_ROUTE_SEGMENTS` 去掉 `"decompose"`，注释里的路由表同步（`use-route.test.ts` 同步）。
- `pages/Dashboard.tsx`：`DecomposeDialog` import / 挂载、`useDecomposeJob` 轮询、`decomposeOpen` state、书架行「拆解中 N/M」徽标、`「拆解小说」`入口按钮、概览「拆解任务」卡、相关注释。**保留** `groupShelfBooks` 用（卡 3 才删分组）。
- `components/chat/ChatPanel.tsx`：`DecomposeReadonlyBar` + 只读态分支（输入区不渲染那套）、`isDecomposeSession` / `isJobRunning` 用法、「拆解」徽标、下拉打开时 `getDecomposeJob` 现拉、删除项 `jobRunning` 禁用、删除文案里的拆解措辞、相关注释（`chat-panel.test.tsx` 同步）。
- `lib/api.ts`：删拆解 API 区段（7 函数 + `DecomposeScope` 等本地类型）与 `Decompose*` import。
- `lib/error-messages.ts`：删 `describeDecomposeError`（测试同步）。
- `stores/chat.ts`：`DECOMPOSE_JOB_RUNNING` toast 分支（测试同步）。
- `components/shelf/book-delete-dialog.tsx`：删「在跑的拆解任务会被取消」一行（测试同步）。
- `components/chat/session-status-bar.tsx`：注释里「拆解只读会话不渲染」措辞。
- 其他测试里散落的拆解断言（`dashboard-shelf.test.ts` / `dashboard-cloud-restore.test.ts` / `lib/api.test.ts`）。

**文档**：`docs/ui/DESIGN.md` 删「拆解小说」整节（入口 / 对话框 / 进度页 / 概览卡 / 书架徽标）与 `chat-session-decompose` 只读态段；**分组段留卡 3**。

**硬完成判据**：

- `git diff --stat` 只含 `packages/client/**` 与 `docs/ui/DESIGN.md`；`rg -n 'decompose|Decompose|拆解' packages/client/src` **零命中**（`lib/shelf.ts` 的分组文案除外——卡 3 处理，属预期残留）。
- `pnpm -r build` → `pnpm typecheck` → `pnpm lint` → `pnpm -r test` 全绿；client 单包 `pnpm --filter @whispering233/ai-editor-client test` 绿。
- 汇报附 commit hash + 上述命令输出（截断即可）+ `git status` 干净。

### 卡 2：server 管线 + 端点契约 + chat 会话守卫移除

**范围**：`packages/server/src` 的拆解子系统 + 端点文档 + `chat.ts` 侧的拆解会话守卫（改守卫所需 import 来自已删模块，必须与管线同卡）。

> **2026-09 修订（边界收窄）**：shared / db 的拆解契约**不在本卡**。原因：`packages/db/src/queries/decompose.ts` 与 `packages/client/src/lib/api.ts` 都 `import type` 这些 `Decompose*` 类型 ⇒ 先删 shared 会把 db 与 client 弄红（卡 2 自身 worktree 不可能全绿）。它们随卡 3 与 db 层同批收口。

**删文件**：`packages/server/src/decompose/**`（11 实现 + 9 测试）、`routes/decompose.ts` + `.test.ts`、`llm-discipline.test.ts`、`scripts/decompose-batch-experiment.mjs`、`docs/design/60-decompose.md`、`docs/api/120-api-decompose.md`。

**改文件**：

- `server/src/index.ts`：`decomposeRoutes` import + `app.route("/api/v1/decompose", …)`。
- `server/src/middleware/error.ts`：8 个 `DECOMPOSE_*` 服务端扩展码（`SESSION_READONLY` 留卡 3）。
- `server/src/middleware/project.ts`：`cancelRunningDecomposeJobs` import + 调用（`pauseRunningJobs` / 存量补标 / 232 行 `origin` 注释留卡 3）。
- `server/src/routes/chat.ts`：第 10-11 行注释、`DECOMPOSE_SESSION_ID_PREFIX` + `decomposeSessionId` / `decomposeWorkerSessionPrefix` / `isDecomposeJobActive` import、357-359 行 409 `SESSION_READONLY`、`assertDecomposeSessionDeletable`（519-534）与 622/629 调用点（`routes/chat.test.ts` 的守卫用例同步删）。
- `shared/src/types/api.ts`：**只允许**改 `chatSessionSummarySchema.name` 的注释措辞（字段保留）；拆解端点 schema 段与 14 个 `Decompose*` 类型、`ERROR_CODES.SESSION_READONLY` 一律留卡 3。`shared/src/constants/decompose.ts` 与 `types/api.test.ts` 不动。

**文档**：整删 `60-decompose.md` / `120-api-decompose.md`；改 `00-api-index.md`（端点表整段）、`api-public.md`（请求侧原始字节例外段 + `job-` 前缀行）、`architecture.md`（server 职责）、`80-api-chat.md`（拆解会话只读/禁删/name 说明）、**`00-master-design.md:40` 改写为边界声明**（不做超长小说正文生成，也不做批量拆解导入——理由 = 上下文窗口爆满/腐化/漂移，产出物可信度无法自证）。`AGENTS.md` / `README.md` / `backlog.md` / `CHANGELOG.md` 留卡 4。

**硬完成判据**：

- `pnpm -r build` → `pnpm typecheck` → `pnpm lint` → `pnpm -r test` 全绿（本卡不删 shared 契约 ⇒ 全仓绿是可达的，不接受「分卡验收」）。
- `rg -n 'decompose|Decompose|拆解' packages/server/src` 只允许预期残留（逐条列出、附理由）：`middleware/project.ts` 的 `getDecomposeJob` / `pauseRunningJobs` import 与拆解注释（卡 3）、三个 project 类测试文件里用 db `createDecomposeJob` 造 job 行验保留行为（卡 3）、`routes/chat.ts` 对 shared 前缀常量的引用（若有，卡 3）。⚠ 修正：`SESSION_READONLY` 定义在 **shared 枚举**（`types/api.ts` 的 `ERROR_CODES`），不在 `middleware/error.ts` 的 `SERVER_ERROR_CODES`（卡 2 判据原文笔误）。shared / db / client 不在本卡 rg 范围。`git diff --stat` 只允许含 `packages/server/**`、`packages/shared/src/types/api.ts`（仅 name 注释行）、`scripts/**`、`docs/**`。
- `rg -n 'api/v1/decompose'` 零命中；`docs/design/60-decompose.md` 与 `docs/api/120-api-decompose.md` 已不存在。
- 汇报附 commit hash + 命令输出 + `git status` 干净。

### 卡 3：数据层与身份口径移除

**范围**：`db` 包 + `origin` 身份字段 + client 书架分组 + shared 拆解契约与会话前缀常量（2026-09 修订：由卡 2 移入，与 db 层同批收口）。

- `packages/db`：新增 `migrations/011_drop_decompose.ts`（`DROP TABLE IF EXISTS decompose_batches` / `decompose_jobs`，幂等、纯 DDL）、`SCHEMA_VERSION` → 11、`tables.ts` 删两表声明与 `CREATE_TABLES_SQL` 两段 DDL、删 `queries/decompose.ts` + 测试、`index.ts` 与 `migrations/index.ts` 的 import/注释；测试同步（`connection.test.ts` 表清单、`schema.test.ts`、`queries/migration.test.ts`，**新增 v10 → v11 用例与「全新库无这两表」用例**）。
- `packages/server/src/middleware/project.ts`：`pauseRunningJobs` / `getDecomposeJob` / 存量 `origin` 补标（122-135）/ `initProject` 的 `origin` 参数与 232 行注释；`routes/project.ts` 289-290 的 `origin ?? "book"` 归一与三处注释（81 / 829 / 863）。
- `packages/shared`：删 `types/api.ts` 的**拆解端点 schema 整段**（analyze/start/plan/continue/job/batches/log/pause/resume/rerun + 14 个 `Decompose*` 类型）与 `ERROR_CODES.SESSION_READONLY`（`types/api.test.ts` 的拆解用例同步删）；删 `constants/decompose.ts` 整文件 + `constants/index.ts` 导出行；删 `constants/project.ts` 整文件（`PROJECT_ORIGINS` / `ProjectOrigin`）；`types/project.ts` 的 `origin?` 字段；`types/api.ts` 的 `projectListResSchema.origin`。
- `packages/client/src/lib/shelf.ts`：删 `SHELF_GROUPS` / `ShelfGroup` / `groupShelfBooks`（**保留 `isCurrentBook`**）；`pages/Dashboard.tsx` 直接渲染 `bookshelf.books`（删组小标题与空组逻辑）；测试同步（`lib/shelf.test.ts` / `dashboard-shelf.test.ts` / `dashboard-cloud-restore.test.ts` / `api.test.ts` / `project.test.ts`）。

**文档**：`db/schema.md`（迁移链 + 011、§两表整段、`origin` 行）、`design/config.md`（`decompose` 段三处 → 「键已废止，读侧忽略」）、`10-data-model.md:135`、`30-agent-loop.md:51`、`api/10-api-project.md`（111 / 131 / 139）、`api/error-code.md`（`SESSION_READONLY` 行 + 8 个 `DECOMPOSE_*` 行 + 第 3 行「拆解小说八码」+ 第 45 行 `/decompose/job` 说明）、`ui/DESIGN.md`（两组小标题段 + 删书后果一句——后者仍写「在跑的拆解任务会被取消」而代码已改，属卡 1 遗留漂移）。

**源码注释里的悬空引用**（卡 1/2 实测清单，本卡清）：`shared/src/constants/decompose.ts:3`、`shared/src/types/api.ts`（1214 / 1331 / 1437）、`shared/src/types/api.test.ts:720`、`db/src/tables.ts:102`、`db/src/queries/decompose.ts`（整文件删）、`db/src/queries/decompose.test.ts:31`——全部指向已删的 `60-decompose.md` / `120-api-decompose.md`；删文件即消，只余 shared/db 保留段的注释需改写。

**硬完成判据**：

- `pnpm -r build` → `pnpm typecheck` → `pnpm lint` → `pnpm -r test` 全绿；`db` 单包 `pnpm --filter @whispering233/ai-editor-db test` 绿。
- 迁移双路径实证：v10 存量库跑迁移后两表消失且 `user_version = 11`；全新库建表后**不存在**这两张表。
- `rg -n 'decompose|Decompose|DECOMPOSE|拆解' packages/client/src packages/db/src packages/shared/src packages/server/src` —— **白名单 = 迁移链文件**（`migrations/009_decompose*.ts` / `010_decompose_concurrency*.ts` / `011_drop_decompose.ts` 及其测试 + `migrations/index.ts` + `schema.ts` 版本史注释 + `queries/migration.test.ts`；2026-09 裁定：011 的 DDL 必须点名两张表、`index.ts` 必须 import 它、版本史与实证用例必须写表名，结构上不可消除）；白名单外**零命中**。
- `rg -n '60-decompose|120-api-decompose' packages docs --glob '!docs/design/tasks.md'`：2026-09 裁定按可达口径判定 = `packages/**` 零命中 + `docs/**` 仅余 `docs/design/backlog.md:457`（登记为卡 4 待清项，卡 3 **不改** backlog.md）。
- 卡 1/2 实测发现的连带边界修正（已批准，非越界）：`migrations/009_decompose.ts` / `010_decompose_concurrency.ts` 的**注释**换掉指向已删 `schema.md` 段的引用与失效的「与 tables.ts DDL 同形」断言段（`up` 逻辑与 DDL 一字不动）；`docs/design/10-data-model.md:16` 的 project.json 字段枚举去掉 `origin`。
- 汇报附 commit hash + 命令输出 + `git status` 干净。

### 卡 4：收尾与残留归零

- `CHANGELOG.md`：删 `Unreleased` 段里**从未发布**的拆解条目（分段并发 / 并发配置 / 批大小守卫 / 实测脚本 / 会话形态 / 端点判据 / worker 禁删 / 并发缺省 / 批预算文案），新增 `### Removed` 段记本次移除（端点 / 进度页 / 入口 / 会话守卫 / 迁移 011 DROP 两表 / `origin` 字段废止 / `.txt` 导入建书路径消失）；**已发布版本段一字不动**。
- `AGENTS.md`：删四条拆解硬约束（会话形态 / 并发与批大小 / 书架两类身份 / start 收敛镜像）与 3 处措辞（pi pin 注释里的 `decompose/budget.ts`、`llm-discipline` 相关、`references/` 描述），`config.json` 描述去掉 `decompose` 段。
- `README.md`：书架描述、AI 运行时行、功能清单里的拆解条目、仓库结构里的 `references/` 说明。
- `backlog.md`：拆解相关 35 处全删（含「拆解小说（已交付，未排期项）」整节）。
- `docs/ui/DESIGN.md` 与其余文档兜底清扫。
- **残留归零核验**：全仓 `rg -n 'decompose|Decompose|拆解'` 只允许命中——CHANGELOG 已发布版本段、`migrations/009_decompose.ts` / `010_decompose_concurrency.ts` 及其测试（历史迁移链，注释里注明「拆解功能已移除（见 CHANGELOG），本迁移仅服务旧库升级路径」）、`00-master-design.md` 的边界声明。
- 判据：`pnpm -r build` + `pnpm typecheck` + `pnpm lint` + `pnpm -r test` 全绿 + 上述 `rg` 清单逐条核对 + commit hash。

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
