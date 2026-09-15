// 桌面版主进程（ESM）。
//
// 职责（`docs/design/50-desktop.md` §1/§2）：解析书库位置（`<userData>/desktop.json`，首次启动弹
// 原生目录选择框）→ 主进程内 in-process 启动 server → 窗口加载 `http://127.0.0.1:<实际端口>`
// （与前端相对路径 API_BASE 同源）。**不开子进程**、**不依赖 `process.cwd()` / 命令行参数**。
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type ServerHandle } from "@whispering233/ai-editor-server";
import {
  desktopConfigPath,
  libraryRootCandidates,
  readDesktopConfig,
  writeDesktopConfig,
  writeLibraryMarker,
} from "./config.js";
import { logFilePath, redirectConsoleToFile } from "./log.js";

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

/**
 * 最小应用菜单。**Edit 角色不是装饰**：macOS 上不设菜单 ⇒ Cmd+C/V 失效（输入框全废）。
 * 自有条目只有两个目录入口（书库/日志）；devtools 仅在未打包态出现。
 */
function installMenu(libraryRoot: string, logDir: string, isDev: boolean): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { role: "editMenu" },
    {
      label: "书库",
      submenu: [
        { label: "打开书库目录", click: () => void shell.openPath(libraryRoot) },
        { label: "打开日志目录", click: () => void shell.openPath(logDir) },
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
      writeDesktopConfig(configFile, { projectRoot: candidate });
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
    handle = await startServer(root, { openBrowser: false });
  } catch (err) {
    console.error("[desktop] 服务启动失败", err);
    dialog.showErrorBox("AI Editor 启动失败", err instanceof Error ? err.message : String(err));
    app.quit();
    return;
  }
  console.log(`[desktop] server: http://127.0.0.1:${handle.port} root=${root}`);
  libraryRoot = root;

  installMenu(root, dirname(logFile), !app.isPackaged);
  console.log(`[desktop] 菜单已就绪（书库 / 日志目录入口；devtools 项: ${!app.isPackaged}）；日志: ${logFile}`);

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
  await win.loadURL(`http://127.0.0.1:${handle.port}`);
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
    writeDesktopConfig(desktopConfigPath(app.getPath("userData")), { projectRoot: chosen });
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
  void closeServer();
});
