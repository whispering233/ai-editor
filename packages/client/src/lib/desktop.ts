// 桌面版（Electron 外壳）能力桥：**唯一**的能力检测入口。
//
// preload 只在桌面版存在（浏览器形态 = npm CLI + 浏览器，没有这个桥）。任何桌面专属 UI
// 都必须经 `desktopBridge()` 判空决定是否渲染，浏览器形态行为因此完全不变。
export interface DesktopBridge {
  ready: boolean;
  /** 弹原生目录选择框；返回选中路径，用户取消返回 null */
  pickDirectory(): Promise<string | null>;
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
