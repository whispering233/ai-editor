# AGENTS.md

## 项目状态

- **阶段 A 全部完成 + 切片 1-9、12、13 完成 + 阶段 U（UI 工作台重构）U1-U8 全部完成 + 切片 10 画布（S10.1）+ 切片 11 发布（S11.1-S11.3）完成**（MVP 切片全部完成；发布前阻断项见 `doc/design/release-review.md`）：项目管理（create/open/close/config + 书架模式 books/ 子目录）、大纲（严格三层操作层/路由/就地编辑页）、实体与关系（CRUD/k 跳遍历/双向 relations/列表与详情页）、回收站（S4：数据层/启动一致性校验/路由/页面）、Delta（S5：增删查/computeState 父链累积/路由/节点与实体侧展示）、切片 6 模型与工具层（S6.1 LLM 客户端——fetch → DeepSeek 手写 SSE 解析/跨 chunk/[DONE] 哨兵/length 截断防御/abort 三保险/消费者异常隔离 CONSUMER_ERROR；S6.2 重试与 token——配额/计费类不可重试分类（code 优先于 status）/指数退避 base*2^(n-1)/chars4+真实 usage 基线/工具结果截断显式告知；S6.3-S6.6 工具注册 32 个——查询 8/分析 5/伏笔 5（_health 决策 21 口径，绝不写回 data）/提案 14（仅产出对象：proposal_id+summary 无预览、references 快照、project_id 绑定、零落盘），参数 schema 走 `@ai-editor/shared/schemas/tools` 子路径，SQL 一律下沉 db 查询层；S6.7 执行 12 + executor——executeProposal 类型安全映射、复合写事务/幂等判重/终态守卫/data.status 同步，执行类不注册不暴露 LLM）、切片 7 对话服务（S7.1 会话管理——纯内存成对裁剪/孤儿整对丢弃/末条 user-tool 约束/重试 payload 复用；S7.2 上下文组装——决策 7 三层注入/决策 6 分层预算（系统 500/聚焦 3000/历史 6000）/usage 基线口径（历史段真实用量）；S7.3 主循环——8 轮/120s 含工具执行与重试/token 三重保险、六类事件序列（proposal 在 tool_result 后、循环继续前）、length 截断不执行工具、超时信号与用户取消分离、abort 双形态归一；S7.4 工具调度 + 提案仓——批量校验 fail fast、AbortedError 取消传播、TTL 10 分钟/上限 200/项目绑定/peek 区分 404-409；S7.5 提案路由——confirm/reject 快照重校验（实体/关系自身 updated_at、大纲节点节点级）+ 一次性消费；S7.6 chat SSE 路由——六类事件帧 + 心跳 15-30s + 三路断开检测 + 全链路取消（取消信号四层穿透）+ zod4 内置 toJSONSchema 零新依赖 + 取消时提案作废）、切片 8 聊天联调（S8.1 联调——契约核对 0 gap（S7.6 帧 ↔ client 解析逐字段对齐）、describeStreamError 文案、fetchSSE 网络失败补发 error 事件消除静默失败；S8.2 提案卡接入——confirm/reject 真实调用（STALE 失效标注/404 移除/MISMATCH 防御移除）、processing 防重复、全局 toast）、切片 9 伏笔面板（S9.1 面板——分组列表（活跃/已回收/已废弃）+ 新建对话框（埋点节点选择）+ 复合写确认面板（delta+relation+PUT status 同步三请求幂等收敛——ora 裁决保留三步）、依赖链递归展开、软删级联，**MVP 简化：不展示 _health 健康指标与章节序**（backlog #13）；S9.2 大纲节点伏笔标记——plants/advances/resolves 徽标 + buildNodeHookMarks 聚合纯函数（方向防御/名称兜底/稳定排序）+ 并行三请求降级；画布标记已随 S10.1 集成）、切片 12 大纲节点详情与结构化信息（决策 23 麦基字段集：S12.1 节点 data 后端、S12.2 节点详情页 `#/outline/:nodeId`、S12.3 变更记录创建入口）、切片 13 大纲交互重构（S13.1 取消 ⋯ 操作条平铺图标化/拖拽上下半排序/摘要两行/移除回收站折叠区、S13.2 设为当前位置迁详情页、S13.3 变更记录目标类型收紧——仅实体、S13.4 概览页引导形态书架有书可打开）；UI 重构——shadcn 集成 + oklch 文学氛围双主题（U1）、三栏 1:5:4 工作台外壳（U2）、左栏书架树（项目→会话二级树 + server 会话路由，U3）、中栏概览页 + 信息条定位（U4）、右栏 ChatPanel 完整 UI（U5，发送接 S7）、全局反馈组件（U6）、详情页面包屑（U7）、关联 tab 实体关系总览（U8）+ 交互修复批次（2026-08 用户实测：数据变更刷新信号 `dataVersion`/InfoBar 全局刷新按钮、刷新自动激活最近会话、应用级 ErrorBoundary 防白屏、Base UI #31 根因——DropdownMenuLabel 必须 Group 包裹）、切片 10 画布（S10.1——画布投影/拖拽缩放/localStorage 按项目隔离/plot_edge 连线创建删除/伏笔标记复用 S9.2/ConfirmDialog 全局桥接，`lib/canvas.ts` 纯函数 40+ 测试）、切片 11 发布（S11.1 生产构建全链路走查 + 补强 resolveClientDist/parsePortEnv；S11.2 端到端冒烟 `smoke.test.ts` 9 步链路；S11.3 发布前复审 `release-review.md`——阻断项：导出/导入、publishConfig、publish 演练、未来版本拒绝重建；E1-E3 导出/导入已实施（E1 fflate zip 导出 + 契约、E2 import 校验原子搬入、E3 书架导入导出 UI）+ E4 未来版本拒绝重建（PROJECT_VERSION_NEWER 零触碰）+ E5 增量迁移机制（migrations/ 目录按序执行/每迁移一事务/hasMigrationPath/时间戳快照/import 联动/migrated toast），E6 publishConfig/版本管理/publish 演练已完成（发布链路就绪：CHANGELOG.md + sync-version + publish-packages/verify-installed + release.yml/publish.yml，见「版本发布流程（E6）」段；剩 npmjs 前置配置与首次发布执行））。测试全仓 1286 个（shared 88 / db 198 / server 239 / client 383 / tools 225 / llm 59 / agent 94）。。
- 任务执行以 `doc/design/tasks.md` 为清单（checkbox 进度），按卡开发、一卡一 commit、每卡「实现 fixer/designer + 验证 oracle」双代理、完成后向用户汇报；**backlog.md 事项一律不做**（#8 已演练完成）。
- 一切实现工作必须按 `doc/design/architecture.md` 的分包方案搭建，不得擅自改变包划分或依赖方向。

