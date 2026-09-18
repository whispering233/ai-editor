# Changelog

本文件记录项目的所有显著变动。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- **大纲页自动编号与「章视图」（2026-09）**：树视图的卷/章行改为 `第N卷` / `第N章` 编号徽标（仍走 `TypeChip`：`min-w-14` + `tabular-nums`；场景行仍为「场」）；页头「全部折叠」左侧新增视图切换按钮（`大纲树` ⇄ `章视图`，文案 = 目标视图；页面 state 不持久化，章视图隐藏「全部折叠」）；新增**章视图 = 平铺章列表**（按阅读序，行 = `第N卷` + `第N章` + 标题 + 摘要 + 伏笔标记 + 「阅读进度」徽标；单击标题就地改名、双击进详情）。
  - 编号口径 = **用户可见序**（卷序按顶层文件位置 1-based；章序 = 全书先序连续、只计未软删节点 ⇒ 删章后重排），与服务端 `deriveChapterOrder`（含软删、保引用稳定）**不同源**：UI 编号只作展示、不参与计算（登记于 `10-data-model.md` §4）。
  - 有意收窄：章视图不做删除 / 新建 / 拖拽（结构编辑与排序的唯一入口仍是大纲树）；编号也不扩散到章详情页 / 选章下拉等其他位置（见 `backlog.md`）。

### Security

- **凭据不得进备份文件名段**（2026-09-17 用户报告的真机事故）：用户误把 WebDAV 应用密码贴进设置页「设备名」框后，app 未加阻拦，把它写进本机备份文件名、上传成云端文件名、并在冲突裁决框展示（强推时又把带密码的云端文件名原样拷回本机 `.backups/`；16 位小写字母数字的坚果云应用密码恰好通过设备名语法规则）。现在：
  - `PUT /cloud/config` 的设备名、`POST /backup` 与 `POST /backup/rename` 的标签等于应用密码 → 400 `VALIDATION_ERROR`（比较含 trim；同一请求里新设密码 + 新设备名一起拦）。
  - 存量坏配置（旧版本/手工编辑写入）读侧按「未配置」处理 → 设备名回退 hostname 派生值，立刻止漏（`GET /cloud/status` 的 `deviceConfigured` 随之 false，设置页不预填坏值）。
  - 已泄露到云端的旧文件名**不自动清理**（属用户备份数据）：用户侧处置 = 轮换云盘应用密码（旧值当场作废）+ 删除/改名那份文件。

## [v0.0.48] - 2026-09-16

> **文档收敛版（无功能变更，代码与 v0.0.47 一致）**：清理自动更新上线后积累的过时表述与已验证的待办项，并把真机验证结论收敛成可执行清单。回归：build / typecheck / lint / `-r test` 全绿。

### Docs

- `50-desktop.md`：§5.1 的「过渡注意」改为历史（v0.0.45 起升级不再弹清除数据框，真机已验证）；§2 首次启动口径补齐「`desktop.json` JSON 不可读同样按首次启动处理并重写配置（自愈）」。
- `tasks.md`：清掉已完成的卡（发布链路 / 主进程逻辑 / 两个真机缺陷修复）与已验证的待验证项（真机两版闭环、卸载提示框修复、info 行落盘、三资产首跑），剩下 9 条可执行的待验证清单。
- `AGENTS.md`：桌面版硬约束新增「升级路径守卫不可回退」（`customUnInstall` 必须保留 `${isUpdated}`/`${Silent}` 早退）；验证行补「改主进程后必跑打包态启动冒烟」。
- `backlog.md`：移除一条误判项（用户手工删数据导致的「首次启动」现象，非缺陷）；保留差分回退、Actions Node 20 告警、慢网两个框等待排期项。

## [v0.0.47] - 2026-09-16

> **端到端升级验证版本（无功能变更，代码与 v0.0.46 一致）**：用于真机做一次「公告版本 = 实际载荷」的完整升级（v0.0.46 → v0.0.47）——验证 v0.0.45 起的修复（升级不再弹清除数据框）、差分下载、静默安装、自动拉起与版本号变化。回归：build / typecheck / lint / `-r test` 全绿（154 文件 / 2335 测试）。

### Note

- 唯一变化是版本号；功能与 v0.0.46 相同。
- 真机升级路径：v0.0.46（含已修复卸载器）→ v0.0.47：全程**不应**出现「是否清除使用数据」框，完成后 菜单 → 帮助 应显示 v0.0.47。

## [v0.0.46] - 2026-09-16

> **自动更新链路的验证版本（无功能变更）**：v0.0.45 之后连发一版，用于在真机上走完整的「发现新版本 → 下载 → 确认 → 静默安装 → 版本号变化 → 自动拉起」两跳（v0.0.44 → v0.0.46 会走一次旧卸载器；v0.0.46 → 下一版起才完全无提示）。回归：build / typecheck / lint / `-r test` 全绿。

### Note

- 本版仅版本号推进，代码与 v0.0.45 完全一致（`27a02fe`）——用作真机升级验证的目标版本。
- **v0.0.44 → v0.0.46 仍会弹一次「是否清除使用数据」**（那一次由安装在机器上的 v0.0.44 旧卸载器执行，无法远程修补）：**必须选「否」**。v0.0.46 起再升级不再弹框、不动用户数据。

## [v0.0.45] - 2026-09-16

> **修 v0.0.44 真机暴露的两个缺陷**（`27a02fe`）：升级时不再弹「清除使用数据」框（点「是」会删书库）、手动检查不再弹两个框。回归：build / typecheck / lint / `-r test` 全绿（154 文件 / 2335 测试）+ NSIS 脚本 makensis 编译 + 打包态启动冒烟。

### Fixed

- **升级过程中会弹出「是否清除使用数据」，点「是」即删书库与 `%APPDATA%\AI Editor`**（数据丢失风险）：安装器覆盖安装前会用 `/S /KEEP_APP_DATA --updated` 调**旧版卸载器**先清程序文件，此时自定义卸载钩子 `customUnInstall` 同样被执行——原脚本无条件弹框（`MessageBox` 在 `/S` 静默模式下照样弹）且无条件删数据。上游自己的数据清理是用 `${ifNot} ${isUpdated}` 护住的，我们漏了这层。现 `customUnInstall` 开头以 `${isUpdated}`（升级内部调用）/`${Silent}`（脚本化静默卸载）直接 `Return`：不弹框、不删用户数据，也**不清安装器缓存**（升级时该目录里正躺着正在执行的待装包，且新安装会自行刷新）。
- **手动「检查更新…」会弹两个框，且「正在后台下载」在差分 0 字节时是假话**：`checkForUpdates()` 只**发起**下载就返回，而下载完成事件稍后才触发，于是手动路径与事件路径各弹一个框。现手动流程独占对话框（`manualCheckInFlight`）：下载秒完（缓存命中 / 差分 0 字节）只弹「新版本已下载」+ 安装按钮；确实耗时（>1.2s）才先给一句「正在后台下载…」；连点菜单时给「正在检查/下载更新」回应。
- **消除上游告警**：`autoUpdater.disableWebInstaller = true`（本仓只发完整 nsis 包，不发 nsis-web 差分包）。

### 过渡注意（一次性）

**v0.0.44 → v0.0.45 这次升级仍会弹出一次「是否清除使用数据」**——旧卸载器已经装在用户机器上，无法远程修补。届时**必须选「否」**（选「是」会删书库与应用数据，不可恢复）。v0.0.45 起的每次升级都不再弹框、也不动用户数据。

## [v0.0.44] - 2026-09-16

> **桌面版 Windows 自动更新**：`electron-updater` 6.8.9 + GitHub Releases，安装态启动自动检查 → 后台下载 → 弹框确认后静默安装（`6cdad08` 设计、`03443fb`+`5c32efa` 发布链路、`a103cb1` 主进程逻辑、`4e46c10`+`55fbbf5` 两处修复）。回归：build / typecheck / lint / `-r test` 全绿（154 文件 / 2335 测试：client 865、server 577、tools 287、db 281、shared 222、agent 82、desktop 21）+ 打包态启动冒烟。

### Added

- **桌面版 Windows 自动更新**：启动后异步检查一次（**静默**：发现新版即后台下载，下载完成才弹原生对话框「立即重启安装 / 稍后」，默认与 Esc 都是「稍后」）+ 菜单新增「帮助」（`AI Editor vX.Y.Z` disabled + 「检查更新…」，手动路径必有应答：已是最新 / 发现新版本（后台下载中）/ 检查失败并附日志路径）。**只在用户确认后安装**（`autoInstallOnAppQuit = false`；安装前先 `await closeServer()` 收敛 WAL 与备份调度，再 `quitAndInstall(true, true)`），只替换程序文件，**不动书库数据**。仅对 Windows 安装态生效（其他平台不出包也不检查）。⚠ **首个带更新能力的版本需手动下载安装一次**——老版本里没有更新器，不会自动升上来。
- **发布链路产出自动更新元数据**：`electron-builder.yml` 新增 `publish`（github / owner / repo）→ 包内 `resources/app-update.yml` + Release 资产 `latest.yml`；`desktop.yml` 的资产 glob 改为**三件套**（`AI-Editor-<v>-win-x64.exe` + `latest.yml` + `.exe.blockmap`，后者供差分下载）；`pack.mjs` 显式传 `--publish never`（上传唯一路径 = `softprops/action-gh-release`），并新增 `assertUpdateAssetNames()` 打包期断言。

### Fixed

- **资产名含空格 ⇒ 自动更新必 404**（oracle 复核产出）：磁盘名 `AI Editor-…`（空格）、GitHub 上传后 `AI.Editor-…`（点）、而 electron-builder 写进 `latest.yml` 的是 `AI-Editor-…`（短横），更新器又按 yml 的 url 直拼 `/releases/download/<tag>/<名>`（不做资产清单回退）。现 `artifactName` 固定为无空格的 `AI-Editor-<v>-<os>-<arch>.<ext>`，并用打包期断言守住「磁盘名 = 资产名 = `latest.yml` 的 url」这条不变式（变异探针验证过会报错中断打包）。
- **`electron-updater` 具名导入在打包态直接崩**（打包态冒烟产出）：`import { autoUpdater } from "electron-updater"` 在 Electron 的 ESM loader 下报 `does not provide an export named 'autoUpdater'`（该包是 CJS），而 `typecheck`/`lint`/单测**全绿**、开发态看不出来。现改默认导入 + 解构；根 `AGENTS.md`/`build.md` 已登记“主进程改 import 后必跑打包态启动冒烟”。
- **更新流程的 info 行不落盘**（oracle 复核产出）：`log.ts` 只接管 `console.log/warn/error`，而 electron-updater 默认 logger 的 `info` 走 `console.info`（实测 `console.info !== console.log`）⇒ 真机排障时日志里只剩 error。现显式接 `autoUpdater.logger`（箭头包装，不依赖调用顺序）。

### Docs

- `docs/design/50-desktop.md` 新增 §5.2（选型/时机/反馈/安装口径/信任锚与安全边界/发布侧前置）；`build.md` 补三资产纪律、打包态启动冒烟、真机两版闭环、win32 分支本地跑法；`backlog.md` 修正“签名是自动更新前置”的旧口径并登记 6 条新遗留项；`AGENTS.md` 新增桌面版自动更新硬约束。

## [v0.0.43] - 2026-09-16

> **卸载体验收尾**：清理 electron-builder 安装器留在 `%LOCALAPPDATA%` 的 130MB 缓存副本（`1a6467a`）+ desktop 包名去 scope（让该目录名可读）。回归：build / typecheck / lint / `-r test` 全绿（desktop 21，其余同 v0.0.42）。

### Changed

- **桌面版包名去 scope**：`@whispering233/ai-editor-desktop` → `ai-editor-desktop`。动因：electron-builder 的 `updaterCacheDirName`（`%LOCALAPPDATA%\<name>-updater\`）**派生自包名且无配置项可覆盖**，带 scope 会生成 `@whispering233ai-editor-desktop-updater` 这种拼音式目录名。private 包不发布，仅影响仓库内引用（`pack.mjs` 的 filter 名 + 文档）。

### Fixed

- **卸载残留的安装器缓存（约 130MB）**：`%LOCALAPPDATA%\<name>-updater\installer.exe` 是 electron-builder 的 NSIS 安装器安装时写出的自身副本（供差分更新 / `quitAndInstall`），而**默认卸载器不清理它**（上游 electron-builder#9505）。现 `installer.nsh` **无条件删除**（属程序文件而非用户数据，且本项目未启用自动更新），并兼容带 scope 的旧目录名。
## [v0.0.42] - 2026-09-16

> **桌面版健壮性：书库位置回退 + 卸载清理（含签名门禁）**：书库位置三级回退（`c4dca12`）+ 卸载时可清除使用数据、且**只删带签名文件的书库目录**（`54eeee9`）。回归：build / typecheck / lint / `-r test` 全绿（desktop 21，其余同 v0.0.41）。

### Added

- **卸载时的「清除使用数据」选项（Windows）**：新增 `packages/desktop/build/installer.nsh`，卸载前询问一次（**默认「否」**= 保留数据，便于重装续用）；选「是」则清理书库默认候选位置（`<文档>/AI Editor`、`<主目录>/AI Editor`）与 `<userData>\AI Editor`（desktop.json / 日志 / 缓存）。**删除前提 = 应用签名文件**：应用每次启动幂等写入 `<书库>/.ai-editor/library.json`，卸载器只删带这个文件的目录——同名但非本应用创建的目录一律跳过（避免不可恢复的误删）。**自定义书库位置不会被自动删**（卸载器不解析 desktop.json——NSIS 读 UTF-8 JSON 有编码坑），提示文案里写明判断依据。

### Fixed

- **书库位置解析加 3 级回退**：`<文档>/AI Editor`（文档目录被 OneDrive 重定向时**跳过**——书库内有 SQLite 与备份 zip，不放实时同步盘）→ `<主目录>/AI Editor` → `<userData>/AI Editor`；已保存位置不可用时同样走回退并改写配置，**全部不可用才报错退出**（弹原生错误框）。此前 `mkdirSync` 失败会让首次启动直接崩：Windows 的「文档」是已知文件夹，可能被重定向到并不存在的路径（OneDrive 卸载后的注册表残留）。实测：把 `desktop.json` 指向无权限路径 → 日志出现 `[warn] 书库位置不可用…（EACCES）` + `原书库位置…不可用 → 改用 …`，配置被改写为可用路径且服务正常起来。
- **卸载删除的签名门禁**（安全性）：书库目录名 `AI Editor` 是通用名，**按名 `RMDir` 会误删用户早先自己建好的同名目录（不可恢复）**。现每次启动幂等写 `<书库>/.ai-editor/library.json`（`writeLibraryMarker`），卸载器**只删带该签名文件的目录**；`<userData>` 的存在性检查用 `desktop.json`（同样是本应用写的）。同名但无签名的目录一律跳过，提示文案里写明判断依据。

## [v0.0.41] - 2026-09-16

> **导入书名修正 + 桌面打包口径收敛**：修复「导入备份后书名变成备份文件名」（`f67472e`）；打包分工落定（本地只打 Linux 包、CI 只出 Windows 包）。回归：`pnpm -r build` → typecheck → lint → `pnpm -r test` 全绿（server 577 / client 865 / desktop 16，其余同 v0.0.40）。

### Changed

- **桌面打包分工（2026-10 定）**：**本地只打 Linux 包测试**（`pnpm desktop:dist`，产物在 `packages/desktop/release/`）；**Windows 包由 CI 出**（`desktop.yml` 的 windows-latest，可手动触发+下载 artifact 先验）；macOS 包暂不做（无 mac runner 可验）。将来有真实用户需求再恢复三平台 matrix（项已注释保留）。Windows 本地交叉构建需 Wine（electron-builder 官方口径），本仓不往开发机装该依赖。

### Fixed

- **导入备份后书名变成备份文件名**：client 选 zip 后会自动把「文件名去 `.zip`」预填为书名，而备份命名是 `<时间戳>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip` —— 整串元信息被当成书名写进目录名与 `project.json`。现改为 `POST /project/import` 的 `name` **可选**：留空即用备份内 `project.json` 的 name（备份是权威），显式填写才覆盖（非法仍 400）；备份内名字为空/含非法字符（手工改坏的包）→ 兑底「导入的书籍」。client 不再预填，输入框占位符改「留空 = 使用备份里的书名」。

## [v0.0.40] - 2026-09-16

> **桌面版（Electron 外壳）落地**：设计定稿（`3850d99`）→ pnpm 12.4.2（`fb1630a`）→ 骨架与打包链路（`a15b6b1`）→ 书库位置（`2bbc5b1`）→ 目录选择闭环（`368a099`）→ 应用菜单与日志（`d714bae`）→ 安全与导航（`bb6b2b0`）→ 设置页「通用」tab（`bb66e1d`）→ 三平台发布链路（`ecc8c07`）。桌面端到端实测：打包产物起窗口 + preload 桥可见 + SQLite 建库 + 外链/跨源导航被拦 + 日志落盘；浏览器形态零变化（真实浏览器 + SSR 守卫）。回归：`pnpm -r build` → typecheck → lint → `pnpm -r test` 全绿（shared 222 / db 281 / client 865 / tools 287 / agent 82 / server 575 / desktop 16）。

### Added

- **桌面版发布链路**：新增 `.github/workflows/desktop.yml`（push `v*` tag 触发，ubuntu / macos / windows 三平台矩阵各自 `pnpm -r build` + `node packages/desktop/scripts/pack.mjs <平台参数>`，产物挂到该 tag 的 GitHub Release）；`scripts/sync-version.mjs` 纳入 `desktop`（版本号与 npm 包同源，同一 tag 产 npm 包 + 三平台安装包）；electron-builder 补 mac（dmg，`identity: null` 显式不签名）/ win（NSIS，`oneClick: false` 让用户能选安装目录）配置；README 增桌面版安装说明与平台注意事项。
- **桌面版设置页「通用」tab 与切换书库**：设置页二级 tab 顺序改为「通用 → AI 模型 → 项目规则 → 备份」，其中「通用」**仅桌面版渲染**（含「书库位置」卡片：只读路径 + 「更改…」+ 重启说明）。更改流程 = preload 桥 → 原生目录框 → 写 `<userData>/desktop.json` → 先关服务（收敛 WAL 与备份调度）再 `app.relaunch()`。**浏览器形态 tab 集合与行为零变化**（SSR 守卫 + 真实浏览器实测都无该 tab）。附 2 条 SSR 守卫（无桥无「通用」/有桥排首位）。
- **桌面版导航守卫与沙箱基线复核**：`setWindowOpenHandler` 一律 deny（外链交系统浏览器），`will-navigate` 只放行同源 `http://127.0.0.1:<端口>`（含 SPA hash），非 http(s) 协议直接丢弃；渲染层基线 = `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`，preload 只暴露 `pickDirectory`。实测（CDP）：`window.open` 返回 null、`location.href` 跳外部域名不导航且落日志、同源 hash 导航正常；**打包态验证 devtools 菜单项不存在**（`devtools 项: false`）。
- **桌面版壳层：应用菜单 + 日志落盘**：最小应用菜单——**Edit 角色不是装饰**（macOS 上不设菜单 ⇒ Cmd+C/V 失效、输入框全废），自有条目只有「打开书库目录 / 打开日志目录」，devtools 仅在未打包态出现，非 macOS 补「退出」。`console.*` 同时落 `<userData>/logs/ai-editor.log`（**同步追加**：桌面版日志频率低，写即落盘比吐吞量重要——崩溃现场最后几行往往就是死因；写失败静默不阻断创作）。附 8 条日志层单测（格式化/截断/循环对象/stdout 行为不变/追加语义）。
- **桌面版书架页「浏览…」目录选择闭环**：沙箱 preload 经 `contextBridge` 只暴露 `pickDirectory()`（不暴露 fs/shell/ipcRenderer 原语），主进程 `ipcMain.handle("desktop:pick-directory")` 与首次启动共用同一个原生目录框；client 新增 `lib/desktop.ts` 作为**唯一**能力检测入口（浏览器形态返回 null），书架页「打开其他路径」行据此条件渲染「浏览…」按钮，选中后直接打开该项目。**浏览器形态零变化**（真实浏览器实测无按钮、手输框行为不变；4 条 desktopBridge 单测 + client 863 测试全绿含 `design-discipline` 守卫）。
- **桌面版「书库位置」落地**：新增 `packages/desktop/src/config.ts`——`<userData>/desktop.json` 的读写（防御解析：非法 JSON/结构不符/相对路径一律当未配置；原子写）。启动流程：已配置→直接用（目录被删则重建）；未配置→弹原生目录选择框（建议值 `<文档>/AI Editor`，**用户取消则退出且不落任何配置**）。主进程从此**不依赖 `process.cwd()` / 命令行参数**。服务启动失败时弹原生错误框 + 退出（桌面版没有终端可看堆栈）。附 8 条配置层单测，`pnpm -r test` 现覆盖 desktop 包。
- **桌面版骨架（Electron 外壳）可构建、可打包、可运行**：新增 `packages/desktop`（主进程 ESM + 沙箱 `preload.cts` → CJS；主进程内 in-process 启 `startServer()` 并加载 `http://127.0.0.1:<端口>`）。`pnpm desktop:dist` 一键出 Linux AppImage（`pnpm deploy` 收自包含依赖 → electron-builder asar + 安装包，`asarUnpack` 放原生模块）。实测确认：better-sqlite3 v13 的 N-API 预编译在 Electron 44.3.0 上**免 electron-rebuild**、打包产物能起窗口（React 挂载 + preload 桥可见）并走通建项目（含 SQLite 建库）。
- **桌面版（Electron 外壳）设计定稿**：新增 `docs/design/50-desktop.md`（进程模型 / 端口策略 / 配置位置 / preload 契约 / 原生能力边界 / 打包与发布）；`architecture.md` 增第七个包 `packages/desktop` 与 `electron` 44.3.0 exact pin；`build.md` 增桌面版开发/打包/发布链路；`config.md` 登记 `<userData>/desktop.json`；`docs/ui/DESIGN.md` 登记设置页「通用」tab 与书架页「浏览…」按钮；`AGENTS.md` 登记桌面版硬约束。

