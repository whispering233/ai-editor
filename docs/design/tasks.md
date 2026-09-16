# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**；本文件不维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 进行中任务卡

> 卡 A1（桌面版自动更新：发布链路）已完成：`03443fb` + 修复 `5c32efa`（资产名去空格 + `pack.mjs` 的 `assertUpdateAssetNames()` 打包期断言）——残留「无独立复现（本环境子代理无 shell）」已如实登记于下方待验证区。

### 卡 A2 — 桌面版自动更新：主进程逻辑与菜单入口

**目标**：Windows 安装态能自检自更新（逐条对齐 `50-desktop.md` §5.2 的表与两条硬约定）。

**改动**：
- `packages/desktop/package.json`：`electron-updater` `"6.8.9"` 进 `dependencies`（**exact pin**，不得进 devDependencies）
- 新增 `packages/desktop/src/updater.ts`：`setupAutoUpdate(win)`（win32 守卫 → 启动异步检查 → `autoInstallOnAppQuit = false` → `update-downloaded` 弹原生对话框（默认/取消按钮 = 稍后）→ 点「立即重启安装」则 `await closeServer()` → `quitAndInstall(true, true)`）+ 手动检查入口（已最新 / 发现新版本 / 失败 三应答）
- `packages/desktop/src/main.ts`：接线；菜单新增「帮助」（`AI Editor vX.Y.Z` disabled + 「检查更新…」）
- 根 `CHANGELOG.md` 的 `## [Unreleased]` 补条目（含「老版本需手动装一次」的事实）+ 根 `README.md` 的「桌面版（安装包）」节补一句：安装态会自动检查更新；**首个带更新能力的版本需手动装一次**（老版本没有更新器）。

**验收（自动 + 冒烟）**：`pnpm -r build` → `pnpm typecheck` → `pnpm lint` → `pnpm -r test` 全绿；`pnpm desktop:dist` 后本地起 Linux 包（窗口正常、日志无更新相关异常）；`git diff --stat` 证明 client / preload 零改动。

**待真机（不阻塞本卡验收）**：两版闭环，见下方待验证区第 6 条与 `build.md`。

---

最近完成的批次：**卸载残留清理 + 包名去 scope（v0.0.43）**——清理 electron-builder 安装器在 `%LOCALAPPDATA%` 留下的 130MB 缓存副本（卸载时无条件删，兼容旧名）；事实见根 `CHANGELOG.md` 的 `## [v0.0.43]` 段。此前三批：v0.0.42（书库位置 3 级回退 + 卸载选项与签名门禁）、v0.0.41（导入备份书名修正 + 打包口径收敛）、v0.0.40（桌面版整批）。

⚠ **待验证（本机 WSLg / 无 mac 环境 / 需真机）**：

1. **Windows 安装包全链路**（发版后拿到 exe 的人验）：安装 → 首次启动**直达书架**（不问目录，书库在 `<文档>\AI Editor`）→ 新建一本 → **导入备份**（书名应取自备份，不是 zip 文件名）→ **卸载时选「是」应清掉书库与 `%APPDATA%\AI Editor`；选「否」应全部保留**；
2. **签名门禁的负向用例**（只能真机）：手工建一个 `<文档>\AI Editor`（无 `.ai-editor/library.json`）→ 卸载选「是」→ 该目录**必须仍在**；
3. **安装器缓存被清**（v0.0.43 新验项）：卸载后 `%LOCALAPPDATA%` 下不应再有 `ai-editor-desktop-updater\`（安装时会新建，卸载时无条件删）；旧名 `@whispering233ai-editor-desktop-updater\` 也应被清；
4. 原生目录选择框的**可见性与交互**（WSLg 下 GTK 文件对话框挂起，非本仓代码）——剩书架页「浏览…」与设置页「更改…」两处；
5. **macOS 的 Cmd+C/V**（菜单 Edit 角色，本机无法验证）、菜单项「打开书库/日志目录」的 `shell.openPath`；
6. **Windows 自动更新的两版闭环**（需先发出含更新能力的版本）：装 v0.0.44 → 发 v0.0.45 → 启动应弹「新版本 v0.0.45 已下载」→ 点「立即重启安装」→ 重启后 菜单 → 帮助 版本号应为 v0.0.45；顺带观察 Defender/杀软是否拦静默安装（未验证项）。⚠ 老版本不会自己升上来，首跳必须手动装一次。
7. **CI 侧三资产首跑（v0.0.44 发版时）**：Release 上必须同时有 `AI-Editor-0.0.44-win-x64.exe` + `latest.yml` + `AI-Editor-0.0.44-win-x64.exe.blockmap`，且 `latest.yml` 的 `files[0].url` / `path` 与资产名**逐字一致**（本地 Linux 侧已由 `pack.mjs` 的 `assertUpdateAssetNames()` 守住同一不变式）。
8. **本仓验证独立性限制（环境事实，已登记）**：卡 A1 的打包/断言/commit 由编排者代跑——子代理（worker / oracle / delegate）在本环境**均无 shell 工具**（能力列表宣称有 `bash`，实际不可用）⇒ 「独立复现」只做到「独立静态判读 + 产物阅读」，命令级证据均为编排者提供。

**开新卡**：从 `backlog.md` 选（当前剩余分两类）——

- **等触发条件**：并发推送串行化、失败重试退避、`head` 改 CAS 元数据、DELETE 受限云盘的清理收敛、restore 后 `backupStale` 短暂为真（未验证）、旧命名残留份的处理、类型标签仍在三份表、大纲页交互无自动化守卫；
- **产品决策未定**：云端书架、文件级增量上传、内建端到端加密、保留策略 GFS；
- **只能人工执行**：真云盘（坚果云）验收 7 步（清单见 `backlog.md`）。


## 卡的分工与验收（沿用）

- **派工硬要求**（`AGENTS.md`「并行派工的硬要求」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm -r build`（改 `shared`/`db`/`tools` 的 `src` 后**必须先**跑，否则下游读 dist 出假绿）/ `pnpm typecheck` / `pnpm lint` / `pnpm -r test`。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）。