## 文档即契约

实现任何功能前先读对应文档，它们是单一事实来源：

| 目录 | 内容 | 何时读 |
|------|------|--------|
| `doc/design/` | `product.md` 产品定位、`architecture.md` 架构与分包、`decisions.md` 关键决策 1-23、`backlog.md` 迭代优化清单（MVP 不做）、`tasks.md` 开发任务清单与进度 | 任何改动前 |
| `doc/api/` | `endpoints.md` 端点契约、`tools.md` AI 工具目录、`data-flow.md` 数据流 | 前后端改动 |
| `doc/database/` | `schema.md` 表结构与 outline.json/project.json 契约、`hooks.md` 伏笔系统与健康指标 | 数据/后端改动 |
| `doc/ui/` | **当前 UI 布局样式设计**：`layout.md` 三栏工作台外壳与样式规范（2026-08 已从原型更新为实现样式）、`pages/*.md` 各页面（字段标注 API 响应字段） | 前端改动 |
| `test-project/` | 测试项目目录（借鉴 inkos test-project 模式，运行时数据不入库），日常开发测试用 | 测试/联调前 |

阅读顺序（见 `doc/README.md`）：`design/product.md` → `design/architecture.md` → `design/decisions.md`（决策 9-19 是数据模型与安全基线，20/21 为 SSE 断开检测与伏笔健康指标，22 为三栏工作台布局与会话归属模型，23 为大纲节点结构化信息麦基字段集）→ 按职责读 `api/` 与 `database/`；前端实现前必读 `doc/ui/layout.md`（当前实现样式，含组件结构与样式细节规范）。

