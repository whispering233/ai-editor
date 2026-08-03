// @ai-editor/llm 客户端测试（S6.1）
// mock fetch 注入（fetchImpl），不依赖真实网络；覆盖任务卡验收点：
//   流式分片跨 chunk 拼接、注释行跳过、[DONE] 正常结束（stop_reason 正确）、
//   流中途终止无 [DONE] → error、非 2xx 结构化错误、abort 中断、
//   tool_call 参数增量累积 → 完整参数对象（含解析失败 / length 截断标记）
import { describe, expect, it, vi } from "vitest";
import {
  buildChatRequestBody,
  chatStream,
  DEEPSEEK_BASE_URL,
  LLM_TRANSPORT_ERROR_CODES,
  parseSSEFrame,
  splitSSEFrames,
  SSE_DONE,
} from "./client";
import type {
  ChatStreamResult,
  FetchLike,
  FetchResponseLike,
  LLMStreamEvent,
} from "./types";

/** 固定分片序列的 mock 响应（SSE 文本流） */
function sseResponse(chunks: string[], status = 200): FetchResponseLike {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  }) as unknown as FetchResponseLike;
}

/** 可手动控制的响应流（abort 测试用） */
function controllableResponse(): {
  response: FetchResponseLike;
  push: (s: string) => void;
  close: () => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c; // start 同步执行，构造完成即可用
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(stream) as unknown as FetchResponseLike,
    push: (s: string) => controller?.enqueue(encoder.encode(s)),
    close: () => controller?.close(),
  };
}

/** 标准参数跑一次 chatStream（固定 SSE 分片），收集事件与结果 */
async function runStream(
  chunks: string[],
  opts?: { signal?: AbortSignal },
): Promise<{ result: ChatStreamResult; events: LLMStreamEvent[] }> {
  const events: LLMStreamEvent[] = [];
  const result = await chatStream({
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "hi" }],
    fetchImpl: async () => sseResponse(chunks),
    ...(opts?.signal ? { signal: opts.signal } : {}),
    onEvent: (e) => events.push(e),
  });
  return { result, events };
}

/** 用自定义 mock fetch 跑一次 chatStream */
async function runWithFetch(
  fetchMock: FetchLike,
  signal?: AbortSignal,
): Promise<{ result: ChatStreamResult; events: LLMStreamEvent[] }> {
  const events: LLMStreamEvent[] = [];
  const result = await chatStream({
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "hi" }],
    fetchImpl: fetchMock,
    ...(signal ? { signal } : {}),
    onEvent: (e) => events.push(e),
  });
  return { result, events };
}

describe("buildChatRequestBody 请求体组装", () => {
  it("tools 包装为 OpenAI wire 格式，可选字段按需出现", () => {
    const body = buildChatRequestBody({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "get_entity", description: "查询实体", parameters: { type: "object" } },
      ],
      maxTokens: 100,
      temperature: 0.7,
    });
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.tools).toEqual([
      {
        type: "function",
        function: { name: "get_entity", description: "查询实体", parameters: { type: "object" } },
      },
    ]);
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.7);
  });

  it("未提供的可选字段不出现在请求体", () => {
    const minimal = buildChatRequestBody({ model: "m", messages: [{ role: "user", content: "hi" }] });
    expect("tools" in minimal).toBe(false);
    expect("max_tokens" in minimal).toBe(false);
    expect("temperature" in minimal).toBe(false);
  });
});

describe("SSE 帧解析纯函数", () => {
  it("splitSSEFrames 跨 chunk 累积半帧，完整帧按空行切分", () => {
    const first = splitSSEFrames('data: {"a"}');
    expect(first.frames).toEqual([]);
    expect(first.rest).toBe('data: {"a"}');
    const second = splitSSEFrames('data: {"a"}\n\n: ping\n\ndata: [DONE]\n\n');
    expect(second.frames).toEqual(['data: {"a"}', ": ping", "data: [DONE]"]);
    expect(second.rest).toBe("");
  });

  it("parseSSEFrame 注释行跳过、剥离一个前导空格、多行 data 合并", () => {
    expect(parseSSEFrame(": ping")).toBeNull();
    expect(parseSSEFrame("data: hello")).toBe("hello"); // 仅剥离一个前导空格
    expect(parseSSEFrame("data: a\ndata: b")).toBe("a\nb");
    expect(parseSSEFrame("data: [DONE]")).toBe("[DONE]");
  });
});

