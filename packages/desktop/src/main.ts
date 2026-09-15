// 桌面版主进程（ESM）。
//
// 职责（`docs/design/50-desktop.md` §1）：主进程内 in-process 启动 server → 窗口加载
// `http://127.0.0.1:<实际端口>`（与前端相对路径 API_BASE 同源）。**不开子进程**、**不依赖
// `process.cwd()`**。
//
// K0（打包 spike）：创作根暂用 `<userData>/spike-root`；`desktop.json` + 原生选目录属 K1。
import { app, BrowserWindow } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type ServerHandle } from "@whispering233/ai-editor-server";

const here = dirname(fileURLToPath(import.meta.url));

/** K0 spike 创作根（K1 起改为读 `<userData>/desktop.json`） */
const SPIKE_ROOT_NAME = "spike-root";

let handle: ServerHandle | null = null;

async function openWindow(): Promise<void> {
  const root = join(app.getPath("userData"), SPIKE_ROOT_NAME);
  mkdirSync(root, { recursive: true });

  // openBrowser:false —— 桌面版自带窗口，不要再拉起系统浏览器
  handle = await startServer(root, { openBrowser: false });
  console.log(`[desktop] server: http://127.0.0.1:${handle.port} root=${root}`);

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

void app.whenReady().then(openWindow);

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  void handle?.close();
});
