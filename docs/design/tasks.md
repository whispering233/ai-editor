# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 进行中任务卡

### 卡 2 · 品牌图标资产 + favicon

- [ ] 新增 `packages/client/public/brand-icon.svg`（负形版：墨底 + 纸白挖空，纯 path，无滤镜/渐变）
- [ ] `index.html` 加 `<link rel="icon" type="image/svg+xml" href="/brand-icon.svg">`
- **依据**：`docs/ui/DESIGN.md` 的 `app-mark`（系统面形态）；该文件同时是卡 3 的打包源，**不另存副本**
- **验收**：浏览器标签页显示品牌图（浅/深主题各一次，含 16px 真实尺寸）、无 `/favicon.ico` 404；SPA 生产路径（server 托管 `client-dist`）能取到该文件；`design-discipline` 守卫扫描范围确认不误报
- **判据**：新 commit + `git status` 干净；`curl` 生产路径返回 200

### 卡 3 · 桌面应用图标接线（依赖卡 2 的资产）

- [ ] `electron-builder.yml` 加 `icon: "../client/public/brand-icon.svg"`（路径解析依据 = `50-desktop.md` §5.3）
- [ ] 本地 `pnpm desktop:dist` 出 Linux 包，核对 `release/linux-unpacked` 与 AppImage 已用品牌图标（不再是 Electron 默认图标）
- **依据**：`docs/design/50-desktop.md` §5.3
- **验收**：打包日志里不再出现「application icon is not set」；产物内图标集/SVG 为品牌图；**改图标属打包资源配置改动，但不动主进程 import** ⇒ 只需 Linux 打包冒烟（Windows 包等下次 CI 出包时复核）
- **判据**：新 commit + `git status` 干净；打包命令输出与产物核对结果贴在汇报里

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