describe("chatStream 流式解析", () => {
  it("流式分片：data 内容跨 chunk 拆分也能正确拼接出完整 delta", async () => {
    const chunk1 = '{"choices":[{"index":0,"delta":{"content":"你好，"},"finish_reason":null}]}';
    const chunk2 = '{"choices":[{"index":0,"delta":{"content":"世界"},"finish_reason":"stop"}]}';
    const { result, events } = await runStream([
      "data: " + chunk1.slice(0, 30), // 第一片：截断的 data 行（无 \n\n）
      chunk1.slice(30) + "\n\ndata: " + chunk2.slice(0, 40), // 拼接 + 第二片前半
      chunk2.slice(40) + "\n\ndata: " + SSE_DONE + "\n\n",
    ]);
    const texts = events
      .filter((e): e is Extract<LLMStreamEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.delta);
    expect(texts).toEqual(["你好，", "世界"]);
    expect(result).toEqual({ ok: true, stopReason: "stop", usage: null });
  });

  it("多字节 UTF-8 字符跨 chunk 拆分也能正确解码（TextDecoder 流式）", async () => {
    const frame =
      'data: {"choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}\n\n' +
      "data: " + SSE_DONE + "\n\n";
    const bytes = new TextEncoder().encode(frame);
    // 在「你」(E4 BD A0) 的第 3 字节处切开，验证跨多字节序列的解码
    const splitAt = bytes.indexOf(0xe4) + 2;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, splitAt));
        c.enqueue(bytes.slice(splitAt));
        c.close();
      },
    });
    const fetchMock: FetchLike = async () => new Response(stream) as unknown as FetchResponseLike;
    const events: LLMStreamEvent[] = [];
    const result = await chatStream({
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: fetchMock,
      onEvent: (e) => events.push(e),
    });
    const texts = events
      .filter((e): e is Extract<LLMStreamEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.delta);
    expect(texts.join("")).toBe("你好");
    expect(result.ok).toBe(true);
  });

  it("注释行跳过 + CRLF 分帧 + [DONE] 正常结束（finish 事件 stop_reason / usage 正确）", async () => {
    const delta = '{"choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}';
    const finish = '{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}';
    const usage = '{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}';
    const { result, events } = await runStream([
      ": ping 注释行\r\n\r\n",
      "data: " + delta + "\r\n\r\n", // CRLF 帧分隔
      "data: " + finish + "\n\n",
      "data: " + usage + "\n\n", // include_usage 末 chunk（choices 为空）
      "data: " + SSE_DONE + "\n\n",
    ]);
    expect(events.map((e) => e.type)).toEqual(["text", "finish", "done"]);
    const finishEv = events.find((e) => e.type === "finish");
    expect(finishEv?.type === "finish" ? finishEv.stopReason : null).toBe("stop");
    expect(finishEv?.type === "finish" ? finishEv.usage : null).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
    expect(result).toEqual({
      ok: true,
      stopReason: "stop",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });

  it("流中途终止无 [DONE] = 错误（不静默），事件序 text → error", async () => {
    const delta = '{"choices":[{"index":0,"delta":{"content":"半截"},"finish_reason":null}]}';
    const { result, events } = await runStream(["data: " + delta + "\n\n"]);
    expect(events.map((e) => e.type)).toEqual(["text", "error"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(false);
      expect(result.error.status).toBe(0);
      expect(result.error.code).toBe(LLM_TRANSPORT_ERROR_CODES.STREAM_TRUNCATED);
    }
  });

  it("EOF 时残余半帧（无结尾空行）同样判定截断", async () => {
    const delta = '{"choices":[{"index":0,"delta":{"content":"x"},"finish_reason":null}]}';
    const { result } = await runStream(["data: " + delta]); // 无 \n\n 即 EOF
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(LLM_TRANSPORT_ERROR_CODES.STREAM_TRUNCATED);
  });

  it("EOF 残余帧为 [DONE]（无结尾空行）→ 正常结束", async () => {
    const { result } = await runStream(["data: " + SSE_DONE]);
    expect(result).toEqual({ ok: true, stopReason: "stop", usage: null });
  });
});

describe("chatStream 错误归一化", () => {
  it("非 2xx（401）→ 结构化错误（code/message 解析自 body）", async () => {
    const fetchMock: FetchLike = async () =>
      new Response(
        JSON.stringify({ error: { message: "Incorrect API key provided", code: "invalid_api_key" } }),
        { status: 401 },
      ) as unknown as FetchResponseLike;
    const { result, events } = await runWithFetch(fetchMock);
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(false);
      expect(result.error.status).toBe(401);
      expect(result.error.code).toBe("invalid_api_key");
      expect(result.error.message).toContain("Incorrect API key");
    }
  });

  it("非 2xx（429）body 非 JSON → 缺省 message 兜底", async () => {
    const fetchMock: FetchLike = async () =>
      new Response("rate limited", { status: 429, statusText: "Too Many Requests" }) as unknown as FetchResponseLike;
    const { result } = await runWithFetch(fetchMock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(429);
      expect(result.error.code).toBeUndefined();
      expect(result.error.message).toBe("HTTP 429 Too Many Requests");
    }
  });

  it("错误 body 为顶层 {code, message}（无 error 嵌套）同样能解析", async () => {
    const fetchMock: FetchLike = async () =>
      new Response(
        JSON.stringify({ code: "insufficient_quota", message: "余额不足，请充值" }),
        { status: 402 },
      ) as unknown as FetchResponseLike;
    const { result } = await runWithFetch(fetchMock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(402);
      expect(result.error.code).toBe("insufficient_quota");
      expect(result.error.message).toBe("余额不足，请充值");
    }
  });

  it("错误 message 超长：截断到上限（≤200）", async () => {
    const longMsg = "e".repeat(300);
    const fetchMock: FetchLike = async () =>
      new Response(JSON.stringify({ error: { message: longMsg } }), { status: 400 }) as unknown as FetchResponseLike;
    const { result } = await runWithFetch(fetchMock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toHaveLength(200);
      expect(result.error.message.startsWith("eee")).toBe(true);
    }
  });

  it("非 2xx 错误 body 超长（10KB 非 JSON）：读取截断且 message 不超上限", async () => {
    const fetchMock: FetchLike = async () =>
      new Response("x".repeat(10_000), { status: 500, statusText: "Internal Server Error" }) as unknown as FetchResponseLike;
    const { result } = await runWithFetch(fetchMock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(500);
      expect(result.error.message.length).toBeLessThanOrEqual(200);
      expect(result.error.message).toBe("HTTP 500 Internal Server Error"); // 非 JSON 兜底
    }
  });

  it("fetch 抛错（网络断开）→ NETWORK_ERROR，aborted=false", async () => {
    const fetchMock: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const { result } = await runWithFetch(fetchMock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(false);
      expect(result.error.status).toBe(0);
      expect(result.error.code).toBe(LLM_TRANSPORT_ERROR_CODES.NETWORK_ERROR);
    }
  });

  it("请求打到 baseUrl/chat/completions，携带 Bearer 头与 SSE Accept", async () => {
    let capturedUrl = "";
    let capturedInit: { method?: string; headers?: Record<string, string> } | undefined;
    const fetchMock: FetchLike = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return sseResponse(["data: " + SSE_DONE + "\n\n"]);
    };
    await runWithFetch(fetchMock);
    expect(capturedUrl).toBe(DEEPSEEK_BASE_URL + "/chat/completions");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers?.Authorization).toBe("Bearer test-key");
    expect(capturedInit?.headers?.Accept).toBe("text/event-stream");
  });
});

