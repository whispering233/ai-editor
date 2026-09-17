# 桌面版（Electron 外壳）

> **定位**：把「本地优先的创作工具」变成用户下载安装包、双击即用的桌面软件。桌面版是**外壳**，不是第二个产品——数据语义、API 契约、SSE 帧集、UI 视觉契约全部不变，`packages/server` 不改一行。CLI/npm 形态（`npx ai-editor` + 浏览器访问）**保留**，两条分发渠道并存。

## 1. 进程与生命周期

| 项 | 决定 | 理由 |
| :--- | :--- | :--- |
| 服务形态 | 主进程内 **in-process** 调用 `startServer()`，不开子进程 | 渲染进程天然独立，主进程的同步阻塞（sqlite/zip）只延迟 HTTP 响应、不冻结窗口；上 `utilityProcess` 是无人需要的崩溃隔离 |
| 窗口加载 | `http://127.0.0.1:<实际端口>` | 前端 API 用相对路径 `API_BASE="/api/v1"`，必须与 server 同源；`file://` 下相对路径会打空 |
| 端口策略 | **固定优先**：先试 3456，被占才 +1（沿用 server 既有策略） | `localStorage` 按 origin 隔离，端口变化 = 主题/面板偏好重置。偏好存 `<创作根>/.ai-editor/config.json` 是错的（那不是展示层偏好）；自定义协议 `app://` 反代能彻底解决但要写协议层 + 验证 SSE 透传，当前不值得 |
| 单实例 | `requestSingleInstanceLock()`，第二实例唤起已有窗口 | 顺带把「3456 被自己占用」的概率压到接近零 |
| 退出 | 关窗即退出，复用 `ServerHandle.close()`（停自动备份调度 + 关 HTTP + 释放项目连接） | 灭掉「进程退出但 WAL 未收敛」的风险；无托盘、不驻留 |
| 开发形态 | 窗口指向 Vite dev server（5173），server 仍由 `pnpm dev` 的 tsx watch 起 | 保住 HMR；一体形态（主进程内启 server）只在生产/打包验证时用 |

**不变式**：桌面版启动路径**不得**依赖 `process.cwd()` 或命令行参数——macOS 下 cwd 是 `/`，双击启动没有可控参数。

## 2. 配置与数据位置

| 载体 | 内容 | 归属 |
| :--- | :--- | :--- |
| `<userData>/desktop.json`（应用级） | `projectRoot`（书库位置，绝对路径） | 桌面版专属，见 `config.md` |
| `<userData>/logs/ai-editor.log` | 主进程 console 输出（含 server 启动日志） | 桌面版专属；GUI 用户没有终端，日志是唯一排障线索 |
| `<创作根>/.ai-editor/config.json` | `debug` / `lastProject` | 服务端，语义不变 |
| `~/.pi/agent/` | 凭据 / 模型 / settings | pi 家目录，**与 CLI 形态共享**——桌面版不发明第二份凭据真相源 |

