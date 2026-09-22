// pi 运行时：会话事件 → SSE 帧投影
//
// 契约 = docs/api/80-api-chat.md「SSE 事件集 + 过滤约定」：本模块是该契约的**唯一实现点**。
// 三件必须做的事（每件都有「不做就会出事」的理由）：
// 1. **剥离 `partial`/完整消息大对象**：pi 的增量事件都挂一份完整消息快照，原样转发单帧可达数百 KB。
// 2. **thinking 降预览**：全文走按需端点，帧里只给预览 + 定位参数（流式期间已由 thinking_delta 下发增量）。
// 3. **AUTO 工具的 `details` 不下发**：与 `content` 重复且可能极大；只有 PROPOSAL 工具的
//    details（提案载荷）是 UI 的真实消费面。
//
// 丢弃 pi 的内部状态事件（entry_appended / queue_update / session_info_changed /
// thinking_level_changed / agent_settled / summarization_retry_* / bash_execution_update）：
// 事件表没有登记 = UI 没有消费方，转发只会变成无人接的噪声。

import type { AgentSessionEvent, ContextUsage } from "@earendil-works/pi-coding-agent";
import { PROPOSAL_TOOLS, type ChatUsage } from "@whispering233/ai-editor-shared";
import { getThinkingPreview, projectMessageForWire, type WireMessage } from "./message-projection.js";
import type { SpeedMeter } from "./speed.js";

/** 一帧 SSE（`event: <event>` + `data: <json>`） */
export interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

/** 投影选项（每轮取值都是「当前时刻」的函数，不做快照缓存） */
export interface SseProjectionOptions {
  /** 占用条口径：由 `AgentSession.getContextUsage()` 提供（turn_end / agent_end 帧附带） */
  getContextUsage?: () => ContextUsage | undefined;
  /** 状态栏账目：由 `sessionUsage(entries, ...)` 提供（turn_end / agent_end 帧附带；返回 undefined 则省略该键） */
  getSessionUsage?: () => ChatUsage | undefined;
  /** 解码速度测量器（每个事件喂一次；样本由 assistant 的 message_end 帧下发，见 docs/design/20-context.md §2.1） */
  speedMeter?: SpeedMeter;
}

type MessageUpdateEvent = Extract<AgentSessionEvent, { type: "message_update" }>;
type AssistantMessageEventOf = MessageUpdateEvent["assistantMessageEvent"];

/** 提案工具名集合（details 门控依据；shared 常量是工具名的唯一事实来源） */
const PROPOSAL_TOOL_NAME_SET: ReadonlySet<string> = new Set<string>(PROPOSAL_TOOLS);

/** 丢弃的事件类型（未登记进事件表的内部状态） */
const DROPPED_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  "entry_appended",
  "queue_update",
  "session_info_changed",
  "thinking_level_changed",
  "agent_settled",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "bash_execution_update",
]);

/** 服务端合成的会话帧（流的首帧：客户端据此持久化「当前会话」） */
export function createSessionFrame(sessionId: string): SseFrame {
  return { event: "session", data: { session_id: sessionId } };
}

/** 心跳帧（探活 + 断开检测；载荷恒为空） */
export function createPingFrame(): SseFrame {
  return { event: "ping", data: {} };
}

/**
 * 占用条字段（无 getContextUsage 或返回 undefined 时不带该键）。
 * 导出供 server 合成 agent_end 复用——字段名只在此处拼一次。
 */
export function contextUsageField(options: SseProjectionOptions): Record<string, unknown> {
  const usage = options.getContextUsage?.();
  if (usage === undefined) return {};
  return {
    contextUsage: { percent: usage.percent, tokens: usage.tokens, contextWindow: usage.contextWindow },
  };
}

/** 会话累计用量字段（无 getSessionUsage 或返回 undefined 时不带该键） */
function usageField(options: SseProjectionOptions): Record<string, unknown> {
  const usage = options.getSessionUsage?.();
  return usage === undefined ? {} : { usage };
}

