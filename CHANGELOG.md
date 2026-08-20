# Changelog

本文件记录项目的所有显著变动。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [v0.0.17] - 2026-08-20

### Added

- **批次十一（决策 43，2026-08 用户反馈——参考资料两类承载：本地 md 文件 + 外源链接）**：
  - **参考资料两类承载**——`data.kind` = `file`（本地 md 文档）/ `link`（外源链接）；存量条目运行时兼容（无 kind 按 link 类展示），无 DDL 迁移（SCHEMA_VERSION 保持 5）
  - **文件 = 真相源，DB 索引 = 派生镜像**——md 文件 = YAML frontmatter（title/category/tags）+ markdown 正文，项目目录 `references/` 自包含；应用内编辑先原子写文件再更新 DB（正文真相在文件）；外部编辑/新增/删除靠扫描同步（mtime 快照比对，幂等全量，新增/更新/还原/软删四向）
  - **扫描重建**——`POST /api/v1/reference/scan`（added/updated/restored/removed/skipped/errors 统计）+ `GET /reference/scan/status` 只读探测（未同步计数，无副作用）；列表页「扫描」按钮 + 未同步提示条引导
  - **页面**——新建入口分流「新建 md 文档」/「新建外源链接」（草稿态详情页）；md 详情页内嵌 markdown 编辑器（@uiw/react-md-editor 4.1.1：textarea 源文本 + 分屏实时预览，data-color-mode 随主题联动）+ 分类/标签编辑 + 导入 md 文档（纯前端 FileReader + frontmatter 解析预填）+ 建立关联面板；外源链接详情页（URL 必填 + 备注 + 关联面板）；列表交互对齐大纲（点击标题行内编辑、双击详情、只留删除、行信息 [标题/分类/标签/来源]）；右键菜单复用（注入会话上下文 + 建立关联）
  - **存档体系联动**——备份/导出/导入/恢复 zip 打包 `references/` 目录（含 `.trash/`，项目自包含）；自动备份变更检测加 references/ mtime
  - **AI 工具联动**——propose_create_reference 创建的条目归 link 类（source → url）；search_references / get_entity 经 content 镜像纯 DB 读取
  - **软删/回收站文件联动**——file 类软删文件移入 `references/.trash/`，restore 移回、purge 物理删
  - 跨书籍导入参考资料记录为未来迭代（backlog #16）
  - 全仓 1639 测试全绿 + typecheck/lint/build 通过；列表编辑对话框异步回填竞态（B1）随交互重构根除

## [v0.0.16] - 2026-08-20

### Changed

- **批次十（决策 37-42，2026-08 用户反馈——交互优化与新需求）**：
  - **决策 37：大纲交互优化**——移除行级「详情」「＋新建」按钮（只留删除）；选中节点按 Enter 新建子级（就地输入行出现在子级末尾，Enter 确认/Esc 取消）；双击节点查看详情（#/outline/:nodeId）；点击标题行内编辑（现有单击编辑保留）；拖拽排序保留（HTML5 DnD）
  - **决策 38：时间轴交互参考大纲**——事件行与组标题行采用大纲交互模式：双击=详情、点击标题=行内编辑、移除「详情/编辑」按钮（保留删除）；新建/拖拽/折叠/标签筛选等现有能力保留
  - **决策 39：移除实体二级页列表更新时间**——实体关系设定列表（EntityList 表格）移除「更新时间」列与排序选项；详情页（EntityDetail 等）创建/更新时间元信息保留
  - **决策 40：右键菜单替代行级问 AI**——删除全部 6 处行级 AskAiButton（实体/伏笔/参考资料/大纲/时间点/事件）；新增右键菜单（Base UI ContextMenu 封装）——「注入会话上下文」（复用 chat store focusContext）与「建立关联」（新建 relation_records，源端点按行对象预填）；InfoBar「问 AI」统一入口保留
  - **决策 41：项目规则文件 AGENTS.md**——项目目录 AGENTS.md 为项目规则唯一事实源；project.json `prompt` 字段废弃——打开项目时 prompt 存在且无 AGENTS.md 则自动迁移写入；设置页改为直接编辑 AGENTS.md；web 读取检测外部修改（mtime）；「## 项目设定」注入逻辑保留（数据源改为 AGENTS.md）；修订决策 25（rules.md 否决记录被取代）
  - **决策 42：实体设定页树形视图**——设定列表改为树形视图（参考大纲页设计）与设定树 tab 合并——层级天然展示；折叠/展开、行内编辑、拖拽调整层级（belongs_to 防环沿用决策 30，先建新边后删旧边）、Enter 新建子级、双击详情；筛选改为搜索+标签过滤（树内过滤），移除表格分页；`#/entities/setting-tree` 重定向到 `#/entities/setting`
  - 每卡临时分支 + git worktree 并行开发（4 波次），独立 oracle 审验全 PASS，线性合入 main；全仓 1600 测试全绿 + typecheck/lint/build 通过；发布 v0.0.16（8 包版本同步）

