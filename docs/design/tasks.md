# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**；本文件不维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 进行中任务卡

### 卡 B1 — 修 v0.0.44 真机暴露的两个缺陷

**背景**（真机实测，契约见 `docs/design/50-desktop.md` §5.1/§5.2）：① 升级时弹出「是否清除使用数据」框——`customUnInstall` 没护 `${isUpdated}`/`${Silent}`，用户点「是」会删书库与 `%APPDATA%\AI Editor`（数据丢失风险）；② 手动检查弹两个框（「正在后台下载」+「已下载」），且差分 0 字节时「正在下载」是假话。

**改动**：
- `packages/desktop/build/installer.nsh`：`customUnInstall` 开头 `${If} ${isUpdated}` / `${If} ${Silent}` → `Return`（不弹框、不删数据、不清安装器缓存）；缓存清理只留给用户主动卸载
- `packages/desktop/src/updater.ts`：`manualCheckInFlight` 让手动流程独占对话框（事件路径不弹框）；手动路径改「单框」——下载秒完（缓存/差分 0 字节）只弹安装框，确实耗时才先提示「正在后台下载…」；连点菜单时有「正在检查/下载更新」回应
- `packages/desktop/src/updater.ts`：`autoUpdater.disableWebInstaller = true`（本仓只发完整包；兼消除真机日志里的上游告警）
- `docs/design/50-desktop.md` §5.1（升级路径不变式 + 过渡注意）/ §5.2（手动路径只弹一框 + 第三条硬约定）

**验收**：`pnpm -r build` / `typecheck` / `lint` / `-r test` 全绿；NSIS 脚本 `makensis` 编译通过（`build.md` 配方，只允许预期 warning 6020）；打包态启动冒烟。**真机复验属于卡 B2**。

### 卡 B2 — 发 v0.0.45 + 真机复验两版闭环

**目标**：用真实新版本验完「发现 → 下载 → 确认 → 静默安装 → **版本号真的变**」全链（v0.0.44 那次是影子包，只能验到安装链路）。

**步骤**：版本号 → CHANGELOG 搬运（含「v0.0.44 → v0.0.45 仍会弹一次清除数据框，**必须选否**」的过渡提醒）→ commit + annotated tag → push tag → 核对三资产与 `latest.yml` url 逐字一致。

**真机验收（Windows）**：v0.0.44 上点 菜单 → 帮助 → 检查更新… → 应**只弹一个框**（新版本已下载）→ 点「立即重启安装」→ 若旧卸载器弹清除数据框**选「否」**（另：**别点是**，否则书库没了）→ 应用退出、静默安装、自动拉起 → 菜单 → 帮助 版本号应为 **v0.0.45**；日志应含 `Found version 0.0.45` 与 `Install: isSilent: true, isForceRunAfter: true`；再做一次 v0.0.45 → v0.0.46 式升级（再发一版或临时影子）确认**不再弹清除数据框**。

---

## ⚠ 待验证（本机 WSLg / 无 mac 环境 / 需真机）

