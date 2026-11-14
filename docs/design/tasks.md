# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### stats-4-calendar-header — 修宽中栏月历标题竖排

**状态**：待执行
**依赖**：无（`stats-2-page` 已落地）
**范围**：仅 `packages/client/src/components/stats/month-calendar.tsx` 的头部布局与对应 SSR 断言；不动页面其余布局、热力色阶、服务端/统计口径。

**改动**
- 标题行只保留 `SectionCard` 标题「码字日历」+ 右侧「今天」按钮。
- 月份切换移到标题行下方的新导航行：左右箭头分别贴左/右，当前月份文本居中（`justify-between`）。
- 保留现有 aria-label / title（上个月/下个月）、`今天` 行为、月份切换与选日逻辑。
- 320px 月历卡内标题保持单行，不再被月份控件挤成竖排。

**硬完成判据**
- 新增/修改代码只落在上述范围；SSR 测试覆盖“标题、今天、翻月入口仍在”。
- `pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿。
- 产出新 commit（`git log -1` 可查）、`git status` 干净；汇报附 commit hash 与命令输出。
- 浏览器验收另由 `ui-verifier` 执行：1920×1080 宽中栏标题单行、今天/翻月/选日可用；1440 与 760 回归；浅/深色无回归。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。