**userData 的平台含义**（Electron `app.getPath('userData')` = `appData` + 应用名）：Windows `%APPDATA%\AI Editor\`、macOS `~/Library/Application Support/AI Editor/`、Linux `~/.config/AI Editor/`。

**首次启动**（`desktop.json` 不存在 / 无 `projectRoot` / **JSON 不可读**——`readDesktopConfig` 读不到就返回 null，包括文件损坏）：**直接使用候选链上第一个可用目录**（不弹任何对话框）——先让用户进得去软件，要不要换目录是之后的决定（设置页「通用 → 书库位置」随时可改）；读不到时会**重写配置**（自愈；日志里表现为「首次启动：使用默认书库位置」）。

**书库位置候选链**（单一实现 = `packages/desktop/src/config.ts` 的 `libraryRootCandidates`）：

1. `<文档>/AI Editor`——符合用户直觉；但**文档目录被 OneDrive 重定向时跳过**（书库内有 `data.db` 与备份 zip，不放实时同步盘：锁竞争与冲突风险）
2. `<主目录>/AI Editor`——不进云同步，用户自己找得到
3. `<userData>/AI Editor`——必定可写（兜底）

已保存的位置**不可用**时（盘拔了 / 目录被删 / 无写权限）也走同一条链回退并改写配置；**全部不可用才报错退出**（弹原生错误框）。没有这层兜底就是「首次启动直接崩」——Windows 的「文档」是已知文件夹（`SHGetKnownFolderPath`），可能被重定向到**并不存在**的路径（OneDrive 卸载后的注册表残留是常见成因），此时 `mkdir` 直接抛错。

**启动失败（端口耗尽 / 库打不开等）**：弹原生错误框 + 退出——桌面版用户没有终端，堆栈得看得见（完整日志落盘属 K3）。

**切换书库**：设置页 → 二级 tab「通用」→「书库位置」→ 原生目录框 → 写 `desktop.json` → `app.relaunch()`（不搞运行时热切换创作根：`setProjectRoot` 的热切换语义会让「创作根」这个概念在会话中途变两次）。

**边界**：`desktop.json` 只属于桌面版；CLI 形态永远由启动参数决定创作根，二者互不读取。`desktop.json` 不进项目文件、不进备份 zip、不进任何 API 响应。

## 3. 包结构、模块格式与不变式

新增 `packages/desktop`（private，不发布 npm）：依赖链多一层 `shared → db → tools → agent → server → desktop`。

| 产物 | 模块格式 | 原因 |
| :--- | :--- | :--- |
| 主进程 | **ESM** | 主进程走 Node ESM loader；与全仓 ESM 一致 |
| preload | **必须 CJS**（源文件 `preload.cts`） | 沙箱 preload 不支持 ESM（Electron 官方 ESM 文档明列）——问题 4 定了 `sandbox: true`，所以这不是风格选择而是硬约束 |

窗口安全基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。preload 经 `contextBridge` **只暴露目录选择一个能力**，不暴露 fs / shell / ipcRenderer 原语。

## 4. 原生能力边界

| 能力 | 处理 |
| :--- | :--- |
| 目录选择 | preload `pickDirectory()` → 主进程 `dialog.showOpenDialog({properties:['openDirectory']})`。client 侧**能力检测**（无该 API 则不渲染按钮），浏览器形态保留手输路径框 |
| 应用菜单 | 最小模板：Edit 角色（undo/redo/cut/copy/paste/selectAll）+ reload + devtools（仅 dev）+ 打开书库目录 + 打开日志目录 + quit/close。**macOS 上不设菜单 ⇒ Cmd+C/V 失效**（输入框粘贴全废），菜单是刚需不是装饰 |
| 外链与导航 | `setWindowOpenHandler` → **一律 deny** + `shell.openExternal`；`will-navigate` 只放行同源 `http://127.0.0.1:<端口>`（含 SPA hash 变化），其余 `preventDefault` 后转外部浏览器；**非 http(s) 协议直接丢弃**（不调 openExternal）。参考资料页有 `target="_blank"` 外链，不拦就弹出无地址栏的怪窗口 |
| 导出备份 zip | **零改动**：Electron 默认弹保存对话框（只有显式调 `setSavePath` 才会静默落盘） |
| 不做 | 「在浏览器中打开」入口（web 能力由 CLI 形态承担）、API key 首配向导、托盘、多窗口、拖拽导入、`showDirectoryPicker`（Chromium 的 File System Access API 拿不到绝对路径，对「打开项目」无用） |

## 5. 打包与发布

- **工具**：electron-builder（多平台安装包格式开箱即用）+ `pnpm deploy --prod` 生成扁平部署目录（pnpm 符号链接树会让打包器漏收 `@whispering233/*` workspace 依赖）。兜底方案 = esbuild 把主进程与 workspace 依赖 bundle 成单文件 + better-sqlite3 external + 手工拷 `.node`。
  - **`--legacy` 已不需要（pnpm 12 起）**：pnpm 11 默认拒结非 injected workspace 的 deploy（`ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`），12.2+ 的默认实现把链接的 workspace 依赖改写成 `file:` 写入专用 deploy lockfile——升级后 `pack.mjs` 已去担此 flag，且打包产物经实测可用（窗口 + preload + 建库全通）。若将来被要求降回 pnpm 11，需重新加回。
  - **`electron-builder` 需显式 `linux.executableName`（实测）**：应用目录 package.json 的 name 带 scope（`@whispering233/...`）→ 推导出的可执行名含 `@`，AppImage 工具链拒收（仅允许字母/数字/`-`/`_`/`.`/空格）。另需 `npmRebuild: false`（N-API 模块无需针对 Electron 重编译）。
