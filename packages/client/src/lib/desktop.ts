// 桌面版（Electron 外壳）能力桥：**唯一**的能力检测入口。
//
// preload 只在桌面版存在（浏览器形态 = npm CLI + 浏览器，没有这个桥）。任何桌面专属 UI
// 都必须经 `desktopBridge()` 判空决定是否渲染，浏览器形态行为因此完全不变。
/** 界面缩放状态（与主进程 `desktop/src/zoom.ts` 的 `ZoomState` 同形）。
 * 档位表与端点判定都在主进程，客户端**不持档位表**（不出现 80 / 200 字面量）。 */
export interface ZoomState {
  /** 百分比整数（如 125） */
  percent: number;
  /** 已在阶梯最小档 */
  atMin: boolean;
  /** 已在阶梯最大档 */
  atMax: boolean;
  /** 已在 100%（「恢复 100%」无事可做） */
  atDefault: boolean;
}

export interface DesktopBridge {
  /** 弹原生目录选择框；返回选中路径，用户取消返回 null */
  pickDirectory(): Promise<string | null>;
  /** 当前书库位置（创作根绝对路径） */
  getLibraryRoot(): Promise<string | null>;
  /** 更改书库位置：写配置 + 重启应用；返回新路径，用户取消/未变更返回 null */
  changeLibraryRoot(): Promise<string | null>;
  /** 当前缩放状态（百分比 + 端点）；容器挂载时读一次 */
  getZoomState(): Promise<ZoomState>;
  /** 缩放一步：**只接受意图**（`"in"` / `"out"` / `"reset"`），不收数字——档位与 clamp 在主进程 */
  setZoom(intent: "in" | "out" | "reset"): Promise<void>;
  /** 订阅缩放变化（键盘 / 菜单 / 本页按钮都会触发）；返回注销函数 */
  onZoomChanged(handler: (state: ZoomState) => void): () => void;
  /** 关窗前落盘（`50-desktop.md` §1.1）：主进程拦 close 后调一次 handler，返回值即回执（`true` = 落盘成功）。
   * 返回注销函数 */
  onFlushRequest(handler: () => Promise<boolean>): () => void;
}

declare global {
  interface Window {
    aiEditorDesktop?: DesktopBridge;
  }
}

/** 取 preload 桥；非桌面版（或 SSR）返回 null */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.aiEditorDesktop;
  return typeof bridge?.pickDirectory === "function" ? bridge : null;
}
