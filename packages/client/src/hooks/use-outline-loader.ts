// 大纲树的「按页加载」（卡 12.5）：GET /outline 的 with_metadata=true 是 outline.json × data.db 的
// 联查统计（节点三计数 + **章的正文字数 textLength**）——只有展示这些统计的页面（大纲页 / 章详情页）
// 需要，故不动 store 的默认加载口径（其余页面保持轻量，见 lib/api.ts getOutline 注释）。
//
// 本 hook 承担三件事：
// ① 树未加载 → 按本页需要拉一次（失败后 retry 可再拉；store 静默吞错，页面以 outline===null 兜底）；
// ② 需要统计的页面遇到「树已在 store 但无统计」（其他页加载的）→ 本页补拉一次；
// ③ `reload` 给本页所有写操作后的重拉用：树一换，统计口径跟着换，否则字数会凭空消失。
import { useCallback, useEffect, useState } from "react";
import { useProjectStore } from "../stores/project";

export interface OutlineLoader {
 /** 本页口径的大纲加载（首拉 / 写操作后重拉 / 跨页刷新信号都用它） */
  reload: () => Promise<void>;
 /** 失败重试：重置首拉标记，让加载 effect 再跑一次 */
  retry: () => void;
}

/**
 * @param withMetadata 是否要联表统计（章 `metadata.textLength` 等）
 */
export function useOutlineLoader({ withMetadata }: { withMetadata: boolean }): OutlineLoader {
  const outline = useProjectStore((s) => s.outline);
  const outlineLoading = useProjectStore((s) => s.outlineLoading);
  const outlineWithMetadata = useProjectStore((s) => s.outlineWithMetadata);
  const loadOutline = useProjectStore((s) => s.loadOutline);
  const [loadAttempted, setLoadAttempted] = useState(false);

  const reload = useCallback(
    () => loadOutline({ withMetadata }),
    [loadOutline, withMetadata],
  );

  useEffect(() => {
 // 在途加载结束后本 effect 重跑（outlineLoading 在依赖里）——否则「并发加载中调用被 store 早退」
 // 会让本页永远停在没有统计的树上
    if (outlineLoading) return;
    if (outline === null) {
      if (loadAttempted) return;
      setLoadAttempted(true);
      void reload();
      return;
    }
 // 不要统计的页面不重拉（树内容一致，少一次请求）；要统计的页面补齐一次
    if (withMetadata && !outlineWithMetadata) void reload();
  }, [outline, outlineLoading, outlineWithMetadata, loadAttempted, reload, withMetadata]);

  return { reload, retry: () => setLoadAttempted(false) };
}