## 易踩坑的架构约束

- pnpm monorepo，7 个包：`shared → llm/db/tools → agent → server`，`client` 只依赖 `shared`。
- **`shared` 硬约束**：禁止任何 Node.js 内置模块或服务端包（只允许 zod / nanoid / 纯 TS）。client 会在浏览器打包它，违反即 Vite 构建失败。**Zod 校验仅在服务端执行**——client 只消费 shared 的类型与常量，不打包校验函数（避免 50KB 级依赖进浏览器包）。
- 存储**三个数据文件**，不要试图统一：`outline.json`（大纲树 JSON）、`data.db`（实体/关系/Delta/对话历史 `chat_messages` 表，决策 18 含 `tool_call_id`/`project_id` 列）、`project.json`（项目配置：id/name/language/prompt/`schema_version`/`current_position`，决策 8/21；写入与 outline.json 同款原子写，**DeepSeek key 绝不写入**）。
- 大纲**严格三层**（卷→章→场景），**无游离节点**：创建必须显式指定 parent_id，scene 只能挂 chapter（决策 19）；outline.json 无 `orphan_nodes` 字段，节点带 `updated_at` 版本戳、顶层带 `schema_version`。**节点可选 `data` 字段（决策 23，S12 已实现）**——麦基《故事》字段集，按层级 schema 校验（scene：goal/conflict_levels/value_from/value_to；chapter：reversal/climax_scene；volume：climax_scene/inciting_scene），**编辑 data 不自动生成 Delta**（决策 9 修订语义），详情页 `#/outline/:nodeId` 承载展示与编辑。
- 关系用**一张通用表** `relation_records`（含 `plot_edge` 剧情连线），不要按实体类型分表。**Delta 不在此表**——独立存 `delta_records`，`attribute_change` 类型已废弃（决策 3，2026-08 修订）。
- 状态计算 `computeState` **只沿大纲树父链累积已确认 Delta**：节点间按树路径序、节点内按 `order` 双层排序；`plot_edge` 连线不参与；`op=update` 校验 from 失败**跳过该 change 并在 `conflicts` 中标注**（不返回 409——手动编辑 data 不产生 Delta 属正常行为，决策 9 修订）。
- 删除走**软删 + 回收站**：实体/关系/Delta 标 `deleted_at`、节点标 `deleted`，**级联一并软删**（purge 才物理清除），常规查询默认过滤，restore 级联还原；还原/清理走 `/api/v1/trash/*`。**手动删关系 = 物理删**（不进回收站）；关系可见性联动端点状态（任一端点软删即不可见）；restore 大纲节点校验祖先链——存在软删祖先返回 409 `OUTLINE_ANCESTOR_DELETED`；Delta 可见性同规则联动触发节点/目标实体（任一端软删，computeState 与常规查询均不可见）（决策 12 修订）。
- 伏笔系统（决策 21）：**健康指标 `_health` 仅运行时计算，作为响应附加字段返回，绝不写回 data**；`plants`/`advances`/`resolves` 关系**不存 chapter 元数据**——章节序由服务端基于 source_id 从大纲树查询时现推（节点 move 后不陈旧）；「当前章节」= project.json 的 `current_position`；`ready_to_resolve` 依据 hook 的 `expected_resolve_node_id`（未设置返回未计算，不猜测）。**MVP 简化（2026-08 决策）**：`_health` REST 附加字段契约未定义，伏笔面板不展示健康指标与章节序（backlog #13）。
- 画布节点坐标/缩放存**浏览器 localStorage**（纯展示层，不进数据文件，决策 10）。
- 前端技术栈已定（architecture.md + 决策 22）：React 19 + Zustand 5 + Tailwind 4 + shadcn/ui（**base-nova/Base UI 风格，已 CLI 集成**：components.json + `@` 别名 + `pnpm dlx shadcn add <组件>` 增补组件，CLI 在 devDependencies）；路由用自制 hash 路由（`useHashRoute`），**不要引入 React Router**。
- **UI 三栏工作台布局（决策 22，layout.md §0/§2）**：左 10%（Sidebar：产品标识 + 书架树 + 设置/主题切换）/ 中 50%（InfoBar + 6 tab：概览|大纲|画布|实体关系|伏笔|回收站 + 内容区）/ 右 40%（ChatPanel 常驻，`<1024px` 折叠抽屉），`flex-basis` 百分比固定不可拖拽；**`#/chat` 独立页已移除**——聊天常驻右栏，跨页「问 AI」注入当前会话 focus context（`ui store focusOutlineNodeId` 或 `chat store focusContext`）；**会话归属项目**（chat store 订阅 project store 切换联动，决策 22）。
- **Base UI 菜单契约（2026-08 踩坑）**：`DropdownMenuLabel`（= `Menu.GroupLabel`）**必须**用 `DropdownMenuGroup` 包裹——裸放 `DropdownMenuContent` 内，菜单打开时抛 Base UI error #31（`MenuGroupContext is missing`），曾致点击会话标题下拉整页白屏（`3e877a1` 根因修复）；新增菜单遵守，layout.md §4.3 红线。
- **主题系统（layout.md §3，U1）**：oklch 文学氛围双主题 tokens 集中在 `client/src/index.css`（`@custom-variant dark` + `@theme inline` + `:root`/`.dark`，浅色暖羊皮纸+牛血红 ↔ 深色蓝黑曜石+琥珀烛光）+ 系统字体栈（标题/聊天衬线 `font-serif`）+ `--radius: 0.6rem` + `color-scheme`；**组件一律用 token 类（bg-background/bg-card/border-border/text-muted-foreground 等），禁止硬编码 zinc/white/black 色类**（oracle 审核红线）；主题切换 `hooks/use-theme.ts`（localStorage `ai-editor:theme`）+ index.html FOUC 内联脚本（深色首帧防闪白）。
- **聊天发送状态（U5）**：POST /api/v1/chat 是 **POST + SSE**——浏览器原生 `EventSource` 只支持 GET，客户端必须用 `fetch` + `ReadableStream` 自写 SSE 解析（`client/src/hooks/use-sse.ts`，`fetchSSE` 是 POST /chat 的事实契约来源——**勿另起炉灶**），处理跨 chunk 的 `data:` 行拼接与注释行；**端点属 S7 切片未实现**（当前 404 → 错误条「聊天服务未就绪」）；chat store 有 loadSeq/msgSeq 竞态 + 中止在途 SSE 的约定，改动时保持。
- `outline.json` 保存必须**原子写**（临时文件 + fsync + rename），禁止直接覆盖（决策 11）。
- 大纲树与画布是**同一数据的两种投影**（节点即大纲），不是需同步的两份数据。
- AI 是创作顾问**不生成正文**；AI 工具按风险分**两级权限**（自动 / 提案确认），写操作必须走提案；**提案仅存内存**（TTL 10 分钟 + 条数上限），确认时服务端重新校验引用（存在性 + updated_at 快照比对，大纲节点用节点级 `updated_at`），失败返回 409 `PROPOSAL_STALE`，proposal_id 不存在返回 404 `PROPOSAL_NOT_FOUND`（决策 14/19）。
- agent 循环有硬性终止：max 8 轮 / 单轮 120s / token 预算（工具结果也有 token 上限）；SSE 断开即全链路取消——**心跳（15-30s ping）+ 三路断开检测**（onAbort + req close/error + 心跳写失败，决策 20）；心跳对 **TCP 半开连接**（客户端断电）无法即时感知，客户端需自身超时兜底（60s 无任何事件即提示断开）；跨 data.db / outline.json 的写操作**先 DB 后 JSON**，不一致由**启动一致性校验**兜底补标（决策 16 修订，S4.2 已实现——以大纲节点软删为准补标 DB 关联记录）。
- 服务默认绑定 `127.0.0.1`，**全部请求**（含读）校验来源：仅校验 host ∈ {127.0.0.1, localhost, ::1}（**不校验端口**——端口自动 +1 与 dev proxy 依赖此规则，决策 17 修订）；DeepSeek key 走环境变量或用户级配置（`~/.ai-editor/config.json`），**不入项目文件**；生产态端口占用自动 +1 并打开实际端口（**dev 态被占直接报错**，Vite proxy 写死 3456）；打开浏览器/提示 URL 一律用 `127.0.0.1` 而非 `localhost`（IPv6 优先系统上 localhost 可能解析为 `::1` 导致连接被拒）（决策 8）。
- 运行环境（2026-08 实测修订，以 architecture.md 版本声明为准）：Node ≥ 22.12（实测 22.23）、**全仓 ESM**；better-sqlite3 `^13`（N-API 重写，自带预编译二进制，全局安装无 ABI 失配）、zod `^4`、Vite 7、Hono 4；pnpm 实测 11.8——pnpm-workspace.yaml 需配 `allowBuilds: { better-sqlite3: true, esbuild: true }`（两者都有 postinstall 脚本，pnpm 11+ 格式；pnpm 10 旧格式 `onlyBuiltDependencies` 会被 pnpm 11 自动迁移为哨兵值导致构建被忽略）。
- schema 演进 MVP 用**删库重建**（`PRAGMA user_version` 为准判定，`schema_version` 管 JSON，重建时同步重置 outline.json 并备份 `.bak`，**data.db 也备份 `.bak`**），无迁移脚本；首次发布前必须复审此策略（决策 13）。
- 部署：单命令 `ai-editor`，单进程 Hono `:3456` 同时服务 `/api/v1` 与 SPA 静态文件；dev 态 Vite `:5173` 通过 proxy 转发 `/api` 到 `:3456`。命令约定（architecture.md + 根 package.json 实测）：根 `pnpm dev` = `pnpm -r --parallel run dev`（client `vite` :5173、server `NODE_ENV=development tsx watch src/index.ts` 默认 :3456、各库 `tsc --watch`，端口逻辑在代码内按 NODE_ENV 区分，脚本不带端口参数）；`pnpm -r build` 按依赖序构建（shared → llm → db → tools → agent → server → client）；另有 `pnpm typecheck` / `pnpm lint`（ESLint 9 flat config + typescript-eslint）/ `pnpm test`（vitest，`pnpm --filter <包> test` 跑单包）。本地看界面：`pnpm start:test-project`（= `pnpm -r build` + `node packages/server/dist/index.js test-project`，构建后启动，自动打开浏览器 http://127.0.0.1:3456；端口可用 `AI_EDITOR_PORT` 环境变量覆盖，测试/多实例场景用）。**调试对话链路**：纯配置文件方式（server/src/debug.ts 的 `initDebugConfig`/`isCategoryEnabled`/`debugLog`，环境变量开关已移除）——创作根 `.ai-editor/config.json`（`pnpm start:test-project` 已含默认示例 `test-project/.ai-editor/config.json`：示例开启 request/usage/http 三类；自定义如 `{ "debug": { "enabled": true, "categories": ["request", "usage"] } }` 只显示请求和 tokens），五类别 `chat`（agent 事件日志：turn_start/text 长度/tool_call args/proposal/done/error 截断摘要）/ `request`（LLM 请求完整 prompt）/ `stream`（原始 SSE chunk）/ `usage`（tokens 统计）/ `http`（hono/logger 请求日志，仅该类别挂载）；categories 缺失 = 全部、enabled=false 或缺失 = 全关、文件不存在/非法 JSON/结构不符 = 全关（无配置文件默认关闭防刷屏）。stream 类别经 chatStream 的 `debugStream` 选项显式传入 llm 包（**显式 true 才开**，无 env 回退）；排查 S7 链路时开启。
- **启动待命语义（决策 8 修订）**：`startServer(projectRoot)` 启动时 `detectProject`——目录已有 project.json → 自动打开（部署场景「启动即用」）；**无 → 待命（不初始化、不建任何文件）**，前端 Dashboard 引导 create/open（`GET /project/config` 返回 409 NO_PROJECT_OPEN 是引导触发条件）。dev 态（cwd=packages/server）因此不污染代码包。初始化（mkdir + 三文件 + user_version）只在 create 路由（`initProject`）发生。
- **打包安装测试（backlog #8，借鉴 inkos）**：6 包 `pnpm pack` 前 prepack 钩子自动执行（`copy-client-dist` 复制 SPA 进包 → `prepare-package-for-publish` 替换 `workspace:*` 为真实版本号），postpack 恢复原 package.json；测试目录 `npm install <6 个 tarball>`（npm 对同批 tarball 复用依赖，未发布 registry 也能装）→ `npx ai-editor <项目目录>` 启动完整界面（SPA 随包，`defaultClientDist` 双路径：monorepo `../../client/dist` 优先，安装态 fallback 包内 `client-dist`）。**已自动化**：根脚本 `pnpm pack:test`（构建 + 6 包 pack + npm 安装到 /tmp 测试目录，目录可用 `AI_EDITOR_PACKS_DIR`/`AI_EDITOR_TEST_DIR` 覆盖）→ `pnpm start:test`（启动安装态服务）→ `pnpm test:packed` 一键串联。日常测试用仓库内 `test-project/`（运行时数据不入库）。

