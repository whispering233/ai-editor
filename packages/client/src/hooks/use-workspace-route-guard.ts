// 工作区类型路由守卫（**UX 守卫**，卡 8）：练习工作区（`kind = "practice"`）下只允许它的页面。
//
// 边界在哪：**服务端 `requireKind` 才是边界**（小说语义端点被练习工作区访问 → 400 `KIND_MISMATCH`）；
// 这里只是不把用户送进必然报错的页面（左栏本就没有入口，手输 hash / 旧书签 / 开机直达仍可能落进去）。
//
// 口径 = **fail-closed 允许清单**（不要改成「枚举小说语义路由」的拒绝清单：新增小说路由会默认漏掉）：
//   `#/`（根首页 = 工作区聚合入口，两种 kind 都可达）/ `#/practice` 及其子路径 / `#/preferences`（设置）。
// 单一实现处 = 本模块的 `practiceRedirectPath`；调用点只有 `main.tsx`（不要在各页面各判一遍）。
import { useEffect } from "react";
import type { WorkspaceKind } from "@whispering233/ai-editor-shared";
import { navigate, type Route } from "./use-route";
import { useProjectStore } from "../stores/project";

/** 练习工作区允许的 hash 首段（根路由 `#/` 由空 segments 表达，单独允许） */
export const PRACTICE_ALLOWED_SEGMENTS: readonly string[] = ["practice", "preferences"];

/** 练习工作区的落点（被挡下的 hash 一律去这里——它唯一的页面） */
export const PRACTICE_REDIRECT_PATH = "/practice";

/**
 * 该路由是否需要在当前工作区类型下重定向（纯函数，供单测）：
 * 返回目标 path，或 null = 允许通行。小说工作区不设守卫（其路由表全量可达）。
 */
export function practiceRedirectPath(kind: WorkspaceKind, route: Route): string | null {
  if (kind !== "practice") return null;
  const first = route.segments[0];
  if (first === undefined || PRACTICE_ALLOWED_SEGMENTS.includes(first)) return null;
  return PRACTICE_REDIRECT_PATH;
}

/**
 * 挂载在工作区外壳（`main.tsx` 的 `App`）：当前工作区是练习、且 hash 落在允许清单之外 → 重定向。
 * 依赖 `config.kind`（未打开项目 / 配置未落地时不判定——首帧落点由 `useEnterLastBook` 负责）。
 */
export function useWorkspaceRouteGuard(route: Route): void {
  const kind = useProjectStore((s) => s.config?.kind ?? null);
  useEffect(() => {
    if (kind === null) return;
    const target = practiceRedirectPath(kind, route);
    if (target !== null) navigate(target);
  }, [kind, route]);
}
