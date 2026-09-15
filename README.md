# AI Editor

面向小说创作者的本地优先 AI 辅助工具。**AI 是创作顾问，不是代笔**——帮助管理创作要素、探索剧情可能性、发现设定矛盾，正文永远由作者书写。

## 技术栈（架构参考 @actalk/inkos）

本项目在工程组织上借鉴了 [inkos](https://github.com/Narcooo/inkos)（长篇小说创作 AI Agent）的成功实践：pnpm monorepo 分包、共享契约层、打包发布机制与测试项目模式。

| 层 | 技术选型 |
|---|---------|
| 包管理 | pnpm workspace（7 包 monorepo：5 发布包 + 私有 client / desktop） |
| 运行时 | Node ≥ 22.12，全仓 ESM |
| 语言 | TypeScript strict mode |
| API 服务端 | Hono 4 + `@hono/node-server` |
| 数据库 | better-sqlite3 ^13（WAL，N-API 预编译）+ drizzle-orm 0.45（查询构建层） |
| 前端 | React 19 + Vite 7 + Zustand 5 + **antd v6**（ConfigProvider zhCN + 浅/深双算法 + cssVar tokens；**主题 = Notion 工作区暖灰 token 覆盖**，视觉契约见 `docs/ui/DESIGN.md`）+ **@ant-design/icons**（唯一图标集）+ **@ant-design/x**（Bubble/Sender 会话组件族）+ **@ant-design/x-markdown**（流式渲染）+ Tailwind 4（仅布局 utility）+ @uiw/react-md-editor（markdown 编辑器）+ Prettier（样式工程化） |
| 路由 | 自制 hash 路由（`useHashRoute`，无 React Router） |
| Schema 校验 | Zod 4（仅服务端执行，client 不打包校验函数） |
| AI 运行时 | 嵌入 `@earendil-works/pi-coding-agent` 0.85.1（含 pi-ai 模型层 / pi-agent-core 循环；**exact pin**）——模型目录、凭据、会话文件、重试、上下文压缩、工具派发全部由 pi 承担；本仓提供领域工具、内核提示词与 HTTP/SSE 契约（见 `docs/design/architecture.md`） |
| 测试 | vitest（各包独立 `test` script） |
| 桌面版 | Electron 44.3.0（**exact pin**）+ electron-builder（安装包）；主进程内嵌 server，与你自己装的 CLI 版共用同一份数据（`docs/design/50-desktop.md`） |

## UI（v0.0.40 桌面版外壳 + v0.0.39 大纲/设定行级新建与层级收紧 + v0.0.38 云端同步状态区与一键同步 + v0.0.37 徽标两形态定稿与星形图移除 + v0.0.36 自由输入下拉 + v0.0.34 人物工作台与能力面板 + v0.0.33 导航归位与弹窗添加 + v0.0.32 思维链与会话渲染）

视觉语言 = **Notion 工作区**一脉：暖灰纸感中性色（`#37352f` 暖炭墨 / `#f6f5f4` 外壳底 / 三层描边）、hairline 分栏、零阴影、扁平、**彩色只服务状态与标签**；实现基座是 antd v6 的 token 派发（改色唯一入口 = `AntdProvider.tsx`），组件语言只有一套 antd（无自绘按钮/输入框/图标库第二套），排版四档 20/16/14/12，图标统一 `@ant-design/icons`（状态 Filled / 操作 Outlined）。**视觉契约（单一事实源）= `docs/ui/DESIGN.md`**，并由 `design-discipline.test.ts` 把纪律变成可执行断言。

书架主页 + 一级导航 + 常驻聊天三区结构，可拖拽调宽 + 收起/展开：

- **`#/` 书架主页**：书籍列表（当前打开高亮、行内导出/重命名/继续创作）+ 新建/导入备份/打开其他路径——书架能力集中于此，频繁切书不必留常驻书架栏
- **左栏 NavRail**：顶部标识 **`◈ 书架`**（书架主页 `#/` 入口）+ 导航区首项 **书名按钮**（项目概览 `#/overview` 入口，概览页时选中面；无项目禁用）+ 垂直导航**八项**（大纲 | 人物 | 设定 | 地点 | 伏笔 | 时间轴 | 关联 | 参考资料）+ 工具区（回收站）+ 底部设置 `#/preferences` / 主题切换；**无二级 tab**（实体家族一级化，旧 `#/entities/*` 路由重定向）；**「概览」不占一级导航位**（入口收敛到书名按钮）
- **中栏**：信息条（项目名→概览、阅读进度、语言、全局刷新、小屏聊天开关）+ 页面内容区（内容区右下角悬浮「问 AI」按钮——点击必有反应：带当前页面上下文注入右栏；右栏收起/小屏抽屉自动打开）
- **右栏**：AI 聊天常驻（会话随项目目录走、`<1024px` 折叠为抽屉；会话列表 = x `Conversations` + 逐项「删除会话」（danger 二次确认），消息流 = x Bubble + x-markdown 流式渲染 + 工具调用折叠行 + 提案确认卡；输入框下方一行 = 模型选择 ／ 上下文占用（= 模型窗口占比）+ 思考强度）
- **三栏默认宽度**：左 10% / 右 40% / 中栏吸收剩余（两侧各有可读区间：左 160-480、右 240-960）——**1:5:4 在 1600–2400 视口精确成立**，更窄时左栏取下限、更宽时右栏封顶由中栏吸收；可拖拽调宽 + 收起/展开，宽度与收起态持久化 localStorage

布局与交互约定见 `docs/ui/DESIGN.md`（视觉与布局唯一契约；样式实现归代码，文档即契约）。

## 包结构

```
shared → db → tools → agent → server    （依赖方向，client 只依赖 shared，desktop 只依赖 server）
```

- `@whispering233/ai-editor-shared`：前后端共享类型 / 常量 / 工具 / API 契约（零 Node 依赖，浏览器安全）
- `@whispering233/ai-editor-db`：SQLite 建表（drizzle `tables.ts` 双份声明）/ 查询（drizzle-orm 构建器）/ 原子写 / schema 演进（增量迁移 + 未来版本拒绝打开，无迁移路径时删库重建兜底）
- `@whispering233/ai-editor-tools`：领域工具（查询/分析/提案），参数 schema 用 TypeBox
- `@whispering233/ai-editor-agent`：pi 运行时装配（`ModelRuntime` + `SessionManager` + `AgentSession`）、内核提示词、工具适配、会话事件投影
- `@whispering233/ai-editor-server`：Hono API + SPA 静态托管（单进程部署）
- `@whispering233/ai-editor-client`：React SPA
- `@whispering233/ai-editor-desktop`：Electron 外壳（窗口/菜单/目录选择/书库位置/日志/打包；**不含业务逻辑**）

## 桌面版（安装包）

下载安装包，装完双击即用（**不需要 Node / npm**）：

| 平台 | 安装包 | 首次打开注意 |
|---|---|---|
| Windows | `AI Editor-<版本>-win-x64.exe`（NSIS，可选安装目录） | 首版未签名 → 可能弹 SmartScreen，选「仍要运行」 |
| macOS | `AI Editor-<版本>-mac-{arm64,x64}.dmg` | 首版未签名未公证 → **右键 → 打开**放行一次 |
| Linux | `AI Editor-<版本>-linux-x86_64.AppImage` | `chmod +x` 后直接运行 |

- 安装包挂在每个版本的 GitHub Release 上（与 npm 包共用同一个 tag）
- 首次启动会让你选**书库位置**（书籍、备份、对话历史都放那里）；随时可在 设置 → 通用 → 书库位置 更改（改完自动重启）
- 桌面版与 CLI 版**共用同一份数据与凭据**（`~/.pi/agent/`、项目目录格式一致）——两边可以打开同一个书库
- 本地出包：`pnpm desktop:dist`（产物在 `packages/desktop/release/`）

## 快速开始

```bash
pnpm install
pnpm -r build        # 按依赖序构建 7 包

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

## 当前能力（2026-10）

- **桌面版（Electron 外壳，v0.0.40，2026-10）**：用户下载安装包、装完双击即用（**不需要 Node / npm**）——与 npm CLI 版**共用同一份数据与凭据**（`~/.pi/agent/`、项目目录格式一致，两边能打开同一书库）。要点：① **外壳不是第二产品**——主进程内 in-process 起现有 server（`packages/server` 未改一行），窗口加载 `http://127.0.0.1:<端口>`，端口固定优先（保 `localStorage` 偏好稳定）；② **书库位置**首次启动选（建议值 `<文档>/AI Editor`），存 `<userData>/desktop.json`，设置页「通用」tab 可改（改完自动重启）；③ **原生能力只开一个**——preload（沙箱 CJS）仅暴露目录选择，书架页据此多一个「浏览…」按钮，**浏览器形态零变化**（能力检测无桥即不渲染）；④ **安全基线**——`contextIsolation`/`sandbox` 开、`nodeIntegration` 关，外链一律交系统浏览器、跨源导航被拦、生产包不暴露 devtools；⑤ **日志落盘** `<userData>/logs/ai-editor.log`（桌面用户没有终端，日志是排障唯一线索）；⑥ **打包**——electron-builder（Windows NSIS / macOS dmg / Linux AppImage），`pnpm deploy` 收自包含依赖、better-sqlite3 的 N-API 预编译在 Electron 44 上**免 rebuild**；首版不签名（macOS 首次需右键打开、Windows 有 SmartScreen 提示）。设计与契约：`docs/design/50-desktop.md`。

- **UX/UI 优化：树行新建入口 + 层级收紧 + 三处显示修正（v0.0.39，2026-09）**：① **行级「新建子级」按钮**——大纲页（卷 → 新建章、章 → 新建场）与设定页（任意设定 → 新建子设定）行尾新增 `+` 图标按钮，位置恒在删除按钮左侧（删除贴行尾，跨行操作列对齐）；原生入口（选中按 Enter 建子级）保留，两者同一路径。② **层级收紧：章只能挂卷**——此前章可直挂根（「根级章」）；现 `root` 仅接纳卷（写入侧三层同口径：REST 400 / AI 提案层 / 前端拖拽拒绝），**存量根级章读容忍**（可渲染/改名/删除/拖进卷，不能新建或移回 root，**无迁移**）。③ **大纲页页头改「+ 新建卷」**，就地新建行取消卷/章切换（原先点切换按钮会让输入框失焦→整行取消，表现为「点一下就关」）。④ **大纲行缩进列对齐修正**——无子节点行的占位与折叠箭头几何不一致，导致「有场章 / 无场章」两类行的类型徽标/标题/摘要/新建行各差 12px。⑤ **关联页端点类型徽标漏中文**——「时间点」「事件」等端点曾原样显示 `timepoint` / `event`（手抄的四类表漏项），现派生 shared `ENTITY_TYPE_LABELS`；同型问题一并清掉（时间轴事件详情「关联节点（occurs_in）」、伏笔页分区块标题与生命周期预览里的关系键）。⑥ **阅读进度徽标统一走 `TypeChip`**（与卷/章/场同形，1px 描边）；人物页「阅读进度」tab 的能力面板空值叶子不再给 `—` 占位符。
- **云端存档（WebDAV，v0.0.38，2026-09）**：给备份加**异地副本 + 多设备续写**——推送/拉取整包 zip 到用户自己的 WebDAV 云盘（**坚果云原生支持**；其他云盘用 rclone / AList 桥接），**不自建后端**。要点：① **本地仍是唯一事实源**——云端只是「备份的另一块磁盘」，离线可用优先，云端失败不阻塞本地功能；② **凭据只落** `<创作根>/.ai-editor/cloud.json`（0600 明文；不进项目文件 / 备份 zip / 任何 API 响应，接口从不回传密码）；③ **地址 = 用户云盘根**（如 `https://dav.jianguoyun.com/dav`），工作根 `<云盘根>/ai-editor/` 由应用自动拼接与创建；④ **推送 = 本地备份 zip 逐字节上传**（`PUT .tmp-<名>` → `MOVE` 成正式名，正式名下永远是完整包；同名同大小幂等跳过；只保留最近 5 份，**带标签的永不清理**）；⑤ **拉取 = 三文件覆盖 + `references/`/`sessions/` 并集合并**（云端删的删本机、本机删的不复活、本机新增保留），覆盖前自动快照——与本地 restore 的整体覆盖语义**刻意不同**；⑥ **三态状态机**（已同步 / 云端更新 / 本机改动）+ 左栏「同步云端」一键动作与两色角标（冲突 = red、有事可做 = warning、不可达不亮）；⑦ **冲突裁决**：两条路都各留一份备份（保留云端 / 用本机覆盖）；⑧ **自动推送**：2 小时节流（复用备份定时链，不新增定时器），关闭项目与手动备份各触发一次，纯聊天不单独触发；有未备份改动时跳过（不把落后内容静默推上云）。设计与契约：`docs/design/40-cloud-sync.md`、`docs/api/100-api-cloud.md`；真机验收清单见 `docs/design/backlog.md`。
- **UI 收口：徽标两形态定稿 + 星形图移除（v0.0.37，2026-09）**：① **徽标准入变成组件名**——`TagChip` 只给用户标签（`data.tags`，tint **3 档** `#cce9fc`/`#d1e2c4`/`#ffd800` 按名 hash 稳定分配），`TypeChip` 只给枚举类型/分类（`surface-muted` 底 + 1px `#d94a4a` 描边 + 随主题翻转的墨字，实测描边 3.61 / 3.34:1）——此前「按文案 hash 取模」使同类枚举在名页各行其是且不承载语义；② **人物关系星形图整体移除**（v0.0.36 新增、v0.0.37 删）：分组列表已是关系网的完整明细，图的索引价值不足抵一张 SVG；③ 关联总览关系类型列改左对齐（与源/目标列同口径）；④ 大纲行尾阅读进度徽标改排在删除按钮**左侧**（跨行操作列恒对齐）；⑤ 人物页进度节点下拉支持搜索（antd `Select` 默认按 `value` 过滤，而该选择器 value = 节点 id ⇒ 必须显式 `optionFilterProp="label"`）。
- **关系类型收口 + 自定义类型（v0.0.36，2026-09）**：① **属性单一定义**——新增 `RELATION_TYPE_META`（展示名 / 分组 / 对称性，`Record<RelationType, …>`），原先散在四处的**手写关系类型清单全部改为派生**（客户端中文标签表 / 人物页人↔人子集 / 对称集合 / 对话框排除集），加类型不补属性即编译失败。② **自定义关系类型**——「建立关联」对话框可直接输入新类型（`trim` 非空 / ≤ 32 字符 / 禁控制字符，REST、db 守卫、客户端预校验**共用同一校验函数**）；下拉 = 调用方子集 ∪ 「本项目已用自定义类型」（带条数）；**无需迁移**（`relation_type` 无 CHECK，存量数据不受影响）；无中心记录 ⇒ 暂无改名/合并（已进 backlog）。③ **AI 侧仍限预定义 17 类**（工具 schema 枚举不变，只读到不创建，属有意分层）。④ **对称口径统一**——`ally`/`rival`/`family` 单一定义；`detect_conflicts` 从此把**单向 `rival`** 也报为「反向缺失」（原先只报 ally/family）。⑤ **（v0.0.37 已删除）人物关系星形图**——人物页「人物关系网」tab 列表上方曾加**零依赖手写 SVG**（中心 = 当前角色；叶子按**人物**去重，同一人多条关系合并 + ` · N`；阈值 <4 叶不画 / >24 叶只画点；叶子可点切角色；**不引布局库**）。⑥ **字段清单一致性断言**——人物可变字段清单与 schema 的编译期穷尽性断言 + 运行期集合相等（schema 加字段而界面未接 = 编译失败）。
- **人物页信息架构 + 阅读进度文案（v0.0.35，2026-09）**：① **人物页改四个平级 tab**——「人物档案」（可编辑）/「阅读进度」（`computeState` 累积结果只读）/「人物关系网」/「其他关联 · N」（条数常显于标签，涵盖 `appears_in` 等 AI 分析数据源）；关系两块从「tab 之下共享」改为**各自独立 tab**，其他关联**去掉折叠态**。② **字段区改档案式网格**——一卡之内 label 左置 64px、单行字段 ≥md 两列、长文本/标签整行；**不再分「基础信息 / 可变数据」块**（不可变性分层只服务变更记录白名单与 AI 提案边界，不再在 UI 表达），字段顺序立单一清单。③ **阅读进度画纯文本值**——同网格同 label、值文本化（空值 `—`），比一排 disabled 输入框干净；`panel-tree` 只读形态 = 缩进「名称 + 值文本」行。④ **文案**：「当前位置」全站改「阅读进度」（InfoBar / 概览 / 大纲 / 伏笔面板 / compute 探针 / toast），「计算节点」改「进度节点」（`current_position` 字段名不变）；能力面板叶子空值去掉 `—` 占位符。⑤ **三个选章选择器收窄为仅章**——人物页进度节点 / 通用 compute 探针 / `#/hooks/:id` 预计回收节点（状态按章序前缀累积，非章节点只是某章的别名；API 与工具层 `at_node_id` 仍不限层级，供 AI 用场景语言提问）。
- **章级锚点收窄 + 人物页工作台（v0.0.34，2026-09）**：① **锚点仅章**——`current_position`、变更记录触发节点、伏笔锚点（`plants`/`advances`/`resolves` 源端）一律只支持**章**（卷/场景 400；REST/提案层/executor 三层同口径；`compute_state` 查询仍不限层级）；大纲行右键新增「设为当前位置」（仅章行）。② **`computeState` 改章序前缀累积**——状态 = 初始 `data` + 「章序 ≤ 目标进度章」的全部已确认 Delta（跨卷跨章累积；此前靠父链，锚点收窄后失效）；查询批量化（300 章由 ~146ms → ~3ms）。③ **能力面板（`ability_panel`）**——人物可变数据升级为**用户自定义字段树**（分支/叶子、仅叶子可赋值、拖拽/改名/删除、模板与「从角色复制」派生、叶子可被变更记录改：`ability_panel.火系.等级`）；旧标签式 `abilities[]` 由 `007` 迁移（`SCHEMA_VERSION 6 → 7`）。④ **人物页改为 master-detail 工作台**——`#/characters` = 左栏人物列表（姓名 + 角色定位、搜索/排序/新建）+ 右栏详情：**双视图 tab**（初始化数据可编辑 / 当前位置数据只读，含 conflicts 标注与手动选节点）、基础信息/可变数据分区、人物关系网（按类型分组、对称双向合并）+ 其他关联（折叠、条数常显）；新建人物弹窗（必填 姓名/角色定位/描述、重名软提示、面板三选）。⑤ 伏笔状态 Delta 改 `op=set`（物化事实字段不用 CAS，消除假冲突）；章级收窄配套：埋设机会扫描过滤软删场景、当前章退化取最后一个未软删章。⑥ 启动路径修复：开机直达的书同样走版本检测/迁移（此前跳过，DDL 迁移会"开机就崩"）；**缺 `data.db` 的书不再触发"删库重建 + 重置大纲"**（全新空库直接写版本号）。

- **导航与上手体验（v0.0.33，2026-09）**：① **打开即回到上次那本书**——创作根 `.ai-editor/config.json` 记 `lastProject`（open 成功后写入），服务启动时自动打开；路径失效/`project.json` 损坏 → 静默回书架；客户端首帧落在书架路由时直接进该书概览（书架入口仍在左栏顶部「◈ 书架」）。② **导航名实归位**：顶部标识「我的小说」→「书架」，导航区首项改为**书名按钮 → `#/overview`**，一级导航去掉「概览」（九项 → 八项），InfoBar 项目名同样进概览。③ **设置页「AI 模型」**只列**已配置**的 provider（不再一次列 40 家），「添加」改为**弹窗**（选择步：搜索 + 品牌图标；配置步：凭证 + key + 取消/保存，关窗不落状态），导航项与列表均带**供应商品牌图标**（自持 sprite `public/provider-icons.svg`，@lobehub/icons 派生 MIT，不引包）。④ 左栏底部三入口左对齐；⑤ 设置页凭据提示文案修正（**存量凭据优先、环境变量仅兜底**，见下）

- **AI 内核换为 pi（v0.0.32，2026-09）**：自建 LLM 适配层与 agent 主循环全部删除，改为**嵌入** `@earendil-works/pi-coding-agent` 0.85.1（exact pin）——模型目录/凭据/会话文件/重试/上下文压缩/工具派发由 pi 承担，本仓只保留领域工具、内核提示词与 HTTP/SSE 契约；会话文件格式改为 **pi session v3**（**旧 v1 会话不再读取**）；发布面 6→5 包（`packages/llm` 删除）；配置载体迁移（`~/.ai-editor/config.json` 废弃 → pi agent dir 的 `auth.json`/`models.json`/`settings.json`）；`POST /chat` SSE 事件集改为 pi 事件投影（客户端须同步升级，事件表见 `docs/api/80-api-chat.md`）；新增**思维链**（落盘含签名；默认折叠，流式自动展开、结束自动折叠，历史回看按需拉全文）；移除轮次上限与单轮超时（失控保护归 pi 的自动重试/自动压缩，用户可随时停止生成）；工具参数 schema 改 TypeBox；出站请求安装 pi 同款 HTTP dispatcher（IPv6 受限链路与代理环境可用）

- **视觉语言统一（v0.0.28，2026-09）**：新增 `docs/ui/DESIGN.md` 视觉契约（Google design.md 格式；antd seed 映射表 + 组件 token 覆盖表 + 四档字号/圆角/描边与阴影契约）；主题从 antd 默认蓝换为 Notion 工作区暖灰；组件语言收敛 antd（自绘按钮/输入框/提示/下拉全部退役，原生 `<select>` 22 处 → antd `Select`，sonner → antd `message`）；图标单点化 `@ant-design/icons`；排版四档制 + `PageTitle` 薄壳统一全站页头；新增纪律守卫测试（扫硬编码色 / `!` 前缀类 / 手写字号 / 被 antd 无层 CSS 压掉的类）；依赖净减 4（lucide-react / sonner / class-variance-authority / react-markdown）
- **视觉与交互修复（2026-09，v0.0.29）**：修掉三条 **antd v6 静默失效**（「测试全绿但像素全错」）——① cssVar 的 `--ant-*` 从不注入 `:root`（挂在组件级 class 作用域），`index.css` 的语义变量映射整体为空 → 全站 Tailwind 语义色（卡片底/描边/次要文字/hover 面/拖拽线）透明；修法 = `cssVar.key` 与 `index.html` 的 `<html class>` 同值；② `Button` 的 `variant` 必须与 `color` 同时给（单独 `variant="text"` 静默回落带边框 outlined）；③ 用户气泡底色 `colorPrimaryBg`（深墨 seed 派生为 `#787771` 中灰，对比度 1.9:1）→ `surface-muted`。新增 **标签 tint 系统**（6 色按名称 hash 稳定分配，同名恒同色，`ui/tag-chip.tsx` 唯一实现）、**中栏页面头部统一结构**（标题单独一行 + 控件行「搜索→分类→标签→排序 ／ 操作按钮」，搜索框统一图标/192px/可清除）、**统一拖拽插入线**（primary 实线 + 端点圆点 + 落点淡染高亮）、**链式新建**（就地新建后新条目「选中 + 聚焦」，可连续 Enter 逐级建子设定/子节点）。三条规则 + 拼接类名一并变成源码守卫（`design-discipline.test.ts` 14 条，含自检样例）
- **右栏交互与选中面修复（v0.0.30，2026-09）**：① **全站下拉选中项不可读**（用户报「所有下拉选中条目因背景色看不清」）——根因两层：antd 选中面取全局 alias `controlItemBgActive` / `…ActiveHover`（由 `colorPrimary` 派生，深墨主色下派生成中深灰 `#787771` / `#6b6a65`，对比度 2.26:1），且弹层打开时已选中项被自动置为 active（命中 `&-selected&-active`）⇒ 组件级 `Select.optionSelectedBg` 在真实路径上无效；修法 = `AntdProvider` 覆盖这两个全局 alias（= 已登记的选中面），Select/Dropdown/Menu/Pagination/Tree/Table 一次到位，实测 9 处 2.26:1 → 10.59:1；新增 **派生 token 守卫**（`antd-tokens.test.ts` 5 条，用 antd `getDesignToken` 断言对比度 ≥ 4.5:1 + 自检）。② **右栏输入区**：模型选择/思考强度移到输入框下方 + 两端对齐，两个下拉浮层 `popupMatchSelectWidth={false}`（旧触发器宽度把 `DeepSeek V4 Flash`、`minimal`/`medium`/`xhigh` 截断）。③ **会话列表换 x `Conversations`**（两行项、灰面选中态）。④ **三栏默认比例**：右栏上限 720 → 960（= 2400 的 40%），**1:5:4 在 1600–2400 视口精确成立**。⑤ 面板收起/展开图标统一 `«`/`»` 镜像对。**纯前端，API/数据契约零改动**
- **对话历史与会话存储**：对话历史存**项目目录** `sessions/`（一 session 一个 JSONL，格式 = pi session v3 树状条目）——会话随书目录走（备份/导入/改名/移动天然携带）；**思维链随消息落盘**（含签名，多轮工具调用回放需要）；会话列表/消息/思维链全文/删除四个端点（删除物理删文件：404 `SESSION_NOT_FOUND` / 409 `SESSION_BUSY`，右栏二次确认）；备份与恢复覆盖 `sessions/` 整目录。**上下文压缩由 pi 承担**（阈值 + 溢出两种触发，占用条 = 模型窗口占比）；单条工具结果超上限**截断 + 提示**不终止对话。设置页「AI 模型」分区：provider 列表与模型目录全部来自 pi（含认证状态与 key 管理）
- **项目管理**：书架模式（`books/` 子目录）、创建/打开/关闭/配置、LLM 设置（模型/key）；**项目规则文件 AGENTS.md**——项目目录 AGENTS.md 为项目规则唯一事实源（取代 project.json `prompt`，打开项目时自动迁移）；设置页直接编辑 + 文件管理器直接编辑 + mtime 外部修改检测
- **大纲**：严格三层（卷→章→场景；**2026-09 起章只能挂卷**，`root` 仅接纳卷）增删改移（行级＝新建子级按钮 + 删除按钮，新建按钮在删除左侧；选中按 Enter 新建子级、双击查看详情、点击标题行内编辑、右键菜单注入上下文/建立关联）；页头主操作「+ 新建卷」；节点详情（麦基《故事》结构化字段）
- **实体与关系**：七类实体（人物/设定/地点/伏笔/事件·时间轴/时间标签点·时间轴/参考资料）CRUD、k 跳关系遍历、Delta 变更追踪与状态计算（computeState）；**设定层级**——父子关系用 `belongs_to` 表达（防环校验），详情页「层级」区块 + 设定一级页树形视图（`#/setting`：递归树 + 折叠/行内编辑/拖拽调层级/手动排序）；**标签分类**——设定分类统一 `data.tags`，列表标签列 + 标签筛选（`?tag=`）+ 新建行标签输入（datalist 自动完成 + 快捷选择）；**列表与编辑增强（M1-M3，2026-08）**——设定列表行显示上级设定（chip 点击直达父详情）与描述（截断展示 + hover 查看）；标签/规则编辑器回车添加下一项 + 拖拽排序（HTML5 原生 DnD）；**上级设定筛选（N1-N2）**——设定列表新增「上级设定」下拉，选定后只显示其直接及**所有后代设定（递归子树）**，与标签筛选/搜索/排序组合（AND）；**可搜索下拉（O1/O5）**——「上级设定 / 标签」筛选改为**可搜索下拉**（输入关键词过滤候选 +「全部」重置），设定树视图新增**「全部展开 / 全部折叠」**工具栏按钮；**设定/标签筛选可搜索下拉（O1）**与**设定树全部展开/折叠（O5）**；**人物列表形态**——现为**人物工作台左栏**（姓名 + 角色定位、搜索/排序/新建；详情的**四平级 tab**（人物档案 / 阅读进度 / 人物关系网 / 其他关联 · N）见上文 v0.0.35 条）；**设定树增强**——行显示描述摘要 + **排序方式切换器（名称/创建时间/手动）**：手动模式行悬停 ↑↓ 箭头与拖拽行间插入线同级重排（复合端点 `PUT /entity/setting/:id/move`，复用 sort_order 列无迁移），拖到行中段仍可调整层级
- **时间轴（阶段 C + G2 修订 + H1-H6 交互优化）**：**时间标签点（timepoint）与事件双实体**——事件经 `occurs_at` 挂载到时间点（1:n），时间点与事件各有独立线性序（拖拽时间点 = 整组移动不动内部、拖拽单条事件 = 组内重排/跨组自动改挂载）；垂直时间轴 + 时间点组块 + 未挂载兜底区；时间点可重命名、组内新建事件、AI 按时间标签语义排序（提案确认）；`occurs_in` 锚定大纲场景（倒叙/多时间线可表达）；软删回收站；交互优化：删除入口直接展示、软删/还原免二次确认、操作按钮不收入 `...` 菜单、文字按钮带边框、标题行信息与操作右移、事件行“N 节点”计数靠右、**拖拽无可见手柄（提示保留）与折叠按钮移至组标题左侧（O3/O4，参考大纲页拖拽/折叠位序）**
- **参考资料（2026-08）**：第 7 种实体类型 reference（`ref-` 前缀，SCHEMA_VERSION 5）——外部素材/灵感笔记（非本书正文边界）；**两类承载**——本地 md 文档（`references/` 项目目录自包含，YAML frontmatter（title/category/tags）+ markdown 正文，**文件 = 真相源、DB 索引 = 派生镜像**：应用内编辑先原子写文件再更新 DB，外部编辑/新增/删除靠扫描同步——mtime 快照比对幂等全量，索引丢失可完整重建；软删文件移 `references/.trash/`）/ 外源链接（URL 必填仅索引）；列表改**表格平铺**（thead 四列：标题/分类/标签/来源），交互对齐大纲（点击标题行内编辑/双击详情/只留删除/右键菜单注入上下文与建立关联）；新建分流两按钮 → 草稿态详情页：md 内嵌 **@uiw/react-md-editor** 分屏编辑器（暗色联动）+ 导入 md 文档（frontmatter 解析预填）+ 建立关联面板；外源链接详情页 URL 必填 + 备注 + 关联面板；**分类自定义**——取消预置枚举（`data.type` 自由文本，无 DDL 迁移），详情页文本框 + datalist（建议项 = 项目内已用分类，可自由输入新分类），列表筛选聚合现有分类，存量枚举值回显中文名；**扫描同步**——列表「扫描」按钮 + 未同步提示条（只读探测）；**存档联动**——备份/导出/导入/恢复打包 references/，自动备份变更检测覆盖本地文档；LLM 集成 `search_references`（自动查询，纯 DB 读取）+ `propose_create_reference`（AI 建议保存 → 提案确认后写库，归外源链接类）；参考资料为独立一级导航项 `#/references`（路由一级化，泛型入口去重，旧 `#/entities/*` 重定向）
- **伏笔系统（S9 已就绪）**：伏笔池面板（活跃/已回收/已废弃分组、新建埋点、推进/回收/废弃复合写确认、依赖链展开、软删级联）+ 大纲节点伏笔标记（antd Filled 图标徽标：埋设/推进/回收）；**MVP 简化**——伏笔面板不展示健康指标与章节序（`_health` 仍作为 REST 附加字段返回，契约未定义）
- **回收站**：软删还原 / 彻底清除 + 启动一致性校验兜底
- **AI 对话链路**：内核 = 嵌入 `@earendil-works/pi-coding-agent`（模型/凭据/会话/重试/上下文压缩/工具派发全部由 pi 承担；本仓提供领域工具、内核提示词与 HTTP/SSE 契约）；35 个 LLM 可见工具（查询 9 / 分析 5 / 伏笔 5 / 提案 16）+ 13 个执行类不经 LLM（用户确认后由服务端执行）；工具参数 schema 用 TypeBox（校验交 pi，非法参数自动喂回自纠）；**无轮次上限与单轮超时**（失控靠用户停止/steering 干预；自动重试与自动压缩归 pi）；提案确认流程（TTL 10 分钟 + 快照重校验 + 卡片确认/拒绝）；SSE = pi 会话事件的轻量投影（事件表见 `docs/api/80-api-chat.md`）；**思维链默认折叠**（流式期间自动展开，历史回看按需拉全文）；**右栏**——模型选择（pi 目录 + 认证状态，未配凭据的 provider 不可选）+ 思考强度（off/minimal/low/medium/high/xhigh/max）+ 上下文占用条 + 工具调用行 + 提案卡；**key 管理**——写入 pi 的 agent dir（`~/.pi/agent/auth.json`；**一家一条且存量凭据优先，环境变量只在该家无条目时兜底**），存量 OAuth 订阅登录不被覆盖；key 不入项目文件；**出站请求**支持 HTTP 代理（`HTTP(S)_PROXY` 环境变量或 pi settings 的 `httpProxy`）与可配空闲超时；**问 AI 入口**——中栏右下悬浮按钮（读当前页面焦点注入右栏）+ 行级右键菜单「注入会话上下文 / 建立关联」
- **交互优化（2026-09）**：中栏右下悬浮「问 AI」（点击必有反应）；右栏 focus 小条显示实体名称（`names/resolve`，不再裸 id）；`Ctrl/Cmd+S` 保存（4 详情页表单 + 伏笔编辑态 + 5 处行内编辑）；新建即聚焦（设定树/实体列表/大纲/时间点：滚动 + 高亮 + 键盘焦点）；实体列表页移除残留「实体」标题与类型 tab；面包屑整站移除（返回走左栏 NavRail）；设定树拖拽插入线强化
- **交互体验（2026-08）**：AI 确认提案后中栏数据自动刷新 + InfoBar 全局刷新按钮；刷新页面自动恢复最近会话；渲染异常防白屏（可恢复错误卡）；画布页已移除（`plot_edge` 数据能力保留）；**布局重构**——书架主页/概览/设置独立路由、左栏一级导航（当版 8 项 + 回收站工具区；2026-08 该批为 9 项，概览已并入书名按钮）、会话流 x Bubble/x-markdown 渲染、历史工具调用 wire 形态渲染层归一（修复展开 `{}`）
- **交互优化与新需求（2026-08）**：**大纲交互优化**——行级只保留删除按钮，选中节点按 Enter 新建子级、双击节点查看详情、点击标题行内编辑、拖拽排序保留；**时间轴交互参考大纲**——事件行与组标题行双击=详情、点击标题=行内编辑、移除「详情/编辑」按钮；**移除实体列表更新时间**——列表去「更新时间」列与排序，详情页元信息保留；**右键菜单**——行级右键菜单替代「带上下文问 AI」按钮（「注入会话上下文」复用 focusContext +「建立关联」新建 relation_records）；**项目规则文件 AGENTS.md**——项目目录 AGENTS.md 为项目规则唯一事实源（取代 project.json prompt，打开时自动迁移），设置页直编 + 文件管理器直接编辑 + mtime 外部修改检测；**实体设定页树形视图**——设定列表改树形视图与设定树合并（层级天然展示、折叠/展开、行内编辑、拖拽调整层级、Enter 新建子级、双击详情、搜索+标签树内过滤、移除分页）
- **样式工程化（2026-08 起）**：client 包有 Prettier 配置（`packages/client/.prettierrc.json` + `prettier-plugin-tailwindcss`，**未接入 CI 强制**，仓库存在历史格式漂移）；共享样式常量 `lib/styles.ts`（错误横幅/骨架——图标按钮常量已随「图标按钮统一」删除）+ `EmptyState`/`SectionCard` 薄壳（内部即 antd `Empty`/`Card`）；全仓硬编码色类清零 token 化；**视觉与布局规范归 `docs/ui/DESIGN.md`**（`ui/` 下无第二份规范）——注意 antd 样式是无层 CSS，不要在 antd 组件根元素上用 Tailwind 类覆盖其已声明属性（宽度用容器、尺寸用 `size`、状态用 `variant`/token）
- **数据备份（阶段 B2 已就绪）**：一键导出完整项目（zip 打包 project.json + outline.json + data.db（含 WAL 完整快照）+ references/ + sessions/）/ 从备份导入（服务端校验 + 原子搬入）；**自动备份**——按频率（关闭/1/5/10/15/30/60 分钟，默认 10 分钟开启，跟随书籍）有变更才备份，每项目保留最近 20 份；**手动备份**——设置页「立即备份」可带自定义名称，列表以简单标签区分手动/自动（B2.5/B2.6）；**备份重命名**——列表行内编辑改名称（时间与类型标签保持）；**加载备份**——设置页历史备份列表（强确认 + 覆盖前自动快照后悔药）或书架导入文件（以 project_id 为 key：匹配 → 覆盖恢复 / 不匹配 → 新书，同名不再 409 可重命名或去重并存）；书架支持重命名书名——「数据主权归用户」（product.md 原则 1）
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

> 版本说明：**当前仓库版本 v0.0.40**（本版含首个桌面版安装包；npm 包与三平台安装包由同一个 tag 产出）。⚠ **v0.0.31 / v0.0.34 / v0.0.35 / v0.0.37 未推送 tag、npm 上不存在**——它们在本地成版（CHANGELOG 与版本号已写）但发布未执行（v0.0.37 属「一次推多个 tag → GitHub 丢弃事件」的那批，见 `docs/design/build.md`「发布管道坑记录」），变更已累积进后续版本；**npm 实际序列：… 0.0.32 → 0.0.33 → 0.0.36 → 0.0.38 → 0.0.39 → 0.0.40**。各版本要点：v0.0.40 = **桌面版（Electron 外壳）首版**（安装包分发 + 书库位置 + 目录选择 + 应用菜单与日志 + 安全导航 + 三平台 CI；npm CLI 与浏览器形态不变）；v0.0.39 = **树行新建入口（大纲/设定）+ 章只能挂卷（存量根级章读容忍）+ 大纲缩进列对齐 + 关联页端点徽标中文 + 阅读进度徽标描边统一**（详见 `CHANGELOG.md`，本版为纯前端与展示层修正，无数据迁移）；v0.0.38 = **云端存档（WebDAV 整批）**；v0.0.36 = **关系类型属性单一定义 + 自定义关系类型（无需迁移）+ 人物字段清单编译期断言**（放宽了 `relation_type` 校验：原先必 400 的输入现在可能 201）；v0.0.35 = **人物页四平级 tab + 档案式字段网格 + 「阅读进度」文案统一 + 三个选章选择器只列章**；v0.0.34 = **章级锚点收窄 + 章序前缀累积 + 能力面板（SCHEMA_VERSION 6→7）+ 人物页工作台（双视图 tab/关系网/新建弹窗）+ 启动路径迁移修复**；v0.0.33 = 导航归位（书架/概览入口）+ 打开即回到上次那本书 + 设置页「AI 模型」只列已配置、弹窗添加与供应商品牌图标 + 凭据优先级文案修正；v0.0.32 = **AI 内核换为 pi**（嵌入 pi-coding-agent 0.85.1；会话格式 = pi session v3、配置迁 pi agent dir、SSE 事件集改 pi 投影、新增思维链）+ 发布面 6→5 包；v0.0.31 = 对话历史迁出数据库（`chat_messages` → 项目目录 `sessions/*.jsonl`，SCHEMA_VERSION 5→6）+ 会话删除端点 + 上下文预算配置化 + 设置页信息架构重构；**v0.0.1/v0.0.2 不可安装**——其 npm manifest 残留 `workspace:*` 协议（npm `EUNSUPPORTEDPROTOCOL`，已用 `npm view` 复验），**已于 2026-09-11 在 npm 上标注 deprecate**（db/tools/agent/server 等包 × 2 版本，registry 复验通过；`shared` 无依赖可正常安装，未标注）；安装时使用 `@whispering233/ai-editor-server@latest` 即可。

**发布前置（一次性，npmjs 手动）**：① 开启 npm 账号 **2FA**（npmjs 要求开启两步验证才能配置包管理；开启会撤销现有 token，需重新生成 Automation token）；② 为 `@whispering233/ai-editor-shared`、`@whispering233/ai-editor-db`、`@whispering233/ai-editor-tools`、`@whispering233/ai-editor-agent`、`@whispering233/ai-editor-server` 五包各配置 Trusted Publisher：Publisher = GitHub Actions、工作流名 = `publish.yml`；配置后 CI 无需 token（OIDC 自动换证）。

**发布流程**（详见 `docs/design/build.md`「正式发布链路」）：更新根 `CHANGELOG.md`（Unreleased 搬运为新版本段）→ `pnpm release:version X.Y.Z` 同步 5 包 + client + desktop + 根版本 → commit + 手动 annotated tag `vX.Y.Z` → push tag 后 workflow 自动执行（release.yml 建 GitHub Release，publish.yml 发布 5 包 npm + 安装态冒烟验证，desktop.yml 三平台打包并挂安装包到该 Release）。

## 文档（文档即契约）

| 目录 | 内容 |
|------|------|
| `docs/design/` | 总体设计、架构与分包、详细设计（数据模型/上下文/agent 循环/**云端存档**）、任务清单、配置说明、构建发布、遗留项 |
| `docs/api/` | 公共约定、错误码、接口索引、各模块端点契约（含**备份与云端存档**）、AI 工具目录 |
| `docs/db/` | 表结构 / outline.json / project.json 契约 |
| `docs/ui/` | **视觉与布局唯一契约**（`DESIGN.md`：色/字号/圆角/间距/三栏布局与中栏页头结构/组件外观 + antd token 登记表与守卫） |
| `test-project/` | 测试项目目录（整体不入库；调试开关写法见上文「快速开始」） |

阅读顺序与文档索引见根 `AGENTS.md`（文档即契约；入口：`docs/design/00-master-design.md` → `architecture.md` → 详细设计 → `docs/api/00-api-index.md`）。实现任何功能前先读对应文档。

## 设计原则

- **本地优先**：全部数据存本地（project.json + outline.json + data.db + sessions/），本地是唯一事实源、不依赖任何服务；**可选的云端存档**（v0.0.38）只是把备份 zip 同步到用户自己的 WebDAV 云盘做异地副本与多设备续写，随时可停用
- **结构体先行**：创作要素结构化（人物/设定/地点/伏笔），AI 在结构上做语义分析与建议
- **AI 只提案不写入**：工具分「自动 / 提案确认」两级，写操作必须用户确认
- **软删 + 回收站**：误删可还原，purge 才物理清除

## License

[MIT](LICENSE) © 2026 whispering233
