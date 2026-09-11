# AI 对话与提案确认

> POST /chat SSE 流、会话列表/历史、名称解析 + 提案确认/拒绝。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 事件语义（谁的循环、谁的重试、取消链路）见 [`../design/30-agent-loop.md`](../design/30-agent-loop.md)；提示词与 AGENTS.md 注入见 [`../design/20-context.md`](../design/20-context.md)。

## AI 对话

### POST /api/v1/chat

发送消息给 AI，通过 SSE 流式返回。

```typescript
// Req
{
  message: string;              // 用户消息
  session_id?: string;          // 会话 ID（pi session id）；不传则新建会话
  context?: {
    focus_entity_type?: string;  // 当前聚焦的实体类型（注入本轮上下文）
    focus_entity_id?: string;    // 当前聚焦的实体 ID
    focus_node_id?: string;      // 当前聚焦的大纲节点 ID
  };
}

// 对话历史持久化：本会话的消息写入项目目录 sessions/（格式 = pi session v3，见 docs/db/schema.md）；
// 服务重启后携带同一 session_id 即可继续上次对话。

// Res: SSE stream（text/event-stream）
// 帧格式统一为 `event: <type>` + `data: <json>`。事件集 = pi AgentSessionEvent 的**轻量投影**
// （服务端剥离 `partial` 大对象并丢弃内部状态事件；具体见下表）。
```

**SSE 事件集**（服务端→客户端）：

| event | data（关键字段） | 说明 |
| :--- | :--- | :--- |
| `session` | `{ session_id }` | **服务端合成**：本流所属会话（新建或续聊），客户端据此持久化「当前会话」 |
| `ping` | `{}` | 心跳（每 15-30s）：探活 + 断开检测 |
| `agent_start` | `{}` | 本轮开始 |
| `turn_start` | `{}` | 一次模型请求（含其触发的整批工具执行）开始 |
| `message_start` / `message_end` | `{ message: {...} }` | 消息生命周期（user / assistant / tool 三类均发） |
| `message_update` | `{ assistantMessageEvent: {...} }` | assistant 流式增量：`text_delta` / `thinking_delta` / `toolcall_delta` 等（**已剥离 `partial` 全文对象**；`toolcall_*` 附带 `id` / `toolName` 便于前端提前渲染） |
| `tool_execution_start` | `{ toolCallId, toolName, args }` | 工具开始执行 |
| `tool_execution_update` | `{ toolCallId, toolName, partialResult }` | 工具流式进度（可选） |
| `tool_execution_end` | `{ toolCallId, toolName, result: { content, details? }, isError }` | 工具结束；**AUTO 工具的 `details` 不下发**（与 `content` 重复且可能极大）；**PROPOSAL 工具的 `details` 携带提案载荷**（见 §提案确认） |
| `turn_end` | `{ toolResults: [...], contextUsage?: { percent, tokens, contextWindow } }` | 轮次结束；`contextUsage` 供占用条（见 `../design/20-context.md` §2） |
| `compaction_start` / `compaction_end` | `{ reason }` / `{ reason, result?, aborted, willRetry, errorMessage? }` | 上下文自动压缩状态（可展示提示） |
| `auto_retry_start` / `auto_retry_end` | `{ attempt, maxAttempts, delayMs, errorMessage }` / `{ success, attempt, finalError? }` | 自动重试状态（可展示提示） |
| `agent_end` | `{ contextUsage?: {...}, stopReason?, errorMessage? }` | 本轮最终事件；错误/中止时带 `stopReason`（`error` / `aborted`）与 `errorMessage` |

**过滤约定**（服务端唯一实现点）：

- 所有 `partial` 字段剥离（含完整消息大对象），只转发增量与元数据——否则单帧可达数百 KB。
- 不转发 `entry_appended` / `queue_update` / `session_info_changed` / `thinking_level_changed`（内部状态，UI 无消费方）。
- AUTO 工具的 `result.details` 不下发（内容与 `content` 重复、可能达数百 KB）；仅 PROPOSAL 工具的 `details`（提案载荷）随帧下发。

**客户端解析约束**：本端点返回 POST + SSE，浏览器原生 `EventSource` 只支持 GET，客户端必须用 `fetch` + `ReadableStream` 自写 SSE 解析（client），并处理：跨 chunk 的 `data:` 行拼接、注释行（`:` 开头）跳过、多行 data 合并。

**取消语义**：SSE 断开（浏览器刷新/断网）即触发全链路取消——服务端 `AgentSession.abort()` 终止在途模型请求、工具执行与重试退避；未确认提案按会话作废。断开检测三路并用：`stream.onAbort` + `c.req.raw` 的 close/error 监听 + 心跳写失败。客户端重连后提示「上次会话已取消」，并建议 60s 无事件即自行判定断连。

**并发约束**：单项目同一时刻只允许一个在途 chat 流（前端保证；服务端对同项目已有在途流返回 409 `CHAT_BUSY`）。

