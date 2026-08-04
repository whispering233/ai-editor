// S7.3 主循环测试：终止条件 / 事件顺序 / length 截断 / 重试与超时 / abort 双形态归一 /
// 工具失败结构化喂回 / 持久化回调
// 契约来源：doc/design/tasks.md S7.3、doc/design/decisions.md 决策 15/16/18、
// doc/api/endpoints.md POST /api/v1/chat 事件契约（tool_call/tool_result/proposal/text/done/error）。
// 策略：mock produce 固定响应序列（逐次 shift 脚本）+ mock dispatcher，纯内存断言，无 I/O。
import { describe, expect, it, vi } from "vitest";
import type { AbortSignalLike, ChatStreamResult, LLMMessage, LLMStreamEvent, LLMUsage } from "@whispering233/ai-editor-llm";
import { ABORT_ERROR } from "@whispering233/ai-editor-llm";
import { AbortedError } from "@whispering233/ai-editor-tools";
import {
  DEFAULT_MAX_ROUNDS,
  runAgent,
  type AgentEvent,
  type DispatchResult,
  type DispatchToolCall,
  type RunAgentResult,
} from "./run";
import type { SessionMessage } from "./session";

// ============ 构造辅助 ============

/** mock produce 脚本：每次调用按序取一步（result + 可选的 events，按序 onEvent 发出） */
function createMockProduce(script: Array<{ result: ChatStreamResult; events?: LLMStreamEvent[] }>) {
  const calls: Array<{ messages: LLMMessage[]; signal: AbortSignalLike | undefined }> = [];
  const produce = vi.fn(
    async (
      messages: LLMMessage[],
      signal?: AbortSignalLike,
      onEvent?: (e: LLMStreamEvent) => void,
    ): Promise<ChatStreamResult> => {
      calls.push({ messages, signal });
      const step = script.shift();
      if (!step) throw new Error("mock produce 脚本耗尽（调用次数超出预期）");
      for (const e of step.events ?? []) onEvent?.(e);
      return step.result;
    },
  );
  return { produce, calls };
}

/** 默认 mock dispatcher：返回与输入同序的 ok 结果；可注入固定结果序列 */
function createMockDispatcher(results?: DispatchResult[]) {
  const calls: DispatchToolCall[][] = [];
  const dispatcher = vi.fn(async (input: DispatchToolCall[]): Promise<DispatchResult[]> => {
    calls.push(input);
    if (results !== undefined) return results;
    return input.map((c) => ({ id: c.id, tool: c.tool, ok: true, isError: false, content: `ok:${c.tool}` }));
  });
  return { dispatcher, calls };
}

function okResult(stopReason = "stop", usage: LLMUsage | null = null): ChatStreamResult {
  return { ok: true, stopReason, usage };
}

function errResult(status: number, code?: string, message = "mock 错误"): ChatStreamResult {
  return { ok: false, aborted: false, error: { status, ...(code !== undefined ? { code } : {}), message } };
}

function textEvent(delta: string): LLMStreamEvent {
  return { type: "text", delta };
}

function toolCallEvent(id: string, name = "get_entity", args: Record<string, unknown> = {}): LLMStreamEvent {
  return { type: "tool_call", toolCall: { id, name, arguments: args, rawArguments: JSON.stringify(args) } };
}

/** 挂起直到 signal abort（超时兜底返回 timeout）；mock 长调用/超时场景用 */
function sleepUntilAborted(signal: AbortSignalLike | undefined, ms: number): Promise<"aborted" | "timeout"> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve("aborted");
      return;
    }
    const timer = setTimeout(() => resolve("timeout"), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve("aborted");
      },
      { once: true },
    );
  });
}

function runBasic(
  deps: Partial<Parameters<typeof runAgent>[0]["deps"]> & {
    produce: Parameters<typeof runAgent>[0]["deps"]["produce"];
    dispatcher: Parameters<typeof runAgent>[0]["deps"]["dispatcher"];
  },
  input?: Partial<Omit<Parameters<typeof runAgent>[0], "deps">>,
): Promise<RunAgentResult> {
  return runAgent({
    userMessage: "分析第三章",
    session: [],
    deps: {
      produce: deps.produce,
      dispatcher: deps.dispatcher,
      onEvent: deps.onEvent,
      onMessages: deps.onMessages,
    },
    ...input,
  });
}

// ============ 终止条件 ============