1. **Windows 安装包全链路**：安装 → 首次启动**直达书架**（不问目录，书库在 `<文档>\AI Editor`）→ 新建一本 → **导入备份**（书名应取自备份，不是 zip 文件名）→ **卸载选「是」应清掉书库与 `%APPDATA%\AI Editor`；选「否」应全部保留**；
2. **签名门禁的负向用例**：手工建一个 `<文档>\AI Editor`（无 `.ai-editor/library.json`）→ 卸载选「是」→ 该目录**必须仍在**；
3. **安装器缓存被清**（v0.0.43 起）：卸载后 `%LOCALAPPDATA%` 下不应再有 `ai-editor-desktop-updater\`（安装时新建、卸载时无条件删）；旧名 `@whispering233ai-editor-desktop-updater\` 也应被清；
4. **原生目录选择框的可见性与交互**（WSLg 下 GTK 文件对话框挂起，非本仓代码）——书架页「浏览…」与设置页「更改…」两处；
5. **macOS 的 Cmd+C/V**（菜单 Edit 角色）、菜单项「打开书库/日志目录」的 `shell.openPath`；
6. ✅ **Windows 自动更新的真机两版闭环（2026-09-16 完成）**：v0.0.44 → v0.0.45 → v0.0.46 两跳均成功。真机证据：
   - 发现新版本：`Found version 0.0.45` / `Found version 0.0.46`；**差分下载生效**：`File has 112 changed blocks` / `Full: 132,598 KB, To download: 2,277 KB (2%)`（第二跳 1%）；下载中旧缓存 sha512 不匹配时自愈（`Directory for cached update will be cleaned`）
   - 安装：`Install: isSilent: true, isForceRunAfter: true` + `Executing: …pending\AI-Editor-0.0.4x-win-x64.exe with args: --updated,/S,--force-run` → 应用退出 → 静默安装 → **自动拉起**（日志重启行）→ 版本号真的变为 v0.0.46（`Update for version 0.0.46 is not available`）
   - 杀软/Defender 未拦截；用户确认书库与 `%APPDATA%\AI Editor` 完好
   - 待补的小项：UAC 是否弹出、Esc/Enter 是否都走「稍后」（两跳均未专门观察）
7. ✅ **卸载提示框修复的真机验证（2026-09-16）**：v0.0.46（含修复）→ 影子 v0.0.47（载荷仍是 0.0.46）升级：用户确认**全程未出现「是否清除使用数据」框**，静默安装 + 自动拉起。此前 v0.0.44 → 0.0.45 / 0.0.46 两跳各弹一次、均选「否」（旧卸载器无法远程修补，与设计文档的过渡提醒一致）。
   - 残留：撤 `latest.yml` 的负向用例（手动检查应弹「检查更新失败」）未做——低优先级（网络超时时已实证自动路径静默落 `[error]`）。
   - 观察待定：手动路径在**下载确实耗时**（>1.2s 判定窗口）时会先后弹两个框（「正在后台下载…」→「已下载」）——两者都是真话，但用户可感知为“两个框”；见 `backlog.md` 相应条目。
8. **win32 分支在 Windows 上的启动冒烟**：✅ **真机已验（功能面）**——v0.0.44 在 Windows 上菜单可点、弹框正常、网络路径跑通；缺的是 **CI 自动断言**（`检查更新项: true` + 无 `SyntaxError`/`Uncaught Exception`），见 `backlog.md`「CI 侧打包态启动冒烟」。本地仍可用「临时掀守卫」方式在 Linux 上跑该分支（`build.md`）。
9. **验证独立性限制（环境事实）**：v0.0.44 两卡的打包/断言/commit 均由编排者代跑——本环境子代理（worker / oracle / delegate）**均无 shell 工具**（能力列表宣称有 `bash`，实际不可用）⇒ 「独立复现」只做到「独立静态判读 + 产物阅读」，命令级证据均为编排者提供。派工时按此前提安排（子代理写代码、编排者跑门禁与 commit）。

**开新卡**：从 `backlog.md` 选（当前分三类）——

- **等触发条件**：并发推送串行化、失败重试退避、`head` 改 CAS 元数据、DELETE 受限云盘的清理收敛、restore 后 `backupStale` 短暂为真（未验证）、旧命名残留份的处理、类型标签仍在三份表、大纲页交互无自动化守卫、CI 侧打包态启动冒烟；
- **产品决策未定**：云端书架、文件级增量上传、内建端到端加密、保留策略 GFS；
- **只能人工执行**：真云盘（坚果云）验收 7 步（清单见 `backlog.md`）。

## 卡的分工与验收

- **派工硬要求**（`AGENTS.md`「并行派工的硬要求」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm -r build`（改 `shared`/`db`/`tools` 的 `src` 后**必须先**跑，否则下游读 dist 出假绿）/ `pnpm typecheck` / `pnpm lint` / `pnpm -r test`；**改桌面版主进程后额外跑打包态启动冒烟**（`build.md`，`typecheck` 绿 ≠ 打包态能起）。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）。
