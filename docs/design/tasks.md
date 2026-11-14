# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### stats-5-calendar-fixed-height — 固定月历 6 周高度

**状态**：待执行
**依赖**：无（`stats-4-calendar-header` 已落地）
**范围**：仅 `packages/client/src/components/stats/month-calendar.tsx` 与 `month-calendar.test.tsx`；不改 `monthMatrix`、页面布局、趋势卡、热力色阶、API。

**改动**
- 月历网格固定按 6 周（42 格）渲染：`monthMatrix` 返回 4–6 行时，尾部补 `null` 空位到 42 格；空位用现有 `h-10` 占位，不显示日号/字数。
- 月历卡与同栏趋势卡高度不再随翻月变化：实测旧高度 355（4 周）/399（5 周）/443（6 周），固定后恒为 443px（含边框）；下方年度热力 top 不再跳（旧 622/666/710）。
- 保留现有 7 列、选中态、详情三格、今天/翻月行为。

**硬完成判据**
- 单元测试覆盖：4 周月份（如 2027-02）尾部补足 14 个空位（42 − 28），6 周月份（如 2026-11）补 12 个空位。
- `pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿。
- 新 commit + `git status` 干净；汇报 commit hash 与命令输出。
- 浏览器验收：1920 下切换 2026-11（6 周）/2026-12（5 周）/2027-02（4 周），月历卡高度恒 443，年度热力 top 恒 710；1440/760 无横向溢出。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。