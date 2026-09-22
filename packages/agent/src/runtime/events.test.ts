// K3 事件投影测试：pi 会话事件 → SSE 帧（契约 = docs/api/80-api-chat.md 事件表 + 过滤约定）
//
// 硬性检查点：
// - 丢弃表（内部状态事件 → null；未登记事件也 → null）
// - `partial` 剥离（含 done/error 挂的完整消息）——帧的任意层级都不含大对象
// - message_update 的 toolcall_* 附带 id/toolName（前端提前渲染用）
// - thinking 降预览（全文不进帧）
// - tool_execution_end 的 details 门控（PROPOSAL 才下发）
// - turn_end / agent_end 的 contextUsage（含 tokens/percent 为 null）与失败信息、usage
// - assistant 的 message_end 的 speed（meter 喂入 / 无 meter / 非 assistant 三种情形）

import { describe, expect, it } from "vitest";
import type { AgentSessionEvent, ContextUsage } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { ChatUsage } from "@whispering233/ai-editor-shared";
import { createPingFrame, createSessionFrame, toSseFrame, type SseProjectionOptions } from "./events.js";
import { createSpeedMeter, SPEED_MIN_DURATION_MS, type SpeedMeter } from "./speed.js";

// ============ 构造辅助 ============

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: AssistantMessage["content"], overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "faux",
    model: "faux-1",
    usage: USAGE,
    stopReason: "stop",
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function user(text: string): UserMessage {
  return { role: "user", content: text, timestamp: 1_700_000_000_000 };
}

function toolResult(text: string, isError = false): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "get_outline",
    content: [{ type: "text", text }],
    isError,
    timestamp: 1_700_000_000_000,
  };
}

/** 事件构造（pi 事件联合类型较宽，测试只关心被投影的字段） */
function asEvent(value: unknown): AgentSessionEvent {
  return value as AgentSessionEvent;
}

/** 帧里任意层级不允许出现的键（大对象/全量消息） */
function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      collectKeys(item, keys);
    }
  }
  return keys;
}

// ============ 合成帧 ============

describe("合成帧", () => {
  it("session：带 session_id（流首帧，客户端据此持久化当前会话）", () => {
    expect(createSessionFrame("sess-abc")).toEqual({ event: "session", data: { session_id: "sess-abc" } });
  });

  it("ping：空载荷", () => {
    expect(createPingFrame()).toEqual({ event: "ping", data: {} });
  });
});

// ============ 生命周期与轮次 ============

describe("生命周期帧", () => {
  it("agent_start / turn_start → 空 data", () => {
    expect(toSseFrame(asEvent({ type: "agent_start" }))).toEqual({ event: "agent_start", data: {} });
    expect(toSseFrame(asEvent({ type: "turn_start" }))).toEqual({ event: "turn_start", data: {} });
  });

  it("丢弃内部状态事件（未登记进事件表）", () => {
    const dropped: unknown[] = [
      { type: "entry_appended", entry: { type: "message" } },
      { type: "queue_update", steering: [], followUp: [] },
      { type: "session_info_changed", name: "x" },
      { type: "thinking_level_changed", level: "high" },
      { type: "agent_settled" },
      { type: "summarization_retry_finished" },
      { type: "bash_execution_update", delta: "x" },
    ];
    for (const event of dropped) {
      expect(toSseFrame(asEvent(event))).toBeNull();
    }
  });
});

// ============ 消息帧 ============