### GET /api/v1/chat/sessions

获取会话列表（「继续上次对话」入口）。

```typescript
// Res: 200
{
  sessions: {
    id: string;              // 会话 ID（pi session id）
    lastMessage: string;     // 最后一条可见文本摘要（截断）
    messageCount: number;
    createdAt: string;       // ISO 8601（会话 header 时间戳）
    updatedAt: string;       // 最后活动时间
  }[];
}
// 按 updatedAt 倒序；仅当前项目的 sessions/ 目录；旧格式（v1）文件自动被 pi 的发现逻辑跳过
```

### GET /api/v1/chat/sessions/:id/messages

获取指定会话的消息历史（供 UI 恢复聊天记录）。

```typescript
// Path
id: string;                  // 会话 ID（不透明值；服务端经磁盘发现 + header id 映射解析，禁止拼接路径）

// Res: 200
{
  sessionId: string;
  messages: {
    id: string;                 // 消息条目 id
    role: "user" | "assistant" | "tool";
    content?: string | null;    // 可见文本（thinking 不在此字段）
    thinking?: {                // assistant 消息的思维链投影（仅预览 + 标记，全文走独立端点）
      preview: string;          // 前 240 字符预览
      deferred: true;
      blockIndex: number;       // 取全文时的块下标
      length: number;           // 原文字符数（前端展示「已折叠」提示）
    }[];
    toolCalls?: unknown[];      // assistant 消息的工具调用数组
    toolCallId?: string | null; // tool 消息关联的调用 id
    createdAt: string;
  }[];
}
// 按时间升序；仅当前项目的会话；未知 id → 404 SESSION_NOT_FOUND
```

### GET /api/v1/chat/sessions/:id/messages/:messageId/thinking

按需读取某条 assistant 消息的思维链全文（列表接口只回预览，避免整包下发大 JSON）。

```typescript
// Query
blockIndex: number;           // 必填，非负整数；越界/非 thinking 块 → 404 THINKING_NOT_FOUND

// Res: 200
{ thinking: string }
```

### DELETE /api/v1/chat/sessions/:id

物理删除一个会话（无回收站、不可恢复；前端需二次确认）。

```typescript
// Path
id: string;                  // 会话 ID

// Res: 200
{ deleted: true }

// Res: 404 SESSION_NOT_FOUND —— 会话不存在（含 id 未知/旧格式文件）
// Res: 409 SESSION_BUSY —— 该会话有在途 SSE 流
```

### POST /api/v1/names/resolve

批量名称解析（工具调用展示人类可读化）。把工具参数中的 id 解析为人类可读名称，供前端渲染摘要行（不暴露裸 id）。**解析收敛服务端单点**——按 id 前缀分流查库，不依赖调用方预知类型。

```typescript
// Req
{
  ids: string[];   // 待解析 id 列表（去重、上限 50；非法形状 400 VALIDATION_ERROR）
}

// Res: 200
{
  names: Record<string, { label: string; name: string } | null>;
  // label = 类型中文（人物/设定/地点/伏笔/卷/章/场景/参考资料/时间点…），name = 实体名/节点标题
  // 不存在 / 已软删 / 未知前缀 / 运行时对象（prop_/call_）→ null（前端省略该字段或回退）
}
```

**前缀分流**：`char-`/`set-`/`loc-`/`hook-` → entities 表；`ev-` → 事件（label = 事件）；`tp-` → 时间点；`ref-` → 参考资料（label = 参考资料，name = 标题）；`vol-`/`ch-`/`sc-` → outline.json 节点；`rel-` → 关系（**无名称语义 → null**）；其余（含 `proj-`、`prop_`、会话 id、toolCallId）→ null。响应 key 集合 = 请求 ids 去重后的全集（每个 id 必有条目，未命中 = null）。

---

## 提案确认

提案**仅存服务端内存**（TTL 10 分钟 + 条数上限），随 `tool_execution_end` 帧的 `result.details` 到达前端：`details = { proposal_id, type, preview }`（`propose_*` 工具产出）。生命周期与校验规则见 [`../design/30-agent-loop.md`](../design/30-agent-loop.md) §2。

### POST /api/v1/proposal/:proposalId/confirm

用户确认提案。

```typescript
// Path
proposalId: string;

// Res: 200
{
  confirmed: true;
  result: unknown;              // 执行结果（如新创建的 entity id）
}

// Res: 409 PROPOSAL_STALE —— 确认时快照校验失败（引用对象已变更/不存在）
// Res: 404 PROPOSAL_NOT_FOUND —— proposal_id 不存在（已过期清除/SSE 断开作废）
// Res: 409 PROPOSAL_PROJECT_MISMATCH —— 提案所属项目 ≠ 当前项目（防御性校验）
```

### POST /api/v1/proposal/:proposalId/reject

用户拒绝提案。

```typescript
// Path
proposalId: string;

// Res: 200
{ rejected: true }
```

---
