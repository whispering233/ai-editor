# 开发任务清单（Task Cards）

开发任务卡，**垂直切片**组织。依据：`docs/design/architecture.md`（分包/技术栈）、`docs/api/` 各模块文档（API 契约）、`docs/db/schema.md`（数据结构）、`docs/ui/layout.md`（布局与交互红线）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- 卡内不做卡外顺手改动；无待做项时不做 backlog 式顺手实现。
- 契约以 `docs/api`、`docs/db` 为准，发现文档矛盾先停下提问，不要自行发明。
- 前端迁移卡原则：**数据/语义/交互红线不动，只换视觉壳**（Table/Tree/Modal/Form 等直替 antd 件；拖拽/行内编辑/右键自研保留逻辑仅换肤）；后端与 shared **零改动**（页面组织与 API 解耦，见 architecture.md）。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）；迁移卡同步重写受影响组件测试。
- 并行卡片在临时分支 + 临时 git worktree（`worktree: true`）开发，父会话验证后合回 main 清理分支。

---

## 项目状态（2026-09-05 起，批次十七进行中）

v0.0.1-v0.0.25 发布链路全绿；v0.0.25 = 文档体系重组。**批次十七 = antd 全站迁移 + 布局重构 + 会话渲染重做**（规划已定稿：见 milestone.md + layout.md 重写版 + architecture.md 技术栈段；迁移批次按下方卡片执行，每卡提交后更新本清单与对应文档）。

## 批次 0：依赖与主题骨架（已完成，commit 0dcc421/5c34926/41ed626）


- [x] 0-1 依赖接入与兼容验证：client 引入 `antd@6`、`@ant-design/icons`、`@ant-design/x`、`@ant-design/x-markdown`；验证 x peer 与 antd v6 兼容、Vite 构建跑通 + 最小渲染冒烟（含 React 19 组合验证）
- [x] 0-2 ConfigProvider 双主题接线：zhCN + lightAlgorithm/darkAlgorithm（默认色板）+ use-theme 切换联动 + FOUC 首帧防护保持；App 根包裹；样式纪律标注同步代码注释
- [x] 0-3 外壳骨架评估（2026-09 决策：**本轮保留 use-panels 交互壳**）：antd Splitter v6 核对——中栏弹性吸收/min-max px/onResizeEnd 持久化均支持，但收起语义（0 宽+bar 箭头）不承载现 32px 窄条形态、头部收起钮无命令 API；且切 Splitter 需连带改 Sidebar/ChatPanel props 契约，二者将在 1-2/2-x 重建——现在切 = 双倍返工。Splitter 切换决策并入 1-2 左栏重建时重新评估

## 批次 1：布局与路由重构（需求 1；已完成 1-1/1-3/1-3b/1-2，commit c475562/51a5aac/30912cc/f5a5887）


- [x] 1-1 路由一级化：main.tsx 新路由表（书架 `#/`、`#/overview`、`#/characters`、`#/setting`、`#/locations`、`#/relations`、`#/preferences`…）+ 旧址重定向（`#/entities/*`、`#/settings`）；client 内 navigate/href/测试引用机械替换；未知路由回退；测试更新
- [x] 1-2 左栏导航重构：顶部书架按钮 + 当前书名；垂直 Menu 九项（概览→大纲→人物→设定→地点→伏笔→时间轴→关联→参考资料）+ 工具区分隔（回收站）+ 底部设置/主题；中栏 TabBar 移除；无项目导航禁用引导回书架（现 TabBar 行为平移）；导航高亮前缀规则 + 测试
- [x] 1-3 书架主页（**执行序交换：先 1-3/1-3b 后 1-2**——导航重构删树前须先有主页承接书架能力） `#/`：Dashboard 拆分——书架形态（书卡片/行列表、当前打开高亮、行内导出/重命名直显按钮）+ 新建/导入/打开其他路径；引导形态并入；概览形态移 `#/overview`
- [x] 1-3b 书架行能力迁入主页（1-2 前置）：导入备份 Dialog（同名二选一冲突态）、当前书
  导出/重命名（行内输入态）、行操作直显按钮——Sidebar 删除后能力不丢
- [ ] 1-4 富页详情入口查证收尾（1-1 已含路由/按钮收敛；余项：伏笔富页行双击进详情等，按查证结论）：实体泛型列表入口组件移除（hook/event/timepoint/reference 对应 UI 清理，路由已重定向）；伏笔富页若需详情能力则补入口（按查证结论）
- [ ] 1-5 文档同步：layout.md/architecture.md/AGENTS.md 前端段（Base UI 红线契约退役、样式纪律换 antd token、布局/路由描述）、tasks.md 状态、CHANGELOG 批次段

## 批次 2：会话渲染重做（需求 3）

- [ ] 2-1 消息流 x 化：Bubble/Sender + x-markdown 流式渲染（增量 memo，仅流式尾块重渲）；user/assistant 排版；**`{}` 修复**：历史工具调用渲染层双形态归一（wire `function.name/arguments` JSON 解析 + 内部形态兼容，存储/续聊重建不动）；chat-panel.test 重写适配
- [ ] 2-2 会话附属件 antd 化：工具调用行（折叠 + 状态 Badge：running/✓/✗，参数摘要保留）、提案卡（Card + 确认/拒绝三态语义不变）、断连横幅/错误条/focus 小条/会话切换下拉/输入区状态；Thought 接入（reasoning 内容如模型输出有）

## 批次 3：存量页面逐批换壳（每卡一页组，语义不动）

- [ ] 3-1 设置页 `#/preferences` antd 化（Form/提供商卡片；路由引用同步）
- [ ] 3-2 参考资料/回收站列表页 antd 化
- [ ] 3-3 实体页组：人物/地点表格 Table 化、设定树 Tree 化、关联总览页
- [ ] 3-4 实体详情/大纲节点详情表单化
- [ ] 3-5 大纲树页（树 + 拖拽保留自研换肤）
- [ ] 3-6 伏笔富页/时间轴页（dnd 保留自研换肤）
- [ ] 3-7 共用件收口：对话框/右键菜单/搜索选择/面包屑/空态/轻提示等统一 antd 件

## 批次 4：收尾清理

- [ ] 4-1 残留清理：Base UI/shadcn ui/* 组件与依赖退役删除、index.css 旧 tokens 收缩、样式纪律全仓核查（禁硬编码色值）
- [ ] 4-2 文档终态核对：layout.md/architecture.md/AGENTS.md/tasks.md 一致性 + CHANGELOG 版本段 + typecheck/lint/全仓测试绿
