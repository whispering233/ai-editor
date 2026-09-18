# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**（等触发条件 / 产品决策未定 / 只能人工执行三类混排在那边）；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 批 14：正文手动保存按钮

| 卡 | 内容 | 依赖 | 验收 |
| :-- | :-- | :-- | :-- |
| [ ] 14.1 | **正文页「保存」按钮（工具条右端）**：`editor-toolbar.tsx` 加可选 `save?: { onSave: () => void; saving: boolean }`（不传 = 不渲染 ⇒ 参考资料页不出现；那页本有手动保存），右侧顺序改为 撤销 / 重做 / **保存** / 写作设置 / 命令帮助 / 专注模式 / 状态区；`document-editor.tsx` 透传；`pages/Manuscript.tsx` 传 `onSave = () => void saveContent(latestRef.current ?? "")`（**恒发一次 PUT**，含无待存内容的情况）+ `saving = saveState === "saving"`；`command-help.tsx` 补一条（工具条按钮集**同卡维护**） | — | 点击后状态转「保存中… → 已保存 · HH:MM」；`saving` 期间按钮禁用；专态与常规态都在（sticky 工具条）；参考资料页无此按钮；`pnpm typecheck`/`lint`/client test |

**依据**：`docs/ui/DESIGN.md` §Components「写作面」内容行 + 「为什么手动保存放在工具条」段；`docs/design/backlog.md` 已登记「关页面/退出桌面版可能丢最后 1.5s」（手动按钮是用户侧保底，非自动兜底）。

---

## 当前无进行中任务卡

---

## 卡的分工与验收

- **派工硬要求**（`AGENTS.md`「协作流程」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：见根 `AGENTS.md`「协作流程」的验证条（含单包测试 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
