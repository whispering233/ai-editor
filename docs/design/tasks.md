# 开发任务清单（Task Cards）

开发任务卡，**垂直切片**组织。依据：`docs/design/architecture.md`（分包/技术栈）、`docs/api/` 各模块文档（API 契约）、`docs/db/schema.md`（数据结构）、`docs/ui/layout.md`（布局与交互红线）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- 卡内不做卡外顺手改动；无待做项时不做 backlog 式顺手实现。
- 契约以 `docs/api`、`docs/db` 为准，发现文档矛盾先停下提问，不要自行发明。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）。
- 并行卡片在临时分支 + 临时 git worktree（`worktree: true`）开发，父会话验证后合回 main 清理分支。

---

## 项目状态（2026-09-10，v0.0.27 已打 tag）

v0.0.1-v0.0.26 发布链路全绿；**v0.0.27 = 批次十八：用户反馈七项修复与优化**（纯前端交互层，API/数据零改动，逐批独立代理验证）——中栏右下悬浮「问 AI」（点击必有反应）、`Ctrl/Cmd+S` 保存快捷键、新建即聚焦、focus 小条显示实体名称、实体列表页去一级化残留、面包屑整站移除、设定树拖拽插入线强化、死代码 `hooks/use-api.ts` 清理；逐卡 commit 见 git log（A1/A2/A3 → B1/B2 → C1/C2 + 验证跟进修复）。v0.0.26 = 批次十七：antd 全站迁移 + 布局重构 + 会话渲染重做（antd v6 cssVar 主题基座、书架主页/概览拆分、NavRail 一级导航、路由一级化、@ant-design/x 会话渲染、@base-ui/react 退役）。

**无待做项**；迭代演进路线见 `milestone.md`；运行/构建/发布手册见 `build.md`；版本史见根 `CHANGELOG.md`（历史批次执行明细与逐卡 commit 从 `git log` 回溯）。

## 当前任务卡

（无）
