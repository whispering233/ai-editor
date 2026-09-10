# 项目里程碑与迭代演进路线

> 脉络摘要：每项一行 = 目标 + 关键设计，供理解项目演进；详细契约以 `docs/api`、`docs/db`、`docs/ui` 与设计文档为准，逐版本事实以根 `CHANGELOG.md` 为准（逐卡坑记录 `git log` 回溯）。

**阶段 A：地基**（T0-T7）——7 包 monorepo（shared → llm/db/tools → agent → server，client 只依赖 shared）；shared 纯类型/常量/纯函数（zod 仅服务端）；schema 演进（user_version 三态）；存储三文件原子写。

**切片 1-13**——项目管理/大纲（严格三层卷→章→场景）/实体（四类 + 通用关系表 `relation_records`）/回收站（软删级联）/Delta（独立表 + computeState 沿父链累积）/LLM 客户端 + 工具注册/会话成对裁剪/上下文分层注入/agent 三重保险（8 轮/120s/token）/提案仓仅内存 + 快照重校验/chat SSE（心跳 + 三路断开检测）/伏笔面板/节点结构化 data（麦基字段集）。

**阶段 U：UI 工作台重构**（U1-U8）——三栏 1:5:4（左书架/中信息条 + 7 tab/右 ChatPanel 常驻，可拖拽调宽 + 收起）；shadcn + oklch 文学氛围双主题；会话归属项目。

**画布 S10 → 批次八 O6 移除**——画布页删除（1000 章后无实际价值），`plot_edge` 数据/接口能力保留（仅无 UI 入口）。

**阶段 B/C/B2**——B1 项目提示词编辑（创作伴侣定位，不编辑/存储/读取正文）；C 时间轴（timepoint 实体 + occurs_at 挂载 + 双独立线性序 + SCHEMA_VERSION 3）；B2 自动备份与恢复（项目级频率/命名 kind 标记/重命名、project_id 唯一 key 覆盖分流、`.backups/` 保留 20 份）。

**用户反馈批次一至八（2026-08）**——F1-F9（字段清空语义/备份 WAL/时间轴视觉重构/三栏收放/标签建议/LLM 排序）；G1-G3（区块滚动/时间标签点实体化/滚动保持）；H1-H6（时间轴交互：删除入口/免确认/按钮展开/边框/右移/图标）；批次四 I1-I4（设定层级 = belongs_to）；批次五 J1-J3 + K1/K2（分类统一 data.tags，SCHEMA_VERSION 4）；批次六 M1-M3（标签编辑器）；批次七 N1-N2（上级设定递归子树筛选）；批次八 O1-O6（画布移除 + 可搜索下拉/大纲操作区/时间轴拖拽柄等）。

**发布与阻断项（2026-08）**——导出/导入（fflate zip 三文件 + 导入校验）、schema 安全（未来版本拒绝打开 / 增量迁移机制）、发布链路（6 包 npm + OIDC Trusted Publisher + CI 全绿）。

**批次九至十五（2026-08）**——llm 引擎换核（pi-ai 单向 adapter 防腐层）；参考资料第 7 实体类型（SCHEMA_VERSION 5）；大纲/时间轴交互优化（Enter 新建子级/双击详情/行内编辑/只留删除）；右键菜单替代行级问 AI；项目规则文件 AGENTS.md（唯一事实源 + prompt 自动迁移）；设定树形视图；参考资料两类承载（md 文件 = 真相源 + 外源链接）；分类自定义（自由文本 + datalist 聚合）；人物列表四列布局（状态列移除）；设定树手动排序（同级 sort_order + 复合 move 端点）；工具调用人类可读化（names/resolve 摘要渲染）；备份 1 分钟档；用户级配置 schema v1；db 查询层 drizzle-orm（61 处 prepare 清零，迁移/事务/JSON 防御语义不变）。

**批次十六（2026-09-05，v0.0.24）——多 provider 接入（OpenCode Go 订阅）**——llm 注册 pi-ai `opencode-go` provider（15 模型）；用户配置 schema v2（provider + api_keys）；每 provider 三级 key 链（env > config > pi-agent auth.json 只读）；设置页每提供商一卡 + 聊天下拉 optgroup 分组/无 key 组禁用；**模型解析绝不跨 provider**（撞名消歧防串 key）；OpenCode Zen（`opencode` provider）不接入（共享 env 防混淆）。

**v0.0.25（2026-09-05）——文档体系按全局规则重组**——`doc/` 目录更名 `docs/` 并按 api（`api-public`/`error-code`/`00-api-index` + 10-90 模块编号）/ design（`architecture`/`00-master-design` + 10-30 详细设计 + `milestone`/`tasks`/`config`/`build`）/ db（schema）/ ui（layout）布局；删除冗余（README/data-flow/backlog/hooks/pages/security）；architecture 分包方案去代码文件级（文件细节归代码），build/config/milestone 职责从 architecture/tasks 中析出；ui/layout 只保留总体布局与交互约定（样式实现归代码）。v0.0.23 曾做详细设计文档化与「决策 N」编号清除（历史见 CHANGELOG）。

**批次十八（2026-09-06，未发布）——用户反馈七项**——实体列表页去残留（「实体」标题 + 类型 Segmented tab，类型切换归左栏 NavRail）；面包屑整站移除（`Breadcrumb` 组件删除 + 4 详情页，一级化后层级结构失效，返回走 NavRail）；「问 AI」入口迁中栏右下悬浮按钮（antd `FloatButton`，InfoBar 移除）；focus 小条显示实体名称（`names/resolve`，替代裸 entity id）；「新建即聚焦」泛化（设定树/实体列表/大纲/时间点：滚动 + 高亮 + 键盘焦点）；`Ctrl/Cmd+S` 保存快捷键（注册栈，覆盖 4 详情页表单 + 伏笔编辑态 + 5 处行内编辑）；设定树拖拽插入线强化。**API/数据契约零改动**（纯前端交互层）。

**批次十七（2026-09-06，v0.0.26 已发布）——antd 全站迁移 + 布局重构 + 会话渲染重做**——布局：书架树退出左栏（回到书架按钮 + `#/` 书架主页切换书），中栏 TabBar 并入左栏垂直导航，实体二级 tab 全部提升一级（人物/设定/地点/关联），hook/event/timepoint/reference 泛型入口去重并入富页（T3 先例延续），全站无二级 tab；路由一级化重命名（`#/characters`/`#/setting`/`#/locations`/`#/relations`、概览 `#/overview`、设置 `#/preferences`，旧址 redirect）；前端组件基座换 antd v6（默认色板双算法主题，文学氛围色退役）+ @ant-design/x 会话组件族 + x-markdown 流式渲染（Bubble/Sender/Thought；工具调用行折叠+状态、提案卡 Card、历史消息渲染层双形态归一修 `{}` 显示）；存量页面逐批换壳（Table/Tree/Form 直替；dnd/行内编辑自研保留仅换肤；数据/语义/交互红线不动，**API 契约零改动**——页面组织与后端解耦原则入 architecture.md）。
