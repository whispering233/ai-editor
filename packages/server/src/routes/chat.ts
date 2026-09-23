// 对话路由：POST /api/v1/chat（POST + SSE）、会话列表 / 消息历史 / 思维链全文 / 删除会话
//
// **本文件是 docs/api/80-api-chat.md 那份契约的服务端实现**——SSE 事件集与过滤约定见该文档，
// 事件投影的唯一实现在 agent 包 `runtime/events.ts`（本文件只做「取帧 → 写帧」与日志）。
//
// 语义要点：
// - 无当前项目 → 409 NO_PROJECT_OPEN（与其他业务路由一致）
// - 请求体校验失败 → 400 VALIDATION_ERROR（JSON，非 SSE——校验在开流之前）
// - 单项目单在途流 → 409 CHAT_BUSY；重复会话删除 → 404 SESSION_NOT_FOUND；在途会话 → 409 SESSION_BUSY
// - 模型/凭据缺失 → 400 LLM_API_KEY_MISSING（同样在开流之前，JSON）
// - 会话归属由项目目录表达：`session_id` 只经磁盘发现映射到文件（**不做路径拼接**），
//   缺省则新建会话（pi 生成 id，首帧 `session` 回给客户端）
// - 断开（刷新/断网）→ 三路检测 → `AgentSession.abort()`；未确认提案随取消作废
//
// 可测试性：`createChatRoutes(deps)` 注入运行时工厂 / 提案仓 / 心跳间隔，测试用 faux provider
// 离线跑通全链路（不触碰真实 provider 与全局单例）。

import { unlinkSync } from "node:fs";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  contextUsageField,
  createPingFrame,
  createSessionFrame,
  createSpeedMeter,
  defaultProposalStore,
  findProjectSession,
  FOCUS_TITLE,
  lastVisibleSessionText,
  listProjectSessions,
  NoModelConfiguredError,
  projectSessionMessages,
  readProjectSession,
  readSessionThinking,
  sessionUsage,
  toSseFrame,
  type ProposalStore,
  type ProjectRuntime,
  type SseFrame,
  type SseProjectionOptions,
} from "@whispering233/ai-editor-agent";
import {
  findOutlineNode,
  getDocument,
  getDocumentTextLengths,
  getEntity,
  readOutlineFile,
} from "@whispering233/ai-editor-db";
import {
  buildDeductionMarks,
  orderVisibleChapters,
  truncate,
  type ChatContextUsage,
  type ChatUsage,
} from "@whispering233/ai-editor-shared";
import {
  chatMessagesResSchema,
  chatSendReqSchema,
  chatSessionDeleteResSchema,
  chatSessionsResSchema,
  chatThinkingResSchema,
} from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject, type ProjectContext } from "../middleware/project.js";
import { getModelRuntime, getSettingsManager, resolveActiveSelection } from "../model-runtime.js";
import { debugLog, isCategoryEnabled } from "../debug.js";
import {
  acquireProjectRuntime,
  beginActiveChat,
  enterInFlightSession,
  hasActiveChat,
  isSessionInFlight,
  leaveInFlightSession,
  type ChatProjectTarget,
  type RuntimeFactory,
} from "../chat-runtime.js";

// ============ 常量 ============

/** 心跳间隔（15-30s 随机；测试经 deps.heartbeat 覆盖为毫秒级） */
export const DEFAULT_HEARTBEAT_MS = { minMs: 15_000, maxMs: 30_000 } as const;

/** 会话列表 lastMessage 截断长度（与历史口径一致，见 docs/db/schema.md） */
export const SESSION_LAST_MESSAGE_MAX_LEN = 50;

/** 工具结果截断标记（agent 包 runtime/tool-result.ts 的同款文案；用于 TOOL_RESULT_TOO_LARGE 日志） */
const TOOL_RESULT_TRUNCATION_MARKER = "[工具结果已截断";

// ============ 路由依赖注入（测试覆盖用） ============

