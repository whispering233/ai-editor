# Agent 循环与提案详细设计

> **本文档职责**：回答「对话链路怎么跑、失败与压缩归谁管、写操作怎么防脏写入、断连怎么取消」——循环内核、提案生命周期、SSE 取消/心跳、会话重建的约束与理由。
> 事件契约见 `docs/api/80-api-chat.md`；工具契约见 `docs/api/tool-calling.md`；提示词与预算见 `20-context.md`；会话文件格式见 `docs/db/schema.md`。

## 1. 循环内核（pi `AgentSession`）

对话循环不是本仓实现：一次 `POST /chat` = 一次 `AgentSession.prompt()`，循环语义（turn、工具派发、重试、压缩、取消）全部由 pi 接管。

| 语义 | 契约 |
| :--- | :--- |
| turn 口径 | 一次模型请求 + 其触发的整批工具执行（与旧「轮次」一致；一批多个工具调用同属一轮） |
| 工具派发 | 默认并行执行，per-tool 可用 `executionMode: "sequential"` 覆盖；结果按 assistant 消息源顺序回填 |
| 参数校验 | 每批**先全部校验再执行**（pi `validateToolArguments`，TypeBox schema）；失败 → error tool result 喂回自纠，不终止循环 |
| 工具失败 | `execute` 抛错 = 失败（pi 转结构化错误喂回）；工具**不得把失败编码进正常 content** |
| 截断不执行工具 | `stopReason === "length"` 时该消息内全部 tool call 一律不执行、以错误喂回（pi 原生：args 可能「解析通过但不完整」） |
| 循环终止 | 模型自然停止（无 tool call）或工具返回 `terminate`；**无轮次上限**——本地单人工具，失控靠用户 `abort()`/steering 干预 |
| steering / follow-up | pi 队列：运行中投递指令（steering）或排队后续消息（follow-up） |
| 失败重试 | pi auto-retry：指数退避（`maxRetries`、`baseDelayMs`）、`provider.timeoutMs` 单请求超时；**abort 永不重试**；重试耗尽 → 本轮以 error 状态结束（`agent_end`），用户可见 |
| 上下文压缩 | pi auto-compaction（阈值 + 溢出两种触发，真实 usage 基准）；压缩摘要作为 entry 落会话文件，恢复时按摘要 + 保留起点重建（见 `20-context.md` §2） |
| 单条工具结果截断 | 超常量上限 → 截断 + 结构化提示（模型必须感知数据不完整），属降级不属错误 |

**为什么不自建轮次上限/单轮超时**：压缩、重试、取消都是 pi 的职责；再加一层本地计时器只会与服务端心跳、pi 自身超时互相打架（重试与轮次互相消耗）。失控由用户显式 `abort()`/steering 干预。

## 2. 提案生命周期 —— 仅内存

提案（AI 写操作的确认对象）**仅存服务端内存**，随 SSE 事件推送，不落盘：

- **来源**：`propose_*` 工具返回的 `details`（`{ proposal_id, type, preview }`）；事件流里提案随该工具的 `tool_execution_end` 帧到达前端（不再有独立 `proposal` 事件）。
- **TTL 10 分钟 + 条数上限**，超期/超限自动清除；无跨会话恢复（提案是瞬态交互对象）。
- **确认时服务端重新校验**：引用的实体/大纲节点仍存在，且快照一致——实体用自身 `updated_at`、大纲节点用节点级 `updated_at`；校验失败返回 409 `PROPOSAL_STALE`；`proposal_id` 不存在返回 404 `PROPOSAL_NOT_FOUND`。
- **提案绑定项目**：confirm/reject 校验与当前项目一致，不匹配返回 409 `PROPOSAL_PROJECT_MISMATCH`；切换项目时清空全部内存提案并强制结束在途 SSE/agent 循环。
- **确认后执行**：写操作按风险分级（自动/提案确认），确认由 Executor 执行底层写；写序固定「**先 DB 后 JSON**」（跨存储无原子性，启动一致性校验兜底补标，见 §4）。

**为什么**：提案是毫秒级交互对象，落盘与恢复收益为零；「存在性 + `updated_at` 快照比对」双重校验防脏写入；TTL/上限防内存无界增长。确认语义是「笔在用户手里」产品叙事的实现载体。

## 3. SSE 断开全链路取消

浏览器刷新/断网导致 SSE 断开时，服务端通过 AbortController 全链路取消：`AgentSession.abort()` 终止在途模型请求、工具执行与重试退避。

- **三路断开检测**：流 `onAbort` 回调 + 请求 close/error 监听 + 心跳写失败，任一触发即取消。
- **心跳**：每 **15-30 秒**一次 `ping` 事件（空 payload）。
- **未确认提案作废**：SSE 取消或项目切换时按会话全量作废；客户端重连后提示「上次会话已取消」。
- **已知限制**：心跳对 **TCP 半开连接**（客户端断电而非正常关闭）无法即时感知（写进内核缓冲不失败，感知延迟回到 TCP 重传超时，分钟级）；**客户端需自身超时兜底**（如 60s 无任何事件即提示连接断开）。

**为什么**：@hono/node-server 只能靠写失败感知客户端断开；agent 等待模型响应期间可长达一分钟以上无写操作，无心跳则取消延迟不可接受。

## 4. 会话重建与一致性

- **重建**：续聊由 pi `SessionManager` 载入会话文件（含压缩 entry、model/thinking 变更 entry）重建上下文；坏行跳过、不猜不修，读到的前缀即有效历史。
- **会话归属**：会话文件在项目目录 `sessions/` 内，归属由目录表达，不依赖 data.db（随书移动/备份/导入天然携带）。
- **启动一致性校验**：打开项目时比对 outline.json 节点软删标记与 data.db 中 relation/delta 软删状态，**以大纲节点软删为准**补标 DB 侧缺失的 `deleted_at`（单向不变式：节点软删 ⇒ 关联记录必软删）并写日志；反向推断受实体侧级联干扰不可靠，不在补标范围。

**为什么**：两存储无法事务性回滚，故不承诺回滚，改为固定写序 + 一致性校验兜底。
