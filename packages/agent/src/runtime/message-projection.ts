// pi 运行时：消息 → 线协议投影（SSE 帧与历史回看共用同一份投影）
//
// 为什么单独一层：
// 1. thinking 全文可能极长，而流式期间已由 `thinking_delta` 下发过——帧/历史里只给
//    「预览 + 可拉取标记」，全文走按需端点（契约见 docs/api/80-api-chat.md）。
// 2. 抹平 pi 的原始消息形态（content blocks / toolResult / usage / api 元数据），
//    让 client 只面对文档登记过的字段（role/content/thinking/toolCalls/toolCallId/isError/createdAt）。
//
// 未知角色（pi 的 custom / bashExecution / branchSummary / compactionSummary 等）返回 null：
// 文档的事件表只登记 user / assistant / tool 三类，多出来的角色没有消费方。

import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";

/** 思维链预览长度（与 pi-web 同口径：240 字符） */
export const THINKING_PREVIEW_MAX_CHARS = 240;

/** 思维链投影（列表/帧里只给预览；`deferred: true` 表示全文需按需拉取） */
export interface ThinkingPreviewProjection {
  /** 前 240 字符预览（首行截取后 trimEnd） */
  preview: string;
  deferred: true;
  /** 原消息 content 数组中的块下标（取全文时的定位参数） */
  blockIndex: number;
  /** 原文字符数（前端展示「已折叠 N 字」） */
  length: number;
}

/** 工具调用投影（assistant 消息内） */
export interface WireToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

/** 线协议消息投影（SSE 帧与历史接口共用；`id` 由历史层按 entry 补，不在此层） */
export interface WireMessage {
  role: "user" | "assistant" | "tool";
  /** 可见文本（assistant = text 块拼接；thinking 不在此字段） */
  content: string;
  /** assistant 消息的思维链投影（仅非空块） */
  thinking?: ThinkingPreviewProjection[];
  /** assistant 消息的工具调用 */
  toolCalls?: WireToolCall[];
  /** tool 消息关联的调用 id */
  toolCallId?: string;
  /** tool 消息是否失败 */
  isError?: boolean;
  /** ISO 8601（pi 消息的毫秒时间戳） */
  createdAt: string;
}

/** 思维链预览：截首行 + 截断到 240 字符（同行首 240 字符，超长行同样截断） */
export function getThinkingPreview(thinking: string): string {
  return thinking.trimStart().match(/^[^\r\n]{0,240}/u)?.[0].trimEnd() ?? "";
}

/** 单块 thinking → 预览投影 */
export function projectThinkingBlock(block: ThinkingContent, blockIndex: number): ThinkingPreviewProjection {
  return {
    preview: getThinkingPreview(block.thinking),
    deferred: true,
    blockIndex,
    length: block.thinking.length,
  };
}

/** 文本提取：string 原样；块数组只取 text 块（图片等非文本内容不进 content） */
export function extractText(content: string | readonly (TextContent | { type: string; text?: string })[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is TextContent => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

/** 毫秒时间戳 → ISO 8601（缺省防御：无 timestamp 用当前时刻） */
function toIso(timestamp: number | undefined): string {
  return new Date(typeof timestamp === "number" ? timestamp : Date.now()).toISOString();
}

/** user 消息投影 */
export function projectUserMessage(message: UserMessage): WireMessage {
  return { role: "user", content: extractText(message.content), createdAt: toIso(message.timestamp) };
}

/** assistant 消息投影（thinking 降预览、toolCall 拆到 toolCalls） */
export function projectAssistantMessage(message: AssistantMessage): WireMessage {
  const thinking: ThinkingPreviewProjection[] = [];
  const toolCalls: WireToolCall[] = [];
  message.content.forEach((block, index) => {
    if (block.type === "thinking") {
      // 空思维链（含被安全过滤的 redacted 块）不投影：预览为空串没有信息量，且 length 会误导
      if (block.thinking.trim() === "") return;
      thinking.push(projectThinkingBlock(block, index));
      return;
    }
    if (block.type === "toolCall") {
      toolCalls.push({ id: block.id, name: block.name, arguments: block.arguments });
    }
  });
  return {
    role: "assistant",
    content: extractText(message.content),
    ...(thinking.length === 0 ? {} : { thinking }),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
    createdAt: toIso(message.timestamp),
  };
}

/** tool 消息投影 */
export function projectToolResultMessage(message: ToolResultMessage): WireMessage {
  return {
    role: "tool",
    content: extractText(message.content),
    toolCallId: message.toolCallId,
    isError: message.isError,
    createdAt: toIso(message.timestamp),
  };
}

/**
 * 任意 pi 消息 → 线协议投影；未知角色返回 null（调用方据此丢弃该帧）。
 * 判定按 role 分支（不用 instanceof——消息可能来自反序列化的会话文件，原型链不可靠）。
 */
export function projectMessageForWire(message: unknown): WireMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const role = (message as { role?: unknown }).role;
  if (role === "user") return projectUserMessage(message as UserMessage);
  if (role === "assistant") return projectAssistantMessage(message as AssistantMessage);
  if (role === "toolResult") return projectToolResultMessage(message as ToolResultMessage);
  return null;
}

/** tool 块的类型引用（toolCalls 投影用；导出供调用方类型标注） */
export type WireToolCallBlock = ToolCall;