## [v0.0.15] - 2026-08-19

### Changed

- **批次九（决策 34/35/36，2026-08）——LLM 引擎换核 + 中栏演进 + 参考资料页**：
  - **决策 34：引入 `@earendil-works/pi-ai` 替换自研 LLM 调用层**——llm 包保留对外契约（chatStream/LLMStreamEvent/LLMError），内部改单向声明式 adapter（LLMMessage→pi-ai Context、流事件转发、usage 口径、错误归一化 onResponse 恢复 status）；手写 SSE 解码/流式 tool_call 累积/错误 body 归一化（~300 行）删除；agent/server 上层契约零破坏；保留 retry.ts（决策 15）/token.ts（决策 6）；新增 `getAvailableModels` 模型目录接口（id/provider/contextWindow/maxTokens/reasoning）
  - **决策 35：中栏 AI 集成演进**——InfoBar 统一「问 AI」入口（无特定对象时纯进入聊天并聚焦输入框）；页面行级「带上下文问 AI」按钮（Sparkles：大纲节点/实体行/伏笔行/时间轴事件与时间点/参考资料行，注入该对象 focus + 聚焦聊天——回归 layout.md §4.2 原始设计，补齐「有焦点」显式入口）；页面焦点上报（EntityDetail/ReferenceDetail 挂载上报 currentFocus，MainPanel 路由切换 useLayoutEffect 清空）；继续当前会话语义（不自动开新会话）
  - **决策 36：参考资料页（第 7 种实体类型 reference）**：`ref-` 前缀，SCHEMA_VERSION 4→5 迁移（CHECK 扩 7 种四步换表）；data 字段 type 分类枚举（material/inspiration/theory/reference）+ content 全文长文本 + source 来源 + tags 标签；列表摘要截断 120 字 / 详情全文（防 AI 工具上下文膨胀）；TabBar 新增「参考资料」tab（时间轴后回收站前）+ 列表/详情页（分类/标签/搜索筛选 + 全文详读）；LLM 集成 `search_references`（自动查询，summary.type 过滤）+ `propose_create_reference`（提案写入，确认后落库，type 缺省 material）
  - **右栏增强**：模型选择下拉（用户级配置持久化 getAvailableModels）+ 思考强度选择（档位对齐 pi ThinkingLevel：off/minimal/low/medium/high/xhigh/max，off 不传 reasoning）+ 上下文占用进度条（真实 usage.total ÷ 模型 contextWindow，done SSE 帧附带 usage）
  - 冗余清理：llm 包死类型（LLMStreamChunk/FetchLike/FetchResponseLike/TextDecoderLike 等）与 retry.test 死 helper 删除
  - 全仓 1556 测试全绿 + typecheck/build 通过；发布 v0.0.15（8 包版本同步）

## [v0.0.14] - 2026-08-19

### Changed

- **批次八（O1-O6，2026-08 用户反馈批次——体验优化与画布重构，决策 33）**：
  - O1 设定/标签筛选可搜索下拉（`SearchableSelect`：Popover + 关键词客户端过滤已聚合候选 +「全部」清除 + fallbackLabel 兑底，重构原原生 `<select>`）；
  - O2 大纲页节点行操作区右端对齐 + 顺序改「详情 → 添加 → 删除」（＋ 就地新建），移除行尾修改时间显示；
  - O3 时间轴移除 GripVertical 拖拽柄视觉（draggable 与悬停拖拽提示保留在行根，参考大纲页无柄拖拽）；
  - O4 时间轴折叠/展开按钮移至时间点组标题左侧（参考大纲页折叠箭头位序）；
  - O5 设定树视图新增「全部展开 / 全部折叠」工具栏按钮（折叠态提升受控层 + `expandableSettingNodeIds` 纯函数）；
  - **O6 画布页移除（决策 33）**：删除 `#/canvas` 路由、中栏「画布」tab（7→6 tab）、`pages/Canvas.tsx` 与 `lib/canvas.ts`（及测试）；`plot_edge` 数据模型与 `POST/GET/DELETE /relation` 关系接口能力完整保留（仅无 UI 入口）；旧 localStorage 画布坐标为无害残留不清理；同步删除画布死后 CSS（`canvas-edge-flow`）。
  - 每卡临时分支 + git worktree 并行开发（批次一 O1‖O2‖O3O4 → 批次二 O5‖O6），独立 oracle 审验全 PASS，线性合入 main；全仓测试 1562 个全绿 + typecheck/lint/build 通过。

