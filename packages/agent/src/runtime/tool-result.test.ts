// K2 工具结果文本化/截断测试（契约：超上限即截断 + 显式告知，见 docs/design/20-context.md §2）

import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  stringifyToolResult,
  TOOL_RESULT_MAX_TOKENS,
  truncateToolResultText,
} from "./tool-result.js";

describe("estimateTokens", () => {
  it("ASCII 按 4 字符 1 token，非 ASCII 按 1 字符 1 token（高估不低估）", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("中文")).toBe(2);
    expect(estimateTokens("中文abcd")).toBe(3);
  });
});

describe("stringifyToolResult", () => {
  it("字符串原样、对象 JSON 化、不可序列化回退 String()", () => {
    expect(stringifyToolResult("hello")).toBe("hello");
    expect(stringifyToolResult({ a: 1 })).toBe('{"a":1}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(stringifyToolResult(circular)).toBe("[object Object]");
  });
});

describe("truncateToolResultText", () => {
  it("未超限原样返回", () => {
    const text = "短结果";
    expect(truncateToolResultText(text)).toBe(text);
  });

  it("超限截断 + 结构化提示（含原始量级与上限）", () => {
    const text = "汉".repeat(TOOL_RESULT_MAX_TOKENS + 100);
    const truncated = truncateToolResultText(text);
    expect(truncated.length).toBeLessThan(text.length);
    expect(truncated).toContain("已截断");
    expect(truncated).toContain(String(TOOL_RESULT_MAX_TOKENS));
    expect(estimateTokens(truncated)).toBeGreaterThan(TOOL_RESULT_MAX_TOKENS); // 提示文本本身计入
  });
});