describe("消息帧", () => {
  it("message_start / message_end：投影消息（user）", () => {
    const event = asEvent({ type: "message_start", message: user("发起") });
    expect(toSseFrame(event)).toEqual({
      event: "message_start",
      data: { message: { role: "user", content: "发起", createdAt: new Date(1_700_000_000_000).toISOString() } },
    });
  });

  it("message_start / message_end：tool 结果消息投影", () => {
    const event = asEvent({ type: "message_end", message: toolResult("结果", true) });
    const frame = toSseFrame(event);
    expect(frame?.data.message).toEqual({
      role: "tool",
      content: "结果",
      toolCallId: "call-1",
      isError: true,
      createdAt: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it("未知角色消息 → 丢弃该帧", () => {
    const event = asEvent({ type: "message_end", message: { role: "custom", customType: "compaction" } });
    expect(toSseFrame(event)).toBeNull();
  });

  it("message_end：长思维链降为 240 字预览，全文不进帧", () => {
    const longThinking = "推".repeat(5000);
    const event = asEvent({
      type: "message_end",
      message: assistant([{ type: "thinking", thinking: longThinking }, { type: "text", text: "结论" }]),
    });
    const frame = toSseFrame(event);
    const data = frame?.data as { message: { content: string; thinking: Array<{ preview: string; length: number }> } };
    expect(data.message.content).toBe("结论");
    expect(data.message.thinking[0]?.preview).toHaveLength(240);
    expect(data.message.thinking[0]?.length).toBe(5000);
    expect(JSON.stringify(frame)).not.toContain(longThinking);
  });
});

// ============ message_update（增量） ============

describe("message_update 投影", () => {
  it("剥离 partial（含完整消息快照），保留 delta 与 contentIndex", () => {
    const partial = assistant([{ type: "text", text: "已生成的全部文本".repeat(100) }]);
    const event = asEvent({
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "新增", partial },
    });
    const frame = toSseFrame(event);
    const delta = (frame?.data as { assistantMessageEvent: Record<string, unknown> }).assistantMessageEvent;
    expect(delta).toEqual({ type: "text_delta", contentIndex: 0, delta: "新增" });
    expect(collectKeys(frame).has("partial")).toBe(false);
    expect(JSON.stringify(frame)).not.toContain("已生成的全部文本");
  });

  it("toolcall_delta：从 partial 里取 id/toolName 附到帧上（前端提前渲染工具卡）", () => {
    const partial = assistant([
      { type: "toolCall", id: "call-7", name: "get_outline", arguments: {} },
    ]);
    const event = asEvent({
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "{\"a", partial },
    });
    const delta = (toSseFrame(event)?.data as { assistantMessageEvent: Record<string, unknown> })
      .assistantMessageEvent;
    expect(delta).toEqual({ type: "toolcall_delta", contentIndex: 0, delta: "{\"a", id: "call-7", toolName: "get_outline" });
  });

  it("toolcall_start：同样附带 id/toolName", () => {
    const partial = assistant([{ type: "toolCall", id: "call-8", name: "search_entities", arguments: {} }]);
    const event = asEvent({
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial },
    });
    const delta = (toSseFrame(event)?.data as { assistantMessageEvent: Record<string, unknown> })
      .assistantMessageEvent;
    expect(delta).toEqual({ type: "toolcall_start", contentIndex: 0, id: "call-8", toolName: "search_entities" });
  });

  it("done / error 收尾事件只留 reason（挂的完整消息被剥离，终态由 message_end 负责）", () => {
    const message = assistant([{ type: "text", text: "长文本".repeat(500) }]);
    const done = toSseFrame(
      asEvent({
        type: "message_update",
        message,
        assistantMessageEvent: { type: "done", reason: "stop", message },
      }),
    );
    expect((done?.data as { assistantMessageEvent: unknown }).assistantMessageEvent).toEqual({
      type: "done",
      reason: "stop",
    });
    expect(JSON.stringify(done)).not.toContain("长文本");

    const failed = toSseFrame(
      asEvent({
        type: "message_update",
        message,
        assistantMessageEvent: { type: "error", reason: "error", error: message },
      }),
    );
    expect((failed?.data as { assistantMessageEvent: unknown }).assistantMessageEvent).toEqual({
      type: "error",
      reason: "error",
    });
    expect(collectKeys(failed).has("partial")).toBe(false);
  });

  it("thinking_delta：只带增量（全文在 partial 里，被剥离）", () => {
    const partial = assistant([{ type: "thinking", thinking: "全部推理" }]);
    const event = asEvent({
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "推", partial },
    });
    const delta = (toSseFrame(event)?.data as { assistantMessageEvent: Record<string, unknown> })
      .assistantMessageEvent;
    expect(delta).toEqual({ type: "thinking_delta", contentIndex: 0, delta: "推" });
  });

  it("块级收尾事件（text_end / thinking_end / toolcall_end）：partial 剥离；thinking_end 降为预览", () => {
    const withText = assistant([{ type: "text", text: "整段正文" }]);
    const textEnd = toSseFrame(
      asEvent({
        type: "message_update",
        message: withText,
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "整段正文", partial: withText },
      }),
    );
    expect((textEnd?.data as { assistantMessageEvent: unknown }).assistantMessageEvent).toEqual({
      type: "text_end",
      contentIndex: 0,
      content: "整段正文",
    });

    const withTool = assistant([{ type: "toolCall", id: "call-9", name: "get_outline", arguments: { a: 1 } }]);
    const toolEnd = toSseFrame(
      asEvent({
        type: "message_update",
        message: withTool,
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: { type: "toolCall", id: "call-9", name: "get_outline", arguments: { a: 1 } },
          partial: withTool,
        },
      }),
    );
    expect((toolEnd?.data as { assistantMessageEvent: Record<string, unknown> }).assistantMessageEvent).toEqual({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { type: "toolCall", id: "call-9", name: "get_outline", arguments: { a: 1 } },
    });
    expect(collectKeys(toolEnd).has("partial")).toBe(false);

    // thinking_end：整段思维链不得原样转发（客户端已从 thinking_delta 拿到全文）——降为预览 + 原长
    const longThinking = "思".repeat(5000);
    const withThinking = assistant([{ type: "thinking", thinking: longThinking }]);
    const thinkingEnd = toSseFrame(
      asEvent({
        type: "message_update",
        message: withThinking,
        assistantMessageEvent: {
          type: "thinking_end",
          contentIndex: 0,
          content: longThinking,
          partial: withThinking,
        },
      }),
    );
    const thinkingEvent = (thinkingEnd?.data as { assistantMessageEvent: Record<string, unknown> })
      .assistantMessageEvent;
    expect(thinkingEvent.content).toBe("思".repeat(240));
    expect(thinkingEvent.contentLength).toBe(5000);
    expect(JSON.stringify(thinkingEnd).length).toBeLessThan(1000);
    expect(collectKeys(thinkingEnd).has("partial")).toBe(false);
  });

  it("非 assistant 角色的 message_update 丢弃（前端无法归属的 delta 不转发）", () => {
    const message = user("文本");
    const event = asEvent({
      type: "message_update",
      message,
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x", partial: message },
    });
    expect(toSseFrame(event)).toBeNull();
  });
});

