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
import { desktopConfigPath, readDesktopConfig, suggestedLibraryDir, writeDesktopConfig } from "./config.js";
import { logFilePath, redirectConsoleToFile } from "./log.js";

const here = dirname(fileURLToPath(import.meta.url));

let handle: ServerHandle | null = null;

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
 * 两处消费：首次启动选书库位置，以及渲染层「浏览…」（经 preload 桥 → IPC）。
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
 * 解析书库位置（创作根）：已保存 → 直接用；未配置 → 弹原生目录选择框（建议值 `<文档>/AI Editor`）。
 * **不静默创建**；返回 null = 用户取消（调用方退出应用）。
 */
async function resolveLibraryRoot(): Promise<string | null> {
  const configFile = desktopConfigPath(app.getPath("userData"));
  const saved = readDesktopConfig(configFile);
  if (saved !== null) {
    mkdirSync(saved.projectRoot, { recursive: true }); // 目录被手工删掉时重建（创作根只是容器）
    return saved.projectRoot;
  }

  const chosen = await pickDirectory({
    title: "选择书库位置",
    message: "书籍、备份与对话历史都会存放在这个目录里（可稍后在设置中更改）",
    buttonLabel: "使用此目录",
    defaultPath: suggestedLibraryDir(app.getPath("documents")),
  });
  if (chosen === null) return null;

  mkdirSync(chosen, { recursive: true });
  writeDesktopConfig(configFile, { projectRoot: chosen });
  return chosen;
}

async function openWindow(): Promise<void> {
  // 日志落盘要在一切之前（GUI 用户没有终端；启动期的报错也要能事后查）
  const userData = app.getPath("userData");
  const logFile = logFilePath(userData);
  redirectConsoleToFile(logFile);

  const root = await resolveLibraryRoot();
  if (root === null) {
    console.log("[desktop] 未选择书库位置，退出");
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

  installMenu(root, dirname(logFile), !app.isPackaged);
  console.log(`[desktop] 菜单已就绪（书库 / 日志目录入口；devtools 项: ${!app.isPackaged}）；日志: ${logFile}`);

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadURL(`http://127.0.0.1:${handle.port}`);
}

void app.whenReady().then(async () => {
  // 渲染层「浏览…」入口：经 preload 桥 invoke（能力检测在 client 侧；浏览器形态无此通道）
  ipcMain.handle("desktop:pick-directory", () => pickDirectory({ title: "选择项目目录" }));
  await openWindow();
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  void handle?.close();
});