### Changed

- **pnpm 11.22.0 → 12.4.2**（根 `packageManager`；CI 的 `pnpm/action-setup` 读同一字段自动跟随）：clean install + `-r build` / `typecheck` / `lint` / `-r test`（shared 222 / db 281 / client 859 / tools 287 / agent 82 / server 575）+ `test:packed`（tarball 安装态冒烟）+ `desktop:dist` 全绿。`pnpm-workspace.yaml` 的 `allowBuilds` 在 12 下仍被正确识别；lockfile 由 12 重写（新增 `packageManagerDependencies` 与 `@pnpm/exe.*` 条目，本地零字节安装成本）。**桌面打包去掉 `--legacy`**：12.2+ 的 `pnpm deploy` 默认实现不再要求 injected workspace，新路径经打包产物实测可用（窗口 + preload 桥 + SQLite 建库均通）。
- **桌面版首次启动不再弹目录选择框**：直接使用默认书库位置 `<文档>/AI Editor`（建目录 + 写配置），先让用户进得去软件；要不要换目录随时在 设置 → 通用 → 书库位置 改（改完自动重启）。旧行为（弹原生框、取消则退出）在 WSLg 环境下还会直接卡死首次启动。原生选择框仍服务于书架页「浏览…」与设置页「更改…」两处。

### Fixed

- **桌面包缺前端 SPA（v0.0.40 的 Windows 包实测）**：server 的 SPA 走 `<server>/client-dist` 兜底路径，而该目录只在 server 包 prepack 时生成——桌面打包走 `pnpm deploy`，CI 上从未生成 ⇒ 包能启动、窗口却只显示 `client/dist 未构建` 的 404 JSON（本机因为残留的旧目录而没暴露）。现 `pack.mjs` 在 deploy 前先跑 `scripts/copy-client-dist.mjs`（与 npm 发布链路同一脚本），并在 deploy 后**断言** `client-dist/index.html` 存在，防止再发出坏包。
- **Windows 打包失败（v0.0.40 实测两轮）**：`pack.mjs` 用 `execFileSync("pnpm", …)` 在 Windows 上拿到的是 `.cmd` 包装脚本 → `spawnSync pnpm ENOENT`；改用 `pnpm.cmd` 又撞上 Node 20+ 对 `.bat`/`.cmd` 的直接 spawn 禁令 → `spawnSync pnpm.cmd EINVAL`。正解 = `shell: true`（仅 Windows 开，官方解法 nodejs/node#52681）。另补 `win.executableName: ai-editor`（与 linux 同因：scope 包名会推导出含 `@` 的非法可执行名）。
- **补包入口**：`.github/workflows/desktop.yml` 增 `workflow_dispatch`（输入 `release_tag`）——在某平台打包失败时从修复后的 ref 重新产包并挂到同一 Release，避免重推 tag（会把 tag 指向改到修复后的 commit）。
- **pnpm 版本在 CI 与本地漂移**：`.github/workflows/publish.yml` 原本硬编码 `version: 11.22.0`（升级 pnpm 12.4.2 后本地与 CI 会用不同版本跑同一份 lockfile）；现改为不写 `version`，从根 `package.json` 的 `packageManager` 读（单一事实源）。
- **server bin 自检在 Electron 主进程下崩溃**：`realpathSync(process.argv[1])` 在 Electron 里拿到的是命令行开关（如 `--no-sandbox`）而非脚本路径 → 抛 `ENOENT` 打挂整个主进程。现包一层 try/catch，路径不可解析即判「非直接执行」（npm bin 的符号链接语义不变，server 575 测试全绿）。

## [v0.0.39] - 2026-09-15

> **UX/UI 样式优化批（9 张卡 + 3 张收口 commit）**：卡 0 文档口径先行（`e7dd82f`）→ 卡 2b 层级契约收紧（`9694e5c`）→ 卡 1 大纲缩进列对齐（`eec69d6`）→ 卡 2a 页头「+ 新建卷」（`8b9a5a8`）→ 卡 3 大纲行级新建（`0f7dfc6`）→ 卡 4 设定行级新建（`32a1f19`）→ 卡 5 关联页端点徽标中文（`56de716`）→ 卡 6 只读面板空值（`a15d249`）→ 卡 7 阅读进度徽标（`8b65fe7`）；随后按**独立 oracle 复核**收口三张：注释口径/backlog/清卡/本段（`7f61d68`）、补三处守卫（`1db7b1f`）、用户可见文案不再暴露内部枚举键（`fe9144d`）。每卡一 commit，oracle 代码级复核（PASS 11/PARTIAL 1/FAIL-注释残留 1 → 均已收口）+ 浏览器逐行量测（19 行大纲 / 45 行关联 / 37 行设定）；回归：`pnpm -r build` → typecheck（0 error）→ lint → `pnpm -r test` 全绿（shared 222 / db 281 / client 859 / tools 287 / agent 82 / server 575），`designmd lint docs/ui/DESIGN.md` errors 0（warnings 5 = 预期 orphaned-tokens）。

### Added

- **大纲页行级「新建章 / 新建场」与设定页行级「新建子设定」按钮**：行尾 `icon-button`（`PlusOutlined`），位置 = **删除按钮左侧**（删除恒贴行尾）；点击 = 在该行子级末尾打开就地输入行（与「选中后 Enter 建子级」同一路径 `startCreate`，成功后新条目选中 + 聚焦）。**无合法子层级的行不渲染该按钮**（场是叶子）。`docs/ui/DESIGN.md` `data-row` 段登记（行级新建位置规则 + 缩进列对齐规则）。
- **层级契约：章只能挂卷（root 仅接纳卷）**：`db.assertCanHold` 单点收紧（创建与移动共用）→ tools 提案层与 LLM 可见工具描述同步（`propose_outline_node` 缺省挂根、`propose_move_node` 的 `parent_id:"root"` 均只对 volume 合法）→ client `parentOptionsForType("chapter")` 不再含 root（拖到顶层空白区对章行按「非法落点无反馈」拒绝）。**存量根级章读容忍**：能渲染/改名/删除/拖进卷，但不能新建、不能移回 root，**无数据迁移**。文档同步 `docs/design/10-data-model.md` §2、`docs/api/60-api-outline.md`、`docs/db/schema.md`。
- client 单测：端点类型徽标文案覆盖全部实体类型 + 大纲节点的守卫（`relations-view.test.ts`）；只读面板空值叶子不渲染占位符的 SSR 断言（`character-detail.test.tsx`）。

### Changed

- **大纲页页头主操作改为「+ 新建卷」，就地新建行取消卷/章切换**：原先点「卷/章」按钮会先让输入框失焦 → `onBlur` 取消整行（切换按钮随行卸载，表现为「点一下就关」）；现固定 `TypeChip 卷` + 与树行同列的占位，新建行看上去就是即将插入的那行卷。层级收紧后顶层只剩卷可建（章一律建在卷下）。
- **大纲页缩进列对齐修正**：无子节点行的占位从 `w-7`（28px）改为与折叠箭头同几何的 `-ml-2 w-6`（antd icon-only small 按钮 = `controlHeightSM` 24px）——原先「有场章 / 无场章」两类行的类型徽标、标题、摘要第二行、就地新建行各差 12px。
- **阅读进度徽标统一走 `TypeChip`**（大纲行 + 节点详情页）：原是无边框灰面自绘 span（chip 的第二套实现），与同行的卷/章/场徽标不同形；现共用 `border-type-badge-border` + `bg-accent` 一对 token（`DESIGN.md` `type-badge` 准入登记「中性命中标记」也走该组件）。
- **人物页「阅读进度」tab 的能力面板空值叶子不再给占位符**：与可编辑形态「空值 = 空输入框」同口径；字段网格的只读值仍用 `—`（两条口径的差异在 `DESIGN.md` 分别登记）。

### Fixed

- **关联页端点类型徽标漏英文**：`relations-view.tsx` 的 `ENDPOINT_TYPE_LABEL` 原是手抄的四类表（character/setting/location/hook + outline_node），`timepoint`/`event`/`reference` 在源/目标列与端点类型过滤下拉直接显示原始串（「timepoint」「event」）。改为派生 shared `ENTITY_TYPE_LABELS` + 补 `outline_node`。
- **用户可见文案不再暴露内部枚举键**（同型问题的其余两处，oracle 复核发现）：时间轴事件详情的小节标题「关联节点（occurs_in）」→ 取 shared 关系类型中文名（「锚定于」）；伏笔页五个分区块标题去掉括号里的关系键（埋点节点/推进节点/回收节点/依赖/涉及）与生命周期预览里的 `+ advances 关系` / `+ resolves 关系`。全 client 重扫描「中文文案 + 内部枚举键混排」= clean。

### 有意保留（本批）

- 就地新建行仍「失焦即取消」（全站既有语义，与行内编辑的「失焦保存」成对）；卷/章切换按钮删除后，行内已无可误触该路径的元素。
- 大纲/设定/PanelTree 三处自绘缩进行**不迁移 antd `Tree`**：完整成本收益评估与触发条件见 `docs/design/backlog.md`「有意保留」。

## [v0.0.38] - 2026-09-15

> **云端存档（WebDAV）整批落地**：7 张卡 + 3 张补丁卡，每张都经独立 oracle 验证——备份命名升级（设备段 + 尾部三段统计）→ 云端基础层（`cloud.json` + WebDAV 最小客户端）→ 设置页云端面板 → 推送 → 拉取与三态 → 一键「同步云端」与冲突裁决 → 自动推送；随后按真机（坚果云）反馈收口：命名唯一化（`13f1d2b`）、旧包上传诚实化（`e43869e`）、错误诊断与幂等修复（`5005287`/`cbced2f`/`2cf9ac4`）、地址语义改为云盘根（`cb82bb6`）、同步状态三行重排（`0181a0d`）。
>
> **本地仍是唯一事实源**：云端只是备份的另一块磁盘（离线可用优先，云端失败不阻塞本地功能）；凭据只落 `<创作根>/.ai-editor/cloud.json`（0600，不进项目文件/备份包/任何响应）。设计与契约见 `docs/design/40-cloud-sync.md` 与 `docs/api/100-api-cloud.md`；**真实坚果云人工验收清单**（认证/配额/跨时区无法在 CI 覆盖）见 `docs/design/backlog.md`。

### Added

- **备份文件名新增「来源设备」与「规模统计」两段**：`<YYYYMMDD-HHmmssSSS>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip`（例：`20260813-101530123-手动-苹果本-定稿-人物32-设定58-章120.zip`）。设备段 = 来源机器（缺省 = 简化 hostname：去域名后缀、`-` 与非法字符转 `_`、**剥首尾空白与 `_`**、截 16 字符；规则禁 `-`，故设备段与标签段的边界无歧义；派生结果恒通过 `sanitizeDeviceName`）；统计三项 = 生成该备份时点的**未软删**存量（人物 / 设定 / `outline.json` 未软删 `chapter`，不含回收站），由服务端在打包前统计并写入文件名——**重命名旧备份不会重算统计**（统计必须描述该备份的内容）。
- **备份列表新增一行元信息**：设置页备份行与「加载备份」确认框显示 `设备 · 人物32 · 设定58 · 章120`（旧格式备份无这两项 → 整行省略，不用占位符）。
- shared：`MAX_DEVICE_NAME_LENGTH`、`BackupStats`、`sanitizeDeviceName`、`deviceNameFromHostname`（纯函数）；db：`getBackupStats`（实体计数走单条 COUNT、未软删口径）。
- **云端存档账号配置与连通性测试（卡 2）**：`GET /api/v1/cloud/status`（配置段）/ `PUT /api/v1/cloud/config` / `POST /api/v1/cloud/test`（`PROPFIND` 根 → 缺则 `MKCOL` → 写临时文件再删，验证**读 + 写**权限）。配置载体 = `<创作根>/.ai-editor/cloud.json`（**明文 + 权限 0600**，含在既有更宽权限文件上重写；合并写、未知键与 `books` 段原样保留）；**任何响应都不回传 password**（不是脱敏，而是根本不回传）；URL 内嵌用户名/密码（userinfo）直接 400 拒绝（不静默剥离）；**凭据三件套要么齐、要么全无**——清空 url + username 时 password 一并丢弃（避免磁盘留下已失效的密码）。设置页 UI 在卡 3。
- **WebDAV 最小客户端**（`PROPFIND`/`MKCOL`/`PUT`/`DELETE` + 窄 XML 解析 + Basic 认证 + 30s 超时；出站走全局 dispatcher，不引 SDK/XML 依赖；列表结果剥掉 base 路径前缀 → `path` 恒为 base 相对，且自身条目（含根）一律剔除）与四个云错误码：`CLOUD_NOT_CONFIGURED` 409、`CLOUD_AUTH_FAILED` 502、`CLOUD_UNREACHABLE` 502、`CLOUD_QUOTA_EXCEEDED` 502（`CLOUD_CONFLICT`/`CLOUD_FILE_NOT_FOUND`/`CLOUD_BACKUP_TOO_LARGE` 已随后续卡片落地，见卡 4/卡 5 条目）。
- **设置页「备份」改为三级导航 + 新增「云端备份」面板（卡 3）**：左 160px 固定两项（自动备份 / 云端备份，与「AI 模型」同款 `sub-nav` 契约）；自动备份面板内容原样搬入；云端备份面板 = 账号配置（WebDAV 地址 / 用户名 / 应用密码（掩码，留空 = 不修改）/ 设备名（预填当前生效值）四个输入 + 测试连接 + 保存）+ 自动推送开关（选择即保存）+ 明文 0600 与「免费云盘上传流量 1GB/月」提示。表单→请求语义收敛在 `lib/cloud-config.ts` 纯函数（密码留空不提交、**凭据不全不提交密码**、地址与用户名半填时行内提示）。
- **`/cloud/test` 不可达提示带上底层错误码**：undici 顶层错误常是笼统的 `fetch failed`，现附 `cause.code`（`ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`…），「测试连接」失败时能看出是端口、域名还是超时。**已知边界**（卡 5 oracle 复核）：底层抛 `AggregateError`（多地址轮询全部失败）时 `cause.code` 为 undefined，文案退回 `fetch failed`——待补（`backlog.md`）。
- **云端推送（卡 4）**：`POST /api/v1/cloud/push`（推送一份本地备份到云盘；`GET /cloud/status` 增 `remote` 段 = 云端书目录 + 备份列表）。要点：
  **上传 = 本地备份文件逐字节拷贝**；`PUT` 到 `.tmp-<名>` 再 `MOVE` 成正式名（正式名下永远是完整包，中断只留 `.tmp-` 垃圾，推送前清理）；
  **冲突判定 = 云端 head ≠ 本机 `lastPushedFileName`** → 409 `CLOUD_CONFLICT`（`force` 时先把云端那份下载存进本地 `.backups/` 再覆盖，两边都留档）；
  **保留最近 5 份**（只删能解析出时间戳且**不带用户标签**的份，非本程序命名的文件一律不碰，清理失败不阻塞推送）；
  云端书目录按 `project.id` 定位（`cloud.json` 缓存 `dirName` 快路径 → 失效时扫根目录按 `-<id>` 后缀重新定位）；
  推送前本地体积检查（>500MB → 400 `CLOUD_BACKUP_TOO_LARGE`）。书名改名时云端目录跟随 `MOVE`（失败不阻塞本地改名，下次同步按 id 重新定位）。
  设置页「备份 → 云端备份」增「同步状态」段（云端最新份 / 本机最新份 / 推送按钮 / 冲突时行内「用本机覆盖云端」）。
- **云端拉取（卡 5）**：`POST /api/v1/cloud/pull`（缺省拉云端 head；也可指定云端任一份）+ `GET /cloud/status` 补齐 `local` 段与三态 `state`。要点：
  **拉取 = 三文件覆盖 + `references/` 与 `sessions/` 并集合并**（基线三方比较、删除优先：云端删的删本机、本机删的不复活、本机新增的保留、云端新增的写入）——与本地 restore 的整体覆盖语义**刻意不同**（restore 是「回到那个时间点」，拉取是「把那边的东西拿过来」）；覆盖前仍自动快照本机状态（后悔药）。
  **三态判定改用「云端文件集合」基准**：`云端有更新` = 云端文件集合 ≠ `lastSeenCloudFiles`（原先比较 head，跨机器时钟偏差会漏报）；`本机有改动` = 创作数据 mtime 晚于 `lastSyncAt`（**不含 `.backups/`**）。拉取后 `lastPushedFileName` = 拉到的这份（拉完立刻推送不误判冲突）。
  设置页「云端备份」面板补齐：三态状态行 + 本机已推份/上次同步时间/未同步标记 + 云端份列表（≤5 行、行内可拉取任一份）+「拉取云端最新」+ `cloud-pull-confirm` 确认框；拉取成功后刷新 config/outline/会话。
- **卡 3 收尾修补**：云端配置表单「纯空白密码」= 留空（不提交，避免存下空白密码导致 configured 却永远认证 401；非空密码提交原值、不 trim）；切「自动推送」开关不再清掉未保存的表单草稿；半填凭据的行内提示补「当前不会提交密码」；`DESIGN.md` 同步（设备名预填生效值 + 代价登记、两面板各自 caption、同步状态段标卡 4/5）、`tasks.md` 卡 3 交付物改述（页内 state，store 上提留卡 6）。
- **设备名可配置**：`cloud.json` 的 `webdav.device` 优先生效（非法值不生效、回缺省），备份文件名的设备段随设置页改写而变化（之前固定为 hostname 派生）。

- **一键「同步云端」与冲突裁决（卡 6）**：左栏底部新增第二项「同步云端」（四入口固定顺序：立即备份 / 同步云端 / 设置 / 主题）+ 状态角标；**状态与动作上提到 `stores/cloud.ts`**（左栏按钮与设置页云端面板共享同一份 `status`——否则会出现「角标说冲突、面板说已同步」）。要点：
  **一键状态机**（点一次 = 先实时复查状态再分派）：未配置 → 跳设置页并选中「备份 → 云端备份」（跨页意图经 store 下传，二级 tab 选中态仍不进 URL）；未打开项目 → 禁用；已同步 → toast「已是最新」；有未推改动 → 直接推送；云端更新 → 弹拉取确认；冲突 → 弹裁决框；不可达 → 只 toast（含 `errorCode`，强调本地功能不受影响）。
  **角标两色**：`冲突` = error、`有未推改动`/`云端有更新` = warning（「有事可做」而非「出错」），`unreachable` 与其余状态**不亮**；`/status` 只在「打开项目 / 点击按钮 / 动作之后」跑，**无定时器**（每次 2–3 次 PROPFIND，免费云盘额度 600 次/30 分钟）。
  **`cloud-conflict-dialog`**：并排对比云端那份与本机最新份（时间/类型/标签/设备/统计/大小）+ 两个等权选项（`保留云端（拉取覆盖本机）` / `用本机覆盖云端`）——两条路都会把另一边留档成一份本地备份（文件名就地回显）；本机无备份时强推禁用，强推后若云端仍有更晚的他机份可**再次强推**。
  **`cloud-pull-confirm` 与裁决框都是单点宿主**（挂 `AppShell`）：面板行内「拉取」与左栏按钮共用同一个对话框实例，左栏收起时也弹得出来；面板的推送冲突分支不再有行内「用本机覆盖云端」入口。
  表单草稿（url/用户名/密码/设备名）仍留面板页内，不进 store。