// ============ 工具执行 ============

describe("工具执行帧", () => {
  it("tool_execution_start / update：直通 id/name/args/partialResult", () => {
    expect(
      toSseFrame(asEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "get_outline", args: { a: 1 } })),
    ).toEqual({ event: "tool_execution_start", data: { toolCallId: "c1", toolName: "get_outline", args: { a: 1 } } });
    expect(
      toSseFrame(
        asEvent({
          type: "tool_execution_update",
          toolCallId: "c1",
          toolName: "get_outline",
          args: {},
          partialResult: { done: 1 },
        }),
      ),
    ).toEqual({
      event: "tool_execution_update",
      data: { toolCallId: "c1", toolName: "get_outline", partialResult: { done: 1 } },
    });
  });

  it("AUTO 工具的 details 不下发（只留 content）", () => {
    const frame = toSseFrame(
      asEvent({
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "get_outline",
        result: { content: [{ type: "text", text: "{}" }], details: { 巨大: "x".repeat(1000) } },
        isError: false,
      }),
    );
    expect(frame?.event).toBe("tool_execution_end");
    const data = frame?.data as { result: Record<string, unknown>; isError: boolean };
    expect(data.isError).toBe(false);
    expect(data.result).toEqual({ content: [{ type: "text", text: "{}" }] });
    expect(Object.keys(data.result)).toEqual(["content"]);
  });

  it("PROPOSAL 工具的 details（提案载荷）下发", () => {
    const payload = { proposal_id: "prop_1", type: "propose_outline_node", preview: { summary: "新建章" } };
    const frame = toSseFrame(
      asEvent({
        type: "tool_execution_end",
        toolCallId: "c2",
        toolName: "propose_outline_node",
        result: { content: [{ type: "text", text: "提案已发出" }], details: payload },
        isError: false,
      }),
    );
    const data = frame?.data as { result: { details: unknown } };
    expect(data.result.details).toEqual(payload);
  });

  it("PROPOSAL 工具但 details 缺失 → 只留 content（不造空 details 键）", () => {
    const frame = toSseFrame(
      asEvent({
        type: "tool_execution_end",
        toolCallId: "c3",
        toolName: "propose_outline_node",
        result: { content: [] },
        isError: true,
      }),
    );
    expect((frame?.data as { result: Record<string, unknown> }).result).toEqual({ content: [] });
    expect((frame?.data as { isError: boolean }).isError).toBe(true);
  });
});

