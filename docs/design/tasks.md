# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**；本文件不维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 当前任务卡：桌面版（Electron 外壳）K6

设计契约 = `docs/design/50-desktop.md`（唯一事实源，§7 已录 K0 实测结论）。

（已完成：**D0** 设计定稿 → **P12** pnpm 12.4.2（含去 `--legacy`）→ **K0** 打包 spike → **K1** 书库位置 → **K2** 目录选择闭环 → **K3** 壳层（应用菜单 + 日志）→ **K4** 安全与导航 → **K5** 设置页「通用」tab + 切换书库（桌面版 CDP 实测 tab/路径/按钮；浏览器形态 SSR 测试 + 真实浏览器实测都无该 tab）。
⚠ **待人工验证（本机 WSLg 无法断言）**：① 原生目录选择框的**可见性与交互**（WSLg 下 GTK 文件对话框挂起；最小 Electron 对照实验同样挂起，非本仓代码问题）——涉及首次启动选书库、书架页「浏览…」、**设置页「更改…」并确认重启后落在新书库**三处；② **macOS 的 Cmd+C/V**（菜单 Edit 角色为本机无法验证的平台行为）；③ 菜单项「打开书库/日志目录」的 `shell.openPath` 真开文件管理器。需在真实 Linux 桌面 / macOS / Windows 上点一次。

- [ ] **K6 发布链路** — `.github/workflows/desktop.yml`（tag 触发、三平台 matrix）+ `scripts/sync-version.mjs` 纳入 `desktop` 版本 + README/CHANGELOG。**判据**：tag 触发后 Release 挂上三平台安装包。

**开新卡**：从 `backlog.md` 选（当前剩余分两类）——

- **等触发条件**：并发推送串行化、失败重试退避、`head` 改 CAS 元数据、DELETE 受限云盘的清理收敛、restore 后 `backupStale` 短暂为真（未验证）、旧命名残留份的处理、类型标签仍在三份表、大纲页交互无自动化守卫；
- **产品决策未定**：云端书架、文件级增量上传、内建端到端加密、保留策略 GFS；
- **只能人工执行**：真云盘（坚果云）验收 7 步（清单见 `backlog.md`）。


## 卡的分工与验收（沿用）

- **派工硬要求**（`AGENTS.md`「并行派工的硬要求」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm -r build`（改 `shared`/`db`/`tools` 的 `src` 后**必须先**跑，否则下游读 dist 出假绿）/ `pnpm typecheck` / `pnpm lint` / `pnpm -r test`。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）。
