// @whispering233/ai-editor-llm adapter 测试（重写：不联网纯函数+注入集成测试）
// 覆盖：buildPiContext 消息转换 / toPiTools 工具透传 / convertUsage 口径 / 错误归一化
// streamChat 事件转发（注入 fake models 模拟流事件）/ 模型目录查询
import { describe, expect, it } from "vitest";
import {
  buildPiContext,
  convertUsage,
  toPiTools,
  extractStatusFromMessage,
  extractCodeFromMessage,
  toLLMError,
  getAvailableModels,
  streamChat,
  _setModels,
  _setModelLookup,
  REGISTERED_PROVIDERS,
  PROVIDER_FALLBACK_MODEL,
} from "./adapter.js";
import type { LLMMessage, LLMToolDefinition } from "./types.js";


describe("adapter.消息转换 buildPiContext", () => {
  const tools: LLMToolDefinition[] = [
    { name: "get_entity", description: "查询实体", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  ];

  it("system 提取为 systemPrompt，其余按角色映射为 pi-ai messages", () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "你是创作顾问" },
      { role: "user", content: "你好" },
    ];
    const ctx = buildPiContext(messages, tools);
    expect(ctx.systemPrompt).toBe("你是创作顾问");
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0]).toMatchObject({ role: "user", content: "你好" });
    expect(ctx.tools).toHaveLength(1);
    expect(ctx.tools![0]).toMatchObject({ name: "get_entity", description: "查询实体" });
  });

  it("assistant 的 tool_calls 转为 ToolCall 块且参数 JSON 解析为对象", () => {
    const messages: LLMMessage[] = [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_entity", arguments: JSON.stringify({ id: "char-1" }) } }] },
      { role: "tool", content: "{\"name\":\"阿强\"}", tool_call_id: "call_1" },
    ];
    const ctx = buildPiContext(messages, tools);
    const assistant = ctx.messages[0];
    expect(assistant.role).toBe("assistant");
    const toolCallBlock = (assistant as { content: Array<{ type: string; id?: string; name?: string; arguments?: unknown }> }).content.find((b) => b.type === "toolCall");
    expect(toolCallBlock).toMatchObject({ id: "call_1", name: "get_entity", arguments: { id: "char-1" } });
    const toolResult = ctx.messages[1];
    expect(toolResult).toMatchObject({ role: "toolResult", toolCallId: "call_1", toolName: "get_entity" });
  });

  it("tool 消息的 toolName 从之前的 assistant tool_calls 匹配（成对重组语义）", () => {
    const messages: LLMMessage[] = [
      { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "search_entities", arguments: "{}" } }] },
      { role: "assistant" as never, content: "中间文本" } as never as LLMMessage,
      { role: "tool", content: "ok", tool_call_id: "a" },
    ];
    const ctx = buildPiContext(messages, tools);
    const toolResult = ctx.messages[2];
    expect(toolResult.role).toBe("toolResult");
    expect((toolResult as { toolName: string }).toolName).toBe("search_entities");
  });

  it("参数 JSON 解析失败时退化为空对象（防御不阻断对话）", () => {
    const messages: LLMMessage[] = [
      { role: "assistant", content: null, tool_calls: [{ id: "b", type: "function", function: { name: "x", arguments: "{bad json" } }] },
    ];
    const ctx = buildPiContext(messages, tools);
    const block = (ctx.messages[0] as { content: Array<{ type: string; arguments?: unknown }> }).content.find((b) => b.type === "toolCall");
    expect(block?.arguments).toEqual({});
  });
});

describe("adapter.工具透传 toPiTools", () => {
  it("parameters JSON Schema 对象原样透传（pi-ai 发送层 as any 序列化）", () => {
    const defs: LLMToolDefinition[] = [
      { name: "t", description: "d", parameters: { type: "object", properties: { x: { type: "string" } } } },
    ];
    const tools = toPiTools(defs);
    expect(tools[0]).toEqual({ name: "t", description: "d", parameters: { type: "object", properties: { x: { type: "string" } } } });
  });
});