describe("chatStream abort 语义（决策 16）", () => {
  it("abort 中断：流中途取消 → aborted 标记 + error 事件 + 立即终止", async () => {
    const ctrl = controllableResponse();
    const ac = new AbortController();
    const events: LLMStreamEvent[] = [];
    const p = chatStream({
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: async () => ctrl.response,
      signal: ac.signal,
      onEvent: (e) => events.push(e),
    });
    ctrl.push('data: {"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":null}]}\n\n');
    await vi.waitFor(() => expect(events.some((e) => e.type === "text")).toBe(true));
    ac.abort(); // 取消 → abort 监听 cancel reader → 挂起的 read 立即返回 → 终止
    const result = await p;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(true);
      expect(result.error.code).toBe(LLM_TRANSPORT_ERROR_CODES.ABORTED);
    }
    expect(events.some((e) => e.type === "error" && e.aborted)).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("调用前已 abort：不发起请求，直接返回 aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const fetchMock = vi.fn(async () => {
      throw new Error("不应被调用");
    });
    const { result } = await runWithFetch(fetchMock, ac.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.aborted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetch 挂起期间 signal 触发 abort → 返回 aborted（不误归网络错误）", async () => {
    const ac = new AbortController();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetchMock: FetchLike = async () => {
      await gate; // 模拟 fetch 挂起（尚未返回响应）
      throw new Error("连接被取消"); // 放行后抛错（真实底层会抛 AbortError）
    };
    const p = runWithFetch(fetchMock, ac.signal);
    await new Promise((r) => setTimeout(r, 10)); // 确保 fetch 已进入挂起
    ac.abort(); // 取消信号在 fetch 返回前触发
    release?.();
    const { result } = await p;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(true);
      expect(result.error.code).toBe(LLM_TRANSPORT_ERROR_CODES.ABORTED);
    }
  });

  it("fetch 抛 AbortError（信号未置位）→ 按 aborted 处理而非网络错误", async () => {
    const fetchMock: FetchLike = async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    };
    const { result } = await runWithFetch(fetchMock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(true);
      expect(result.error.code).toBe(LLM_TRANSPORT_ERROR_CODES.ABORTED);
    }
  });

  it("非 2xx 读错误 body 期间 abort → 返回 aborted（避免 S6.2 误按 429/5xx 重试）", async () => {
    const ac = new AbortController();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetchMock: FetchLike = async () => {
      const res = new Response(JSON.stringify({ error: { message: "too many" } }), {
        status: 429,
        statusText: "Too Many Requests",
      }) as unknown as FetchResponseLike;
      // 模拟 body 读取挂起：text() 未返回前 abort
      const originalText = res.text.bind(res);
      res.text = async () => {
        await gate;
        return originalText();
      };
      return res;
    };
    const p = runWithFetch(fetchMock, ac.signal);
    await new Promise((r) => setTimeout(r, 10)); // 确保已进入 text() 挂起
    ac.abort(); // 取消信号在错误 body 读取期间触发
    release?.();
    const { result } = await p;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(true);
      expect(result.error.code).toBe(LLM_TRANSPORT_ERROR_CODES.ABORTED); // 而非 429
    }
  });
});