- **删除传播提示（卡 6 前置债务 9 / DESIGN.md §550）**：删除会话与参考资料成功后的 toast 补一句「推送到云端后，另一台也会同步删除」——本地删除不会被拉取复活（并集规则 4），但要让云端与另一台也删掉，必须**推送一次**（手动或等自动推送）。
- **自动推送（卡 7）**：`autoPush` 开启后本地改动自动上云，**三条触发路径**（`packages/server/src/cloud/auto-push.ts`）：
  **定时**（每 2 小时 + 只在**创作数据**有变更时推一次；创作数据 = 三文件 + `AGENTS.md` + `references/`，**排除 `sessions/`**——纯聊天时段不单独烧一次配额，聊天记录随下一次创作变更的 zip 一起上云）、
  **关闭项目**（「工作段结束」语义：任何变更含 `sessions/` 就推一次，**不受节流**）、
  **手动备份成功后**（无条件推一次，不受节流）——后两条都不推进节流基准。
  **单一定时器**：不新增第二套定时器，自动推送挂在自动备份的 `setTimeout` tick 链上（`backup.ts` 的 `setProjectTick` 钩子由 composition 层注册）——排程条件 = 「备份频率开启」**或**「`autoPush` 开启」；备份频率关闭时按 `AUTO_PUSH_THROTTLE_MS`（2h）兜底排程，**不会因关掉自动备份而静默失效**。
  **失败只记状态不阻塞**：`cloud.json` book state 新增 `lastAutoPushAt`（节流基准，仅定时路径推进）与 `lastAutoPushError`（`{code, message, at}`，成功即清），由 `GET /cloud/status` 的 `local` 段透出；`POST /project/close` 与 `POST /project/backup` 均**fire-and-forget**（推送失败不影响响应，关闭项目不被网络拖住）。本机没有任何备份 → 视为**跳过**（不写错误标记）。设置页云端面板：自动推送说明行写全触发口径，失败时在「同步状态」段显示一行 `text-destructive`（不弹窗）。

- **卡 7 oracle 收口**：`lastAutoPushError` 的清除点单点化到 `pushBackup` 的成功写（任何一次推送成功都清，避免手动推送后面板常驻过期提示）；面板失败行在 `CLOUD_CONFLICT` 时补行动指引；「备份频率关闭 + `autoPush` 开启时推的是旧包」等三条已登记 `backlog.md`。
- **卡 6 oracle 收口**：删除会话 / 参考资料后的 toast 补「推送到云端后，另一台也会同步删除」（删除要推送才传播）；跨页意图补顶层 tab 消费（未配置点「同步云端」落到「备份 → 云端备份」而不是 AI 模型页）。

- **旧包上传诚实化：职责分离 + 用户二选一（卡 B）**：**云端永不创建备份**（云端只是本地 zip 的镜像），自动路径（2h 定时 / 关闭项目）在「**有改动未进最新备份**」时**跳过不推**——不推旧包、也不写 `lastAutoPushError`（这不是失败，是还没有能代表当下的档）；`GET /cloud/status` 的 `local` 段新增 `backupStale`（**不随同步前移**：推过旧包后 `state` 会变 `synced` 而它仍为真，用它把「已同步」与「云端内容不落后」分开表达）。用户主动点「同步云端」在该状态下弹 `cloud-stale-backup-dialog`：`[立即手动备份并推送]`（先 `POST /project/backup` 再推）/ `[上传旧备份]`（照推当前最新那份），两个选项等权；面板状态行同时给一行提示「本机有改动未进最新备份（最新备份：…）——云端只会上传旧份，先『立即备份』」。**为什么**：推旧包会把 `lastSyncAt` 前移到 now → 状态显示「已同步」而云端落后，另一台拉下去会覆盖它自己更新的三文件（有覆盖前快照兜底，但用户看到「内容缩水」）。
- **顺带收口**（卡 6 复核遗留）：`clearStatus()` 现在一并清 `conflictOpen`/`pullTarget`/`staleDialogOpen`/`pendingSettingsPane`（切书后不再残留对话框状态）。

- **云端收口·代码类（卡 C）**：7 项行为/逻辑收口——
  ① `refresh()` 的 `busy` **归属明确**（只清自己设的那个，不再可能清掉 `push`/`pull` 在途标记）；
  ② 冲突裁决框「保留云端（拉取覆盖本机）」**显式拉取框里展示的那一份**（不再写「服务端当下 head」——对话框与点击之间云端可能又多了新份）；
  ③ **本机份列表读取失败与「真的没有备份」区分**（新 `localLatestUnavailable`：读取失败时两个对话框禁用依赖它的按钮并说明原因，不把故障显示成「本机还没有备份」）；
  ④ 旧包确认框在「本机无备份」时**禁用「上传旧备份」**（服务端会 404）并提示先「立即备份」；
  ⑤ 不可达文案**带上底层错误码**：`cause.code` 之外，undici 多地址聚合失败时取 `cause.errors[].code`（去重合并展示）——不再退化成无信息量的 `fetch failed`；
  ⑥ `/cloud/test` 遇**可写不可删**的云盘（DELETE 403/405…）**不再误报 `CLOUD_AUTH_FAILED`**：读 + 写都通过即成功，响应带 `leftoverWriteTestFile: true`，UI toast 提示「云盘不允许删除，根目录残留 `.tmp-` 测试文件，可手动删除」（具体状态码只进日志）；
  ⑦ 云端状态的「打开项目时那次检查」宿主从 `NavRail` **上移到 `AppShell`**（左栏收起时 NavRail 不挂载，原先收起状态下无人复查——自动推送会改服务端状态，收起左栏同样需要它；实测：收起左栏刷新后再展开，角标已在，无需点击）。

- **云端收口·文案类（卡 D）**：① 失败文案去掉「未执行」这类**事实断言**（网络超时可能服务端**已执行**）——推送/拉取改为「结果未确认（可能已在服务端执行）」、备份改「备份结果未确认」、配置保存改「配置是否保存未确认」、测试连接改「测试未完成」；
  ② WebDAV 地址校验的两条错路**不再回显用户原始输入**（原先 `ftp://用户名:密码@host` 这类串会被拼进 400 message）——只回显协议段或给固定文案 + 示例；新增守卫测试（三类非法输入都断言不回显、且协议段可见）；
  ③ `shared/src/types/api.ts` 的 cloud 契约注释补齐两条已有口径：「凭据三件套要么齐、要么全无（url+username 皆空 ⇒ password 一并丢弃）」「URL 内嵌 userinfo 直接 400 拒绝（不静默剥离）」；
  ④ `DESIGN.md` §544 失败态口径已按实现改写（**一行文案、刻意不做独立「重试」按钮与 `empty-state`**，重试入口冗余），删除与代码不一致的承诺。

- **设备名不再被「无意的保存」钉住**（2026-09 收口）：`GET /cloud/status` 新增 `deviceConfigured`（用户**是否显式设过**设备名），设置页只在**设过**时预填该值——没设过则输入框留空、说明行写「留空 = 用本机名 <生效值>」。原先面板预填的是**生效值**（没设过时即 hostname 派生值），于是「没碰设备名、只点保存」（例如只改 URL/密码）就会把当时的派生值显式写进 `cloud.json`，从此不再跟随 hostname——这个坑现在没有了；清空设备名保存仍回到 hostname 派生（删掉配置值）。
- **应用密码保存后不再显示成「空框」**（2026-09 反馈）：密码**从不回传**（安全），输入框恒为空——现在占位符按状态变化（未保存过「应用密码」/ 已保存「应用密码已保存（留空则不修改）」），并在下方补一行说明「接口从不回传密码，所以这里不回显；要改就直接输入新密码，留空 = 保持不变」。原先固定写「留空则不修改」，用户保存完仍看到空框会以为没存上。
- **修：云盘目录创建失败时的错误错位 + `MKCOL` 形态**（用户实测坚果云反馈）：现象是「测试连接」报 `云盘返回 HTTP 404（上传 .tmp-ai-editor-writetest）：ObjectNotFound`——真实原因是**根目录没被创建成功**（`MKCOL` 带尾斜杠时坚果云回 405「已存在」却不创建），而错误一路错位到后面的 `PUT`，看上去像写权限问题。修法：① `MKCOL` **不带尾斜杠**（RFC 4918 §9.3.1 示例形态）；② `/cloud/test` 在「列不出来 → MKCOL」之后**复核一次**，仍不存在则报「云盘目录不存在且创建失败：<地址>（确认地址指向你的 WebDAV 根目录，坚果云为 `https://dav.jianguoyun.com/dav`）」。
- **修：`PROPFIND` 的空 multistatus 被误判成「目录已存在」（坚果云实测第二次报错）**：坚果云对**不存在**的集合回 `207` + 空 body（不是 `404`），我们原先按「条目数 0 = 存在但空目录」处理 ⇒ 跳过 `MKCOL` ⇒ `PUT` 才报 `404 ObjectNotFound`（看着像写权限问题，实际是目录压根没建）。修法：`list()` 先看**原始**条目数——`0` ⇒ 不存在（返回 `null`，调用方会去 `MKCOL`）；`≥1` ⇒ 存在（「存在但空目录」也至少含集合自身一个条目，过滤自身后得 `[]`）。**同时把请求的完整 URL 写进报错文案**（`列目录/创建目录/上传/下载/删除` 五处），下次出错一看就知道路径对不对。
- **坚果云真机暴露的三个问题**（用户实测）：
  ① **根目录不可写文件**：坚果云允许在 `/dav/` 下建目录，但直接 PUT 文件到根会 `404 ObjectNotFound` ⇒ `/cloud/test` 的写探针改为**先建工作子目录**（`.tmp-ai-editor-writetest-dir/`）再写文件，成功路径连子目录一起清掉；建不出子目录才退回根目录写法。
  ② **单段名字长度限制**：MKCOL 书目录被拒（`400 IllegalArgument / sandbox name is too long`，坚果云对单段名字的限制远严于文档里的 255 字符路径上限）⇒ 建目录改为**候选链**：`<书名>-<id>` → `ai-editor-<id>` → **`<id>`**，任一步成功即采用并写入 `dirName`；回退扫描同步放宽为 `name === id || name.endsWith('-'+id)`。为此 `HttpError` 新增 `upstreamStatus`（保留云盘原始状态码——对外仍是映射后的 502，但调用方据此区分「名字被拒」与「网络/认证问题」）。
  ③ **长错误在 toast 里显示不全**：错误文案可能带上游 XML 片段（数百字符）⇒ toast 只给**摘要**（约 80 字符 + 「…（详见下方状态行）」），**完整文案落在面板行内**（`break-all` 可换行）；测试连接失败也新增面板行。
- **修：`/cloud/test` 的探针目录留在云盘上（用户实测坚果云）**：集合删除必须用**尾斜杠 + `Depth: infinity`**（RFC 4918 §9.6.1），原先用文件式 `DELETE`，坚果云不认 ⇒ 每次「测试连接」都留下一个空目录 `.tmp-ai-editor-writetest-dir`。现在：客户端新增 `removeDir`（两种形态依次尝试），探针目录改用它，并在每次测试**开始时先清上一次的残留**（失败只记日志，空目录无害）。另外面板补一句「地址建议指向专属子目录」（否则每本书的目录会直接建在云盘根下）。
- **修：重复推送同一份备份被坚果云拒（用户真机 409 `DuplicateName`）**：`PUT .tmp-<名>` → `MOVE` 成正式名时，若正式名已存在，坚果云**即使带 `Overwrite: T` 仍回 409**（用户连点/自动推送重试的常见路径）。修法：① 推送前发现**已存在同名同大小的份 → 跳过上传**（省配额；顺带把「重推」做成真正的幂等）；② `MOVE` 收到 `409/412` 时**先删目标再重试一次**（目标就是被覆盖的那一份）。
- **修：拉取/恢复后误报「有改动未进最新备份」**（用户真机）：覆盖前快照的时间戳早于覆盖写入的文件 ⇒ 只看 mtime 会永远为真。`local.backupStale` 现在与 `local.dirty` **合取**（`同步状态` 提示行只在「确有未同步改动且未进备份」时出现）；**自动推送的守卫仍用纯 `hasUnbackedChanges`**（更严格，避免把旧内容推上云），两者口径不同是有意的。
- **地址语义改为「用户云盘根」，工作根 `<云盘根>/ai-editor/` 由应用自动拼接**（用户要求「把拼接收敛到云端对接侧」）：`cloud.json` 与设置页都只表达用户云盘根（如 `https://dav.jianguoyun.com/dav`），实际读写一律发生在 `<云盘根>/ai-editor/<书名>-<id>/…`。**没有「截断再拼回」的迁移分支**——无论前端传什么，客户端层统一追加一段 `ai-editor`（唯一实现点 `createWebdavClient`）。地址还不存在时由新增的 `ensureWorkingRoot()`（幂等建「云盘根 + 工作根」）自愈；`/cloud/test` 的 `baseUrl` 回显配置值、`created` 指工作根。面板文案与占位符同步（填云盘根即可，不再让用户填子目录）。
- **「同步状态」区块按反馈重排（C 项）**：三行改成**同字段同顺序**（`时间 · 类型[ · 标签] · 设备 · 人物N · 设定N · 章N · 大小`，缺项不省略）——`云端最新份` / `本机最新份` / `上次同步`（时间 + 该次同步的备份名）可逐项对齐；**`云端最新份` 行尾新增相对判定徽标** `云端更新` / `本机更新` / `相同`（按 `createdAt` 比，任一侧缺失不显示），不用再自己比时间；原先「本机已推份」自成一套格式（只给文件名）的问题消失；本机份列表读取失败时显示「（读取失败——见下方提示）」而非「无可用备份」。
### Changed

- **类型段由单字母 `m`/`a` 改为 `自动`/`手动`**（`20260813-101530123-m-定稿.zip` → `20260813-101530123-手动-苹果本-定稿-人物32-设定58-章120.zip`）；当时旧文件名仍可列出/恢复/参与保留策略（不迁移、不改名），重命名旧备份保持其旧形态（**该兼容层已在下方「备份命名唯一化」中砍掉**）。
- **自动备份的变更判定新增两个打包目录自身的 mtime**：删除 `references/` / `sessions/` 内文件不刷新任何剩余文件的 mtime，原先只比文件 mtime 会漏检删除 → 删文件现在同样触发自动备份。
- 备份列表与备份响应新增 `device` / `stats` 可选字段（旧格式文件名无这两项，读侧缺省）。
- **备份命名唯一化（卡 A，写入 = 解析）**：命名只有一种形态——`<时间戳>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip`；早期三类旧命名（秒级 `<YYYYMMDD-HHmmss>.zip`、带名称无类型段 `<YYYYMMDD-HHmmssSSS>-<名称>.zip`、单字母 `-m`/`-a` 段）**不再解析**——文件留在磁盘但不识别（不出现在列表、不可恢复、不参与保留策略），也不做重命名迁移（旧份没有设备/统计信息，硬补会谎报）。**打开项目时若 `.backups/` 有文件但无一可解析 → 立即生成一份新格式备份**（升级兜底，best-effort，不重复备份、不重命名旧份）；自动备份频率开启时下一次 tick 也会补一份。API 契约收敛：`device` / `stats` 由可选变**必填**（本地 `BackupEntry` 与云端 `CloudBackupEntry` 同步），client 删除「旧格式未记录 / 整行省略」死分支。

### Docs

- `docs/design/40-cloud-sync.md`（§3 新增「客户端接入」小节：单一状态源、查状态触发点、角标语义、一键状态机分派表）、`docs/ui/DESIGN.md`（§538 角标两色口径与跨页意图、§544/§548 对话框单点宿主与本机无备份的禁用口径）、`docs/api/20-api-backup.md`（命名格式 + 「设备与统计」口径 + 变更检测 + 与云端的关系 + 重命名旧格式的形态规则）、`docs/db/schema.md`（`.backups/` 命名）、`docs/design/10-data-model.md` §11、`docs/ui/DESIGN.md`（§备份与云端存档）。

## [v0.0.37] - 2026-09-14

> **UI 收口 + 发布前扫尘**：关联总览列对齐统一、大纲行尾徽标不再推移删除按钮、人物页进度节点下拉可搜索；**人物关系星形图整体移除**（分组列表已是关系网的完整明细，图的索引价值不足以抵一张 SVG）；**徽标配色收口**（tint 只给用户标签并收到 3 档；类型/分类徽标改描边式；人物页角色定位橙色）；修掉概览页阅读进度卡在原始 id 的 effect 依赖漏项；发布前审计扫掉一批文档/注释与冗余清单（含 `server` 的 pi 依赖声明错位）。

### Added

- 人物页「阅读进度」tab 的进度节点下拉支持搜索：`showSearch` + `optionFilterProp="label"`（antd `Select` 无 `optionFilterProp` 时按 `value` 过滤，而本选择器 value = 节点 id，不显式指定则搜标题搜不到）。

### Changed

- **徽标两形态定稿（视觉变更）**：着色实现原本是「按文案 hash 取模 + 无准入规则」，导致同一类枚举类型在各页各行其是（大纲/回收站/关联有色、人物页字段无色），且 hash 撞色使其不承载语义（原 6 档实测「设定 / 场 / 参考资料」同色、「事件 / 时间点」同色）。本次定稿为两个组件名 = 一条准入规则：
  - **用户标签 chip（`TagChip`）**：**只给 `data.tags` 元素**（设定 / 事件 / 参考资料标签）。tint **3 档**：`#cce9fc` sky / `#d1e2c4` sage / `#ffd800` yellow（`hash % 3`，同名恒同色）；浅色底 + 墨字（底 vs 白画布 1.26–1.39、墨字 8.80–9.71），深色 = 同色相 20% 不透明度叠深色面板 + 81% 白字（5.96–6.18，零新增深色值）。三档**只靠色相区分**（H203 / H94 / H51，明度同档）。
  - **类型/分类徽标（`TypeChip`）**：`{colors.surface-muted}` 底 + **1px `#d94a4a` 描边** + 随主题翻转的墨字（浅 10.59:1 / 深 8.96:1；边框两态同值，对底 3.61 / 3.34:1）。覆盖：大纲卷/章/场（列表行·就地新建行·详情元信息行）、实体类型与节点类型（回收站）、关联端点类型（源/目标）与关系类型、伏笔 `category`（列表行 + 详情）、实体详情页「其他关联」关系类型、人物页关系类型 / 「双向」。同语义的旧内联灰 span 一并统一（原本底色是未 seed 的 `colorFillAlter`，浅色仅 2% 黑 ≈ `#fafafa`）。
  - **人物页左栏「角色定位」**：橙字（浅 `#b4551f` 4.93:1 / 深 `#ef8354` 6.24:1——原橙作文字压白底只有 2.61:1，12px 小字不可用）。
  - **为什么是描边而不是实底**（实测结论）：实底彩色要么压不住读（橙 `#ef8354` 上墨字 4.70:1 偏紧、白字 2.61:1 不可用），要么让高频的行首/类型列每行都摆一块告警色；且**彩色边框压在灰底上需 ≥3:1 才看得见**（橙 1.43、浅红 `#ffb3b3` 1.07 ——1px 线宽下等于没画）⇒ 描边取 `#d94a4a`；**浅色系只能当面积，不能当线**。
  - **注意**：档数变化（6 → 5 → 3）伴随 `hash % N` 变化，**既有标签会重排换色**（同名仍恒同色）；描边式徽标比实底高/宽 2px（1px 边框）。
  - **已知代价**：徽标边框与语义 `error`（`#e03131`）同色相（描边比实底轻、位置固定在行首/类型列，已登记）。
- 关联总览列表（`relations-view`）：关系类型列由**居中改左对齐**——与源/目标列、表头同口径（居中会让类型 chip 相对表头位移，看起来像列错位）。
- 大纲行尾「阅读进度」徽标改排在删除按钮**左侧**：删除按钮恒贴行尾，不再被徽标往左推（跨行操作列对齐）。
- **客户端伏笔标记类型不再手抄**：`lib/outline-hooks.ts` 的 `HOOK_MARK_TYPES` / `HOOK_MARK_TYPE_ORDER` 改为派生自 shared `HOOK_RELATION_TYPES`（原先两遍手写字面量 `["plants","advances","resolves"]`，违反「关系类型清单单一来源」规则）。

### Removed

- **人物关系星形图（`relation-star-graph` 组件 + `lib/relation-star` 几何/判据模块及其单测）整体删除**：关系网 tab 只保留按 `relationType` 分组的关系列表；`CharacterRelationsView` 的 `selfName` prop 随之移除。

### Fixed

- **`server` 的 pi 依赖声明错位**：`@earendil-works/pi-ai` / `pi-coding-agent` 是 `server/src` 的**运行时 import**（`model-runtime.ts`、`routes/settings.ts`）却声明在 `devDependencies`——靠 `agent` 包的传递依赖 hoist 才跑得起来（pnpm 严格布局下安装态会 `ERR_MODULE_NOT_FOUND`）。修法：两包移入 `dependencies`（版本不变）。
- **概览页「阅读进度」长期停在原始 entity id**（连带「大纲概览」永远骨架、「创作要素」永远 `–`）：`Dashboard` 的两个概览态 effect（大纲补拉 / 要素统计）依赖数组**漏了 `mode`**，而 `#/` → `#/overview`（`useEnterLastBook` 自动进书）是**同实例改 prop、不重挂载** ⇒ 依赖值全没变，effect 不再执行，`loadOutline()` 永不调用；进度节点只剩 `findOutlineNodeTitle` 回退的 id 原文，要等用户点「刷新数据」或进大纲/人物/时间轴等别处加载 outline 才恢复可读标题。修法：两处依赖补 `mode`（`:206` / `:236`；会话 effect `:246` 本就带 `mode`，故只有这两个区块卡住）。

### Docs

