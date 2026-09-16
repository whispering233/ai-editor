# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**；本文件不维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 进行中任务卡

> 卡 A1（发布链路：`03443fb` + `5c32efa`）与卡 A2（主进程逻辑与菜单：`a103cb1` + `4e46c10` + `55fbbf5`）均已完成并通过独立 oracle 复核（oracle 两轮各捉到一条真缺陷：资产名空格导致更新 404、`console.info` 不落盘导致排障日志缺上下文）。**当前无进行中任务卡**；剩余工作 = 下方「待验证」第 6-9 条（真机/CI，等 v0.0.44 发布）。

---

最近完成的批次：**卸载残留清理 + 包名去 scope（v0.0.43）**——清理 electron-builder 安装器在 `%LOCALAPPDATA%` 留下的 130MB 缓存副本（卸载时无条件删，兼容旧名）；事实见根 `CHANGELOG.md` 的 `## [v0.0.43]` 段。此前三批：v0.0.42（书库位置 3 级回退 + 卸载选项与签名门禁）、v0.0.41（导入备份书名修正 + 打包口径收敛）、v0.0.40（桌面版整批）。

⚠ **待验证（本机 WSLg / 无 mac 环境 / 需真机）**：

1. **Windows 安装包全链路**（发版后拿到 exe 的人验）：安装 → 首次启动**直达书架**（不问目录，书库在 `<文档>\AI Editor`）→ 新建一本 → **导入备份**（书名应取自备份，不是 zip 文件名）→ **卸载时选「是」应清掉书库与 `%APPDATA%\AI Editor`；选「否」应全部保留**；
2. **签名门禁的负向用例**（只能真机）：手工建一个 `<文档>\AI Editor`（无 `.ai-editor/library.json`）→ 卸载选「是」→ 该目录**必须仍在**；
3. **安装器缓存被清**（v0.0.43 新验项）：卸载后 `%LOCALAPPDATA%` 下不应再有 `ai-editor-desktop-updater\`（安装时会新建，卸载时无条件删）；旧名 `@whispering233ai-editor-desktop-updater\` 也应被清；
4. 原生目录选择框的**可见性与交互**（WSLg 下 GTK 文件对话框挂起，非本仓代码）——剩书架页「浏览…」与设置页「更改…」两处；
5. **macOS 的 Cmd+C/V**（菜单 Edit 角色，本机无法验证）、菜单项「打开书库/日志目录」的 `shell.openPath`；
6. **Windows 自动更新的真机两版闭环**（v0.0.44 发布后立刻可做）：装 v0.0.44（⚠ **首跳必须手动装一次**，老版本没有更新器）→ 发 v0.0.45（Release 三资产齐全）→ 启动 v0.0.44：`<userData>\logs\ai-editor.log` 应出现 `Checking for update` / `Found version v0.0.45`（**验 info 行确实落盘**）→ 弹「新版本 v0.0.45 已下载」→ 点「立即重启安装」→ 应用退出、静默安装、自动拉起 → 菜单 → 帮助 版本号 = v0.0.45。同批观察四件：① Esc 与 Enter 都走「稍后」（不重启、版本不变）；② 日志出现 `Cannot run installer: error code: …` ⇒ 静默安装被拦（杀软/Defender），需手动下载；③ 差分是否命中（base = `%LOCALAPPDATA%\ai-editor-desktop-updater\installer.exe`；卸载后首更回退全量，无功能影响）；④ `--force-run` 是否真拉起应用。
7. **无更新 / 失败的手动分支**：菜单「检查更新…」在无新版时应弹「已是最新版本（vX）」；负向用例（撤掉 Release 的 `latest.yml`）应弹「检查更新失败」且日志含 `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`。⚠ 本地已跑通后半段：临时掀掉 `isUpdateSupported()` 守卫 + `APPIMAGE=/tmp/fake` 在 Linux 打包态实测 → 日志出现 `[info] Checking for update` 与 `[error] … Cannot find latest-linux.yml … 404`（**同时直接验证了 info 行落盘的修复**），但**对话框 UI 面仍只能在真机验**。
8. **CI 侧三资产首跑（v0.0.44 发版时）**：Release 上必须同时有 `AI-Editor-0.0.44-win-x64.exe` + `latest.yml` + `AI-Editor-0.0.44-win-x64.exe.blockmap`，且 `latest.yml` 的 `files[0].url` / `path` 与资产名**逐字一致**（本地 Linux 侧已由 `pack.mjs` 的 `assertUpdateAssetNames()` 守住同一不变式）。
9. **win32 分支在 Windows 上的启动冒烟（缺）**：本地只能在 Linux 上以「临时掀守卫」方式执行该分支（已做：无崩溃、日志接线正确、网络与错误路径都跑通）；Windows runner 上「`检查更新项: true` + 无 `SyntaxError`/`Uncaught Exception`」的断言仍缺（卡见 `backlog.md`「CI 侧打包态启动冒烟」）。
10. **本仓验证独立性限制（环境事实，已登记）**：卡 A1/A2 的打包/断言/commit 均由编排者代跑——子代理（worker / oracle / delegate）在本环境**均无 shell 工具**（能力列表宣称有 `bash`，实际不可用）⇒ 「独立复现」只做到「独立静态判读 + 产物阅读」，命令级证据均为编排者提供。

**开新卡**：从 `backlog.md` 选（当前剩余分两类）——

- **等触发条件**：并发推送串行化、失败重试退避、`head` 改 CAS 元数据、DELETE 受限云盘的清理收敛、restore 后 `backupStale` 短暂为真（未验证）、旧命名残留份的处理、类型标签仍在三份表、大纲页交互无自动化守卫；
- **产品决策未定**：云端书架、文件级增量上传、内建端到端加密、保留策略 GFS；
- **只能人工执行**：真云盘（坚果云）验收 7 步（清单见 `backlog.md`）。


## 卡的分工与验收（沿用）

- **派工硬要求**（`AGENTS.md`「并行派工的硬要求」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm -r build`（改 `shared`/`db`/`tools` 的 `src` 后**必须先**跑，否则下游读 dist 出假绿）/ `pnpm typecheck` / `pnpm lint` / `pnpm -r test`。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）。
