// 首帧直达上次书籍：页面加载时若已有打开的项目（服务端启动时按创作根 lastProject 自动打开，
// 见 docs/design/build.md §启动流程），且当前 hash 落在书架路由（`#/` 或空）→ 直接进该书概览。
//
// 只在首帧判定一次：`#/` 是「回到书架」的目的地，若持续监听，用户点了回到书架会被立刻弹回书里。
import { useEffect } from "react";
import type { ProjectConfig } from "@whispering233/ai-editor-shared";
import { navigate, parseHashRoute } from "./use-route";
import { useProjectStore } from "../stores/project";

/** 是否应自动进概览（纯函数，供单测）：有已打开的项目 + 当前是书架路由（含未知 hash 回退） */
export function shouldEnterLastBook(config: ProjectConfig | null, hash: string): boolean {
  return config !== null && parseHashRoute(hash).segments.length === 0;
}

/** 应用挂载时调用一次（main.tsx）：等 config 落地后判定并跳转 */
export function useEnterLastBook(): void {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 复用 MainPanel 触发的在途加载（store 共享同一 Promise）；已加载则直接判定
      if (useProjectStore.getState().config === null) {
        await useProjectStore.getState().loadConfig();
      }
      if (cancelled) return;
      // hash 取判定时刻的值：config 落地前用户已经自己导航走 → 不劫持
      if (shouldEnterLastBook(useProjectStore.getState().config, window.location.hash)) {
        navigate("/overview");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