- **原生模块**：`asarUnpack` 放 `**/*.node`。better-sqlite3 v13 是 N-API（`NAPI_VERSION=10`）+ 预编译 8 平台 `.node`，在 Electron 44.3.0（内置 Node 24.18.1）**免 rebuild 直接可用**——已实测（dev 态与打包态各建库一次）。
- **平台矩阵（2026-10 定）**：**本地只打 Linux 包测试**（`pnpm desktop:dist` → AppImage）；**Windows 包由 CI 出**（nsis，唯一的自动出包平台）；macOS（dmg）暂不做——无 mac 环境可验。将来有真实用户需求再恢复三平台 matrix（`desktop.yml` 里两个平台项已注释保留）。Windows 本地交叉构建需 Wine（electron-builder 官方口径），本仓不往开发机装该依赖。
- **签名**：首版不做（macOS 首次需右键打开、Windows 有 SmartScreen 提示，README 写明）。触发条件 = 用户量起来或 SmartScreen 提示成为反馈主题（**不再是「上自动更新」**——Windows 更新已在未签名下跑通，信任锚与安全边界见 §5.2）。
- **自动更新**：**Windows 安装态已启用**（electron-updater 6.8.9 + GitHub Releases；macOS 仍受签名阻塞）——时机/反馈/安装口径与安全边界见 §5.2。
- **CI**：`.github/workflows/desktop.yml`，与 `publish.yml` 同触发（push `v*` tag），**只跑 windows-latest**，产物挂到该 tag 的 GitHub Release（并额外上传 CI artifact 供本地下载验）。发布纪律见 `build.md`。
- **版本号**：与根 `version` 同源，同一 tag 同时产 npm 包与桌面安装包。

## 5.1 卸载时的数据清理（Windows NSIS）

卸载器默认只删程序文件，书库与 `<userData>` 都留在盘上。`packages/desktop/build/installer.nsh` 的 `customUnInstall` 在卸载前问一次「是否同时清除使用数据」，**默认「否」**（保留，便于重装续用）；选「是」则删 `<文档>/AI Editor`、`<主目录>/AI Editor`、`<userData>\AI Editor`。

**删除前提 = 应用签名文件（安全约束，不可省）**：书库目录名 `AI Editor` 是通用名，用户完全可能早就自己建过同名目录放别的东西——无差别 `RMDir /r` 就是**不可恢复的误删**。因此应用每次启动会在书库下幂等写 `.ai-editor/library.json`（`config.ts` 的 `writeLibraryMarker`，内容 `{ app: "ai-editor", createdAt }`），**卸载器只删带这个文件的目录**；同名但无签名的目录一律跳过（提示文案里写明判断依据）。`<userData>` 的存在性检查用 `desktop.json`（同样是本应用写的）。

**已知取舍（有意，非缺陷）**：卸载器**不解析 `desktop.json`** 去精确定位自定义书库——NSIS 读 UTF-8 JSON 有编码坑、用 PowerShell 回传中文路径同样不稳；改为扫默认候选位置，**自定义位置的书库不会被自动删**，提示文案里明确告知（应用内 设置 → 通用 → 书库位置 可见真实路径）。若将来要做精确定位，正解是应用额外写一份 UTF-16LE 路径镜像供 NSIS 读，而不是在卸载器里解析 JSON。

**⚠ 升级路径不是卸载（v0.0.45 修的缺陷，不得回退此守卫）**：安装器覆盖安装前会用 `/S /KEEP_APP_DATA --updated _?=$INSTDIR` 调**旧版卸载器**先清程序文件（`templates/nsis/include/installUtil.nsh`），此时 `customUnInstall` 同样会被执行——v0.0.44 的脚本无条件弹「是否清除使用数据」（`MessageBox` 在 `/S` 静默模式下照样弹），真机表现为**升级时冒出清除数据询问框**，用户若点「是」则书库与 `%APPDATA%\AI Editor` 被删（不可恢复）。