/** 从 partial 快照里取工具调用的 id/name（toolcall_start/delta 事件不带这两个字段） */
function toolCallMetadata(event: MessageUpdateEvent): { id: string; toolName: string } | null {
  const assistantEvent = event.assistantMessageEvent as {
    type: string;
    contentIndex?: unknown;
    partial?: { content?: unknown };
  };
  if (assistantEvent.type !== "toolcall_start" && assistantEvent.type !== "toolcall_delta") return null;
  const content = assistantEvent.partial?.content;
  const contentIndex = assistantEvent.contentIndex;
  if (!Array.isArray(content) || typeof contentIndex !== "number") return null;
  const block = content[contentIndex] as { type?: unknown; id?: unknown; name?: unknown } | undefined;
  if (block === undefined || block.type !== "toolCall") return null;
  const id = typeof block.id === "string" ? block.id : null;
  const toolName = typeof block.name === "string" ? block.name : null;
  return id !== null && toolName !== null ? { id, toolName } : null;
}

/**
 * assistant 增量事件投影：剥离 `partial`（完整消息快照）。
 * `done` / `error` 两种收尾事件还挂着完整消息（`message` / `error`），同样只留 `reason`——
 * 消息终态由随后的 `message_end` 帧负责。
 */
function projectAssistantMessageEvent(event: AssistantMessageEventOf): Record<string, unknown> {
  if (event.type === "done") return { type: "done", reason: event.reason };
  if (event.type === "error") return { type: "error", reason: event.reason };

  const { partial: _partial, ...rest } = event as unknown as Record<string, unknown> & { partial?: unknown };
  void _partial;
  // thinking_end 的 content 是整段思维链（可达数十 KB）：客户端已通过 thinking_delta 拿到增量、
  // 终态由 message_end 的预览负责（全文走按需端点）——这里降为预览，避免单帧数百 KB。
  if (event.type === "thinking_end" && typeof rest.content === "string") {
    return { ...rest, content: getThinkingPreview(rest.content), contentLength: rest.content.length };
  }
  const metadata = toolCallMetadata({ assistantMessageEvent: event } as MessageUpdateEvent);
  return metadata === null ? rest : { ...rest, ...metadata };
}

/** 末条 assistant 消息的失败信息（agent_end 帧用：错误/中止时带 stopReason） */
function lastAssistantFailure(messages: readonly unknown[]): Record<string, unknown> {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; stopReason?: unknown; errorMessage?: unknown } | undefined;
    if (message === undefined || message.role !== "assistant") continue;
    const stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
    if (stopReason !== "error" && stopReason !== "aborted") return {};
    return {
      stopReason,
      ...(typeof message.errorMessage === "string" ? { errorMessage: message.errorMessage } : {}),
    };
  }
  return {};
}

/** 消息帧的 `{ message }` 载荷（未知角色 → null，调用方丢弃该帧） */
function messageField(message: unknown): Record<string, unknown> | null {
  const projected: WireMessage | null = projectMessageForWire(message);
  return projected === null ? null : { message: projected };
}

/**
 * 单个 pi 会话事件 → SSE 帧；不投影的事件返回 null（调用方跳过）。
 * 帧内容只由输入与 options 取值决定（便于单测逐事件断言）；唯一例外是 `speedMeter` 的有状态推进：
 * 同样的输入 + 同样的 options 取值 + 同样的 meter 状态 ⇒ 同样的帧。
 */
