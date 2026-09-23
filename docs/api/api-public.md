# 公共请求 / 响应约定（api-public）

> 全部 REST 端点与 SSE 流遵守本节公共约定；各端点差异见模块文档。请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`（Zod schema，前后端共用）；校验**仅在服务端执行**，client 只消费推断类型与常量。

## 基础

- 前缀 `/api/v1`，REST 风格，由 Hono 实现（dev 态 Vite proxy 转发 `/api` → dev 分段起点，即 shared `PORT_RANGES.dev`；分段语义见 `../design/build.md` §端口策略）。
- 请求体 JSON；成功响应 `{ success: true, data: T }`；错误响应 `{ success: false, error: { code, message } }`。
- HTTP 状态码约定：200 成功 / 201 创建 / 400 参数错误（`VALIDATION_ERROR` 等）/ 404 不存在 / 409 冲突 / 500 服务端错误。
- 错误码统一枚举 `ErrorCode`（见 [error-code.md](./error-code.md)），REST 响应与工具结果使用；SSE 流内错误以 `agent_end` 帧表达（不再发 `error` 事件）。
- 显式例外：导出 zip（`GET /project/export`）响应二进制 `application/zip`，不走 `{ success, data }` 包裹。
- **探活**：`GET /api/v1/health` → `{ success: true, data: { status: "ok" } }`（不依赖项目上下文，供启动/就绪探测）。

## 命名约定

- 请求体 / 查询参数 **snake_case**，响应体 **camelCase**；outline.json 内部字段 snake_case。
- **嵌套 `data` 对象内部字段原样透传**（保持 snake_case，如 `expected_payoff`）——camelCase 映射仅应用于 API 顶层契约字段。
- 文件字段 ↔ API 字段的显式映射函数定义于 `@whispering233/ai-editor-shared/utils`。

## id 约定

`{前缀}-{nanoid}`（示例 `char-9f3k2m`；文档示例 `char-9` 等为形状示意，**非自增序号**）：

| 前缀 | 对象 |
| :--- | :--- |
| `char-`/`set-`/`loc-`/`hook-`/`ev-`/`tp-`/`ref-` | 实体（人物/设定/地点/伏笔/事件/时间点/参考资料） |
| `sc-`/`ch-`/`vol-` | 大纲节点（场景/章/卷） |
| `rel-` | 关系 |
| `proj-` | 项目 |
| `prop_`/`call_` | 运行时对象（提案/工具调用） |
| 会话 id | pi 生成的不透明字符串（非 `{前缀}-{nanoid}` 体系）——仅供端点参数使用，不作文件名拼接 |

## 时间约定

所有时间字段统一 ISO 8601 字符串，由应用层写入（不使用 SQLite `datetime('now')`）——回收站按 `deleted_at` 排序需跨 SQLite 与 outline.json 统一格式。

## 类型定义

各模块文档的 `Req` / `Res` 类型对应 `@whispering233/ai-editor-shared` `types/api.ts` 的 Zod schema。

## 请求来源校验（服务端）

- 服务默认绑定 `127.0.0.1`，不对外网开放；全部请求（含读）校验来源：`Origin` 头存在时校验其 host ∈ {`127.0.0.1`, `localhost`, `::1`}；Origin 缺失（地址栏直接导航）时退化校验 `Host` 头同白名单。两者皆拒则拒绝——防 CSRF / DNS rebinding。
- **不校验端口**：生产态端口占用自动 +1 可变；dev 态 Vite proxy 转发后 Origin/Host 端口为 5173，校验端口会误杀开发请求。

## SSE 流（POST /api/v1/chat）

- 端点本身是 **POST + SSE**（`text/event-stream`），浏览器原生 `EventSource` 只支持 GET——客户端用 `fetch` + `ReadableStream` 自写 SSE 解析。
- 事件集 = pi `AgentSessionEvent` 的轻量投影（剥离 `partial`，丢弃内部状态事件）：`session`（服务端合成的会话帧）/ `ping` / `agent_start` / `turn_start` / `message_start` / `message_update` / `message_end` / `tool_execution_start` / `tool_execution_update` / `tool_execution_end` / `turn_end` / `compaction_start` / `compaction_end` / `auto_retry_start` / `auto_retry_end` / `agent_end`；字段与语义见 [80-api-chat.md](./80-api-chat.md)。