**不变式**：`customUnInstall` 开头必须以 `${isUpdated}`（升级内部调用）或 `${Silent}`（脚本化静默卸载）直接 `Return`——不弹框、不删用户数据、**也不清安装器缓存**（升级时 `%LOCALAPPDATA%\<name>-updater\pending\` 里正躺着正在执行的待装包，且新安装会自己刷新缓存；缓存清理只属用户主动卸载）。`${isUpdated}` 由 `NsisScriptGenerator.flags(["updated", …])` 生成（查命令行里的 `--updated`），上游自己的数据清理也是用 `${ifNot} ${isUpdated}` 护住的（`uninstaller.nsh`）。

**过渡注意（历史，已过去）**：v0.0.44 及更早的卸载器没有这层守卫，所以从那些版本升级时会弹一次清除数据框（旧卸载器已在用户机器上、**无法远程修补**）；自 v0.0.45 起不再弹。真机已验证（2026-09-16：v0.0.46 → v0.0.47 升级全程无该框）。

macOS 无卸载器（拖废纸篓即卸）→ 本机制只对 Windows 生效；将来若需跨平台的「清除数据」，应做成应用内入口（设置页）。

**安装器缓存副本的清理**：`%LOCALAPPDATA%\<name>-updater\installer.exe`（约 130MB）是 electron-builder 的 NSIS 安装器安装时写出的**自身副本**（供差分更新 / `quitAndInstall`，v0.0.44 起被自动更新真正使用），属**程序文件而非用户数据** → 卸载时**无条件清理**（上游默认卸载器不删它，electron-builder#9505）。该目录名派生自包名（`sanitizeFileName(name).toLowerCase() + "-updater"`，**无配置项可覆盖**），因此 desktop 包**有意不带 scope**（`ai-editor-desktop`）——带 scope 会得到 `@whispering233ai-editor-desktop-updater` 这种拼音式怪名；卸载器同时清带 scope 的旧名残留。

### 5.2 自动更新（Windows 安装态，v0.0.44 起）

**形态**：electron-updater（**6.8.9 exact pin**，与 electron-builder 26 同线；7.x 改了 `quitAndInstall` 签名与 `autoInstallEvent` 语义，**不要混用**）+ GitHub Releases（仓库 public ⇒ **app 内不塞任何 token**，更新器走 `/releases/latest` 不碰 API 配额）。只对 **Windows NSIS 安装态**生效：主进程侧 `process.platform === "win32"` 守卫，其他平台不出包也不检查（将来真发 Linux/macOS 更新时另立卡，不在本机制的假定范围内）。

| 项 | 决定 | 理由 |
| :--- | :--- | :--- |
| 检查时机 | 启动后异步一次（不阻塞窗口）+ 菜单「帮助 → 检查更新…」；**无定时器** | 关窗即退出、无托盘驻留，定时检查在真实使用里几乎不触发 |
| 自动路径反馈 | 全静默；下载完成才弹原生对话框「立即重启安装 / 稍后」 | 网络抖动不该打扰写作；GUI 用户排障看日志 |
| 手动路径反馈 | 必有应答且**只弹一个框**：已是最新 vX / 新版本已下载 + 安装按钮 / 检查失败（附日志路径）；仅当下载确实耗时（秒级判定窗口）时才先给一句「正在后台下载…」 | 用户主动点了却没反应 = 像坏了；反之弹两个框（「正在下载」+「已下载」）是 v0.0.44 真机实测的缺陷 |
| 安装时机 | **只在用户确认后安装**（`autoInstallOnAppQuit = false`）；对话框默认按钮与 Esc 都是「稍后」 | 退出时静默替换撞上游 #7807（Windows 关机/注销杀掉安装器 ⇒ 卸载了没装回），这类故障用户自己修不了 |
| 安装步骤 | 先 `await closeServer()`（收敛 WAL/备份调度，同「切换书库」姿势）→ `quitAndInstall(true, true)`（静默 + 装完拉起应用） | 不在退出中途丢数据；重启后端口与 `localStorage` 偏好不变 |
| 差分更新 | 保持默认开启；要求**每个 Release 三资产齐全** | 零代码；缺旧版 blockmap 只损失那一次带宽（自动回退全量下载） |
| 版本可见性 | 菜单「帮助」→ `AI Editor vX.Y.Z`（disabled） | 真机验证与用户排障的唯一抓手，且 **client 零改动** |
| 签名 | 仍不签名 | electron-updater 在 `app-update.yml` 无 `publisherName` 时**跳过** Authenticode 校验；强制签名的是 macOS，而 macOS 不出包 |

**三条硬约定**：① 提示与安装只在 `update-downloaded` 之后（下载期间不打扰用户）；② 安装前必须先 `await closeServer()`——安装器要替换正在运行的程序文件；③ **手动检查期间对话框由手动流程独占**（`manualCheckInFlight`），事件路径不弹框——否则真机实测会出现「正在后台下载」+「已下载」两个框（差分 0 字节时几乎是瞬间叠在一起）。

**信任锚与安全边界（未签名 + GitHub Releases）**：可执行文件的可信性 = GitHub Releases 的 TLS + 仓库写权限（2FA）+ `latest.yml` 里的 sha512。**sha512 与安装包同源**：挡得住下载损坏/中间人，**挡不住 Release 被篡改**；用户侧 SmartScreen 提示依旧（与首版一致，不新增问题）。消除这条边界的唯一办法 = 代码签名（触发条件见 `backlog.md`）。

**首次升级路径（不可自动化的一跳）**：第一个带更新能力的版本**必须手动下载安装一次**——老版本里没有更新器。README / CHANGELOG 要写明，否则用户会以为「早该自动升上来」。

**发布侧前置**：每个 Release 必须同时挂 `AI-Editor-<v>-win-x64.exe` + `latest.yml` + `<同名>.exe.blockmap`。**资产名不得含空格**——自动更新要求「磁盘文件名 = 上传后的资产名 = `latest.yml` 里的 `url`」**逐字一致**：GitHub 上传会把空格换成**点**（v0.0.43 实测资产名 = `AI.Editor-0.0.43-win-x64.exe`），而 electron-builder 写进 `latest.yml` 的是把空格换成**短横**的名字，更新器又按 yml 的 `url` 直拼 `/releases/download/<tag>/<名>`（`GitHubProvider.resolveFiles`，**不做资产清单回退**）⇒ 差一个字符就 404、更新全断。因此 `win.artifactName` / `linux.artifactName` 固定为无空格的 `AI-Editor-…`。**缺 `latest.yml` ⇒ 所有旧版的检查更新直接失败**（`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`）；缺 blockmap 只影响带宽。electron-builder 只负责产出这三样与包内 `resources/app-update.yml`（`electron-builder.yml` 的 `publish` 段是这两份元数据的前提），**上传唯一路径仍是 `softprops/action-gh-release`**，`pack.mjs` 显式传 `--publish never` 防两条上传路径打架（CI 也没有 GH_TOKEN 可交给 electron-builder）。完整发布纪律见 `build.md`。

**验证状态（真机，2026-09-16/17）**：连续五跳升级全部成功——v0.0.44→0.0.45（差分 2%）、v0.0.44→0.0.46（1%）、v0.0.46→影子 0.0.47（同载荷，验「无清除数据框」与单框逻辑）、v0.0.46→0.0.47（1%）、v0.0.47→0.0.48（2%，98 个变更块 / 2,115 KB of 132,598 KB）。共同结论：差分下载真的生效（不是全量）、`--updated,/S,--force-run` 静默安装成功、应用自动拉起、版本号确实变化（日志 `Update for version 0.0.48 is not available`）、v0.0.45 起全程无清除数据框；下载时旧缓存 sha512 不匹配会自愈（`Directory for cached update will be cleaned`）。**代码新旧的可靠指纹**：旧代码会打 `disableWebInstaller is set to false …`，v0.0.45+ 不应出现。未专门观测：安装时是否弹 UAC、对话框 Esc/Enter 语义（列入 `tasks.md` 待验证）。

**差分 base 的位置**：`%LOCALAPPDATA%\ai-editor-desktop-updater\installer.exe`（安装器安装时写出的自身副本）。卸载会清掉它（§5.1）⇒ 卸载后重装的第一次更新回退全量下载，无功能影响。⚠ **差分失败会自动回退全量**（日志形如 `Cannot download differentially, fallback to full download: sha512 checksum mismatch`）——这是上游的设计回退，不是故障；根因是 base 与当前已装版本不一致（中间做过同版本重装 / 卸载清了缓存 / 影子实验）。诊断差分是否真的生效：看 `To download: … KB (N%)` 的比例与 `File has … changed blocks`。

**网络路径（排障口径）**：更新请求走 **Electron 的 `net` 模块**（Chromium 网络栈，跟随系统代理），**不经过** server 侧安装的 undici dispatcher（那是 Node 出站 HTTP 的路径）——两者排障不能混为一谈。实测：网络直连 GitHub 不稳时，自动检查会静默失败（只落日志，见 `backlog.md`「自动检查失败对网络不稳的用户完全不可见」）。

**不做**（有意）：设置页内嵌更新面板（要扩 `DesktopBridge` + client UI）、灰度 staging、macOS/Linux 自动更新、静默自动安装。延期项与触发条件见 `backlog.md`。

## 6. 客户端契约增量（唯一改动）

- 设置页新增二级 tab「**通用**」（位置最前：通用 → AI 模型 → 项目规则 → 备份），首项「书库位置」= 当前创作根路径（只读文本）+「更改…」按钮（`button-default`）+ 一句说明（更改后需重启应用）。**仅桌面版渲染**（能力检测），浏览器形态该 tab 不出现。
- 书架页「打开其他路径」保留手输框，桌面版在其右侧多一个「浏览…」按钮（`button-default`）。

两条都不新增视觉语言：复用 `card` / `caption-text` / `button-default` / `input`，见 `docs/ui/DESIGN.md`。

## 7. 已验证结论（K0 打包 spike，2026-10 实测）

三条假设均已在 Linux x64 + Electron 44.3.0 上跑通（`pnpm --filter ai-editor-desktop dist` 一键出 AppImage）：

1. **better-sqlite3 免 rebuild** ✓：Electron 44.3.0 内置 Node 24.18.1 ≥ Node-API 10 门槛（Node 22.14），N-API 预编译 `.node` 直接 load——开发态与打包态各建库一次（`data.db` + 表结构正确），未做任何 electron-rebuild。
2. **`pnpm deploy` 能收集 workspace 依赖** ✓：`.deploy/app` 自包含（`node_modules/.pnpm` 在目标目录内、无 electron/typescript 泄漏），打包产物 `resources/app.asar.unpacked` 内含 `better-sqlite3/prebuilds/linux-x64.node`。
3. **打包产物能起界面** ✓：`release/linux-unpacked/ai-editor` 启动后 server 监听、窗口加载 `http://127.0.0.1:3456/`（React 挂载出书架页 UI），CDP 读到 `window.aiEditorDesktop = { ready: true }`（**沙箱 preload 的 CJS 产物加载成功**），并经 HTTP 建成项目。

