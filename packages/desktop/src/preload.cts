// 桌面版 preload（**必须 CJS**：沙箱 preload 不支持 ESM，见 `docs/design/50-desktop.md` §3）。
//
// K0 只验证「编译成 .cjs + 被 Electron 按沙箱 preload 加载」这条路径；目录选择能力（
// `pickDirectory`）属 K2——届时经 `contextBridge` 暴露，**不暴露 fs/shell/ipcRenderer 原语**。
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("aiEditorDesktop", { ready: true });
