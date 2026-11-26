// 桌面版 preload（**必须 CJS**：沙箱 preload 不支持 ESM，见 `docs/design/50-desktop.md` §3）。
//
// 只经 `contextBridge` 暴露能力函数（目录选择 / 书库位置 / 关窗落盘回执 / 界面缩放三件套）——
// 不暴露 fs / shell / ipcRenderer 原语。
// 通道名在这里写字面量而非 import：沙箱 preload 只能 require electron（`50-desktop.md` §3）。
// 浏览器形态（npm CLI + 浏览器）没有这个桥，client 侧一律能力检测（见 `client/src/lib/desktop.ts`）。
import { contextBridge, ipcRenderer } from "electron";

/** 缩放状态（与主进程 `zoom.ts` 的 `ZoomState` 同形；沙箱 preload 不能 import 主进程模块，只能各自声明） */
interface ZoomState {
  percent: number;
  atMin: boolean;
  atMax: boolean;
  atDefault: boolean;
}

contextBridge.exposeInMainWorld("aiEditorDesktop", {
  /** 弹原生目录选择框；返回选中路径，用户取消返回 null */
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("desktop:pick-directory"),
  /** 当前书库位置（创作根绝对路径；启动时已确定） */
  getLibraryRoot: (): Promise<string | null> => ipcRenderer.invoke("desktop:get-library-root"),
  /** 更改书库位置：写配置 + 重启应用；返回新路径，用户取消返回 null */
  changeLibraryRoot: (): Promise<string | null> => ipcRenderer.invoke("desktop:change-library-root"),
  /** 当前缩放状态（百分比 + 端点）；口径见 `50-desktop.md` §4.1「通道」 */
  getZoomState: (): Promise<ZoomState> => ipcRenderer.invoke("desktop:get-zoom-state"),
  /** 缩放一步：**只接受意图**（`"in"` / `"out"` / `"reset"`），不收数字——档位与 clamp 在主进程 */
  setZoom: (intent: "in" | "out" | "reset"): Promise<void> => ipcRenderer.invoke("desktop:set-zoom", intent),
  /** 每次档位变化的主进程推送（口径同 `onFlushRequest`：返回注销函数，但不需要回执） */
  onZoomChanged: (handler: (state: ZoomState) => void): (() => void) => {
    const listener = (_event: unknown, state: ZoomState): void => handler(state);
    ipcRenderer.on("desktop:zoom-changed", listener);
    return () => {
      ipcRenderer.removeListener("desktop:zoom-changed", listener);
    };
  },
  /**
   * 关窗前落盘（`50-desktop.md` §1.1）：主进程拦 close 后调一次 handler，把结果当回执发回。
   * 返回注销函数；handler 抛错按失败回执（不让主进程白等到超时）。
   */
  onFlushRequest: (handler: () => Promise<boolean>): (() => void) => {
    const listener = (): void => {
      void (async () => {
        let ok = false;
        try {
          ok = (await handler()) === true;
        } catch {
          ok = false;
        }
        ipcRenderer.send("desktop:flush-done", ok);
      })();
    };
    ipcRenderer.on("desktop:flush-request", listener);
    return () => {
      ipcRenderer.removeListener("desktop:flush-request", listener);
    };
  },
});