**顺带修掉的真实缺陷**（桌面版暴露的）：server 的 bin 自检 `realpathSync(process.argv[1])` 在 Electron 主进程里收到命令行开关（`--no-sandbox`）→ 抛 ENOENT 打挂整个主进程。现改为 try/catch 包裹、解析失败即判否（bin 语义不变）。

**平台覆盖**：Linux（AppImage）已在本机实测（打包 + 启动 + 建库 + 窗口）；Windows（NSIS）与 macOS（dmg arm64/x64）由 `.github/workflows/desktop.yml` 在对应 runner 上产出，**首次 tag 触发时验证**（待验证总表见 `tasks.md`，长期跟踪见 `backlog.md`）。

## 8. 与既有形态的关系

| 形态 | 启动 | 创作根来源 | 凭据 | 分发 |
| :--- | :--- | :--- | :--- | :--- |
| 桌面版 | 双击安装包 | `desktop.json`（首次启动选择） | `~/.pi/agent/` | GitHub Releases 安装包 |
| CLI/npm 版 | `npx ai-editor [目录]` | 启动参数（缺省 `cwd`） | `~/.pi/agent/` | npm（`publish.yml`） |

- 两者**共用** server 全部逻辑与数据语义；差异只在「创作根从哪来」「凭据之外的偏好存哪」。
- 桌面版不引入任何自建后端；云端存档仍是用户自己的 WebDAV 副本（`40-cloud-sync.md`）。
- 卸载桌面版**不动**创作根目录（用户的书写数据）；`desktop.json` 与日志随 userData 由用户自行处理。

## 9. 顺延项（不进首版）

窗口尺寸/位置记忆、macOS 公证与 Windows 代码签名、macOS 自动更新（签名是硬前置）、端口 +1 时的偏好丢失兜底、Linux deb/rpm 包、开机自启。触发条件见 `backlog.md`。
