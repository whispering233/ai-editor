// 对话消息 / 会话类型
// 契约来源：doc/api/endpoints.md（chat/sessions）、doc/database/schema.md（chat_messages 表，决策 18）

/** 对话角色（chat_messages 表 role 列，schema.md） */
export type ChatRole = "user" | "assistant" | "tool";

/**
 * 对话消息（endpoints.md chat 消息条目 + schema.md chat_messages 表，决策 18）
 * 续聊重建规则（决策 18 修订）：assistant.tool_calls[].id ↔ tool.tool_call_id 成对重组喂回模型
 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  /** 会话按项目隔离（决策 18 修订） */
  projectId?: string;
  role: ChatRole;
  content?: string | null;
  /** assistant 消息的工具调用数组 */
  toolCalls?: unknown[];
  /** tool 消息关联的 assistant 工具调用 id（决策 18 修订） */
  toolCallId?: string | null;
  createdAt: string; // ISO 8601
}

/** chat_messages 表行（存储形态 snake_case，schema.md） */
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

/** 会话列表项（GET /api/v1/chat/sessions，endpoints.md；按最后活动时间倒序） */
export interface ChatSessionSummary {
  id: string;
  /** 最后一条消息摘要（截断） */
  lastMessage: string;
  messageCount: number;
  createdAt: string;
  /** 最后活动时间 */
  updatedAt: string;
}
