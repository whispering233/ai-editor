# 开发任务清单（Task Cards）

开发任务卡，**垂直切片**组织。依据：`docs/design/architecture.md`（分包/技术栈）、`docs/api/` 各模块文档（API 契约）、`docs/db/schema.md`（数据结构）、`docs/ui/layout.md`（布局与交互红线）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- 卡内不做卡外顺手改动；无待做项时不做 backlog 式顺手实现。
- 契约以 `docs/api`、`docs/db` 为准，发现文档矛盾先停下提问，不要自行发明。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）。
- 并行卡片在临时分支 + 临时 git worktree（`worktree: true`）开发，父会话验证后合回 main 清理分支。

---

## 项目状态（2026-09-06，v0.0.26 已发布）

v0.0.1-v0.0.26 发布链路全绿；v0.0.26 = **批次十七：antd 全站迁移 + 布局重构 + 会话渲染重做**（antd v6 cssVar 主题基座、书架主页/概览拆分、NavRail 一级导航、路由一级化、@ant-design/x 会话渲染、@base-ui/react 退役）。**无待做项**；迭代演进路线见 `milestone.md`；运行/构建/发布手册见 `build.md`；里程碑版本史见根 `CHANGELOG.md`（批次十七执行明细与逐卡 commit 可从 `git log` 回溯：批次 0-4 卡片在 v0.0.26 发布 commit 前的提交历史中）。

## 当前任务卡

### 批次十八：用户反馈七项（2026-09-06）

依据：`docs/ui/layout.md`（本轮已先行更新：§3 悬浮问 AI / 实体页去 tab、§6.4 focus 名称、§7 详情页无面包屑 + 新建即聚焦 + 保存快捷键）。一卡一 commit。

**批次 A（中栏结构 + 交互打磨）**
- [x] A1（#6）实体列表页移除残留标题「实体」与类型 tab（Segmented）——类型切换回归左栏 NavRail
- [x] A2（#1）新建即聚焦：设定树/实体列表/大纲/时间轴时间点——新建后滚动到位 + 临时高亮 + 键盘焦点落到新条目
- [x] A3（#4）设定树拖拽分割线强化（加粗 + 端点提示，手动模式插入线醒目）

**批次 B（详情页结构 + 快捷键）**
- [x] B1（#7）移除面包屑：删 `components/page-nav/Breadcrumb.tsx` + 4 处使用（实体/大纲/时间轴/参考资料详情）
- [x] B2（#5）`Ctrl/Cmd + S` 保存：注册栈 hook + 4 详情页表单 + 伏笔编辑态 + 行内编辑提交（大纲标题/摘要、设定树名称、时间轴事件行、参考资料标题）；不含设置页

**批次 C（问 AI 入口 + 上下文可读性）**
- [x] C1（#3）「问 AI」改中栏右下悬浮按钮（antd FloatButton），InfoBar 移除该入口
- [x] C2（#2）focus 小条显示实体名称（`names/resolve` 解析，替代裸 entity id）
