# 开发任务清单（Task Cards）

MVP 开发任务卡，**垂直切片**组织：地基（一次性基础设施）后，每个切片 = 一个端到端功能（后端 → API 路由 → 前端页面），切片完成即可独立演示验证。依据：`docs/design/architecture.md`（分包/命令）、`docs/api/` 各模块文档（API 契约）、`docs/db/schema.md`（数据结构）、`docs/api/tool-calling.md`（工具目录）、设计文档（`00-master-design.md`/`10-data-model.md`/`20-context.md`/`30-agent-loop.md`）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- 卡内不做卡外顺手改动；无待做项时不做 backlog 式顺手实现。
- 契约以 `docs/api`、`docs/db` 为准，发现文档矛盾先停下提问，不要自行发明。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）。
- 并行卡片在临时分支 + 临时 git worktree（`worktree: true`）开发，父会话验证后合回 main 清理分支。

---

## 项目状态（2026-09-05，v0.0.24 已发布）

全量交付完成：v0.0.1-v0.0.24 发布链路全绿；最近一次收尾 = 文档体系按全局规则重组（2026-09：`doc/` → `docs/`，api 按模块拆分编号、冗余文档删除、layout 去样式化、architecture 分包去代码文件级）。**无待做项**；迭代演进路线见 `milestone.md`；运行/构建/发布手册见 `build.md`；里程碑版本史见根 `CHANGELOG.md`。

## 当前任务卡

（无）
