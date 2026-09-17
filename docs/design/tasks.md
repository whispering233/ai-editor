# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**；本文件不维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 当前无进行中任务卡

---

## ⚠ 待验证（本机 WSLg / 无 mac 环境 / 需真机）

1. **卸载器「清除使用数据」的删除分支 + 签名门禁负向用例**：卸载时选「是」应清掉**带签名文件**的书库（`<文档>\AI Editor`）与 `%APPDATA%\AI Editor`；手工建一个无 `.ai-editor/library.json` 的同名目录，卸载选「是」后它**必须仍在**。（2026-09-16 那次数据消失是用户手工删的，**卸载分支本身仍未实测**）
2. **导入备份全链路**（真机）：导入一个备份，书名应取自备份内的 `project.json`，而不是 zip 文件名。
3. **安装器缓存被清**（v0.0.43 起）：卸载后 `%LOCALAPPDATA%` 下不应再有 `ai-editor-desktop-updater\`（安装时新建、卸载时无条件删）；带 scope 的旧名残留也应被清。
4. **原生目录选择框的可见性与交互**（WSLg 下 GTK 文件对话框挂起，非本仓代码）——书架页「浏览…」与设置页「更改…」两处。
5. **macOS 的 Cmd+C/V**（菜单 Edit 角色）、菜单项「打开书库/日志目录」的 `shell.openPath`。
6. **更新链路剩余两个小项**：升级时是否弹 UAC（预期不弹，per-user 安装）；安装对话框的 Esc 与 Enter 是否都走「稍后」。（升级链路本身已真机验证：v0.0.44→0.0.45→0.0.46→0.0.47→0.0.48 连续五跳成功，见 `50-desktop.md` §5.2「验证状态」）
7. **撤 `latest.yml` 的负向用例**（低优先级）：手动检查应弹「检查更新失败」而不是假「已是最新」。
8. **CI 侧打包态启动冒烟（缺的护栏）**：现在 CI 只验「包能构建、三资产齐全」，不验「包能起」——见 `backlog.md`（本仓已因此漏过一次：`electron-updater` 具名导入 typecheck 绿、打包态崩）。
9. **验证独立性限制（环境事实）**：本环境子代理（worker / oracle / delegate）**均无 shell 工具**（能力列表宣称有 `bash`，实际不可用）⇒ 「独立复现」只能做到「独立静态判读 + 产物阅读」，命令级证据由编排者提供。派工时按此前提安排（子代理写代码、编排者跑门禁与 commit）。

**开新卡**：从 `backlog.md` 选（当前分三类）——

- **等触发条件**：并发推送串行化、失败重试退避、`head` 改 CAS 元数据、DELETE 受限云盘的清理收敛、restore 后 `backupStale` 短暂为真（未验证）、旧命名残留份的处理、类型标签仍在三份表、大纲页交互无自动化守卫、CI 侧打包态启动冒烟、自动检查失败对网络不稳用户不可见、Actions 的 Node 20 告警、手动检查的「两个框」观感；
- **产品决策未定**：云端书架、文件级增量上传、内建端到端加密、保留策略 GFS、设置页内嵌更新面板；
- **只能人工执行**：真云盘（坚果云）验收 7 步（清单见 `backlog.md`）。

## 卡的分工与验收

- **派工硬要求**（`AGENTS.md`「并行派工的硬要求」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm -r build`（改 `shared`/`db`/`tools` 的 `src` 后**必须先**跑，否则下游读 dist 出假绿）/ `pnpm typecheck` / `pnpm lint` / `pnpm -r test`；**改桌面版主进程后额外跑打包态启动冒烟**（`build.md`，`typecheck` 绿 ≠ 打包态能起）。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