describe("chatStream 流式 tool_call（决策 15/18）", () => {
  it("按 index 累积 arguments 增量片段 → 完整参数对象", async () => {
    const t1 =
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"create_entity","arguments":""}}]},"finish_reason":null}]}';
    const t2 =
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"name\\":\\"张"}}]},"finish_reason":null}]}';
    const t3 =
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"三\\",\\"type\\":\\"character\\"}"}}]},"finish_reason":null}]}';
    const fin = '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}';
    const { result, events } = await runStream([
      "data: " + t1 + "\n\n",
      "data: " + t2 + "\n\n",
      "data: " + t3 + "\n\n",
      "data: " + fin + "\n\n",
      "data: " + SSE_DONE + "\n\n",
    ]);
    const calls = events
      .filter((e): e is Extract<LLMStreamEvent, { type: "tool_call" }> => e.type === "tool_call");
    expect(calls).toHaveLength(1);
    expect(calls[0].toolCall.id).toBe("call_1");
    expect(calls[0].toolCall.name).toBe("create_entity");
    expect(calls[0].toolCall.arguments).toEqual({ name: "张三", type: "character" });
    expect(calls[0].toolCall.error).toBeUndefined();
    expect(result.ok && result.stopReason).toBe("tool_calls");
  });

  it("多个 tool_call 交错到达：按 index 分别累积、按 index 顺序输出", async () => {
    const a1 =
      '{"choices":[{"index":0,"delta":{"tool_calls":[' +
      '{"index":0,"id":"call_0","type":"function","function":{"name":"get_entity","arguments":"{\\"id\\":"}},' +
      '{"index":1,"id":"call_1","type":"function","function":{"name":"search_entities","arguments":"{\\"q\\":"}}' +
      ']},"finish_reason":null}]}';
    const a2 =
      '{"choices":[{"index":0,"delta":{"tool_calls":[' +
      '{"index":1,"function":{"arguments":"\\"张三\\"}"}},' +
      '{"index":0,"function":{"arguments":"\\"char-1\\"}"}}' +
      ']},"finish_reason":null}]}';
    const fin = '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}';
    const { result, events } = await runStream([
      "data: " + a1 + "\n\n",
      "data: " + a2 + "\n\n",
      "data: " + fin + "\n\n",
      "data: " + SSE_DONE + "\n\n",
    ]);
    const calls = events
      .filter((e): e is Extract<LLMStreamEvent, { type: "tool_call" }> => e.type === "tool_call")
      .map((e) => e.toolCall);
    expect(calls.map((c) => c.name)).toEqual(["get_entity", "search_entities"]); // index 序
    expect(calls[0].arguments).toEqual({ id: "char-1" });
    expect(calls[1].arguments).toEqual({ q: "张三" });
    expect(result.ok && result.stopReason).toBe("tool_calls");
  });

  it("参数 JSON 解析失败 → 该条标记 error，不产出 arguments", async () => {
    const t1 =
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"create_entity","arguments":"{\\"broken\\":"}}]},"finish_reason":null}]}';
    const fin = '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}';
    const { result, events } = await runStream([
      "data: " + t1 + "\n\n",
      "data: " + fin + "\n\n",
      "data: " + SSE_DONE + "\n\n",
    ]);
    const calls = events
      .filter((e): e is Extract<LLMStreamEvent, { type: "tool_call" }> => e.type === "tool_call");
    expect(calls).toHaveLength(1);
    expect(calls[0].toolCall.error).toBeDefined();
    expect(calls[0].toolCall.arguments).toBeUndefined();
    expect(calls[0].toolCall.rawArguments).toBe('{"broken":');
    expect(result.ok).toBe(true); // 流本身正常结束，错误标记在 tool_call 上
  });

  it("finish_reason=length（截断）：参数即使可解析也一律标记错误（决策 15）", async () => {
    const t1 =
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"create_entity","arguments":"{\\"name\\":\\"张三\\"}"}}]},"finish_reason":null}]}';
    const fin = '{"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}';
    const { result, events } = await runStream([
      "data: " + t1 + "\n\n",
      "data: " + fin + "\n\n",
      "data: " + SSE_DONE + "\n\n",
    ]);
    const calls = events
      .filter((e): e is Extract<LLMStreamEvent, { type: "tool_call" }> => e.type === "tool_call");
    expect(calls).toHaveLength(1);
    expect(calls[0].toolCall.error).toContain("length");
    expect(calls[0].toolCall.arguments).toBeUndefined(); // 不产出参数对象（不执行）
    expect(result.ok && result.stopReason).toBe("length");
  });

  it("tool_call 缺 id（防御性）：收尾标记 error，不产出可执行参数（决策 18 配对依赖 id）", async () => {
    const t1 =
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"type":"function","function":{"name":"get_entity","arguments":"{\\"id\\":\\"char-1\\"}"}}]},"finish_reason":null}]}';
    const fin = '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}';
    const { result, events } = await runStream([
      "data: " + t1 + "\n\n",
      "data: " + fin + "\n\n",
      "data: " + SSE_DONE + "\n\n",
    ]);
    const calls = events
      .filter((e): e is Extract<LLMStreamEvent, { type: "tool_call" }> => e.type === "tool_call");
    expect(calls).toHaveLength(1);
    expect(calls[0].toolCall.id).toBe(""); // 原样暴露空 id
    expect(calls[0].toolCall.error).toContain("id");
    expect(calls[0].toolCall.arguments).toBeUndefined();
    expect(result.ok).toBe(true); // 流本身正常结束，错误标记在 tool_call 上
  });

  it("text 与 tool_call 交错同一流：两类事件都正确产出", async () => {
    const t1 = '{"choices":[{"index":0,"delta":{"content":"我查一下"},"finish_reason":null}]}';
    const t2 =
      '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_entity","arguments":"{\\"id\\":\\"char-1\\"}"}}]},"finish_reason":null}]}';
    const t3 = '{"choices":[{"index":0,"delta":{"content":"查到了"},"finish_reason":null}]}';
    const fin = '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}';
    const { result, events } = await runStream([
      "data: " + t1 + "\n\n",
      "data: " + t2 + "\n\n",
      "data: " + t3 + "\n\n",
      "data: " + fin + "\n\n",
      "data: " + SSE_DONE + "\n\n",
    ]);
    const texts = events
      .filter((e): e is Extract<LLMStreamEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.delta);
    const calls = events
      .filter((e): e is Extract<LLMStreamEvent, { type: "tool_call" }> => e.type === "tool_call");
    expect(texts).toEqual(["我查一下", "查到了"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolCall.arguments).toEqual({ id: "char-1" });
    expect(result.ok && result.stopReason).toBe("tool_calls");
  });
});

