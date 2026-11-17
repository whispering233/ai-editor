# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡 5：测试、像素走查与文档收口

- **目标**：补 `outline.test.tsx` 的 SSR 断言（树 / 详情 / 空态 / 窄屏 / 图标徽标）；`use-outline-rail` 的纯函数测试已随卡 1 落地，本卡只复跑；跑全量验证；由 `ui-verifier` 做有上限的浏览器像素走查；更新 `CHANGELOG.md` Unreleased；清空本文件的任务卡。
- **允许改**：`packages/client/src/pages/outline.test.tsx`、`CHANGELOG.md`、`docs/design/tasks.md`。功能缺陷回到对应卡修，不在本卡顺手改设计。
- **不做**：不新增功能 / 不扩 API / 不改 `DESIGN.md` 已定稿的交互口径（除非发现文档与实现矛盾，先停下提问）。
- **验收**：`pnpm typecheck`、`pnpm lint`、`pnpm -r test` 全绿；`ui-verifier` 按条目上限核桌面 1440 / 窄屏 390 的分栏、收起、卡 2 行手势与图标态（含伏笔徽标点击不导航）、卡 3 窄屏页头、卡 4 坏 id 窄列、空态、dirty 确认；CHANGELOG 只记用户可见变化；`tasks.md` 回到「暂无」。
- **完成判据（硬）**：`git log --oneline -1` 含本卡 commit；`git status --porcelain` 为空；汇报附 commit hash + 三条命令输出摘要 + ui-verifier 的逐条证据。oracle：ui-verifier 独立验收（不在本卡 commit 内）。
