// speed 模块测试：解码速度口径与守卫（docs/api/80-api-chat.md「会话用量字段 · speed」/ 20-context.md §2.1）
//
// 区间 = 首个流式增量 → assistant 的 message_end；分子 = 该条消息 usage.output。
// 守卫逐条覆盖：无增量 / output <= 0 / 时长低于 SPEED_MIN_DURATION_MS / stopReason error · aborted。

import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { SPEED_MIN_DURATION_MS, createSpeedMeter, type SpeedMeter } from "./speed.js";

// ============ 构造辅助 ============

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(output: number, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "faux",
    model: "faux-1",
    usage: { ...USAGE, output, totalTokens: output },
    stopReason,
    timestamp: 1_700_000_000_000,
  };
}

/** 事件构造（pi 事件联合类型较宽，测试只喂被测量器读到的字段） */
function asEvent(value: unknown): AgentSessionEvent {
  return value as AgentSessionEvent;
}

function delta(type: "text_delta" | "thinking_delta" | "toolcall_delta" | "text_start") {
  return asEvent({
    type: "message_update",
    message: assistant(0),
    assistantMessageEvent: { type, contentIndex: 0, ...(type === "text_start" ? {} : { delta: "x" }) },
  });
}

function messageEnd(message: AssistantMessage) {
  return asEvent({ type: "message_end", message });
}

/** 假时钟 + 测量器（`advance` 推进到下一个采样时刻） */
function fakeMeter(): { meter: SpeedMeter; advance: (ms: number) => void } {
  let clock = 0;
  return {
    meter: createSpeedMeter({ now: () => clock }),
    advance: (ms) => {
      clock += ms;
    },
  };
}

// ============ 正常样本 ============

describe("createSpeedMeter 正常样本", () => {
  it("首个增量 → message_end：ms = 区间差、tps = output / (ms / 1000)", () => {
    const { meter, advance } = fakeMeter();

    expect(meter.onEvent(delta("text_delta"))).toBeNull();
    advance(2_000);
    expect(meter.onEvent(messageEnd(assistant(100)))).toEqual({ outputTokens: 100, ms: 2_000, tps: 50 });
  });

  it("thinking_delta / toolcall_delta 同样起表（思考 token 也算生成）", () => {
    const { meter, advance } = fakeMeter();

    expect(meter.onEvent(delta("thinking_delta"))).toBeNull();
    advance(1_000);
    expect(meter.onEvent(messageEnd(assistant(25)))).toEqual({ outputTokens: 25, ms: 1_000, tps: 25 });

    expect(meter.onEvent(delta("toolcall_delta"))).toBeNull();
    advance(1_000);
    expect(meter.onEvent(messageEnd(assistant(10)))).toEqual({ outputTokens: 10, ms: 1_000, tps: 10 });
  });

  it("时长恰等于守卫常量 → 仍下发（守卫是「小于才拦」）", () => {
    const { meter, advance } = fakeMeter();

    meter.onEvent(delta("text_delta"));
    advance(SPEED_MIN_DURATION_MS);

    expect(meter.onEvent(messageEnd(assistant(50)))).toEqual({
      outputTokens: 50,
      ms: SPEED_MIN_DURATION_MS,
      tps: 50 / (SPEED_MIN_DURATION_MS / 1000),
    });
  });

  it("样本用掉即清表：下一条消息没有增量就不下发，有增量则重新起表", () => {
    const { meter, advance } = fakeMeter();

    meter.onEvent(delta("text_delta"));
    advance(2_000);
    expect(meter.onEvent(messageEnd(assistant(100)))).not.toBeNull();

    advance(5_000);
    expect(meter.onEvent(messageEnd(assistant(100)))).toBeNull(); // 上一轮的起点不能复用

    meter.onEvent(delta("text_delta"));
    advance(1_000);
    expect(meter.onEvent(messageEnd(assistant(30)))).toEqual({ outputTokens: 30, ms: 1_000, tps: 30 });
  });

  it("本轮内后续增量不覆盖起点（区间从首个增量算）", () => {
    const { meter, advance } = fakeMeter();

    meter.onEvent(delta("text_delta"));
    advance(1_000);
    meter.onEvent(delta("text_delta"));
    advance(1_000);

    expect(meter.onEvent(messageEnd(assistant(20)))).toEqual({ outputTokens: 20, ms: 2_000, tps: 10 });
  });
});

// ============ 守卫 ============

describe("createSpeedMeter 守卫", () => {
  it("从未收到增量（非流式回退）→ null；非增量事件（text_start）不起表", () => {
    const { meter, advance } = fakeMeter();

    expect(meter.onEvent(delta("text_start"))).toBeNull();
    advance(5_000);

    expect(meter.onEvent(messageEnd(assistant(100)))).toBeNull();
  });

  it("output <= 0 → null", () => {
    const { meter, advance } = fakeMeter();

    meter.onEvent(delta("text_delta"));
    advance(5_000);

    expect(meter.onEvent(messageEnd(assistant(0)))).toBeNull();
  });

  it("时长低于 SPEED_MIN_DURATION_MS → null", () => {
    const { meter, advance } = fakeMeter();

    meter.onEvent(delta("text_delta"));
    advance(SPEED_MIN_DURATION_MS - 1);

    expect(meter.onEvent(messageEnd(assistant(100)))).toBeNull();
  });

  it("stopReason 为 error / aborted → null", () => {
    const { meter, advance } = fakeMeter();

    meter.onEvent(delta("text_delta"));
    advance(5_000);
    expect(meter.onEvent(messageEnd(assistant(100, "error")))).toBeNull();

    meter.onEvent(delta("text_delta"));
    advance(5_000);
    expect(meter.onEvent(messageEnd(assistant(100, "aborted")))).toBeNull();
  });

  it("非 assistant 的 message_end（user / toolResult）→ null", () => {
    const { meter, advance } = fakeMeter();

    meter.onEvent(delta("text_delta"));
    advance(5_000);
    const toolResult = asEvent({
      type: "message_end",
      message: { role: "toolResult", toolCallId: "call-1", toolName: "t", content: [], timestamp: 1 },
    });

    expect(meter.onEvent(toolResult)).toBeNull();
    // toolResult 的 message_end 不应吃掉在表样本：同一条 assistant 消息仍能出 speed
    expect(meter.onEvent(messageEnd(assistant(80)))).toEqual({ outputTokens: 80, ms: 5_000, tps: 16 });
  });

  it("其余事件（agent_start / turn_end 等）→ null", () => {
    const { meter, advance } = fakeMeter();

    meter.onEvent(delta("text_delta"));
    advance(5_000);

    expect(meter.onEvent(asEvent({ type: "turn_end", message: assistant(0), toolResults: [] }))).toBeNull();
    expect(meter.onEvent(asEvent({ type: "agent_start" }))).toBeNull();
    expect(meter.onEvent(messageEnd(assistant(60)))).toEqual({ outputTokens: 60, ms: 5_000, tps: 12 });
  });
});
