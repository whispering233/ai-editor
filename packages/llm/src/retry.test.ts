// @whispering233/ai-editor-llm 重试测试（S6.2）
// mock produce + vitest fake timers：重试次数 / 退避间隔 / 配额不重试 /
// abort 中断（含退避 sleep 期间）/ 非重试错误直返 / withRetry 包 chatStream 集成
import { describe, expect, it, vi } from "vitest";
import { chatStream, LLM_TRANSPORT_ERROR_CODES } from "./client";
import { _setModels, _setModelLookup } from "./adapter";
import { classifyChatStreamOutcome, classifyLLMError, withRetry } from "./retry";
import type { ChatStreamResult, LLMError } from "./types";

/** 构造 LLMError 形态错误 */
function llmErr(status: number, code?: string, message = "err"): LLMError {
  return { status, ...(code ? { code } : {}), message };
}

/** 可重试分类（throw 路径 + resolve 失败值都判：LLMError 形态） */
function retryableErrorOnly(outcome: { type: "value" | "error"; value?: unknown; error?: unknown }): boolean {
  if (outcome.type === "value") return false;
  return classifyLLMError(outcome.error);
}

describe("classifyLLMError 分类（决策 15）", () => {
  it("可重试：429 / 5xx / 网络断开 / 流截断", () => {
    expect(classifyLLMError(llmErr(429))).toBe(true);
    expect(classifyLLMError(llmErr(500))).toBe(true);
    expect(classifyLLMError(llmErr(503))).toBe(true);
    expect(classifyLLMError({ status: 0, code: "NETWORK_ERROR", message: "x" })).toBe(true);
    expect(classifyLLMError({ status: 0, code: "STREAM_TRUNCATED", message: "x" })).toBe(true);
  });

  it("不可重试：abort / 消费者异常 / 配额 / 401/403 / 其他 4xx / 环境缺失 / 未知形态", () => {
    expect(classifyLLMError({ status: 0, code: "ABORTED", message: "x" })).toBe(false);
    expect(classifyLLMError({ status: 0, code: "CONSUMER_ERROR", message: "x" })).toBe(false);
    expect(classifyLLMError(llmErr(402))).toBe(false);
    expect(classifyLLMError(llmErr(400, "insufficient_quota"))).toBe(false);
    expect(classifyLLMError(llmErr(500, "billing_error"))).toBe(false); // code 优先于 status
    expect(classifyLLMError(llmErr(429, "insufficient_quota"))).toBe(false); // 配额优先于 429
    expect(classifyLLMError(llmErr(401))).toBe(false);
    expect(classifyLLMError(llmErr(403))).toBe(false);
    expect(classifyLLMError(llmErr(404))).toBe(false);
    expect(classifyLLMError({ status: 0, code: "NO_FETCH", message: "x" })).toBe(false);
    expect(classifyLLMError({ status: 0, code: "ENV_UNSUPPORTED", message: "x" })).toBe(false);
    expect(classifyLLMError(new Error("plain"))).toBe(false); // 未知形态：保守不重试
    expect(classifyLLMError("string")).toBe(false);
    expect(classifyLLMError(null)).toBe(false);
  });
});

