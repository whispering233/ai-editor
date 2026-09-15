// 桌面版 preload（**必须 CJS**：沙箱 preload 不支持 ESM，见 `docs/design/50-desktop.md` §3）。
//
// 只经 `contextBridge` 暴露**目录选择一个能力**——不暴露 fs / shell / ipcRenderer 原语。
// 浏览器形态（npm CLI + 浏览器）没有这个桥，client 侧一律能力检测（见 `client/src/lib/desktop.ts`）。
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aiEditorDesktop", {
  /** 弹原生目录选择框；返回选中路径，用户取消返回 null */
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("desktop:pick-directory"),
  /** 当前书库位置（创作根绝对路径；启动时已确定） */
  getLibraryRoot: (): Promise<string | null> => ipcRenderer.invoke("desktop:get-library-root"),
  /** 更改书库位置：写配置 + 重启应用；返回新路径，用户取消返回 null */
  changeLibraryRoot: (): Promise<string | null> => ipcRenderer.invoke("desktop:change-library-root"),
});
