// 界面缩放的变化提示（`docs/design/50-desktop.md` §4.1「可见性」）：挂在应用外壳层 ⇒ 任意页面
// （含专注模式、左栏收起）按 `Ctrl/Cmd + = / - / 0` 都能得到反馈。
//
// 提示源 = 主进程推的 `onZoomChanged`（快捷键 / 应用菜单 / 设置页卡三个入口都经它），
// 同 `key: "zoom"` ⇒ 连按只升级同一条、不叠条（`toast` 的同槽位语义）。浏览器形态没有这条通道。
import { useEffect } from "react";
import { desktopBridge } from "../lib/desktop";
import { useUiStore } from "../stores/ui";

export function useZoomNotice(): void {
  useEffect(() => {
    const bridge = desktopBridge();
    if (bridge === null) return;
    return bridge.onZoomChanged((state) => {
      useUiStore.getState().showToast(`界面缩放 ${state.percent}%`, "info", "zoom");
    });
  }, []);
}
