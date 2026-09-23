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
    focus_deduction?: boolean;   // true = 注入「推演节点集合」段（2026-09；大纲组页面悬浮「问 AI」触发）：
                                 //   服务端**现读** project.json 的 deduction_nodes 展开（客户端不传 id 数组——避免第二份可漂移的事实源）；
                                 //   无标记 / 标记全部失效 → 该段静默省略（不报错）；注入形状见 ../design/20-context.md §2
  };
}

// 聚焦上下文展开：服务端把 context 逐项展开为结构化文本、拼在本轮消息之前（查询不到/已软删 → 跳过该项，
// 不报错——客户端可能携带过期 focus）；两项皆无时不注入，消息原文保持干净。

// 对话历史持久化：本会话的消息写入项目目录 sessions/（格式 = pi session v3，见 docs/db/schema.md）；
// 服务重启后携带同一 session_id 即可继续上次对话。

// Res: 404 SESSION_NOT_FOUND —— session_id 已给出但磁盘上不存在（客户端应改为新会话重试）
// Res: 409 CHAT_BUSY —— 当前项目已有在途 chat 流
// Res: 400 LLM_API_KEY_MISSING —— 当前模型所属 provider 未配置凭据
// Res: 409 NO_PROJECT_OPEN —— 无当前项目

