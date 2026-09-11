# AI 对话与提案确认

> POST /chat SSE 流、会话列表/历史、名称解析 + 提案确认/拒绝。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

## AI 对话

### POST /api/v1/chat

发送消息给 AI，通过 SSE 流式返回。

```typescript
// Req
{
  message: string;              // 用户消息
  session_id?: string;          // 会话 ID，不传则创建新会话
  context?: {
    focus_entity_type?: string;  // 当前聚焦的实体类型（用于上下文组装）
    focus_entity_id?: string;    // 当前聚焦的实体 ID
    focus_node_id?: string;      // 当前聚焦的大纲节点 ID
  };
}

// 对话历史持久化：本会话的消息写入项目目录 `sessions/<session_id>.jsonl`（行格式/容忍规则见 docs/db/schema.md）；
// 服务重启后携带同一 session_id 即可继续上次对话。

// Res: SSE stream
// 消息格式（SSE event stream, text/event-stream）:
//
// event: ping             // 心跳（每 15-30s）：探活 + 断开检测
// data: {}
//
// event: tool_call         // AI 调用了工具
// data: { "tool": "get_entity", "args": {...}, "id": "call_xxx" }
//
// event: tool_result       // 工具执行结果
// data: { "tool": "get_entity", "result": {...}, "id": "call_xxx" }
//
// event: text              // AI 文本回复片段
// data: { "delta": "张三这个角色..." }
//
// event: proposal          // AI 发出提案
// data: { "proposal_id": "prop_xxx", "type": "propose_create_entity", "preview": {...} }
//
// event: done              // 对话轮次结束
// data: { "session_id": "sess_xxx", "usage": {...}, "context_budget": { "history": 150000, "total": 155000 } }
//   usage：本轮真实 token 用量（prompt/completion/total，可缺省）
//   context_budget：本轮**生效预算**（服务端在上下文组装后算出；分母口径，供前端占用条）——
//     history = 生效历史预算（激活模型 contextWindow × context_budget.history_ratio，经总闸 clamp）
//     total   = history + system + 工具清单 + focus 四层之和（= 占用条分母）
//
// event: error
// data: { "code": "...", "message": "..." }
//
// 顺序与生命周期约定（2026-08 修订）：
//   - proposal 事件在对应 tool_result 之后、循环继续之前发送；前端以 proposal 事件渲染提案卡片
//   - error 事件后流立即关闭（客户端收到 error 即终止解析）
//   - 确认/拒绝提案的 HTTP 请求与 SSE 流生命周期解耦：流关闭后确认仍有效（TTL 内）
```

**客户端解析约束**：本端点返回 POST + SSE，浏览器原生 `EventSource` 只支持 GET，客户端必须用 `fetch` + `ReadableStream` 自写 SSE 解析（`client/src/hooks/use-sse.ts`），并处理：跨 chunk 的 `data:` 行拼接、注释行（`:` 开头）跳过、`[DONE]` 哨兵；**心跳期间若有写操作失败即视为连接断开**，触发全链路取消提示。

**取消语义**：SSE 断开（浏览器刷新/断网）即触发全链路取消——服务端通过 AbortController 终止 agent 循环、中止 DeepSeek fetch；未确认提案按会话作废；正在执行的写操作完成当前一步后停止，操作顺序固定「先 DB 后 JSON」，两存储间不一致由**启动一致性校验**兜底补标（以大纲节点软删为准补标关联记录）。断开检测三路并用：`stream.onAbort` + `c.req.raw` 的 close/error 监听 + 心跳写失败。客户端重连后提示「上次会话已取消」。

### GET /api/v1/chat/sessions

获取会话列表（「继续上次对话」入口）。

```typescript
// Res: 200
{
  sessions: {
    id: string;              // session_id
    lastMessage: string;     // 最后一条消息摘要（截断）
    messageCount: number;
    createdAt: string;
    updatedAt: string;       // 最后活动时间
  }[];
}
// 按最后活动时间倒序；仅返回当前项目的会话（按 project_id 隔离）
```

### GET /api/v1/chat/sessions/:id/messages

获取指定会话的消息历史（供 UI 恢复聊天记录）。

```typescript
// Path
id: string;                  // session_id

// Res: 200
{
  sessionId: string;
  messages: {
    id: string;
    role: "user" | "assistant" | "tool";
    content?: string | null;
    toolCalls?: unknown[];    // assistant 消息的工具调用数组
    toolCallId?: string | null;  // tool 消息关联的调用 id
    createdAt: string;
  }[];
}
// 按 created_at 升序；仅返回当前项目的会话
```

### DELETE /api/v1/chat/sessions/:id

物理删除一个会话（无回收站、不可恢复；前端需二次确认）。

```typescript
// Path
id: string;                  // session_id（硬校验 ^sess_[A-Za-z0-9_-]{1,64}$）

// Res: 200
{ deleted: true }

// Res: 400 VALIDATION_ERROR —— id 形态非法（同时是文件名校验：防路径穿越）
//   注：含 `/` 的 id 由 Hono 路由层直接 404（不达处理器，无文件系统触点）
// Res: 404 SESSION_NOT_FOUND —— 该会话文件不存在
// Res: 409 SESSION_BUSY —— 该会话有在途 SSE 流（防止 append 把文件原地重建出「僵尸会话」）
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
  // 不存在 / 已软删 / 未知前缀 / 运行时对象（prop_/sess_/call_）→ null（前端省略该字段或回退）
}
```

**前缀分流**（id 约定见本节开头）：`char-`/`set-`/`loc-`/`hook-` → entities 表（label = 类型中文，name = name 列）；`ev-` → 时间轴事件（label = 事件，name = name 列）；`tp-` → 时间点（label = 时间点，name = name 列）；`ref-` → 参考资料（label = 参考资料，name = 标题）；`vol-`/`ch-`/`sc-` → outline.json 节点（label = 卷/章/场景，name = 标题）；`rel-` → 关系（**无名称语义 → null**）；其余（含 `proj-`、`prop_`/`sess_`/`call_`）→ null。响应 key 集合 = 请求 ids 去重后的全集（每个 id 必有条目，未命中 = null）。
```

---

## 提案确认

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

// Res: 409 — 提案过期
// 确认时服务端重新校验提案引用的实体/大纲节点仍存在且快照一致；
// 校验失败返回 { code: "PROPOSAL_STALE" }，前端提示重新生成提案。

// Res: 404
{ error: { code: "PROPOSAL_NOT_FOUND" } }  // proposal_id 不存在（已过期清除/SSE 断开作废）

// Res: 409
{ error: { code: "PROPOSAL_PROJECT_MISMATCH" } }
// 提案所属项目 ≠ 当前项目（切换项目时提案已清空，此为防御性校验）
```

### POST /api/v1/proposal/:proposalId/reject

用户拒绝提案。

```typescript
// Path
proposalId: string;

// Res: 200
{
  rejected: true;
}
```

---
