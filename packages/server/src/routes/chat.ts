// 对话路由（U3 切片 1 + S7.6）：GET /api/v1/chat/sessions、GET /api/v1/chat/sessions/:id/messages、
//   POST /api/v1/chat（POST + SSE 对话端点，切片 7 最后一张卡）
//
// 契约来源：
//   - doc/api/endpoints.md 第 752-803 行（POST /api/v1/chat 整节：Req { message, session_id?,
//     context? }；SSE 事件 ping/tool_call/tool_result/text/proposal/done/error 与 data 形态；
//     顺序与生命周期约定——proposal 在对应 tool_result 后、循环继续前，error 后流立即关闭，
//     确认/拒绝提案与 SSE 生命周期解耦；客户端解析约束——POST+SSE，EventSource 不支持）
//   - doc/design/decisions.md 决策 16（SSE 断开全链路取消：AbortController 终止 agent 循环、
//     中止 DeepSeek fetch；未确认提案按产生它的会话作废——本文件 B2 取舍见 cancel 后注释）、
//     决策 17（key 来源：环境变量 DEEPSEEK_API_KEY > ~/.ai-editor/config.json，settings.ts
//     的 effectiveApiKey 解析）、决策 18（chat_messages 持久化：用户/assistant/tool 消息落库、
//     tool_calls/tool_call_id 配对列）、决策 20（心跳 15-30s + 三路断开检测 + 半开连接限制）
//   - S7.3 run.ts（runAgent 输入输出契约：produce 闭包转发 onEvent 给 chatStream、失败 resolve
//     不 throw；onMessages 每轮输出 [assistant, ...tool 结果]，用户消息自行持久化；AgentEvent
//     六类事件 + turn_start——本文件只转 SSE 帧、不产生事件）
//   - S7.4 executor.ts（createToolDispatcher 真实现；提案仓 defaultProposalStore）
//   - S6.1 llm client.ts（chatStream：tools 需 OpenAI function schema 格式）
//   - S6.3-S6.6 registry.ts（listTools 32 个 AUTO+PROPOSAL 工具；执行类不注册不暴露——
//     本文件 zod schema → JSON Schema 转换，zod 4 内置 toJSONSchema，无新依赖）
//
// 语义约定：
//   - 无当前项目 → 409 NO_PROJECT_OPEN（requireCurrentProject，与其他业务路由一致）
//   - 请求体校验失败 → 400 VALIDATION_ERROR（JSON，非 SSE——校验在开流之前）
//   - 未配置 DeepSeek key → 400 LLM_API_KEY_MISSING（决策 17；同样在开流之前，JSON）
//   - session_id 提供 → 按项目加载历史重建 SessionState（跨项目 session_id 加载为空数组——
//     与 GET /messages 的「不泄露存在性」语义一致，新消息按当前项目写入）
//   - session_id 缺省 → generateRuntimeId("session") 新建 sess_ 会话（endpoints.md id 约定）
//
// 可测试性：路由经 createChatRoutes(deps) 工厂构造——测试注入 mock produce/dispatcher/心跳/
// 时间/提案仓，避免真实 DeepSeek 调用与全局单例污染；index.ts 挂载默认实例 chatRoutes。

import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { toJSONSchema, type z } from "zod";
import {
  createToolDispatcher,
  defaultProposalStore,
  restoreSession,
  runAgent,
  type AgentEvent,
  type ProposalStore,
  type RunAgentDeps,
  type SessionMessage,
  type SessionState,
  type ToolDispatcher,
} from "@whispering233/ai-editor-agent";
import { chatStream } from "@whispering233/ai-editor-llm";
import type { AbortSignalLike, LLMMessage, LLMStreamEvent, LLMToolDefinition } from "@whispering233/ai-editor-llm";
import { listTools, type ToolDefinition } from "@whispering233/ai-editor-tools";
import {
  findOutlineNode,
  getEntity,
  insertChatMessage,
  listMessageRows,
  listMessages,
  listSessions,
  nowIso,
  readOutlineFile,
} from "@whispering233/ai-editor-db";
import type { ChatMessage, ChatSessionSummary } from "@whispering233/ai-editor-shared";
import { TOOL_PERMISSION, generateRuntimeId } from "@whispering233/ai-editor-shared";
import { chatMessagesResSchema, chatSendReqSchema, chatSessionsResSchema } from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject, type ProjectContext } from "../middleware/project.js";
import { debugLog, isCategoryEnabled } from "../debug.js";
import { DEFAULT_MODEL, effectiveApiKey, getUserConfig } from "./settings.js";