## [v0.0.13] - 2026-08-19

### Added

- **设定列表上级设定筛选（批次七 N1-N2，2026-08 新需求，决策 32）**——实体关系页「设定」tab 新增「上级设定」筛选：选择某上级设定后，列表只显示其**直接及所有后代设定（递归子树，不含上级自身）**：
  - `GET /api/v1/entity/setting` 新增可选查询参数 `parent_id`（**仅 setting 类型生效**，其他类型传入忽略），匹配语义 = 设定在层级树（belongs_to，决策 30）中直接或间接属于该上级；**复用既有 `listSettingHierarchyEdges` 全量层级边**（关系表索引、O(N)）建 childOf 邻接表栈式 DFS 收集后代集合（防环守卫 = Set 去重），走 db `listEntities` 既有 JS 过滤路径（total = 过滤后总数、分页正确；无过滤时保持 COUNT+LIMIT SQL 路径零回归）；与搜索 / 标签筛选 / 排序 / 分页组合（AND）；指向不存在的设定（含已软删）→ 空结果（宽松，同 tag 无匹配不 404）；软删联动由边查询可见性天然保证
  - 前端「上级设定 ▾」下拉（候选 = 全部设定按名称排序 +「全部」重置项，与「标签 ▾」并列；候选聚合与标签候选合并一次请求 limit 200）；父设定已软删或超 200 截断时下拉兑底「（已删除或不可见）」防空白；空态文案三分支（搜索无结果 / 「《X》下暂无设定」+ 清除上级筛选 / 无实体）；切换 tab / 类型重置
  - 设计文档：`decisions.md` 决策 32、`endpoints.md` 实体列表契约（`parent_id`）、`entity-list.md` 关键交互与空态；oracle 独立审核无 P0/P1（P2：`parent_id` 空串防御归一化 + 空态文档补正已随卡处理）

## [v0.0.12] - 2026-08-18

### Fixed

- **实体详情标签编辑器「输入后回车添加下一项」（M1，2026-08 用户反馈批次六）**——placeholder 承诺了回车行为但未实现（回车无任何反应）：行内回车现在 = 添加下一项——非末行聚焦下一行、末行且非空追加空行并聚焦、末行且为空无操作（防空行跑马灯）；行为决策下沉 `lib/tags-editor.ts` 纯函数（`enterBehavior`）+ vitest 覆盖

### Changed

- **设定列表行显示上级设定与描述（M2，交互优化，2026-08 用户反馈批次六）**：
  - `GET /entity/:type` 列表响应：`EntitySummary` 新增 `parentId`/`parentName`（**仅 setting 填充**——服务端补查全量 belongs_to 层级边按 childId 映射，无父的设定不出现该字段，软删端点由既有可见性过滤兜底）
  - setting 摘要新增 `description`（**截断 100 字符**——列表行展示用，防 `search_entities` AI 工具上下文膨胀；完整文本在详情页）
  - 前端设定列表列：名称 | 标签 | 上级设定 | 描述 | 更新时间；上级设定渲染为可点击 chip（点击直达父设定详情，不触发行点击）；描述行 truncate + hover title 查看
  - 契约文档同步：`endpoints.md` EntitySummary 契约 + `entity-list.md` 信息层级表（顺带修正决策 31 后过期的 `summary.category` 表述）

### Added

- **标签列表拖拽排序（M3，新需求，2026-08 用户反馈批次六）**——详情页标签编辑器（`rules`/`tags`/`personality`/`abilities` 共用组件）每行前置拖拽手柄（GripVertical + **HTML5 原生 DnD，零新依赖**）：拖动行降透明度 + 目标行 ring 高亮；仅在自身拖拽进行中响应 drop（不干扰输入框内文本拖选/拖入）；Firefox setData 兼容；排序只改本地表单数组随 `data` 提交（数组顺序即存储顺序，无独立 API）；`moveArrayItem` 纯函数 + 测试

## [v0.0.11] - 2026-08-18

### Changed