describe("withRetry 基础行为", () => {
  it("可重试错误重试后成功（只调用到成功为止）", async () => {
    let calls = 0;
    const produce = vi.fn(async () => {
      calls++;
      if (calls < 3) throw llmErr(500);
      return "ok";
    });
    const result = await withRetry(produce, {
      isRetryable: retryableErrorOnly,
      maxRetries: 5,
      baseDelayMs: 10,
    });
    expect(result).toBe("ok");
    expect(produce).toHaveBeenCalledTimes(3);
  });

  it("可重试错误次数耗尽：最终失败（首次 + maxRetries 次重试后抛回最后一次异常）", async () => {
    const produce = vi.fn(async () => {
      throw llmErr(429);
    });
    await expect(
      withRetry(produce, { isRetryable: retryableErrorOnly, maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toMatchObject({ status: 429 });
    expect(produce).toHaveBeenCalledTimes(3);
  });

  it("成功值直接返回，不重试", async () => {
    const produce = vi.fn(async () => 42);
    const result = await withRetry(produce, { isRetryable: retryableErrorOnly });
    expect(result).toBe(42);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("不可重试错误：只调用一次，异常原样抛回（快失败）", async () => {
    const err = llmErr(401);
    const produce = vi.fn(async () => {
      throw err;
    });
    await expect(withRetry(produce, { isRetryable: retryableErrorOnly })).rejects.toBe(err);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("resolve 出失败值（chatStream 形态）：最终失败时原样返回值不抛", async () => {
    const failResult: ChatStreamResult = { ok: false, aborted: false, error: llmErr(0, "NETWORK_ERROR") };
    const produce = vi.fn(async () => failResult);
    const result = await withRetry(produce, {
      isRetryable: (o) => (o.type === "value" ? !o.value.ok : false),
      maxRetries: 1,
      baseDelayMs: 1,
    });
    expect(result).toBe(failResult);
    expect(produce).toHaveBeenCalledTimes(2);
  });
});

describe("withRetry 退避与 abort（决策 15）", () => {
  it("指数退避：baseDelay * 2^(attempt-1)，间隔精确（fake timers）", async () => {
    vi.useFakeTimers();
    try {
      const produce = vi.fn(async () => {
        throw llmErr(500);
      });
      const p = withRetry(produce, {
        isRetryable: retryableErrorOnly,
        maxRetries: 2,
        baseDelayMs: 1000,
      });
      // 提前挂接断言（防未处理 rejection），再推进时间
      const assertion = expect(p).rejects.toMatchObject({ status: 500 });
      await vi.advanceTimersByTimeAsync(0); // 首次尝试完成 → 进入第一次退避（1000ms）
      expect(produce).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999); // 退避未满
      expect(produce).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); // 1000ms 到点 → 第二次尝试 → 退避 2000ms
      expect(produce).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1999); // 退避未满
      expect(produce).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1); // 2000ms 到点 → 第三次尝试 → 次数耗尽
      expect(produce).toHaveBeenCalledTimes(3);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("signal 已 aborted：不发起请求，立即抛 ABORT_ERROR", async () => {
    const ac = new AbortController();
    ac.abort();
    const produce = vi.fn(async () => "ok");
    await expect(
      withRetry(produce, { isRetryable: retryableErrorOnly, signal: ac.signal }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(produce).not.toHaveBeenCalled();
  });

  it("首次失败后 abort：不重试，抛 ABORT_ERROR", async () => {
    const ac = new AbortController();
    let calls = 0;
    const produce = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        ac.abort(); // 失败后、重试决策前取消
        throw llmErr(500);
      }
      return "ok";
    });
    await expect(
      withRetry(produce, { isRetryable: retryableErrorOnly, signal: ac.signal, baseDelayMs: 1 }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("退避 sleep 期间 abort：即时中断，不等待退避到点（fake timers）", async () => {
    vi.useFakeTimers();
    try {
      const ac = new AbortController();
      const produce = vi.fn(async () => {
        throw llmErr(429);
      });
      const p = withRetry(produce, {
        isRetryable: retryableErrorOnly,
        signal: ac.signal,
        maxRetries: 3,
        baseDelayMs: 5000,
      });
      await vi.advanceTimersByTimeAsync(0); // 首次失败 → 进入 5000ms 退避
      expect(produce).toHaveBeenCalledTimes(1);
      const assertion = expect(p).rejects.toMatchObject({ code: "ABORTED" });
      ac.abort(); // 退避期间取消 → 即时中断
      await vi.advanceTimersByTimeAsync(0);
      await assertion;
      expect(produce).toHaveBeenCalledTimes(1); // 未重试
    } finally {
      vi.useRealTimers();
    }
  });

  it("onRetry 回调：每次重试前触发，attempt 从 1 递增", async () => {
    let calls = 0;
    const attempts: number[] = [];
    const produce = vi.fn(async () => {
      calls++;
      if (calls < 3) throw llmErr(503);
      return "ok";
    });
    const result = await withRetry(produce, {
      isRetryable: retryableErrorOnly,
      maxRetries: 5,
      baseDelayMs: 1,
      onRetry: (attempt) => attempts.push(attempt),
    });
    expect(result).toBe("ok");
    expect(attempts).toEqual([1, 2]);
  });
});

describe("withRetry 包 chatStream 集成（决策 34 换核后 fake models 注入）", () => {
  const fakeModel = { id: "m", name: "m", provider: "deepseek", contextWindow: 64000, maxTokens: 8192, reasoning: true };

  function fakeStream(events: unknown[]) {
    const asyncIter = (async function* () { for (const e of events) yield e; })();
    return Object.assign(asyncIter, { result: async () => ({ content: [], usage: undefined }) }) as AsyncIterable<unknown> & { result(): Promise<unknown> };
  }

  it("网络错误（NETWORK_ERROR）自动重试后成功", async () => {
    let calls = 0;
    const models = {
      getModel: () => fakeModel,
      stream: () => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed"); // mock 抛错 → NETWORK_ERROR
        return fakeStream([{ type: "done", reason: "stop", message: { usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }]);
      },
    };
    _setModels(() => models as never);
    _setModelLookup(() => fakeModel as never);

    const result = await withRetry(
      () => chatStream({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }], tools: [] }),
      { isRetryable: classifyChatStreamOutcome, baseDelayMs: 5 },
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(2); // 首抛错重试一次成功
  });

  it("流式截断（STREAM_TRUNCATED）自动重试后成功", async () => {
    let calls = 0;
    const models = {
      getModel: () => fakeModel,
      stream: () => {
        calls++;
        if (calls === 1) throw new Error("Stream ended without finish_reason"); // 无 done 事件终止 → STREAM_TRUNCATED
        return fakeStream([{ type: "done", reason: "stop", message: { usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }]);
      },
    };
    _setModels(() => models as never);
    _setModelLookup(() => fakeModel as never);

    const result = await withRetry(
      () => chatStream({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }], tools: [] }),
      { isRetryable: classifyChatStreamOutcome, baseDelayMs: 5 },
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("流中 abort：aborted 结果原样返回，不重试", async () => {
    const ac = new AbortController();
    let calls = 0;
    const models = {
      getModel: () => fakeModel,
      stream: () => {
        calls++;
        return fakeStream([{ type: "error", reason: "aborted", error: { errorMessage: "Request was aborted" } }]);
      },
    };
    _setModels(() => models as never);
    _setModelLookup(() => fakeModel as never);

    const result = await withRetry(
      () => chatStream({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }], tools: [], signal: ac.signal }),
      { isRetryable: classifyChatStreamOutcome, baseDelayMs: 5 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(true);
      expect(result.error.code).toBe(LLM_TRANSPORT_ERROR_CODES.ABORTED);
    }
    expect(calls).toBe(1); // 不重试
  });
});