describe("chatStream 消费者异常隔离（onEvent 抛错）", () => {
  it("读循环内消费者抛错：转 CONSUMER_ERROR error 事件并终止，不误归网络错误", async () => {
    const delta = '{"choices":[{"index":0,"delta":{"content":"x"},"finish_reason":null}]}';
    const events: LLMStreamEvent[] = [];
    const result = await chatStream({
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: async () => sseResponse(["data: " + delta + "\n\n", "data: " + SSE_DONE + "\n\n"]),
      onEvent: (e) => {
        events.push(e);
        if (e.type === "text") throw new Error("消费者 bug");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(false);
      expect(result.error.code).toBe(LLM_TRANSPORT_ERROR_CODES.CONSUMER_ERROR);
      expect(result.error.message).toContain("消费者 bug");
    }
    expect(events.some((e) => e.type === "error")).toBe(true); // 转 error 事件，不吞掉
    expect(events.some((e) => e.type === "done")).toBe(false); // 流被终止
  });

  it("EOF flush 块消费者抛错：同样转 error 事件，不 reject Promise", async () => {
    const delta = '{"choices":[{"index":0,"delta":{"content":"尾帧"},"finish_reason":null}]}';
    const result = await chatStream({
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: async () => sseResponse(["data: " + delta]), // 无 \n\n：EOF 走 flush 块
      onEvent: () => {
        throw new Error("消费者 bug");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(LLM_TRANSPORT_ERROR_CODES.CONSUMER_ERROR);
    }
  });
});
