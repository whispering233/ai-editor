# AGENTS.md

## 项目状态

- **状态（2026-08-25）：全部计划批次完成并发布，最新版 v0.0.23**——阶段 A 地基 + 切片 1-13、阶段 U 三栏工作台重构（U1-U8）、画布 S10.x + 发布 S11、阻断项（导出/导入、未来版本拒绝重建、增量迁移、OIDC 发布链路 **v0.0.1-v0.0.23 全绿**）、阶段 B 项目提示词编辑、阶段 B2 自动备份与恢复、阶段 C 时间轴、交互优化 UX1-UX4、样式工程化 L 批次、db 查询层 drizzle 化（v0.0.22）、文档体系重构（v0.0.23：详细设计四篇 + 全仓「决策 N」编号清除），以及 F/G/H/I/J/K/L/M/N/O 系列用户反馈与体验迭代批次（至批次十四）全部完成。**无待做项**；可选收尾：npm 坏版本 v0.0.1/v0.0.2 deprecate（需 2FA 凭据）。
- **v0.0.21（2026-08-23）为纯工程维护版**：pnpm 11.8.0 → 11.22.0（`packageManager` 与 CI `pnpm/action-setup` 同步升级），无 API/数据/前端变更。
- 各批次详情、坑记录与演进路线见 `doc/design/tasks.md` 与 `CHANGELOG.md`；**backlog.md 事项一律不做**。
- 任务执行以 `doc/design/tasks.md` 为清单（checkbox 进度），按卡开发、一卡一 commit、每卡「实现 fixer/designer + 验证 oracle」双代理、完成后向用户汇报。
- 一切实现工作必须按 `doc/design/architecture.md` 的分包方案搭建，不得擅自改变包划分或依赖方向。
- 路径约定：`client/src/...`、`server/src/...`、`db/src/...` 等包内路径均相对 `packages/` 目录；`doc/`、`scripts/`、`test-project/` 在仓库根。

## 文档即契约

实现任何功能前先读对应文档，它们是单一事实来源：

| 目录 | 内容 | 何时读 |
|------|------|--------|
| `doc/design/` | `product.md` 产品定位、`architecture.md` 架构与分包、详细设计四篇（`data-model.md` 数据模型与存储 / `context.md` 上下文与提示词 / `agent-loop.md` agent 循环与提案 / `security.md` 安全基线——只承载「为什么 + 不变式」，字段/端点清单以 api/database 契约为准）、`backlog.md` 迭代优化清单（MVP 不做）、`tasks.md` 开发任务清单与进度 | 任何改动前 |
| `doc/api/` | `endpoints.md` 端点契约、`tools.md` AI 工具目录、`data-flow.md` 数据流 | 前后端改动 |
| `doc/database/` | `schema.md` 表结构与 outline.json/project.json 契约、`hooks.md` 伏笔系统与健康指标 | 数据/后端改动 |
| `doc/ui/` | **当前 UI 布局样式设计**：`layout.md` 三栏工作台外壳与样式规范（2026-08 已从原型更新为实现样式）、`pages/*.md` 各页面（字段标注 API 响应字段） | 前端改动 |
| `test-project/` | 测试项目目录（借鉴 inkos test-project 模式，运行时数据不入库），日常开发测试用 | 测试/联调前 |

阅读顺序（见 `doc/README.md`）：`design/product.md`（产品定位）→ `design/architecture.md`（架构与分包、技术栈）→ 详细设计四篇（`design/data-model.md` 数据模型与存储 → `design/context.md` 上下文与提示词 → `design/agent-loop.md` agent 循环与提案 → `design/security.md` 安全基线）→ 按职责读 `api/` 与 `database/`（结构/端点契约）；前端实现前必读 `doc/ui/layout.md`（当前实现样式，含组件结构与样式细节规范）。详细设计只讲「为什么 + 不变式」，具体字段/端点以 `schema.md`/`endpoints.md` 为准。

## 易踩坑的架构约束