// ============ 压缩 / 重试 ============

describe("压缩与重试帧", () => {
  it("compaction_start / compaction_end", () => {
    expect(toSseFrame(asEvent({ type: "compaction_start", reason: "threshold" }))).toEqual({
      event: "compaction_start",
      data: { reason: "threshold" },
    });
    expect(
      toSseFrame(
        asEvent({
          type: "compaction_end",
          reason: "overflow",
          result: { summary: "摘要", firstKeptEntryId: "e1", tokensBefore: 1000 },
          aborted: false,
          willRetry: true,
          errorMessage: "boom",
        }),
      ),
    ).toEqual({
      event: "compaction_end",
      data: {
        reason: "overflow",
        result: { summary: "摘要", firstKeptEntryId: "e1", tokensBefore: 1000 },
        aborted: false,
        willRetry: true,
        errorMessage: "boom",
      },
    });
  });

  it("compaction_end 无 result/errorMessage 时不带这两个键", () => {
    const frame = toSseFrame(
      asEvent({ type: "compaction_end", reason: "manual", result: undefined, aborted: true, willRetry: false }),
    );
    expect(frame?.data).toEqual({ reason: "manual", aborted: true, willRetry: false });
  });

  it("auto_retry_start / auto_retry_end", () => {
    expect(
      toSseFrame(
        asEvent({ type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: "429" }),
      ),
    ).toEqual({
      event: "auto_retry_start",
      data: { attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: "429" },
    });
    expect(toSseFrame(asEvent({ type: "auto_retry_end", success: true, attempt: 2 }))).toEqual({
      event: "auto_retry_end",
      data: { success: true, attempt: 2 },
    });
    expect(
      toSseFrame(asEvent({ type: "auto_retry_end", success: false, attempt: 3, finalError: "耗尽" }))?.data,
    ).toEqual({ success: false, attempt: 3, finalError: "耗尽" });
  });
});

// ============ turn_end / agent_end ============