- **前端样式工程化（L 批次，2026-08）**——长 className 单行难读、重复模式无提取的工程化改造：
  - client 包引入 **Prettier + prettier-plugin-tailwindcss**（`packages/client/.prettierrc.json`，printWidth 100）：长 className 自动折行、Tailwind 类顺序统一（布局 → 尺寸 → 颜色 → 状态），新代码格式由工具兑底
  - 新建 **`lib/styles.ts` 共享样式常量**（提取阈值 ≥3 处）：`iconButtonBaseClass`/`iconButtonSize`（bar/sm/md 三档）/`iconButtonDisabledClass`/`inputClass`/`errorBannerClass`/`skeletonClass`/`sectionCardClass`——改一处样式全局生效，禁止复制粘贴重复类
  - 新建 **`EmptyState`**（空态容器：虚线边框居中卡 + 文案 + 可选图标 + 主操作插槽，padding sm/md/lg 三档）与 **`SectionCard`**（区块卡：容器 + font-serif 标题 + action 插槽，上提自 OutlineDetail 局部实现）组件，统一全仓空态/区块样式
  - **全仓硬编码色类清零**（zinc/white/red 共 50+ 处 → token 类）：EntityList 表格/筛选/分页、EntityDetail 表单/层级区块、Outline 骨架/空态、Settings 说明卡等；深色主题下原 zinc 亮色异常同步修复；浅色主题观感一致（暖色 token 微调）
  - 空态统一为 EmptyState 后仅 1 处视觉微调：Timeline「标签筛选无匹配」内边距 py-8 → py-10
  - 全仓格式化（45 个 TSX 文件），行为零变化；`doc/ui/layout.md` 新增 §4.4「样式书写规范」契约

### Fixed

- （无行为修复；含样式层修复：深色主题下硬编码 zinc 亮色类导致的对比度异常）

## [v0.0.10] - 2026-08-17

### Added

- **实体关系增强（用户反馈批次四 I1-I4，2026-08，决策 30）**：
  - I1 关系类型 `occurs_in` 中文映射补齐（17 种预定义类型全量映射，「锚定于」与「发生于（地点）」区分）
  - I2 详情入口图标统一为 Eye（大纲节点行 / 伏笔行；书架/项目语义的书籍图标保留）
  - I3 **设定层级 = `belongs_to` 关系（决策 30）**：`data.parent_id` 废弃（不再读写，passthrough 容错旧数据）；db 全量层级边邻接表 + 防环校验（自指/祖先链成环 → 400）；详情页「层级」区块（父/子设定分区展示 + 设置/修改/清除上级，先建后删防数据丢失）；新建行「上级设定」弹层搜索选择器（创建后补建关系，失败不阻塞）；关联列表与层级分区展示不再重复
  - I4 **设定树视图**：实体关系页第 6 个 tab「设定树」（路由 `#/entities/setting-tree`）——按 belongs_to 构建递归层级树，折叠/类别徽标/直接子数/节点点击跳详情，截断孤儿提升为根防御
- **输入提示与标签筛选（用户反馈批次五 J1-J3 + K1/K2，2026-08，决策 31）**：
  - J1 设定分类统一为 tags（`data.category` 废弃），列表摘要列「类别」→「标签」，AI 聚合统计 byCategory → byTags
  - J2 **浏览器原生 datalist 自动完成**（零依赖）：新建行名称/首字段按现有数据动态聚合候选，设定详情标签补拉全量聚合，伏笔类别枚举候选
  - J3 设定列表**标签筛选**：`GET /entity/:type?tag=` 单标签包含匹配（复用内部 filters.tags 管道，不改表结构），前端「标签 ▾」下拉聚合既有标签，与搜索/排序/分页组合
  - K1 新建行加回标签输入（逗号分隔多值，中英文逗号均可）
  - K2 **分类字段统一 `data.tags`**（前后端同名），`data.rules` 恢复「规则条款」语义（仅详情页编辑）；**004 迁移（SCHEMA_VERSION 4，无 DDL 仅 data JSON）**：旧 rules 分类值复制到 tags 并移除（用户裁决旧数据视为分类标签）；标签编辑**快捷选择**（既有标签 chips 点击追加去重）+ datalist 补全
- **交互修正（2026-08 用户反馈）**：
  - 行内新建不再自动跳详情页（创建后留在列表刷新，需要进详情点行进入）
  - 全仓输入框 `autoComplete="off"`（shadcn Input 组件层默认 + 5 处原生 input）：禁浏览器表单历史建议，输入提示完全由代码控制（datalist 候选/快捷选择）

### Fixed