// ============ 常量 ============

/** 心跳间隔（决策 20：15-30s 随机；测试经 deps.heartbeat 覆盖为毫秒级） */
export const DEFAULT_HEARTBEAT_MS = { minMs: 15_000, maxMs: 30_000 } as const;

/** 续聊历史重建的条数上限（超限按尾部保留——决策 6 的 token 裁剪由 S7.2 buildContext
 * 按预算二次兜底，此处仅防御病态超长会话的加载开销） */
export const SESSION_HISTORY_MAX_MESSAGES = 2000;

// ============ zod → JSON Schema（OpenAI function calling 格式） ============

/**
 * 单个工具 argsSchema（zod）→ OpenAI 兼容 JSON Schema（LLMToolDefinition.parameters）。
 * 方案：**zod 4 内置 toJSONSchema**（`import { toJSONSchema } from "zod"`，v4.4+ 自带，
 * 无新增依赖）——32 个工具参数均为简单对象 + string/enum/array/record/literal/union 字段，
 * 内置转换全覆盖且输出 draft 2020-12 合法 schema（`.strict()` → additionalProperties:false、
 * `.refine()` 仅影响校验不改变类型 schema、`z.record` → propertyNames 形态）。
 * 仅剥离顶层 `$schema` 关键字——OpenAI 兼容端点（含 DeepSeek）对 parameters 内未知关键字
 * 存在严格模式拒绝风险，剥离后零风险（其余关键字为标准 JSON Schema 内容，兼容）。
 */
export function zodArgsToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const js = toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/**
 * registry 工具定义 → LLM function calling 工具定义（决策点：只转换 AUTO + PROPOSAL 权限的
 * 32 个工具——listTools 已不注册执行类（S6.7 核心设计原则「AI 只能提案不能直接写」），
 * 此处权限过滤为双保险：未来误注册执行类工具也不会暴露给模型）。
 */
export function toLLMToolDefinitions(defs: readonly ToolDefinition[]): LLMToolDefinition[] {
  return defs
    .filter((d) => d.permission === TOOL_PERMISSION.AUTO || d.permission === TOOL_PERMISSION.PROPOSAL)
    .map((d) => ({
      name: d.name,
      description: d.description,
      parameters: zodArgsToJsonSchema(d.argsSchema),
    }));
}

// ============ 真实 produce / dispatcher 构造 ============

/**
 * 真实 produce 闭包（S7.3 契约：把 onEvent 转发给 chatStream 的 onEvent——runAgent 依赖它
 * 累积文本与收集工具调用；失败按 chatStream 契约 resolve 出 { ok:false, ... } 不 throw；
 * signal 由 runAgent 注入 attempt 级独立控制器——超时 abort 与用户取消分离，决策 15）。
 */
function createRealProduce(
  apiKey: string,
  model: string,
  tools: LLMToolDefinition[],
  debugStream: boolean,
): RunAgentDeps["produce"] {
  return (messages: LLMMessage[], signal?: AbortSignalLike, onEvent?: Parameters<RunAgentDeps["produce"]>[2]) =>
    // debugStream 显式传布尔（含 false）——stream 类别关时压过 env，保证配置文件类别隔离语义
    chatStream({ apiKey, model, messages, tools, signal, onEvent, debugStream });
}

// ============ [llm] 请求 / usage 调试日志装饰器（细粒度类别 request / usage） ============

/**
 * [llm] 请求调试日志装饰器：给 produce 包一层（真实路径经
 * `createLLMRequestLogger(createRealProduce(...), { model, tools })` 组装），对应类别开启时：
 * - **request 日志**（类别 request）：模型名 + 请求参数 + **完整 messages JSON（不截断——
 *   用户核心诉求「最终组装的 prompt」）** + 工具名列表；每轮每次 attempt 各打一次（含重试）
 * - **usage 日志**（类别 usage）：onEvent 转发处捕获 finish 事件，打真实 token 数
 *   （需求 3，流内真实 usage）——与 request **分开判定**（categories: ["request","usage"]
 *   时只显示请求与 tokens 统计）
 * - **敏感红线**：只打印请求体（messages 本身无 key——key 走 fetch header），
 *   绝不打印 apiKey / headers
 * - 两类别全关（request + usage 均未开启）时**零开销直通**：不包装 onEvent、不拼接字符串
 * 独立成装饰器而非塞进 createRealProduce：测试可用 mock produce 直测日志层，
 * 不经真实 DeepSeek 网络调用（与 createChatEventLogger 的「工厂 + 组合」同款模式）。
 * 注：produce 契约（run.ts）不含 maxTokens/temperature（当前无对应配置），如实标注 <未设置>。
 */
