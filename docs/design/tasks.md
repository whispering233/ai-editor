# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**（等触发条件 / 产品决策未定 / 只能人工执行三类混排在那边）；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 批 17：章正文页页头常驻

| 卡 | 内容 | 依赖 | 验收 |
| :-- | :-- | :-- | :-- |
| [ ] 17.1 | **章正文页页头常驻**（用户反馈：参考资料页写作时标题一直可见，章正文页的页头却跟正文一起滚走，两页不一致）：`pages/Manuscript.tsx` 的 `<section>` 由 `flex min-h-full flex-col` 改为 `flex h-full min-h-0 flex-col`；把**保存失败错误条之外**的内容（编辑器 + 大纲兜底）包进内层 `flex min-h-0 flex-1 flex-col overflow-y-auto`（错误条留在页头下方、不随内容滚走，与参考资料页同口径） | 15.1 | 章正文页：滚动正文时页头（标题 / 字数 / 保存态 / 上下一章 / 导入导出）与保存失败错误条常驻；写作面仍铺满剩余高度、点空白落文末；工具条 `sticky` 贴内层容器顶（页头之下）；专注模式不受影响（页头本就隐藏）；参考资料页行为不变；`pnpm typecheck`/`lint`/client test |

---

## 当前无进行中任务卡

---

## 卡的分工与验收

- **派工硬要求**（`AGENTS.md`「协作流程」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：见根 `AGENTS.md`「协作流程」的验证条（含单包测试 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
