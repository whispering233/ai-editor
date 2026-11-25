// 桌面版主进程（ESM）。
//
// 职责（`docs/design/50-desktop.md` §1/§2）：解析书库位置（`<userData>/desktop.json`，首次启动弹
// 原生目录选择框）→ 主进程内 in-process 启动 server → 窗口加载 `http://127.0.0.1:<实际端口>`
// （与前端相对路径 API_BASE 同源）。**不开子进程**、**不依赖 `process.cwd()` / 命令行参数**。
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
} from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type ServerHandle } from "@whispering233/ai-editor-server";
import { PORT_RANGES } from "@whispering233/ai-editor-shared";
import {
  desktopConfigPath,
  libraryRootCandidates,
  readDesktopConfig,
  writeDesktopConfig,
  writeLibraryMarker,
} from "./config.js";
import { logFilePath, redirectConsoleToFile } from "./log.js";
import { shouldCloseServerOnBeforeQuit, shouldSkipFlushOnClose } from "./quit-sequence.js";
import { checkForUpdatesManually, isUpdateSupported, setupAutoUpdate } from "./updater.js";
import { ZOOM_FACTORS, nextZoomFactor, zoomKeyIntent, zoomPercent } from "./zoom.js";

const here = dirname(fileURLToPath(import.meta.url));

let handle: ServerHandle | null = null;

/** 当前书库位置（创作根）；启动解析后写入，供设置页「通用」查看与切换 */
let libraryRoot: string | null = null;

/** 服务关闭防重入：切换书库会先关再 quit，`before-quit` 还会再喊一次 */
let closing = false;

async function closeServer(): Promise<void> {
  if (closing) return;
  closing = true;
  await handle?.close();
}

/** 关窗前落盘通道的 IPC 名（渲染侧 = `preload.cts` 的 `onFlushRequest`，见 `50-desktop.md` §1.1） */
const FLUSH_REQUEST_CHANNEL = "desktop:flush-request";
const FLUSH_DONE_CHANNEL = "desktop:flush-done";

/** 等渲染侧落盘回执的上限；超时按失败处理（宁可多问一句，不静默丢正文） */
const FLUSH_TIMEOUT_MS = 3000;

/** 请渲染侧跑一次「栈顶保存动作」并等回执；低层通道（编排 = `guardCloseFlush`） */
function requestFlush(win: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    // 渲染进程已崩 / 页面已拆：发请求只会抛，没人能回执 ⇒ 直接按失败走确认框（窗口仍关得掉）
    if (win.webContents.isDestroyed()) {
      resolve(false);
      return;
    }
    const settle = (ok: boolean): void => {
      clearTimeout(timer);
      ipcMain.removeListener(FLUSH_DONE_CHANNEL, onDone);
      resolve(ok);
    };
    function onDone(event: IpcMainEvent, ok: unknown): void {
      if (event.sender !== win.webContents) return; // 只认本窗口的回执
      settle(ok === true); // 回执非 `true` 一律当失败
    }
    const timer = setTimeout(() => {
      console.warn(`[desktop] 关窗落盘回执超时（${FLUSH_TIMEOUT_MS}ms），按失败处理`);
      settle(false);
    }, FLUSH_TIMEOUT_MS);
    ipcMain.on(FLUSH_DONE_CHANNEL, onDone);
    win.webContents.send(FLUSH_REQUEST_CHANNEL);
  });
}

/**
 * 关窗拦截（卡 C1）：退出必须经 flush 通道，不在 `before-quit` 里抢跑 `closeServer()`——
 * 落盘还要打 HTTP，服务端必须活到那时。流程 = preventDefault → 请渲染侧落盘 → 成功放行；
 * 失败 / 超时问一次（默认与 Esc 都是「留在这里」）。
 */
function guardCloseFlush(win: BrowserWindow): void {
  let flushing = false; // 等待期间（落盘 + 可能的一次确认框）的第二次 close 只拦、不再发请求
  let flushed = false; // 已放行：下面那次 `win.close()` 重入本监听时直接过
  win.on("close", (event) => {
    // 服务端已主动关闭（更新安装 / 切换书库先关了它再退）⇒ 这次 flush 必然失败，直接放行
    if (shouldSkipFlushOnClose({ flushed, serverClosing: closing })) return;
    event.preventDefault();
    if (flushing) return;
    flushing = true;
    void (async () => {
      try {
        if (!(await requestFlush(win))) {
          const { response } = await dialog.showMessageBox(win, {
            type: "warning",
            title: "保存未完成",
            message: "关闭前保存未完成，未保存的修改可能丢失。",
            buttons: ["留在这里", "仍要退出"],
            defaultId: 0,
            cancelId: 0,
          });
          if (response === 0) {
            console.warn("[desktop] 关窗前落盘未成功 → 用户选择留在这里，窗口不关");
            return;
          }
          console.warn("[desktop] 关窗前落盘未成功 → 用户选择仍要退出");
        } else {
          console.log("[desktop] 关窗前落盘成功，关闭窗口");
        }
        flushed = true;
        // 确认框期间窗口可能已被销毁（此时 `close()` 抛的异常会成 unhandled rejection）
        if (!win.isDestroyed()) win.close();
      } finally {
        flushing = false; // 「留在这里」后复位：下次关窗重新走一遍落盘
      }
    })();
  });
}

