// 首帧直达上次工作区：页面加载时若已有打开的项目（服务端启动时按创作根 lastProject 自动打开，
// 见 docs/design/build.md §启动流程），且当前 hash 落在根首页路由（`#/` 或空）→ 直接进该工作区。
//
// 只在首帧判定一次：`#/` 是「回到书架」的目的地，若持续监听，用户点了回到书架会被立刻弹回。
// 落点按 `kind`（`WORKSPACE_ENTRY_PATH`）：小说 → `#/overview`；练习 → `#/practice`（它没有概览页）。
import { useEffect } from "react";
import type { ProjectConfig } from "@whispering233/ai-editor-shared";
import { navigate, parseHashRoute } from "./use-route";
import { WORKSPACE_ENTRY_PATH } from "../lib/workspace";
import { useProjectStore } from "../stores/project";

/** 是否应自动进上次工作区（纯函数，供单测）：有已打开的项目 + 当前是根首页路由（含未知 hash 回退） */
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
      const config = useProjectStore.getState().config;
      if (config === null) return;
      // hash 取判定时刻的值：config 落地前用户已经自己导航走 → 不劫持
      if (shouldEnterLastBook(config, window.location.hash)) {
        navigate(WORKSPACE_ENTRY_PATH[config.kind]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
