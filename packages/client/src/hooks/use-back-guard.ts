// 后退守卫接线（C2）：dirty 时挂哨兵，popstate → 页壳已有的 `confirmDiscard`（对话框不重造）。
// 纯逻辑在 lib/back-guard.ts；这里只做 window 接线 + 每次渲染刷新确认闭包（同 useSaveShortcut 口径）。
import { useEffect, useRef } from "react";
import { createBackGuard, type BackGuard } from "../lib/back-guard";

/** 哨兵条目的状态戳：用来判断「当前条目是不是我们那条同 URL 哨兵」（`history.state` 全站仅此一处使用） */
const SENTINEL_STATE = { backGuard: true } as const;

export function useBackGuard(dirty: boolean, confirmDiscard: () => Promise<boolean>): void {
  const confirmRef = useRef(confirmDiscard);
  confirmRef.current = confirmDiscard;
  const guardRef = useRef<BackGuard | null>(null);

  useEffect(() => {
    const guard = createBackGuard(
      {
        pushSentinel: () => window.history.pushState(SENTINEL_STATE, "", window.location.href),
        onSentinel: () => (window.history.state as { backGuard?: boolean } | null)?.backGuard === true,
        back: () => window.history.back(),
      },
      () => confirmRef.current(),
    );
    guardRef.current = guard;
    window.addEventListener("popstate", guard.handlePopState);
    return () => {
      window.removeEventListener("popstate", guard.handlePopState);
      guard.reset();
      guardRef.current = null;
    };
  }, []);

  // 上面的挂载 effect 先于本条执行（声明顺序）⇒ 首次渲染时 guard 已就绪
  useEffect(() => {
    guardRef.current?.setDirty(dirty);
  }, [dirty]);
}