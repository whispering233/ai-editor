# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 进行中任务卡

### 卡 3 · 桌面应用图标接线（依赖卡 2 的资产）

- [ ] `electron-builder.yml` 按平台设置图标（`linux.icon` / `win.icon` / `mac.icon` 三者均指向 `../client/public/brand-icon.svg`——**顶层 `icon` 在 `app-builder-lib` 26.15.3 的类型里未声明，不用它**；路径解析依据 = `50-desktop.md` §5.3）
- [ ] 本地 `pnpm desktop:dist` 出 Linux 包，核对产物内确为品牌图标（不再是 Electron 默认图标）
- **依据**：`docs/design/50-desktop.md` §5.3
- **验收**：打包日志里**不再出现**「application icon is not set」；`release/` 产物（AppImage 内 squashfs 的图标文件 + `.desktop` 的 `Icon=`）为品牌图；**只改打包配置、不动主进程 import** ⇒ 只需 Linux 打包冒烟（Windows 包等下次 CI 出包时复核）
- **已知风险**：图标工具集 `icons@1.1.0` 未在本机缓存（`~/.cache/electron-builder/` 里无该目录）⇒ 首次打包会联网下载；下载失败属环境阻塞，**如实报，不得伪造 PASS**
- **判据**：新 commit + `git status` 干净；打包命令输出与产物核对结果贴在汇报里

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
