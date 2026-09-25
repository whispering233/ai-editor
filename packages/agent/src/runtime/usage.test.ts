// usage 模块测试：会话累计用量口径（docs/api/80-api-chat.md「会话用量字段」/ docs/design/20-context.md §2.1）
//
// 逐条对齐 pi `AgentSession.getSessionStats()`：
// - 计入的四类 = assistant 消息 / toolResult.usage / compaction · branch_summary 的 usage / 独立 `usage` 条目
//   （`usage` 条目 = pi 0.86 起的 cache warming 记账，见 docs/design/20-context.md §2.1）
// - total = input + output + cacheRead + cacheWrite
// - 命中率分母 = input + cacheRead + cacheWrite；分母 0 → 省略键（不报 0%）
// - 订阅判定取**末条 assistant 消息的 provider**，按 `isUsingSubscription` 口径（非 `isUsingOAuth`）
//   + `kimi-coding` 字面量兜底（API-key 订阅家）

import { describe, expect, it } from "vitest";
import type { Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { sessionUsage, type SessionUsageOptions } from "./usage.js";

// ============ 构造辅助 ============

const BASE = { id: "e0", parentId: null, timestamp: "2026-09-22T00:00:00.000Z" };

function makeUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...overrides,
  };
}

function assistantEntry(id: string, provider: string, usage: Usage): SessionEntry {
  return {
    ...BASE,
    id,
    type: "message",
    message: {
      role: "assistant",
      content: [],
      api: "openai-completions",
      provider,
      model: "model-1",
      usage,
      stopReason: "stop",
      timestamp: 1_700_000_000_000,
    },
  };
}

function toolResultEntry(id: string, usage?: Usage): SessionEntry {
  return {
    ...BASE,
    id,
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "get_outline",
      content: [{ type: "text", text: "ok" }],
      ...(usage ? { usage } : {}),
      timestamp: 1_700_000_000_000,
    },
  };
}

/** 用户消息（不产生费用） */
function userEntry(id: string): SessionEntry {
  return { ...BASE, id, type: "message", message: { role: "user", content: "hi", timestamp: 1_700_000_000_000 } };
}

function compactionEntry(id: string, usage: Usage): SessionEntry {
  return { ...BASE, id, type: "compaction", summary: "摘要", firstKeptEntryId: "e0", tokensBefore: 100, usage };
}

function branchSummaryEntry(id: string, usage: Usage): SessionEntry {
  return { ...BASE, id, type: "branch_summary", fromId: "e0", summary: "分支摘要", usage };
}

/** 独立 `usage` 条目（pi 0.86 起：cache warming 的 `kind: "cache_warm"`，pi 计入总量） */
function cacheWarmEntry(id: string, provider: string, usage: Usage): SessionEntry {
  return { ...BASE, id, type: "usage", kind: "cache_warm", provider, model: "model-1", usage };
}

/** 无 usage 字段的摘要条目（pi 允许 usage 缺失 ⇒ 不计入且不炸） */
function bareCompactionEntry(id: string): SessionEntry {
  return { ...BASE, id, type: "compaction", summary: "摘要", firstKeptEntryId: "e0", tokensBefore: 100 };
}

const NO_SUBSCRIPTION: SessionUsageOptions = { isUsingSubscription: () => false };

// ============ 累加口径 ============

