// 对话消息 / 会话类型

/** 对话角色（会话 JSONL 消息行的 role 字段） */
export type ChatRole = "user" | "assistant" | "tool";

/**
 * 对话消息（chat 端点响应条目 + sessions/*.jsonl 消息行）
 * 续聊重建规则：assistant.tool_calls[].id ↔ tool.tool_call_id 成对重组喂回模型
 */
export interface ChatMessage {
  id: string;
  sessionId: string;
 /** 会话按项目隔离 */
  projectId?: string;
  role: ChatRole;
  content?: string | null;
 /** assistant 消息的工具调用数组 */
  toolCalls?: unknown[];
 /** tool 消息关联的 assistant 工具调用 id */
  toolCallId?: string | null;
  createdAt: string; // ISO 8601
}

/** 会话消息的存储形态行（snake_case；由 db 包 sessions.ts 读写） */
export interface ChatMessageRow {
  id: string;
  session_id: string;
  project_id: string;
  role: ChatRole;
  content: string | null;
 /** JSON 列解析后的数组 */
  tool_calls: unknown[] | null;
  tool_call_id: string | null;
  created_at: string;
}

/** 会话列表项（GET /api/v1/chat/sessions；按最后活动时间倒序） */
export interface ChatSessionSummary {
  id: string;
 /** 最后一条消息摘要（截断） */
  lastMessage: string;
  messageCount: number;
  createdAt: string;
 /** 最后活动时间 */
  updatedAt: string;
}
