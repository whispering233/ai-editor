# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

## 当前

**无进行中的任务卡。**

上一轮（P0 数据正确性 + P1 反馈可信度）已合入：离开闸门单一入口 → 七面叶子自注册 → 确认框在途锁 → 在途读计数 → 错误文案两 primitive → `SaveStatus` 扩到详情页 → 长任务已用时。变更事实见 `CHANGELOG.md`，契约见 `docs/ui/DESIGN.md` 与 `AGENTS.md`。

**唯一残留（未完成，不算已交付）**：浏览器像素核对——在途读计数（刷新按钮 loading）、错误文案迁移（仅 `ReferenceDetail` 一处位置变化）、详情页 `SaveStatus`（页头说明行改 flex 行）、长任务文案四处的浅 / 深两态目视确认。核对前必须整页重载（`#/` 之间的 `goto` 是同文档导航，不会重新拉 bundle，曾因此得出假阴性）。