- `docs/ui/DESIGN.md`：§Colors 重写「标签色」（tint 三色 + 色相分布事实 + 深色叠色策略与实测对比度 + `type-badge-border` 两态同值 + `Character Role` 两态值）；§Components 把 `tag` / `type-badge` 拆成两个规格并登记**准入规则**（tint 只给 `data.tags`），`type-badge` 定稿为**描边式**并记录「彩色边框压在灰底上要 ≥3:1、浅色系只能做面积不能做线、边框色与 error 同色相的已知代价」；`status-badge` 去掉「或 tint 底色」授权（状态属枚举）；`character-rail` 行描述同步；Do's 增「不给枚举类型上彩色」。
- `docs/ui/DESIGN.md`：新增 `relations-view` 列对齐口径；`data-row` 登记「行尾状态徽标排在操作按钮左侧」；`character-workbench` 进度节点选择器登记搜索口径；删 `relation-star-graph` 整段并同步 `character-relations` 段。
- `docs/design/backlog.md`：删「星形图叶子 `· N` = 列表行数」登记项（星形图已不存在）。
- `AGENTS.md`：人物页条目去掉星形图描述。
- `docs/design/backlog.md`：新登「参考资料分类徽标形态不统一」与「关联页端点类型徽标缺 `timepoint`/`event` 中文标签」（后者 = 关联总览显示原始英文类型串）。
- **发布前文档扫尘（2026-09-14）**：`docs/ui/DESIGN.md` 标签 tint 口径 6 档 → 3 档（与代码 `tag-tint.ts` 对齐）、`status-badge` 附近笔误修正；`docs/api/` 四处与代码不符——`50-api-delta.md` 变更目标白名单方向（是 `ENTITY_TYPES` 去掉 `event`，不是「含 event」）、`10-api-project.md` 备份频率补 `1` 分钟档且 key 载体改 pi agent dir、`30-api-entity.md` 详情类型补 `reference` / setting 字段删已废弃键 / 补 `GET /reference/scan/status`（连 `00-api-index.md` 索引行）、`error-code.md` 删不存在的 SSE `error` 帧并登记服务端扩展码、`tool-calling.md` 执行类补 `reorder_timepoints`；`docs/db/schema.md` 迁移目标 v6 → v7、`hook` 字段补 `expected_resolve_node_id`、画布坐标残留删除；`docs/design/` 删画布 localStorage 残留（`10-data-model.md` / `config.md`）、`build.md` debug 类别四类（删 `stream`）、`architecture.md` 凭据优先序改「存量优先」、`00-master-design.md` 删除不存在的「全量回溯」（实际深度上限 3）、`10-data-model.md` 状态计算改章序前缀口径、`backlog.md` 两条登记刷新；`README.md` 版本与能力叙述同步（v0.0.37 / 星形图已移除 / 文案与计数修正）；根 `AGENTS.md` 新增两条硬约束（路由形态 gate 的 effect 依赖；pi 依赖声明位置）并简化 `tasks.md`（批次叙事归 CHANGELOG）；shared/tools/agent 三处注释计数漂移修正（工具 19+16+13=48、备份频率含 1）。

## [v0.0.36] - 2026-09-13

> **关系类型收口 + 人物页关系区**：关系类型的属性（展示名 / 分组 / 对称性）收为 shared 单一定义（`RELATION_TYPE_META`），散在四处的手写清单全部改为派生；`relation_type` 从**枚举放宽为自由字符串**——作者可在建立关联时自定义类型（无需迁移，`relation_type` 本就无 CHECK）；人物页「人物关系网」新增**零依赖手写 SVG 星形图**；client 新增人物字段清单与 schema 的一致性编译期断言。**无 API 破坏性变更**：放宽方向兼容（原先必 400 的输入现在可能 201），预定义类型与既有数据行为不变。

### Added

- **关系类型属性注册表**：`shared/constants/entity.ts` 新增 `RELATION_TYPE_META: Record<RelationType, { label; group; symmetric? }>`（`group` ∈ `character`/`structure`/`anchor`/`hook`/`mount`/`canvas`）——一张表取代原先的手写清单（client 17 项中文标签表、人物页人↔人 5 类子集、对称集合、对话框排除集）。`Record` 穷尽性 = 加关系类型不补属性即编译失败；消费方（客户端标签与子集、tools 冲突检测）一律派生。
- **自定义关系类型（轻量口径）**：作者可在「建立关联」对话框直接输入新类型（语法 = `trim` 后非空 / 长度 ≤ 32 / 禁控制字符，单一校验函数被 REST schema、db `createRelation` 守卫、client 预校验共用）。下拉 = 调用方预定义子集 ∪ 「本项目已用的**自定义**类型」（带条数，从关系行派生）；**无中心记录**（类型只活在数据里 ⇒ 无改名/合并入口，已登记 backlog）。**不需要迁移**（`relation_type` 无 CHECK）。
- **新控件形态 `select-free-input`**（antd `AutoComplete` = combobox；契约在 `DESIGN.md`）：预定义类型以**中文标签**展示/选中、自定义类型以**原名**展示（列表 label 带 ` · N`），提交前反解回 `relation_type` 真实取值；打开下拉即清搜索词（全部选项可浏览）、无匹配时提示「将新建『X』」、语法非法内联报错且不发请求。人物页两个关系 tab 与通用关联页过滤下拉同步接入。
- **人物关系星形图（`relation-star-graph`，零依赖手写 SVG）**：「人物关系网」tab 内、分组列表之上的纯展示图——中心 = 当前角色，叶子 = **按人物去重**的对方（同一人多条关系合并为一叶，条数 > 1 显示 ` · N`；out/in 并存或对称合并行不画箭头），叶子可点击切换选中角色；阈值 = 去重后叶子数 < 4 不渲染、> 24 只画点不写名；**不引入布局库**（1 跳星形 = 极坐标，多跳/拖拽/缩放出现时再评估 `d3-force`，见 backlog）。
- **人物字段清单一致性断言（client）**：`CHARACTER_MUTABLE_DATA_KEYS` / `CHARACTER_DETAIL_FIELD_KEYS` 改 `as const satisfies readonly EntityDataKey<"character">[]` + 穷尽性编译期断言（schema 新增可变字段而详情页/能力面板/自定义字段未接 → 编译失败），运行期另断言「基础 ∪ 可变 === 详情清单」。零新依赖（type-only 引用 schema，zod 不进客户端产物）。
- **AI 工具描述从注册表派生**：`query_relationships` / `propose_add_relation` 的 `relation_type` 描述改由 `RELATION_TYPES` 拼接（原先手写且写错数量、漏 `occurs_in`），并明确「作者在界面自定义的类型 AI 不可创建」。

### Changed

- **对称关系口径统一（tools `detect_conflicts` 行为变化）**：对称集合从注册表派生 = `ally`/`rival`/`family`（此前 tools 手写 `ally`/`family`）——**单向 `rival` 从此报「反向缺失」矛盾**（与显示层的双向合并口径一致）。`mentor`/`kills` 等有向类型不受影响。
- **`relation_type` 契约放宽**：REST schema 由 `z.enum(RELATION_TYPES)` 改自由字符串 + 语法校验；db 守卫同源；`relation_type` 的 `trim` 归一位于 REST 边界。预定义专属校验（伏笔锚点仅章 / `belongs_to` 防环 / `occurs_at` 挂载）按类型名判断，自定义类型天然不触发。**AI 侧保持枚举**（有意分层，见 `tool-calling.md`）。
- 星形图半径预算从 `min(宽, 高)/2` 改为 `min(宽度预算, 480/2)` 且**画布高度随半径长高**（原先约 10 叶起半径饱和、叶子挤成一圈）；标签横向余量不足时锚点翻向内（原先长名字被 SVG 视口裁掉字尾）。

### Fixed

- 关系类型控件在中文界面显示内部 key（如 `ally`）——combobox 输入框显示 option 的 `value`，原实现 value = 原始 key；现改为展示值/落库值分离（三层反解）。
- 自由输入下拉「打开只看到当前项」（当前值被当作搜索词）——改为打开即清搜索词，关闭时提交已输入文本（自由输入不被「点别处」丢掉）。
- server 一条「枚举拒绝」断言随契约放宽变假（`relation_type: "friend"` 由 400 变 201）——同源修订为「语法非法 → 400 / 自定义类型 → 201 原样落库」。

### Docs

- `docs/db/schema.md`：关系类型 = 预定义词表 ∪ 自定义；对称关系口径（含自定义一律有向）；新增/自定义类型**不需要迁移**（修正原先「新增类型走迁移」的错误说法）。
- `docs/design/10-data-model.md` §3：关系类型分层（属性注册表单一定义 / 自定义类型轻量口径 / AI 侧有意收窄）。
- `docs/api/40-api-relation.md`：`relation_type` 自由字符串与语法规则；`docs/api/tool-calling.md`：AI 仍限预定义 17 类。
- `docs/ui/DESIGN.md`：新控件形态 `select-free-input`（含两条 antd 源码事实：combobox `filterOption` 默认 `false`、`onChange` 可能给 `undefined`）；`relation-star-graph` 契约（按人去重 / `· N` / 阈值 / 画布随半径长高 / 标签翻锚点）；`character-relations` 段同步。
- `docs/design/backlog.md`：删已解决两条（人物字段清单断言、关系星形图）；新增 oracle 留存量（R2 互斥对字面量、db 守卫只校验不归一、非字符串文案、dist 新鲜度假绿窗口、对话框其余下拉浮层宽度、对话框全量拉取性能边界、自定义类型改名/合并）；登记「星形图 `· N` = 列表行数」有意口径。
- `AGENTS.md`：`RELATION_TYPE_META` 单一定义、编译期断言只能放 src 模块、改上游 `src` 后先 `pnpm -r build`（假绿窗口）、并行派工必须 fresh context + 硬完成判据。

## [v0.0.35] - 2026-09-13

> **人物页信息架构与文案**：人物页改**四个平级 tab**（人物档案 / 阅读进度 / 人物关系网 / 其他关联 · N）；字段区改**档案式网格**（不再分「基础信息 / 可变数据」，阅读进度画纯文本值）；全站「当前位置」文案改「阅读进度」；三个"选章"选择器收窄为仅章。**无 API 破坏性变更**（`current_position` 等字段名与 `POST /delta/compute` 契约不变）。

### Changed

- **人物页改四平级 tab**：「人物档案」（可编辑）/「阅读进度」/「人物关系网」/「其他关联 · N」——关系两块从「tab 之下共享」提为**各自独立 tab**（不因状态视图只读而受限），「其他关联」**去掉折叠态**（tab 即收起）、条数常显于 tab 标签（涵盖 `appears_in` 等 AI 分析数据源）。默认 tab 判据不变（有有效阅读进度 → 阅读进度；未设置 / 已失效 → 人物档案）。
- **人物档案 = 档案式字段网格**：一个 `card` 内的网格（label 左置 64px、单行字段 ≥`md` 两列、长文本与标签列表整行），字段顺序 = `CHARACTER_DETAIL_FIELD_KEYS` 单一清单；**删除「基础信息 / 可变数据」两个分区**——不可变性分层只服务变更记录白名单与 AI 提案边界，不再在 UI 表达（`10-data-model.md` §14 不变式不变）。
- **阅读进度画纯文本值**：同一网格、label 逐一致，值以文本渲染（空值 `—`），不再渲染一排 disabled 输入框；`panel-tree` 同 tab 走只读形态（缩进「名称 + 值文本」行，无输入框/工具条/行操作/拖拽），叶子空值也**不再用 `—` 占位符**（占位符会被误读为已有值）。
- **文案统一**：「当前位置」→「阅读进度」（InfoBar / 概览页 / 大纲页徽标与右键菜单 / 大纲详情页按钮与元信息行 / HookPanel / compute 探针 / 成功与失败 toast）；「计算节点」→「进度节点」；`current_position` 字段名与 `lib/current-position.ts` 模块名不变（`docs/api/10-api-project.md` 登记口径）。「暂无变更记录」空态统一为「初始值」（人物页「人物档案初始值」/ Delta 预览「实体当前状态即初始值」）。
- **三个选章选择器收窄为仅章**：人物页「进度节点」、通用 compute 探针（设定/地点/伏笔/时间点详情页）、`#/hooks/:id` 的「预计回收节点」——状态按**章序前缀**累积，非章节点只是某章的**别名**（场景→所属章、卷→该卷末章、root→初始值），列出只会造成"粒度更细"的错觉；`chapterNodeOptions` / `chapterNodeExists` 归位到 `lib/outline-tree.ts`（原在 `lib/hook-panel.ts`）。**API/工具层不变**：`POST /delta/compute` 与工具 `compute_state` 的 `at_node_id` 仍不限层级（AI 可用场景语言提问）；`Timeline` / `create-relation-dialog` 的节点选择是自由引用，有意保持全层级。
- **人物页新增失效口径**：存量指向场景/卷的 `current_position` 在人物页判为「阅读进度已失效」并给「去大纲重设」入口（服务端读侧仍按父链宽松推导，不受影响）。

### Docs

- 新建 `docs/design/backlog.md`：遗留项与「有意保留口径」从 `tasks.md` 拆出，按「数据与契约 / 前端 UI / AI 产品 / MVP 明确不做 / 有意保留」分类，每条给现状 → 影响 → 触发条件 → 最小修法或升级路径；`tasks.md` 只留当前任务卡。
- `docs/ui/DESIGN.md`：`character-workbench`（四 tab / 档案网格 / 只读纯文本 / 进度节点只列章）、`character-relations` 与「其他关联（tab）」（pane 制、无区标题、无折叠）、`panel-tree`（空值无占位符、只读形态）改写。
- `docs/db/schema.md`、`docs/design/10-data-model.md`、`docs/api/10-api-project.md`：登记「UI 文案 = 阅读进度 / 字段名 = `current_position`」、「compute 探针的非章入口只存 API/工具层」、「`hook.data.expected_resolve_node_id` 三层口径（UI 只列章 / 数据层任意节点 / 分析层容忍非章——与伏笔关系源端硬校验章不是同一层）」。
- `README.md`：版本说明与 §当前能力 增补本条。

## [v0.0.34] - 2026-09-13

> **章级锚点收窄 + 人物页工作台**：大纲/变更记录/伏笔三类锚点一律收到「章」；`computeState` 改章序前缀累积；character 数据重构（新增 `description`/`alias`/`race`，移除 `status`，标签式 `abilities` 升级为**能力面板树**，`SCHEMA_VERSION 6 → 7`）；人物页改为 master-detail 工作台（左栏列表 + 双视图 tab + 关系网/其他关联 + `panel-tree`）。**API 破坏性变更见 Breaking**。

### Breaking

- **锚点仅章**：`current_position`（`PUT /project/config`）、变更记录的触发节点（`POST /delta` 的 `node_id`）、伏笔锚点（`plants`/`advances`/`resolves` 的源节点）一律**只支持 `chapter`**——卷/场景 → 400 `VALIDATION_ERROR`；AI 提案层与 executor 同口径拒绝（executor 直写 db 也拦）。卷/场景详情页不再提供变更记录区与「设为当前位置」入口。
- **状态累积改章序前缀**：`computeState` 由「沿树父链」改为「**章序 ≤ 目标进度章的全部已确认 Delta**」（跨卷/跨章累积）；目标节点 → 进度章：章→自身、场景→所属章、卷→该卷最后一个未软删章、`root` 不可作 `at_node`（404）。**卡 1.2 之前写入的非章锚点 Delta 不再参与累积**（无 UI 入口，静默 inert）。
- **character 字段调整**：移除 `status`（无 UI 展示、无写入路径）；`abilities[]` 经 `007` 迁移为 `ability_panel`（顶层分组「能力」+ 每个标签一叶子，幂等且不覆盖已有面板）；新增 `description`（**新建/详情前端必填**，服务端不硬校验）、`alias`（单值假名）、`race`。`SCHEMA_VERSION 6 → 7`。
- **人物页不再是列表页**：`#/characters` 现为 master-detail 工作台（左栏人物列表 + 右栏详情）；`#/characters/:id` 语义不变。

### Added

- **能力面板（`ability_panel`）**：用户自定义字段树（有非空 `children` = 分支不可赋值、无 = 叶子可赋值；空数组视为叶子）；增/删/改名/同级拖拽/拖成子级；模板（3 套内置）与「从角色复制」派生（结构快照深拷贝）；名字含 `.` 或同层重名给内联提示（不静默改写数据）。
- **面板叶子可作 Delta 字段**：点分路径（如 `ability_panel.火系.等级`）逐层下钻累积（顶层精确键优先、数组段按同层 `name` 匹配取先序第一个、中途缺失记 `conflicts` 不静默）；`+ 新建变更` 字段下拉按目标角色面板动态展开叶子。
- **人物页双视图 tab**：「初始化数据」（可编辑）/「当前位置数据」（`computeState(at_node = current_position)`，只读，含手动选节点与 `conflicts` 标注）。
- **新建人物弹窗**：必填 姓名/角色定位/描述；重名软提示不阻断；面板三选（空白/内置模板/从角色复制）；提交后自动选中。
- **人物关系网 + 其他关联分区**：分区判据 = 另一端端点类型；对称关系（`ally`/`rival`/`family`）双向合并 + 「双向」徽标（显示层去重、不建反边）；「其他关联 · N 条」默认折叠但**条数常显**。
- **大纲行右键「设为当前位置」**（仅章行；已是当前位置禁用）。
- **启动路径与显式 open 共用同一条开放管道**：开机直达的书同样走迁移前快照、无路径重建兜底、未来版本拒绝（不再静默跳过迁移）。

### Changed

- `get_entity_summary(character)`：移除 `byStatus`；`topAbilities` 改读**面板顶层分组名**（旧 `abilities` 标签口径废弃）。`filters.status` 与 hook 的 `byStatus` 保留不变。
- **伏笔状态 Delta 改 `op=set`**：`data.status` 是物化事实（写路径同步、守卫/列表/AI 直接读），`update` 的 CAS 与其互斥 → 每次 `compute_state` 产生假 `conflicts`；改 `set` 后假冲突归零、中后期历史回看更准（首次转移之前的窗口仍返回最新值，属登记边界）。
- **`computeState` 查询批量化**：300 章 / 300 条 Delta 由 ~146ms 降到 ~3ms（SQL 语句从 O(章数) 降到 4 条）。
- 埋设机会扫描过滤软删场景（与 `suggest_hook_payoff` 同口径）；「当前章」退化取**最后一个未软删章**（此前删掉尾部章节会虚报写作进度一章）。
- 缺 `data.db` 的书不再触发「删库重建 + 重置 `outline.json`」（全新空库直接写 `SCHEMA_VERSION`；结构陈旧或有数据的旧库仍走既有重建兜底）。
- 变更记录字段下拉排除 character 的不可变字段（`role`/`description`）；面板叶子两条写入路径的**值类型判定同源**（`coerceAbilityValue`）。
- **写入面白名单收敛为 `shared` 单一定义**（client/tools 双份手抄归零）：`SET_ONLY_FIELDS`（hook 状态仅 `set`）、`REMOVED_CHARACTER_FIELDS`（character 已移除字段）、`IMMUTABLE_FIELDS`（character 不可变字段）——AI 提案层与 executor 层同口径拒绝；**REST `/delta` 保持泛型**（有意分层，登记在 `10-data-model.md` §14）。
- 延期项速清：删除死代码（client `currentHookStatus` 等）、`Outline` 页 prettier 归一、新建弹窗「校验失败不请求」升为测试保证、`db/migration.ts` 注释整理。

### Fixed

- **启动自动打开跳过版本检测/迁移**（既存缺口）：`detectProject` 直接 `openDatabase` → 任何 DDL 迁移在开机路径被跳过（用户视角"开机就崩"）；现收敛到同一管道。
- 关系行端点链接缺 `#` 导致点击触发整页导航丢路由。
- 面板拖拽的误报 toast（被拒时仍提示"值已清除"）与非法落点仍有高亮/插入线。

## [v0.0.33] - 2026-09-12

> **导航与上手体验**：导航入口名实归位（书架入口 / 书名 = 概览）、开机直达上次那本书、设置页「AI 模型」只列已配置的 provider 并改为弹窗添加（带供应商品牌图标）；同时修正了 K5 换核后遗留的凭据优先级文案。**API 无破坏性变更**。

### Added

- **打开即回到上次那本书**：创作根 `.ai-editor/config.json` 新增 `lastProject`（`POST /project/open` 成功后合并写入，保留手编的 `debug` 段），`startServer` 在创作根自身不是项目时按它恢复上次的书；路径已删除/移动或 `project.json` 损坏 → 静默回书架（不阻断启动）。客户端首帧若落在书架路由则直接进该书概览（`hooks/use-enter-last-book.ts`，只判定一次）——`loadConfig` 同期改为「并发共享同一在途 Promise」（旧实现按 `configLoading` 早退，`await` 的调用方会把「加载中」当成「无项目」）
- **设置页「AI 模型」按已配置显示 + 弹窗添加**：三级导航只列**已配置**的 provider（`authConfigured` ∪ 当前激活 ∪ 刚配置成功的家）——pi 目录 40 家全列等于不可用；「添加」改为受控弹窗（选择步：搜索框 + 品牌图标列表；配置步：凭证状态 + key + `[取消]`/`[保存]`，X/Esc/遮罩均可关，**关窗不落任何状态**，保存成功才进导航）。同时消除了「列了却用不了」的空转项
- **provider 品牌图标**：新增自持精灵 `packages/client/public/provider-icons.svg`（30 symbol，派生自 @lobehub/icons，MIT 许可头内嵌文件内）——**不引入 `@lobehub/icons` 包**（9.08MB / 4802 文件 + peer `@lobehub/ui` 一整棵树）；自定义 provider 回退 `@ant-design/icons` 的 `ApiOutlined`

