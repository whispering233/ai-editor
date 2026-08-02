// 自制 hash 路由（architecture.md 决策：轻量 hash-based useHashRoute，不引入 React Router）
// 解析 location.hash（形如 "#/outline"、"#/entities/character/char-abc"）为结构化路由。
// 路由表见 doc/ui/layout.md §1（8 路由）：#/、#/outline、#/entities/:type?、#/entities/:type/:id、
// #/canvas、#/hooks、#/trash、#/settings（#/chat 已移除——聊天常驻右栏，不再有独立页）
import { useEffect, useState } from "react";

/** 路由结构：path 为归一化路径（如 "/entities/character"），segments 为分段数组 */
export interface Route {
  path: string;
  segments: string[];
  /** 是否为未知 hash 回退（解析与 URL 均回退到 #/） */
  isFallback: boolean;
}

/** 已知路由首段（layout.md 路由表；根路由 "" 由空 segments 表达；#/chat 已移除不再属已知段） */
export const KNOWN_ROUTE_SEGMENTS = [
  "outline",
  "entities",
  "canvas",
  "hooks",
  "trash",
  "settings",
] as const;

/**
 * 解析 hash 为 Route（纯函数，可单测）：
 * - 空 hash / "#/" → 根路由（Dashboard）
 * - 未知首段 → 回退根路由（layout.md：「未知 hash 回退 #/」）
 */
export function parseHashRoute(hash: string): Route {
  const raw = hash.replace(/^#/, "").replace(/^\/+/, "");
  // 过滤空段：尾斜杠（如 #/entities/character/）不产生空 id 段（T7.2）
  const segments = raw === "" ? [] : raw.split("/").filter((s) => s !== "");
  // 首段回退判定（宽容解释）：已知首段集合之外的 hash 一律回退根路由
  const isFallback =
    segments.length > 0 && !(KNOWN_ROUTE_SEGMENTS as readonly string[]).includes(segments[0]);
  if (isFallback) return { path: "/", segments: [], isFallback: true };
  return { path: `/${segments.join("/")}`, segments, isFallback: false };
}

/** 监听 hashchange 的 React hook；未知 hash 同时将 URL 拉回 #/ */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHashRoute(window.location.hash));

  useEffect(() => {
    const normalize = () => {
      const next = parseHashRoute(window.location.hash);
      setRoute(next);
      // 未知 hash 回退 #/（replace 避免污染历史记录）
      if (next.isFallback && window.location.hash !== "#/") {
        window.location.replace("#/");
      }
    };
    window.addEventListener("hashchange", normalize);
    // 初始加载兜底：hashchange 不会在挂载时触发，直接检查一次（T7.2）
    normalize();
    return () => window.removeEventListener("hashchange", normalize);
  }, []);

  return route;
}

/** 导航辅助（layout.md §1：导航统一走 <a href="#/..."> 或 navigate(path)） */
export function navigate(path: string): void {
  const target = path.startsWith("#")
    ? path
    : `#${path.startsWith("/") ? path : `/${path}`}`;
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}