## 版本发布流程（E6）

发布形态（inkos 模式）：6 包（shared/llm/db/tools/agent/server）全部发布 npm；用户只装 `@ai-editor/server`（bin: ai-editor），npm 自动拉取其余 5 个依赖包；client 保持 private 不发布。**E6 是唯一引入的 CI**（tasks.md「CI 任务不做」指此前 backlog 项，发布链路除外）——`.github/workflows/` 两个 workflow 仅在 push `v*` tag 时触发。

发布步骤：

0. **前置（一次性）**：创建 GitHub 仓库并推送代码（`.github/workflows/` 随代码入库——否则 tag push 无 workflow 可触发）；npmjs 为 6 个包各配置 Trusted Publisher（见下方前置段）
1. 更新根 `CHANGELOG.md`：把 Unreleased 条目搬运为新版本段（`## [vX.Y.Z] - <日期>`）
2. `node scripts/sync-version.mjs X.Y.Z`（或 `pnpm release:version X.Y.Z`；`--dry-run` 只预览）——同步 6 个发布包 + client + 根 package.json 的 version，输出改动文件清单；发布脚本依赖「6 包版本一致」不变式
3. `git add -A && git commit -m "chore(release): bump version to vX.Y.Z"`
4. `git tag -a vX.Y.Z -m "vX.Y.Z"`（**手动 annotated tag**，轻量 tag 不触发语义化发布规范）
5. `git push origin main && git push origin vX.Y.Z`
6. workflow 自动执行：`release.yml`（hermannm/release-from-changelog@v0.2.6 从 CHANGELOG.md 按 tag 匹配版本段创建 GitHub Release）+ `publish.yml`（6 包 npm 发布 + 安装态冒烟）