describe("轮次结束与运行结束", () => {
  const usage: ContextUsage = { percent: 42, tokens: 42_000, contextWindow: 100_000 };
  const chatUsage: ChatUsage = {
    input: 1200,
    output: 340,
    cacheRead: 800,
    cacheWrite: 0,
    total: 2340,
    cost: 0.0123,
    cacheHitRate: 0.4,
    subscription: false,
  };

  it("turn_end：toolResults 投影 + contextUsage（取自 getContextUsage）", () => {
    const options: SseProjectionOptions = { getContextUsage: () => usage };
    const frame = toSseFrame(
      asEvent({ type: "turn_end", message: assistant([{ type: "text", text: "x" }]), toolResults: [toolResult("结果")] }),
      options,
    );
    expect(frame?.data.toolResults).toEqual([
      { role: "tool", content: "结果", toolCallId: "call-1", isError: false, createdAt: new Date(1_700_000_000_000).toISOString() },
    ]);
    expect(frame?.data.contextUsage).toEqual(usage);
  });

  it("无 getContextUsage 时不带 contextUsage 键", () => {
    const frame = toSseFrame(asEvent({ type: "turn_end", message: assistant([]), toolResults: [] }));
    expect(frame?.data).toEqual({ toolResults: [] });
    expect(Object.keys(frame?.data ?? {})).toEqual(["toolResults"]);
  });

  it("contextUsage 的 tokens/percent 为 null（压缩后占用未知）→ 帧照发，字段保持 null", () => {
    const unknown: ContextUsage = { percent: null, tokens: null, contextWindow: 100_000 };
    const options: SseProjectionOptions = { getContextUsage: () => unknown };
    const turnEnd = toSseFrame(asEvent({ type: "turn_end", message: assistant([]), toolResults: [] }), options);
    expect(turnEnd?.data.contextUsage).toEqual({ percent: null, tokens: null, contextWindow: 100_000 });
    const agentEnd = toSseFrame(asEvent({ type: "agent_end", messages: [assistant([])] }), options);
    expect(agentEnd?.data.contextUsage).toEqual({ percent: null, tokens: null, contextWindow: 100_000 });
  });

  it("turn_end / agent_end：带 usage（getSessionUsage 的取值原样下发）", () => {
    const options: SseProjectionOptions = { getContextUsage: () => usage, getSessionUsage: () => chatUsage };
    expect(toSseFrame(asEvent({ type: "turn_end", message: assistant([]), toolResults: [] }), options)?.data.usage).toEqual(
      chatUsage,
    );
    expect(toSseFrame(asEvent({ type: "agent_end", messages: [assistant([])] }), options)?.data.usage).toEqual(chatUsage);
  });

  it("无 getSessionUsage 或返回 undefined → 不带 usage 键", () => {
    const without = toSseFrame(asEvent({ type: "turn_end", message: assistant([]), toolResults: [] }));
    expect(Object.keys(without?.data ?? {})).toEqual(["toolResults"]);
    const undefinedUsage = toSseFrame(asEvent({ type: "agent_end", messages: [assistant([])] }), {
      getSessionUsage: () => undefined,
    });
    expect(Object.keys(undefinedUsage?.data ?? {})).toEqual([]);
  });

  it("agent_end：不下发 messages；失败时提取 stopReason/errorMessage", () => {
    const failed = assistant([{ type: "text", text: "" }], { stopReason: "error", errorMessage: "429 配额耗尽" });
    const frame = toSseFrame(asEvent({ type: "agent_end", messages: [user("问题"), failed] }), {
      getContextUsage: () => usage,
    });
    expect(frame).toEqual({
      event: "agent_end",
      data: { stopReason: "error", errorMessage: "429 配额耗尽", contextUsage: usage },
    });
    expect(collectKeys(frame).has("messages")).toBe(false);
  });

  it("agent_end：aborted 也带 stopReason；正常结束不带失败字段", () => {
    const aborted = assistant([], { stopReason: "aborted" });
    expect(toSseFrame(asEvent({ type: "agent_end", messages: [aborted] }))?.data).toEqual({ stopReason: "aborted" });
    expect(toSseFrame(asEvent({ type: "agent_end", messages: [assistant([{ type: "text", text: "完" }])] }))?.data).toEqual(
      {},
    );
  });

  it("agent_end：末条非 assistant（如工具结果结尾）→ 不带失败字段", () => {
    const frame = toSseFrame(asEvent({ type: "agent_end", messages: [assistant([]), toolResult("结果")] }));
    expect(frame?.data).toEqual({});
  });
});