- 变更记录表单字段清单移除 `setting.parent_id`（决策 30 遗漏：satisfies 断言在 shared 类型更新后编译失败）
- 移除设定详情层级区块的技术内幕说明文案、新建行无意义 placeholder 示例

## [v0.0.9] - 2026-08-16

### Added

- **时间轴交互与视觉优化（用户反馈 H1-H6，2026-08）**：
  - H1 时间点组标题补齐「移入回收站」垃圾桶图标按钮
  - H2 移入回收站（软删）与回收站还原不再弹二次确认，仅彻底删除保留确认
  - H3 操作按钮全部展开，禁止收进 `...` 菜单：时间轴事件行、伏笔行、书架项目行改为直接图标按钮
  - H4 时间轴「+ 在此时间点新建事件」移到时间标签标题行横向排布；全仓文字型按钮统一加可见边框
  - H5 时间轴标题行信息与操作右移，重命名/在此时间点新建事件改为图标按钮（Pencil / Plus）
  - H6 事件行「N 节点」计数靠右，与操作按钮一起放入右侧信息与操作区
  - 时间轴事件详情按钮图标改为 Eye（眼睛），更符合“查看详情”语义

## [v0.0.8] - 2026-08-15

### Added

- **G3 时间轴操作后滚动位置保持（2026-08 用户反馈）**：任何操作（拖拽/重命名/新建/编辑/软删）后重拉期间保留旧数据渲染——列表 DOM 不卸载、滚动容器高度不塌陷、scrollTop 不被 clamp 归零，视觉焦点与操作点一致；loading 仅用于首次加载骨架
- **G2 时间标签点实体化（2026-08 用户反馈，决策 26 重大修订）**：
  - **新实体类型 `timepoint`（时间标签点）**：时间标签从事件剥离为独立实体（id 前缀 `tp-`，`name` = 时间标签文本，可重命名）；事件经 `occurs_at` 关系挂载到时间点（timepoint→event，**1:n**——事件至多挂一个）；`SCHEMA_VERSION 2→3`，E5 增量迁移 `003_timepoint.ts`——旧 `event.data.time_label` 同名合并为同一 timepoint + 建挂载关系 + 从 data 移除，无标签事件不建关系（= 未挂载），软删事件跳过
  - **双独立线性序**：时间点 `sort_order`（组间顺序，拖拽权威，**拖时间点不修改其下事件序**）+ 事件 `sort_order`（组内排序键，渲染时组内按事件全局序投影）；事件跨组拖拽 = 改挂载（服务端复合端点 `POST /entity/event/:id/move_to { timepoint_id, order }` 事务内一次提交，null = 移出未挂载区）
  - **时间轴 UI 重构**：时间点组块（组标题 + 计数 + [重命名] 行内编辑 + 折叠 + 组尾「+ 在此时间点新建事件」）+ 事件行（单条可拖）+ **未挂载兜底区**（无挂载事件平铺，可拖入任一时间点）；header「+ 新建时间点」双入口；事件表单移除 time_label，详情页新增挂载时间点选择器
  - **AI 工具替换**：移除 `propose_reorder_events`，新增 `propose_reorder_timepoints`（LLM 按时间点 name 语义排序 → 提案确认 → 重排时间点序）
- **G1 时间轴区块独立滚动（2026-08 用户反馈）**：时间轴页 header（标题/AI 排序/新建按钮）与标签筛选器固定，仅列表区独立滚动（事件多时操作入口恒可见）
- **用户反馈批次 F1-F9（2026-08）**：
  - F1 事件字段清空语义（时间标签/描述/标签可显式清除）
  - F2 自动备份补查 `data.db-wal`（WAL 模式写只刷新伴生文件，主文件 mtime 不变导致漏检——影响全部 data.db 写）
  - F3-F6 时间轴视觉重构（垂直时间轴线 + 事件卡 / 同标签归组 / 时间标签样式强调 / 行内完整描述展开收起）
  - F7 三栏可收起/展开 + 拖拽调宽（use-panels，localStorage 持久化）
  - F8 事件编辑已存在标签建议（suggestTags + TagSuggest 组件）
  - F9 LLM 按时间标签语义排序提案（`propose_reorder_events`，G2 后被 timepoints 版取代）
