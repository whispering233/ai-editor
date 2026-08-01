// use-sse 单测（T7.2）：帧解析纯函数 + fetchSSE 流式分发（mock fetch/ReadableStream，node 环境原生可用）
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSSE, parseSSEFrame, parseSSEFrames } from "./use-sse";

const encoder = new TextEncoder();

/** 构造按 chunks 分片到达的 SSE 响应体流 */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** 永不结束的流（start 中不 enqueue 不 close，read() 永远挂起）——超时/手动 abort 测试用 */
function neverEndingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start() {} });
}

function mockSseResponse(stream: ReadableStream<Uint8Array>, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status })));
}

/** 等待微任务链（fetch 解析 → read → 解码 → 分发）完成 */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("parseSSEFrames（按空行切帧）", () => {
  it("切出完整帧并保留残余文本", () => {
    expect(parseSSEFrames("event: a\ndata: 1\n\nevent: b\ndata: 2\n\npartial")).toEqual({
      frames: ["event: a\ndata: 1", "event: b\ndata: 2"],
      rest: "partial",
    });
  });

  it("无完整帧时全部作为残余", () => {
    expect(parseSSEFrames("event: a\ndata: 1")).toEqual({ frames: [], rest: "event: a\ndata: 1" });
  });
});

describe("parseSSEFrame（单帧解析）", () => {
  it("解析 event + data", () => {
    expect(parseSSEFrame("event: text\ndata: {\"delta\":\"你好\"}")).toEqual({
      event: "text",
      data: "{\"delta\":\"你好\"}",
    });
  });

  it("多行 data: 以 \\n 拼接", () => {
    expect(parseSSEFrame("data: line1\ndata: line2")).toEqual({
      event: "message",
      data: "line1\nline2",
    });
  });

  it("无 event 行时事件名默认为 message", () => {
    expect(parseSSEFrame("data: {}")).toEqual({ event: "message", data: "{}" });
  });

  it("注释行（: 开头）跳过", () => {
    expect(parseSSEFrame(": keep-alive\nevent: ping\ndata: {}")).toEqual({
      event: "ping",
      data: "{}",
    });
  });

  it("无 data 的帧返回 null", () => {
    expect(parseSSEFrame("event: ping")).toBeNull();
    expect(parseSSEFrame(": 纯注释")).toBeNull();
  });
});

describe("fetchSSE（流式分发）", () => {
  it("跨 chunk 分片的 data: 行正确拼接", async () => {
    mockSseResponse(streamOf(["event: text\ndata: {\"delta\":\"你好", "世界\"}\n\n"]));
    const events: Array<[string, unknown]> = [];
    fetchSSE("/api/v1/chat", { onEvent: (e, d) => events.push([e, d]) });
    await flush();
    expect(events).toEqual([["text", { delta: "你好世界" }]]);
  });

  it("多行 data: 合并为 \\n 拼接（非 JSON 按原文字符串透传）", async () => {
    mockSseResponse(streamOf(["data: line1\ndata: line2\n\n"]));
    const events: Array<[string, unknown]> = [];
    fetchSSE("/api/v1/chat", { onEvent: (e, d) => events.push([e, d]) });
    await flush();
    expect(events).toEqual([["message", "line1\nline2"]]);
  });

  it("注释行跳过、只分发真实事件", async () => {
    mockSseResponse(streamOf([": keep-alive comment\nevent: ping\ndata: {}\n\n"]));
    const events: Array<[string, unknown]> = [];
    fetchSSE("/api/v1/chat", { onEvent: (e, d) => events.push([e, d]) });
    await flush();
    expect(events).toEqual([["ping", {}]]);
  });

  it("[DONE] 哨兵终止解析，后续帧不再分发", async () => {
    mockSseResponse(
      streamOf([
        "event: text\ndata: {\"delta\":\"a\"}\n\n",
        "data: [DONE]\n\n",
        "event: text\ndata: {\"delta\":\"b\"}\n\n",
      ]),
    );
    const events: Array<[string, unknown]> = [];
    let ended = false;
    fetchSSE("/api/v1/chat", { onEvent: (e, d) => events.push([e, d]), onEnd: () => (ended = true) });
    await flush();
    expect(events).toEqual([["text", { delta: "a" }]]);
    expect(ended).toBe(true);
  });

  it("error 事件透传并终止解析", async () => {
    mockSseResponse(
      streamOf([
        "event: error\ndata: {\"code\":\"AGENT_TIMEOUT\",\"message\":\"单轮超时\"}\n\n",
        "event: text\ndata: {\"delta\":\"x\"}\n\n",
      ]),
    );
    const events: Array<[string, unknown]> = [];
    fetchSSE("/api/v1/chat", { onEvent: (e, d) => events.push([e, d]) });
    await flush();
    expect(events).toEqual([["error", { code: "AGENT_TIMEOUT", message: "单轮超时" }]]);
  });

  it("EOF 无结尾空行时 flush 残余帧", async () => {
    mockSseResponse(streamOf(["event: done\ndata: {\"session_id\":\"sess_1\"}"])); // 无 \n\n 结尾
    const events: Array<[string, unknown]> = [];
    fetchSSE("/api/v1/chat", { onEvent: (e, d) => events.push([e, d]) });
    await flush();
    expect(events).toEqual([["done", { session_id: "sess_1" }]]);
  });

  it("非 2xx 响应透传 REST 错误包裹为 error 事件", async () => {
    const body = JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: "参数错误" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 400, headers: { "Content-Type": "application/json" } })),
    );
    const events: Array<[string, unknown]> = [];
    fetchSSE("/api/v1/chat", { onEvent: (e, d) => events.push([e, d]) });
    await flush();
    expect(events).toEqual([["error", { code: "VALIDATION_ERROR", message: "参数错误" }]]);
  });

  it("60s 无任何事件触发 onTimeout 并中止（决策 20 半开连接兜底）", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(neverEndingStream())));
    const onTimeout = vi.fn();
    const onEnd = vi.fn();
    fetchSSE("/api/v1/chat", {
      onEvent: () => {},
      timeoutMs: 60_000,
      onTimeout,
      onEnd,
    });
    await Promise.resolve(); // 让 fetch mock 的 promise 落定、read() 挂起
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled(); // 超时不视为正常结束
  });

  it("有事件到达时重置超时（心跳 keep-alive 不被误判断开）", async () => {
    vi.useFakeTimers();
    // 模拟：25s 一个 ping（心跳周期 15-30s，决策 20），持续 90s——不应触发超时
    const chunks: string[] = [];
    for (let i = 0; i < 3; i++) chunks.push("event: ping\ndata: {}\n\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder2 = new TextEncoder();
        return new Response(
          new ReadableStream({
            async start(controller) {
              for (const c of chunks) {
                await new Promise((r) => setTimeout(r, 25_000));
                controller.enqueue(encoder2.encode(c));
              }
              controller.close();
            },
          }),
        );
      }),
    );
    const onTimeout = vi.fn();
    const events: Array<[string, unknown]> = [];
    fetchSSE("/api/v1/chat", {
      onEvent: (e, d) => events.push([e, d]),
      timeoutMs: 60_000,
      onTimeout,
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(events.filter(([e]) => e === "ping")).toHaveLength(3);
  });

  it("返回的 abort 函数取消流，不触发 onTimeout / onEnd", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(neverEndingStream())));
    const onTimeout = vi.fn();
    const onEnd = vi.fn();
    const abort = fetchSSE("/api/v1/chat", {
      onEvent: () => {},
      timeoutMs: 60_000,
      onTimeout,
      onEnd,
    });
    await Promise.resolve();
    await Promise.resolve();
    abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
