// 末条可见文本（会话列表摘要 → 客户端会话标题）的纯函数口径
//
// 触发本测试的缺陷（ui-verifier 像素走查实录）：会话标题栏出现工具结果 JSON
// `{"author_id":"jiangnan","author_name":"江南",…}`——以工具调用收尾的轮次（练习点评 / 出题、
// 小说侧提案类工具）会把工具输出当成「末条可见文本」。
// 契约：`docs/api/80-api-chat.md`（会话列表 `lastMessage` = 最后一条**非工具**可见文本摘要）。
import { describe, expect, it } from "vitest";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "./sessions.js";
import { lastVisibleSessionText } from "./sessions.js";

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function userMessage(content: string): UserMessage {
  return { role: "user", content, timestamp: 1_700_000_000_000 };
}

function assistantText(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "faux",
    model: "faux-1",
    usage: USAGE,
    stopReason: "stop",
    timestamp: 1_700_000_000_000,
  };
}

function assistantToolCall(name: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name, arguments: {} }],
    api: "openai-completions",
    provider: "faux",
    model: "faux-1",
    usage: USAGE,
    stopReason: "toolUse",
    timestamp: 1_700_000_000_000,
  };
}

function toolResult(content: string): ToolResultMessage {
  return {
    role: "toolResult",
    content,
    toolCallId: "call-1",
    isError: false,
    timestamp: 1_700_000_000_000,
  };
}

/** 造 pi 会话条目（只关心 message 型；类型细节用 cast 抹平，本文件只钉投影口径） */
function entry(id: string, message: unknown): SessionEntry {
  return { type: "message", id, message } as unknown as SessionEntry;
}

describe("lastVisibleSessionText（末条可见文本，列表摘要 / 会话标题用）", () => {
  it("以工具结果收尾的轮次 → 取工具之前的那条文本（**不**返回工具 JSON）", () => {
    const json = '{"author_id":"jiangnan","author_name":"江南","customized":false}';
    const entries = [
      entry("e1", userMessage("请点评我的自由练习稿")),
      entry("e2", assistantToolCall("get_style_notes")),
      entry("e3", toolResult(json)),
    ];
    expect(lastVisibleSessionText(entries)).toBe("请点评我的自由练习稿");
  });

  it("assistant 正文在工具调用之后落盘 → 取该正文（同一轮先工具后结论的形态）", () => {
    const entries = [
      entry("e1", userMessage("请点评我的仿写稿")),
      entry("e2", assistantToolCall("submit_style_feedback")),
      entry("e3", toolResult('{"saved":true,"dimension_count":3}')),
      entry("e4", assistantText("已按三个维度给出点评。")),
    ];
    expect(lastVisibleSessionText(entries)).toBe("已按三个维度给出点评。");
  });

  it("整个会话只有工具消息 → 空串（上层渲染成「（空会话）」，不显示工具 JSON）", () => {
    const entries = [entry("e1", toolResult('{"saved":true}'))];
    expect(lastVisibleSessionText(entries)).toBe("");
  });

  it("跳过空文本与未知角色条目，继续向前找（非 message 条目也不参与）", () => {
    const entries = [
      entry("e1", userMessage("第一句")),
      entry("e2", assistantText("   ")),
      { type: "custom", id: "e3", customType: "x", data: {} } as unknown as SessionEntry,
      entry("e4", assistantText("最后一句")),
    ];
    expect(lastVisibleSessionText(entries)).toBe("最后一句");
  });
});