- **备份类型标签 + 备份重命名（阶段 B2.6，决策 29）**：
  - **手动/自动类型标签**：备份文件名新增 kind 标记段（`<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`）——手动备份带 `-m` 段（**无名称也带**，与自动备份可靠区分）、自动备份重命名后带 `-a-` 段；自动备份/覆盖前快照仍为纯时间戳；**旧格式完全兼容解析**（旧秒级 → 自动、旧带名称无 kind 段 → 手动），历史备份零迁移
  - **备份重命名**：设置页备份列表行内编辑（铅笔 → 输入框，Enter/确认提交、Esc/失焦取消）→ `POST /project/backup/rename { fileName, name? }`——只改名称段、时间戳与类型标签保持；空输入 = 清除名称；同名称幂等；目标已存在 → 409 `BACKUP_TARGET_EXISTS`（防覆盖丢失）；旧格式文件改名顺带规范化（补毫秒 + kind 段）
  - **列表契约**：`GET /project/backups` 响应项新增必填 `kind: "auto" | "manual"`；列表行显示「时间 + 简单标签（自动/手动）+ 自定义名称」；恢复确认框同步展示标签
- **备份命名增强（阶段 B2.5，决策 28）**：
  - **文件名毫秒精度**：备份文件名由 `<YYYYMMDD-HHmmss>.zip` 升级为 `<YYYYMMDD-HHmmssSSS>.zip`（本地时区 17 位时间戳，同毫秒冲突 +1ms 去重）；**旧秒级格式完全兼容解析**——历史备份仍可列出/恢复/参与保留策略，无需迁移
  - **手动备份自定义名称**：设置页「立即备份」旁新增「备份名称（可选）」输入框（maxLength 30）→ `POST /project/backup { name }` → 文件名 `<时间戳>-<名称>.zip`，列表与恢复确认框展示名称；名称校验（trim 后 1-30 字符、禁路径分隔符/保留字符/控制字符/纯点、自动剥 `.zip`）收敛 shared `sanitizeBackupName`（writeBackup 唯一执行点），非法 → 400
  - **列表契约**：`GET /project/backups` 响应项新增可选 `name` 字段；restore 白名单兼容三类文件名（毫秒级/带名称/旧秒级）
  - **UI 时间显示补秒**：备份列表时间 `MM-DD HH:mm` → `MM-DD HH:mm:ss`（同分钟内多次备份可区分，与毫秒级文件名配套）

## [v0.0.7] - 2026-08-13

### Added

- **MIT License**：仓库根 LICENSE（Copyright (c) 2026 whispering233）+ 8 个 package.json（6 发布包 + client + 根）补 `license: "MIT"` 字段

### Fixed

- **发布冒烟 ETARGET 超窗（v0.0.6 实录）**：`verify-installed.mjs` 改为**先轮询 registry 可见性再 install**——`npm view` 循环确认 6 个发布包 `@<version>` 全部可见（20×30s = 10 分钟窗口；npm view 与 install 同源，判断精准）后再执行 `npm install`；传播期内轻量轮询、传播完成即装（基本一次成功），超时仍未可见直接判失败（版本未发布/网络问题），不再盲重试完整 install

## [v0.0.6] - 2026-08-13

### Added

- **自动备份与恢复（阶段 B2，决策 27）**：
  - **自动备份**：服务运行期间按频率定时检查，**有变更才生成新备份**（三文件 mtime 判定 + 1s 容差防 checkpoint 自激）；备份存项目目录 `.backups/`（时间戳命名，格式与导出包一致），每项目保留最近 20 份自动清理（清理失败不阻塞主流程）
  - **备份频率设置**：设置页「自动备份」区下拉（关闭 / 每 5 / 10 / 15 / 30 / 60 分钟，**默认 10 分钟开启**），跟随书籍存 project.json（可选字段，读侧宽松/写侧显式）+ [立即备份] 按钮
  - **加载备份双通道**：设置页历史备份列表（时间/大小 + 行内[加载]，强确认 Dialog 明示「覆盖前自动备份当前状态」）；书架导入以 **project_id 为唯一 key**——匹配书架 → 覆盖恢复（`mode: "restored"`）、不匹配 → 导入新书（`mode: "new"`）；恢复走 E1 同款 zip 格式与 E4/E5 三态校验（坏包/高版本零触碰拒绝）
  - **同名不同 id 导入不再 409**：导入 Dialog 同名冲突二选一——重命名导入（预填「`书名 (2)`」）/ 保持原样（目录自动去重 `书名 (N)`，维持「目录名 = 书名」不变式）
  - **书架重命名书名**：项目行 ⋯ 菜单行内输入（原子移动目录 + name 更新 + 当前项目引用/定时器同步，失败回滚）
  - **恢复语义安全**：覆盖前自动快照当前状态（后悔药，同保留策略）；**保留当前项目 id**（会话历史按 project_id 隔离不断连）；跨项目恢复自动迁移 `chat_messages` 归属（旧 id → 当前 id，聊天历史不静默丢失）