- pnpm monorepo，7 个包：`shared → llm/db/tools → agent → server`，`client` 只依赖 `shared`。
- **`shared` 硬约束**：禁止任何 Node.js 内置模块或服务端包（只允许 zod / nanoid / 纯 TS）。client 会在浏览器打包它，违反即 Vite 构建失败。**Zod 校验仅在服务端执行**——client 只消费 shared 的类型与常量，不打包校验函数（避免 50KB 级依赖进浏览器包）。
- **llm 引擎（批次九）**：llm 包依赖 `@earendil-works/pi-ai`（providers/deepseek 子路径注册），对外契约不变（chatStream/LLMStreamEvent/LLMError），内部单向 adapter 转换（LLMMessage→pi-ai Context / 事件转发 / usage 口径 / 错误归一化）；**勿手写 SSE/流式累积**（pi-ai 接管传输）；新增 `getAvailableModels`（模型目录：id/provider/contextWindow/maxTokens/reasoning）；思考强度 `thinking_level`（用户级配置持久化，off/minimal/low/medium/high/xhigh/max，off 不传 reasoning，档位对齐 pi）。
- 存储**三个数据文件**，不要试图统一：`outline.json`（大纲树 JSON）、`data.db`（实体/关系/Delta/对话历史 `chat_messages` 表，含 `tool_call_id`/`project_id` 列）、`project.json`（项目配置：id/name/language/`schema_version`/`current_position`/`backup_frequency_minutes` 等，`prompt` 字段已废弃；写入与 outline.json 同款原子写，**DeepSeek key 绝不写入**）。
- **自动备份（B2 阶段）**：备份/频率/列表均**项目级（跟随书籍）**——频率 = project.json `backup_frequency_minutes`（缺省 10，null/0 = 关闭，仅枚举 1/5/10/15/30/60，含 1 分钟档），备份 zip 存项目目录 `.backups/`（毫秒级时间戳命名 `<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`——**kind 类型标记段**：`m` = 手动（**无名称也带 `-m` 段**，与自动可靠区分）/ `a` = 自动备份重命名后带名称；自动备份/覆盖前快照为纯时间戳；手动带名称 `<时间戳>-m-<名称>.zip`；名称 trim 后 1-30 字符、禁路径分隔符/保留字符/控制字符/纯点，sanitize 收敛 shared `sanitizeBackupName`；**旧格式兼容解析不迁移**（旧秒级 → auto、旧带名称无 kind 段 → manual）；每项目保留 20 份）；**`POST /backup/rename` 重命名备份**（只改名称段、时间戳与 kind 保持，name 空 = 清除名称段，幂等，目标已存在 → 409 `BACKUP_TARGET_EXISTS`，旧格式文件改名顺带规范化毫秒+kind）；**加载备份/导入覆盖以 project_id 为唯一 key**：zip 内 id 匹配书架 → 覆盖恢复（**必须保留当前项目 id**——换 id 即断连 chat_messages 会话历史；覆盖前自动快照当前状态）；不匹配 → 导入新书（同名不同 id **不再 409**，目录自动去重 `书名 (N)`）；`POST /project/rename` 改书名（原子移动目录 + 更新 name，当前打开项目同步内部路径引用）。详细语义见 `doc/design/data-model.md` §11。
- 大纲**严格三层**（卷→章→场景），**无游离节点**：创建必须显式指定 parent_id，scene 只能挂 chapter；outline.json 无 `orphan_nodes` 字段，节点带 `updated_at` 版本戳、顶层带 `schema_version`。**节点可选 `data` 字段（S12 已实现）**——麦基《故事》字段集，按层级 schema 校验（scene：goal/conflict_levels/value_from/value_to；chapter：reversal/climax_scene；volume：climax_scene/inciting_scene），**编辑 data 不自动生成 Delta**，详情页 `#/outline/:nodeId` 承载展示与编辑。
- 关系用**一张通用表** `relation_records`（含 `plot_edge` 剧情连线），不要按实体类型分表。**Delta 不在此表**——独立存 `delta_records`，`attribute_change` 类型已废弃。
- 状态计算 `computeState` **只沿大纲树父链累积已确认 Delta**：节点间按树路径序、节点内按 `order` 双层排序；`plot_edge` 连线不参与；`op=update` 校验 from 失败**跳过该 change 并在 `conflicts` 中标注**（不返回 409——手动编辑 data 不产生 Delta 属正常行为）。
- 删除走**软删 + 回收站**：实体/关系/Delta 标 `deleted_at`、节点标 `deleted`，**级联一并软删**（purge 才物理清除），常规查询默认过滤，restore 级联还原；还原/清理走 `/api/v1/trash/*`。**手动删关系 = 物理删**（不进回收站）；关系可见性联动端点状态（任一端点软删即不可见）；restore 大纲节点校验祖先链——存在软删祖先返回 409 `OUTLINE_ANCESTOR_DELETED`；Delta 可见性同规则联动触发节点/目标实体（任一端软删，computeState 与常规查询均不可见）。
- 伏笔系统（契约见 `doc/database/hooks.md`）：**健康指标 `_health` 仅运行时计算，作为响应附加字段返回，绝不写回 data**；`plants`/`advances`/`resolves` 关系**不存 chapter 元数据**——章节序由服务端基于 source_id 从大纲树查询时现推（节点 move 后不陈旧）；「当前章节」= project.json 的 `current_position`；`ready_to_resolve` 依据 hook 的 `expected_resolve_node_id`（未设置返回未计算，不猜测）。**MVP 简化（2026-08）**：`_health` REST 附加字段契约未定义，伏笔面板不展示健康指标与章节序（backlog #13）。
- 画布节点坐标/缩放存**浏览器 localStorage**（纯展示层，不进数据文件）。
- 前端技术栈已定（architecture.md + layout.md）：React 19 + Zustand 5 + Tailwind 4 + shadcn/ui（**base-nova/Base UI 风格，已 CLI 集成**：components.json + `@` 别名 + `pnpm dlx shadcn add <组件>` 增补组件，CLI 在 devDependencies）；路由用自制 hash 路由（`useHashRoute`），**不要引入 React Router**。
- **UI 三栏工作台布局（layout.md §0/§2，F7 修订）**：左（Sidebar：产品标识 + 书架树 + 设置/主题切换）/ 中（InfoBar + 7 tab：概览|大纲|实体关系|伏笔|时间轴|参考资料|回收站 + 内容区）/ 右（ChatPanel 常驻，`<1024px` 折叠抽屉）；**F7 起三栏可拖拽调宽 + 收起/展开**（use-panels hook，像素宽度 + localStorage `ai-editor:panels` 持久化，左 160-480 / 右 240-720 / 中栏保底 320，`<1024px` 抽屉行为不变）；**`#/chat` 独立页已移除**——聊天常驻右栏，跨页「问 AI」注入当前会话 focus context（`chat store focusContext`；InfoBar 统一「问 AI」入口 + 页面 currentFocus 焦点上报，MainPanel 路由切换 useLayoutEffect 清空；**行级 AskAiButton 已移除——右键菜单替代（注入会话上下文 + 建立关联）**）；**会话归属项目**（chat store 订阅 project store 切换联动）。
- **Base UI 菜单契约（2026-08 踩坑）**：`DropdownMenuLabel`（= `Menu.GroupLabel`）**必须**用 `DropdownMenuGroup` 包裹——裸放 `DropdownMenuContent` 内，菜单打开时抛 Base UI error #31（`MenuGroupContext is missing`），曾致点击会话标题下拉整页白屏（`3e877a1` 根因修复）；新增菜单遵守，layout.md §4.3 红线。
- **操作按钮禁止收进 `...`/更多菜单（2026-08 用户反馈 H3）**：所有操作按钮一律直接展示，禁止用 `MoreHorizontal`/`⋯` 做二级展开（如时间轴事件行、伏笔行、书架项目行重命名）；下拉菜单仅保留“会话选择”等选择器场景，不作为操作按钮容器。
- **文字型按钮必须有边框（2026-08 用户反馈 H4）**：所有以文字为主的操作按钮（重命名、新建、重试、展开/收起、标签筛选等）必须带可见边框（`border` + `border-border`，或用 `Button variant="outline"`），避免看起来像普通文本；图标按钮不受此限。
- **主题系统（layout.md §3，U1）**：oklch 文学氛围双主题 tokens 集中在 `client/src/index.css`（`@custom-variant dark` + `@theme inline` + `:root`/`.dark`，浅色暖羊皮纸+牛血红 ↔ 深色蓝黑曜石+琥珀烛光）+ 系统字体栈（标题/聊天衬线 `font-serif`）+ `--radius: 0.6rem` + `color-scheme`；**组件一律用 token 类（bg-background/bg-card/border-border/text-muted-foreground 等），禁止硬编码 zinc/white/black 色类**（oracle 审核红线）；**L 批次已清零全仓硬编码色类（2026-08）**，新代码不得新增、勿复制旧写法；主题切换 `hooks/use-theme.ts`（localStorage `ai-editor:theme`）+ index.html FOUC 内联脚本（深色首帧防闪白）。
- **聊天发送状态（U5）**：POST /api/v1/chat 是 **POST + SSE**——浏览器原生 `EventSource` 只支持 GET，客户端必须用 `fetch` + `ReadableStream` 自写 SSE 解析（`client/src/hooks/use-sse.ts`，`fetchSSE` 是 POST /chat 的事实契约来源——**勿另起炉灶**），处理跨 chunk 的 `data:` 行拼接与注释行；**端点已实现**（S7.6 挂载于 `server/src/routes/chat.ts`，S8.1 联调契约 0 gap——服务端网络失败会补发 error 事件消除静默失败）；chat store 有 loadSeq/msgSeq 竞态 + 中止在途 SSE 的约定，改动时保持。
- `outline.json` 保存必须**原子写**（临时文件 + fsync + rename），禁止直接覆盖（见 `doc/design/data-model.md` §5）。
- 大纲树与画布是**同一数据的两种投影**（节点即大纲），不是需同步的两份数据。
- AI 是创作顾问**不生成正文**（产品**不编辑/不存储/不读取正文**，一切建议基于结构化数据——不要实现任何正文编辑/存储功能）；AI 工具按风险分**两级权限**（自动 / 提案确认），写操作必须走提案；**提案仅存内存**（TTL 10 分钟 + 条数上限），确认时服务端重新校验引用（存在性 + updated_at 快照比对，大纲节点用节点级 `updated_at`），失败返回 409 `PROPOSAL_STALE`，proposal_id 不存在返回 404 `PROPOSAL_NOT_FOUND`。
- 用户自定义上下文（见 `doc/design/context.md` §3）：项目目录 **AGENTS.md** 是**唯一**持久化上下文通道（取代 project.json `prompt` 字段——打开项目时 prompt 存在且无 AGENTS.md 则自动迁移写入，一次迁移后 prompt 不再使用），注入 system「## 项目设定」段；设置页直编 AGENTS.md（GET/PUT `/project/agents`，原子写同款）+ 用户可在文件管理器中直接编辑（web 读取 mtime 检测外部修改）；聊天框消息即临时指令层。
- agent 循环有硬性终止：max 8 轮 / 单轮 120s / token 预算（工具结果也有 token 上限）；SSE 断开即全链路取消——**心跳（15-30s ping）+ 三路断开检测**（onAbort + req close/error + 心跳写失败）；心跳对 **TCP 半开连接**（客户端断电）无法即时感知，客户端需自身超时兜底（60s 无任何事件即提示断开）；跨 data.db / outline.json 的写操作**先 DB 后 JSON**，不一致由**启动一致性校验**兜底补标（以大纲节点软删为准补标 DB 关联记录）。
- 服务默认绑定 `127.0.0.1`，**全部请求**（含读）校验来源：仅校验 host ∈ {127.0.0.1, localhost, ::1}（**不校验端口**——端口自动 +1 与 dev proxy 依赖此规则）；DeepSeek key 走环境变量或用户级配置（`~/.ai-editor/config.json`），**不入项目文件**；生产态端口占用自动 +1 重试（上限 20 次，3456→3475）并打开实际端口（**dev 态被占直接报错**，Vite proxy 写死 3456）；打开浏览器/提示 URL 一律用 `127.0.0.1` 而非 `localhost`（IPv6 优先系统上 localhost 可能解析为 `::1` 导致连接被拒）。
- 运行环境（2026-08 实测修订，以 architecture.md 版本声明为准）：Node ≥ 22.12（engines，CI 用 22）、**全仓 ESM**；better-sqlite3 `^13`（N-API 重写，自带预编译二进制，全局安装无 ABI 失配）、zod `^4`、Vite 7、Hono 4；pnpm 由根 package.json `packageManager: "pnpm@11.22.0"` 钉版本（v0.0.21 起），CI 经 pnpm/action-setup 硬编码同版本——**两侧必须一致**，不一致 publish.yml 报 Multiple versions（实测踩坑）；pnpm-workspace.yaml `allowBuilds` 需含 4 键：`better-sqlite3` / `esbuild` / `'@google/genai'` / `protobufjs`（均有 postinstall 脚本，pnpm 11+ 格式；pnpm 10 旧格式 `onlyBuiltDependencies` 会被自动迁移为哨兵值导致构建被忽略）。
- schema 演进（见 `doc/design/data-model.md` §7）：以 `PRAGMA user_version` 为准**三态分流**——匹配 = 正常打开；**高于程序版本（未来版本）= 拒绝打开**（`SchemaVersionError`，数据不动、无 .bak，防降级数据丢失）；低于 = 旧版本，**有迁移路径则增量迁移**（`db/src/migrations/` 按 version 序执行、每迁移一事务、失败回滚、`runMigrations` 时间戳快照），**无迁移路径才删库重建兜底**（备份 `.bak` 含 data.db，重建同步重置 outline.json；`schema_version` 管 JSON 结构、不参与重建判定）。
- **db 查询层已 drizzle 化（v0.0.22）**：查询模块签名保持 `(db: Db)`（native 连接），内部经 `queryDb(db)`（WeakMap 缓存）拿 drizzle 实例；**禁止绕过 queryDb 直接 prepare**（migration 管线除外——保持 native）；JSON 列（data/changes/metadata/tool_calls）一律 text 模式 + 行映射层防御解析，**禁止 drizzle `mode:'json'`**（坏 JSON 抛错会打挂整表查询）；不引入 drizzle-kit（迁移维持 user_version 三态）；新表结构必须同步 `tables.ts` 的 sqliteTable 定义与 CREATE_TABLES_SQL 常量（schema.test.ts 列级对齐断言锁）。
- 部署：单命令 `ai-editor`，单进程 Hono `:3456` 同时服务 `/api/v1` 与 SPA 静态文件；dev 态 Vite `:5173` 通过 proxy 转发 `/api` 到 `:3456`。命令约定（architecture.md + 根 package.json 实测）：根 `pnpm dev` = `pnpm -r --parallel run dev`（client `vite` :5173、server `NODE_ENV=development tsx watch src/index.ts` 默认 :3456、各库 `tsc --watch`，端口逻辑在代码内按 NODE_ENV 区分，脚本不带端口参数）；`pnpm -r build` 按依赖序构建（shared → llm → db → tools → agent → server → client）；另有 `pnpm typecheck` / `pnpm lint`（ESLint 9 flat config + typescript-eslint）/ `pnpm test`（vitest，`pnpm --filter <包> test` 跑单包）。⚠ **fresh clone 后先 `pnpm -r build` 再 `pnpm typecheck`**——`dist/` 不入库（gitignore），`@whispering233/ai-editor-*` 的 `types`/`exports` 指向 `./dist/index.d.ts`，不先构建则 tsc 报 TS2307（CI publish.yml 已验证顺序为 build 先行）。本地看界面：`pnpm start:test-project`（= `pnpm -r build` + `node packages/server/dist/index.js test-project`，构建后启动，自动打开浏览器 http://127.0.0.1:3456；端口可用 `AI_EDITOR_PORT` 环境变量覆盖（仅 bin 直接执行入口读取），测试/多实例场景用）。**调试对话链路**：纯配置文件方式（server/src/debug.ts 的 `initDebugConfig`/`isCategoryEnabled`/`debugLog`，环境变量开关已移除）——创作根 `.ai-editor/config.json`（`pnpm start:test-project` 已含默认示例 `test-project/.ai-editor/config.json`：示例开启 request/usage/http 三类；自定义如 `{ "debug": { "enabled": true, "categories": ["request", "usage"] } }` 只显示请求和 tokens），五类别 `chat`（agent 事件日志：turn_start/text 长度/tool_call args/proposal/done/error 截断摘要）/ `request`（LLM 请求完整 prompt）/ `stream`（原始 SSE chunk）/ `usage`（tokens 统计）/ `http`（hono/logger 请求日志，仅该类别挂载）；categories 缺失 = 全部、enabled=false 或缺失 = 全关、文件不存在/非法 JSON/结构不符 = 全关（无配置文件默认关闭防刷屏）。stream 类别经 chatStream 的 `debugStream` 选项显式传入 llm 包（**显式 true 才开**，无 env 回退）；排查 S7 链路时开启。
- **启动待命语义**：`startServer(projectRoot)` 启动时 `detectProject`——目录已有 project.json → 自动打开（部署场景「启动即用」）；**无 → 待命（不初始化、不建任何文件）**，前端 Dashboard 引导 create/open（`GET /project/config` 返回 409 NO_PROJECT_OPEN 是引导触发条件）。dev 态（cwd=packages/server）因此不污染代码包。初始化（mkdir + 三文件 + user_version）只在 create 路由（`initProject`）发生。
- **打包安装测试（backlog #8，借鉴 inkos）**：6 包 `pnpm pack` 前 prepack 钩子自动执行（`copy-client-dist` 复制 SPA 进包 → `prepare-package-for-publish` 替换 `workspace:*` 为真实版本号），postpack 恢复原 package.json；测试目录 `npm install <6 个 tarball>`（npm 对同批 tarball 复用依赖，未发布 registry 也能装）→ `npx ai-editor <项目目录>` 启动完整界面（SPA 随包，`defaultClientDist` 双路径：monorepo `../../client/dist` 优先，安装态 fallback 包内 `client-dist`）。**已自动化**：根脚本 `pnpm pack:test`（构建 + 6 包 pack + npm 安装到 /tmp 测试目录，目录可用 `AI_EDITOR_PACKS_DIR`/`AI_EDITOR_TEST_DIR` 覆盖，默认 `/tmp/opencode/ai-editor-packs` 与 `/tmp/opencode/ai-editor-install-test`）→ `pnpm start:test`（启动安装态服务）→ `pnpm test:packed` 一键串联。日常测试用仓库内 `test-project/`（运行时数据不入库）。