export function createLLMRequestLogger(
  produce: RunAgentDeps["produce"],
  ctx: { model: string; tools: LLMToolDefinition[] },
): RunAgentDeps["produce"] {
  const toolNames = ctx.tools.map((t) => t.name).join(", ");
  return (messages, signal, onEvent) => {
    // 两类别全关：零开销直通（不包装 onEvent、不拼接字符串）
    if (!isCategoryEnabled("request") && !isCategoryEnabled("usage")) {
      return produce(messages, signal, onEvent);
    }
    if (isCategoryEnabled("request")) {
      debugLog("request", "llm", `request model=${ctx.model} max_tokens=<未设置> temperature=<未设置> tools=[${toolNames}]`);
      debugLog("request", "llm", `request messages=${JSON.stringify(messages, null, 2)}`); // 完整打印不截断
    }
    // usage 类别开启时才需要包装 onEvent（捕获 finish 事件）
    const loggedOnEvent: ((event: LLMStreamEvent) => void) | undefined =
      isCategoryEnabled("usage") && onEvent
        ? (event) => {
            if (event.type === "finish") {
              const u = event.usage;
              debugLog(
                "usage",
                "llm",
                `usage prompt_tokens=${u?.prompt_tokens ?? "?"} completion_tokens=${u?.completion_tokens ?? "?"} total=${u?.total_tokens ?? "?"} stop=${event.stopReason}`,
              );
            }
            onEvent(event); // 原样转发（日志先于事件）
          }
        : onEvent;
    return produce(messages, signal, loggedOnEvent);
  };
}

// ============ 路由依赖注入（测试覆盖用） ============

/** POST /chat 可注入依赖（全部可选；缺省走真实实现。测试注入 mock 避免真实 DeepSeek 调用） */
export interface ChatRouteDeps {
  /** 测试注入：produce 覆盖（缺省构造真实 chatStream 闭包；提供时无需真实 apiKey） */
  produce?: RunAgentDeps["produce"];
  /** 测试注入：工具调度器覆盖（缺省 createToolDispatcher({db, outlineDir, projectId}, {store})） */
  dispatcher?: ToolDispatcher;
  /** 提案仓（缺省 defaultProposalStore 单例——与 S7.5 confirm/reject 同仓；测试注入独立实例隔离） */
  store?: ProposalStore;
  /** 心跳间隔覆盖 ms（缺省 15-30s 随机，决策 20；测试注入毫秒级） */
  heartbeat?: { minMs: number; maxMs: number };
  /** 时间注入（缺省 db nowIso——应用层写 ISO 8601 约定） */
  now?: () => string;
  /** 模型名覆盖（缺省设置页模型或 DEFAULT_MODEL） */
  model?: string;
  /** apiKey 覆盖（缺省 effectiveApiKey() 环境变量 > 用户级配置，决策 17） */
  apiKey?: string;
  /** 已转换工具定义覆盖（缺省 listTools → toLLMToolDefinitions） */
  tools?: LLMToolDefinition[];
  /** 续聊历史条数上限覆盖（缺省 SESSION_HISTORY_MAX_MESSAGES；测试可收紧） */
  sessionHistoryMaxCount?: number;
}

// ============ 聚焦上下文拼装（S7.2 输入形态） ============

/**
 * 聚焦上下文文本（决策 6 聚焦层）：focus_entity_* → getEntity 查询实体、focus_node_id →
 * 大纲节点查询，拼成结构化文本注入 system 聚焦消息。
 * 查询不到（已软删/不存在/跨项目）→ 跳过该项（不报错）——聚焦缺失不阻断对话，属防御性
 * 正常路径（客户端可能携带过期 focus 发送）；两项皆无 → undefined（无聚焦注入）。
 */
