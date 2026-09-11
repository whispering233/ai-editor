// K3 消息投影测试：pi 消息 → 线协议投影（thinking 降预览、未知角色丢弃）
//
// 覆盖面：
// - user/assistant/tool 三类角色的投影字段与文本提取
// - thinking 只给预览（240 字 + 定位参数 blockIndex/length），空思维链不投影
// - 未知角色（custom/bashExecution/compactionSummary…）返回 null（帧层据此丢弃）
// - 图片等非文本内容不进 content

import { describe, expect, it } from "vitest";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import {
  extractText,
  getThinkingPreview,
  projectAssistantMessage,
  projectMessageForWire,
  projectThinkingBlock,
  THINKING_PREVIEW_MAX_CHARS,
} from "./message-projection.js";

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

describe("extractText", () => {
  it("字符串原样返回", () => {
    expect(extractText("正文")).toBe("正文");
  });

  it("块数组只取 text 块（图片与非文本块不进 content）", () => {
    expect(
      extractText([
        { type: "text", text: "前" },
        { type: "image", data: "base64", mimeType: "image/png" },
        { type: "text", text: "后" },
      ]),
    ).toBe("前后");
  });
});

describe("getThinkingPreview", () => {
  it("截首行并 trim 首尾空白", () => {
    expect(getThinkingPreview("  第一行\n第二行")).toBe("第一行");
  });

  it("超长单行截断到 240 字符", () => {
    const long = "字".repeat(500);
    const preview = getThinkingPreview(long);
    expect(preview).toHaveLength(THINKING_PREVIEW_MAX_CHARS);
    expect(preview).toBe("字".repeat(THINKING_PREVIEW_MAX_CHARS));
  });

  it("空串 → 空串（不抛错）", () => {
    expect(getThinkingPreview("")).toBe("");
  });
});

describe("projectThinkingBlock", () => {
  it("投影 preview/deferred/blockIndex/length", () => {
    expect(projectThinkingBlock({ type: "thinking", thinking: "推理" }, 2)).toEqual({
      preview: "推理",
      deferred: true,
      blockIndex: 2,
      length: 2,
    });
  });
});

describe("projectUserMessage", () => {
  it("字符串 content + ISO 时间戳", () => {
    const message: UserMessage = { role: "user", content: "你好", timestamp: 1_700_000_000_000 };
    expect(projectMessageForWire(message)).toEqual({
      role: "user",
      content: "你好",
      createdAt: "2023-11-14T22:13:20.000Z",
    });
  });
});

describe("projectAssistantMessage", () => {
  it("文本、思维链预览、工具调用分字段；thinking 全文不进 content", () => {
    const message = assistant([
      { type: "thinking", thinking: "先看大纲" },
      { type: "text", text: "我查一下" },
      { type: "toolCall", id: "call-1", name: "get_outline", arguments: { deep: true } },
    ]);
    expect(projectAssistantMessage(message)).toEqual({
      role: "assistant",
      content: "我查一下",
      thinking: [{ preview: "先看大纲", deferred: true, blockIndex: 0, length: 4 }],
      toolCalls: [{ id: "call-1", name: "get_outline", arguments: { deep: true } }],
      createdAt: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it("无思维链/无工具调用时不带这两个键（帧体积最小）", () => {
    const projected = projectAssistantMessage(assistant([{ type: "text", text: "结论" }]));
    expect(projected).not.toHaveProperty("thinking");
    expect(projected).not.toHaveProperty("toolCalls");
  });

  it("空思维链块（redacted/空串）不投影，且不影响其它块的 blockIndex", () => {
    const message = assistant([
      { type: "thinking", thinking: "   ", redacted: true },
      { type: "text", text: "答案" },
      { type: "thinking", thinking: "第二段推理" },
    ]);
    const projected = projectAssistantMessage(message);
    expect(projected.thinking).toEqual([
      { preview: "第二段推理", deferred: true, blockIndex: 2, length: 5 },
    ]);
  });

  it("超长思维链只给 240 字预览，length 记录原文字数", () => {
    const long = "推".repeat(1000);
    const projected = projectAssistantMessage(assistant([{ type: "thinking", thinking: long }]));
    expect(projected.thinking?.[0]?.preview).toHaveLength(240);
    expect(projected.thinking?.[0]?.length).toBe(1000);
    expect(JSON.stringify(projected)).not.toContain(long);
  });
});

describe("projectToolResultMessage", () => {
  it("role 投影为 tool，带 toolCallId 与 isError", () => {
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call-9",
      toolName: "get_outline",
      content: [{ type: "text", text: "{\"children\":[]}" }],
      isError: false,
      timestamp: 1_700_000_000_000,
    };
    expect(projectMessageForWire(message)).toEqual({
      role: "tool",
      content: "{\"children\":[]}",
      toolCallId: "call-9",
      isError: false,
      createdAt: "2023-11-14T22:13:20.000Z",
    });
  });
});

describe("projectMessageForWire 未知角色", () => {
  it.each([
    ["custom", { role: "custom", customType: "compaction", content: "摘要", display: true, timestamp: 1 }],
    ["bashExecution", { role: "bashExecution", command: "ls", output: "", cancelled: false, truncated: false }],
    ["compactionSummary", { role: "compactionSummary", summary: "摘要", tokensBefore: 1 }],
    ["缺 role", {}],
    ["null", null],
    ["非对象", "字符串"],
  ])("%s → null（帧层丢弃）", (_label, message) => {
    expect(projectMessageForWire(message)).toBeNull();
  });
});