- **实体类型补全**：第 5 种实体 `event`（时间轴，v0.0.5 阶段 C 引入后 README/UI 同步，中栏 7 tab）

### Changed

- import 响应契约新增 `mode: "restored" | "new"`（shared schema 同步，前后端共用）
- 备份/导出/导入/恢复共用同一打包与校验管道（`backup.ts` 提取，E1 export/import 重构 -200 行）

## [v0.0.5] - 2026-08-12

### Added

- **时间轴功能（阶段 C，决策 26）**：第 5 种实体类型 `event`（事件），中栏新增「时间轴」tab（伏笔与回收站之间）——事件列表拖拽排序（`sort_order` 全局线性序，拖拽为权威、自由文本时间标签仅展示）、标签数组分类筛选、详情页字段编辑与 `occurs_in` 锚定大纲场景（多对多，倒叙/多时间线可表达）、软删回收站；schema 增量迁移 SCHEMA_VERSION 1→2（`002_event_timeline`，E5 迁移机制首个真实用例——旧库打开自动前向迁移，数据保全 + 时间戳快照）
- **项目提示词编辑（阶段 B，决策 24/25）**：设置页可编辑跟随书籍的 `prompt`（注入 system「## 项目设定」段），规则文件机制否决（单一持久化上下文通道）
- **画布增强批次（S10.2-S10.5，参考 inkos）**：连线语义色（目标节点层级色 + hover 路径高亮三级优先级）+ 箭头 + 选中/路径流动虚线动画；右下角小地图（归一化节点矩形 + 视口框，自研零依赖）；「重新布局」按钮（保留已拖拽坐标的幂等重排，inkos `position ?? 自动计算` 模式）；hover 节点沿 plot_edge 向前 DFS 路径高亮（非路径降透明 0.2）

### Changed

- **画布连线交互（UX1）**：连线创建改为「拖出即连」（移除标签 Dialog，松手即创建）；连线标签**线上就地编辑**（选中连线 → 线中点内联输入，Enter/失焦提交，空标签清除）；拖线期间禁用 hover 高亮（修复连线时其他节点全暗的交互冲突）；新增 `PUT /api/v1/relation/:id` 端点（metadata 整体替换）
- **交互优化（UX2-UX4）**：侧栏新建项目行内化（书架头部行内输入框，失焦取消防误触）；时间轴关联节点全屏 Dialog → 轻量 Popover 弹层；实体新建 Dialog → 列表首行内联编辑行（提交成功仍跳详情页）；书名校验抽取 `validateBookName` 三处复用
- 无项目时业务 tab 点击引导回概览（toast「请先创建或打开项目」），不再落到 409 错误横幅

### Fixed

- 画布连线创建时其他节点全部降透明（S10.5 hover 高亮与连线创建的交互冲突，UX1）

## [v0.0.4] - 2026-08-04

### Changed

- 启用 CI OIDC 发布链路（npmjs Trusted Publisher ×6 配置完成）——push 版本 tag 后自动发布 6 包 npm 并安装态冒烟验证，发布全流程自动化闭环

## [v0.0.3] - 2026-08-04

### Fixed

- npm 发布管道最终修复：npm 12 的 publish 在 postpack 恢复**之后**生成 registry manifest，prepack 替换只影响 tarball——改为发布前主动执行替换与 SPA 拷贝 + `npm publish --ignore-scripts`，manifest 与 tarball 一致；**0.0.3 是首个可正常安装的版本（0.0.1/0.0.2 manifest 残留 workspace:*，勿安装）**

## [v0.0.2] - 2026-08-04

### Fixed

- npm 发布管道修复：npm 12 的 `npm publish` 用 postpack 恢复后的 package.json 生成 registry manifest，导致 0.0.1 的 manifest 残留 `workspace:*`（`npm install` 报 EUNSUPPORTEDPROTOCOL）——改为发布前主动替换 workspace:* 后恢复；**0.0.1 已标注废弃，请使用 0.0.2**

### Changed

- 发布包名由 `@ai-editor/*` 改为 `@whispering233/ai-editor-*`（`@ai-editor` scope 在 npm 已被其他用户占用，无法发布）

## [v0.0.1] - 2026-08-04

首个正式发布（MVP 完整交付）。

### Added