### Changed

- **导航入口名实归位**：左栏顶部标识 `◈ 我的小说` → **`◈ 书架`**（书架主页入口）；导航区首项由「回到书架（显示书名）」改为**书名按钮 → `#/overview`**（概览入口收敛到这里）；一级导航移除「概览」项（九项 → 八项 + 回收站）；`InfoBar` 项目名点击 `#/` → `#/overview`（与左栏书名同一目标）
- **左栏底部三入口左对齐**：修掉 `Button` 标签 span 缺 `flex-1` 导致「图标 + 文字」整组居中（实测图标 x=24 / 按钮盒 8–182）
- **设置页凭据来源标签中文化**：`stored` → 「auth.json 已保存」、`environment` → 「环境变量」等（不再把内部词直接显示给用户）
- **gitignore**：`test-project/` 整体不入库（含运行时生成的 `.ai-editor/config.json`：`debug` 开关 + `lastProject`）——调试开关写法改为在 README 里给示例

### Fixed

- **凭据优先级文案错误（K5 换核后遗留）**：旧文案「环境变量优先于此处的配置」已过期。按 pi 0.85.1 实际语义修正（`pi-ai` `dist/auth/resolve.js`：*stored credential owns the provider, ambient/env is consulted only when nothing is stored*；`auth/helpers.js` 先取 `credential.key`；`coding-agent` `auth-storage.js` 的 `key` 值过 `resolveConfigValue`）——**auth.json 存量凭据优先，环境变量只在该家无条目时兜底**；需要引环境变量就写在 auth.json 的值里（`$VAR` / `!命令`）。同一处过期表述同时修正 `docs/design/config.md`、`docs/api/90-api-settings.md`、`docs/db/schema.md` 与 `routes/settings.ts` 注释

## [v0.0.32] - 2026-09-12

> **AI 内核换成 pi**（嵌入 `@earendil-works/pi-coding-agent` 0.85.1）：模型目录/凭据/会话文件/重试/上下文压缩/工具派发全部交给 pi，本仓只保留领域工具、内核提示词与 HTTP/SSE 契约；会话文件格式变为 pi session v3（旧 v1 会话不再读取）；发布面 6→5 包（`packages/llm` 删除）；配置载体迁到 pi agent dir。

### Breaking

- **AI 内核换核**：自建 LLM 适配层与 agent 主循环全部删除，改为嵌入 `@earendil-works/pi-coding-agent` 0.85.1（exact pin，含 `pi-ai` 模型层与 `pi-agent-core` 循环）。变更面：模型调用/流式/usage、重试、上下文压缩、工具派发、会话读写都由 pi 承担
- **会话文件格式改为 pi session v3**：仍是项目目录 `sessions/`（随书走、备份/恢复整目录覆盖），但文件名与行结构由 pi 定义（树状 entry：消息/压缩摘要/模型变更/思考强度变更）；**旧 v1 扁平格式文件保留在磁盘但不再被读取**（不出现在会话列表、不可续聊）
- **`packages/llm` 删除**：发布面 6 包 → 5 包（`shared`/`db`/`tools`/`agent`/`server`）；`agent` 包承接 pi 运行时装配、模型/凭据桥与事件投影
- **配置载体迁移**：用户级 `~/.ai-editor/config.json` **废弃**（读都不读，文件残留无影响）。模型/思考强度/重试/压缩参数归 pi settings（`~/.pi/agent/settings.json`）；API key 归 pi credential store（`~/.pi/agent/auth.json`，环境变量优先）；自定义 provider/模型走 `~/.pi/agent/models.json`。key 仍绝不入项目文件
- **SSE 事件集改为 pi 事件投影**：`POST /chat` 不再发旧事件（`text` / `tool_call` / `tool_result` / `proposal` / `done` / `error`），改为 `session`（首帧）/ `ping` / `agent_start` / `turn_start` / `message_start|update|end` / `tool_execution_start|update|end` / `turn_end` / `compaction_start|end` / `auto_retry_start|end` / `agent_end`（`partial` 全文对象剥离）；客户端须同步升级（事件表见 `docs/api/80-api-chat.md`）
- **`settings/llm` 契约改**：provider 目录与认证状态全量来自 pi（不再有 provider 白名单与自建 key 解析链）；`PUT` 的 `api_key` 为单条 `{ provider, key }`（空串 = 清除凭据）；**存量 OAuth（订阅登录）凭据的写入与删除都拒绝**（400，需用 pi CLI 管理订阅登录）
- **思考强度缺省由 pi 决定**（`medium`；旧的 `high` 缺省不再沿用），可在设置页或 pi settings 调整

### Added

- **思维链**：随消息落盘（含签名，保障多轮工具调用回放），前端默认折叠（流式期间自动展开、结束后折叠），历史回看走按需端点拉全文（列表只回 240 字预览）
- **会话错误码**：`CHAT_BUSY`（同一项目已有在途对话流）、`THINKING_NOT_FOUND`（思维链块下标越界/非 thinking 块）
- **单项目单在途对话流**约束（服务端 `409 CHAT_BUSY`，前端在途时禁用发送）
- **设置变更即时生效**：模型/思考强度写入 pi settings 后，下一个请求即采用（无需重启）

### Changed

- **轮次上限（8 轮）与单轮超时（120s）删除**：失控保护改由 pi 的自动重试与自动压缩承担，失控时用户可直接停止生成（steering/follow-up 亦由 pi 提供）
- **出站 HTTP 连接行为与 pi CLI 对齐**（真实 provider 联调发现）：服务启动时安装 undici dispatcher（`connect.autoSelectFamilyAttemptTimeout=2000` + 环境代理支持 + 可配 HTTP 空闲超时）——缺少这一步时，Node 连接策略会跳过 pi CLI 的正常路径，在 IPv6 可达性受限的链路上对部分 provider 稳定连接超时（同一链路 pi CLI 可正常请求）；新增依赖 `undici` exact pin（与服务内 pi 同版本）
- **工具参数 schema 改 TypeBox**（`Type`/`Static` 经 `pi-ai` 重导出）：一份定义同时给模型（JSON Schema）、给 TS 类型、给校验；参数校验交给 pi（类型写错会被 coerce 后进入工具，业务不变量由工具自校）
- **工具结果截断**上限改为代码常量（8000 tokens；不再可配），超限截断 + 结构化提示不终止对话
- **上下文占用条**口径改为模型窗口占比（`getContextUsage()`，随 `turn_end`/`agent_end` 帧下发）
- **调试日志类别**去掉已无生产者的 `stream`（现为 chat/request/usage/http）

### Removed

- `packages/llm` 包与 `~/.ai-editor/config.json` 读取链（三级 key 解析、`api_keys`、`context_budget`）
- 自建循环/上下文裁剪/会话文件读写/工具调度模块（`agent` 包的旧 `run`/`context`/`session`/`executor`/`prompts`）与 `db` 的会话文件模块（仅迁移 006 保留旧格式导出辅助）
- 错误码 `AGENT_MAX_ITERATIONS` / `AGENT_TIMEOUT` / `AGENT_TOKEN_BUDGET` / `AGENT_DISPATCH_ERROR` / `AGENT_INTERNAL_ERROR`（内核对失控的兜底随自建循环一并退场）
- `ChatMessage` / `ChatMessageRow` 共享类型与 `RUNTIME_ID_PREFIX.session`（会话 id 由 pi 生成）

## [v0.0.31] - 2026-09-12

> **对话历史迁出数据库**（`chat_messages` → 项目目录 `sessions/*.jsonl`，SCHEMA_VERSION 5→6）+ 会话删除端点；**上下文预算配置化**（按激活模型窗口派生）与工具结果上限落地；token 估算改分级密度（修中文低估 2.4 倍）；设置页信息架构重构（二级 tab + AI 模型三级导航）与中栏页头统一壳。

### Added

- **对话历史改为项目目录 JSONL 存储**（`books/<书名>/sessions/<session_id>.jsonl`，一 session 一文件）：行 = header（`type/version/id/created_at`）+ 消息行；读取容忍规则（未知 `type` / 坏行 / 缺 `created_at` 跳过，header 缺失或版本超前整文件跳过）；`session_id` 硬校验 `^sess_[A-Za-z0-9_-]{1,64}$`（同时是文件名校验，防路径穿越）。**收益**：会话随书目录走（备份/导入/改名/移动天然携带，不再依赖 `project_id` 归属迁移）、追加写人类可读可 diff、会话名/每轮模型/思维链等扩展都是纯追加（不做文件级迁移）
- **迁移 006（SCHEMA_VERSION 5→6）**：`chat_messages` 全量导出为 JSONL 后 `DROP TABLE`；`Migration.up` 扩为 `(db, ctx: { projectRoot })` 以写入项目目录；迁移失败整体回滚（表保留、版本不前移、可重试）；**id 非法的旧会话以 `sess_legacy_<sha256 前 16 位>` 改名导出**（数据不丢、映射确定性幂等）
- **`DELETE /api/v1/chat/sessions/:id`**：400 形态非法 / 404 `SESSION_NOT_FOUND` / 409 `SESSION_BUSY`（会话有在途 SSE 流，防 append 把文件原地重建）/ 200 `{ deleted: true }`；右栏会话项 ellipsis → 「删除会话」→ danger 二次确认（「删除后无法恢复」），生成中禁用
- **备份管道接 `sessions/`**：白名单/打包/变更判定（mtime）/恢复整体覆盖与 `references/` 同款；旧备份包（无 `sessions/`）仍可导入，恢复时该目录按整体还原清空
- **上下文预算配置化**：用户级 `~/.ai-editor/config.json` 新增 `context_budget` 段（`history_ratio` 缺省 `0.15`、`tool_result_max_tokens` 缺省 `8000`，缺失/非法只回落该段、不牵连 provider/model/api_keys）；历史层预算 = **激活模型 `contextWindow` × ratio**（经总闸 clamp：总闸 = `window × 0.5`，替换原硬编码 60K）；`docs/design/config.md` 新增「可配 / 不可配边界」判据（轮次上限 / 单轮超时 / 总闸 / 重试策略刻意不可配）
- **`done` SSE 帧新增 `context_budget`**（`{ history, total }` = 生效历史预算 / 四层预算之和）
- **单条工具结果上限接线 + 裁剪护栏**：`truncateToolResult`（`llm/src/token.ts` 早已实现、全仓无消费者）接入 `runAgent` 工具结果回填的唯一扼点（含合成失败结果与 `finish_reason=length` 标记），事件 / 落库 / 下一轮喂回共用同一份截断文本；超限**截断 + 结构化提示**不终止对话；裁剪**不得裁空**（放不下任何块时按配对块从尾部累积到喂回 payload 非空，不拆 `assistant ↔ tool` 配对）
- **中栏页头统一壳 `components/ui/page-header.tsx`**：标题行 → 二级 tab 行（可选）→ 控件行（可选）→ 分割线，一次给全；**14 页迁移**——列表/富页 10 页 + 详情页 4 页（`ReferenceDetail` 标题可编辑走 `titleNode`）；Timeline / ReferenceList 的内滚动布局由 `shrink-0` 页头承担（实测滚动 500px 页头与分割线不动）
- **设置页二级 tab**：三块下沉为 `settings/{llm,project-rules,backup}-section.tsx`，`Tabs` line 型 3 项（选中态为页内 state，不进 URL；懒渲染 + 草稿跨 tab 保留）
- **AI 模型三级导航**（`sub-nav`）：左侧 160px 竖向 `Menu` 列 provider，右侧为该家面板（标题行 + 「当前」徽标 + 模型只读行 + key 状态/输入/保存/清除）
- **左栏「立即备份」快捷入口**（无项目禁用、在途 `loading` 防连点）
- **守卫 +2**：`antd-tokens.test.ts` 新增 Tabs 契约（两态 `horizontalMargin` 归零、`itemColor` = 次级文字档）

### Changed

