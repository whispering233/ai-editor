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
}

export function useWritingProgress({
  enabled,
  tick,
}: WritingProgressOptions): WritingProgressSession {
  const [stats, setStats] = useState<WritingStatsRes | null>(null);
  // 关掉 / 换触发点后丢弃在途响应（不让旧结果覆盖 `null`）
  const seqRef = useRef(0);

  // 依赖里没有 `projectId`：换书只发生在书架 / 首页（导航后本页重挂），页内不会换书
  useEffect(() => {
    const seq = ++seqRef.current;
    if (!enabled) {
      setStats(null);
      return;
    }
    getWritingStats().then(
      (res) => {
        if (seqRef.current === seq) setStats(res);
      },
      () => {
        if (seqRef.current === seq) setStats(null);
      },
    );
  }, [enabled, tick]);

  return { stats };
}