// ============ 解码速度（assistant message_end 的 speed） ============

describe("速度帧（speed）", () => {
  /** 首字增量事件（meter 据此起表） */
  const firstDelta = (): AgentSessionEvent =>
    asEvent({
      type: "message_update",
      message: assistant([{ type: "text", text: "答" }]),
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "答",
        partial: assistant([{ type: "text", text: "答" }]),
      },
    });

  /** assistant 收尾事件（带真实输出 token 数） */
  const assistantEnd = (output: number): AgentSessionEvent =>
    asEvent({ type: "message_end", message: assistant([{ type: "text", text: "答" }], { usage: { ...USAGE, output } }) });

  it("assistant 的 message_end：meter 出样本时帧带 speed（非 assistant 帧不带）", () => {
    let now = 0;
    const meter = createSpeedMeter({ now: () => now });
    const options: SseProjectionOptions = { speedMeter: meter };

    // 首字增量起表（该帧自身不带 speed）
    expect(toSseFrame(firstDelta(), options)?.data.speed).toBeUndefined();
    now += SPEED_MIN_DURATION_MS;

    const end = toSseFrame(assistantEnd(100), options);
    expect(end?.data.speed).toEqual({
      outputTokens: 100,
      ms: SPEED_MIN_DURATION_MS,
      tps: 100 / (SPEED_MIN_DURATION_MS / 1000),
    });

    // 非 assistant 的 message_end 绝无 speed 键（同一 meter 已出过样本）
    expect(toSseFrame(asEvent({ type: "message_end", message: user("问") }), options)?.data.speed).toBeUndefined();
  });

  it("无 meter / meter 无样本（从未收到增量）→ 不带 speed 键", () => {
    expect(Object.keys(toSseFrame(assistantEnd(100))?.data ?? {})).toEqual(["message"]);
    const meter = createSpeedMeter({ now: () => 0 });
    const frame = toSseFrame(assistantEnd(100), { speedMeter: meter });
    expect(Object.keys(frame?.data ?? {})).toEqual(["message"]);
  });

  it("每个事件都喂一次 meter（含投影丢弃的事件）", () => {
    const seen: string[] = [];
    const meter: SpeedMeter = {
      onEvent(event) {
        seen.push(event.type);
        return null;
      },
    };
    const options: SseProjectionOptions = { speedMeter: meter };
    toSseFrame(asEvent({ type: "entry_appended", entry: { type: "message" } }), options);
    toSseFrame(asEvent({ type: "turn_start" }), options);
    expect(seen).toEqual(["entry_appended", "turn_start"]);
  });
});

// ============ 通用不变量 ============

describe("大对象剥离（通用不变量）", () => {
  it("覆盖全部被投影事件：帧里任意层级都没有 partial", () => {
    const partial = assistant([{ type: "text", text: "全量".repeat(100) }]);
    const events: unknown[] = [
      { type: "agent_start" },
      { type: "turn_start" },
      { type: "turn_end", message: partial, toolResults: [] },
      { type: "message_start", message: partial },
      { type: "message_end", message: partial },
      {
        type: "message_update",
        message: partial,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "d", partial },
      },
      { type: "tool_execution_start", toolCallId: "c", toolName: "get_outline", args: {} },
      { type: "tool_execution_update", toolCallId: "c", toolName: "get_outline", args: {}, partialResult: {} },
      { type: "tool_execution_end", toolCallId: "c", toolName: "get_outline", result: { content: [] }, isError: false },
      { type: "compaction_start", reason: "manual" },
      { type: "compaction_end", reason: "manual", result: undefined, aborted: false, willRetry: false },
      { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "x" },
      { type: "auto_retry_end", success: true, attempt: 1 },
      { type: "agent_end", messages: [partial] },
    ];
    for (const event of events) {
      const frame = toSseFrame(asEvent(event));
      expect(frame).not.toBeNull();
      expect(collectKeys(frame).has("partial")).toBe(false);
    }
  });
});
