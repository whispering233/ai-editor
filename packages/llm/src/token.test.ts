// @ai-editor/llm token 估算与截断测试（S6.2）
// 覆盖：chars/4 估算边界、lastUsage 真实 usage 基线优先、工具定义 JSON 估算、
// 截断标记与「缩小范围」提示、未超限不截断、极小预算不崩溃
import { describe, expect, it } from "vitest";
import { estimateMessagesTokens, estimateTokens, truncateToolResult } from "./token";
import type { LLMMessage, LLMToolDefinition, LLMUsage } from "./types";

describe("estimateTokens（决策 6：chars/4）", () => {
  it("chars/4 向上取整边界", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("aaaa")).toBe(1);
    expect(estimateTokens("aaaaa")).toBe(2);
    expect(estimateTokens("a".repeat(8))).toBe(2);
    expect(estimateTokens("a".repeat(9))).toBe(3);
    expect(estimateTokens("你好")).toBe(1); // 中文按字符计
    expect(estimateTokens("你好世界")).toBe(1);
    expect(estimateTokens("你好世界啊")).toBe(2);
  });
});

describe("estimateMessagesTokens", () => {
  it("无基线：纯 chars/4 估算，assistant 的 tool_calls 按 JSON 序列化估算", () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "a".repeat(4) }, // 1 token
      { role: "user", content: "b".repeat(8) }, // 2 tokens
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "get_entity", arguments: "{}" } },
        ],
      },
      { role: "tool", content: "c".repeat(4), tool_call_id: "call_1" }, // 1 token
    ];
    const assistantMsg = messages[2];
    if (assistantMsg.role !== "assistant") throw new Error("fixture 错误"); // 类型收窄
    const toolCallsTokens = estimateTokens(JSON.stringify(assistantMsg.tool_calls ?? []));
    expect(estimateMessagesTokens(messages)).toBe(1 + 2 + toolCallsTokens + 1);
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it("工具定义按 JSON.stringify 估算", () => {
    const tools: LLMToolDefinition[] = [
      { name: "get_entity", description: "查询实体", parameters: { type: "object" } },
    ];
    const withTools = estimateMessagesTokens([], { tools });
    expect(withTools).toBe(estimateTokens(JSON.stringify(tools)));
    expect(estimateMessagesTokens([], { tools: [] })).toBe(0);
    expect(estimateMessagesTokens([], {})).toBe(0);
  });

  it("lastUsage 优先：真实 usage 作为基线，其后消息按 chars/4 追加", () => {
    const lastUsage: LLMUsage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    const messages: LLMMessage[] = [{ role: "user", content: "a".repeat(8) }]; // 2 tokens
    expect(estimateMessagesTokens(messages, { lastUsage })).toBe(150 + 2);
    expect(estimateMessagesTokens([], { lastUsage })).toBe(150); // 无后续消息 = 基线本身
    expect(estimateMessagesTokens(messages, { lastUsage: null })).toBe(2); // 无基线（裁剪后重置）
  });
});

describe("truncateToolResult（决策 15：不得静默截断）", () => {
  it("未超限：原样返回，truncated=false", () => {
    const content = "a".repeat(100); // 25 tokens
    const r = truncateToolResult(content, 100);
    expect(r.truncated).toBe(false);
    expect(r.content).toBe(content);
    expect(r.originalChars).toBe(100);
    expect(r.keptChars).toBe(100);
  });

  it("恰好预算：不截断", () => {
    const content = "a".repeat(8); // 2 tokens
    const r = truncateToolResult(content, 2);
    expect(r.truncated).toBe(false);
    expect(r.content).toBe(content);
  });

  it("超限：保留前缀 + 截断说明（含「已截断」「缩小范围」提示）", () => {
    const content = "a".repeat(1000); // 250 tokens
    const r = truncateToolResult(content, 50);
    expect(r.truncated).toBe(true);
    expect(r.originalChars).toBe(1000);
    expect(r.keptChars).toBeGreaterThan(0);
    expect(r.keptChars).toBeLessThan(200); // 50 tokens * 4 chars 之内（预留说明空间）
    expect(r.content.startsWith("a".repeat(r.keptChars))).toBe(true); // 保留原始前缀
    expect(r.content).toContain("已截断"); // 显式标记
    expect(r.content).toContain("缩小查询范围"); // 引导提示（决策 15）
    expect(r.content.length).toBe(r.keptChars + 40); // 说明部分固定 40 字符
    // 截断后内容（含说明）估算不超过预算（启发式容差 ±1）
    expect(estimateTokens(r.content)).toBeLessThanOrEqual(51);
  });

  it("极小预算：不崩溃，仅剩截断说明", () => {
    const r = truncateToolResult("a".repeat(50), 0);
    expect(r.truncated).toBe(true);
    expect(r.keptChars).toBe(0);
    expect(r.content).toBe("\n\n[结果已截断：超出 token 预算，数据不完整；请缩小查询范围或分页获取]");
  });
});