**前置（一次性，npmjs 手动）**：Trusted Publishing（OIDC）——为 6 个包各配置 Trusted Publisher：Publisher = GitHub Actions、工作流名 = `publish.yml`；配置后 workflow 无需 NODE_AUTH_TOKEN（`permissions.id-token: write` 自动换证）。

发布脚本要点：

- `scripts/publish-packages.mjs`：依赖序硬编码 shared → llm → db → tools → agent → server；每包 `npm view <name>@<version>` 判重（**E404 才视为未发布**，网络错误直接中止），已存在跳过 → 幂等重跑安全；`npm pack` 到临时目录后 `tar -xOf` 读包内 package.json 断言无 `workspace:` 残留（prepack 替换失败的最后防线，有残留即中止不发布）；`npm publish --access public`（cwd=包目录，prepack 钩子自动执行替换与恢复）；`GITHUB_REF=refs/tags/vX.Y.Z` 存在时校验 tag 与包版本一致（不一致中止，防漂移误发）
- `scripts/verify-installed.mjs`：CI 发布后冒烟——mkdtemp 临时目录 `npm install --prefix <dir> @ai-editor/server@<version>` → 断言已装包 version 匹配 + `.bin/ai-editor` 存在 → 短时启动 `node <pkg>/dist/index.js <空目录>`（20s 超时 kill——better-sqlite3 原生加载 + npm 冷启动给足余量），输出含「服务已启动」即通过（未见即失败）
- 本地验证链路（pack:test/start:test，backlog #8）保留不动；`sync-version` 只改 version 字段，不碰依赖/scripts

