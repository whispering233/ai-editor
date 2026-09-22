// pi 运行时：解码速度测量（状态栏速度段）
//
// 契约 = docs/api/80-api-chat.md「会话用量字段 · speed」+ docs/design/20-context.md §2.1：
// 区间 = 首个流式增量 → `message_end`（**刻意避开首字延迟与排队**——否则同一模型的速度会随网络
// 抖动），分子 = 该条消息的 `usage.output`（含思考 token）。只报最近一轮：不做实时估算
// （需自建 chars→token 估算 = 第二套口径），不做会话平均。
//
// 时序只在本模块产生：`onEvent` 由事件投影逐事件喂入，返回 `speed` 表示帧里该带这个字段。

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ChatSpeed } from "@whispering233/ai-editor-shared";

/**
 * 最小时长守卫：短于此值的样本不下发（时长极小 ⇒ tps 被首包与网络抖动放大成假数字）。
 * 单位毫秒；数值单源在此。
 */
export const SPEED_MIN_DURATION_MS = 250;

/** 算作「已开始生成」的增量类型（start / end 类事件不算） */
const DELTA_EVENT_TYPES: ReadonlySet<string> = new Set<string>(["text_delta", "thinking_delta", "toolcall_delta"]);

export interface SpeedMeterOptions {
  /** 时钟（缺省 `performance.now()`；测试注入假时钟） */
  now?: () => number;
}

export interface SpeedMeter {
  /** 喂入一个会话事件 → 该事件是可用的速度样本时返回速度，否则 `null` */
  onEvent(event: AgentSessionEvent): ChatSpeed | null;
}

/** 单个会话的解码速度测量器（每条 assistant 消息一个样本；非流式回退与失败轮次不下发） */
export function createSpeedMeter({ now = () => performance.now() }: SpeedMeterOptions = {}): SpeedMeter {
  let startedAt: number | null = null;

  return {
    onEvent(event) {
      if (
        event.type === "message_update" &&
        event.message.role === "assistant" &&
        DELTA_EVENT_TYPES.has(event.assistantMessageEvent.type)
      ) {
        startedAt ??= now(); // 只在首个增量起表
        return null;
      }
      if (event.type !== "message_end" || event.message.role !== "assistant") return null;

      const started = startedAt;
      startedAt = null; // 样本用掉即清表（下一条消息重新起表）
      if (started === null) return null; // 从未收到增量（非流式回退）

      const { output } = event.message.usage;
      if (output <= 0) return null;
      const { stopReason } = event.message;
      if (stopReason === "error" || stopReason === "aborted") return null;

      const ms = now() - started;
      if (ms < SPEED_MIN_DURATION_MS) return null;
      return { outputTokens: output, ms, tps: output / (ms / 1000) };
    },
  };
}