// Res: SSE stream（text/event-stream）
// 帧格式统一为 `event: <type>` + `data: <json>`。事件集 = pi AgentSessionEvent 的**轻量投影**
// （服务端剥离 `partial` 大对象并丢弃内部状态事件；具体见下表）。
```

**SSE 事件集**（服务端→客户端）：

| event | data（关键字段） | 说明 |
| :--- | :--- | :--- |
| `session` | `{ session_id }` | **服务端合成**：本流所属会话（新建或续聊），客户端据此持久化「当前会话」 |
| `ping` | `{}` | 心跳（按 `DEFAULT_HEARTBEAT_MS` 的随机区间）：探活 + 断开检测 |
| `agent_start` | `{}` | 本轮开始 |
| `turn_start` | `{}` | 一次模型请求（含其触发的整批工具执行）开始 |
| `message_start` / `message_end` | `{ message: {...}, speed? }` | 消息生命周期（user / assistant / tool 三类均发）；`speed` **仅 assistant 的 `message_end`** 且可用时下发（见 §会话用量字段） |
| `message_update` | `{ assistantMessageEvent: {...} }` | assistant 流式增量：`text_delta` / `thinking_delta` / `toolcall_delta` 等（**已剥离 `partial` 全文对象**；`toolcall_*` 附带 `id` / `toolName` 便于前端提前渲染）。`thinking_end` 的 `content` 降为 `THINKING_PREVIEW_MAX_CHARS` 字预览并附 `contentLength`（全文走按需端点，客户端已从 `thinking_delta` 拿到增量） |
| `tool_execution_start` | `{ toolCallId, toolName, args }` | 工具开始执行 |
| `tool_execution_update` | `{ toolCallId, toolName, partialResult }` | 工具流式进度（可选） |
| `tool_execution_end` | `{ toolCallId, toolName, result: { content, details? }, isError }` | 工具结束；**AUTO 工具的 `details` 不下发**（与 `content` 重复且可能极大）；**PROPOSAL 工具的 `details` 携带提案载荷**（见 §提案确认） |
| `turn_end` | `{ toolResults: [...], contextUsage?: { percent, tokens, contextWindow }, usage? }` | 轮次结束（= 一次模型请求 + 其工具执行全部完成）；`contextUsage` 供占用段、`usage` 供状态栏账目（见 §会话用量字段 + `../design/20-context.md` §2） |
| `compaction_start` / `compaction_end` | `{ reason }` / `{ reason, result?, aborted, willRetry, errorMessage? }` | 上下文自动压缩状态（可展示提示） |
| `auto_retry_start` / `auto_retry_end` | `{ attempt, maxAttempts, delayMs, errorMessage }` / `{ success, attempt, finalError? }` | 自动重试状态（可展示提示） |
| `agent_end` | `{ contextUsage?: {...}, usage?, stopReason?, errorMessage? }` | 本轮最终事件；错误/中止时带 `stopReason`（`error` / `aborted`）与 `errorMessage` |

### 会话用量字段（`usage` / `speed`）

`turn_end` / `agent_end` 帧与 `GET /chat/sessions/:id/messages` 响应**共用同一形状**（服务端唯一实现点 = agent 包 `sessionUsage()`；口径 = pi `AgentSession.getSessionStats()`：assistant 消息 + `toolResult.usage` + `compaction` / `branch_summary` 的 usage 累计）。

`usage`：

| 字段 | 是否必选 | 数据类型 | 取值范围 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| input | 是 | number | ≥ 0 | 非缓存输入 token 累计 |
| output | 是 | number | ≥ 0 | 输出 token 累计（含思考 token） |
| cacheRead | 是 | number | ≥ 0 | 缓存读 token 累计 |
| cacheWrite | 是 | number | ≥ 0 | 缓存写 token 累计（部分 provider 不上报 ⇒ 恒 0） |
| total | 是 | number | ≥ 0 | `input + output + cacheRead + cacheWrite` |
| cost | 是 | number | ≥ 0 | 美元；pi 按模型目录价格累加，**模型无价格配置时恒 0** |
| cacheHitRate | 否 | number | 0..1 | 命中率 = `cacheRead / (input + cacheRead + cacheWrite)`；**分母为 0 时省略该键**；服务端预算（客户端不复算分母口径） |
| subscription | 是 | boolean | | true = 末条 assistant 消息的 provider 属**订阅制凭据** ⇒ `cost` 仅估算，UI 须标明。判定 = pi `ModelRuntime.isUsingSubscription()`（= OAuth 且该家 `auth.oauth.isSubscription`）**或** API-key 认证的订阅家（`kimi-coding`——pi 的该方法要求 OAuth 而判不出它，pi footer 同样靠字面量兜）——**不得用 `isUsingOAuth`**：openrouter / radius 有 OAuth 但按量计费，会被误标 |

`speed`（**仅 assistant 的 `message_end`**；历史接口不带——时序不落盘，无法重建）：

| 字段 | 是否必选 | 数据类型 | 取值范围 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| outputTokens | 是 | number | > 0 | 该条 assistant 消息的 `usage.output` |
| ms | 是 | number | ≥ 最小时长常量 | **首个增量 → `message_end`**（解码期，不含首字延迟） |
| tps | 是 | number | > 0 | `outputTokens / (ms / 1000)` |

**`speed` 不下发的情形**（服务端守卫，四项）：无增量到达（非流式回退）/ `output <= 0` / 生成时长小于最小时长常量 / `stopReason` 为 `error` · `aborted`。

**`contextUsage` 的 `tokens` / `percent` 允许 `null`**（pi 语义：压缩后到下一次模型响应之间占用未知）——该帧照发不丢，客户端按「未知」渲染（占用段显示 `? · 窗口`），**不得因未知而整段静默消失**；`contextWindow` 为正整数时必给。

**过滤约定**（服务端唯一实现点）：

- 所有 `partial` 字段剥离（含完整消息大对象），只转发增量与元数据——否则单帧可达数百 KB。
- 不转发事件表之外的内部状态事件：`entry_appended` / `queue_update` / `session_info_changed` / `thinking_level_changed` / `agent_settled` / `summarization_retry_*` / `bash_execution_update`（UI 无消费方）。
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
    name?: string;           // 会话显示名（pi session_info 条目）
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
      preview: string;          // 前 `THINKING_PREVIEW_MAX_CHARS` 字符预览
      deferred: true;
      blockIndex: number;       // 取全文时的块下标
      length: number;           // 原文字符数（前端展示「已折叠」提示）
    }[];
    toolCalls?: {               // assistant 消息的工具调用数组（元素 = 服务端投影形状 `{ id, name, arguments }`，
      id: string;               // 与 SSE `message_end` 帧**同一份**投影：pi 原生 toolCall 块 `{type:"toolCall",id,name,arguments}` 只去掉 `type`；
      name: string;             // `arguments` 已是对象，**不是** LLM wire 的 JSON 串（客户端渲染走同一归一入口）
      arguments: unknown;
    }[];
    toolCallId?: string | null; // tool 消息关联的调用 id
    createdAt: string;
  }[];
  usage: { ... };              // 会话累计用量（形状见 §会话用量字段；与帧侧同一实现）
}
// 按时间升序；仅当前项目的会话；未知 id → 404 SESSION_NOT_FOUND
// 历史回看不带 speed（时序不落盘，无法重建）；`contextUsage` **只带窗口**（`tokens` / `percent` 为 `null` = 占用未知，不重建；UI 渲染 `? · 窗口`），**无模型时省略该键**（见 ../design/20-context.md §2.1）
```

### GET /api/v1/chat/sessions/:id/messages/:messageId/thinking

按需读取某条 assistant 消息的思维链全文（列表接口只回预览，避免整包下发大 JSON）。

```typescript
// Query
blockIndex: number;           // 必填，非负整数；缺失/非法 → 400 VALIDATION_ERROR；越界/非 thinking 块 → 404 THINKING_NOT_FOUND

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

提案**仅存服务端内存**（TTL = `PROPOSAL_TTL_MS` + 条数上限），随 `tool_execution_end` 帧的 `result.details` 到达前端：`details = { proposal_id, type, preview }`（`propose_*` 工具产出）；`preview` **恒含 `summary`**（一句话摘要），结构化预览字段平铺其上。生命周期与校验规则见 [`../design/30-agent-loop.md`](../design/30-agent-loop.md) §2。

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