/**
 * 最小应用菜单。**Edit 角色不是装饰**：macOS 上不设菜单 ⇒ Cmd+C/V 失效（输入框全废）。
 * 自有条目 = 「视图」（界面缩放三项）+ 两个目录入口（书库/日志）+ 「帮助」（版本可见性 + 检查更新）；
 * devtools 仅在未打包态出现。`onCheckUpdates` 为 null = 当前平台没有更新能力（菜单项不出现，
 * 不留点了没反应的死项）。
 *
 * 缩放项**不挂 `accelerator`**（`50-desktop.md` §4.1）：键位由 `before-input-event` 判，两边都挂会双触发；
 * 菜单只负责可见状态（当前百分比 + 端点置灰），所以每次档位变化重建一次——`Menu.setApplicationMenu`
 * 是主进程内同步调用，零 IPC。
 */
function installMenu(
  libraryRoot: string,
  logDir: string,
  isDev: boolean,
  onCheckUpdates: (() => void) | null,
  zoom: { percent: number; step: (direction: 1 | -1) => void; reset: () => void },
): void {
  // 上下限从档位表派生（不在菜单里写 80 / 200 字面量）
  const minPercent = zoomPercent(ZOOM_FACTORS[0]);
  const maxPercent = zoomPercent(ZOOM_FACTORS[ZOOM_FACTORS.length - 1]);
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { role: "editMenu" },
    {
      label: "视图",
      submenu: [
        { label: "放大", enabled: zoom.percent < maxPercent, click: () => zoom.step(1) },
        { label: "缩小", enabled: zoom.percent > minPercent, click: () => zoom.step(-1) },
        { label: `实际大小 · ${zoom.percent}%`, enabled: zoom.percent !== 100, click: () => zoom.reset() },
      ],
    },
    {
      label: "书库",
      submenu: [
        { label: "打开书库目录", click: () => void shell.openPath(libraryRoot) },
        { label: "打开日志目录", click: () => void shell.openPath(logDir) },
      ],
    },
    {
      label: "帮助",
      submenu: [
        { label: `AI Editor v${app.getVersion()}`, enabled: false }, // 版本可见性：真机验证与排障的唯一抓手
        ...(onCheckUpdates === null ? [] : [{ label: "检查更新…", click: onCheckUpdates }]),
      ],
    },
    ...(isDev
      ? [
          {
            label: "开发",
            submenu: [{ role: "reload" as const }, { role: "forceReload" as const }, { role: "toggleDevTools" as const }],
          },
        ]
      : []),
    { role: "windowMenu" },
    ...(process.platform === "darwin" ? [] : [{ label: "退出", role: "quit" as const }]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * 弹原生目录选择框（`createDirectory` 允许随手新建）；返回 null = 用户取消。
 * 消费方：渲染层「浏览…」（书架页）与「更改…」（设置页）——均经 preload 桥 → IPC。
 */
async function pickDirectory(options: {
  title: string;
  message?: string;
  buttonLabel?: string;
  defaultPath?: string;
}): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    ...options,
    properties: ["openDirectory", "createDirectory"],
  });
  const chosen = filePaths[0];
  return canceled || chosen === undefined ? null : chosen;
}

/**
 * 外链一律交系统浏览器（不在 Electron 里开新窗口）。参考资料页有 `target="_blank"` 外链，
 * 不拦就会弹出没有地址栏的怪窗口；非 http(s) 协议（file: / 自定义协议）直接丢弃。
 */
function openExternal(url: string): void {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    console.log(`[desktop] 外部链接交由系统浏览器: ${url}`);
    void shell.openExternal(url);
  } else {
    console.log(`[desktop] 已拦截非 http(s) 外部导航: ${url}`);
  }
}