describe("runAgent 终止条件（决策 15）", () => {
  it("无 tool_call：text 流式转发 + done 终止（done 携带 session_id）", async () => {
    const { produce, calls } = createMockProduce([
      { result: okResult(), events: [textEvent("你好，"), textEvent("顾问")] },
    ]);
    const events: AgentEvent[] = [];
    const messages: SessionMessage[][] = [];
    const result = await runBasic(
      { produce, dispatcher: createMockDispatcher().dispatcher, onEvent: (e) => events.push(e), onMessages: (m) => messages.push(m) },
      { sessionId: "sess_1" },
    );
    expect(result.ok).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.error).toBeNull();
    expect(result.rounds).toBe(1);
    expect(events.map((e) => e.type)).toEqual(["turn_start", "text", "text", "done"]);
    expect(events[events.length - 1]).toMatchObject({ type: "done", sessionId: "sess_1" });
    // 持久化回调：本轮新消息 = [assistant]；用户消息不入 onMessages（S7.6 自行持久化）
    expect(messages).toEqual([[{ role: "assistant", content: "你好，顾问" }]]);
    // 用户消息已入喂回 payload
    expect(calls[0].messages.some((m) => m.role === "user" && m.content === "分析第三章")).toBe(true);
  });

  it("8 轮上限：持续 tool_call → error AGENT_MAX_ITERATIONS 终止", async () => {
    const script = Array.from({ length: DEFAULT_MAX_ROUNDS }, () => ({
      result: okResult("tool_calls"),
      events: [toolCallEvent("call_1")],
    }));
    const { produce } = createMockProduce(script);
    const { dispatcher } = createMockDispatcher();
    const events: AgentEvent[] = [];
    const result = await runBasic(
      { produce, dispatcher, onEvent: (e) => events.push(e) },
      { maxRounds: DEFAULT_MAX_ROUNDS },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AGENT_MAX_ITERATIONS");
    expect(result.rounds).toBe(DEFAULT_MAX_ROUNDS);
    expect(dispatcher).toHaveBeenCalledTimes(DEFAULT_MAX_ROUNDS);
    expect(events.filter((e) => e.type === "turn_start")).toHaveLength(DEFAULT_MAX_ROUNDS);
    expect(events[events.length - 1]).toMatchObject({ type: "error", code: "AGENT_MAX_ITERATIONS" });
  });

  it("120s 单轮超时（含重试退避）→ error AGENT_TIMEOUT（fake timers）", async () => {
    vi.useFakeTimers();
    try {
      // produce 挂起直到 attempt 控制器 abort（模拟长调用被超时中止）
      const produce = vi.fn(async (_m: LLMMessage[], signal?: AbortSignalLike): Promise<ChatStreamResult> => {
        await sleepUntilAborted(signal, 1_000_000);
        return { ok: false, aborted: true, error: ABORT_ERROR };
      });
      const events: AgentEvent[] = [];
      const p = runAgent({
        userMessage: "hi",
        session: [],
        roundTimeoutMs: 120_000,
        attemptTimeoutMs: 120_000, // attempt 超时 = 单轮预算（预算耗尽即终止，无重试空间）
        maxRetries: 3,
        retryBaseDelayMs: 1000,
        deps: { produce, dispatcher: createMockDispatcher().dispatcher, onEvent: (e) => events.push(e) },
      });
      await vi.advanceTimersByTimeAsync(120_000); // attempt 超时 → abort → 归一为可重试超时
      await vi.advanceTimersByTimeAsync(0);
      const result = await p;
      expect(result.ok).toBe(false);
      expect(result.aborted).toBe(false); // 超时 ≠ 用户取消（决策 15 分离语义）
      expect(result.error?.code).toBe("AGENT_TIMEOUT");
      expect(produce).toHaveBeenCalledTimes(1); // 轮次预算耗尽：isRetryable 拒绝再重试
      expect(events[events.length - 1]).toMatchObject({ type: "error", code: "AGENT_TIMEOUT", aborted: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("token 预算超限 → error AGENT_TOKEN_BUDGET 终止（produce 不被调用）", async () => {
    const { produce } = createMockProduce([]);
    const events: AgentEvent[] = [];
    const result = await runBasic(
      { produce, dispatcher: createMockDispatcher().dispatcher, onEvent: (e) => events.push(e) },
      { tokenBudget: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AGENT_TOKEN_BUDGET");
    expect(produce).not.toHaveBeenCalled();
    expect(events[events.length - 1]).toMatchObject({ type: "error", code: "AGENT_TOKEN_BUDGET" });
  });

  it("模型最终失败（配额类 402 不可重试）→ error 事件终止，produce 只调一次", async () => {
    const { produce } = createMockProduce([
      { result: errResult(402, "insufficient_quota", "配额不足") },
    ]);
    const events: AgentEvent[] = [];
    const result = await runBasic(
      { produce, dispatcher: createMockDispatcher().dispatcher, onEvent: (e) => events.push(e) },
      { maxRetries: 3, retryBaseDelayMs: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(false);
    expect(result.error?.code).toBe("insufficient_quota");
    expect(produce).toHaveBeenCalledTimes(1); // 配额/计费类快失败不重试（决策 15）
    expect(events[events.length - 1]).toMatchObject({ type: "error", code: "insufficient_quota" });
    expect(events.some((e) => e.type === "done")).toBe(false); // error 后终止，无 done
  });
});

// ============ 事件顺序 ============

describe("runAgent 事件顺序（endpoints.md）", () => {
  it("text → tool_call → tool_result → proposal（在 tool_result 后、循环继续前）→ done", async () => {
    const { produce } = createMockProduce([
      {
        result: okResult("tool_calls"),
        events: [textEvent("我来查一下"), toolCallEvent("call_a", "get_entity", { id: "char-1" }), toolCallEvent("call_b", "propose_create_entity", { name: "张三" })],
      },
      { result: okResult(), events: [textEvent("结论如上")] },
    ]);
    const { dispatcher } = createMockDispatcher([
      { id: "call_a", tool: "get_entity", ok: true, isError: false, content: "{\"id\":\"char-1\"}" },
      {
        id: "call_b",
        tool: "propose_create_entity",
        ok: true,
        isError: false,
        content: "提案已生成（确认后生效）",
        proposal: { proposal_id: "prop_1", type: "propose_create_entity", preview: { name: "张三", type: "character" } },
      },
    ]);
    const events: AgentEvent[] = [];
    const messages: SessionMessage[][] = [];
    const result = await runBasic(
      { produce, dispatcher, onEvent: (e) => events.push(e), onMessages: (m) => messages.push(m) },
      { sessionId: "sess_2" },
    );
    expect(result.ok).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      "turn_start", "text", "tool_call", "tool_call",
      "tool_result", "tool_result", "proposal",
      "turn_start", "text", "done",
    ]);
    // tool_result 按 id 回填（决策 18 配对）
    expect(events[4]).toMatchObject({ type: "tool_result", id: "call_a" });
    expect(events[5]).toMatchObject({ type: "tool_result", id: "call_b" });
    // proposal 在对应 tool_result 之后、下一轮/循环继续之前
    expect(events[6]).toEqual({
      type: "proposal",
      proposal: { proposal_id: "prop_1", type: "propose_create_entity", preview: { name: "张三", type: "character" } },
    });
    // 持久化回调：第 1 轮 = assistant（含 tool_calls）+ 2 条 tool 结果
    expect(messages[0]).toHaveLength(3);
    expect(messages[0][0]).toMatchObject({ role: "assistant", content: "我来查一下" });
    expect(messages[0][1]).toMatchObject({ role: "tool", tool_call_id: "call_a", content: "{\"id\":\"char-1\"}" });
    expect(messages[0][2]).toMatchObject({ role: "tool", tool_call_id: "call_b" });
    expect(messages[1]).toEqual([{ role: "assistant", content: "结论如上" }]);
  });

  it("proposal 事件由 dispatcher 结果透传（S7.4 构造 preview，本层不加工）", async () => {
    const { produce } = createMockProduce([
      { result: okResult("tool_calls"), events: [toolCallEvent("call_x", "propose_update_entity")] },
      { result: okResult(), events: [textEvent("完成")] },
    ]);
    const { dispatcher } = createMockDispatcher([
      {
        id: "call_x",
        tool: "propose_update_entity",
        ok: true,
        isError: false,
        content: "ok",
        proposal: { proposal_id: "prop_9", type: "propose_update_entity", preview: { summary: "x" } },
      },
    ]);
    const events: AgentEvent[] = [];
    await runBasic({ produce, dispatcher, onEvent: (e) => events.push(e) });
    const proposalEvents = events.filter((e) => e.type === "proposal");
    expect(proposalEvents).toHaveLength(1);
    expect(proposalEvents[0]).toMatchObject({
      type: "proposal",
      proposal: { proposal_id: "prop_9", type: "propose_update_entity", preview: { summary: "x" } },
    });
  });
});

// ============ length 截断（决策 15） ============

describe("finish_reason=length 截断（决策 15）", () => {
  it("工具不执行（dispatcher 不被调用）+ 全部标错喂回重发", async () => {
    const { produce, calls } = createMockProduce([
      {
        result: okResult("length"),
        // 参数看似解析成功但流式拼接可能静默不完整——一律不执行
        events: [toolCallEvent("call_1", "get_entity", { id: "char-1" })],
      },
      { result: okResult(), events: [textEvent("好的，我重新规划")] },
    ]);
    const { dispatcher } = createMockDispatcher();
    const events: AgentEvent[] = [];
    const result = await runBasic({ produce, dispatcher, onEvent: (e) => events.push(e) });
    expect(result.ok).toBe(true);
    expect(dispatcher).not.toHaveBeenCalled(); // length 截断：任何 tool_call 都不执行
    // 第二轮喂回 payload 含标错 tool 消息（模型据此重发）
    const round2 = calls[1].messages;
    const toolMsg = round2.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect((toolMsg as { content: string }).content).toContain("length");
    // 截断轮仍发出 tool_call 事件（客户端可见模型尝试过调用）
    expect(events.some((e) => e.type === "tool_call" && e.id === "call_1")).toBe(true);
    // length 是完整响应：assistant（含 tool_calls）已入会话与持久化
    expect(calls[1].messages.some((m) => m.role === "assistant" && (m as { tool_calls?: unknown[] }).tool_calls?.length === 1)).toBe(true);
  });

  it("参数解析失败的调用同样不执行、标错喂回（非 length 轮）", async () => {
    const { produce, calls } = createMockProduce([
      {
        result: okResult("tool_calls"),
        events: [{ type: "tool_call", toolCall: { id: "call_bad", name: "get_entity", rawArguments: "{ 非法 JSON", error: "参数 JSON 解析失败" } }],
      },
      { result: okResult(), events: [textEvent("已修正")] },
    ]);
    const { dispatcher } = createMockDispatcher();
    const result = await runBasic({ produce, dispatcher });
    expect(result.ok).toBe(true);
    expect(dispatcher).not.toHaveBeenCalled();
    const toolMsg = calls[1].messages.find((m) => m.role === "tool");
    expect((toolMsg as { content: string }).content).toContain("解析失败");
  });
});

// ============ 重试与超时/取消分离（决策 15/16） ============

describe("模型失败重试与取消（决策 15/16）", () => {
  it("可重试错误重试后成功：重试不消耗轮次、报告值累计（不清零）、半条 assistant 不重发", async () => {
    const { produce, calls } = createMockProduce([
      { result: errResult(500, "SERVER_ERROR", "服务端繁忙") },
      { result: okResult(), events: [textEvent("最终答复")] },
    ]);
    const result = await runBasic(
      { produce, dispatcher: createMockDispatcher().dispatcher },
      { maxRetries: 3, retryBaseDelayMs: 1 },
    );
    expect(result.ok).toBe(true);
    expect(result.rounds).toBe(1); // 重试与轮次分开计量（决策 15：不互相消耗）
    expect(result.retries).toBe(1); // 累计报告值：成功轮前重试过 1 次（ora S7.3 审核 S6 口径）
    expect(produce).toHaveBeenCalledTimes(2);
    // 决策 18：重试复用原 payload（失败轮的半条 assistant 绝不追加）
    expect(calls[0].messages).toEqual(calls[1].messages);
    expect(calls[1].messages.some((m) => m.role === "assistant")).toBe(false); // 无任何 assistant 半条
  });

  it("多轮场景：每轮各自重试，轮次计数与实际轮数一致、retries 全程累计", async () => {
    const { produce } = createMockProduce([
      { result: errResult(429, undefined, "限流") },
      { result: okResult("tool_calls"), events: [toolCallEvent("call_1")] },
      { result: errResult(500, "SERVER_ERROR") },
      { result: okResult(), events: [textEvent("完成")] },
    ]);
    const { dispatcher } = createMockDispatcher();
    const result = await runBasic(
      { produce, dispatcher },
      { maxRetries: 3, retryBaseDelayMs: 1 },
    );
    expect(result.ok).toBe(true);
    expect(result.rounds).toBe(2); // 两次 produce 成功 = 两轮
    expect(result.retries).toBe(2); // 全程累计：每轮各重试 1 次（不清零）
    expect(produce).toHaveBeenCalledTimes(4); // 每轮各重试 1 次
  });

  it("signal 已 aborted：不发起请求，返回 aborted（abort 不重试）", async () => {
    const ac = new AbortController();
    ac.abort();
    const { produce } = createMockProduce([]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      userMessage: "hi",
      session: [],
      signal: ac.signal as unknown as AbortSignalLike,
      deps: { produce, dispatcher: createMockDispatcher().dispatcher, onEvent: (e) => events.push(e) },
    });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
    expect(produce).not.toHaveBeenCalled();
    expect(events[events.length - 1]).toMatchObject({ type: "error", aborted: true });
  });

  it("produce 期间用户取消：aborted 结果，不重试", async () => {
    const ac = new AbortController();
    const produce = vi.fn(async (_m: LLMMessage[], signal?: AbortSignalLike): Promise<ChatStreamResult> => {
      await sleepUntilAborted(signal, 60_000);
      return { ok: false, aborted: true, error: ABORT_ERROR };
    });
    const p = runAgent({
      userMessage: "hi",
      session: [],
      signal: ac.signal as unknown as AbortSignalLike,
      deps: { produce, dispatcher: createMockDispatcher().dispatcher },
    });
    ac.abort();
    const result = await p;
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
    expect(produce).toHaveBeenCalledTimes(1); // 取消不重试（决策 16）
  });

  it("重试退避期间用户取消：withRetry 抛 ABORT_ERROR → 归一为 aborted 终止", async () => {
    vi.useFakeTimers();
    try {
      const ac = new AbortController();
      const produce = vi.fn(async (): Promise<ChatStreamResult> => errResult(429, undefined, "限流"));
      const events: AgentEvent[] = [];
      const p = runAgent({
        userMessage: "hi",
        session: [],
        signal: ac.signal as unknown as AbortSignalLike,
        maxRetries: 3,
        retryBaseDelayMs: 5000,
        deps: { produce, dispatcher: createMockDispatcher().dispatcher, onEvent: (e) => events.push(e) },
      });
      await vi.advanceTimersByTimeAsync(0); // 首次失败 → 进入 5000ms 退避
      expect(produce).toHaveBeenCalledTimes(1);
      ac.abort(); // 退避 sleep 期间取消：即时中断（llm/retry.ts），不等待退避到点
      await vi.advanceTimersByTimeAsync(0);
      const result = await p;
      expect(result.ok).toBe(false);
      expect(result.aborted).toBe(true);
      expect(produce).toHaveBeenCalledTimes(1); // 未重试
      expect(events[events.length - 1]).toMatchObject({ type: "error", aborted: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============ 工具失败结构化喂回（决策 15 自纠） ============

describe("工具失败结构化喂回", () => {
  it("isError 结果回填 tool 消息（不终止循环），下一轮模型收到错误内容", async () => {
    const { produce, calls } = createMockProduce([
      { result: okResult("tool_calls"), events: [toolCallEvent("call_1", "get_entity", { id: "char-9" })] },
      { result: okResult(), events: [textEvent("实体不存在，我换个方案")] },
    ]);
    const { dispatcher } = createMockDispatcher([
      { id: "call_1", tool: "get_entity", ok: false, isError: true, content: "错误：实体 char-9 不存在" },
    ]);
    const events: AgentEvent[] = [];
    const result = await runBasic({ produce, dispatcher, onEvent: (e) => events.push(e) });
    expect(result.ok).toBe(true); // 工具失败不终止
    // 下一轮模型收到的 payload 含错误 tool 消息（结构化喂回自纠）
    const round2 = calls[1].messages;
    expect(round2.some((m) => m.role === "tool" && m.content === "错误：实体 char-9 不存在")).toBe(true);
    // tool_result 事件携带失败内容
    expect(events.some((e) => e.type === "tool_result" && (e as { result: string }).result === "错误：实体 char-9 不存在")).toBe(true);
  });

  it("dispatcher 返回条数不符：防御终止 AGENT_DISPATCH_ERROR（不产生错位配对）", async () => {
    const { produce } = createMockProduce([
      { result: okResult("tool_calls"), events: [toolCallEvent("call_1"), toolCallEvent("call_2")] },
    ]);
    const { dispatcher } = createMockDispatcher([{ id: "call_1", tool: "get_entity", ok: true, isError: false, content: "ok" }]);
    const events: AgentEvent[] = [];
    const result = await runBasic({ produce, dispatcher, onEvent: (e) => events.push(e) });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AGENT_DISPATCH_ERROR");
    expect(events[events.length - 1]).toMatchObject({ type: "error", code: "AGENT_DISPATCH_ERROR" });
  });

  it("dispatcher 抛错：视为缺陷终止 AGENT_DISPATCH_ERROR", async () => {
    const { produce } = createMockProduce([
      { result: okResult("tool_calls"), events: [toolCallEvent("call_1")] },
    ]);
    const dispatcher = vi.fn(async (): Promise<DispatchResult[]> => {
      throw new Error("executor 内部错误");
    });
    const result = await runBasic({ produce, dispatcher });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AGENT_DISPATCH_ERROR");
  });
});

// ============ dispatcher 取消传播（S7.4 契约：AbortedError → 用户取消语义） ============

describe("dispatcher 取消传播（S7.4 executor 抛 AbortedError）", () => {
  it("工具执行中取消 → 按用户取消终止（aborted=true，非 AGENT_DISPATCH_ERROR、不重试）", async () => {
    const { produce } = createMockProduce([
      { result: okResult("tool_calls"), events: [toolCallEvent("call_1")] },
    ]);
    // S7.4 真实现契约：executor 在工具执行中检查 signal，命中取消抛 AbortedError（tools analysis/utils）
    const dispatcher = vi.fn(async (): Promise<DispatchResult[]> => {
      throw new AbortedError();
    });
    const events: AgentEvent[] = [];
    const result = await runBasic({ produce, dispatcher, onEvent: (e) => events.push(e) });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.error).toEqual(ABORT_ERROR);
    expect(result.error?.code).not.toBe("AGENT_DISPATCH_ERROR"); // 取消不是调度器缺陷
    expect(events[events.length - 1]).toMatchObject({ type: "error", aborted: true });
    expect(produce).toHaveBeenCalledTimes(1); // 不重试（决策 16：取消不重试）
  });

  it("signal 在 LLM 调用期间中止且 dispatcher 抛普通错误 → 按取消终止（signal 识别兜底）", async () => {
    // 场景：produce 期间用户取消（决策 16 ① fetch abort），但竞态下 produce 仍 resolve ok；
    // dispatcher 抛普通错误（未抛 AbortedError）——run.ts catch 以 signal.aborted 双保险识别
    const controller = new AbortController();
    const produce = vi.fn(
      async (_m: LLMMessage[], _s?: AbortSignalLike, onEvent?: (e: LLMStreamEvent) => void): Promise<ChatStreamResult> => {
        controller.abort();
        onEvent?.({ type: "tool_call", toolCall: { id: "call_1", name: "get_entity", arguments: {}, rawArguments: "{}" } });
        return okResult("tool_calls");
      },
    );
    const dispatcher = vi.fn(async (): Promise<DispatchResult[]> => {
      throw new Error("executor 内部错误");
    });
    const result = await runAgent({
      userMessage: "hi",
      session: [],
      deps: { produce, dispatcher },
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.error).toEqual(ABORT_ERROR);
    expect(result.error?.code).not.toBe("AGENT_DISPATCH_ERROR");
  });
});

// ============ 持久化回调（S7.6 消费契约） ============

describe("onMessages 持久化回调", () => {
  it("每轮输出新消息序列（assistant + tool 结果），且用户消息不在其中", async () => {
    const { produce } = createMockProduce([
      { result: okResult("tool_calls"), events: [toolCallEvent("call_a"), toolCallEvent("call_b")] },
      { result: okResult(), events: [textEvent("收尾答复")] },
    ]);
    const { dispatcher } = createMockDispatcher([
      { id: "call_a", tool: "get_entity", ok: true, isError: false, content: "A" },
      { id: "call_b", tool: "search_entities", ok: true, isError: false, content: "B" },
    ]);
    const messages: SessionMessage[][] = [];
    await runBasic({ produce, dispatcher, onMessages: (m) => messages.push(m) });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toHaveLength(3); // assistant + 2 tool
    expect(messages[1]).toHaveLength(1); // 纯 assistant
    // 用户消息由 S7.6 自行持久化，不在本回调输出
    const all = messages.flat();
    expect(all.every((m) => m.role !== "user")).toBe(true);
    // 半条 assistant 不重发：失败轮未产生 onMessages 输出
    expect(messages[0][0]).toMatchObject({ role: "assistant", content: null, tool_calls: [{ id: "call_a" }, { id: "call_b" }] });
  });
});

// ============ ora S7.3 审核修复轮（M2 / S5 / S2 / S3 / S6） ============

describe("ora S7.3 审核修复：轮次预算覆盖工具执行 / id 校验 / 竞态防御 / 回调兜底", () => {
  it("S6：attempt 超时 → 归一可重试 → 重试成功（超时轮不算成功轮，预算内重试）", async () => {
    vi.useFakeTimers();
    try {
      // 第一次调用挂起直到 attempt 超时 abort；第二次调用直接成功
      let first = true;
      const produce = vi.fn(
        async (_m: LLMMessage[], signal?: AbortSignalLike, onEvent?: (e: LLMStreamEvent) => void): Promise<ChatStreamResult> => {
          if (first) {
            first = false;
            await sleepUntilAborted(signal, 1_000_000);
            return { ok: false, aborted: true, error: ABORT_ERROR };
          }
          onEvent?.({ type: "text", delta: "重试后答复" });
          return okResult();
        },
      );
      const events: AgentEvent[] = [];
      const p = runAgent({
        userMessage: "hi",
        session: [],
        roundTimeoutMs: 120_000, // 单轮总预算充足（100s 超时后仍有 20s 余量重试）
        attemptTimeoutMs: 100_000, // attempt 自身超时 100s
        maxRetries: 3,
        retryBaseDelayMs: 1,
        deps: { produce, dispatcher: createMockDispatcher().dispatcher, onEvent: (e) => events.push(e) },
      });
      await vi.advanceTimersByTimeAsync(100_000); // 首 attempt 超时（100s）→ 归一可重试
      await vi.advanceTimersByTimeAsync(1); // 退避 1ms 到点 → 第二次 attempt（预算剩余 20s）
      const result = await p;
      expect(result.ok).toBe(true);
      expect(result.aborted).toBe(false);
      expect(result.rounds).toBe(1); // 重试不消耗轮次
      expect(result.retries).toBe(1); // 超时归一为重试 1 次（累计口径）
      expect(produce).toHaveBeenCalledTimes(2);
      expect(events.some((e) => e.type === "done")).toBe(true); // 最终正常 done
    } finally {
      vi.useRealTimers();
    }
  });

  it("S2：attempt 定时器已触发但 produce 恰返回 ok → 该轮按超时处理（竞态防御）", async () => {
    vi.useFakeTimers();
    try {
      let first = true;
      const produce = vi.fn(async (_m: LLMMessage[], signal?: AbortSignalLike): Promise<ChatStreamResult> => {
        if (first) {
          first = false;
          // 等待 attempt 超时 abort 触发后仍正常 resolve（竞态：timedOut 已置位、produce 却返回 ok）
          await new Promise<void>((resolve) => {
            if (signal?.aborted) {
              resolve();
              return;
            }
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return okResult();
        }
        return okResult();
      });
      const p = runAgent({
        userMessage: "hi",
        session: [],
        roundTimeoutMs: 120_000,
        attemptTimeoutMs: 100_000,
        maxRetries: 3,
        retryBaseDelayMs: 1,
        deps: { produce, dispatcher: createMockDispatcher().dispatcher },
      });
      await vi.advanceTimersByTimeAsync(100_000); // attempt 超时触发 abort → produce resolve ok
      await vi.advanceTimersByTimeAsync(1); // 退避 1ms → 第二次 attempt
      const result = await p;
      expect(result.ok).toBe(true); // 竞态轮被当作超时重试，最终成功
      expect(result.retries).toBe(1);
      expect(produce).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("M2：调度前轮次预算已耗尽 → AGENT_TIMEOUT（工具不被调度）", async () => {
    vi.useFakeTimers();
    try {
      const { produce } = createMockProduce([
        { result: okResult("tool_calls"), events: [toolCallEvent("call_1")] },
      ]);
      const { dispatcher } = createMockDispatcher();
      const events: AgentEvent[] = [];
      // produce 成功返回后把时钟拨过 roundDeadline（模拟 attempt 阶段时间流逝耗尽预算）
      const base = Date.now();
      const produceWrapped = vi.fn(
        async (m: LLMMessage[], s?: AbortSignalLike, onEvent?: (e: LLMStreamEvent) => void): Promise<ChatStreamResult> => {
          const r = await produce(m, s, onEvent);
          vi.setSystemTime(base + 120_001);
          return r;
        },
      );
      const result = await runBasic(
        { produce: produceWrapped, dispatcher, onEvent: (e) => events.push(e) },
        { roundTimeoutMs: 120_000, attemptTimeoutMs: 60_000 },
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("AGENT_TIMEOUT");
      expect(dispatcher).not.toHaveBeenCalled();
      expect(events[events.length - 1]).toMatchObject({ type: "error", code: "AGENT_TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("M2：工具执行耗时超过轮次预算 → dispatcher 返回后 AGENT_TIMEOUT 终止（不进下一轮）", async () => {
    vi.useFakeTimers();
    try {
      const { produce } = createMockProduce([
        { result: okResult("tool_calls"), events: [toolCallEvent("call_1")] },
        { result: okResult(), events: [textEvent("不应到达的下一轮")] }, // 不应被消费
      ]);
      const base = Date.now();
      const dispatcher = vi.fn(async (input: DispatchToolCall[]): Promise<DispatchResult[]> => {
        vi.setSystemTime(base + 120_001); // 工具执行耗时超预算（执行中无法中止，超出的后果=终止）
        return input.map((c) => ({ id: c.id, tool: c.tool, ok: true, isError: false, content: "ok" }));
      });
      const events: AgentEvent[] = [];
      const result = await runBasic(
        { produce, dispatcher, onEvent: (e) => events.push(e) },
        { roundTimeoutMs: 120_000, attemptTimeoutMs: 60_000 },
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("AGENT_TIMEOUT");
      expect(dispatcher).toHaveBeenCalledTimes(1);
      expect(events[events.length - 1]).toMatchObject({ type: "error", code: "AGENT_TIMEOUT" });
      expect(events.some((e) => e.type === "done")).toBe(false); // 未进入下一轮
    } finally {
      vi.useRealTimers();
    }
  });

  it("S5：dispatcher 结果 id 与输入错位 → AGENT_DISPATCH_ERROR 终止（配对防御）", async () => {
    const { produce } = createMockProduce([
      { result: okResult("tool_calls"), events: [toolCallEvent("call_a"), toolCallEvent("call_b")] },
    ]);
    const { dispatcher } = createMockDispatcher([
      { id: "call_b", tool: "get_entity", ok: true, isError: false, content: "B" }, // 与输入 call_a 错位
      { id: "call_a", tool: "get_entity", ok: true, isError: false, content: "A" },
    ]);
    const result = await runBasic({ produce, dispatcher });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AGENT_DISPATCH_ERROR");
  });

  it("S3：onEvent 抛错不逃逸（runAgent 不 reject，循环正常完成）", async () => {
    const { produce } = createMockProduce([
      { result: okResult(), events: [textEvent("正常答复")] },
    ]);
    const result = await runBasic({
      produce,
      dispatcher: createMockDispatcher().dispatcher,
      onEvent: () => {
        throw new Error("SSE 写入失败");
      },
    });
    expect(result.ok).toBe(true); // 消费者抛错被吞，事件流继续
    expect(result.rounds).toBe(1);
  });

  it("S3：onMessages 抛错不逃逸（落库失败不中断循环）", async () => {
    const { produce } = createMockProduce([
      { result: okResult(), events: [textEvent("答复")] },
    ]);
    const result = await runBasic({
      produce,
      dispatcher: createMockDispatcher().dispatcher,
      onMessages: () => {
        throw new Error("落库失败");
      },
    });
    expect(result.ok).toBe(true);
  });

  it("S6：轮首 signal.aborted 优先于 token 超限（已取消并发超限 → 先 aborted 终止）", async () => {
    const ac = new AbortController();
    ac.abort();
    const { produce } = createMockProduce([]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      userMessage: "hi",
      session: [],
      tokenBudget: 1, // 同时构造 token 超限：aborted 应优先（决策 16 取消语义）
      signal: ac.signal as unknown as AbortSignalLike,
      deps: { produce, dispatcher: createMockDispatcher().dispatcher, onEvent: (e) => events.push(e) },
    });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true); // 而非 AGENT_TOKEN_BUDGET
    expect(produce).not.toHaveBeenCalled();
    expect(events[events.length - 1]).toMatchObject({ type: "error", aborted: true });
  });
});
