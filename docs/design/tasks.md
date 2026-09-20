# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**（等触发条件 / 产品决策未定 / 只能人工执行三类混排在那边）；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 卡 19.1 — 关联页端点列徽标前置（源/目标列类型徽标对齐）

- **背景**：`relations-view.tsx` 的 `EndpointLink` 是「名称 + 类型徽标」，名称单行 `truncate` ⇒ 徽标 x 随名称长度浮动，短名行与长名行的徽标不在同一条竖线上（用户 2026-10 反馈）。
- **契约**：`docs/ui/DESIGN.md` §Components `relations-view`（本次改口径：端点单元格 = 类型徽标在前、名称在后）。
- **范围**：`components/entity/relations-view.tsx` 的 `EndpointLink`（可点 / 不可点两分支）徽标前置，徽标补 `shrink-0`；导出 `EndpointLink` 供 SSR 渲染序走查；`relations-view.test.ts` 增两条渲染序断言。**只改关联页**——人物页「其他关联」tab 与实体详情页的 `A [关系] B` 内联读法不动；大纲节点详情页的 scope 模式行走同一组件，自动同形。
- **判据**：`relations-view.test.ts` 绿（渲染 HTML 中徽标文案下标 < 名称下标，可点 / 不可点两分支各一条）；`pnpm --filter @whispering233/ai-editor-client test` 绿；`pnpm typecheck` / `pnpm lint` 绿；浏览器走查 `#/relations`：源列与目标列各自的徽标在同一条竖线上（短名/长名两行对比）。

---

## 卡的分工与验收

- **派工硬要求**（`AGENTS.md`「协作流程」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：见根 `AGENTS.md`「协作流程」的验证条（含单包测试 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