/** 导航守卫：新窗口一律 deny；顶层导航只允许本机 server 同源（其余转外部浏览器） */
function guardNavigation(win: BrowserWindow, port: number): void {
  const origin = `http://127.0.0.1:${port}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url === origin || url.startsWith(`${origin}/`)) return; // 同源（含 SPA hash 变化）放行
    event.preventDefault();
    openExternal(url);
  });
}

/**
 * 解析书库位置（创作根）：
 * - 已配置 → 优先用它（目录被手工删掉时重建）；**该位置不可用**（盘拔了/被删了/无写权限）→ 走候选链回退。
 * - 未配置（首次启动）→ 直接从候选链选第一个可用的（**不弹对话框**：先让用户进得去软件，
 *   要不要换目录是之后的决定，设置页「通用 → 书库位置」随时可改）。
 *
 * 候选链与「为什么需要它」见 `config.ts` 的 `libraryRootCandidates`。全部不可用才抛错。
 */
function resolveLibraryRoot(): string {
  const userData = app.getPath("userData");
  const configFile = desktopConfigPath(userData);
  const saved = readDesktopConfig(configFile);

  const fallbacks = libraryRootCandidates({
    documents: app.getPath("documents"),
    home: app.getPath("home"),
    userData,
  });
  // 已保存的位置排在最前（试不成就往下退），且去重避免重复尝试
  const candidates = saved === null ? fallbacks : [...new Set([saved.projectRoot, ...fallbacks])];

  for (const candidate of candidates) {
    try {
      mkdirSync(candidate, { recursive: true });
    } catch (err) {
      console.warn(`[desktop] 书库位置不可用，尝试下一个：${candidate}（${err instanceof Error ? err.message : String(err)}）`);
      continue;
    }
    if (saved?.projectRoot !== candidate) {
      // 整对象覆写 ⇒ 必须带上盘上的 zoom（`saved === null` 才是真没有值，回落 1）；
      // 否则启动自愈 / 换书库会把用户设过的缩放静默重置回 100%。
      writeDesktopConfig(configFile, { projectRoot: candidate, zoom: saved?.zoom ?? 1 });
      console.log(
        saved === null
          ? `[desktop] 首次启动：使用默认书库位置 ${candidate}（可在 设置 → 通用 → 书库位置 更改）`
          : `[desktop] 原书库位置 ${saved.projectRoot} 不可用 → 改用 ${candidate}`,
      );
    }
    // 签名文件（幂等）：卸载器只删带它的目录——没有它就无法区分「本应用建的书库」
    // 与「用户自己早已建好的同名目录」，RMDir 就成了不可恢复的误删。
    writeLibraryMarker(candidate);
    return candidate;
  }
  throw new Error(`没有可用的书库位置（已尝试：${candidates.join(" → ")}）`);
}

async function openWindow(): Promise<void> {
  // 日志落盘要在一切之前（GUI 用户没有终端；启动期的报错也要能事后查）
  const userData = app.getPath("userData");
  const logFile = logFilePath(userData);
  redirectConsoleToFile(logFile);

  let root: string;
  try {
    root = resolveLibraryRoot();
  } catch (err) {
    console.error("[desktop] 无可用书库位置", err);
    dialog.showErrorBox("AI Editor 无法启动", err instanceof Error ? err.message : String(err));
    app.quit();
    return;
  }

  try {
    // openBrowser:false —— 桌面版自带窗口，不再拉起系统浏览器
    // 端口：显式取 desktop 分段（与 web 生产 / dev 分段互不相交，见 `docs/design/build.md` §端口策略）；
    // `dev: false` 显式钉住——防 shell 里的 NODE_ENV=development 把桌面端误判成 dev 严格模式
    handle = await startServer(root, {
      openBrowser: false,
      dev: false,
      port: PORT_RANGES.desktop.base,
      maxAttempts: PORT_RANGES.desktop.attempts,
    });
  } catch (err) {
    console.error("[desktop] 服务启动失败", err);
    dialog.showErrorBox("AI Editor 启动失败", err instanceof Error ? err.message : String(err));
    app.quit();
    return;
  }
  console.log(`[desktop] server: http://127.0.0.1:${handle.port} root=${root}`);
  libraryRoot = root;

  // 缩放起点 = 盘上的值（`resolveLibraryRoot` 的自愈分支刚可能写过盘，所以在那之后读）。
  // 本次会话的权威值只在内存 `currentZoom`（`preload` 零新通道：主进程自己知道当前值）。
  const configFile = desktopConfigPath(userData);
  let currentZoom = readDesktopConfig(configFile)?.zoom ?? 1;

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      // 安全基线（`50-desktop.md` §3）：渲染层跑的是本地 HTTP 页面，不给 Node 权限
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  guardNavigation(win, handle.port);
  guardCloseFlush(win);

  // 菜单在窗口创建之后装：更新对话框要属主窗口，闭包直接引用已确定的 `win`
  // （否则得先声明 `let win` 再用非空断言，或者让菜单模板依赖一个还没有的值）
  const onCheckUpdates = isUpdateSupported()
    ? () => void checkForUpdatesManually({ win, closeServer, logFile })
    : null;

  // 改缩放的唯一入口（键位与菜单都走这里）：值没变就直接返回，**不重复写盘**——
  // 端点连按不该把 desktop.json 翻来覆去重写（`nextZoomFactor` 已在两端夹住）
  const applyZoom = (next: number): void => {
    if (next === currentZoom) return;
    currentZoom = next;
    win.webContents.setZoomFactor(next);
    try {
      // 整对象覆写：带上同一个 `root`（书库位置不因缩放而变）
      writeDesktopConfig(configFile, { projectRoot: root, zoom: next });
    } catch (err) {
      // 写失败不影响本次生效（缩放已经作用在 webContents 上）；下次启动回落盘上的旧值
      console.warn(
        `[desktop] 界面缩放写入 desktop.json 失败（本次已生效）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    rebuildMenu(); // 「实际大小 · N%」与端点置灰跟着值走
  };

  const rebuildMenu = (): void => {
    installMenu(root, dirname(logFile), !app.isPackaged, onCheckUpdates, {
      percent: zoomPercent(currentZoom),
      step: (direction) => applyZoom(nextZoomFactor(currentZoom, direction)),
      reset: () => applyZoom(1),
    });
  };

  // 键位（`50-desktop.md` §4.1）：判定在 `zoomKeyIntent`，这里只负责「非 null → 吃掉 → 分派」。
  // 吃掉 = 不让这组键继续流向渲染层（正文编辑器若将来绑 `Mod+-` 不会与我们打架）；未注册 zoom role 时
  // Electron 本身没有内置页面缩放，所以这里**不是**在防双触发。
  win.webContents.on("before-input-event", (event, input) => {
    const intent = zoomKeyIntent({
      type: input.type,
      key: input.key,
      code: input.code,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
    });
    if (intent === null) return;
    event.preventDefault();
    applyZoom(intent === "reset" ? 1 : nextZoomFactor(currentZoom, intent === "in" ? 1 : -1));
  });

  rebuildMenu();
  console.log(
    `[desktop] 菜单已就绪（视图 / 书库 / 日志目录入口；devtools 项: ${!app.isPackaged}；检查更新项: ${onCheckUpdates !== null}）；日志: ${logFile}`,
  );
  console.log(`[desktop] 界面缩放 ${zoomPercent(currentZoom)}%（Ctrl/Cmd + = / - / 0）`);

  // 应用时机（`50-desktop.md` §4.1）：`loadURL` 前设一次；Chromium 的 per-host 记录可能在导航后回写，
  // 所以 `did-finish-load` 幂等重放一次——保证「盘上的值赢」，而不是命中外来的 100%。
  win.webContents.setZoomFactor(currentZoom);
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(currentZoom));

  await win.loadURL(`http://127.0.0.1:${handle.port}`);
  // 窗口出来之后再后台检查（不阻塞启动）；失败静默，细节落 logFile
  setupAutoUpdate({ win, closeServer, logFile });
}

void app.whenReady().then(async () => {
  // 渲染层「浏览…」入口：经 preload 桥 invoke（能力检测在 client 侧；浏览器形态无此通道）
  ipcMain.handle("desktop:pick-directory", () => pickDirectory({ title: "选择项目目录" }));
  ipcMain.handle("desktop:get-library-root", () => libraryRoot);
  ipcMain.handle("desktop:change-library-root", async () => {
    const chosen = await pickDirectory({
      title: "选择新的书库位置",
      ...(libraryRoot !== null ? { defaultPath: libraryRoot } : {}),
    });
    if (chosen === null || chosen === libraryRoot) return null;

    mkdirSync(chosen, { recursive: true });
    // 整对象覆写：zoom 取盘上的当前值（每次档位变化都已写过盘，盘上就是权威值），
    // 重新读一次而不是写常量 1——否则换书库会把缩放重置回 100%。
    const configFile = desktopConfigPath(app.getPath("userData"));
    const zoom = readDesktopConfig(configFile)?.zoom ?? 1;
    writeDesktopConfig(configFile, { projectRoot: chosen, zoom });
    console.log(`[desktop] 书库位置切换为 ${chosen}，重启应用`);

    await closeServer(); // 先收敛 WAL/备份调度再重启，不靠进程猝死
    app.relaunch();
    app.quit();
    return chosen;
  });
  await openWindow();
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  // 菜单「退出」= `app.quit()` 先发 before-quit、窗口还没关 ⇒ 这时的 flush 还没跑，
  // 服务端必须活到落盘之后（次序与两条退出路径见 `50-desktop.md` §1.1）
  if (!shouldCloseServerOnBeforeQuit(BrowserWindow.getAllWindows().length)) return;
  void closeServer();
});