- **项目管理**：书架模式（books/ 子目录，决策 8）、项目创建/打开/关闭/配置、启动待命语义（无项目不初始化）、LLM 设置（用户级配置，key 绝不入项目文件）
- **大纲**：严格三层（卷→章→场景）增删改移、行内就地编辑、拖拽排序（上下半判定）、节点详情页（麦基《故事》结构化字段：场景目标/冲突层次/价值转向、章反转/高潮场景、卷激励事件/幕高潮，决策 23）
- **实体与关系**：四类实体（人物/设定/地点/伏笔）CRUD、通用关系表 k 跳遍历、Delta 变更追踪与 computeState 状态计算（树路径父链累积，决策 9）
- **回收站**：软删/级联还原/purge 清理、restore 祖先链校验、启动一致性校验兜底（以大纲节点软删为准补标，决策 12/16）
- **画布**：大纲节点画布投影（自动布局/拖拽/缩放/仅场景模式）、布局持久化 localStorage（按项目隔离）、plot_edge 剧情连线创建与删除（标签 + 物理删确认）、节点伏笔标记（决策 10）
- **伏笔系统**：伏笔面板（活跃/已回收/已废弃分组、新建埋点、复合写确认、依赖链递归展开、软删级联）、大纲节点伏笔徽标（plants/advances/resolves，S9）
- **AI 对话链路**：DeepSeek SSE 流式客户端（手写解析/abort 三保险/截断防御）、44 个工具（查询 8/分析 5/伏笔 5/提案 14/执行 12）、agent 主循环三重保险（8 轮/120s/token）、提案确认流程（快照重校验/一次性消费/TTL）、chat SSE 路由（心跳 15-30s/三路断开检测/全链路取消，决策 20）
- **三栏工作台 UI**：左栏书架树（项目→会话二级树）、中栏信息条 + 6 tab、右栏常驻 ChatPanel（<1024px 折叠抽屉）、oklch 文学氛围双主题（暖羊皮纸/蓝黑曜石）、会话归属项目（决策 22）
- **全局反馈**：toast/错误横幅/确认对话框、应用级 ErrorBoundary 防白屏、数据变更自动刷新信号
- **数据备份（E1-E3）**：一键导出完整项目（zip 打包三文件 + WAL 完整快照）/ 从备份导入为新书（服务端校验 + 原子搬入，不覆盖现有书）——数据主权归用户
- **schema 安全（E4-E5）**：未来版本拒绝重建（PROJECT_VERSION_NEWER）、增量迁移机制（migrations/ 按序执行 + 迁移前时间戳快照 + 失败可续跑）
- **调试基础设施**：创作根 `.ai-editor/config.json` 五类别调试日志（chat/request/stream/usage/http）
- **打包安装**：6 包 tarball 安装链路（prepack 钩子：SPA 随包 + workspace:* 替换）、端到端冒烟测试（9 步链路）

### Changed

- UI 从「顶栏 + 侧栏 + 内容区」重构为三栏工作台（1:5:4，决策 22），`#/chat` 独立页移除——聊天常驻右栏
- 大纲交互重构（S13）：取消 ⋯ 操作条平铺图标化、拖拽上下半排序、摘要独立两行、移除回收站折叠区与移动到对话框
- 变更记录目标类型收紧——仅实体（历史数据保留展示）
- schema 演进策略：删库重建 → 增量迁移机制（v0.1.0 发布终止删库重建，决策 13/E5）
- 调试配置简化为纯配置文件（删除环境变量开关）
- 对话框宽度契约统一（基座 max-w-lg + 调用点覆盖）

### Fixed

- Base UI error #31 根因：DropdownMenuLabel 必须 DropdownMenuGroup 包裹（会话标题下拉整页白屏）
- DialogContent 基座宽度覆盖失效（sm:max-w-* 同特异性覆盖被压碎）
- 数据变更后页面不刷新（dataVersion 信号 + 全局刷新按钮）、刷新后会话不恢复（自动激活最近会话）
- 端口占用自动 +1 并打开实际端口（127.0.0.1，决策 8/17）
- 大纲同父重排 off-by-one（拖拽 order 剔除计算）、实体详情跨实体状态残留
- 启动相对路径创作根归一化（INVALID_PROJECT_PATH）

### Removed

- 游离节点（orphan_nodes）设计——大纲严格三层，无树外状态（决策 19）
- `#/chat` 独立页面（聊天常驻右栏）
- 大纲「移动到…」对话框（S13.1 平铺图标化替代）
- 调试环境变量开关（纯配置文件替代）
