// 桌面版自动更新（Windows 安装态专属）。契约：`docs/design/50-desktop.md` §5.2。
//
// 形态：electron-updater 6.8.9（exact pin，与 electron-builder 26 同线）+ GitHub Releases
// （仓库 public ⇒ app 内不塞 token，更新器走 `/releases/latest`）。**只对 Windows NSIS 安装态生效**：
// 其他平台不出包也不检查。两条硬约定：① 提示与安装只在 `update-downloaded` 之后（下载期间不打扰用户）；
// ② 安装前必须先 `await closeServer()`——安装器要替换正在运行的程序文件。
import { app, dialog, type BrowserWindow } from "electron";
// ⚠ 不要写成 `import { autoUpdater } from "electron-updater"`：该包是 CJS（`out/main.js` 用
// `Object.defineProperty(exports, "autoUpdater", …)` 导出），**Electron 的 ESM loader 不认这个具名导出**
// ——打包态直接 `SyntaxError: The requested module 'electron-updater' does not provide an export named
// 'autoUpdater'`；而 `tsc`/`typecheck` 全绿、开发态也看不出来，只有真打包启动才炸（v0.0.44 实测）。
// 默认导入（= `module.exports`）再解构，两种 loader 都稳。
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

/** 更新只对 Windows 安装态生效（其他平台不出包，也不检查） */
export function isUpdateSupported(): boolean {
  return process.platform === "win32";
}

export interface UpdateDeps {
  /** 对话框的属主窗口（模态） */
  win: BrowserWindow;
  /** 由 main.ts 注入：先收敛 WAL/备份调度再 quitAndInstall */
  closeServer: () => Promise<void>;
  /** 失败对话框里给用户看日志路径 */
  logFile: string;
}

/** 启动后台检查（在窗口 loadURL 之后调用；仅 win32 且安装态真正发起请求） */
export function setupAutoUpdate(deps: UpdateDeps): void {
  if (!isUpdateSupported()) return;

  // 发现即后台下载，下载期间不打扰用户（提示只在 update-downloaded 之后）
  autoUpdater.autoDownload = true;
  // **只在用户确认后安装**：退出时静默替换撞上游 #7807（Windows 关机/注销杀掉安装器 ⇒ 卸载了没装回），
  // 这类故障用户自己修不了
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-downloaded", (info) => {
    void promptInstall(deps, info.version).catch((err: unknown) => {
      console.error("[desktop] 更新安装提示失败", err);
    });
  });

  // 启动检查失败静默：细节由 electron-updater 自己的 logger 落盘（console 已重定向到 logFile）
  void autoUpdater.checkForUpdates().catch(() => {});
}

/** 下载完成后的原生对话框：默认按钮与 Esc 都是「稍后」（`50-desktop.md` §5.2 安装时机） */
async function promptInstall(deps: UpdateDeps, version: string): Promise<void> {
  const { response } = await dialog.showMessageBox(deps.win, {
    type: "info",
    message: `新版本 ${version} 已下载`,
    detail: `当前版本 v${app.getVersion()}。重启后自动安装，只替换程序文件，不影响你的书库数据。`,
    buttons: ["立即重启安装", "稍后"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return;

  await deps.closeServer(); // 收敛 WAL 与备份调度（同「切换书库」姿势），安装器要替换正在运行的程序文件
  // electron-updater 6.x 的签名是**位置参数** (isSilent, isForceRunAfter)：静默安装 + 装完拉起应用；
  // 7.x 改成了对象参数，本仓 pin 6.x，升级时这里必须一起改
  autoUpdater.quitAndInstall(true, true);
}

/**
 * 菜单「帮助 → 检查更新…」入口：**必须有回应**——已是最新 / 发现新版本（后台下载中）/ 检查失败（附日志路径）。
 * 用户主动点了却没反应 = 像坏了（`50-desktop.md` §5.2 手动路径反馈）。
 */
export async function checkForUpdatesManually(deps: UpdateDeps): Promise<void> {
  if (!isUpdateSupported()) return;

  // 类型从 electron-updater 自己的签名派生，不手抄类型名（pin 升级时不会悄悄漂移）
  let result: Awaited<ReturnType<typeof autoUpdater.checkForUpdates>> = null;
  try {
    result = await autoUpdater.checkForUpdates();
  } catch (err) {
    await showFailure(deps, "检查更新失败", err);
    return;
  }

  if (result === null || result.isUpdateAvailable !== true) {
    await dialog.showMessageBox(deps.win, {
      type: "info",
      message: `已是最新版本（v${app.getVersion()}）`,
      buttons: ["好"],
      noLink: true,
    });
    return;
  }

  // 下载是自动路径（静默），但用户正看着这次手动检查的结果 ⇒ 下载失败不能静默，否则「说下载中却永远没下文」
  void result.downloadPromise?.catch((err: unknown) => showFailure(deps, "下载新版本失败", err));
  await dialog.showMessageBox(deps.win, {
    type: "info",
    message: `发现新版本 v${result.updateInfo.version}，正在后台下载…`,
    detail: "下载完成后会再弹一次对话框，由你决定何时重启安装。",
    buttons: ["好"],
    noLink: true,
  });
}

/** 手动路径的失败应答：错误摘要 + 日志路径（GUI 用户没有终端） */
async function showFailure(deps: UpdateDeps, title: string, err: unknown): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[desktop] ${title}：${detail}`);
  await dialog.showMessageBox(deps.win, {
    type: "error",
    message: title,
    detail: `${detail}\n\n日志：${deps.logFile}`,
    buttons: ["好"],
    noLink: true,
  });
}