/** chat 路由可注入依赖（全部可选；缺省走真实实现） */
export interface ChatRouteDeps {
  /** 运行时工厂（缺省 = 项目 sessions/ + pi 装配；测试注入 faux provider 运行时） */
  runtimeFactory?: RuntimeFactory;
  /** 提案仓（缺省 defaultProposalStore 单例——与 confirm/reject 同仓；测试注入独立实例隔离） */
  store?: ProposalStore;
  /** 心跳间隔覆盖 ms（缺省 15-30s 随机；测试注入毫秒级） */
  heartbeat?: { minMs: number; maxMs: number };
}

// ============ 聚焦上下文（本轮消息的一部分，见 docs/design/20-context.md §2） ============

/** 聚焦章注入的正文节选上限（字符；完整正文由模型调 get_chapter_text 按 offset 分页拉取） */
export const FOCUS_CHAPTER_EXCERPT_CHARS = 2000;

/**
 * 聚焦上下文文本：focus_entity_id → 实体、focus_node_id → 大纲节点、focus_deduction → 推演节点集合，
 * 拼成结构化文本。
 * 查询不到（已软删/不存在/跨项目）→ 跳过该项（不报错）：客户端可能携带过期 focus。
 * 各项皆无（或均无效）→ undefined（不注入，消息原文保持干净）。
 * 聚焦**章**：另注入正文前 `FOCUS_CHAPTER_EXCERPT_CHARS` 字符节选（带「节选」标注）——
 * **不做整章自动入上下文**（正文预算与对话历史共享同一窗口，见 docs/design/20-context.md §2）。
 */