describe("sessionUsage 累加", () => {
  it("assistant + toolResult.usage + compaction + branch_summary 四类累加（user / 无 usage 条目不计入）", () => {
    const result = sessionUsage(
      [
        userEntry("e1"),
        assistantEntry(
          "e2",
          "anthropic",
          makeUsage({
            input: 100,
            output: 40,
            cacheRead: 300,
            cacheWrite: 10,
            cost: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
          }),
        ),
        toolResultEntry("e3", makeUsage({ input: 5, output: 0, totalTokens: 5 })),
        toolResultEntry("e3b"), // 工具未上报 usage ⇒ 不计入也不炸
        compactionEntry(
          "e4",
          makeUsage({ input: 7, output: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 } }),
        ),
        bareCompactionEntry("e5"),
        branchSummaryEntry(
          "e6",
          makeUsage({ cacheRead: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 } }),
        ),
      ],
      NO_SUBSCRIPTION,
    );

    expect(result).toMatchObject({
      input: 112,
      output: 43,
      cacheRead: 320,
      cacheWrite: 10,
      cost: 2.75,
      subscription: false,
    });
  });

  it("total = input + output + cacheRead + cacheWrite（≠ pi 的 usage.totalTokens 逐条和）", () => {
    const result = sessionUsage(
      [
        assistantEntry(
          "e1",
          "anthropic",
          makeUsage({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 999 }),
        ),
      ],
      NO_SUBSCRIPTION,
    );

    expect(result.total).toBe(100);
  });

  it("独立 `usage` 条目（cache warming）计入总量与费用——与 pi getSessionStats() 同口径", () => {
    const result = sessionUsage(
      [
        assistantEntry("e1", "anthropic", makeUsage({ input: 100, output: 10 })),
        cacheWarmEntry(
          "e2",
          "anthropic",
          makeUsage({
            input: 1_000,
            cacheRead: 2_000,
            cacheWrite: 500,
            cost: { input: 0.3, output: 0, cacheRead: 0.006, cacheWrite: 0, total: 0.306 },
          }),
        ),
      ],
      NO_SUBSCRIPTION,
    );

    expect(result).toMatchObject({ input: 1_100, output: 10, cacheRead: 2_000, cacheWrite: 500, cost: 0.306 });
  });

  it("空会话 → 全零且订阅为 false", () => {
    expect(sessionUsage([], NO_SUBSCRIPTION)).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      cost: 0,
      subscription: false,
    });
  });
});

// ============ 命中率 ============

describe("sessionUsage 命中率", () => {
  it("cacheHitRate = cacheRead / (input + cacheRead + cacheWrite)", () => {
    const result = sessionUsage(
      [
        assistantEntry("e1", "anthropic", makeUsage({ input: 1_000, cacheRead: 3_000, cacheWrite: 0, output: 50 })),
      ],
      NO_SUBSCRIPTION,
    );

    expect(result.cacheHitRate).toBe(0.75);
  });

  it("分母为 0（只有输出、无任何输入类 token）→ 省略该键", () => {
    const result = sessionUsage([assistantEntry("e1", "anthropic", makeUsage({ output: 120 }))], NO_SUBSCRIPTION);

    expect(Object.hasOwn(result, "cacheHitRate")).toBe(false);
  });

  it("有分母但 cacheRead 为 0 → 键存在且为 0（省略口径只认分母）", () => {
    const result = sessionUsage([assistantEntry("e1", "anthropic", makeUsage({ input: 500 }))], NO_SUBSCRIPTION);

    expect(result.cacheHitRate).toBe(0);
  });
});

// ============ 订阅判定 ============

describe("sessionUsage 订阅判定", () => {
  it("末条 assistant 的 provider 按订阅计费 → true", () => {
    const result = sessionUsage(
      [assistantEntry("e1", "anthropic", makeUsage({ output: 1 }))],
      { isUsingSubscription: (provider) => provider === "anthropic" },
    );

    expect(result.subscription).toBe(true);
  });

  it("订阅型 provider 字面量（API-key 凭据，isUsingSubscription 判 false）→ true", () => {
    const result = sessionUsage([assistantEntry("e1", "kimi-coding", makeUsage({ output: 1 }))], NO_SUBSCRIPTION);

    expect(result.subscription).toBe(true);
  });

  it("OAuth 但按量计费的家（openrouter / radius）→ false（有意不用 isUsingOAuth）", () => {
    const result = sessionUsage([assistantEntry("e1", "openrouter", makeUsage({ output: 1 }))], {
      isUsingSubscription: (provider) => provider === "anthropic",
    });

    expect(result.subscription).toBe(false);
  });

  it("既非订阅计费也非订阅型 provider → false", () => {
    const result = sessionUsage([assistantEntry("e1", "openai", makeUsage({ output: 1 }))], {
      isUsingSubscription: (provider) => provider === "anthropic",
    });

    expect(result.subscription).toBe(false);
  });

  it("只看末条 assistant（中途换过模型按当时那家算）", () => {
    const result = sessionUsage(
      [
        assistantEntry("e1", "kimi-coding", makeUsage({ output: 1 })),
        assistantEntry("e2", "openai", makeUsage({ output: 1 })),
      ],
      NO_SUBSCRIPTION,
    );

    expect(result.subscription).toBe(false);
  });
});