function buildFocusText(
  project: ProjectContext,
  context: { focus_entity_type?: string; focus_entity_id?: string; focus_node_id?: string } | undefined,
): string | undefined {
  const parts: string[] = [];
  if (context?.focus_entity_id !== undefined) {
    const row = getEntity(project.db, context.focus_entity_id);
    if (row !== null) {
      parts.push(`实体：${row.type}「${row.name}」（id=${row.id}）\n数据：${JSON.stringify(row.data)}`);
    }
  }
  if (context?.focus_node_id !== undefined) {
    const node = findOutlineNode(readOutlineFile(project.root), context.focus_node_id);
    if (node !== undefined && node.deleted !== true) {
      parts.push(
        `大纲节点：${node.type}「${node.title}」（id=${node.id}）${node.summary ? `\n摘要：${node.summary}` : ""}`,
      );
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

// ============ 内部辅助 ============

/** 可中止 sleep：任一 signal 触发即提前返回（心跳停止 / 断连即时唤醒，不空等满间隔） */
function sleepAbortable(ms: number, signals: readonly AbortSignal[]): Promise<void> {
  return new Promise((resolve) => {
    if (signals.some((s) => s.aborted)) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      for (const s of signals) s.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    for (const s of signals) s.addEventListener("abort", onAbort, { once: true });
  });
}

// ============ [chat] 事件调试日志（配置文件 chat 类别） ============

/** 调试日志字段摘要长度上限（tool_call args / tool_result 长文本截断，防刷屏） */
const DEBUG_FIELD_MAX = 200;

/**
 * 调试日志字段摘要：字符串原样、对象 JSON 序列化，超长截断并标注原长。
 * 仅在调试开启时被调用（createChatEventLogger 内部早退），关闭时零开销。
 */
function debugSummary(value: unknown, max = DEBUG_FIELD_MAX): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value) ?? "undefined";
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}…(${text.length} 字符)` : text;
}

/**
 * 创建 [chat] 事件调试日志器（对话链路调试，打到服务端终端 stdout/stderr；类别 chat）：
 * - 类别未开启（配置文件未列 chat 且 env 关）时零开销早退——不做任何字符串拼接
 *   （onEvent 高频路径无条件调用）
 * - turn_start → 轮次；tool_call → 工具名 + 参数 JSON 摘要（截断）；tool_result → 工具名 + 结果
 *   摘要（截断）；proposal → proposal_id + type；text → **只打 delta 长度**（流式高频防刷屏）；
 *   done → sessionId + 轮次；error → code + message
 * - 注：AgentEvent.tool_result 契约（run.ts）不含 ok/isError 字段——工具成败已编码进 result
 *   文本（失败为错误说明），日志只摘要该文本
 */
export function createChatEventLogger(): (event: AgentEvent) => void {
  let round = 0; // 轮次计数器（turn_start 刷新；done 事件附带——AgentEvent.done 无轮次字段）
  return (event: AgentEvent): void => {
    if (!isCategoryEnabled("chat")) return; // 短路由早退：类别未开时不产生任何字符串拼接
    switch (event.type) {
      case "turn_start":
        round = event.round;
        debugLog("chat", "chat", `turn_start round=${event.round}`);
        return;
      case "text":
        debugLog("chat", "chat", `text delta=+${event.delta.length} 字符`); // 只打长度不打内容
        return;
      case "tool_call":
        debugLog("chat", "chat", `tool_call tool=${event.tool} id=${event.id} args=${debugSummary(event.args)}`);
        return;
      case "tool_result":
        debugLog("chat", "chat", `tool_result tool=${event.tool} id=${event.id} result=${debugSummary(event.result)}`);
        return;
      case "proposal":
        debugLog("chat", "chat", `proposal id=${event.proposal.proposal_id} type=${event.proposal.type}`);
        return;
      case "done":
        debugLog("chat", "chat", `done session=${event.sessionId} round=${round}`);
        return;
      case "error":
        debugLog("chat", "chat", `error code=${event.code} message=${event.message} aborted=${event.aborted}`);
        return;
    }
  };
}

// ============ POST /api/v1/chat（S7.6：POST + SSE 对话端点） ============

/**
 * POST /chat 处理器工厂（测试经 createChatRoutes 注入 deps）。
 * 流程：项目/请求校验（JSON 错误，不开流）→ 会话解析（历史重建或新建 sess_）→ 用户消息落库
 * （决策 18）→ 三路断开检测挂接 → SSE 流内：心跳协程 + runAgent（produce/dispatcher 组装、
 * onEvent 转 SSE 帧、onMessages 落库）→ 取消作废提案（决策 16，B2 取舍见下）→ 关流。
 */
export function chatSendHandler(deps: ChatRouteDeps = {}): (c: Context) => Promise<Response> {
  return async (c) => {
    const project = requireCurrentProject();

    // ---- 请求校验（开流之前：失败走统一 JSON 错误，非 SSE） ----
    const raw = await c.req.json().catch(() => null); // 空 body / 非法 JSON → 校验失败
    const parsed = chatSendReqSchema.safeParse(raw);
    if (!parsed.success) {
      throw parsed.error; // → app.onError → 400 VALIDATION_ERROR（含 fields）
    }
    const { message, session_id, context } = parsed.data;

    // ---- key/模型/工具解析（决策 17：环境变量 > 用户级配置；测试注入 deps 时无需真实 key） ----
    const envKey = deps.apiKey ?? effectiveApiKey().key;
    if (envKey === null && deps.produce === undefined) {
      throw new HttpError(
        400,
        "LLM_API_KEY_MISSING",
        "未配置 DeepSeek API key：请设置环境变量 DEEPSEEK_API_KEY 或在设置页配置（决策 17）",
      );
    }
    // 守卫收窄：deps.produce 注入（测试）时不使用 apiKey；否则 envKey 已保证非 null
    const apiKey = envKey ?? "";
    const model = deps.model ?? getUserConfig().model ?? DEFAULT_MODEL;
    const tools = deps.tools ?? toLLMToolDefinitions(listTools());
    const store = deps.store ?? defaultProposalStore;
    const now = deps.now ?? nowIso;

    return streamSSE(
      c,
      async (stream) => {
        // ---- 1. 会话解析（决策 18 续聊重建） ----
        const sessionId = session_id ?? generateRuntimeId("session");
        // 跨项目 session_id：listMessageRows 按项目过滤 → 空历史（不泄露存在性，与 GET 一致）；
        // 后续写入按当前项目——单项目 MVP 下等价于「该项目内的续聊」，注释留扩展点
        const session: SessionState =
          session_id === undefined
            ? []
            : restoreSession(
                listMessageRows(project.db, sessionId, project.config.id),
                deps.sessionHistoryMaxCount ?? SESSION_HISTORY_MAX_MESSAGES,
              );

        // ---- 2. 聚焦上下文（决策 6；查不到跳过，不阻断） ----
        const focus = buildFocusText(project, context);

        // ---- 3. 用户消息落库（决策 18；assistant/tool 消息由 onMessages 落库） ----
        insertChatMessage(project.db, {
          session_id: sessionId,
          project_id: project.config.id,
          role: "user",
          content: message,
          created_at: now(),
        });

        // ---- 4. 取消信号 + 三路断开检测（决策 16/20） ----
        // controller.signal 即 runAgent 的 signal（决策 16 全链路第 0 层——四层穿透的
        // fetch/读循环/工具执行/重试 sleep 已由 llm/tools/agent 各层承担，本卡链路总装）
        const controller = new AbortController();
        const cancel = () => {
          if (!controller.signal.aborted) controller.abort();
        };
        // ① stream.onAbort：客户端断开 → 响应流 cancel → Hono StreamingApi.abort() → 本回调
        stream.onAbort(cancel);
        // ② c.req.raw 的 close/error 监听：@hono/node-server v2 的 c.req.raw 是标准 Request
        // （无 close 事件，signal 随请求中止触发）——两种形态按能力探测都挂上，双保险
        c.req.raw.signal.addEventListener("abort", cancel, { once: true });
        const rawReq = c.req.raw as unknown as { on?: (ev: string, fn: () => void) => unknown };
        if (typeof rawReq.on === "function") {
          rawReq.on("close", cancel);
          rawReq.on("error", cancel);
        }
        // ③ 心跳写失败：Hono write() 吞错无法从 promise 观察写失败（stream.js write try/catch）
        //    ——断连时 ① 已同步置位 controller.signal，心跳每次写后复查该旗标兜底
        //    （时延 ≤ 心跳间隔，决策 20 三路并用中的最后一道防线）

        // ---- 5. SSE 写帧器（endpoints.md 事件契约；断连后不再写） ----
        const writeEvent = async (event: string, data: unknown): Promise<void> => {
          if (controller.signal.aborted) return; // 已断开：写也失败，跳过
          try {
            await stream.writeSSE({ event, data: JSON.stringify(data) });
          } catch {
            cancel(); // 写抛错（writeSSE 理论上吞错，防御路径）
          }
        };

        // ---- 6. 心跳协程（决策 20：15-30s 随机 ping；停止/断连即时唤醒退出） ----
        const heartbeatStop = new AbortController();
        const heartbeat = (async () => {
          const { minMs, maxMs } = deps.heartbeat ?? DEFAULT_HEARTBEAT_MS;
          while (!heartbeatStop.signal.aborted) {
            const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
            await sleepAbortable(ms, [heartbeatStop.signal, controller.signal]);
            if (heartbeatStop.signal.aborted || controller.signal.aborted) return;
            await stream.writeSSE({ event: "ping", data: "{}" });
            // ③ 写后复查：客户端断开时 onAbort 已置位 controller（见第 4 步注释）
            if (controller.signal.aborted) return;
          }
        })();

        // ---- 7. onEvent → SSE 帧（AgentEvent 六类 + turn_start；proposal 顺序由 runAgent 保证） ----
        // 帧写入经 void 异步排入 writer（WritableStream FIFO 保证顺序，await 仅背压）——
        // 事件回调恒同步返回，不阻塞 runAgent 循环
        const logChatEvent = createChatEventLogger(); // [chat] 调试日志（chat 类别；关闭时零开销）
        const onEvent = (event: AgentEvent): void => {
          logChatEvent(event); // 对话链路调试：工具调用/提案/文本增量长度等打到服务端终端
          switch (event.type) {
            case "turn_start":
              return; // 循环内部事件：不映射 SSE 帧（日志/调试用）
            case "text":
              void writeEvent("text", { delta: event.delta });
              return;
            case "tool_call":
              void writeEvent("tool_call", { tool: event.tool, args: event.args, id: event.id });
              return;
            case "tool_result":
              void writeEvent("tool_result", { tool: event.tool, result: event.result, id: event.id });
              return;
            case "proposal":
              // endpoints.md：proposal 在对应 tool_result 之后、循环继续之前（runAgent 保证）
              void writeEvent("proposal", {
                proposal_id: event.proposal.proposal_id,
                type: event.proposal.type,
                preview: event.proposal.preview,
              });
              return;
            case "done":
              void writeEvent("done", { session_id: event.sessionId });
              return;
            case "error":
              // 用户取消/断开（aborted=true）：客户端已不可达，不写 error 帧（写了也失败）
              if (!event.aborted) void writeEvent("error", { code: event.code, message: event.message });
              return;
          }
        };

        // ---- 8. onMessages → 落库（决策 18：assistant + tool 消息，含 tool_calls/tool_call_id 配对） ----
        // 硬契约（run.ts 注释）：onMessages 抛错不逃逸（runAgent 兜底吞掉）——落库失败
        // 不中断 agent 循环，此处由 db 抛错自然触发该契约（本路由不额外 try/catch）
        const onMessages = (messages: SessionMessage[]): void => {
          const ts = now();
          for (const m of messages) {
            insertChatMessage(project.db, {
              session_id: sessionId,
              project_id: project.config.id,
              role: m.role,
              content: m.content ?? null,
              ...(m.role === "assistant" && m.tool_calls !== undefined ? { tool_calls: m.tool_calls } : {}),
              ...(m.role === "tool" ? { tool_call_id: m.tool_call_id } : {}),
              created_at: ts,
            });
          }
        };

        // ---- 9. runAgent 接线（S7.3：produce/dispatcher 由本路由组装注入） ----
        // 真实 produce 外包 [llm] 请求/usage 调试日志装饰器（细粒度类别 request/usage，关闭零开销直通）；
        // debugStream 按 stream 类别显式传入（false 也传——压过 env，保证类别隔离语义）
        const produce =
          deps.produce ??
          createLLMRequestLogger(createRealProduce(apiKey, model, tools, isCategoryEnabled("stream")), {
            model,
            tools,
          });
        // S7.4 真实现：ToolContext { db, outlineDir, projectId } + 同仓提案（S7.5 消费）
        const dispatcher =
          deps.dispatcher ?? createToolDispatcher({ db: project.db, outlineDir: project.root, projectId: project.config.id }, { store });

        const result = await runAgent({
          sessionId,
          userMessage: message, // runAgent 追加进会话（传入 session 不应已含本轮消息）
          session,
          focus,
          projectPrompt: project.config.prompt || undefined, // 决策 7 项目层
          deps: { produce, dispatcher, onEvent, onMessages },
          signal: controller.signal, // 决策 16：断开即取消（abort 永不重试）
        });

        // ---- 10. B2 取舍落地（决策 16「未确认提案按产生它的会话作废」） ----
        // 三选项评估：a) Proposal 加 sessionId + 仓按会话清除（跨包改动 S6.6/S7.4，成本中）；
        //   b) SSE 取消时 clear() 全量；c) 依赖 TTL（10 分钟）。
        // 选择 **b**：最小改动、单项目单会话 MVP 下与「按会话作废」语义等价——取消只发生在
        // 客户端断连（同会话）或项目切换（提案本就按项目绑定，切换时全清）场景，clear() 不会
        // 误伤其他会话的待确认提案。与决策 16 原文的偏差（提案记录来源 session_id、按会话粒度
        // 作废）记录为扩展点：多会话并发（backlog 多标签页）时按选项 a 演进——Proposal 增
        // session_id 字段、ProposalStore 增 clearBySession(sessionId)，调度时由 S7.6 透传会话。
        if (result.aborted) {
          store.clear();
        }

        // ---- 11. 停心跳 + 关流（error 后流立即关闭；done 自然结束——streamSSE run 的
        // finally 亦兜底 close，此处显式确保顺序：帧排入 writer 后 close，FIFO 保证送达） ----
        heartbeatStop.abort(); // sleep 即时唤醒（sleepAbortable 监听该 signal）
        await heartbeat;
        await stream.close();
      },
      // 防御路径 onError：cb 内部异常（正常流程 error 事件已由 runAgent 发出，理论不可达）——
      // 转契约形态 JSON error 帧（客户端 use-sse 收到 error 即终止解析）
      async (err, stream) => {
        console.error("[server] chat SSE 流异常:", err);
        try {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              code: "INTERNAL_ERROR",
              message: err instanceof Error ? err.message : "SSE 流内部错误",
            }),
          });
        } catch {
          // 客户端已断开：放弃通知
        }
      },
    );
  };
}

// ============ 路由装配 ============

/**
 * 创建对话路由（S7.6 起支持 deps 注入：测试经 createChatRoutes({ produce: mock, ... }) 构造
 * 独立实例挂载测试 app，避免真实 DeepSeek 调用；index.ts 挂载默认实例）。
 */
export function createChatRoutes(deps: ChatRouteDeps = {}): Hono {
  const routes = new Hono();
  routes.get("/sessions", (c) => {
    const project = requireCurrentProject();
    return sessionsResponse(c, listSessions(project.db, project.config.id));
  });
  routes.get("/sessions/:id/messages", (c) => {
    const project = requireCurrentProject();
    const sessionId = c.req.param("id");
    return messagesResponse(c, sessionId, listMessages(project.db, sessionId, project.config.id));
  });
  // POST /api/v1/chat —— POST + SSE 对话端点（S7.6；U3 起为后续切片预留）
  routes.post("/", chatSendHandler(deps));
  return routes;
}

/** 默认对话路由实例（index.ts 挂载于 /api/v1/chat） */
export const chatRoutes = createChatRoutes();

/**
 * sessions 响应契约自检出口（参照 project.ts listResponse）：
 * parse 失败 = 服务端构造的响应不符合 shared 契约（服务端 bug），转 500 INTERNAL_ERROR；
 * 不让 ZodError 冒泡——否则 errorHandler 会按入参语义误报 400 VALIDATION_ERROR。
 */
function sessionsResponse(c: Context, sessions: ChatSessionSummary[]): Response {
  try {
    return c.json(ok(chatSessionsResSchema.parse({ sessions })));
  } catch (err) {
    throw new HttpError(
      500,
      "INTERNAL_ERROR",
      `sessions 响应不符合契约: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** messages 响应契约自检出口（同上；db 消息含 sessionId/projectId 附加字段，parse 按契约剥离） */
function messagesResponse(c: Context, sessionId: string, messages: ChatMessage[]): Response {
  try {
    return c.json(ok(chatMessagesResSchema.parse({ sessionId, messages })));
  } catch (err) {
    throw new HttpError(
      500,
      "INTERNAL_ERROR",
      `messages 响应不符合契约: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
