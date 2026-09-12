// 对话与会话类型
//
// 消息/会话条目的命名类型由 api.ts 的 Zod schema 派生（`ChatSessionMessage` / `ChatThinkingPreview` /
// `ChatSessionSummary`）——schema 是契约单一来源，此处只保留角色枚举（schema 与派生类型共同引用）。

/** 对话角色（会话消息的 role 字段） */
export type ChatRole = "user" | "assistant" | "tool";
