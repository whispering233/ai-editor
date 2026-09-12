# 开发任务清单（Task Cards）

开发任务卡，**垂直切片**组织。契约依据：`docs/design/`（架构/上下文/循环/配置）、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`。

**执行纪律**：

- 一次只做一张卡，垂直切片、验证通过（含测试）才算完成，然后独立 commit（一卡一 commit，回滚 = revert 该 commit）；卡内不做卡外顺手改动。
- 契约以 `docs/` 为准；发现文档之间或文档与代码矛盾，先停下提问，不要自行发明。
- 每卡双代理：实现（fixer）+ 独立验证（oracle，只读仓库、自带探针）；并行卡片用临时分支 + git worktree 隔离。
- 验证：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`；**视觉改动额外跑** `packages/client` 的 `design-discipline.test.ts` 与 `antd-tokens.test.ts`。
- AI 运行时相关改动以 `@earendil-works/*` 实际代码为准（版本见各包 package.json 的 exact pin），不得凭记忆写接口。

---

## 当前任务卡

（本轮任务卡已全部完成并清理——见 `CHANGELOG.md` 的 `Unreleased` 段与本文件 git 历史。）
