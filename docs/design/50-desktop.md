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

**首次启动**（`desktop.json` 不存在或无 `projectRoot`）：**直接使用默认书库位置** `<文档>/AI Editor`（建目录 + 写配置），**不弹任何对话框**——先让用户进得去软件，要不要换目录是之后的决定（设置页「通用 → 书库位置」随时可改）。已保存的路径若被手工删掉 → 重建目录（创作根只是容器，重建无副作用）。

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
- **签名**：首版不做（macOS 首次需右键打开、Windows 有 SmartScreen 提示，README 写明）。触发条件 = 用户量起来或要上自动更新。
- **自动更新**：首版**手动**（GitHub Releases 下载新包）。electron-updater 在 macOS 上要求 app 已签名，签名未做之前上自动更新是纯负债。
- **CI**：`.github/workflows/desktop.yml`，与 `publish.yml` 同触发（push `v*` tag），**只跑 windows-latest**，产物挂到该 tag 的 GitHub Release（并额外上传 CI artifact 供本地下载验）。发布纪律见 `build.md`。
- **版本号**：与根 `version` 同源，同一 tag 同时产 npm 包与桌面安装包。

## 6. 客户端契约增量（唯一改动）

- 设置页新增二级 tab「**通用**」（位置最前：通用 → AI 模型 → 项目规则 → 备份），首项「书库位置」= 当前创作根路径（只读文本）+「更改…」按钮（`button-default`）+ 一句说明（更改后需重启应用）。**仅桌面版渲染**（能力检测），浏览器形态该 tab 不出现。
- 书架页「打开其他路径」保留手输框，桌面版在其右侧多一个「浏览…」按钮（`button-default`）。

两条都不新增视觉语言：复用 `card` / `caption-text` / `button-default` / `input`，见 `docs/ui/DESIGN.md`。

## 7. 已验证结论（K0 打包 spike，2026-10 实测）

三条假设均已在 Linux x64 + Electron 44.3.0 上跑通（`pnpm --filter @whispering233/ai-editor-desktop dist` 一键出 AppImage）：

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

窗口尺寸/位置记忆、macOS 公证与 Windows 代码签名、electron-updater 自动更新、端口 +1 时的偏好丢失兜底、Linux deb/rpm 包、开机自启。触发条件见 `backlog.md`。