## 版本发布流程

发布形态（inkos 模式）：6 包（shared/llm/db/tools/agent/server）全部发布 npm；用户只装 `@whispering233/ai-editor-server`（bin: ai-editor），npm 自动拉取其余 5 个依赖包；client 保持 private 不发布。**发布链路是唯一引入的 CI**（tasks.md「CI 任务不做」指此前 backlog 项，发布链路除外）——`.github/workflows/` 两个 workflow 仅在 push `v*` tag 时触发。

发布步骤：

0. **前置（一次性）**：创建 GitHub 仓库并推送代码（`.github/workflows/` 随代码入库——否则 tag push 无 workflow 可触发）；npmjs 为 6 个包各配置 Trusted Publisher（见下方前置段）
1. 更新根 `CHANGELOG.md`：把 Unreleased 条目搬运为新版本段（`## [vX.Y.Z] - <日期>`）
2. `node scripts/sync-version.mjs X.Y.Z`（或 `pnpm release:version X.Y.Z`；`--dry-run` 只预览）——同步 6 个发布包 + client + 根 package.json 的 version，输出改动文件清单；发布脚本依赖「6 包版本一致」不变式
3. `git add -A && git commit -m "chore(release): bump version to vX.Y.Z"`
4. `git tag -a vX.Y.Z -m "vX.Y.Z"`（**手动 annotated tag**，轻量 tag 不触发语义化发布规范）
5. `git push origin main && git push origin vX.Y.Z`
6. workflow 自动执行：`release.yml`（hermannm/release-from-changelog@v0.2.6 从 CHANGELOG.md 按 tag 匹配版本段创建 GitHub Release）+ `publish.yml`（6 包 npm 发布 + 安装态冒烟）

