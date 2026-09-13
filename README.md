# AI Editor

面向小说创作者的本地优先 AI 辅助工具。**AI 是创作顾问，不是代笔**——帮助管理创作要素、探索剧情可能性、发现设定矛盾，正文永远由作者书写。

## 技术栈（架构参考 @actalk/inkos）

本项目在工程组织上借鉴了 [inkos](https://github.com/Narcooo/inkos)（长篇小说创作 AI Agent）的成功实践：pnpm monorepo 分包、共享契约层、打包发布机制与测试项目模式。

| 层 | 技术选型 |
|---|---------|
| 包管理 | pnpm workspace（6 包 monorepo：5 发布包 + 私有 client） |
| 运行时 | Node ≥ 22.12，全仓 ESM |
| 语言 | TypeScript strict mode |
| API 服务端 | Hono 4 + `@hono/node-server` |
| 数据库 | better-sqlite3 ^13（WAL，N-API 预编译）+ drizzle-orm 0.45（查询构建层） |
| 前端 | React 19 + Vite 7 + Zustand 5 + **antd v6**（ConfigProvider zhCN + 浅/深双算法 + cssVar tokens；**主题 = Notion 工作区暖灰 token 覆盖**，视觉契约见 `docs/ui/DESIGN.md`）+ **@ant-design/icons**（唯一图标集）+ **@ant-design/x**（Bubble/Sender 会话组件族）+ **@ant-design/x-markdown**（流式渲染）+ Tailwind 4（仅布局 utility）+ @uiw/react-md-editor（markdown 编辑器）+ Prettier（样式工程化） |
| 路由 | 自制 hash 路由（`useHashRoute`，无 React Router） |
| Schema 校验 | Zod 4（仅服务端执行，client 不打包校验函数） |
| AI 运行时 | 嵌入 `@earendil-works/pi-coding-agent` 0.85.1（含 pi-ai 模型层 / pi-agent-core 循环；**exact pin**）——模型目录、凭据、会话文件、重试、上下文压缩、工具派发全部由 pi 承担；本仓提供领域工具、内核提示词与 HTTP/SSE 契约（见 `docs/design/architecture.md`） |
| 测试 | vitest（各包独立 `test` script） |

## UI（v0.0.34 人物工作台与能力面板 + v0.0.33 导航归位与弹窗添加 + v0.0.32 思维链与会话渲染）

视觉语言 = **Notion 工作区**一脉：暖灰纸感中性色（`#37352f` 暖炭墨 / `#f6f5f4` 外壳底 / 三层描边）、hairline 分栏、零阴影、扁平、**彩色只服务状态与标签**；实现基座是 antd v6 的 token 派发（改色唯一入口 = `AntdProvider.tsx`），组件语言只有一套 antd（无自绘按钮/输入框/图标库第二套），排版四档 20/16/14/12，图标统一 `@ant-design/icons`（状态 Filled / 操作 Outlined）。**视觉契约（单一事实源）= `docs/ui/DESIGN.md`**，并由 `design-discipline.test.ts` 把纪律变成可执行断言。

书架主页 + 一级导航 + 常驻聊天三区结构，可拖拽调宽 + 收起/展开：

- **`#/` 书架主页**：书籍列表（当前打开高亮、行内导出/重命名/继续创作）+ 新建/导入备份/打开其他路径——书架能力集中于此，频繁切书不必留常驻书架栏
- **左栏 NavRail**：顶部标识 **`◈ 书架`**（书架主页 `#/` 入口）+ 导航区首项 **书名按钮**（项目概览 `#/overview` 入口，概览页时选中面；无项目禁用）+ 垂直导航**八项**（大纲 | 人物 | 设定 | 地点 | 伏笔 | 时间轴 | 关联 | 参考资料）+ 工具区（回收站）+ 底部设置 `#/preferences` / 主题切换；**无二级 tab**（实体家族一级化，旧 `#/entities/*` 路由重定向）；**「概览」不占一级导航位**（入口收敛到书名按钮）
- **中栏**：信息条（项目名→概览、当前位置、语言、全局刷新、小屏聊天开关）+ 页面内容区（内容区右下角悬浮「问 AI」按钮——点击必有反应：带当前页面上下文注入右栏；右栏收起/小屏抽屉自动打开）
- **右栏**：AI 聊天常驻（会话随项目目录走、`<1024px` 折叠为抽屉；会话列表 = x `Conversations` + 逐项「删除会话」（danger 二次确认），消息流 = x Bubble + x-markdown 流式渲染 + 工具调用折叠行 + 提案确认卡；输入框下方一行 = 模型选择 ／ 上下文占用（= 模型窗口占比）+ 思考强度）
- **三栏默认宽度**：左 10% / 右 40% / 中栏吸收剩余（两侧各有可读区间：左 160-480、右 240-960）——**1:5:4 在 1600–2400 视口精确成立**，更窄时左栏取下限、更宽时右栏封顶由中栏吸收；可拖拽调宽 + 收起/展开，宽度与收起态持久化 localStorage

布局与交互约定见 `docs/ui/DESIGN.md`（视觉与布局唯一契约；样式实现归代码，文档即契约）。

## 包结构

```
shared → db → tools → agent → server    （依赖方向，client 只依赖 shared）
```

- `@whispering233/ai-editor-shared`：前后端共享类型 / 常量 / 工具 / API 契约（零 Node 依赖，浏览器安全）
- `@whispering233/ai-editor-db`：SQLite 建表（drizzle `tables.ts` 双份声明）/ 查询（drizzle-orm 构建器）/ 原子写 / schema 演进（增量迁移 + 未来版本拒绝打开，无迁移路径时删库重建兜底）
- `@whispering233/ai-editor-tools`：领域工具（查询/分析/提案），参数 schema 用 TypeBox
- `@whispering233/ai-editor-agent`：pi 运行时装配（`ModelRuntime` + `SessionManager` + `AgentSession`）、内核提示词、工具适配、会话事件投影
- `@whispering233/ai-editor-server`：Hono API + SPA 静态托管（单进程部署）
- `@whispering233/ai-editor-client`：React SPA

## 快速开始

```bash
pnpm install
pnpm -r build        # 按依赖序构建 6 包

# 开发态（client :5173 + server :3456，proxy /api）
pnpm dev

# 测试项目（借鉴 inkos test-project 模式，运行时数据不入库）
pnpm start:test-project
# → 先 pnpm -r build（代码变动自动构建最新），再生产态启动
# → 浏览器自动打开 http://127.0.0.1:3456
# → 无项目时书架主页 #/ 引导创建/打开项目（落盘 test-project/books/<书名>/）

# 验证
pnpm typecheck && pnpm lint && pnpm -r test

# 调试（服务端日志，纯配置文件方式；无配置文件 = 默认关闭防刷屏）
# 配置文件：创作根/.ai-editor/config.json（start:test-project 时创作根 = test-project/；
#   该目录整体不入库（.gitignore），需自行创建；以下为可直接复制的示例）
#   默认示例（四类别全开）：{ "debug": { "enabled": true, "categories": ["chat", "request", "usage", "http"] } }
#   自定义示例（只显示请求和 tokens 统计）：{ "debug": { "enabled": true, "categories": ["request", "usage"] } }
#   四类别：chat（agent 事件）/ request（LLM 完整 prompt）/
#          usage（tokens 统计）/ http（hono 请求日志）；categories 缺失 = 全部类别；
#          enabled=false 或缺失 = 全关；文件不存在/非法 JSON/结构不符 = 全关
#   （环境变量开关已移除，配置文件是唯一来源）
```

## 当前能力（2026-09）

- **章级锚点收窄 + 人物页工作台（v0.0.34，2026-09）**：① **锚点仅章**——`current_position`、变更记录触发节点、伏笔锚点（`plants`/`advances`/`resolves` 源端）一律只支持**章**（卷/场景 400；REST/提案层/executor 三层同口径；`compute_state` 查询仍不限层级）；大纲行右键新增「设为当前位置」（仅章行）。② **`computeState` 改章序前缀累积**——状态 = 初始 `data` + 「章序 ≤ 目标进度章」的全部已确认 Delta（跨卷跨章累积；此前靠父链，锚点收窄后失效）；查询批量化（300 章由 ~146ms → ~3ms）。③ **能力面板（`ability_panel`）**——人物可变数据升级为**用户自定义字段树**（分支/叶子、仅叶子可赋值、拖拽/改名/删除、模板与「从角色复制」派生、叶子可被变更记录改：`ability_panel.火系.等级`）；旧标签式 `abilities[]` 由 `007` 迁移（`SCHEMA_VERSION 6 → 7`）。④ **人物页改为 master-detail 工作台**——`#/characters` = 左栏人物列表（姓名 + 角色定位、搜索/排序/新建）+ 右栏详情：**双视图 tab**（初始化数据可编辑 / 当前位置数据只读，含 conflicts 标注与手动选节点）、基础信息/可变数据分区、人物关系网（按类型分组、对称双向合并）+ 其他关联（折叠、条数常显）；新建人物弹窗（必填 姓名/角色定位/描述、重名软提示、面板三选）。⑤ 伏笔状态 Delta 改 `op=set`（物化事实字段不用 CAS，消除假冲突）；章级收窄配套：埋设机会扫描过滤软删场景、当前章退化取最后一个未软删章。⑥ 启动路径修复：开机直达的书同样走版本检测/迁移（此前跳过，DDL 迁移会"开机就崩"）；**缺 `data.db` 的书不再触发"删库重建 + 重置大纲"**（全新空库直接写版本号）。

- **导航与上手体验（v0.0.33，2026-09）**：① **打开即回到上次那本书**——创作根 `.ai-editor/config.json` 记 `lastProject`（open 成功后写入），服务启动时自动打开；路径失效/`project.json` 损坏 → 静默回书架；客户端首帧落在书架路由时直接进该书概览（书架入口仍在左栏顶部「◈ 书架」）。② **导航名实归位**：顶部标识「我的小说」→「书架」，导航区首项改为**书名按钮 → `#/overview`**，一级导航去掉「概览」（九项 → 八项），InfoBar 项目名同样进概览。③ **设置页「AI 模型」**只列**已配置**的 provider（不再一次列 40 家），「添加」改为**弹窗**（选择步：搜索 + 品牌图标；配置步：凭证 + key + 取消/保存，关窗不落状态），导航项与列表均带**供应商品牌图标**（自持 sprite `public/provider-icons.svg`，@lobehub/icons 派生 MIT，不引包）。④ 左栏底部三入口左对齐；⑤ 设置页凭据提示文案修正（**存量凭据优先、环境变量仅兜底**，见下）

- **AI 内核换为 pi（v0.0.32，2026-09）**：自建 LLM 适配层与 agent 主循环全部删除，改为**嵌入** `@earendil-works/pi-coding-agent` 0.85.1（exact pin）——模型目录/凭据/会话文件/重试/上下文压缩/工具派发由 pi 承担，本仓只保留领域工具、内核提示词与 HTTP/SSE 契约；会话文件格式改为 **pi session v3**（**旧 v1 会话不再读取**）；发布面 6→5 包（`packages/llm` 删除）；配置载体迁移（`~/.ai-editor/config.json` 废弃 → pi agent dir 的 `auth.json`/`models.json`/`settings.json`）；`POST /chat` SSE 事件集改为 pi 事件投影（客户端须同步升级，事件表见 `docs/api/80-api-chat.md`）；新增**思维链**（落盘含签名；默认折叠，流式自动展开、结束自动折叠，历史回看按需拉全文）；移除轮次上限与单轮超时（失控保护归 pi 的自动重试/自动压缩，用户可随时停止生成）；工具参数 schema 改 TypeBox；出站请求安装 pi 同款 HTTP dispatcher（IPv6 受限链路与代理环境可用）

- **视觉语言统一（v0.0.28，2026-09）**：新增 `docs/ui/DESIGN.md` 视觉契约（Google design.md 格式；antd seed 映射表 + 组件 token 覆盖表 + 四档字号/圆角/描边与阴影契约）；主题从 antd 默认蓝换为 Notion 工作区暖灰；组件语言收敛 antd（自绘按钮/输入框/提示/下拉全部退役，原生 `<select>` 22 处 → antd `Select`，sonner → antd `message`）；图标单点化 `@ant-design/icons`；排版四档制 + `PageTitle` 薄壳统一全站页头；新增纪律守卫测试（扫硬编码色 / `!` 前缀类 / 手写字号 / 被 antd 无层 CSS 压掉的类）；依赖净减 4（lucide-react / sonner / class-variance-authority / react-markdown）
- **视觉与交互修复（2026-09，v0.0.29）**：修掉三条 **antd v6 静默失效**（「测试全绿但像素全错」）——① cssVar 的 `--ant-*` 从不注入 `:root`（挂在组件级 class 作用域），`index.css` 的语义变量映射整体为空 → 全站 Tailwind 语义色（卡片底/描边/次要文字/hover 面/拖拽线）透明；修法 = `cssVar.key` 与 `index.html` 的 `<html class>` 同值；② `Button` 的 `variant` 必须与 `color` 同时给（单独 `variant="text"` 静默回落带边框 outlined）；③ 用户气泡底色 `colorPrimaryBg`（深墨 seed 派生为 `#787771` 中灰，对比度 1.9:1）→ `surface-muted`。新增 **标签 tint 系统**（6 色按名称 hash 稳定分配，同名恒同色，`ui/tag-chip.tsx` 唯一实现）、**中栏页面头部统一结构**（标题单独一行 + 控件行「搜索→分类→标签→排序 ／ 操作按钮」，搜索框统一图标/192px/可清除）、**统一拖拽插入线**（primary 实线 + 端点圆点 + 落点淡染高亮）、**链式新建**（就地新建后新条目「选中 + 聚焦」，可连续 Enter 逐级建子设定/子节点）。三条规则 + 拼接类名一并变成源码守卫（`design-discipline.test.ts` 14 条，含自检样例）
- **右栏交互与选中面修复（v0.0.30，2026-09）**：① **全站下拉选中项不可读**（用户报「所有下拉选中条目因背景色看不清」）——根因两层：antd 选中面取全局 alias `controlItemBgActive` / `…ActiveHover`（由 `colorPrimary` 派生，深墨主色下派生成中深灰 `#787771` / `#6b6a65`，对比度 2.26:1），且弹层打开时已选中项被自动置为 active（命中 `&-selected&-active`）⇒ 组件级 `Select.optionSelectedBg` 在真实路径上无效；修法 = `AntdProvider` 覆盖这两个全局 alias（= 已登记的选中面），Select/Dropdown/Menu/Pagination/Tree/Table 一次到位，实测 9 处 2.26:1 → 10.59:1；新增 **派生 token 守卫**（`antd-tokens.test.ts` 5 条，用 antd `getDesignToken` 断言对比度 ≥ 4.5:1 + 自检）。② **右栏输入区**：模型选择/思考强度移到输入框下方 + 两端对齐，两个下拉浮层 `popupMatchSelectWidth={false}`（旧触发器宽度把 `DeepSeek V4 Flash`、`minimal`/`medium`/`xhigh` 截断）。③ **会话列表换 x `Conversations`**（两行项、灰面选中态）。④ **三栏默认比例**：右栏上限 720 → 960（= 2400 的 40%），**1:5:4 在 1600–2400 视口精确成立**。⑤ 面板收起/展开图标统一 `«`/`»` 镜像对。**纯前端，API/数据契约零改动**
- **对话历史与会话存储**：对话历史存**项目目录** `sessions/`（一 session 一个 JSONL，格式 = pi session v3 树状条目）——会话随书目录走（备份/导入/改名/移动天然携带）；**思维链随消息落盘**（含签名，多轮工具调用回放需要）；会话列表/消息/思维链全文/删除四个端点（删除物理删文件：404 `SESSION_NOT_FOUND` / 409 `SESSION_BUSY`，右栏二次确认）；备份与恢复覆盖 `sessions/` 整目录。**上下文压缩由 pi 承担**（阈值 + 溢出两种触发，占用条 = 模型窗口占比）；单条工具结果超上限**截断 + 提示**不终止对话。设置页「AI 模型」分区：provider 列表与模型目录全部来自 pi（含认证状态与 key 管理）
- **项目管理**：书架模式（`books/` 子目录）、创建/打开/关闭/配置、LLM 设置（模型/key）；**项目规则文件 AGENTS.md**——项目目录 AGENTS.md 为项目规则唯一事实源（取代 project.json `prompt`，打开项目时自动迁移）；设置页直接编辑 + 文件管理器直接编辑 + mtime 外部修改检测
- **大纲**：严格三层（卷→章→场景）增删改移（行级只留删除按钮；选中按 Enter 新建子级、双击查看详情、点击标题行内编辑、右键菜单注入上下文/建立关联）、节点详情（麦基《故事》结构化字段）
- **实体与关系**：七类实体（人物/设定/地点/伏笔/事件·时间轴/时间标签点·时间轴/参考资料）CRUD、k 跳关系遍历、Delta 变更追踪与状态计算（computeState）；**设定层级**——父子关系用 `belongs_to` 表达（防环校验），详情页「层级」区块 + 设定一级页树形视图（`#/setting`：递归树 + 折叠/行内编辑/拖拽调层级/手动排序）；**标签分类**——设定分类统一 `data.tags`，列表标签列 + 标签筛选（`?tag=`）+ 新建行标签输入（datalist 自动完成 + 快捷选择）；**列表与编辑增强（M1-M3，2026-08）**——设定列表行显示上级设定（chip 点击直达父详情）与描述（截断展示 + hover 查看）；标签/规则编辑器回车添加下一项 + 拖拽排序（HTML5 原生 DnD）；**上级设定筛选（N1-N2）**——设定列表新增「上级设定」下拉，选定后只显示其直接及**所有后代设定（递归子树）**，与标签筛选/搜索/排序组合（AND）；**可搜索下拉（O1/O5）**——「上级设定 / 标签」筛选改为**可搜索下拉**（输入关键词过滤候选 +「全部」重置），设定树视图新增**「全部展开 / 全部折叠」**工具栏按钮；**设定/标签筛选可搜索下拉（O1）**与**设定树全部展开/折叠（O5）**；**人物列表形态**——现为**人物工作台左栏**（姓名 + 角色定位、搜索/排序/新建；详情的两视图与三区见上文 v0.0.34 条）；**设定树增强**——行显示描述摘要 + **排序方式切换器（名称/创建时间/手动）**：手动模式行悬停 ↑↓ 箭头与拖拽行间插入线同级重排（复合端点 `PUT /entity/setting/:id/move`，复用 sort_order 列无迁移），拖到行中段仍可调整层级
- **时间轴（阶段 C + G2 修订 + H1-H6 交互优化）**：**时间标签点（timepoint）与事件双实体**——事件经 `occurs_at` 挂载到时间点（1:n），时间点与事件各有独立线性序（拖拽时间点 = 整组移动不动内部、拖拽单条事件 = 组内重排/跨组自动改挂载）；垂直时间轴 + 时间点组块 + 未挂载兜底区；时间点可重命名、组内新建事件、AI 按时间标签语义排序（提案确认）；`occurs_in` 锚定大纲场景（倒叙/多时间线可表达）；软删回收站；交互优化：删除入口直接展示、软删/还原免二次确认、操作按钮不收入 `...` 菜单、文字按钮带边框、标题行信息与操作右移、事件行“N 节点”计数靠右、**拖拽无可见手柄（提示保留）与折叠按钮移至组标题左侧（O3/O4，参考大纲页拖拽/折叠位序）**
- **参考资料（2026-08）**：第 7 种实体类型 reference（`ref-` 前缀，SCHEMA_VERSION 5）——外部素材/灵感笔记（非本书正文边界）；**两类承载**——本地 md 文档（`references/` 项目目录自包含，YAML frontmatter（title/category/tags）+ markdown 正文，**文件 = 真相源、DB 索引 = 派生镜像**：应用内编辑先原子写文件再更新 DB，外部编辑/新增/删除靠扫描同步——mtime 快照比对幂等全量，索引丢失可完整重建；软删文件移 `references/.trash/`）/ 外源链接（URL 必填仅索引）；列表改**表格平铺**（thead 四列：标题/分类/标签/来源），交互对齐大纲（点击标题行内编辑/双击详情/只留删除/右键菜单注入上下文与建立关联）；新建分流两按钮 → 草稿态详情页：md 内嵌 **@uiw/react-md-editor** 分屏编辑器（暗色联动）+ 导入 md 文档（frontmatter 解析预填）+ 建立关联面板；外源链接详情页 URL 必填 + 备注 + 关联面板；**分类自定义**——取消预置枚举（`data.type` 自由文本，无 DDL 迁移），详情页文本框 + datalist（建议项 = 项目内已用分类，可自由输入新分类），列表筛选聚合现有分类，存量枚举值回显中文名；**扫描同步**——列表「扫描」按钮 + 未同步提示条（只读探测）；**存档联动**——备份/导出/导入/恢复打包 references/，自动备份变更检测覆盖本地文档；LLM 集成 `search_references`（自动查询，纯 DB 读取）+ `propose_create_reference`（AI 建议保存 → 提案确认后写库，归外源链接类）；参考资料为独立一级导航项 `#/references`（路由一级化，泛型入口去重，旧 `#/entities/*` 重定向）
- **伏笔系统（S9 已就绪）**：伏笔池面板（活跃/已回收/已废弃分组、新建埋点、推进/回收/废弃复合写确认、依赖链展开、软删级联）+ 大纲节点伏笔标记（📌 埋设/⏩ 推进/✅ 回收徽标）；**MVP 简化**——伏笔面板不展示健康指标与章节序（`_health` 仍作为 REST 附加字段返回，契约未定义）
- **回收站**：软删还原 / 彻底清除 + 启动一致性校验兜底
- **AI 对话链路**：内核 = 嵌入 `@earendil-works/pi-coding-agent`（模型/凭据/会话/重试/上下文压缩/工具派发全部由 pi 承担；本仓提供领域工具、内核提示词与 HTTP/SSE 契约）；35 个 LLM 可见工具（查询 9 / 分析 5 / 伏笔 5 / 提案 16）+ 13 个执行类不经 LLM（用户确认后由服务端执行）；工具参数 schema 用 TypeBox（校验交 pi，非法参数自动喂回自纠）；**无轮次上限与单轮超时**（失控靠用户停止/steering 干预；自动重试与自动压缩归 pi）；提案确认流程（TTL 10 分钟 + 快照重校验 + 卡片确认/拒绝）；SSE = pi 会话事件的轻量投影（事件表见 `docs/api/80-api-chat.md`）；**思维链默认折叠**（流式期间自动展开，历史回看按需拉全文）；**右栏**——模型选择（pi 目录 + 认证状态，未配凭据的 provider 不可选）+ 思考强度（off/minimal/low/medium/high/xhigh/max）+ 上下文占用条 + 工具调用行 + 提案卡；**key 管理**——写入 pi 的 agent dir（`~/.pi/agent/auth.json`；**一家一条且存量凭据优先，环境变量只在该家无条目时兜底**），存量 OAuth 订阅登录不被覆盖；key 不入项目文件；**出站请求**支持 HTTP 代理（`HTTP(S)_PROXY` 环境变量或 pi settings 的 `httpProxy`）与可配空闲超时；**问 AI 入口**——中栏右下悬浮按钮（读当前页面焦点注入右栏）+ 行级右键菜单「注入会话上下文 / 建立关联」
- **交互优化（2026-09）**：中栏右下悬浮「问 AI」（点击必有反应）；右栏 focus 小条显示实体名称（`names/resolve`，不再裸 id）；`Ctrl/Cmd+S` 保存（4 详情页表单 + 伏笔编辑态 + 5 处行内编辑）；新建即聚焦（设定树/实体列表/大纲/时间点：滚动 + 高亮 + 键盘焦点）；实体列表页移除残留「实体」标题与类型 tab；面包屑整站移除（返回走左栏 NavRail）；设定树拖拽插入线强化
- **交互体验（2026-08）**：AI 确认提案后中栏数据自动刷新 + InfoBar 全局刷新按钮；刷新页面自动恢复最近会话；渲染异常防白屏（可恢复错误卡）；画布页已移除（`plot_edge` 数据能力保留）；**布局重构**——书架主页/概览/设置独立路由、左栏一级导航（9 项 + 回收站工具区）、会话流 x Bubble/x-markdown 渲染、历史工具调用 wire 形态渲染层归一（修复展开 `{}`）
- **交互优化与新需求（2026-08）**：**大纲交互优化**——行级只保留删除按钮，选中节点按 Enter 新建子级、双击节点查看详情、点击标题行内编辑、拖拽排序保留；**时间轴交互参考大纲**——事件行与组标题行双击=详情、点击标题=行内编辑、移除「详情/编辑」按钮；**移除实体列表更新时间**——列表去「更新时间」列与排序，详情页元信息保留；**右键菜单**——行级右键菜单替代「带上下文问 AI」按钮（「注入会话上下文」复用 focusContext +「建立关联」新建 relation_records）；**项目规则文件 AGENTS.md**——项目目录 AGENTS.md 为项目规则唯一事实源（取代 project.json prompt，打开时自动迁移），设置页直编 + 文件管理器直接编辑 + mtime 外部修改检测；**实体设定页树形视图**——设定列表改树形视图与设定树合并（层级天然展示、折叠/展开、行内编辑、拖拽调整层级、Enter 新建子级、双击详情、搜索+标签树内过滤、移除分页）
- **样式工程化（2026-08 起）**：client 包有 Prettier 配置（`packages/client/.prettierrc.json` + `prettier-plugin-tailwindcss`，**未接入 CI 强制**，仓库存在历史格式漂移）；共享样式常量 `lib/styles.ts`（错误横幅/骨架——图标按钮常量已随「图标按钮统一」删除）+ `EmptyState`/`SectionCard` 薄壳（内部即 antd `Empty`/`Card`）；全仓硬编码色类清零 token 化；**视觉与布局规范归 `docs/ui/DESIGN.md`**（`ui/` 下无第二份规范）——注意 antd 样式是无层 CSS，不要在 antd 组件根元素上用 Tailwind 类覆盖其已声明属性（宽度用容器、尺寸用 `size`、状态用 `variant`/token）
- **数据备份（阶段 B2 已就绪）**：一键导出完整项目（zip 打包 project.json + outline.json + data.db（含 WAL 完整快照）+ references/ + sessions/）/ 从备份导入（服务端校验 + 原子搬入）；**自动备份**——按频率（关闭/5/10/15/30/60 分钟，默认 10 分钟开启，跟随书籍）有变更才备份，每项目保留最近 20 份；**手动备份**——设置页「立即备份」可带自定义名称，列表以简单标签区分手动/自动（B2.5/B2.6）；**备份重命名**——列表行内编辑改名称（时间与类型标签保持）；**加载备份**——设置页历史备份列表（强确认 + 覆盖前自动快照后悔药）或书架导入文件（以 project_id 为 key：匹配 → 覆盖恢复 / 不匹配 → 新书，同名不再 409 可重命名或去重并存）；书架支持重命名书名——「数据主权归用户」（product.md 原则 1）
- **调试**：创作根 `.ai-editor/config.json` 细粒度四类别（chat/request/usage/http，见上文示例；无配置文件默认关闭）

## 打包安装（借鉴 inkos 发布机制）

```bash
# 5 包 pack（prepack 钩子自动：SPA 进包 + workspace:* 替换真实版本）
for p in shared db tools agent server; do
  pnpm --filter @whispering233/ai-editor-$p pack --pack-destination /tmp/ai-editor-packs
done
# 测试目录安装（未发布 registry 也能装——npm 对同批 tarball 复用依赖）
npm install /tmp/ai-editor-packs/*.tgz
# 运行：服务 + 自动打开浏览器界面
npx ai-editor <项目目录>
```

## 发布与安装

**用户安装**（发布形态：5 包全部发布 npm，用户只装 server 一个包，其余 4 个依赖自动拉取）：

```bash
npm install -g @whispering233/ai-editor-server
ai-editor <项目目录>   # 启动服务 + 自动打开浏览器 http://127.0.0.1:3456
```

> 版本说明：**当前最新版 v0.0.34**（v0.0.1-v0.0.34 由 CI OIDC 自动发布，发布全链路自动化已验证；v0.0.34 = **章级锚点收窄 + 章序前缀累积 + 能力面板（SCHEMA_VERSION 6→7）+ 人物页工作台（双视图 tab/关系网/新建弹窗）+ 启动路径迁移修复**；v0.0.33 = 导航归位（书架/概览入口）+ 打开即回到上次那本书 + 设置页「AI 模型」只列已配置、弹窗添加与供应商品牌图标 + 凭据优先级文案修正；v0.0.32 = **AI 内核换为 pi**（嵌入 pi-coding-agent 0.85.1；会话格式 = pi session v3、配置迁 pi agent dir、SSE 事件集改 pi 投影、新增思维链）+ 发布面 6→5 包；v0.0.31 = 对话历史迁出数据库（`chat_messages` → 项目目录 `sessions/*.jsonl`，SCHEMA_VERSION 5→6）+ 会话删除端点 + 上下文预算配置化 + 设置页信息架构重构）；**v0.0.1/v0.0.2 不可安装**——其 npm manifest 残留 `workspace:*` 协议（npm `EUNSUPPORTEDPROTOCOL`，已用 `npm view` 复验），**已于 2026-09-11 在 npm 上标注 deprecate**（db/tools/agent/server 等包 × 2 版本，registry 复验通过；`shared` 无依赖可正常安装，未标注）；安装时使用 `@whispering233/ai-editor-server@latest` 即可。

**发布前置（一次性，npmjs 手动）**：① 开启 npm 账号 **2FA**（npmjs 要求开启两步验证才能配置包管理；开启会撤销现有 token，需重新生成 Automation token）；② 为 `@whispering233/ai-editor-shared`、`@whispering233/ai-editor-db`、`@whispering233/ai-editor-tools`、`@whispering233/ai-editor-agent`、`@whispering233/ai-editor-server` 五包各配置 Trusted Publisher：Publisher = GitHub Actions、工作流名 = `publish.yml`；配置后 CI 无需 token（OIDC 自动换证）。

**发布流程**（详见 `docs/design/build.md`「正式发布链路」）：更新根 `CHANGELOG.md`（Unreleased 搬运为新版本段）→ `pnpm release:version X.Y.Z` 同步 5 包 + client + 根版本 → commit + 手动 annotated tag `vX.Y.Z` → push tag 后 workflow 自动执行（release.yml 建 GitHub Release，publish.yml 发布 5 包 npm + 安装态冒烟验证）。

## 文档（文档即契约）

| 目录 | 内容 |
|------|------|
| `docs/design/` | 总体设计、架构与分包、详细设计（数据模型/上下文/agent 循环）、任务清单、配置说明、构建发布 |
| `docs/api/` | 公共约定、错误码、接口索引、各模块端点契约、AI 工具目录 |
| `docs/db/` | 表结构 / outline.json / project.json 契约 |
| `docs/ui/` | **视觉与布局唯一契约**（`DESIGN.md`：色/字号/圆角/间距/三栏布局与中栏页头结构/组件外观 + antd token 登记表与守卫） |
| `test-project/` | 测试项目目录（整体不入库；调试开关写法见上文「快速开始」） |

阅读顺序与文档索引见根 `AGENTS.md`（文档即契约；入口：`docs/design/00-master-design.md` → `architecture.md` → 详细设计 → `docs/api/00-api-index.md`）。实现任何功能前先读对应文档。

## 设计原则

- **本地优先**：全部数据存本地（project.json + outline.json + data.db + sessions/），不上传云端
- **结构体先行**：创作要素结构化（人物/设定/地点/伏笔），AI 在结构上做语义分析与建议
- **AI 只提案不写入**：工具分「自动 / 提案确认」两级，写操作必须用户确认
- **软删 + 回收站**：误删可还原，purge 才物理清除

## License

[MIT](LICENSE) © 2026 whispering233
