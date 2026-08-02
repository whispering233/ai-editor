// 响应式媒体查询 hook（doc/ui/layout.md §0：<1024px 时右栏折叠为抽屉）
// 基于 matchMedia 的 change 事件监听（而非 resize 轮询）；断点跨越时自动重渲染，
// ChatPanel 据此在「静态右栏 ↔ fixed 抽屉」之间切换
import { useEffect, useState } from "react";

/** 监听媒体查询是否匹配；查询串变化时重新订阅 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // 初次挂载兜底：组件挂载晚于查询变化时以当前值校准
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
