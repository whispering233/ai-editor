# AGENTS.md

面向编码 agent 的协作入口。**设计文档是单一事实来源**：本文件只回答「读什么」「怎么协作」，并登记设计文档不承载的**代码级硬约束**——凡能在 `docs/` 里查到的内容，这里不复述。

## 文档即契约

**文档地图与阅读顺序 = `docs/docs-map.md`**（唯一索引来源，本文件不复述）。

- 改动前先读对应文档；发现文档之间或文档与代码矛盾，**先停下提问**，不要自行发明。
- pi 的行为以 `node_modules` 里实际安装的 `@earendil-works/*` 代码 / 类型为准，禁止凭记忆写接口。

## 协作流程

- 任务以 `docs/design/tasks.md` 为清单：垂直切片、一次一张、一卡一 commit、独立验证；卡内不做卡外顺手改动，完成后清卡并汇报。
- 每卡「实现 fixer + 独立验证 oracle」双代理；并行卡片用临时分支 + `git worktree`，验证后合回 main 并清理。
- 并行派工硬要求：子代理必须显式 `context: "fresh"`（默认 fork 会把父会话的编排叙事当成自己的进度）；任务卡必须带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS），并要求汇报附 commit hash / 命令输出。
- 验证命令：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`。**单包测试的 filter 必须与 package.json 的 `name` 逐字一致**（桌面包名无 scope = `ai-editor-desktop`），写错会打印 `Scope: 0 of 8 workspace projects` 并静默空跑；fresh clone 先 `pnpm -r build` 再 typecheck；UI 改动额外用浏览器核一次像素；改桌面版主进程（依赖 / import）后必须跑打包态启动冒烟。
- 提交信息用中文、遵循 conventional commits；文档里的日期用真实日期（`date +%F`）。**合同文档（`docs/api` / `docs/db` / `docs/ui` / `docs/design` 正文）不写任务卡编号**——卡清空后编号即成悬空引用；`backlog.md` 保留登记来源，代码注释里的历史阶段编号按 provenance 保留。
- 日常不 push、不建 PR、不新增 CI；远端与 CI 只服务发布链路（push `v*` tag 触发 `.github/workflows/`）。

## 版本发布

按 `docs/design/build.md`「正式发布链路」执行（发布面清单以该节为准，不在此复述）。

## 代码级硬约束

设计文档不承载实现约定，只在此登记；改了对应代码就同步改这里。

### 依赖与运行时

- 第三方运行时依赖一律**精确版本**（`@earendil-works/*`、`@blocknote/core|react|ariakit`、`electron`、`electron-updater`；禁 `^` / `~`）。升级 = 一个显式 commit 齐抬版本 + 全量测试 + **无锁安装冒烟**（`pnpm pack:test` + `pnpm start:test`；`pnpm test` 绿不代表装得上）+ 该包的浏览器 / 打包态核对。
- typebox 的 `Type` / `Static` 经 `pi-ai` 重导出，不单独装 typebox。传递依赖不需要自建解析锁（上游内部 pi 依赖均为精确版本）。**声明位置按 import 性质**：运行时 import 进 `dependencies`。
- 升级 pi 后复查三处「与 pi 同构」断言：`packages/server/src/http-dispatcher.ts` 与 pi `core/http-dispatcher.ts` 的差异只允许「不跟踪 `installedGlobalFetch`」；pi-ai 凭据解析顺序；会话文件类型（`session-manager.d.ts`）。
- 升级后复核模型目录：provider 家集合有增删改名要同步 `PROVIDER_ICONS`；`resolveDefaultModel` 对取不到的已选模型静默回落首个可用模型（不是缺陷）。
- 凡调 LLM 一律走 pi 的 Agent 路径（`createAgentSessionServices` + `createAgentSessionFromServices` + `SessionManager`）；禁止直连 `completeSimple`、禁止自建 fetch / agent / 请求头——provider 特化头、重试 / 超时、思考档位只在 pi 的包装层生效。
- pi 配置与凭据的唯一读写入口 = `packages/server/src/model-runtime.ts` 的 `getModelRuntime()` / `getSettingsManager()`；业务代码不得直读 `~/.pi/agent/auth.json` / `settings.json`。
- 出站 HTTP 走服务启动时安装的全局 undici dispatcher（`packages/server/src/http-dispatcher.ts`：连接族退避 + 环境代理 + 空闲超时）；业务代码不要另建 fetch / agent（云端 WebDAV 同样走它）。

### pi 会话侧口径

- 模型请求入参是 `TranscriptContext`：提示词与工具声明在 `messages` 首条 system 消息里，**顶层 `systemPrompt` 不存在**；断言提示词用 pi-ai 的 `getCurrentSystemPrompt(messages)`。
- 会话列表 `messageCount` 必须是可见消息数（`projectSessionMessages(entries).length`），禁用 pi `SessionInfo.messageCount`（它含首条 system 条目）。
- 会话文件在**首条 user 消息**落盘 ⇒ `SessionManager.create()` 之后盘上暂无文件；首轮中止会留只含 user 消息的会话（历史面板照常列出，不是缺陷）。
- 会话 id 是**不透明值**：服务端只能经「磁盘发现 + header id 映射」解析路径，禁止用客户端传入值拼接路径；旧 v1 扁平文件留盘但不读取。

### 数据库

- 查询层统一经 `queryDb` 取 drizzle 实例，禁止绕过直接 `prepare`（迁移管线除外）；JSON 列（data / changes / metadata）一律 text 模式 + 行映射防御解析，**禁用 drizzle `mode:'json'`**。
- db 打开只有一条管道 = `packages/server/src/middleware/project.ts` 的 `openProjectDatabase`（开机 `detectProject` 与 `POST /project/open` 共用）；缺 `data.db` 的全新空库直接写 `SCHEMA_VERSION`（不重置 `outline.json`）。
- 写文件类迁移（`up(db, ctx)`）必须幂等（整文件重写）；JSON 提取查询必须带 `json_valid` 守卫（裸 `json_extract` 遇坏 JSON 会打挂整表查询）。
- 表结构声明单源（建表 SQL 与迁移 DDL 逐字同形，不按 `kind` 建表）；语义不同的数据各用**专属表**，禁止塞进 `entities` 或通用 kv 表。
- Delta 字段白名单单一定义 = `shared/src/constants/delta.ts`（`SET_ONLY_FIELDS` / `REMOVED_CHARACTER_FIELDS` / `IMMUTABLE_FIELDS`），client / tools 禁止手抄。

### 云端存档

契约、协议与实测口径见 `docs/design/40-cloud-sync.md`、`docs/api/100-api-cloud.md`；实现侧单点：

- 凭据与同步状态唯一载体 = `<创作根>/.ai-editor/cloud.json`（不进项目文件 / 备份 zip / 任何 API 响应），读写唯一入口 = `packages/server/src/cloud/state.ts`。
- 变更判定只有一把尺子 `hasFileChangesSince`（备份 tick / 云端 `dirty` / 自动推送共用）；自动推送复用备份 tick 链，**不得新增第二套定时器**（`AUTO_PUSH_THROTTLE_MS` 是节流窗口，不是排程间隔）。
- 备份命名写入 = 解析，唯一实现 = `shared/utils/backup.ts`。**凭据不得进文件名段**：新增任何「用户文本进文件名」的入口都要挂同一守卫（写侧 `writeCloudConfig` / `writeBackup` / `renameBackup`，读侧 `configuredDeviceName` 把坏值当未配置）。
- 删书前若 `cloud.json` 有该书 book state → 先推送一份最新状态，失败默认中止（`force` 才继续）；不得绕过这套口径直接 `rm -rf` 书目录。

### API / 工具 / SSE

- 导出出口契约见 `docs/api/10-api-project.md`。实现侧单源：卷号 / 章号 / 文件名 / TXT 组装一律消费 shared（`outline-numbering.ts` 的 `numberVisibleOutline`、`orderVisibleChapters`、`sanitizeDocumentFileName`、`novel-export.ts`），服务端与客户端不得复刻；与服务端 `deriveChapterOrder`（含软删、保引用稳定）不是同一口径，不得互为替代。
- 关系端点适用性与说明的单源：`RELATION_TYPE_META[*].endpoints`（成对 `{from,to}`，缺省 = 通配，`"*"` 只在声明侧生效）与 shared `relationTypeAllowedFor` / `allowedRelationTypes`；它只收窄 UI 选单与 AI 提案，**服务端不新增端点校验**。`metadata` 归一一处 = shared `normalizeRelationMetadata`（POST / PUT / 工具执行侧共用，客户端不得手抄 trim / 删键）；客户端提交判定单源 = `lib/relation-types.ts` 的 `dialogRelationTypeAllowed` / `relationSubmitError`（`relation-submit-wiring.test.ts` 守接线）。
- 工具参数 schema 用 TypeBox，放 `packages/tools`（**不放 `shared`**：client 不打包 schema）；`execute` 抛错即失败；`propose_*` 的预览细节**只走 `details`**（随 `tool_execution_end` 帧下发），`content` 只给 `proposal_id` + 一句话摘要。
- 工作区类型（`kind`）的能力收窄与覆盖类写包入口校验见 `docs/design/60-practice.md` / `architecture.md`；实现上是 `ToolDefinition.scope` + 装配过滤（结构性边界，不靠提示词）。
- SSE 帧集与字段以 `docs/api/80-api-chat.md` 为准；唯一实现点 = `packages/agent/src/runtime/events.ts`，不得回退旧事件名。

### 数值单源

- 任何上限 / 缺省 / 阈值 / 档位常量**只在定义处出现**：散文与注释引用常量名，不复述数字；模型需要看到的数字必须由常量**插值**进工具 `description`，并有测试断言两者同值。
- 客户端派生（格式化 / 阈值 / 段优先级 / 热力档位 / 日历固定周数 `MONTH_CALENDAR_WEEKS`）同样单源：`client/src/lib/session-status.ts`、`client/src/lib/writing-stats.ts`；`--heat-*` 等 CSS 变量只定义在 `client/src/index.css`。

### 前端

- 任何切换当前项目的端点之后，客户端必须收敛项目镜像（重拉 config + outline + 书架）——服务端 `currentProject` 是单例事实源，客户端只是镜像。
- 同一路由组件的「形态」状态也是状态：`Dashboard` 的 `mode` 在 `#/` ↔ `#/overview` 之间不重挂载，凡 `if (mode !== "overview") return` 的 effect 必须把 `mode` 写进依赖数组。
- 开机直达书籍只在 `hooks/use-enter-last-book.ts` 做首帧一次；勿在 Dashboard / AppShell 加常驻重定向（会把「回书架」弹回去）。
- **改色唯一入口** = `AntdProvider.tsx`（同步 `DESIGN.md` 登记表）；块编辑器 `--bn-*` 映射唯一入口 = `components/blocknote/blocknote.css`；守卫 = `design-discipline.test.ts` + `components/antd-tokens.test.ts`，新增 antd 组件先扩 token 守卫。
- antd 组件会给 `.ant-btn` 注入 `position: relative`（与 Tailwind `.absolute` 同特异性、antd 注入更晚）⇒ 定位一律挂外层包装 `div`，不写在 antd 组件 `className` 上；危险色图标按钮写 `color="danger" variant="text"`。
- antd `Input` 会给 `.ant-input-affix-wrapper` 注入 `min-width: 0`（同样后注入、覆盖 Tailwind `min-w-*`）⇒ 弹性最小宽一律挂外层包装 `div`，直接写在 `Input` 的 `className` 上会被压成 0 宽。
- 缩进列几何依赖 antd `controlHeightSM`：占位 / 摘要 / 就地新建行复用同一条占位链（不手写 `pl-*` 像素），折叠箭头恒 `RightOutlined` + `!collapsed && "rotate-90"`（`antd-tokens.test.ts` 有该值断言）。
- 块编辑器升级 = 显式 commit + 全量测 + 浏览器像素核对；禁 `@blocknote/xl-*`；`server` / `tools` / `db` / `agent` 不得依赖 `@blocknote/*`（服务端不解析块结构）。
- `Ctrl/Cmd + S` = 保存当前内容 + 生成本地存档：键位常量 = `client/src/lib/save-shortcut.ts`；动作走 `registerSaveHandler` 注册栈（后注册者优先）；存档唯一注册者 = `AppShell` 的 `useSaveArchive`；页面保存失败必须 `return false`（阻断存档）。
- **大纲页（master-detail）实现侧**：大纲只拉一次（页面壳持有 `useOutlineLoader`，`OutlineDetail` 不自拉，`node` 由壳 `findNode` 派生传入）；选中唯一来源 = URL `#/outline/:nodeId`（`#/outline` 无选中）；detail 的 `useDataRefresh` 只刷关系 / 变更记录，**不得再 `reload()` 整树**；未保存守卫 = rail / 空白区 / 窄屏返回条 / 详情页头「写正文」外链（普通左键走 `onNavigate` → 壳 `confirmDiscard`；修饰键 / 中键保留浏览器原生新标签页），**浏览器后退仍不拦**（见 `backlog.md`）；拖拽落点单源 = `lib/outline-tree.ts` 的 `resolveDropPlan`（目标行父合法 → 同级前后；父不合法但目标行自身可承载 → `inside` + 子级末尾，覆盖空 / 折叠 / 非空卷章；卷 → 卷仍同级），页面不得另起判定；rail 宽度 / 收起态 key `ai-editor:outline-rail`。契约见 `DESIGN.md` `outline-page`。
- **大纲画布实现侧**：拖动只改坐标，不改父子 / 章序 / 卷归属（结构编辑唯一入口仍是大纲树）；坐标与视口只存本机 `ai-editor:canvas:{projectId}`（展示层偏好，不进项目文件 / 备份 / 云端，key 与形状见 `config.md`）；缺失坐标的补位布局单源 = `lib/outline-canvas-layout.ts`（页面不得另起摆位；**卡片高度 `canvasCardHeight()` 与行距都在这一个文件里派生**，页面不得写死 68 / 92 / 116）；LOD 只有两档、阈值与 `canvasLodLevel()` 同源（不新增中间档）；筛选是组件态（`lib/outline-canvas-filter.ts` 的 `matchCanvasChapterFilter` / `applyCanvasFilter`）——不写 localStorage、不进 URL、不重排卡片；只引 `@xyflow/react/dist/base.css`，`--xy-*` 唯一映射 = `components/outline-canvas/canvas-theme.css`。契约见 `DESIGN.md` `outline-canvas`。
- **章的结构化字段**：枚举与文案单源 = `shared/src/constants/outline.ts`（`OUTLINE_STATUS` / `CHAPTER_FUNCTIONS` / `CHAPTER_TENSIONS`），标签校验 = `shared` 的 `nodeTagsSchema`（章与场景共用，`trim` / ≤24 字 / ≤5 条）；表单控件单源 = `components/ui/tags-editor.tsx`（实体页与章详情共用，不要再抄一份）；保存前标签归一 = `lib/outline-detail.ts` 的 `normalizeOutlineDataForm`（`TagsEditor` 允许末行留空以便续输，空串直接提交会被服务端 400），dirty 判定也走同一归一；缺省 `status = "draft"` 与缺省等价（表单不得因默认值立刻判 dirty）。
- **设定页（master-detail）实现侧**：壳 = `pages/SettingWorkbench`，`SettingRail` 不自持选中（`nodeId` prop + `onSelect`，**选中唯一来源 = URL**）；树内写操作成功后经 `onMutated` 通知宿主走 `notifyDataChanged()`，**详情 dirty 时不发**（不得静默重置表单）；详情收起 = 整列不渲染且不改存宽度、点行不自动展开；rail 默认宽 / 边界 / 持久化 key 只在 `hooks/use-setting-rail.ts` 定义（窄屏两级互斥）。契约见 `DESIGN.md` `setting-page`。
- **工作台子栏页头单源 = `components/ui/panel-header.tsx`**（仅写作 / 大纲 / 设定的两列）：标题行 40 + 元信息行 24 + 分割线（`PageDivider` 必须是 header 直接子节点、横向内距挂 `insetClassName`，否则线两端内缩）；rail 头 `mb-0`、详情头 `-mx-6` + `insetClassName="px-6"`；操作一律 24px 图标、保存是唯一 `primary`。契约见 `DESIGN.md` §Layout「工作台子栏页头」。
- 聊天链路：SSE 解析唯一实现 = `hooks/use-sse.ts`；store 的 loadSeq / msgSeq 竞态、事件级流身份守卫、中止在途 SSE 的约定不得回退；工具行归一唯一入口 = `ChatPanel` 的 `asToolCall`。
- 提案 UI：`PROPOSAL_TYPE_LABELS` 必须覆盖 `PROPOSAL_TOOLS` 全集；历史只读卡从 `toolCalls` 重建并按 `toolCallId` 与 live 去重，不新增表 / API。
- 推演标记提交基底必须用可见标记（`lib/deduction.ts` 的 `toggledDeductionNodes`）——拿 raw `config.deductionNodes` 回传会把失效 id 送回服务端，严格 400 会让该书标记操作永久锁死。
- 写作面：工具条不得自任滚动容器（`sticky` 已是库 tooltip / 下拉的包含块）；高度链三处接通，中间不得用 `items-start` / `self-start` 截断（下游 `flex: 1` 拿不到剩余高度）。
- 新增练习页 = 三处同改：`components/nav/nav-items.tsx` 项集 / `lib/workspace-route-guard.ts` 的练习首段常量 / 「练习区无回收站、无概览」前提。
- 文本文件导入（范文等）必须走 `readTextFile`（UTF-8 → GB18030 回落，禁 `file.text()`）。
- 桌面能力检测唯一入口 = `client/src/lib/desktop.ts` 的 `desktopBridge()`（浏览器形态 / SSR 返回 null）；禁止在组件里直接摸 `window.aiEditorDesktop`。
- 泛型 `EntityList` / `EntityDetail` **已冻结**：不再承载新能力——列表只服务 location / relations，详情只服务 location / hook / timepoint 详情段与设定详情（由 `SettingWorkbench` 壳承载）；人物 / 设定 / 大纲页是自有工作台，见 `DESIGN.md`。
- 品牌与图标资产：`packages/client/public/provider-icons.svg`（供应商 logo）与 `client/public/brand-icon.svg`（系统面负形版，兼 favicon 与桌面图标源）的用法见 `DESIGN.md` / `50-desktop.md` §5.3；不要引入 `@lobehub/icons`，也不要另存图标副本。

### 桌面版

设计契约见 `docs/design/50-desktop.md`；实现侧不可省：

- preload 必须 CJS（源文件 `preload.cts`，`sandbox: true` 是既定基线），主进程 ESM；服务走主进程 in-process `startServer()`（不开子进程），退出复用 `ServerHandle.close()`；窗口加载 `http://127.0.0.1:<实际端口>`，**端口分段单源 = shared `constants/ports.ts`**（server / `vite.config` / desktop 全部派生，禁止复述字面量）。
- 应用级配置唯一载体 = `<userData>/desktop.json`；桌面包不得依赖 `process.cwd()` / 命令行参数；日志落 `<userData>/logs/ai-editor.log`；原生能力只经 preload 的 `pickDirectory()`。
- 打包不可省：`pnpm deploy --prod` + `npmRebuild: false` + 显式 `linux.executableName`（scope 名里的 `@` 会被 AppImage 工具链拒收）；Electron 42+ 无 postinstall（懒下载，install 阶段不要依赖它存在）。
- `electron-updater` 是 CJS ⇒ 必须默认导入 + 解构（具名导入在打包态直接崩、typecheck 不报）；只在 Windows 安装态、用户确认后先 `await closeServer()` 再 `quitAndInstall(true, true)`。
- 升级路径守卫不可回退：`installer.nsh` 的 `customUnInstall` 开头保留 `${If} ${isUpdated}` / `${If} ${Silent}` 早退（漏掉会在升级时弹「清除使用数据」）。卸载清理删目录前**必须先验签名文件** `<书库>/.ai-editor/library.json`——书库目录名是通用名，按名 `RMDir /r` 会误删用户自建的同名目录；`<userData>` 存在性检查用 `desktop.json`。
- 打包分工：本地只打 Linux 包自查，Windows 包只由 CI 出（本地交叉需 Wine）；workflow 不写 pnpm `version`（从根 `packageManager` 读）。

### 测试与验证

- 各包 `test` script = `vitest run`；各包 tsconfig 已 `exclude: ["src/**/*.test.ts"]`，不要改回——**`*.test.ts` 不进 `pnpm typecheck`**，编译期断言（`satisfies` / 穷尽性检查）必须写在 src 模块里；`.test.tsx` 仍会被 typecheck（有意保留）。
- 改 shared / db / tools 的 `src` 后先 `pnpm -r build` 再 typecheck / 下游测试（下游读上游 **dist**，不重建会给假绿）。
- 变异 / 探针验证只能用 `cp -r` 真副本或 `git worktree`，禁止硬链接副本 + 就地截断写（会写穿 inode 污染源仓库）；恢复后复跑全量回归。

## 产品非目标与延期项

- 非目标（理由见 `docs/design/00-master-design.md`「批量导入边界」）：不做超长小说正文生成、不做批量拆解导入——重新引入前必须先改设计文档。
- 延期项与有意口径：`docs/design/backlog.md`（多标签页、undo、token 聚合面、跨书参考资料导入等）。

## 仓库与目录

`docs/`、`scripts/`、`test-project/` 在仓库根；包内路径相对 `packages/`。`test-project/` 整体不入库（含运行时生成的 `.ai-editor/config.json`）；创作根 `.ai-editor/config.json` 只属服务端（`debug` 用户手编、`lastProject` 服务端在 open 成功后合并写入，见 `config.md`）。