export function buildFocusText(
  project: ProjectContext,
  context:
    | {
        focus_entity_type?: string;
        focus_entity_id?: string;
        focus_node_id?: string;
        focus_deduction?: boolean;
      }
    | undefined,
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
        `大纲节点：${node.type}「${node.title}」（id=${node.id}）${node.summary ? `\n摘要：${node.summary}` : ""}` +
          chapterExcerptOf(project, node.type, node.id),
      );
    }
  }
  if (context?.focus_deduction === true) {
    const deduction = deductionFocusText(project);
    if (deduction !== undefined) parts.push(deduction); // 无标记 / 全部失效 → 不注入该段（不影响其余项）
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/**
 * 推演节点集合段（`context.focus_deduction`，见 `docs/design/20-context.md` §2）：
 * 三段短文本——① 口径说明 ② 有序标记清单（角色 · 章号 · 标题）③ 相邻区间摘要（跨越章数 · 已写章数）。
 * 标记的角色 / 顺序 / 章号一律来自 shared `buildDeductionMarks`（唯一编号口径），本函数不手抄文案与章号；
 * 标记源是**服务端现读**的 `project.json` `deduction_nodes`（客户端只发布尔，见 `docs/api/80-api-chat.md`）。
 * **不注入**章摘要 / 区间内中间章清单 / 正文（区间明细与章清单走 `get_deduction_marks` 工具）。
 * 无标记 / 标记全部失效（软删、非章、已 purge）→ undefined（静默省略，不报错）。
 */
function deductionFocusText(project: ProjectContext): string | undefined {
  const tree = readOutlineFile(project.root);
  const marks = buildDeductionMarks(tree, project.config.deduction_nodes ?? []);
  if (marks.length === 0) return undefined;

  const lines = [
    "推演节点集合（作者标定的推演边界）：单标记 = 开放式剧情发散；多标记 = 相邻标记之间的剧情线探讨；" +
      "明细可用 get_deduction_marks 获取。",
    "标记（按章序）：",
    ...marks.map((mark) => `${mark.index}. ${mark.label} · 第${mark.chapterNumber}章 · ${mark.title}`),
  ];
  if (marks.length > 1) {
    // 区间 = 相邻标记之间（**不含两端标记**，与 get_deduction_marks 的 spans 同口径）：只给骨架，不给中间章清单
    const order = orderVisibleChapters(tree);
    lines.push("相邻区间：");
    for (let i = 1; i < marks.length; i++) {
      const from = marks[i - 1];
      const to = marks[i];
      const middle = order.slice(order.indexOf(from.nodeId) + 1, order.indexOf(to.nodeId));
      const textLengths = getDocumentTextLengths(project.db, "chapter", middle);
      const written = middle.filter((id) => (textLengths.get(id) ?? 0) > 0).length;
      lines.push(
        `${from.label}（第${from.chapterNumber}章）→ ${to.label}（第${to.chapterNumber}章）：` +
          `跨越 ${middle.length} 章 · 已写 ${written} 章`,
      );
    }
  }
  return lines.join("\n");
}

/** 聚焦章的正文节选段：非章 / 未写过正文 → 空串（维持现状）；只取前 N 字符，完整正文由工具拉取 */
function chapterExcerptOf(project: ProjectContext, nodeType: string, nodeId: string): string {
  if (nodeType !== "chapter") return "";
  const text = getDocument(project.db, "chapter", nodeId)?.content_text ?? "";
  if (text === "") return "";
  return `\n正文（节选，完整正文请用 get_chapter_text 读取）：\n${text.slice(0, FOCUS_CHAPTER_EXCERPT_CHARS)}`;
}

// ============ 调试日志（配置文件 debug 段；关闭时零开销） ============

/** 调试日志字段摘要长度上限（工具参数/结果长文本截断，防刷屏） */
const DEBUG_FIELD_MAX = 200;

/** 调试日志字段摘要：字符串原样、对象 JSON，超长截断并标注原长 */
function debugSummary(value: unknown, max = DEBUG_FIELD_MAX): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined");
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}…(${text.length} 字符)` : text;
}

/** pi 会话事件的最小结构形态（结构性类型：server 包不直接依赖 pi 的类型） */
interface MinimalAgentEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * 会话事件调试日志器（配置文件 debug 段；类别全关时零开销早退）：
 * - chat：turn_start / 文本与思考增量（只打长度）/ 工具执行起止（参数与结果摘要）/ 压缩 / 重试 / 本轮结束
 * - request：**每次模型请求前一次**（即 user / toolResult 消息落定之时——这两种消息之后紧跟一次模型请求）
 *   打印模型名 + 工具名 + **完整 messages JSON（不截断——用户核心诉求「最终组装的 prompt」）**
 * - usage：assistant 消息的真实 usage；工具结果被截断时的 TOOL_RESULT_TOO_LARGE 记录
 * 注：旧 `stream` 类别（chatStream debugStream）随自研 LLM 层退场，见报告。
 */
export function createChatDebugLogger(runtime: ProjectRuntime): (event: MinimalAgentEvent) => void {
  return (event) => {
    const chatOn = isCategoryEnabled("chat");
    const requestOn = isCategoryEnabled("request");
    const usageOn = isCategoryEnabled("usage");
    if (!chatOn && !requestOn && !usageOn) return;

    switch (event.type) {
      case "turn_start": {
        if (chatOn) debugLog("chat", "chat", "turn_start");
        return;
      }
      case "message_update": {
        if (!chatOn) return;
        const assistantEvent = event.assistantMessageEvent as { type?: string; delta?: unknown } | undefined;
        if (assistantEvent?.type === "text_delta" && typeof assistantEvent.delta === "string") {
          debugLog("chat", "chat", `text delta=+${assistantEvent.delta.length} 字符`);
        } else if (assistantEvent?.type === "thinking_delta" && typeof assistantEvent.delta === "string") {
          debugLog("chat", "chat", `thinking delta=+${assistantEvent.delta.length} 字符`);
        }
        return;
      }
      case "message_end": {
        const message = event.message as
          | {
              role?: string;
              usage?: { input?: number; output?: number; totalTokens?: number };
              stopReason?: string;
            }
          | undefined;
        // 模型请求前的最后一个可观测点：user / toolResult 消息落定后紧跟一次请求
        if (requestOn && (message?.role === "user" || message?.role === "toolResult")) {
          const model = runtime.session.model;
          debugLog(
            "request",
            "llm",
            `request model=${model?.id ?? "?"} tools=[${runtime.session.getActiveToolNames().join(", ")}]`,
          );
          // 完整 messages（不截断）：模型实际看到的历史 + 即将发出的那一轮输入
          debugLog("request", "llm", `request messages=${JSON.stringify(runtime.session.messages, null, 2)}`);
        }
        if (!usageOn || message?.role !== "assistant" || message.usage === undefined) return;
        debugLog(
          "usage",
          "llm",
          `usage input_tokens=${message.usage.input ?? "?"} output_tokens=${message.usage.output ?? "?"} total=${message.usage.totalTokens ?? "?"} stop=${message.stopReason ?? "?"}`,
        );
        return;
      }
      case "tool_execution_start": {
        if (!chatOn) return;
        debugLog(
          "chat",
          "chat",
          `tool_call tool=${String(event.toolName)} id=${String(event.toolCallId)} args=${debugSummary(event.args)}`,
        );
        return;
      }
      case "tool_execution_end": {
        const result = event.result as { content?: unknown } | undefined;
        // 全量序列化（截断标记在尾部，不能拿截断后的摘要去做判定）
        let fullText: string;
        try {
          fullText = JSON.stringify(result?.content ?? result ?? "") ?? "";
        } catch {
          fullText = String(result?.content ?? "");
        }
        if (chatOn) {
          debugLog(
            "chat",
            "chat",
            `tool_result tool=${String(event.toolName)} id=${String(event.toolCallId)} isError=${String(event.isError)} result=${debugSummary(fullText)}`,
          );
        }
        if (usageOn && fullText.includes(TOOL_RESULT_TRUNCATION_MARKER)) {
          debugLog(
            "usage",
            "agent",
            `TOOL_RESULT_TOO_LARGE 工具结果截断 tool=${String(event.toolName)}（数据不完整，模型已收到提示）`,
          );
        }
        return;
      }
      case "compaction_start":
        if (chatOn) debugLog("chat", "chat", `compaction_start reason=${String(event.reason)}`);
        return;
      case "compaction_end":
        if (chatOn) {
          debugLog(
            "chat",
            "chat",
            `compaction_end reason=${String(event.reason)} aborted=${String(event.aborted)} willRetry=${String(event.willRetry)}`,
          );
        }
        return;
      case "auto_retry_start":
        if (chatOn) {
          debugLog(
            "chat",
            "chat",
            `auto_retry_start attempt=${String(event.attempt)}/${String(event.maxAttempts)} delayMs=${String(event.delayMs)}`,
          );
        }
        return;
      case "auto_retry_end":
        if (chatOn) debugLog("chat", "chat", `auto_retry_end success=${String(event.success)}`);
        return;
      case "agent_end": {
        if (!chatOn) return;
        const messages = Array.isArray(event.messages) ? event.messages : [];
        const last = [...messages].reverse().find((m) => (m as { role?: string }).role === "assistant") as
          | { stopReason?: string; errorMessage?: string }
          | undefined;
        if (last?.stopReason === "error" || last?.stopReason === "aborted") {
          debugLog("chat", "chat", `error stopReason=${last.stopReason} message=${last.errorMessage ?? ""}`);
        } else {
          debugLog("chat", "chat", "done");
        }
        return;
      }
      default:
        return;
    }
  };
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

/**
 * 订阅判定谓词（帧与历史响应用量同源；**不用 `isUsingOAuth()`**——OAuth ≠ 订阅，口径见
 * docs/design/20-context.md §2.1）。pi 方法名只在此处出现一次。
 */
function subscriptionPredicate(modelRuntime: ProjectRuntime["modelRuntime"]): (provider: string) => boolean {
  return (provider) => modelRuntime.isUsingSubscription(provider);
}

// ============ POST /api/v1/chat（POST + SSE） ============

/**
 * POST /chat 处理器工厂（测试经 createChatRoutes 注入 deps）。
 * 流程：项目/请求校验（JSON 错误，不开流）→ 会话解析（磁盘发现或新建）→ 运行时装配 + 凭据预检
 * → 开流：首帧 session + 事件投影帧 + 心跳 → `session.prompt()` → 收尾（取消则作废提案）。
 */
export function chatSendHandler(deps: ChatRouteDeps = {}): (c: Context) => Promise<Response> {
  return async (c) => {
    const project = requireCurrentProject();

    // ---- 请求校验（开流之前：失败走统一 JSON 错误，非 SSE） ----
    const raw = await c.req.json().catch(() => null); // 空 body / 非法 JSON → 校验失败
    const parsed = chatSendReqSchema.safeParse(raw);
    if (!parsed.success) throw parsed.error; // → app.onError → 400 VALIDATION_ERROR（含 fields）
    const { message, session_id, context } = parsed.data;

    // ---- 单项目单在途流：判定与占位相邻且中间无 await（不留竞态窗口） ----
    if (hasActiveChat(project.root)) {
      throw new HttpError(409, "CHAT_BUSY", "当前项目已有在途对话流，请等待本轮结束或停止生成后再发送");
    }
    const chat = beginActiveChat(project.root);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      chat.release();
    };

    try {
      const target: ChatProjectTarget = { root: project.root, projectId: project.config.id, db: project.db };

      // ---- 目标会话：session_id 只经磁盘发现映射（未命中 → 404） ----
      let sessionFile: string | undefined;
      if (session_id !== undefined) {
        const info = await findProjectSession(target.root, session_id);
        if (info === null) {
          throw new HttpError(404, "SESSION_NOT_FOUND", `会话不存在: ${session_id}（客户端应改为新会话重试）`);
        }
        sessionFile = info.path;
      }

      // ---- 运行时装配（模型/凭据/会话/工具都由 pi 提供） + 凭据预检（开流前 JSON 错误） ----
      let runtime: ProjectRuntime;
      try {
        runtime = await acquireProjectRuntime(target, sessionFile, deps.runtimeFactory);
      } catch (err) {
        if (err instanceof NoModelConfiguredError) {
          throw new HttpError(400, "LLM_API_KEY_MISSING", err.message);
        }
        throw err;
      }
      const model = runtime.session.model;
      if (model === undefined) {
        throw new HttpError(400, "LLM_API_KEY_MISSING", "未配置可用模型：请先在设置页选择模型");
      }
      if (!runtime.modelRuntime.hasConfiguredAuth(model.provider)) {
        throw new HttpError(
          400,
          "LLM_API_KEY_MISSING",
          `未配置 ${model.provider} 的凭据：请在设置页填写 API key，或设置对应环境变量`,
        );
      }

      const sessionId = runtime.session.sessionId;
      const store = deps.store ?? defaultProposalStore;
      // 聚焦上下文注入为本轮用户消息的一部分（system 提示词只有内核提示词 + 项目 AGENTS.md 两层）
      const focusText = buildFocusText(project, context);
      const promptText = focusText === undefined ? message : `${FOCUS_TITLE}\n${focusText}\n\n${message}`;
      const logEvent = createChatDebugLogger(runtime);
      // 状态栏投影（每流一份）：占用 = pi getContextUsage()，账目 = sessionUsage()，速度 = 每流一个 meter
      const projectionOptions: SseProjectionOptions = {
        getContextUsage: () => runtime.session.getContextUsage(),
        getSessionUsage: () =>
          sessionUsage(runtime.session.sessionManager.getEntries(), {
            isUsingSubscription: subscriptionPredicate(runtime.modelRuntime),
          }),
        speedMeter: createSpeedMeter(),
      };

      // 项目切换/关闭时由 chat-runtime 触发中止（占位已在，中止回调就绪即可被叫停）
      chat.setAbort(() => {
        void runtime.session.abort();
      });

      return streamSSE(
        c,
        async (stream) => {
          // ---- 取消信号 + 三路断开检测 ----
          const controller = new AbortController();
          const cancel = (): void => {
            if (!controller.signal.aborted) controller.abort();
            void runtime.session.abort(); // pi 侧中止：模型请求 / 工具执行 / 重试退避
          };
          // ① stream.onAbort：客户端断开 → 响应流 cancel → Hono StreamingApi.abort
          stream.onAbort(cancel);
          // ② 请求 signal（@hono/node-server v2 的 c.req.raw 是标准 Request）；老形态的 close/error 也挂
          c.req.raw.signal.addEventListener("abort", cancel, { once: true });
          const rawReq = c.req.raw as unknown as { on?: (ev: string, fn: () => void) => unknown };
          if (typeof rawReq.on === "function") {
            rawReq.on("close", cancel);
            rawReq.on("error", cancel);
          }

          // ---- 帧写入器（断连后不再写；写失败即视为断开） ----
          const writeFrame = async (frame: SseFrame): Promise<void> => {
            if (controller.signal.aborted) return;
            try {
              await stream.writeSSE({ event: frame.event, data: JSON.stringify(frame.data) });
            } catch {
              cancel(); // writeSSE 理论上吞错，防御路径
            }
          };

          // ---- 心跳协程（15-30s 随机 ping；停止/断连即时唤醒退出）----
          const heartbeatStop = new AbortController();
          const heartbeat = (async () => {
            const { minMs, maxMs } = deps.heartbeat ?? DEFAULT_HEARTBEAT_MS;
            while (!heartbeatStop.signal.aborted) {
              const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
              await sleepAbortable(ms, [heartbeatStop.signal, controller.signal]);
              if (heartbeatStop.signal.aborted || controller.signal.aborted) return;
              await writeFrame(createPingFrame());
              // ③ 心跳写后复查：onAbort 已置位 controller（写失败检测的最后一道防线）
              if (controller.signal.aborted) return;
            }
          })();

          let entered = false;
          let unsubscribe: (() => void) | undefined;
          try {
            // ---- 首帧：会话（客户端据此持久化「当前会话」）----
            await writeFrame(createSessionFrame(sessionId));

            // ---- 事件订阅：pi 会话事件 → SSE 帧（投影唯一实现在 agent 包）----
            enterInFlightSession(sessionId);
            entered = true;
            unsubscribe = runtime.session.subscribe((event) => {
              logEvent(event as unknown as MinimalAgentEvent);
              const frame = toSseFrame(event, projectionOptions);
              if (frame === null) return;
              void writeFrame(frame); // 排入 writer（FIFO 保证顺序），不阻塞循环
            });

            await runtime.session.prompt(promptText);
            await runtime.session.waitForIdle();
          } catch (err) {
            // 开流后的失败（如 prompt 前置校验）：事件表没有独立 error 帧——以 agent_end 表达终止
            const message = err instanceof Error ? err.message : String(err);
            debugLog("chat", "chat", `prompt 失败：${message}`);
            await writeFrame({
              event: "agent_end",
              data: { stopReason: "error", errorMessage: message, ...contextUsageField(projectionOptions) },
            });
          } finally {
            unsubscribe?.();
            // 注销在途登记紧跟本轮结束（其后还有 heartbeat/close 两个 await）：
            // 客户端读到 agent_end 立刻删会话不能落进 SESSION_BUSY 窗口
            if (entered) leaveInFlightSession(sessionId);
            release();
            heartbeatStop.abort(); // sleep 即时唤醒
            await heartbeat;
            if (controller.signal.aborted) store.clear(); // 未确认提案随取消作废
            await stream.close();
          }
        },
        // 防御路径 onError：cb 内部异常（agent 层错误已由事件表达）——记日志 + 尽力通知
        async (err, stream) => {
          console.error("[server] chat SSE 流异常:", err);
          try {
            await stream.writeSSE({
              event: "agent_end",
              data: JSON.stringify({
                stopReason: "error",
                errorMessage: err instanceof Error ? err.message : "SSE 流内部错误",
              }),
            });
          } catch {
            // 客户端已断开：放弃通知
          }
        },
      );
    } catch (err) {
      // 开流前的任何失败（校验/会话解析/装配）都要把在途占位还回去
      release();
      throw err;
    }
  };
}

// ============ 会话端点辅助 ============

/** 会话末条可见文本（列表摘要用）+ 50 字截断 */
async function lastVisibleText(target: ChatProjectTarget, sessionId: string): Promise<string> {
  const opened = await readProjectSession(target.root, sessionId);
  return opened === null ? "" : lastVisibleSessionText(opened.entries);
}

/**
 * 历史响应的 `contextUsage`：**只带窗口，不重建占用**（占用建在 pi 未导出的估算函数上，见
 * `docs/design/20-context.md` §2.1）。窗口取**当前激活模型**目录——与 GET /settings/llm 同一条解析
 * （`resolveActiveSelection` + 模型目录）。无模型 / 窗口非正 → 返回 undefined（响应省该键，不给 0）。
 */
async function historyContextUsage(modelRuntime: ModelRuntime): Promise<ChatContextUsage | undefined> {
  const selection = await resolveActiveSelection(modelRuntime, getSettingsManager());
  const contextWindow =
    selection === null ? undefined : modelRuntime.getModel(selection.provider, selection.modelId)?.contextWindow;
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
  return { tokens: null, percent: null, contextWindow };
}

// ============ 路由装配 ============

/**
 * 创建对话路由（index.ts 挂载默认实例；测试注入 deps 构造独立实例）。
 */
export function createChatRoutes(deps: ChatRouteDeps = {}): Hono {
  const routes = new Hono();

  // GET /api/v1/chat/sessions —— 会话列表（按最后活动倒序）
  routes.get("/sessions", async (c) => {
    const project = requireCurrentProject();
    const target: ChatProjectTarget = { root: project.root, projectId: project.config.id, db: project.db };
    const sessions = await listProjectSessions(target.root);
    const items = await Promise.all(
      sessions.map(async (info) => ({
        id: info.id,
        name: info.name, // pi `session_info` 条目（普通 chat 会话没有 ⇒ undefined 被 JSON 序列化丢掉）
        lastMessage: truncate(await lastVisibleText(target, info.id), SESSION_LAST_MESSAGE_MAX_LEN),
        messageCount: info.messageCount,
        createdAt: info.created.toISOString(),
        updatedAt: info.modified.toISOString(),
      })),
    );
    return sessionsResponse(c, items);
  });

  // GET /api/v1/chat/sessions/:id/messages —— 消息历史（含思维链预览）
  routes.get("/sessions/:id/messages", async (c) => {
    const project = requireCurrentProject();
    const sessionId = c.req.param("id");
    const opened = await readProjectSession(project.root, sessionId);
    if (opened === null) {
      throw new HttpError(404, "SESSION_NOT_FOUND", `会话不存在: ${sessionId}`);
    }
    const modelRuntime = await getModelRuntime(); // 历史响应侧无会话运行时：订阅判定与窗口都从进程级模型运行时取
    const usage: ChatUsage = sessionUsage(opened.entries, {
      isUsingSubscription: subscriptionPredicate(modelRuntime),
    });
    const contextUsage = await historyContextUsage(modelRuntime);
    return messagesResponse(c, sessionId, projectSessionMessages(opened.entries), usage, contextUsage);
  });

  // GET /api/v1/chat/sessions/:id/messages/:messageId/thinking —— 思维链全文（按块按需拉取）
  routes.get("/sessions/:id/messages/:messageId/thinking", async (c) => {
    const project = requireCurrentProject();
    const sessionId = c.req.param("id");
    const messageId = c.req.param("messageId");

    const blockIndexParam = c.req.query("blockIndex");
    const blockIndex = blockIndexParam === undefined ? Number.NaN : Number(blockIndexParam);
    if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
      throw new HttpError(400, "VALIDATION_ERROR", "blockIndex 必填且为非负整数");
    }

    const opened = await readProjectSession(project.root, sessionId);
    if (opened === null) {
      throw new HttpError(404, "SESSION_NOT_FOUND", `会话不存在: ${sessionId}`);
    }
    const thinking = readSessionThinking(opened.entries, messageId, blockIndex);
    if (thinking === null) {
      throw new HttpError(404, "THINKING_NOT_FOUND", `该消息没有下标为 ${blockIndex} 的思维链块`);
    }
    return thinkingResponse(c, thinking);
  });

  // DELETE /api/v1/chat/sessions/:id —— 物理删除会话（无回收站；前端二次确认）
  // 校验顺序：在途流（防流把文件原地重建）→ 文件存在性（磁盘发现未命中即 404）
  routes.delete("/sessions/:id", async (c) => {
    const project = requireCurrentProject();
    const sessionId = c.req.param("id");
    if (isSessionInFlight(sessionId)) {
      throw new HttpError(409, "SESSION_BUSY", `会话有在途对话流，请先停止生成再删除: ${sessionId}`);
    }
    const info = await findProjectSession(project.root, sessionId);
    if (info === null) {
      throw new HttpError(404, "SESSION_NOT_FOUND", `会话不存在: ${sessionId}`);
    }
    try {
      unlinkSync(info.path);
    } catch {
      // 发现与删除之间被外部删除：同样是「不存在」
      throw new HttpError(404, "SESSION_NOT_FOUND", `会话不存在: ${sessionId}`);
    }
    return sessionDeleteResponse(c);
  });

  // POST /api/v1/chat —— POST + SSE 对话端点
  routes.post("/", chatSendHandler(deps));

  return routes;
}

/** 默认对话路由实例（index.ts 挂载于 /api/v1/chat） */
export const chatRoutes = createChatRoutes();

/**
 * 响应自检出口（参照 project.ts listResponse）：parse 失败 = 服务端构造的响应不符合 shared 契约，
 * 转 500 INTERNAL_ERROR——不让 ZodError 冒泡（否则 errorHandler 按入参语义误报 400）。
 */
function sessionsResponse(c: Context, sessions: unknown[]): Response {
  try {
    return c.json(ok(chatSessionsResSchema.parse({ sessions })));
  } catch (err) {
    throw new HttpError(500, "INTERNAL_ERROR", `sessions 响应不符合契约: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function messagesResponse(
  c: Context,
  sessionId: string,
  messages: unknown[],
  usage: ChatUsage,
  contextUsage: ChatContextUsage | undefined,
): Response {
  try {
    return c.json(
      ok(
        chatMessagesResSchema.parse({
          sessionId,
          messages,
          usage,
          ...(contextUsage === undefined ? {} : { contextUsage }),
        }),
      ),
    );
  } catch (err) {
    throw new HttpError(500, "INTERNAL_ERROR", `messages 响应不符合契约: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function thinkingResponse(c: Context, thinking: string): Response {
  try {
    return c.json(ok(chatThinkingResSchema.parse({ thinking })));
  } catch (err) {
    throw new HttpError(500, "INTERNAL_ERROR", `thinking 响应不符合契约: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function sessionDeleteResponse(c: Context): Response {
  try {
    return c.json(ok(chatSessionDeleteResSchema.parse({ deleted: true })));
  } catch (err) {
    throw new HttpError(500, "INTERNAL_ERROR", `删除会话响应不符合契约: ${err instanceof Error ? err.message : String(err)}`);
  }
}