describe("adapter.usage 转换 convertUsage", () => {
  it("input 不含缓存 → prompt_tokens = input + cacheRead + cacheWrite = totalTokens - output", () => {
    const converted = convertUsage({ input: 100, output: 20, cacheRead: 30, cacheWrite: 5, totalTokens: 155, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
    expect(converted).toEqual({ prompt_tokens: 135, completion_tokens: 20, total_tokens: 155 });
  });

  it("undefined 返回 null（无 usage 时 finish 事件 nullable 兼容）", () => {
    expect(convertUsage(undefined)).toBeNull();
  });
});

describe("adapter.错误归一化 toLLMError / extractStatus / extractCode", () => {
  it("从 errorMessage 提取 HTTP status（429 前缀）", () => {
    expect(extractStatusFromMessage("429: {" + '"error":{}}')).toBe(429);
    expect(extractStatusFromMessage("(500) Internal Server Error")).toBe(500);
    expect(extractStatusFromMessage("string without status")).toBeUndefined();
  });

  it("从 errorMessage 提取配额类错误码（分类依赖）", () => {
    expect(extractCodeFromMessage("insufficient_quota")).toBe("insufficient_quota");
    expect(extractCodeFromMessage("rate limit exceeded")).toBe("rate_limit");
    expect(extractCodeFromMessage("ok")).toBeUndefined();
  });

  it("显式 abort 归一化（message 含 abort 或 AbortError）", () => {
    const err = new DOMException("Aborted", "AbortError");
    const r = toLLMError(err);
    expect(r.aborted).toBe(true);
    expect(r.error.code).toBe("ABORTED");
    expect(r.error.message).toBe("Request was aborted");
  });

  it("普通错误保留 status 并从消息提取 code", () => {
    const r = toLLMError({ errorMessage: "429: rate limit exceeded" }, 429);
    expect(r.aborted).toBe(false);
    expect(r.error.status).toBe(429);
    expect(r.error.code).toBe("rate_limit");
  });

  it("statusHint 优先于消息解析", () => {
    const r = toLLMError({ message: "bad gateway" }, 503);
    expect(r.error.status).toBe(503);
  });
});

describe("adapter.模型目录查询", () => {
  it("getAvailableModels 返回模型目录（默认 deepseek provider）", () => {
    const models = getAvailableModels();
    expect(Array.isArray(models)).toBe(true);
    const flash = models.find((m) => m.id === "deepseek-v4-flash");
    expect(flash).toBeDefined();
    expect(flash).toMatchObject({ provider: "deepseek" });
  });

  it("opencode-go provider 已注册（真实目录含 qwen3.7-max 与撞名 deepseek-v4-flash）", () => {
    const models = getAvailableModels("opencode-go");
    const qwen = models.find((m) => m.id === "qwen3.7-max");
    expect(qwen).toBeDefined();
    expect(qwen).toMatchObject({ provider: "opencode-go", reasoning: true });
    // 撞名模型两目录都有——provider 维度消歧的基础
    const flash = models.find((m) => m.id === "deepseek-v4-flash");
    expect(flash).toMatchObject({ provider: "opencode-go" });
    expect(REGISTERED_PROVIDERS.map((p) => p.id)).toEqual(["deepseek", "opencode-go"]);
    expect(PROVIDER_FALLBACK_MODEL["opencode-go"]).toBe("deepseek-v4-flash");
  });
});

describe("adapter.streamChat 事件转发（注入 fake models 模拟流事件）", () => {
  it("正常流：text 增量转发 + 收尾发出 tool_call/finish/done（带 usage 转换）", async () => {
    const events: unknown[] = [];
    const fakeModels = {
      getModel: (p: string, m: string) => ({ id: m, name: m, provider: p, contextWindow: 64000, maxTokens: 8192, reasoning: false }),
      stream: () => fakeStream([
        { type: "text_delta", delta: "你", contentIndex: 0, partial: {} },
        { type: "text_delta", delta: "好", contentIndex: 0, partial: {} },
        { type: "toolcall_end", contentIndex: 1, toolCall: { type: "toolCall", id: "c1", name: "get_entity", arguments: { id: "x" } }, partial: {} },
        { type: "done", reason: "toolUse", message: { usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
      ]),
    } as never;
    _setModels(() => fakeModels as never);
    _setModelLookup(() => ({ id: "deepseek-v4-flash", name: "flash", provider: "deepseek", contextWindow: 64000, maxTokens: 8192, reasoning: false } as never));

    const result = await streamChat({
      apiKey: "test-key", model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }], tools: [],
      onEvent: (e) => events.push(e),
    });

    expect(result).toEqual({ ok: true, stopReason: "tool_calls", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toEqual(["text", "text", "tool_call", "finish", "done"]);
    const toolEvent = events.find((e) => (e as { type: string }).type === "tool_call") as { toolCall: { id: string; name: string; arguments: unknown; rawArguments: string } };
    expect(toolEvent.toolCall).toMatchObject({ id: "c1", name: "get_entity", arguments: { id: "x" } });
  });

  it("length 截断：缓存工具调用标记错误后发出，不执行", async () => {
    const events: unknown[] = [];
    const fakeModels = {
      getModel: () => ({ id: "m", name: "m", provider: "deepseek", contextWindow: 64000, maxTokens: 8192, reasoning: false }),
      stream: () => fakeStream([
        { type: "toolcall_end", contentIndex: 0, toolCall: { type: "toolCall", id: "c1", name: "get_entity", arguments: { id: "x" } }, partial: {} },
        { type: "done", reason: "length", message: { usage: undefined } },
      ]),
    } as never;
    _setModels(() => fakeModels as never);
    _setModelLookup(() => ({ id: "m", name: "m", provider: "deepseek", contextWindow: 64000, maxTokens: 8192, reasoning: false } as never));

    const result = await streamChat({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }], tools: [], onEvent: (e) => events.push(e) });

    expect(result.ok).toBe(true);
    const toolEvent = events.find((e) => (e as { type: string }).type === "tool_call") as { toolCall: { error?: string } };
    expect(toolEvent.toolCall.error).toContain("length");
  });

  it("abort 路径：error 事件 + 结果 aborted", async () => {
    const events: unknown[] = [];
    const fakeModels = {
      getModel: () => ({ id: "m", name: "m", provider: "deepseek", contextWindow: 64000, maxTokens: 8192, reasoning: false }),
      stream: () => fakeStream([{ type: "error", reason: "aborted", error: { errorMessage: "Request was aborted" } }]),
    } as never;
    _setModels(() => fakeModels as never);
    _setModelLookup(() => ({ id: "m", name: "m", provider: "deepseek", contextWindow: 64000, maxTokens: 8192, reasoning: false } as never));

    const result = await streamChat({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }], tools: [], onEvent: (e) => events.push(e) });

    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
    expect(events.some((e) => (e as { type: string }).type === "error")).toBe(true);
  });

  it("模型不存在时返回 ENV_UNSUPPORTED（配置漂移防御）", async () => {
    _setModelLookup(() => undefined);
    const result = await streamChat({ apiKey: "k", model: "not-exist", messages: [], tools: [] });
    expect(result.ok).toBe(false);
    expect((result.error as { code?: string }).code).toBe("ENV_UNSUPPORTED");
  });

  it("provider 参数决定模型解析（opencode-go 模型走 opencode-go 目录）", async () => {
    const events: unknown[] = [];
    const calls: Array<[string, string]> = [];
    const fakeModels = {
      getModel: (p: string, m: string) => ({ id: m, name: m, provider: p, contextWindow: 64000, maxTokens: 8192, reasoning: false }),
      stream: (model: { id: string; provider: string }) => {
        events.push({ type: "stream_resolved", id: model.id, provider: model.provider });
        return fakeStream([{ type: "done", reason: "stop", message: { usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }]);
      },
    } as never;
    _setModels(() => fakeModels as never);
    _setModelLookup((p: string, m: string) => {
      calls.push([p, m]);
      if (p === "opencode-go" && m === "qwen3.7-max") return { id: "qwen3.7-max", name: "qwen", provider: "opencode-go", api: "anthropic-messages", contextWindow: 64000, maxTokens: 8192, reasoning: true } as never;
      return undefined;
    });

    const result = await streamChat({ apiKey: "k", provider: "opencode-go", model: "qwen3.7-max", messages: [], tools: [] });

    expect(result.ok).toBe(true);
    expect(calls.every(([p]) => p === "opencode-go")).toBe(true); // 只在目标 provider 内查
    expect(events).toContainEqual({ type: "stream_resolved", id: "qwen3.7-max", provider: "opencode-go" });
  });

  it("撞名模型不跨 provider 兜底（deepseek 目录没有 qwen3.7-max → 报错而非拿 opencode-go 的）", async () => {
    const calls: Array<[string, string]> = [];
    const fakeModels = { getModel: () => undefined, stream: () => fakeStream([]) } as never;
    _setModels(() => fakeModels as never);
    _setModelLookup((p: string, m: string) => {
      calls.push([p, m]);
      if (p === "opencode-go" && m === "qwen3.7-max") return { id: "qwen3.7-max", provider: "opencode-go", api: "anthropic-messages" } as never;
      return undefined;
    });

    const result = await streamChat({ apiKey: "k", provider: "deepseek", model: "qwen3.7-max", messages: [], tools: [] });

    expect(result.ok).toBe(false);
    expect((result.error as { code?: string }).code).toBe("ENV_UNSUPPORTED");
    expect((result.error as { message?: string }).message).toContain("deepseek");
    expect(calls).toEqual([
      ["deepseek", "qwen3.7-max"],
      ["deepseek", "deepseek-v4-flash"], // 同 provider 兜底也试过仍无——但绝不问另一家
    ]);
  });

  it("配置漂移在同 provider 内兜底默认模型（不跨 provider）", async () => {
    const calls: Array<[string, string]> = [];
    const fakeModels = {
      getModel: () => undefined,
      stream: () => fakeStream([{ type: "done", reason: "stop", message: { usage: undefined } }]),
    } as never;
    _setModels(() => fakeModels as never);
    _setModelLookup((p: string, m: string) => {
      calls.push([p, m]);
      if (p === "opencode-go" && m === "deepseek-v4-flash") return { id: "deepseek-v4-flash", provider: "opencode-go", api: "openai-completions" } as never;
      return undefined;
    });

    const result = await streamChat({ apiKey: "k", provider: "opencode-go", model: "已下架模型", messages: [], tools: [] });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ["opencode-go", "已下架模型"],
      ["opencode-go", "deepseek-v4-flash"],
    ]);
  });

  it("缺省 provider = deepseek（旧调用方不带 provider 行为不变）", async () => {
    const calls: Array<[string, string]> = [];
    const fakeModels = { getModel: () => undefined, stream: () => fakeStream([]) } as never;
    _setModels(() => fakeModels as never);
    _setModelLookup((p: string, m: string) => {
      calls.push([p, m]);
      return { id: m, provider: p, api: "openai-completions" } as never;
    });
    const result = await streamChat({ apiKey: "k", model: "deepseek-v4-flash", messages: [], tools: [] });
    expect(result.ok).toBe(true);
    expect(calls[0][0]).toBe("deepseek");
  });
});

function fakeStream(events: unknown[]) {
  const asyncIter = (async function* () {
    for (const e of events) yield e;
  })();
  return Object.assign(asyncIter, {
    result: async () => ({ content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }),
  }) as unknown as AsyncIterable<unknown> & { result(): Promise<unknown> };
}