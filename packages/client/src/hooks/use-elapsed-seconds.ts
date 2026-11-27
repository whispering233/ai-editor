// 长任务的「已用时」提示（DESIGN.md §Components `long-task`）。
//
// 为什么不做百分比 / 阶段动画：导出、导入、备份、云推拉都是**单次请求**，客户端只能观测到
// 「开始 / 结束」两个时刻（服务端没有任务化进度）。编出来的阶段文案第二次就会被用户识破，
// 真信号只有两个——「还在跑」和「跑了多久」。阈值只在下面这一处定义，散文与注释只引用常量名。
import { useEffect, useState } from "react";

/** 超过这么久才值得把「已用时」显示出来（更短的等待显示秒数只会制造焦虑） */
export const LONG_TASK_ELAPSED_HINT_MS = 3_000;

/**
 * 长任务进行中每秒递增的秒数（`active=false` 时归零）。
 * 返回 0 表示「刚开始 / 未在跑」——不是错误态。
 */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setSeconds(0);
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1_000);
    return () => clearInterval(timer);
  }, [active]);

  return seconds;
}

/** 阈值之前的秒数不显示（返回 null）；之后给「已用时 N 秒」（纯函数，可单测） */
export function longTaskElapsedLabel(seconds: number): string | null {
  if (seconds * 1_000 < LONG_TASK_ELAPSED_HINT_MS) return null;
  return `已用时 ${seconds} 秒`;
}