**前置（一次性，npmjs 手动）**：① 开启 npm 账号 **2FA**（npmjs 要求开启两步验证才能配置包管理；开启会撤销现有 token，需重新生成 Automation token 并 `npm config set //registry.npmjs.org/:_authToken=<新token>`）；② 为 6 个包各配置 **Trusted Publisher**：Publisher = GitHub Actions、仓库 = whispering233/ai-editor、工作流名 = `publish.yml`；配置后 workflow 无需 NODE_AUTH_TOKEN（`permissions.id-token: write` 自动换证）。

发布脚本要点：

- `scripts/publish-packages.mjs`：依赖序硬编码 shared → llm → db → tools → agent → server；每包 `npm view <name>@<version>` 判重（**E404 才视为未发布**，网络错误直接中止），已存在跳过 → 幂等重跑安全；`npm pack` 到临时目录后 `tar -xOf` 读包内 package.json 断言无 `workspace:` 残留（防线）；**发布方式（npm 12 manifest 时序坑）**：发布前主动执行 copy-client-dist（server 的 SPA 随包）+ prepare 替换 workspace:*，然后 `npm publish --access public --ignore-scripts`（跳过 prepack/postpack 钩子——npm 12 的 manifest 在 postpack 恢复后从磁盘生成，钩子替换只影响 tarball 导致 manifest 残留 workspace:*、`npm install` 报 EUNSUPPORTEDPROTOCOL），发布后 finally 主动 restore 恢复；`GITHUB_REF=refs/tags/vX.Y.Z` 存在时校验 tag 与包版本一致（不一致中止，防漂移误发）
- `scripts/verify-installed.mjs`：CI 发布后冒烟——**先轮询 6 包 registry 可见性**（`npm view` 20×30s = 10 分钟窗口；npm 包 manifest CDN 传播延迟实录最慢超 5 分钟，v0.0.6 曾 5 分钟窗口超窗失败，v0.0.7 起改为轮询可见后再装）→ mkdtemp 临时目录 `npm install --prefix <dir> @whispering233/ai-editor-server@<version>` → 断言已装包 version 匹配 + `.bin/ai-editor` 存在 → 短时启动 `node <pkg>/dist/index.js <空目录>`（20s 超时 kill——better-sqlite3 原生加载 + npm 冷启动给足余量），输出含「服务已启动」即通过（未见即失败）
- **automation token 限制**：绕过 2FA 的 granular token（Automation 类型）**不能执行 unpublish/deprecate**（npm 安全策略 403）——坏版本处理需 2FA 凭据（`npm login` 会话 + OTP）或 npmjs 网页操作
- 本地验证链路（pack:test/start:test，backlog #8）保留不动；`sync-version` 只改 version 字段，不碰依赖/scripts

