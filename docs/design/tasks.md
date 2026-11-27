# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

## 当前

**无进行中的任务卡。**

上一轮（P0 数据正确性 + P1 反馈可信度）已合入：离开闸门单一入口 → 七面叶子自注册 → 确认框在途锁 → 在途读计数 → 错误文案两 primitive → `SaveStatus` 扩到详情页 → 长任务已用时。变更事实见 `CHANGELOG.md`，契约见 `docs/ui/DESIGN.md` 与 `AGENTS.md`。

**像素核对已做（7 项全 PASS）**：在 `pnpm start:test-project` + 真实 Chromium（1440×900，浅 / 深两态）下逐项验过，证据 = DOM 取值 + 13 张视口内截图；全程无 console error / 失败请求。两处分支**未覆盖**（导出仅 250ms，未达「已用时」阈值；1440×900 下时间戳未触发截断）——已登记 `backlog.md`，不当作已验。