- **设置页「AI 模型」去重**：删除 provider 面板的「模型（点选即激活）」下拉（与聊天栏模型下拉重复，且「浏览 provider 目录」时点模型会顺手改全局激活模型），改为只读「当前激活：<模型名>」；模型激活唯一入口 = 聊天栏 `ComposerConfigRow`。**书架态（未打开项目）无模型切换入口**（模型只影响聊天，聊天只在项目内存在）
- **token 估算改分级密度**：ASCII 4 字符/token、非 ASCII 1.7 字符/token（≈ 1 汉字 0.6 token）；新增 `charsPerToken()` 供 `truncateToolResult` / `trimFocus` 按文本自身密度反推字符数（旧口径下中文大文本会被多保留一倍以上字符，真实超预算）
- **占用条分母改生效预算**：由模型 `contextWindow` 改为 `done` 帧的 `context_budget.total`（1M 窗口下旧分母让占用条恒显 0-1%，是假指标）；`title` 改为「本轮 tokens / 生效预算 tokens」
- **契约（`docs/ui/DESIGN.md`）**：新增 `usage-bar` / `chat-session-item-menu` 条目，§Layout 页头结构登记；`docs/db/schema.md` 新增 sessions/*.jsonl 节并移除 chat_messages 表；`docs/design/10-data-model.md` §1 存储表/§10/§11 改写；`docs/api/{00-index,80-chat,20-backup,90-settings,error-code}.md` 同步；`docs/design/{config,20-context,30-agent-loop,architecture}.md` 同步

### Fixed

- **中文 token 低估 2.4 倍**（唯一能击穿裁剪阈值与总闸的静默失效路径）——`chars/4` 只对英文成立，改为分级密度
- **占用条 / 用量切视图残留**：`lastUsage` / `contextBudget` 随切会话 / 新会话 / 切项目清零（原先残留上一会话数值）
- **迁移对非法 id 旧会话的静默丢弃**：改为 `sess_legacy_<hash>` 改名导出（原实现跳过 + DROP = 永久丢数据）
- **删除会话的微任务窗口**：在途登记注销提前到 `runAgent` 返回后（此前「客户端读到 `done` 立刻删」会偶发 409 `SESSION_BUSY`）
- **构建产物残留**：清理 `dist` 中被删模块的陈旧编译产物（`db/queries/{atomic,outline,project}`、`tools/{executor,proposal}/reorder-events`）——`files: ["dist"]` 会随包发布

## [v0.0.30] - 2026-09-11

> 右栏交互优化（用户反馈八项）+ 两条 **antd 选中面静默失效**根因（「所有下拉选中条目因背景色看不清」）。**纯前端，API/数据契约零改动**；`design-discipline` 守卫 14 条不变，新增 antd **派生 token** 守卫 5 条（`antd-tokens.test.ts`）。

### Fixed

- **全站下拉选中项文字不可读（用户复验：「所有下拉选择列表的选中条目」）**：根因两层——① antd 选中面取**全局 alias** `controlItemBgActive` / `controlItemBgActiveHover`，由 `colorPrimary` 派生（`theme/util/alias.js`）；本仓主色 seed 是深墨 `#37352f`，派生的不是「浅主色底」而是中深灰（实测 `#787771` / `#6b6a65`），压在 `colorText`（同为深墨）上 **2.26:1**。② 弹层打开时 antd 把已选中项**自动置为 active**，命中 `select/style/dropdown.js` 的 `&-selected&-active { backgroundColor: controlItemBgActiveHover }` ⇒ **组件级 `Select.optionSelectedBg` 在真实交互路径上完全无效**（文档登记灰面、像素是深灰）。修法 = 在 `AntdProvider` 覆盖这两个全局 alias（浅 `#f0eeec` / 深 `#373737` = 已登记的选中面）——Select / Dropdown / Menu / Pagination / Tree / Table 一次到位；`controlItemBgActiveHover` 取同一面（已选中项不随 hover 变色，选中与悬浮靠字重区分：antd `optionSelectedFontWeight` 默认 = `fontWeightStrong` 600）；删除因此冗余的组件级覆盖（Menu `itemSelectedBg` / `itemSelectedColor`、Select `optionSelectedBg`）。实测全站 9 处下拉选中项 **2.26:1 → 10.59:1**（深色 11.9:1）
- **思考强度下拉选项截断**：与模型选择同一根因（antd `popupMatchSelectWidth` 默认跟随触发器宽度）——62.75px 触发器把 `minimal` / `medium` / `xhigh` 截成 `m…` / `xh…`；补 `popupMatchSelectWidth={false}` 后浮层 86.7px，7 档全名可见
- **三栏默认比例不是 1:5:4**：旧默认 = `左 clamp(视口×10%,160,480)` / `右 clamp(视口×40%,240,720)` / 中栏吸收剩余 ⇒ 1:5:4 只在视口≈1680 成立（实测 1440 → 11.1/48.1/40.0、1920 → 10.0/51.9/37.5、3440 → 10.0/68.7/20.9）。**右栏上限 720 → 960（= 2400 的 40%，上限与比例挂钩）**：1600–2400 视口精确 1:5:4（仅两根 6px 拖拽手柄从 50% 里扣 12px），<1600 左栏取下限 160、>2400 右栏封顶由中栏吸收剩余；`DESIGN.md` / `layout.md` 同步（旧文写「默认 220 / 右栏 240-720」与实现两套事实）
- **右栏会话列表选中项不可读**：`AntDropdown + Menu` 的选中项**不吃 `Menu` 组件 token**（Dropdown 自带一套 menu 样式，直接取全局 `controlItemBgActive`），实测选中面 `rgb(120,119,113)` 压 `rgb(55,53,47)` ≈ 1.9:1 ⇒ 会话列表换 antd x `Conversations`（灰面 + `colorText`），新增守卫 `dropdown-menu-selectable`
- **npm 坏版本已标注 deprecate**（v0.0.1/v0.0.2）：`llm`/`db`/`tools`/`agent`/`server` 五个含 `workspace:*` 残留依赖的包 × 2 版本已在 npm 标注（registry 复验通过；`shared` 无依赖可正常安装故未标注）
- **文档修正（实测推翻旧结论）**：`AGENTS.md` / `docs/design/build.md` 原写「绕过 2FA 的 granular token 不能执行 unpublish/deprecate（403）」——2026-09-11 实测**可以 deprecate**（10 条成功、无 OTP）；被拒的只是账号/组织/设置类操作（`npm profile get` → 403）；`unpublish` 未实测（不可逆）。另注：2027-01 起 bypass-2FA token 将失去直接发布能力，本仓发布走 OIDC Trusted Publisher 不受影响

### Changed

- **右栏输入区**：模型选择 / 思考强度从「标题行下方」移到**输入框下方**（腾出 36px 消息流高度）+ **两端对齐**（左 = 模型，右 = 上下文占用 + 思考强度）+ 两个下拉浮层**按内容宽展开**（旧 `max-w-28` = 112px 把 `DeepSeek V4 Flash`（文本自然宽 135px）掐成 `DeepSe…`）；占用条色值改经 antd token（清掉写死的 `bg-amber-500` 调色板类）；`ChatModelBar` → `ComposerConfigRow`（无项目时父层不渲染，删 `disabled` 透传）
- **右栏会话列表换 antd x `Conversations`**：项两行（摘要 + 「条数 · 相对时间」）、无历史 → 单条禁用提示「暂无历史会话」；自定义弹层不经 Menu 上报点击 ⇒ `open` 受控、选中即关；弹层根只剩定位（旧浮层面由 `.ant-dropdown-menu` 提供）⇒ 面板按 `ui/context-menu.tsx` 同一套自绘浮层类补（`bg-popover` + `ring-1` + `shadow-md`）
- **面板收起 / 展开图标统一**：左栏 `MenuFoldOutlined`、右栏 `VerticalRightOutlined`、展开用 `BorderLeft/RightOutlined`（表格边框图标）= 三套图标语言 ⇒ 统一为同一族镜像对 `«` / `»`（方向 = 面板往哪边收：收起朝本侧边缘）；不用 `Vertical*`（实测 `VerticalLeftOutlined` = `▶|`、`VerticalRightOutlined` = `|◀`，二者区别在「竖条在哪侧」而非箭头指向，配不出左右对称）
- **参考资料页两个筛选下拉**（`w-32`）补 `popupMatchSelectWidth={false}`：分类是固定 4 字标签，但**标签是用户自定义文本**，浮层跟随触发器宽度必然截断
- **契约同步**：`DESIGN.md` §Colors 新增「显式覆盖的派生 alias」登记表（含为什么必须覆盖）、组件覆盖表标注「选中面回归全局 token」、`select-option-selected` 段改写（面上的可读性属全局坑、调用点只负责浮层宽度与选中语言）、面板折叠图标族契约；`layout.md` §1「默认三栏宽度规则」+ §6 右栏结构（配置行位置、会话列表形态）；`AGENTS.md` 补视觉 token 硬约束

### Added

- **antd 派生 token 守卫**（`components/antd-tokens.test.ts`，5 条）：用 antd 自己的 `theme.getDesignToken` 算出**派生后**的 token，断言选中面家族（`controlItemBgActive` / `…ActiveHover` / `controlItemBgHover`——组件级选中面全由其派生：`select` 的 `optionSelectedBg`、`menu` 的 `itemSelectedBg`、`tree` 的 `nodeSelectedBg`、`table` 的 `rowSelectedBg` / `rowSelectedHoverBg`）与 `colorText` 的对比度 ≥ 4.5:1（浅 / 深各一条；半透明面按该模式面板底色合成，否则深色态必得 1:1 假值）、选中面 ≠ 派生 `colorPrimaryBg`、`fontWeightStrong ≥ 600`，外加「裸深墨 seed 时确实 < 4.5」的自检。守卫有效性实测：临时去掉覆盖后浅色报 `controlItemBgActive=#787771 → 2.73:1`、深色同样变红（4 条失败），还原即绿

## [v0.0.29] - 2026-09-11

> 用户反馈九项 + 静默失效根因 + 链式新建断链。**纯前端，API/数据契约零改动**；新增 4 条源码守卫规则（累计 13 条）。


### Fixed（两条静默失效根因——都是「测试全绿但像素全错」）

- **语义色层整体失效（P0）**：antd v6 的 `cssVar` **从不把 `--ant-*` 注入 `:root`**，而是挂在组件级 class 作用域（`.css-var-<useId>`）；`index.css` 的 `:root { --primary: var(--ant-color-primary) }` 等映射因此全部解析为空——全站 Tailwind 语义色（`bg-card` / `border-border` / `text-muted-foreground` / `bg-primary` / hover 面 / chip 底色 / 拖拽指示线）静默透明（v0.0.26 引入，本次才被发现）。修复 = `cssVar: { key: CSS_VAR_KEY }` 与 `index.html` 的 `<html class>` 同值，并在 `design-discipline.test.ts` 加 `cssvar-scope` 守卫锁死两处字面量
- **antd Button `variant` 静默回落**：v6 只在 `color` 与 `variant` **同时**给出时才走 color/variant 分支（`Button.js:91`），仓库 22 处 `variant="text"` 实际渲染成**带边框的 outlined 按钮**，与遗留 `type="text"` 的真 text 按钮混用（“图标按钮颜色不统一”的根因）；全仓统一为 `color="default" variant="text"` + 新增 `button-variant-color` 守卫
- **右栏用户消息不可读**：user 气泡底色用 `colorPrimaryBg`，而主色 seed 是深墨 `#37352f`——antd 派生的 `colorPrimaryBg` 实测为 `#787771`（中灰），灰底压墨字对比度 ~1.9:1；改用 `colorFillTertiary`（= `surface-muted`，DESIGN.md 契约）+ `primary-bg-token` 守卫
- **拖拽无落点指示**：大纲页插入线用 `bg-accent`（= `surface-muted`，白底对比度 ~1.06:1）且设定树目标行同为近白面——用户无法判断会插到哪里；统一 `DropIndicator`（primary 3px 实线 + 两端圆点）替换三处各自实现，拖拽目标/新建定位临时高亮改 `bg-primary/10` + `ring-primary/30`（覆盖 setting-tree/Outline/EntityList/TimelineGroup/Dashboard）
- **时间轴按钮错位**：组标题行缺 `px-3`，其右侧按钮列与事件卡按钮列错开 12px
- **页面标题缺失**：人物/设定/地点/关联四页在去二级 tab 时连标题一并删掉——补回（关联页标题原先还会错显“人物”）
- **链式新建断链**：设定树/大纲的就地新建提交后，新条目只拿到焦点与临时高亮、**没有进入选中态**，而「Enter 新建子级」的守卫要求「该行处于选中态」→ 第二次 Enter 静默无响应（用户反馈「新建→回车→再回车建子级」做不到；toast 不抢焦点，只是同时出现造成「被提示打断」的错觉）。修法：新条目进入「选中 + 聚焦」双态；设定树的选中态必须放在「新行已渲染并聚焦成功」的效应里（`reload()` 异步，提前设会被「选中失效清理」效应按旧树误判清零——实测踩坑）

### Added（标签 tint 系统 + 中栏页面头部统一）

- **标签 tint 系统**（兑现 DESIGN.md 已登记但未实现的 tint 契约）：`index.css` 定义 `--tag-*` 六色（浅实色 + 深 20% 叠色，唯一色值定义处）→ `lib/tag-tint.ts`（FNV-1a hash → 色档，**同名恒同色**；类名走静态查表，因为 Tailwind 不生成拼接类名）→ `components/ui/tag-chip.tsx`（全站唯一标签 chip 实现）；替换 9 处标签/类型徽标（人物/地点/设定/关联/伏笔/时间轴/参考资料/大纲/回收站）
- **中栏页面头部统一结构**（`layout.md §3`）：第一行 = 页面标题单独一行；第二行 = 控件行（左：搜索框→分类→标签→排序，右：操作按钮）；搜索框全站统一规格（`SearchOutlined` 前缀 + 192px 宽 + `allowClear`）；重排 7 个页面（人物/设定/地点/关联/大纲/伏笔/时间轴/参考资料；概览/回收站/详情页不变）；关联页新增右上「+ 建立关联」入口
- **图标按钮唯一实现**：自绘 `<button>` 图标按钮收敛到 antd `Button`（设定树折叠箭头/↑↓/删除、大纲折叠箭头与行尾删除、实体详情拖拽手柄、错误横幅关闭、左栏收起窄条展开）；不可恢复操作（purge/物理删关系）统一 `danger`，软删保持常规色；清 `lib/styles.ts` 死常量

### Changed

- **视觉契约补登**：`DESIGN.md` 新增 tint 分配规则、`search-input`/`drag-indicator`/`icon-button` 统一约定与「拖拽目标行与临时高亮」prose 契约；标注 `chat-bubble-user` 禁用 `colorPrimaryBg`；§Iteration Guide 增「改完主题必看像素」闭环
- 守卫测试新增 3 条源码规则：`cssvar-scope` / `button-variant-color` / `primary-bg-token`（均带自检样例），并给逐行规则加注释行豁免（注释里写禁用原因不应被误判）；再加 `no-dynamic-class`（拼接类名不会被 Tailwind 生成）
- **文档修正**：`README.md` 两处过时陈述（`lib/styles.ts` 的图标按钮常量已在 T6 删除、Prettier 配置并未接入强制流程）；`milestone.md` 补本版本条目；`tasks.md` 清理已完成卡（改为「当前卡 + 历史版本摘要表」）

## [v0.0.28] - 2026-09-11

### Changed（视觉语言统一——Notion 工作区暖灰 × antd 单一组件语言）

- **视觉契约单点化**：新增 `docs/ui/DESIGN.md`（Google design.md 格式，`designmd lint` 0 error）——颜色/字体/四档字号/圆角/间距/组件外观 + antd seed 映射表 + 组件 token 覆盖表；`layout.md §7` 与 `architecture.md` 指向它，改色唯一入口 = `AntdProvider.tsx`
- **主题 token 落地**：antd 默认蓝退役，改 Notion **工作区**暖灰（`colorPrimary`/`colorText` `#37352f` 暖炭墨、`colorBgLayout` `#f6f5f4`、描边三层 `#c8c4be`/`#e5e3df`/`#ede9e4`、`colorLink` `#0075de`）；浅/深各一套 seed（`theme.token` 显式值在算法派生后覆盖，必须分模式写）；组件 token 仅覆盖 Button/Menu/Table/Input/Select/Tag/Typography/Card 少数项；`controlOutlineWidth: 0` 关掉 selector 组件聚焦环（聚焦 = 1px 描边）
- **组件语言收敛 antd（删第二套系统）**：自绘 `ui/button`、`ui/input`、`ui/sonner` 退役；`SectionCard` → antd `Card`、`EmptyState` → antd `Empty`（对外 props 不变、调用点零改动）；22 处原生 `<select>` → antd `Select`；反馈层 sonner → antd `message`（`<App component={false}>` 上下文）；依赖删 `lucide-react` / `sonner` / `class-variance-authority`
- **图标单点化**：`@ant-design/icons` 为全站唯一图标集（`lucide-react` 退役），尺寸改随字号档（`text-xs/sm/base/xl/2xl`），状态用 Filled、操作与导航用 Outlined
- **排版四档制**：页面标题 20 / 区块标题 16 / 正文 14 / caption 12——`PageTitle` 薄壳（`Typography.Title level={4}`）统一全站页头，`Typography.titleMarginBottom: 0` 接管标题下边距；删手写 10/11px/0.8rem 字号；界面衬线全退（`--font-serif`/`--font-heading` 删除，书封模块 `lib/book-cover.ts` 因无消费者一并删除）
- **纪律守卫可执行化**：新增 `design-discipline.test.ts`（扫描源码：lucide 导入 / 硬编码色 / `!` 前缀类 / 手写字号 / antd 根元素上被无层 CSS 压掉的类）+ 规则自检；连带清除 74 处 `!` 前缀类与 6 处被 antd 压掉/无效的类
- **修的一类隐形 bug**：antd 样式是运行时注入的**无层 CSS**，会静默压掉 Tailwind 工具类（`@layer utilities`）——宽度改用外层容器承载；该规则写入 DESIGN.md 并由守卫测试兵底（历史满仓 `!` 的根因）

### Removed

- 依赖：`lucide-react`、`sonner`、`class-variance-authority`、`react-markdown`（均零消费者：图标/提示/按钮已收敛 antd，聊天 Markdown 走 `@ant-design/x-markdown`）
- 死代码：`lib/book-cover.ts`（无生产引用）、`ui/button.tsx`/`ui/input.tsx`/`ui/sonner.tsx`、`index.css` 遗留圆角变量与 `--radius`

## [v0.0.27] - 2026-09-10

### Added（用户反馈七项修复与优化——中栏悬浮入口 / 快捷键 / 新建聚焦）

- **`Ctrl/Cmd + S` 保存快捷键**：`lib/save-shortcut.ts` 注册栈（后注册者优先，行内编辑优先于页面保存）——
  详情页表单（实体/大纲节点/时间轴事件/参考资料）注册页面级保存；伏笔编辑对话框与 5 处行内编辑
  （大纲标题摘要/设定树名称/时间轴事件名/时间点组名/参考资料标题）编辑中注册提交；
  无保存语义时不拦截浏览器默认
- **新建即聚焦**：新建成功后滚动到新条目 + 3s 临时高亮 + 键盘焦点落行（设定树/实体列表行内新建/
  大纲节点/时间轴时间点，共用 `lib/new-item-focus.ts`）；新条目不在当前视图（排序/分页/筛选/
  上限截断）时静默跳过，不强行跳页
- **中栏右下悬浮「问 AI」按钮**：antd `FloatButton` 绝对定位于中栏容器（不越到右栏、不随内容滚动，
  `zIndex: 30` 不压过小屏抽屉遮罩）；InfoBar 同步移除该入口（带页面焦点注入右栏的语义不变）；
  **点击必有反应**——右栏收起（桌面）/小屏聊天抽屉关闭时先展开/打开再聚焦输入框，
  无项目打开或未选中具体条目时给中性轻提示（不置 `disabled`，避免点击与 tooltip 被吞）
- **中性轻提示（`ToastKind` 增 `info`）**：引导类提示与成功/错误语义分离（sonner `toast.info`）

### Fixed

- **右栏 focus 小条不再直显裸 `entity id`**：改走 `names/resolve`——解析中只显类型名、命中显
  「类型 名称」、失败才退 id；补 event/timepoint/reference 类型中文映射（右栏唯一遗漏点，工具调用行/
  提案卡此前已解析）
- **实体列表页移除一级化残留**：「实体」标题与类型 Segmented tab（类型切换归左栏 NavRail），
  设定/关联页因去标题产生的空分隔条一并移除
- **设定页新建设定后焦点不落到新条目**（并入「新建即聚焦」，设定树/实体列表/大纲/时间轴同款）
- **设定树拖拽插入线不明显**：`h-0.5` 细线 → 3px 主线 + 两端圆点（手动模式同级重排落点更醒目）
- **参考资料详情页保存补 `saving` 重入门禁**：快捷键可绕过「保存」按钮的 disabled，草稿态会重复创建

### Removed

- **面包屑结构整站移除**：`components/page-nav/Breadcrumb.tsx` 删除 + 4 处详情页使用
  （实体/大纲/时间轴/参考资料详情）——一级化后「实体 › 类型 › 名称」层级结构已失效，
  详情页返回走左栏 NavRail
- **死代码清理**：`client/src/hooks/use-api.ts`（`useApi` 通用请求 hook，全仓无引用）删除

## [v0.0.26] - 2026-09-06

### Changed（antd 全站迁移 + 布局重构 + 会话渲染重做）

- **前端组件基座换 antd v6**：ConfigProvider（zhCN + 默认色板浅/深双算法 + cssVar）为根接线；
  `@ant-design/x` 会话组件族（Bubble/Sender）+ `@ant-design/x-markdown` 流式正文接入；
  `@base-ui/react`/shadcn CLI 退役卸载；index.css 语义色变量映射 antd cssVar tokens（oklch
  文学色清零；禁硬编码色值，FOUC 兜底唯一例外）；Dialog/ContextMenu/Popover 改自绘
  （createPortal + Esc/外部关闭 + 视口 clamp），旧 Base UI #31 菜单契约随退役失效
- **布局重构**：`#/` = 书架主页（书籍列表/当前高亮/新建/导入/导出/重命名/打开其他路径），
  `#/overview` = 项目概览；左栏 NavRail（回到书架按钮 + 垂直导航 9 项 + 回收站工具区 +
  设置 `#/preferences`/主题）；中栏 TabBar 移除，全站无二级 tab；路由一级化
  （characters/setting/locations/relations/hooks/:id/timepoints/:id），旧
  `#/entities/*`/`#/settings` 全量重定向；实体泛型入口去重（伏笔/事件/时间点由富页与宿主段承接）
- **会话渲染重做**：消息流 x Bubble + x-markdown（流式增量渲染，滚动跟随 + 思考指示）；
  Sender 输入（IME 安全内建）；工具调用行 Collapse + 状态 Badge、提案卡 antd 按钮、断连/错误
  Alert、focus 小条 Tag、会话切换 antd Dropdown；历史 wire 形态 tool_calls 渲染层双形态归一
  （修展开 `{}` 显示）
- 存量页面逐页换壳（实体列表 Segmented/Pagination、参考资料/回收站/设置/备份区块/关联总览、
  详情页等视觉件 antd 化）；页面组织与后端 API 解耦原则入 architecture.md
## [v0.0.25] - 2026-09-05

### Changed

- **文档体系重组（按全局规则组织）**：`doc/` → `docs/`——api 拆分为 `api-public.md`/`error-code.md`/`00-api-index.md` + `10-api-project.md`~`90-api-settings.md`（原 endpoints.md 按模块拆分）+ `tool-calling.md`（原 tools.md）；design 拆出 `milestone.md`/`config.md`/`build.md`（分别承接 tasks.md 演进路线与 architecture.md 构建部署段）并编号详细设计（`00-master-design`/`10-data-model`/`20-context`/`30-agent-loop`）；删除冗余文档（doc/README、data-flow、backlog、hooks、security、ui/pages/* 各页面细案）；db 目录更名 `db/`
- **architecture.md 分包方案去代码文件级**：删除 160 行包内文件树，只保留包级职责/依赖方向/依赖声明——包内文件结构以代码为事实源，文档不再制造耦合点；构建与部署整节移入 build.md
- **ui/layout.md 去 CSS 样式细节**：只保留三栏总体布局、路由、各栏结构、交互红线（操作按钮不收入更多菜单/文字按钮与文本视觉区分/Base UI 菜单契约/右键菜单/行级交互模式）——样式实现归 client 代码，杜绝文档样式漂移
- AGENTS.md / README.md / 各设计文档引用路径与阅读顺序同步；schema.md 承接 hooks.md 仍生效契约（hook data 字段指 shared schema、伏笔关系类型表已在 relation_records 节）
- 纯文档/工程维护版：无 API/数据/前端代码变更

## [v0.0.24] - 2026-09-05

### Added

- **多 provider 接入——OpenCode Go 订阅**：全链路支持第二家 LLM 提供商（pi-ai `opencode-go` provider，15 模型：qwen3.7-max / glm-5.x / kimi-k2.6+ / minimax-m3 / grok-4.5 等，含撞名 deepseek-v4-flash/pro）：
  - `llm` 包注册 opencode-go + `ChatStreamParams.provider`（缺省 deepseek 向后兼容）+ provider-aware 模型解析——**只在同 provider 目录内查/兜底，绝不跨 provider**（撞名模型防串 key）；历史重放消息元数据跟随目标模型 wire 协议族（anthropic-messages / openai-completions / openai-responses 混用目录）
  - 用户级配置 `~/.ai-editor/config.json` **schema v2**：新增 `provider` + `api_keys`（per-provider key）；v0/v1 旧文件读侧兼容不迁移不写回，首次保存自然落 v2
  - 每 provider 三级 key 解析链：环境变量（`DEEPSEEK_API_KEY` / `OPENCODE_API_KEY`）> 用户配置 `api_keys[<provider>]` > **pi-agent 配置 `~/.pi/agent/auth.json` 只读兜底**（`type === "api_key"` 条目；绝不写回）；key 一律不入项目文件
  - GET/PUT `/api/v1/settings/llm` v2：响应含全量 `providers[]`（各家模型目录 + key 状态掩码）；PUT 接受 `{ provider, model, api_keys }`，服务端校验 model ∈ provider 目录（撞名模型无 provider → 400 歧义）
  - 设置页 AI 模型区改为**每提供商一张卡片**（竖排一行一张）：卡内模型下拉点选即激活（provider+model 成对）+ key 保存/清除/掩码 + 激活高亮
  - 聊天工具条 ChatModelBar：模型下拉按 provider `optgroup` 分组（复合 value `provider::model`）、**未配 key 的 provider 整组禁用**（激活组恒可选防困死）、上下文占用条随激活模型 contextWindow 计算
  - 真机联调：三级 key 链生效（pi-agent auth.json 兜底命中）；opencode-go 调用 401 欠费（账户侧问题，链路全通）；deepseek 回归正常

### Changed

- 品牌正名：接入的是 **OpenCode Go 订阅**（`opencode-go`）；**OpenCode Zen（pi-ai `opencode` provider）是另一订阅，不接入**——两 provider 在 pi-ai 共享 `OPENCODE_API_KEY` env，混接串 key；UI/文档全部去除「Zen Go」命名
- 设置页 AI 模型卡片布局：两列并排 → 单列竖排（一行一张）
- 清理发布前冗余：移除 llm 包无消费者的 `FALLBACK_MODEL` 显式导出
- 测试：全仓 1702 全绿（shared 157 / llm 46 / db 260 / server 387 / client 516 / tools 242 / agent 94）+ typecheck/lint 通过；契约文档（endpoints.md §系统设置 / ui settings.md / chat.md / security.md / architecture.md）随版本同步

## [v0.0.23] - 2026-08-25

### Changed

- **文档体系重构（2026-08）**：删除 `doc/design/decisions.md` / `decisions-history.md` / `release-review.md`——历史决策档案由 `git log`/CHANGELOG 回溯；仍生效的架构契约由**详细设计四篇**承接（`data-model.md` 数据模型与存储 / `context.md` 上下文与提示词 / `agent-loop.md` agent 循环与提案 / `security.md` 安全基线，只承载「为什么 + 不变式」，字段/端点清单仍以 schema.md/endpoints.md 为准）
- **全仓「决策 N」编号体系清除**：代码注释与文档中 2344 处「决策 N」引用、79 处「契约来源：doc/...」头注释段、E1-E6 里程碑代号、release-review §引用全部移除——代码注释只保留实现意图（语义无损，括号内约束/理由描述保留），文档自包含；**注释与文档彻底解耦，文档增删不再牵连注释**
- **AGENTS.md 重构**：去除「决策 N」编号体系，保留浓缩约束清单，导航指向详细设计四篇；状态段同步更新
- **纯文档/注释变更**：无 API/数据/前端行为变更；全仓 1692 测试全绿 + typecheck/lint 通过

## [v0.0.22] - 2026-08-24

### Changed

- **db 查询层引入 drizzle-orm（决策 49）**——查询构建器 + 行类型推断提升开发体验，纯工程重构（无 API/数据/前端变更）：
  - 引入 `drizzle-orm` 0.45.2（stable，better-sqlite3 同步驱动）；**不引入 drizzle-kit**——迁移管线维持自建 `PRAGMA user_version` 三态分流（E4 未来版本拒绝打开 / E5 增量迁移）
  - 表结构声明收敛 `packages/db/src/tables.ts`（4 表 `sqliteTable` 定义 + 手写 DDL 常量同文件，schema.test.ts「列名/类型/notNull/主键」对齐断言锁双份同步）；`schema.ts` 瘦身为版本工具（user_version 三态）
  - 查询模块函数签名保持 `(db: Db)` 不变（调用方零改动），内部经 `queryDb` 辅助（WeakMap 缓存 drizzle 实例）混合风格渐进替换：**实现层 61 处 prepare 全部清零**——trash（13）/ delta（9：8 builder + 1 sql 模板 order 聚合）/ chat（5：listSessions 相关子查询聚合走 sql 模板参数绑定）/ relation（11：同表二次 join 用 alias）/ entity（23：动态 where、LIKE 通配符透传、排序白名单列对象、JS 过滤路径、inArray 动态占位符、批量 sort_order、级联软删，复杂排序/EXISTS 跨表 2 处 sql 模板）；compute-state/outline-ops（0 prepare 纯调用层）零改动；migration 管线保持 native
  - **约束保持**：JSON 列（data/changes/metadata/tool_calls）text 模式 + 行映射层防御解析（drizzle json mode 对坏 JSON 抛错，弃用）；shared API 契约类型不动（类型不反向流入 shared）；事务仍为 native `withTransaction`（连接级共享已验证：异常回滚两侧不可见）
  - 全仓 1692 测试全绿（测试文件一字未改）+ typecheck/lint/build 通过；15.1-15.6 每卡「并行 worker 实现 + oracle 独立审查」零阻断

## [v0.0.21] - 2026-08-23

### Changed

- **pnpm 11.8.0 → 11.22.0 升级（2026-08 工程维护）**：`packageManager` 声明与 CI `pnpm/action-setup` 硬编码版本同步更新；corepack 缓存清理旧版本（10.31.0/11.7.0）；`pnpm install --frozen-lockfile` 与 allowBuilds 配置在 11.22.0 下验证兼容（lockfile 零变更）

## [v0.0.20] - 2026-08-23

### Changed

- **2026-08 用户反馈（决策 47/48 + 决策 27 修订）**：
  - **工具调用展示人类可读化（决策 47）**——会话中工具调用行/提案卡不再 JSON dump 原始参数（含裸 id）：新增 `POST /api/v1/names/resolve` 批量名称解析端点（按 id 前缀分流查库：实体/大纲节点/时间点/参考资料；`rel-` 与未知/软删 → null）；右栏 ToolCallRow 展开态与 ProposalCardView preview 改摘要渲染（「查询实体：人物「张三」」级），id 字段解析失败/未知工具回退原始 JSON 兜底，历史消息回放同路径
  - **备份频率新增 1 分钟档（决策 27 修订）**——`BACKUP_FREQUENCIES` 加 1，服务端校验/前端下拉自动生效（纯增量，其他逻辑不动）
  - **用户级配置格式正式化（决策 48）**——`~/.ai-editor/config.json` schema v1：shared `userConfigFileSchema`（schema_version=1 可选、宽松读取、未知字段保留），旧格式读侧兼容不写回、设置页保存时自然升级；多供应商 v2 用户裁决放弃，记录 backlog #17
  - 全仓 1690 测试全绿 + typecheck/lint 通过

## [v0.0.19] - 2026-08-21

### Fixed

- **卡 13.1（2026-08 用户反馈——人物页「状态是什么？」）**：character 列表「状态」列移除——`data.status` 为无定义自由文本、存量恒空、列表恒显示「—」，用户无法理解其含义（信息展示缺陷）；详情页表单字段一并移除（列表与详情均不再展示，存量数据容错保留，AI 工具 filters.status 语义不变）
- **卡 13.6（2026-08 用户复核）**：人物行首版两行式布局两处缺陷修复——①单 `<td>` 渲染与「名称|角色」双列表头错位致**角色列空白**；②性格/能力合并 chips 无法分辨；用户裁决改为**角色/性格/能力独立成列**
- **卡 13.6 复修（2026-08 实测）**：四列版性格/能力两个 `<td>` 直接加 `flex` 类，覆盖 `table-cell` 后被浏览器表格布局塞进同一列槽（Chromium 实测两列 left 同为 573px 完全重叠）——改为 td 保持 table-cell、flex 移入内层容器；红线补入 layout.md §4.4

### Changed

- **2026-08 用户反馈（人物列表行信息修订 + 设定树体验增强，决策 45/46）**：
  - **人物行四列布局（决策 45 修订）**——名称列（名称 + 第二行动机摘要，`summary.motivation` 截断 40）/ 角色列（`summary.role` 徽标）/ 性格列（`summary.personality` 前 2 chips）/ 能力列（`summary.abilities` 前 2 chips），空值「—」占位；服务端 toSummary character 摘要扩展（motivation 截断 40 + personality/abilities 各前 2，防工具上下文膨胀决策 15 同款语义）
  - **设定树行显示描述**——`summary.description`（截断 100）以弱化行显示于名称下方，hover title 查看完整，空描述不渲染
  - **设定树手动排序（决策 46，修订决策 42「设定无 sort_order」约束）**——工具栏「排序方式」切换器（名称 / 创建时间 / 手动，同级组内排序、层级不变）；手动模式行悬停 **↑↓ 箭头按钮** + 拖拽**行间插入线**重排（拖到行中段仍 = 调层级）；复用 `entities.sort_order` 列承载同级组内线性序（**无 DDL 迁移，SCHEMA_VERSION 5 不变**），`EntitySummary.sortOrder` 仅 setting 填充；**复合端点 `PUT /api/v1/entity/setting/:id/move`**（改父 + 组内重排一次事务提交，防环沿用决策 30，仅被移行刷 updated_at——决策 14 版本戳语义），前端改父流程由「建边+删边两步」收敛为复合端点
  - 全仓 1657 测试全绿 + typecheck/lint/build 通过；真实浏览器（Chromium）几何断言验证四列对齐

## [v0.0.18] - 2026-08-20

### Fixed

- **R1（2026-08 用户反馈）**：参考资料新建 md 文档草稿态标题编辑丢失——编辑标题后焦点移到正文，标题仍显示「新建 md 文档」（显示逻辑写死占位文案、不读表单值）；修复为标题显示 `form.name` 优先，草稿态编辑即时反映

### Changed

- **2026-08 用户反馈（参考资料页体验优化 + 决策 44 分类自定义 + 设定树/标签样式）**：
  - **R2 空态去重**——参考资料空态移除书籍图标与「新建 md 文档/新建外源链接」按钮（顶部标题行已有新建入口），保留纯文字提示；筛选无匹配分支保留「清空筛选」
  - **R3 列表表格平铺**——行信息改 thead 四列（标题/分类/标签/来源）+ 单行 tr（对齐实体列表表格样式），行高减半；分类列直接显示文字不包裹徽标；保留点击标题行内编辑/双击详情/删除/右键菜单
  - **R4 草稿态去分类徽标**——新建时标题右侧不再显示分类徽标（分类未定且下方已有分类输入区）
  - **R5 面包屑组件化**——详情页顶部「← 参考资料 / 标题」纯文本改为 Breadcrumb 分段 pill（对齐实体/大纲详情页）
  - **决策 44：参考资料分类自定义**——取消预置枚举（material/inspiration/theory/reference）：`data.type` 放宽自由文本（shared schema 与 AI 工具 search_references/propose_create_reference 参数 `z.enum → z.string`，缺省 material 写入侧兜底，无 DDL 迁移 SCHEMA_VERSION 5 不变）；详情页分类 select 改为文本框 + datalist（建议项 = 项目内已用分类，可自由输入新分类）；列表筛选下拉聚合现有分类；存量枚举值保留并回显中文名；md 文件 frontmatter category 自由文本同步
  - **T1 设定树标签移行尾**——设定树行标签收进行尾操作区、删除按钮左边，不再紧跟名称干扰树呈现
  - **T2 全仓标签徽标样式强化**——3 处展示型标签徽标（设定树行/时间轴事件行/参考资料列表）从 `bg-muted/bg-secondary + 灰字` 改为 `bg-primary/80 + text-primary-foreground`（参考新建按钮强调色系：背景淡一档、浅色主题白字）；layout.md §4.3 补标签徽标规范
  - **T3 实体关系页入口去重**——实体二级 tab 移除「参考资料」（已有独立中栏 tab `#/references`，泛型表格重复入口），旧路由 `#/entities/reference[/:id]` 重定向 `#/references[/:id]`（对齐决策 42 先例）；清理实体泛型视图 reference 死代码（含决策 44 过时枚举）
  - 全仓 1639 测试全绿 + typecheck/lint/build 通过

## [v0.0.17] - 2026-08-20

### Added

- **参考资料两类承载：本地 md 文件 + 外源链接（决策 43，2026-08 用户反馈）**：
  - **参考资料两类承载**——`data.kind` = `file`（本地 md 文档）/ `link`（外源链接）；存量条目运行时兼容（无 kind 按 link 类展示），无 DDL 迁移（SCHEMA_VERSION 保持 5）
  - **文件 = 真相源，DB 索引 = 派生镜像**——md 文件 = YAML frontmatter（title/category/tags）+ markdown 正文，项目目录 `references/` 自包含；应用内编辑先原子写文件再更新 DB（正文真相在文件）；外部编辑/新增/删除靠扫描同步（mtime 快照比对，幂等全量，新增/更新/还原/软删四向）
  - **扫描重建**——`POST /api/v1/reference/scan`（added/updated/restored/removed/skipped/errors 统计）+ `GET /reference/scan/status` 只读探测（未同步计数，无副作用）；列表页「扫描」按钮 + 未同步提示条引导
  - **页面**——新建入口分流「新建 md 文档」/「新建外源链接」（草稿态详情页）；md 详情页内嵌 markdown 编辑器（@uiw/react-md-editor 4.1.1：textarea 源文本 + 分屏实时预览，data-color-mode 随主题联动）+ 分类/标签编辑 + 导入 md 文档（纯前端 FileReader + frontmatter 解析预填）+ 建立关联面板；外源链接详情页（URL 必填 + 备注 + 关联面板）；列表交互对齐大纲（点击标题行内编辑、双击详情、只留删除、行信息 [标题/分类/标签/来源]）；右键菜单复用（注入会话上下文 + 建立关联）
  - **存档体系联动**——备份/导出/导入/恢复 zip 打包 `references/` 目录（含 `.trash/`，项目自包含）；自动备份变更检测加 references/ mtime
  - **AI 工具联动**——propose_create_reference 创建的条目归 link 类（source → url）；search_references / get_entity 经 content 镜像纯 DB 读取
  - **软删/回收站文件联动**——file 类软删文件移入 `references/.trash/`，restore 移回、purge 物理删
  - 跨书籍导入参考资料记录为未来迭代（backlog #16）
  - 全仓 1639 测试全绿 + typecheck/lint/build 通过；列表编辑对话框异步回填竞态（B1）随交互重构根除

## [v0.0.16] - 2026-08-20

### Changed

- **交互优化与新需求（决策 37-42，2026-08 用户反馈）**：
  - **决策 37：大纲交互优化**——移除行级「详情」「＋新建」按钮（只留删除）；选中节点按 Enter 新建子级（就地输入行出现在子级末尾，Enter 确认/Esc 取消）；双击节点查看详情（#/outline/:nodeId）；点击标题行内编辑（现有单击编辑保留）；拖拽排序保留（HTML5 DnD）
  - **决策 38：时间轴交互参考大纲**——事件行与组标题行采用大纲交互模式：双击=详情、点击标题=行内编辑、移除「详情/编辑」按钮（保留删除）；新建/拖拽/折叠/标签筛选等现有能力保留
  - **决策 39：移除实体二级页列表更新时间**——实体关系设定列表（EntityList 表格）移除「更新时间」列与排序选项；详情页（EntityDetail 等）创建/更新时间元信息保留
  - **决策 40：右键菜单替代行级问 AI**——删除全部 6 处行级 AskAiButton（实体/伏笔/参考资料/大纲/时间点/事件）；新增右键菜单（Base UI ContextMenu 封装）——「注入会话上下文」（复用 chat store focusContext）与「建立关联」（新建 relation_records，源端点按行对象预填）；InfoBar「问 AI」统一入口保留
  - **决策 41：项目规则文件 AGENTS.md**——项目目录 AGENTS.md 为项目规则唯一事实源；project.json `prompt` 字段废弃——打开项目时 prompt 存在且无 AGENTS.md 则自动迁移写入；设置页改为直接编辑 AGENTS.md；web 读取检测外部修改（mtime）；「## 项目设定」注入逻辑保留（数据源改为 AGENTS.md）；修订决策 25（rules.md 否决记录被取代）
  - **决策 42：实体设定页树形视图**——设定列表改为树形视图（参考大纲页设计）与设定树 tab 合并——层级天然展示；折叠/展开、行内编辑、拖拽调整层级（belongs_to 防环沿用决策 30，先建新边后删旧边）、Enter 新建子级、双击详情；筛选改为搜索+标签过滤（树内过滤），移除表格分页；`#/entities/setting-tree` 重定向到 `#/entities/setting`
  - 每卡临时分支 + git worktree 并行开发（4 波次），独立 oracle 审验全 PASS，线性合入 main；全仓 1600 测试全绿 + typecheck/lint/build 通过；发布 v0.0.16（8 包版本同步）

## [v0.0.15] - 2026-08-19

### Changed

- **LLM 引擎换核 + 中栏演进 + 参考资料页（决策 34/35/36，2026-08）**：
  - **决策 34：引入 `@earendil-works/pi-ai` 替换自研 LLM 调用层**——llm 包保留对外契约（chatStream/LLMStreamEvent/LLMError），内部改单向声明式 adapter（LLMMessage→pi-ai Context、流事件转发、usage 口径、错误归一化 onResponse 恢复 status）；手写 SSE 解码/流式 tool_call 累积/错误 body 归一化（~300 行）删除；agent/server 上层契约零破坏；保留 retry.ts（决策 15）/token.ts（决策 6）；新增 `getAvailableModels` 模型目录接口（id/provider/contextWindow/maxTokens/reasoning）
  - **决策 35：中栏 AI 集成演进**——InfoBar 统一「问 AI」入口（无特定对象时纯进入聊天并聚焦输入框）；页面行级「带上下文问 AI」按钮（Sparkles：大纲节点/实体行/伏笔行/时间轴事件与时间点/参考资料行，注入该对象 focus + 聚焦聊天——回归 layout.md §4.2 原始设计，补齐「有焦点」显式入口）；页面焦点上报（EntityDetail/ReferenceDetail 挂载上报 currentFocus，MainPanel 路由切换 useLayoutEffect 清空）；继续当前会话语义（不自动开新会话）
  - **决策 36：参考资料页（第 7 种实体类型 reference）**：`ref-` 前缀，SCHEMA_VERSION 4→5 迁移（CHECK 扩 7 种四步换表）；data 字段 type 分类枚举（material/inspiration/theory/reference）+ content 全文长文本 + source 来源 + tags 标签；列表摘要截断 120 字 / 详情全文（防 AI 工具上下文膨胀）；TabBar 新增「参考资料」tab（时间轴后回收站前）+ 列表/详情页（分类/标签/搜索筛选 + 全文详读）；LLM 集成 `search_references`（自动查询，summary.type 过滤）+ `propose_create_reference`（提案写入，确认后落库，type 缺省 material）
  - **右栏增强**：模型选择下拉（用户级配置持久化 getAvailableModels）+ 思考强度选择（档位对齐 pi ThinkingLevel：off/minimal/low/medium/high/xhigh/max，off 不传 reasoning）+ 上下文占用进度条（真实 usage.total ÷ 模型 contextWindow，done SSE 帧附带 usage）
  - 冗余清理：llm 包死类型（LLMStreamChunk/FetchLike/FetchResponseLike/TextDecoderLike 等）与 retry.test 死 helper 删除
  - 全仓 1556 测试全绿 + typecheck/build 通过；发布 v0.0.15（8 包版本同步）

## [v0.0.14] - 2026-08-19

### Changed

- **体验优化与画布重构（O1-O6，2026-08 用户反馈，决策 33）**：
  - O1 设定/标签筛选可搜索下拉（`SearchableSelect`：Popover + 关键词客户端过滤已聚合候选 +「全部」清除 + fallbackLabel 兑底，重构原原生 `<select>`）；
  - O2 大纲页节点行操作区右端对齐 + 顺序改「详情 → 添加 → 删除」（＋ 就地新建），移除行尾修改时间显示；
  - O3 时间轴移除 GripVertical 拖拽柄视觉（draggable 与悬停拖拽提示保留在行根，参考大纲页无柄拖拽）；
  - O4 时间轴折叠/展开按钮移至时间点组标题左侧（参考大纲页折叠箭头位序）；
  - O5 设定树视图新增「全部展开 / 全部折叠」工具栏按钮（折叠态提升受控层 + `expandableSettingNodeIds` 纯函数）；
  - **O6 画布页移除（决策 33）**：删除 `#/canvas` 路由、中栏「画布」tab（7→6 tab）、`pages/Canvas.tsx` 与 `lib/canvas.ts`（及测试）；`plot_edge` 数据模型与 `POST/GET/DELETE /relation` 关系接口能力完整保留（仅无 UI 入口）；旧 localStorage 画布坐标为无害残留不清理；同步删除画布死后 CSS（`canvas-edge-flow`）。
  - 每卡临时分支 + git worktree 并行开发（O1‖O2‖O3O4 → O5‖O6），独立 oracle 审验全 PASS，线性合入 main；全仓测试 1562 个全绿 + typecheck/lint/build 通过。

## [v0.0.13] - 2026-08-19

### Added

- **设定列表上级设定筛选（N1-N2，2026-08 新需求，决策 32）**——实体关系页「设定」tab 新增「上级设定」筛选：选择某上级设定后，列表只显示其**直接及所有后代设定（递归子树，不含上级自身）**：
  - `GET /api/v1/entity/setting` 新增可选查询参数 `parent_id`（**仅 setting 类型生效**，其他类型传入忽略），匹配语义 = 设定在层级树（belongs_to，决策 30）中直接或间接属于该上级；**复用既有 `listSettingHierarchyEdges` 全量层级边**（关系表索引、O(N)）建 childOf 邻接表栈式 DFS 收集后代集合（防环守卫 = Set 去重），走 db `listEntities` 既有 JS 过滤路径（total = 过滤后总数、分页正确；无过滤时保持 COUNT+LIMIT SQL 路径零回归）；与搜索 / 标签筛选 / 排序 / 分页组合（AND）；指向不存在的设定（含已软删）→ 空结果（宽松，同 tag 无匹配不 404）；软删联动由边查询可见性天然保证
  - 前端「上级设定 ▾」下拉（候选 = 全部设定按名称排序 +「全部」重置项，与「标签 ▾」并列；候选聚合与标签候选合并一次请求 limit 200）；父设定已软删或超 200 截断时下拉兑底「（已删除或不可见）」防空白；空态文案三分支（搜索无结果 / 「《X》下暂无设定」+ 清除上级筛选 / 无实体）；切换 tab / 类型重置
  - 设计文档：`decisions.md` 决策 32、`endpoints.md` 实体列表契约（`parent_id`）、`entity-list.md` 关键交互与空态；oracle 独立审核无 P0/P1（P2：`parent_id` 空串防御归一化 + 空态文档补正已随卡处理）

## [v0.0.12] - 2026-08-18

### Fixed

- **实体详情标签编辑器「输入后回车添加下一项」（M1，2026-08 用户反馈）**——placeholder 承诺了回车行为但未实现（回车无任何反应）：行内回车现在 = 添加下一项——非末行聚焦下一行、末行且非空追加空行并聚焦、末行且为空无操作（防空行跑马灯）；行为决策下沉 `lib/tags-editor.ts` 纯函数（`enterBehavior`）+ vitest 覆盖

### Changed

- **设定列表行显示上级设定与描述（M2，交互优化，2026-08 用户反馈）**：
  - `GET /entity/:type` 列表响应：`EntitySummary` 新增 `parentId`/`parentName`（**仅 setting 填充**——服务端补查全量 belongs_to 层级边按 childId 映射，无父的设定不出现该字段，软删端点由既有可见性过滤兜底）
  - setting 摘要新增 `description`（**截断 100 字符**——列表行展示用，防 `search_entities` AI 工具上下文膨胀；完整文本在详情页）
  - 前端设定列表列：名称 | 标签 | 上级设定 | 描述 | 更新时间；上级设定渲染为可点击 chip（点击直达父设定详情，不触发行点击）；描述行 truncate + hover title 查看
  - 契约文档同步：`endpoints.md` EntitySummary 契约 + `entity-list.md` 信息层级表（顺带修正决策 31 后过期的 `summary.category` 表述）

### Added

- **标签列表拖拽排序（M3，新需求，2026-08 用户反馈）**——详情页标签编辑器（`rules`/`tags`/`personality`/`abilities` 共用组件）每行前置拖拽手柄（GripVertical + **HTML5 原生 DnD，零新依赖**）：拖动行降透明度 + 目标行 ring 高亮；仅在自身拖拽进行中响应 drop（不干扰输入框内文本拖选/拖入）；Firefox setData 兼容；排序只改本地表单数组随 `data` 提交（数组顺序即存储顺序，无独立 API）；`moveArrayItem` 纯函数 + 测试

## [v0.0.11] - 2026-08-18

### Changed

- **前端样式工程化（2026-08）**——长 className 单行难读、重复模式无提取的工程化改造：
  - client 包引入 **Prettier + prettier-plugin-tailwindcss**（`packages/client/.prettierrc.json`，printWidth 100）：长 className 自动折行、Tailwind 类顺序统一（布局 → 尺寸 → 颜色 → 状态），新代码格式由工具兑底
  - 新建 **`lib/styles.ts` 共享样式常量**（提取阈值 ≥3 处）：`iconButtonBaseClass`/`iconButtonSize`（bar/sm/md 三档）/`iconButtonDisabledClass`/`inputClass`/`errorBannerClass`/`skeletonClass`/`sectionCardClass`——改一处样式全局生效，禁止复制粘贴重复类
  - 新建 **`EmptyState`**（空态容器：虚线边框居中卡 + 文案 + 可选图标 + 主操作插槽，padding sm/md/lg 三档）与 **`SectionCard`**（区块卡：容器 + font-serif 标题 + action 插槽，上提自 OutlineDetail 局部实现）组件，统一全仓空态/区块样式
  - **全仓硬编码色类清零**（zinc/white/red 共 50+ 处 → token 类）：EntityList 表格/筛选/分页、EntityDetail 表单/层级区块、Outline 骨架/空态、Settings 说明卡等；深色主题下原 zinc 亮色异常同步修复；浅色主题观感一致（暖色 token 微调）
  - 空态统一为 EmptyState 后仅 1 处视觉微调：Timeline「标签筛选无匹配」内边距 py-8 → py-10
  - 全仓格式化（45 个 TSX 文件），行为零变化；`doc/ui/layout.md` 新增 §4.4「样式书写规范」契约

### Fixed

- （无行为修复；含样式层修复：深色主题下硬编码 zinc 亮色类导致的对比度异常）

## [v0.0.10] - 2026-08-17

### Added

- **实体关系增强（I1-I4，2026-08 用户反馈，决策 30）**：
  - I1 关系类型 `occurs_in` 中文映射补齐（17 种预定义类型全量映射，「锚定于」与「发生于（地点）」区分）
  - I2 详情入口图标统一为 Eye（大纲节点行 / 伏笔行；书架/项目语义的书籍图标保留）
  - I3 **设定层级 = `belongs_to` 关系（决策 30）**：`data.parent_id` 废弃（不再读写，passthrough 容错旧数据）；db 全量层级边邻接表 + 防环校验（自指/祖先链成环 → 400）；详情页「层级」区块（父/子设定分区展示 + 设置/修改/清除上级，先建后删防数据丢失）；新建行「上级设定」弹层搜索选择器（创建后补建关系，失败不阻塞）；关联列表与层级分区展示不再重复
  - I4 **设定树视图**：实体关系页第 6 个 tab「设定树」（路由 `#/entities/setting-tree`）——按 belongs_to 构建递归层级树，折叠/类别徽标/直接子数/节点点击跳详情，截断孤儿提升为根防御
- **输入提示与标签筛选（J1-J3 + K1/K2，2026-08 用户反馈，决策 31）**：
  - J1 设定分类统一为 tags（`data.category` 废弃），列表摘要列「类别」→「标签」，AI 聚合统计 byCategory → byTags
  - J2 **浏览器原生 datalist 自动完成**（零依赖）：新建行名称/首字段按现有数据动态聚合候选，设定详情标签补拉全量聚合，伏笔类别枚举候选
  - J3 设定列表**标签筛选**：`GET /entity/:type?tag=` 单标签包含匹配（复用内部 filters.tags 管道，不改表结构），前端「标签 ▾」下拉聚合既有标签，与搜索/排序/分页组合
  - K1 新建行加回标签输入（逗号分隔多值，中英文逗号均可）
  - K2 **分类字段统一 `data.tags`**（前后端同名），`data.rules` 恢复「规则条款」语义（仅详情页编辑）；**004 迁移（SCHEMA_VERSION 4，无 DDL 仅 data JSON）**：旧 rules 分类值复制到 tags 并移除（用户裁决旧数据视为分类标签）；标签编辑**快捷选择**（既有标签 chips 点击追加去重）+ datalist 补全
- **交互修正（2026-08 用户反馈）**：
  - 行内新建不再自动跳详情页（创建后留在列表刷新，需要进详情点行进入）
  - 全仓输入框 `autoComplete="off"`（shadcn Input 组件层默认 + 5 处原生 input）：禁浏览器表单历史建议，输入提示完全由代码控制（datalist 候选/快捷选择）

### Fixed

- 变更记录表单字段清单移除 `setting.parent_id`（决策 30 遗漏：satisfies 断言在 shared 类型更新后编译失败）
- 移除设定详情层级区块的技术内幕说明文案、新建行无意义 placeholder 示例

## [v0.0.9] - 2026-08-16

### Added

- **时间轴交互与视觉优化（用户反馈 H1-H6，2026-08）**：
  - H1 时间点组标题补齐「移入回收站」垃圾桶图标按钮
  - H2 移入回收站（软删）与回收站还原不再弹二次确认，仅彻底删除保留确认
  - H3 操作按钮全部展开，禁止收进 `...` 菜单：时间轴事件行、伏笔行、书架项目行改为直接图标按钮
  - H4 时间轴「+ 在此时间点新建事件」移到时间标签标题行横向排布；全仓文字型按钮统一加可见边框
  - H5 时间轴标题行信息与操作右移，重命名/在此时间点新建事件改为图标按钮（Pencil / Plus）
  - H6 事件行「N 节点」计数靠右，与操作按钮一起放入右侧信息与操作区
  - 时间轴事件详情按钮图标改为 Eye（眼睛），更符合“查看详情”语义

## [v0.0.8] - 2026-08-15

### Added

- **G3 时间轴操作后滚动位置保持（2026-08 用户反馈）**：任何操作（拖拽/重命名/新建/编辑/软删）后重拉期间保留旧数据渲染——列表 DOM 不卸载、滚动容器高度不塌陷、scrollTop 不被 clamp 归零，视觉焦点与操作点一致；loading 仅用于首次加载骨架
- **G2 时间标签点实体化（2026-08 用户反馈，决策 26 重大修订）**：
  - **新实体类型 `timepoint`（时间标签点）**：时间标签从事件剥离为独立实体（id 前缀 `tp-`，`name` = 时间标签文本，可重命名）；事件经 `occurs_at` 关系挂载到时间点（timepoint→event，**1:n**——事件至多挂一个）；`SCHEMA_VERSION 2→3`，E5 增量迁移 `003_timepoint.ts`——旧 `event.data.time_label` 同名合并为同一 timepoint + 建挂载关系 + 从 data 移除，无标签事件不建关系（= 未挂载），软删事件跳过
  - **双独立线性序**：时间点 `sort_order`（组间顺序，拖拽权威，**拖时间点不修改其下事件序**）+ 事件 `sort_order`（组内排序键，渲染时组内按事件全局序投影）；事件跨组拖拽 = 改挂载（服务端复合端点 `POST /entity/event/:id/move_to { timepoint_id, order }` 事务内一次提交，null = 移出未挂载区）
  - **时间轴 UI 重构**：时间点组块（组标题 + 计数 + [重命名] 行内编辑 + 折叠 + 组尾「+ 在此时间点新建事件」）+ 事件行（单条可拖）+ **未挂载兜底区**（无挂载事件平铺，可拖入任一时间点）；header「+ 新建时间点」双入口；事件表单移除 time_label，详情页新增挂载时间点选择器
  - **AI 工具替换**：移除 `propose_reorder_events`，新增 `propose_reorder_timepoints`（LLM 按时间点 name 语义排序 → 提案确认 → 重排时间点序）
- **G1 时间轴区块独立滚动（2026-08 用户反馈）**：时间轴页 header（标题/AI 排序/新建按钮）与标签筛选器固定，仅列表区独立滚动（事件多时操作入口恒可见）
- **用户反馈 F1-F9（2026-08）**：
  - F1 事件字段清空语义（时间标签/描述/标签可显式清除）
  - F2 自动备份补查 `data.db-wal`（WAL 模式写只刷新伴生文件，主文件 mtime 不变导致漏检——影响全部 data.db 写）
  - F3-F6 时间轴视觉重构（垂直时间轴线 + 事件卡 / 同标签归组 / 时间标签样式强调 / 行内完整描述展开收起）
  - F7 三栏可收起/展开 + 拖拽调宽（use-panels，localStorage 持久化）
  - F8 事件编辑已存在标签建议（suggestTags + TagSuggest 组件）
  - F9 LLM 按时间标签语义排序提案（`propose_reorder_events`，G2 后被 timepoints 版取代）
- **备份类型标签 + 备份重命名（阶段 B2.6，决策 29）**：
  - **手动/自动类型标签**：备份文件名新增 kind 标记段（`<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`）——手动备份带 `-m` 段（**无名称也带**，与自动备份可靠区分）、自动备份重命名后带 `-a-` 段；自动备份/覆盖前快照仍为纯时间戳；**旧格式完全兼容解析**（旧秒级 → 自动、旧带名称无 kind 段 → 手动），历史备份零迁移
  - **备份重命名**：设置页备份列表行内编辑（铅笔 → 输入框，Enter/确认提交、Esc/失焦取消）→ `POST /project/backup/rename { fileName, name? }`——只改名称段、时间戳与类型标签保持；空输入 = 清除名称；同名称幂等；目标已存在 → 409 `BACKUP_TARGET_EXISTS`（防覆盖丢失）；旧格式文件改名顺带规范化（补毫秒 + kind 段）
  - **列表契约**：`GET /project/backups` 响应项新增必填 `kind: "auto" | "manual"`；列表行显示「时间 + 简单标签（自动/手动）+ 自定义名称」；恢复确认框同步展示标签
- **备份命名增强（阶段 B2.5，决策 28）**：
  - **文件名毫秒精度**：备份文件名由 `<YYYYMMDD-HHmmss>.zip` 升级为 `<YYYYMMDD-HHmmssSSS>.zip`（本地时区 17 位时间戳，同毫秒冲突 +1ms 去重）；**旧秒级格式完全兼容解析**——历史备份仍可列出/恢复/参与保留策略，无需迁移
  - **手动备份自定义名称**：设置页「立即备份」旁新增「备份名称（可选）」输入框（maxLength 30）→ `POST /project/backup { name }` → 文件名 `<时间戳>-<名称>.zip`，列表与恢复确认框展示名称；名称校验（trim 后 1-30 字符、禁路径分隔符/保留字符/控制字符/纯点、自动剥 `.zip`）收敛 shared `sanitizeBackupName`（writeBackup 唯一执行点），非法 → 400
  - **列表契约**：`GET /project/backups` 响应项新增可选 `name` 字段；restore 白名单兼容三类文件名（毫秒级/带名称/旧秒级）
  - **UI 时间显示补秒**：备份列表时间 `MM-DD HH:mm` → `MM-DD HH:mm:ss`（同分钟内多次备份可区分，与毫秒级文件名配套）

## [v0.0.7] - 2026-08-13

### Added

- **MIT License**：仓库根 LICENSE（Copyright (c) 2026 whispering233）+ 8 个 package.json（6 发布包 + client + 根）补 `license: "MIT"` 字段

### Fixed

- **发布冒烟 ETARGET 超窗（v0.0.6 实录）**：`verify-installed.mjs` 改为**先轮询 registry 可见性再 install**——`npm view` 循环确认 6 个发布包 `@<version>` 全部可见（20×30s = 10 分钟窗口；npm view 与 install 同源，判断精准）后再执行 `npm install`；传播期内轻量轮询、传播完成即装（基本一次成功），超时仍未可见直接判失败（版本未发布/网络问题），不再盲重试完整 install

## [v0.0.6] - 2026-08-13

### Added

- **自动备份与恢复（阶段 B2，决策 27）**：
  - **自动备份**：服务运行期间按频率定时检查，**有变更才生成新备份**（三文件 mtime 判定 + 1s 容差防 checkpoint 自激）；备份存项目目录 `.backups/`（时间戳命名，格式与导出包一致），每项目保留最近 20 份自动清理（清理失败不阻塞主流程）
  - **备份频率设置**：设置页「自动备份」区下拉（关闭 / 每 5 / 10 / 15 / 30 / 60 分钟，**默认 10 分钟开启**），跟随书籍存 project.json（可选字段，读侧宽松/写侧显式）+ [立即备份] 按钮
  - **加载备份双通道**：设置页历史备份列表（时间/大小 + 行内[加载]，强确认 Dialog 明示「覆盖前自动备份当前状态」）；书架导入以 **project_id 为唯一 key**——匹配书架 → 覆盖恢复（`mode: "restored"`）、不匹配 → 导入新书（`mode: "new"`）；恢复走 E1 同款 zip 格式与 E4/E5 三态校验（坏包/高版本零触碰拒绝）
  - **同名不同 id 导入不再 409**：导入 Dialog 同名冲突二选一——重命名导入（预填「`书名 (2)`」）/ 保持原样（目录自动去重 `书名 (N)`，维持「目录名 = 书名」不变式）
  - **书架重命名书名**：项目行 ⋯ 菜单行内输入（原子移动目录 + name 更新 + 当前项目引用/定时器同步，失败回滚）
  - **恢复语义安全**：覆盖前自动快照当前状态（后悔药，同保留策略）；**保留当前项目 id**（会话历史按 project_id 隔离不断连）；跨项目恢复自动迁移 `chat_messages` 归属（旧 id → 当前 id，聊天历史不静默丢失）
- **实体类型补全**：第 5 种实体 `event`（时间轴，v0.0.5 阶段 C 引入后 README/UI 同步，中栏 7 tab）

### Changed

- import 响应契约新增 `mode: "restored" | "new"`（shared schema 同步，前后端共用）
- 备份/导出/导入/恢复共用同一打包与校验管道（`backup.ts` 提取，E1 export/import 重构 -200 行）

## [v0.0.5] - 2026-08-12

### Added

- **时间轴功能（阶段 C，决策 26）**：第 5 种实体类型 `event`（事件），中栏新增「时间轴」tab（伏笔与回收站之间）——事件列表拖拽排序（`sort_order` 全局线性序，拖拽为权威、自由文本时间标签仅展示）、标签数组分类筛选、详情页字段编辑与 `occurs_in` 锚定大纲场景（多对多，倒叙/多时间线可表达）、软删回收站；schema 增量迁移 SCHEMA_VERSION 1→2（`002_event_timeline`，E5 迁移机制首个真实用例——旧库打开自动前向迁移，数据保全 + 时间戳快照）
- **项目提示词编辑（阶段 B，决策 24/25）**：设置页可编辑跟随书籍的 `prompt`（注入 system「## 项目设定」段），规则文件机制否决（单一持久化上下文通道）
- **画布增强（S10.2-S10.5，参考 inkos）**：连线语义色（目标节点层级色 + hover 路径高亮三级优先级）+ 箭头 + 选中/路径流动虚线动画；右下角小地图（归一化节点矩形 + 视口框，自研零依赖）；「重新布局」按钮（保留已拖拽坐标的幂等重排，inkos `position ?? 自动计算` 模式）；hover 节点沿 plot_edge 向前 DFS 路径高亮（非路径降透明 0.2）

### Changed

- **画布连线交互（UX1）**：连线创建改为「拖出即连」（移除标签 Dialog，松手即创建）；连线标签**线上就地编辑**（选中连线 → 线中点内联输入，Enter/失焦提交，空标签清除）；拖线期间禁用 hover 高亮（修复连线时其他节点全暗的交互冲突）；新增 `PUT /api/v1/relation/:id` 端点（metadata 整体替换）
- **交互优化（UX2-UX4）**：侧栏新建项目行内化（书架头部行内输入框，失焦取消防误触）；时间轴关联节点全屏 Dialog → 轻量 Popover 弹层；实体新建 Dialog → 列表首行内联编辑行（提交成功仍跳详情页）；书名校验抽取 `validateBookName` 三处复用
- 无项目时业务 tab 点击引导回概览（toast「请先创建或打开项目」），不再落到 409 错误横幅

### Fixed

- 画布连线创建时其他节点全部降透明（S10.5 hover 高亮与连线创建的交互冲突，UX1）

## [v0.0.4] - 2026-08-04

### Changed

- 启用 CI OIDC 发布链路（npmjs Trusted Publisher ×6 配置完成）——push 版本 tag 后自动发布 6 包 npm 并安装态冒烟验证，发布全流程自动化闭环

## [v0.0.3] - 2026-08-04

### Fixed

- npm 发布管道最终修复：npm 12 的 publish 在 postpack 恢复**之后**生成 registry manifest，prepack 替换只影响 tarball——改为发布前主动执行替换与 SPA 拷贝 + `npm publish --ignore-scripts`，manifest 与 tarball 一致；**0.0.3 是首个可正常安装的版本（0.0.1/0.0.2 manifest 残留 workspace:*，勿安装）**

## [v0.0.2] - 2026-08-04

### Fixed

- npm 发布管道修复：npm 12 的 `npm publish` 用 postpack 恢复后的 package.json 生成 registry manifest，导致 0.0.1 的 manifest 残留 `workspace:*`（`npm install` 报 EUNSUPPORTEDPROTOCOL）——改为发布前主动替换 workspace:* 后恢复；**0.0.1 已标注废弃，请使用 0.0.2**

### Changed

- 发布包名由 `@ai-editor/*` 改为 `@whispering233/ai-editor-*`（`@ai-editor` scope 在 npm 已被其他用户占用，无法发布）

## [v0.0.1] - 2026-08-04

首个正式发布（MVP 完整交付）。

### Added

- **项目管理**：书架模式（books/ 子目录，决策 8）、项目创建/打开/关闭/配置、启动待命语义（无项目不初始化）、LLM 设置（用户级配置，key 绝不入项目文件）
- **大纲**：严格三层（卷→章→场景）增删改移、行内就地编辑、拖拽排序（上下半判定）、节点详情页（麦基《故事》结构化字段：场景目标/冲突层次/价值转向、章反转/高潮场景、卷激励事件/幕高潮，决策 23）
- **实体与关系**：四类实体（人物/设定/地点/伏笔）CRUD、通用关系表 k 跳遍历、Delta 变更追踪与 computeState 状态计算（树路径父链累积，决策 9）
- **回收站**：软删/级联还原/purge 清理、restore 祖先链校验、启动一致性校验兜底（以大纲节点软删为准补标，决策 12/16）
- **画布**：大纲节点画布投影（自动布局/拖拽/缩放/仅场景模式）、布局持久化 localStorage（按项目隔离）、plot_edge 剧情连线创建与删除（标签 + 物理删确认）、节点伏笔标记（决策 10）
- **伏笔系统**：伏笔面板（活跃/已回收/已废弃分组、新建埋点、复合写确认、依赖链递归展开、软删级联）、大纲节点伏笔徽标（plants/advances/resolves，S9）
- **AI 对话链路**：DeepSeek SSE 流式客户端（手写解析/abort 三保险/截断防御）、44 个工具（查询 8/分析 5/伏笔 5/提案 14/执行 12）、agent 主循环三重保险（8 轮/120s/token）、提案确认流程（快照重校验/一次性消费/TTL）、chat SSE 路由（心跳 15-30s/三路断开检测/全链路取消，决策 20）
- **三栏工作台 UI**：左栏书架树（项目→会话二级树）、中栏信息条 + 6 tab、右栏常驻 ChatPanel（<1024px 折叠抽屉）、oklch 文学氛围双主题（暖羊皮纸/蓝黑曜石）、会话归属项目（决策 22）
- **全局反馈**：toast/错误横幅/确认对话框、应用级 ErrorBoundary 防白屏、数据变更自动刷新信号
- **数据备份（E1-E3）**：一键导出完整项目（zip 打包三文件 + WAL 完整快照）/ 从备份导入为新书（服务端校验 + 原子搬入，不覆盖现有书）——数据主权归用户
- **schema 安全（E4-E5）**：未来版本拒绝重建（PROJECT_VERSION_NEWER）、增量迁移机制（migrations/ 按序执行 + 迁移前时间戳快照 + 失败可续跑）
- **调试基础设施**：创作根 `.ai-editor/config.json` 五类别调试日志（chat/request/stream/usage/http）
- **打包安装**：6 包 tarball 安装链路（prepack 钩子：SPA 随包 + workspace:* 替换）、端到端冒烟测试（9 步链路）

### Changed

- UI 从「顶栏 + 侧栏 + 内容区」重构为三栏工作台（1:5:4，决策 22），`#/chat` 独立页移除——聊天常驻右栏
- 大纲交互重构（S13）：取消 ⋯ 操作条平铺图标化、拖拽上下半排序、摘要独立两行、移除回收站折叠区与移动到对话框
- 变更记录目标类型收紧——仅实体（历史数据保留展示）
- schema 演进策略：删库重建 → 增量迁移机制（v0.1.0 发布终止删库重建，决策 13/E5）
- 调试配置简化为纯配置文件（删除环境变量开关）
- 对话框宽度契约统一（基座 max-w-lg + 调用点覆盖）

### Fixed

- Base UI error #31 根因：DropdownMenuLabel 必须 DropdownMenuGroup 包裹（会话标题下拉整页白屏）
- DialogContent 基座宽度覆盖失效（sm:max-w-* 同特异性覆盖被压碎）
- 数据变更后页面不刷新（dataVersion 信号 + 全局刷新按钮）、刷新后会话不恢复（自动激活最近会话）
- 端口占用自动 +1 并打开实际端口（127.0.0.1，决策 8/17）
- 大纲同父重排 off-by-one（拖拽 order 剔除计算）、实体详情跨实体状态残留
- 启动相对路径创作根归一化（INVALID_PROJECT_PATH）

### Removed

- 游离节点（orphan_nodes）设计——大纲严格三层，无树外状态（决策 19）
- `#/chat` 独立页面（聊天常驻右栏）
- 大纲「移动到…」对话框（S13.1 平铺图标化替代）
- 调试环境变量开关（纯配置文件替代）
