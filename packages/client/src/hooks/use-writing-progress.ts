// 写作页今日目标行的数据（`GET /writing-stats`，本页是该端点的第二个消费点）。
//
// 触发点只有两个（DESIGN.md `writing-page`「卷章导航栏 · 今日目标元信息行」）：进页一次 +
// 保存成功后按 `lib/writing-progress.ts` 的节流窗口刷新。**无定时器 / 轮询 / SSE**。
// 失败静默返回 `null`（不抛、不弹提示）：rail 是附带信息块，不拿错误条盖住卷章导航。
import { useEffect, useRef, useState } from "react";
import type { WritingStatsRes } from "@whispering233/ai-editor-shared";
import { getWritingStats } from "../lib/api";

export interface WritingProgressOptions {
  /** false = 目标关闭 / 未打开项目：不发请求、结果恒 `null` */
  enabled: boolean;
  /** 页面侧 bump 即重新拉一次（节流判定在页面，见 `shouldRefreshProgress`） */
  tick: number;
}

export interface WritingProgressSession {
  /** 服务端统计（未启用 / 未就绪 / 失败 = `null`） */
  stats: WritingStatsRes | null;
  /** 最近一次发起拉取的时刻（ms）；未拉过 = `null`——页面保存后拿它做节流判定 */
  lastFetchedAt: () => number | null;
}

export function useWritingProgress({
  enabled,
  tick,
}: WritingProgressOptions): WritingProgressSession {
  const [stats, setStats] = useState<WritingStatsRes | null>(null);
  const lastFetchedAtRef = useRef<number | null>(null);
  // 关掉 / 换触发点后丢弃在途响应（不让旧结果覆盖 `null`）
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    if (!enabled) {
      lastFetchedAtRef.current = null;
      setStats(null);
      return;
    }
    // 记在发起时刻：窗口内连续保存不再叠加请求（即使这次失败，也等窗口过去再试）
    lastFetchedAtRef.current = Date.now();
    getWritingStats().then(
      (res) => {
        if (seqRef.current === seq) setStats(res);
      },
      () => {
        if (seqRef.current === seq) setStats(null);
      },
    );
  }, [enabled, tick]);

  return { stats, lastFetchedAt: () => lastFetchedAtRef.current };
}