## 约定

- **无 git 远端、无 CI**（tasks.md 明确「CI 任务不做」）：不要 push / 建 PR / 提议 CI 配置，验证靠本地 `pnpm typecheck && pnpm lint && pnpm -r test`。
- 测试（vitest）：各包 `test` script = `vitest run`；**各包 tsconfig 已 `exclude: ["src/**/*.test.ts"]`**——不要改回，否则 tsc 会把测试编译进 dist 导致 vitest 双跑；测试文件由 vitest（esbuild）转译，lint 仍覆盖。
- 文档与提交信息用中文；commit 遵循 conventional commits（如 `feat(doc): ...`）。
- 所有 API 请求/响应契约集中在 `@ai-editor/shared` 的 `types/api.ts`（Zod schema），前后端共用，不要各自定义；错误码统一 `ErrorCode` 枚举（REST/SSE/工具共用）。
- 对话历史 / 上下文走分层策略（系统指令 → 聚焦上下文 → 工具按需扩展 → 滑动窗口历史），不要把整个世界塞进 prompt。续聊重建与裁剪按 `assistant.tool_calls[].id` ↔ `tool.tool_call_id` **成对重组、同裁同留**，孤儿半对整对丢弃（DeepSeek 要求严格配对，缺一即拒，决策 18）。
- API 命名：请求体/查询参数 **snake_case**，响应体 **camelCase**，outline.json 内部字段 snake_case；文件字段 ↔ API 字段的映射函数定义于 `@ai-editor/shared/utils`。id 前缀：`char-`/`set-`/`loc-`/`hook-`、`sc-`/`ch-`/`vol-`、`proj-`，运行时对象 `prop_`/`sess_`/`call_`（文档示例的 `char-9` 是形状示意，**非自增序号**）。
- 时间约定：所有时间列/字段统一 ISO 8601 字符串、**由应用层写入**，不用 SQLite `datetime('now')`——回收站按 `deleted_at` 排序跨 SQLite 与 outline.json，格式必须统一。
- 延期项（多标签页并发、导出/导入、undo、token 统计等）见 `doc/design/backlog.md`，MVP 不做，不要顺手实现。
