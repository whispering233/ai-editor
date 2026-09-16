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

/**
 * 手动检查进行中（v0.0.44 真机实测的修正）：
 * `checkForUpdates()` 只**发起**下载就返回，而下载完成事件（`update-downloaded`）稍后才触发——
 * 两条路径各弹一个框就会出现「先『正在后台下载』、紧接着『已下载』」的双弹窗
 * （差分 0 字节时几乎是瞬间叠在一起）。约定：**手动流程期间，对话框由手动流程独占**，事件不弹框。
 */
let manualCheckInFlight = false;

/** 「下载是不是已经好了」的判定窗口：缓存命中/差分 0 字节时是毫秒级，超过它就说明真在下 */
const INSTANT_DOWNLOAD_MS = 1200;

/** 启动后台检查（在窗口 loadURL 之后调用；仅 win32 且安装态真正发起请求） */
export function setupAutoUpdate(deps: UpdateDeps): void {
  if (!isUpdateSupported()) return;

  // electron-updater 的 logger 默认就是 `console`，但它的 info 走 `console.info`——而 `log.ts` 只接管了
  // `console.log/warn/error`（实测 `console.info !== console.log`）⇒ 不显式接一遍，更新流程的 info 行
  // （Checking for update / Found version … / Downloading …）只会写 stdout、**安装态无人收**，真机排障时
  // 日志里只剩 error。箭头包装（而非直接写 `console.log`）：调用时才查当前方法，不依赖
  // 「本函数必须在 redirectConsoleToFile 之后跑」这条隐式顺序。
  autoUpdater.logger = {
    info: (message: unknown) => console.log(message),
    warn: (message: unknown) => console.warn(message),
    error: (message: unknown) => console.error(message),
  };

  // 本仓只发**完整** nsis 安装包（不发 nsis-web 差分包）：显式关掉 web installer，兼消除上游
  // 「disableWebInstaller is set to false …」告警（真机日志里出现过）。
  autoUpdater.disableWebInstaller = true;

  // 发现即后台下载，下载期间不打扰用户（提示只在 update-downloaded 之后）
  autoUpdater.autoDownload = true;
  // **只在用户确认后安装**：退出时静默替换撞上游 #7807（Windows 关机/注销杀掉安装器 ⇒ 卸载了没装回），
  // 这类故障用户自己修不了
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-downloaded", (info) => {
    // 手动检查进行中时，对话框由那条流程自己弹（否则真机实测会弹两个： 「正在后台下载」+ 「已下载」）
    if (manualCheckInFlight) return;
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
 * 菜单「帮助 → 检查更新…」入口：**必须有回应且只弹一个框**——已是最新 / 新版本已下载（带安装按钮）/ 失败（附日志路径）。
 * 用户主动点了却没反应 = 像坏了（`50-desktop.md` §5.2 手动路径反馈）。
 */
export async function checkForUpdatesManually(deps: UpdateDeps): Promise<void> {
  if (!isUpdateSupported()) return;

  // 连点菜单：上游会把并发检查去重，但对话框会叠——这里直接给一句真话
  if (manualCheckInFlight) {
    await info(deps, "正在检查 / 下载更新", "完成后会提示你重启安装。");
    return;
  }
  manualCheckInFlight = true;
  try {
    // 类型从 electron-updater 自己的签名派生，不手抄类型名（pin 升级时不会悄悄漂移）
    let result: Awaited<ReturnType<typeof autoUpdater.checkForUpdates>> = null;
    try {
      result = await autoUpdater.checkForUpdates();
    } catch (err) {
      await showFailure(deps, "检查更新失败", err);
      return;
    }

    if (result === null || result.isUpdateAvailable !== true) {
      await info(deps, `已是最新版本（v${app.getVersion()}）`);
      return;
    }

    const version = result.updateInfo.version;
    const downloadPromise = result.downloadPromise;
    if (downloadPromise === null || downloadPromise === undefined) {
      // autoDownload 关掉时才会走到（当前配置不会）；防御性给一句
      await info(deps, `发现新版本 v${version}`, "下载完成后重启安装即可。");
      return;
    }

    // 先看它会不会秒完（已缓存 / 差分 0 字节）：秒完就**不说**「正在下载」——那是假话，也是双弹窗的来源
    const finishedInstantly = await Promise.race([
      downloadPromise.then(
        () => true,
        () => true, // 失败也当「已结束」：下面 await 会拿到真正的错误
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), INSTANT_DOWNLOAD_MS)),
    ]);
    if (!finishedInstantly) {
      await info(deps, `发现新版本 v${version}，正在后台下载…`, "完成后会提示你重启安装。");
    }

    try {
      await downloadPromise;
    } catch (err) {
      await showFailure(deps, "下载新版本失败", err);
      return;
    }

    // 下载完成的提示与安装确认都由手动流程自己弹（事件已被 manualCheckInFlight 挡掉）
    await promptInstall(deps, version);
  } finally {
    manualCheckInFlight = false;
  }
}

/** 手动路径的普通提示（单按钮） */
async function info(deps: UpdateDeps, message: string, detail?: string): Promise<void> {
  await dialog.showMessageBox(deps.win, {
    type: "info",
    message,
    ...(detail === undefined ? {} : { detail }),
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