## 约定

- **远端与 CI 仅限发布链路**：origin = `github.com/whispering233/ai-editor`（main 分支，发布链路已推送）；CI 仅 `.github/workflows/` 两个 workflow（release.yml + publish.yml，**push `v*` tag 时触发**，日常提交不进 CI）——日常开发不要 push / 建 PR / 新增 CI 配置（tasks.md「CI 任务不做」指发布链路以外的 CI），验证靠本地 `pnpm typecheck && pnpm lint && pnpm -r test`。
- 测试（vitest）：各包 `test` script = `vitest run`；**各包 tsconfig 已 `exclude: ["src/**/*.test.ts"]`**——不要改回，否则 tsc 会把测试编译进 dist 导致 vitest 双跑；测试文件由 vitest（esbuild）转译，lint 仍覆盖。
- 文档与提交信息用中文；commit 遵循 conventional commits（如 `feat(doc): ...`）。
- 所有 API 请求/响应契约集中在 `@whispering233/ai-editor-shared` 的 `types/api.ts`（Zod schema），前后端共用，不要各自定义；错误码统一 `ErrorCode` 枚举（REST/SSE/工具共用）。
- 对话历史 / 上下文走分层策略（系统指令 → 聚焦上下文 → 工具按需扩展 → 滑动窗口历史），不要把整个世界塞进 prompt。续聊重建与裁剪按 `assistant.tool_calls[].id` ↔ `tool.tool_call_id` **成对重组、同裁同留**，孤儿半对整对丢弃（DeepSeek 要求严格配对，缺一即拒）。
- API 命名：请求体/查询参数 **snake_case**，响应体 **camelCase**，outline.json 内部字段 snake_case；文件字段 ↔ API 字段的映射函数定义于 `@whispering233/ai-editor-shared/utils`。id 前缀：`char-`/`set-`/`loc-`/`hook-`、`sc-`/`ch-`/`vol-`、`proj-`，运行时对象 `prop_`/`sess_`/`call_`（文档示例的 `char-9` 是形状示意，**非自增序号**）。
- 时间约定：所有时间列/字段统一 ISO 8601 字符串、**由应用层写入**，不用 SQLite `datetime('now')`——回收站按 `deleted_at` 排序跨 SQLite 与 outline.json，格式必须统一。
- 延期项（多标签页并发、导出/导入、undo、token 统计等）见 `doc/design/backlog.md`，MVP 不做，不要顺手实现。