export function toSseFrame(event: AgentSessionEvent, options: SseProjectionOptions = {}): SseFrame | null {
  // 每个事件先喂一次 meter（它自己按事件类型决定起表/出样本），样本只在 assistant 的 message_end 帧用上
  const speed = options.speedMeter?.onEvent(event) ?? null;
  const type = (event as { type: string }).type;
  if (DROPPED_EVENT_TYPES.has(type)) return null;

  switch (type) {
    case "agent_start":
    case "turn_start":
      return { event: type, data: {} };

    case "message_start":
    case "message_end": {
      const message = (event as { message: unknown }).message;
      const data = messageField(message);
      if (data === null) return null;
      // speed 只挂 assistant 的 message_end（meter 也只在该事件出样本；此处再按角色收窄，非 assistant 帧绝无该键）
      if (type !== "message_end" || speed === null || (message as { role?: unknown }).role !== "assistant") {
        return { event: type, data };
      }
      return { event: type, data: { ...data, speed } };
    }

    case "message_update": {
      const update = event as MessageUpdateEvent;
      // 只投影 assistant 的增量：pi 的 message_update 仅对 assistant 消息触发（文档事件表同款），
      // 其他角色出现即视为未知事件，丢弃而不是转发一个前端无法归属的 delta。
      const role = (update.message as { role?: unknown } | undefined)?.role;
      if (role !== "assistant") return null;
      // **不带 `message`**：pi 的增量事件里挂着完整消息快照，一旦转发就等于把「partial 剥离」
      // 白做（正文会随每个 chunk 重复下发）；消息终态由 message_end 帧负责。
      return {
        event: "message_update",
        data: { assistantMessageEvent: projectAssistantMessageEvent(update.assistantMessageEvent) },
      };
    }

    case "tool_execution_start":
    case "tool_execution_update": {
      const execution = event as { toolCallId: string; toolName: string; args?: unknown; partialResult?: unknown };
      return {
        event: type,
        data: {
          toolCallId: execution.toolCallId,
          toolName: execution.toolName,
          ...(type === "tool_execution_start"
            ? { args: execution.args }
            : { partialResult: execution.partialResult }),
        },
      };
    }

    case "tool_execution_end": {
      const execution = event as { toolCallId: string; toolName: string; result: unknown; isError: boolean };
      return {
        event: "tool_execution_end",
        data: {
          toolCallId: execution.toolCallId,
          toolName: execution.toolName,
          result: projectToolResult(execution.toolName, execution.result),
          isError: execution.isError,
        },
      };
    }

    case "turn_end": {
      const turn = event as { toolResults: readonly unknown[] };
      return {
        event: "turn_end",
        data: {
          toolResults: turn.toolResults
            .map((result) => projectMessageForWire(result))
            .filter((result): result is WireMessage => result !== null),
          ...contextUsageField(options),
          ...usageField(options),
        },
      };
    }

    case "compaction_start": {
      const compaction = event as { reason: string };
      return { event: "compaction_start", data: { reason: compaction.reason } };
    }

    case "compaction_end": {
      const compaction = event as {
        reason: string;
        result: unknown;
        aborted: boolean;
        willRetry: boolean;
        errorMessage?: string;
      };
      return {
        event: "compaction_end",
        data: {
          reason: compaction.reason,
          ...(compaction.result === undefined ? {} : { result: compaction.result }),
          aborted: compaction.aborted,
          willRetry: compaction.willRetry,
          ...(compaction.errorMessage === undefined ? {} : { errorMessage: compaction.errorMessage }),
        },
      };
    }

    case "auto_retry_start": {
      const retry = event as { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string };
      return {
        event: "auto_retry_start",
        data: {
          attempt: retry.attempt,
          maxAttempts: retry.maxAttempts,
          delayMs: retry.delayMs,
          errorMessage: retry.errorMessage,
        },
      };
    }

    case "auto_retry_end": {
      const retry = event as { success: boolean; attempt: number; finalError?: string };
      return {
        event: "auto_retry_end",
        data: {
          success: retry.success,
          attempt: retry.attempt,
          ...(retry.finalError === undefined ? {} : { finalError: retry.finalError }),
        },
      };
    }

    case "agent_end": {
      const end = event as { messages: readonly unknown[] };
      return {
        event: "agent_end",
        data: { ...lastAssistantFailure(end.messages), ...contextUsageField(options), ...usageField(options) },
      };
    }

    default:
      return null;
  }
}

/**
 * 工具结果 projection：
 * - AUTO 工具：只给 `content`（details 与 content 重复，且可能是整棵大纲/全图）
 * - PROPOSAL 工具：附带 `details`（提案载荷 `{ proposal_id, type, preview }`，前端提案卡的唯一数据面）
 */
function projectToolResult(toolName: string, result: unknown): Record<string, unknown> {
  const record = (typeof result === "object" && result !== null ? result : {}) as Record<string, unknown>;
  const content = record.content ?? [];
  if (!PROPOSAL_TOOL_NAME_SET.has(toolName)) return { content };
  return record.details === undefined ? { content } : { content, details: record.details };
}
