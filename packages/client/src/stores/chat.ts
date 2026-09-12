// 会话状态（chat store：会话归属项目——currentSessionId + 会话列表）
//
// 事件契约 = docs/api/80-api-chat.md「SSE 事件集」：本 store 是**唯一**的事件消费者，
// 服务端推的是 pi AgentSessionEvent 的轻量投影（无 `partial`），事件名与字段不得自行发明。
// 映射（帧 → 状态）：
//   session            → currentSessionId（首帧；新会话续聊身份）
//   ping               → 忽略（fetchSSE 内部据其重置 60s 超时）
//   message_start/end  → message_end 的 assistant 投影为**权威终态**（正文/工具调用/思维链预览）
//   message_update     → text_delta 累积正文；thinking_delta 累积思维链（流式展开）；
//                        toolcall_* 只服务工具卡片元数据（执行卡片由 tool_execution_start 建）
//   tool_execution_*   → 运行时工具卡（start 建行 / end 定终态 + 提案载荷）
//   turn_end/agent_end → contextUsage（占用条口径 = getContextUsage，不是「预算分母」）
//   compaction_*/auto_retry_* → statusNote（轻量提示，不引入新视觉）
//   agent_end          → 终止（stopReason=error/aborted → 错误条；成功 → 刷新会话列表）
//   error              → HTTP 级错误（非 2xx REST 包裹 / 网络失败）：按 code 映射文案
//
// 竞态不变式（改动必须保持）：
// 1. loadSeq / msgSeq 守卫：切项目/切会话使在途请求作废（旧响应不得覆盖新状态）
// 2. 「中止在途 SSE」：重发/切会话/切项目前调 abortCurrentStream（旧流事件不得污染新视图）
// 3. 流身份守卫（streamMsgId）：旧流的 onTimeout/onEnd 不得复位新流的 streaming
// 4. 发送中禁止并发发送（streaming / messagesLoading 期间 sendMessage 直接返回）
import { create } from "zustand";
import type { ChatMessage, ChatSessionSummary } from "@whispering233/ai-editor-shared";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  confirmProposal as confirmProposalApi,
  deleteChatSession,
  getSessionMessages,
  listSessions,
  rejectProposal as rejectProposalApi,
  type SendChatMessageBody,
} from "../lib/api";
import { fetchSSE } from "../hooks/use-sse";
import type { FocusContext } from "../lib/focus";
import { useProjectStore } from "./project";
import { useUiStore } from "./ui";

/** focus context（跨页注入「问 AI」；POST /chat 请求体 context 字段）
 * 定义提移至 lib/focus.ts（ui store currentFocus 共用，避免 store 循环依赖） */
export type { FocusContext } from "../lib/focus";

/** 思维链投影（历史接口/终态消息：只给预览 + 定位参数；全文走按需端点） */
export interface ThinkingPreview {
  preview: string;
  deferred: true;
  blockIndex: number;
  length: number;
}

/**
 * 消息视图模型（client 侧扩展，不改 shared 的 API 契约类型）：
 * - thinking：历史回看的思维链预览（全文按需拉）
 * - thinkingText/thinkingStreaming：**当前流式轮次**的思维链全量 + 是否仍在流式
 *   （流式期间服务端只推 delta，终态帧里只有 240 字预览，故全量在客户端侧累积）
 * - isError：tool 消息是否失败（服务端投影字段）
 */
export interface ChatMessageView extends ChatMessage {
  thinking?: ThinkingPreview[];
  isError?: boolean;
  thinkingText?: string;
  thinkingStreaming?: boolean;
}

/** 运行时工具调用记录（SSE tool_execution_* 事件，瞬态；历史消息走 messages 的 toolCalls/toolCallId 成对渲染） */
export interface StreamToolRecord {
  id: string; // toolCallId（成对重组依据）
  tool: string; // 工具名（get_entity 等）
  args?: unknown;
  result?: unknown; // 工具结果文本（服务端 result.content 的文本拼接）
  isError?: boolean;
 /** running = 已调用未返回；ok = 成功返回；error = 返回错误 */
  status: "running" | "ok" | "error";
}

/** 运行时提案卡片（SSE tool_execution_end 的 result.details，瞬态；历史消息中不保留） */
export interface ProposalCard {
  proposalId: string; // prop_ 前缀
  type: string; // 提案工具名（propose_create_entity 等）
  preview?: unknown;
 /**
 * 处理态：pending 未处理 / confirmed / rejected / stale（409 PROPOSAL_STALE 快照失效）/
 * notFound（404——由 store 直接移除卡片、不落此态，保留仅为类型防御）
 */
  status: "pending" | "confirmed" | "rejected" | "stale" | "notFound";
 /** 处理中（confirm/reject 请求在途，防重复点击；UI 层 pending + 非处理中才可点） */
  processing?: boolean;
}

/** 上下文占用（占用条口径 = pi `getContextUsage()`，随 turn_end / agent_end 帧下发） */
export interface ContextUsage {
  /** tokens / contextWindow（服务端算好的百分比；越界 clamp 见 usageBarView） */
  percent: number;
  tokens: number;
  contextWindow: number;
}

/**
 * 解析帧里的 `contextUsage`：**只接受结构完整且数值可用**的负载，其余一律 null——
 * 调用方据此隐藏占用条；绝不把 0 / NaN / 负窗口写进 store（那会渲染出 Infinity% 或假指标）。
 */
export function parseContextUsage(raw: unknown): ContextUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { percent, tokens, contextWindow } = raw as {
    percent?: unknown;
    tokens?: unknown;
    contextWindow?: unknown;
  };
  if (typeof percent !== "number" || typeof tokens !== "number" || typeof contextWindow !== "number") {
    return null;
  }
  if (!Number.isFinite(percent) || !Number.isFinite(tokens) || !Number.isFinite(contextWindow)) return null;
  if (contextWindow <= 0 || tokens < 0) return null;
  return { percent, tokens, contextWindow };
}

interface ChatState {
 /** 当前项目会话列表（null = 未加载/加载失败） */
  sessions: ChatSessionSummary[] | null;
  sessionsLoading: boolean;
 /** 会话列表加载失败的错误码（CLIENT_NETWORK_ERROR 等；null = 无错误/未加载） */
  sessionsError: string | null;
 /** 当前会话 id（null = 新会话）；随项目切换重置 */
  currentSessionId: string | null;
 /** 加载当前项目会话列表（GET /chat/sessions）；失败记 sessionsError */
  loadSessions: () => Promise<void>;
 /** 选择当前会话并恢复历史（null = 新会话，清空消息区）；Dashboard/Sidebar/右栏下拉共用此入口 */
  setCurrentSession: (id: string | null) => void;
 /** 新建会话 = 切到空会话（清空消息区显示「新会话」） */
  newSession: () => void;
 /** 清空会话状态（关闭项目/切项目；订阅已自动调用，保留为显式入口） */
  clearSessions: () => void;
 /**
 * 物理删除会话（DELETE /chat/sessions/:id，需二次确认由调用方承担）：
 * 成功 → 列表移除 + （删的是当前会话则回「新会话」）+ toast；
 * 失败 → 不改本地列表（404 例外：目标已不存在 → 刷新列表），并**抛出**让确认框保持打开展示错误
 */
  deleteSession: (sessionId: string) => Promise<void>;

 // ---- 消息流 ----
 /** 当前会话消息历史（流式轮的临时 id 消息在结束前保留，切会话重载后替换为真实 id） */
  messages: ChatMessageView[];
  messagesLoading: boolean;
 /** 加载会话历史（GET /chat/sessions/:id/messages → messages；调用前清空重载，含竞态保护） */
  loadMessages: (sessionId: string) => Promise<void>;

 // ---- SSE 运行态 ----
 /** 是否正在流式生成（发送中；输入框禁用 + 「AI 思考中…」） */
  streaming: boolean;
 /** 流错误文案（agent_end 失败 / HTTP 错误 / 网络失败；null = 无） */
  streamError: string | null;
  setStreamError: (err: string | null) => void;
 /** 轻量状态提示（上下文压缩 / 自动重试；null = 无）——文案固定，不引入新视觉样式 */
  statusNote: string | null;

 // ---- focus context（跨页注入） ----
  focusContext: FocusContext | null;
  setFocusContext: (ctx: FocusContext | null) => void;

 /** 上下文占用（turn_end / agent_end 帧的 contextUsage；null = 未收到/非法 → 占用条隐藏） */
  contextUsage: ContextUsage | null;

 /** 「问 AI」聚焦输入框信号：中栏右下悬浮按钮点击后 +1，InputArea 监听后聚焦 textarea——
 * 无页面焦点（currentFocus=null）时用户仍可直接打字提问，按钮不「无反应」 */
  focusInputSeq: number;
  requestFocusInput: () => void;
  clearFocusContext: () => void;

 // ---- 断连横幅 ----
 /** 流中断（60s 无事件）：顶部横幅「上次会话已取消」+ [重新发送] */
  disconnected: boolean;
  setDisconnected: (v: boolean) => void;

 // ---- 瞬态渲染数据（SSE 事件填充） ----
  proposals: ProposalCard[];
  streamTools: StreamToolRecord[];

 /** 发送消息（POST /chat + SSE 流式）：乐观追加 user 消息 + AI 占位；带 focus context 时携带 context */
  sendMessage: (text: string) => void;
 /** 断连横幅 [重新发送]：移除断连残留的重复消息后重发上一条用户消息 */
  resendLast: () => void;

 // ---- 提案确认/拒绝（真实调用 confirm/reject 端点） ----
 /**
 * 确认提案：成功 → status=confirmed（按钮禁用由 status 驱动）；
 * 409 PROPOSAL_STALE → stale（卡标「数据已变化」）；404 NOT_FOUND / 409 MISMATCH → 移除卡片；
 * 其他错误（500 执行失败/网络失败）→ 保持 pending 可重试 + toast 提示
 */
  confirmProposal: (proposalId: string) => Promise<void>;
 /** 拒绝提案：语义同 confirm，成功 → status=rejected */
  rejectProposal: (proposalId: string) => Promise<void>;
}

/**
 * 流错误文案映射（「错误态」）：
 * - 服务端错误码（HTTP 级，开流前/流内 REST 包裹）：按 code 给可执行文案
 * - HTTP 404（旧构建/服务未起）：通用防御文案「聊天服务暂不可用」
 * - 网络层失败（服务未启动/断网）→ 「连接失败，请确认服务已启动」
 * - 服务端/中间层错误（非 2xx 且无 REST 包裹，如 proxy 500，message 含 "HTTP "）→ 透传 message，
 *   不落入「连接失败」误判（CLIENT_NETWORK_ERROR 仅纯网络错误才映射连接失败文案）
 * - agent_end 的 stopReason=error → 透传 errorMessage（真实链路错误走此分支）
 */
export function describeStreamError(code: string, message: string): string {
  switch (code) {
    case "CHAT_BUSY":
      return "当前项目已有正在生成的对话，请稍后再试";
    case "SESSION_BUSY":
      return "该会话正在生成中，请稍后再试";
    case "LLM_API_KEY_MISSING":
      return "未配置模型 API key，请到设置页配置后再试";
    case "SESSION_NOT_FOUND":
      return "会话不存在（可能已被删除），下一条消息将新建会话";
    case "NO_PROJECT_OPEN":
      return "未打开项目，请先打开一本书";
    case "PROJECT_VERSION_NEWER":
      return "项目数据版本高于当前程序，请升级后再打开";
    default:
      break;
  }
  if (message.includes("HTTP 404")) return "聊天服务暂不可用";
  if (code === "CLIENT_NETWORK_ERROR" && !message.includes("HTTP "))
    return "连接失败，请确认服务已启动";
  return message;
}

/**
 * 提案动作非错误的 toast 文案映射（S7.5 三错误码 STALE/NOT_FOUND/MISMATCH
 * 由 store 分支处理、不经此函数）：
 * - INTERNAL_ERROR（500 执行失败）→ 引导重新生成提案（重试仍会失败，不保留重试价值）
 * - CLIENT_NETWORK_ERROR（网络层）→ 重试引导（不透传原始 fetch 错误文本）
 * - 其他（未知码防御兜底）→ 透传服务端 message
 */
export function describeProposalActionError(code: string, message: string): string {
  switch (code) {
    case "INTERNAL_ERROR":
      return "提案执行失败，请让 AI 重新生成提案";
    case "CLIENT_NETWORK_ERROR":
      return "网络请求失败，请重试";
    default:
      return message;
  }
}

// ============ 帧负载读取（结构性窄化；非法负载一律忽略，不抛错） ============

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** assistant 消息的增量事件（message_update.assistantMessageEvent） */
interface AssistantDelta {
  type?: unknown;
  contentIndex?: unknown;
  delta?: unknown;
  content?: unknown;
  contentLength?: unknown;
}

/** pi 工具结果 content（块数组）→ 展示文本（仅取 text 块；非文本块忽略） */
export function toolResultText(result: unknown): string | undefined {
  const record = asRecord(result);
  if (record === null) return undefined;
  const content = record.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .map((block) => {
      const b = asRecord(block);
      return b !== null && b.type === "text" && typeof b.text === "string" ? b.text : "";
    })
    .join("");
}

/** 工具结束帧里的提案载荷（仅 PROPOSAL 工具携带 details；AUTO 工具不下发） */
function proposalFromToolResult(result: unknown): { proposalId: string; type: string; preview?: unknown } | null {
  const details = asRecord(asRecord(result)?.details);
  if (details === null) return null;
  const proposalId = typeof details.proposal_id === "string" ? details.proposal_id : null;
  const type = typeof details.type === "string" ? details.type : null;
  if (proposalId === null || type === null) return null;
  return { proposalId, type, preview: details.preview };
}

/** 会话列表请求序号：项目切换时递增使在途列表请求作废（旧响应不得覆盖新项目状态） */
let loadSeq = 0;
/** 消息历史请求序号：切会话/切项目时递增作废在途请求（同 loadSeq 竞态保护） */
let msgSeq = 0;
/** 本地临时消息 id 序号（user 乐观追加 / AI 流式占位） */
let clientMsgSeq = 0;

/** 在途 SSE 流的 abort 函数（切会话/切项目/重发前终止旧流，防止旧流事件污染新状态） */
let abortCurrentStream: (() => void) | null = null;
/** 当前流式 AI 消息的临时 id（增量按此追加；流作废/结束时置 null） */
let currentStreamMsgId: string | null = null;
/** 上一条发送的用户文本（断连横幅 [重新发送] 用；切会话/项目时清空） */
let lastSentText: string | null = null;

export const useChatStore = create<ChatState>((set, get) => {
 /**
 * 提案动作统一处理（confirm/reject 共用）：
 * 1. 防重复：卡片不存在（已移除）/ 非 pending（已确认/拒绝/失效）/ 处理中（processing）→ 忽略
 * 2. 在途：置 processing=true（按钮禁用防连点）→ 调 API
 * 3. 成功 → status 终态；错误分支见 switch（404/409 MISMATCH → 移除卡片）
 * 注意：请求在途时切会话/切项目会清空 proposals——响应后按 proposalId 在**当前**列表内
 * map/filter 是空操作，天然无跨会话污染
 */
  const runProposalAction = async (
    proposalId: string,
    apiCall: (id: string) => Promise<unknown>,
    successStatus: "confirmed" | "rejected",
  ): Promise<void> => {
    const proposal = get().proposals.find((p) => p.proposalId === proposalId);
    if (!proposal || proposal.status !== "pending" || proposal.processing === true) return;
    set((s) => ({
      proposals: s.proposals.map((p) =>
        p.proposalId === proposalId ? { ...p, processing: true } : p,
      ),
    }));
    try {
      await apiCall(proposalId);
      set((s) => ({
        proposals: s.proposals.map((p) =>
          p.proposalId === proposalId ? { ...p, status: successStatus, processing: false } : p,
        ),
      }));
 // 数据变更信号：确认 = 服务端写库成功，通知中栏页面重拉；拒绝不改数据不触发
      if (successStatus === "confirmed") useUiStore.getState().notifyDataChanged();
    } catch (err) {
 // apiFetch 只抛 ApiError（code 透传服务端 ErrorCode）；非 ApiError 属理论不可达，按网络错误兜底
      const code = err instanceof ApiError ? err.code : "CLIENT_NETWORK_ERROR";
      const message = err instanceof Error ? err.message : "网络请求失败";
      switch (code) {
        case "PROPOSAL_STALE":
          set((s) => ({
            proposals: s.proposals.map((p) =>
              p.proposalId === proposalId ? { ...p, status: "stale", processing: false } : p,
            ),
          }));
          return;
        case "PROPOSAL_NOT_FOUND":
        case "PROPOSAL_PROJECT_MISMATCH":
          set((s) => ({ proposals: s.proposals.filter((p) => p.proposalId !== proposalId) }));
          return;
        default:
          useUiStore.getState().showToast(describeProposalActionError(code, message), "error");
          set((s) => ({
            proposals: s.proposals.map((p) =>
              p.proposalId === proposalId ? { ...p, processing: false } : p,
            ),
          }));
          return;
      }
    }
  };

 /** 更新流式 AI 占位消息（身份守卫：流已作废则不动） */
  const patchStreamMessage = (
    streamMsgId: string,
    patch: (m: ChatMessageView) => ChatMessageView,
  ): void => {
    if (currentStreamMsgId !== streamMsgId) return;
    set((s) => ({
      messages: s.messages.map((m) => (m.id === streamMsgId ? patch(m) : m)),
    }));
  };

  return {
    sessions: null,
    sessionsLoading: false,
    sessionsError: null,
    currentSessionId: null,
    messages: [],
    messagesLoading: false,

    loadSessions: async () => {
 // 并发防抖：已在加载中则跳过（订阅切换项目时先复位 loading 再调用，不受此限）
      if (get().sessionsLoading) return;
      const seq = ++loadSeq;
      set({ sessionsLoading: true });
      try {
        const sessions = await listSessions();
        if (seq !== loadSeq) return; // 请求期间项目已切换，旧列表作废
        set({ sessions, sessionsError: null });
 // 自动激活最近会话：刷新页面/切项目后 currentSessionId 为 null，若列表非空则激活 sessions[0]
 // （服务端按最后活动倒序返回）。守卫：空列表不激活；已有 currentSessionId 不覆盖
        if (get().currentSessionId === null && sessions.length > 0) {
          get().setCurrentSession(sessions[0].id);
        }
      } catch (err) {
        if (seq !== loadSeq) return;
        const code = err instanceof ApiError ? err.code : "CLIENT_NETWORK_ERROR";
        set({ sessions: null, sessionsError: code });
      } finally {
        if (seq === loadSeq) set({ sessionsLoading: false });
      }
    },

    setCurrentSession: (id) => {
 // 同 id 重复点击（下拉点当前会话项）：直接返回，不重载历史、不清 focusContext（避免闪屏）
      if (id === get().currentSessionId) return;
 // 切换会话：作废在途消息请求 + 中止在途流 + 清空消息与瞬态（旧会话的流事件不得污染新视图）
      msgSeq++;
      abortCurrentStream?.();
      abortCurrentStream = null;
      currentStreamMsgId = null;
      lastSentText = null;
      set({
        currentSessionId: id,
        messages: [],
        messagesLoading: false,
        streaming: false,
        streamError: null,
        statusNote: null,
        disconnected: false,
        focusContext: null,
        proposals: [],
        streamTools: [],
 // 瞬时运行态：旧会话的占用数据不得残留到新视图
        contextUsage: null,
      });
      if (id !== null) void get().loadMessages(id); // 恢复历史（fire-and-forget，失败静默 → 空态）
    },

    newSession: () => {
 // 作废在途会话列表请求：点「新会话」时若 loadSessions 在途，其响应不得触发自动激活
      loadSeq++;
      get().setCurrentSession(null);
    },

    clearSessions: () => {
      loadSeq++; // 作废在途列表请求
      msgSeq++; // 作废在途消息请求
      abortCurrentStream?.(); // 中止在途 SSE 流（切项目后旧流事件不得污染新状态）
      abortCurrentStream = null;
      currentStreamMsgId = null;
      lastSentText = null;
      set({
        sessions: null,
        sessionsLoading: false,
        sessionsError: null,
        currentSessionId: null,
        messages: [],
        messagesLoading: false,
        streaming: false,
        streamError: null,
        statusNote: null,
        disconnected: false,
        focusContext: null,
        proposals: [],
        streamTools: [],
        contextUsage: null,
      });
    },

    deleteSession: async (sessionId) => {
      try {
        await deleteChatSession(sessionId);
      } catch (err) {
 // apiFetch 只抛 ApiError（code 透传服务端 ErrorCode）；非 ApiError 属理论不可达，按网络错误兜底
        const code = err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR;
        const message = err instanceof Error ? err.message : "网络请求失败";
        if (code === "SESSION_NOT_FOUND") {
          // 目标已不存在（他处已删/文件被外部删除）：刷新列表对齐 UI，不抛（对话框可关）
          useUiStore.getState().showToast("会话不存在，已刷新列表", "error");
          await get().loadSessions();
          return;
        }
        if (code === "SESSION_BUSY") {
          // 在途生成中：列表不变、保留条目（服务端 409 兜底；UI 侧菜单项已按 streaming 禁用）
          useUiStore.getState().showToast("该会话正在生成中，请稍后再删", "error");
        } else {
          useUiStore.getState().showError(code, message);
        }
        throw err instanceof Error ? err : new Error(message); // 抛回：确认框保持打开并显示错误
      }
 // 成功：列表移除；当前会话被删 → 回「新会话」（清空消息区与瞬态，但不影响列表）
      set((s) => ({
        sessions: s.sessions === null ? null : s.sessions.filter((x) => x.id !== sessionId),
      }));
      if (get().currentSessionId === sessionId) get().newSession();
      useUiStore.getState().showToast("会话已删除");
    },

    loadMessages: async (sessionId) => {
      const seq = ++msgSeq;
      set({ messagesLoading: true });
      try {
        const res = await getSessionMessages(sessionId);
        if (seq !== msgSeq) return; // 请求期间已切会话/项目，旧响应作废
 // 响应条目不含 sessionId：补全为 ChatMessageView（组件渲染与思维链按需拉取用）
        const messages: ChatMessageView[] = res.messages.map((m) => ({
          ...m,
          sessionId: res.sessionId,
        }));
        set({ messages });
      } catch {
        if (seq !== msgSeq) return;
        set({ messages: [] }); // 加载失败静默 → 空态引导语
      } finally {
        if (seq === msgSeq) set({ messagesLoading: false });
      }
    },

    streaming: false,
    streamError: null,
    setStreamError: (err) => set({ streamError: err }),
    statusNote: null,

    focusContext: null,
    setFocusContext: (ctx) => set({ focusContext: ctx }),
    clearFocusContext: () => set({ focusContext: null }),
    contextUsage: null,
    focusInputSeq: 0,
    requestFocusInput: () => set((s) => ({ focusInputSeq: s.focusInputSeq + 1 })),

    disconnected: false,
    setDisconnected: (v) => set({ disconnected: v }),

    proposals: [],
    streamTools: [],

    sendMessage: (text) => {
      const { streaming, messagesLoading, currentSessionId, focusContext } = get();
      const trimmed = text.trim();
 // 空文本 / 已在生成中 / 历史加载中：忽略（输入区与按钮在 UI 层已禁用，此处为状态层防御；
 // 加载中拒绝：乐观消息会被 loadMessages 的 set({ messages }) 整体覆盖、流式 delta 静默丢弃）
      if (!trimmed || streaming || messagesLoading) return;
 // 防御性终止旧流（正常流程中 sendMessage 前不会有在途流）
      abortCurrentStream?.();
      abortCurrentStream = null;

 // 乐观追加 user 消息 + AI 流式占位（临时 id；切换会话重载历史后得到真实 id）
      const now = new Date().toISOString();
      const sessionId = currentSessionId ?? "";
      const streamMsgId = `local-${++clientMsgSeq}`;
      currentStreamMsgId = streamMsgId;
      lastSentText = trimmed;
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: `local-${++clientMsgSeq}`,
            sessionId,
            role: "user",
            content: trimmed,
            createdAt: now,
          },
          { id: streamMsgId, sessionId, role: "assistant", content: "", createdAt: now },
        ],
        streaming: true,
        streamError: null,
        statusNote: null,
        disconnected: false,
        proposals: [], // 新一轮生成：清空上一轮遗留提案（瞬态）
        streamTools: [],
      }));

 // 请求体（POST /chat）：新会话不带 session_id；focus 小条存在时携带 context
      const body: SendChatMessageBody = { message: trimmed };
      if (currentSessionId) body.session_id = currentSessionId;
      if (focusContext) body.context = focusContext;

      abortCurrentStream = fetchSSE("/api/v1/chat", {
        body,
        onEvent: (event, data) => {
          // 流身份守卫（不变式 3 的事件级落点）：旧流的迟到帧不得污染新视图
          // （重发/切会话/切项目只置位 abort，同 chunk 内已排队的帧仍会派发到此处）
          if (currentStreamMsgId !== streamMsgId) return;
          switch (event) {
            case "ping":
              break; // 心跳：忽略（超时重置由 fetchSSE 内部处理）

            case "session": {
 // 首帧：本流所属会话（新建或续聊）——客户端持久化「当前会话」身份
              const sid = asRecord(data)?.session_id;
              if (typeof sid === "string" && sid !== "") set({ currentSessionId: sid });
              break;
            }

            case "agent_start":
            case "turn_start":
              break; // 轮次边界：状态无变化（工具/文本事件自带信息）

            case "message_update": {
 // assistant 增量（服务端已剥离 partial）：text/thinking 累积；toolcall_* 仅元数据（卡片由 execution 事件建）
              const deltaEvent = asRecord(asRecord(data)?.assistantMessageEvent) as AssistantDelta | null;
              if (deltaEvent === null) break;
              if (deltaEvent.type === "thinking_start") {
                patchStreamMessage(streamMsgId, (m) => ({ ...m, thinkingStreaming: true }));
                break;
              }
              if (deltaEvent.type === "thinking_delta") {
                const delta = typeof deltaEvent.delta === "string" ? deltaEvent.delta : "";
                patchStreamMessage(streamMsgId, (m) => ({
                  ...m,
                  thinkingText: (m.thinkingText ?? "") + delta,
                  thinkingStreaming: true,
                }));
                break;
              }
              if (deltaEvent.type === "thinking_end") {
                // 终态帧的 content 已是 240 字预览（全文由本轮 thinking_delta 累积），只需收尾折叠
                patchStreamMessage(streamMsgId, (m) => ({ ...m, thinkingStreaming: false }));
                break;
              }
              if (deltaEvent.type === "text_delta") {
                const delta = typeof deltaEvent.delta === "string" ? deltaEvent.delta : "";
                patchStreamMessage(streamMsgId, (m) => ({
                  ...m,
                  content: (m.content ?? "") + delta,
                }));
              }
              break;
            }

            case "message_start":
              break; // 占位消息已由 sendMessage 建立/或为 user/tool 消息（后者由工具卡与历史渲染覆盖）

            case "message_end": {
 // assistant 终态投影为权威（正文拼接、工具调用、思维链预览）；保留本轮累积的 thinkingText
              const message = asRecord(asRecord(data)?.message);
              if (message === null || message.role !== "assistant") break;
              const content = typeof message.content === "string" ? message.content : "";
              const thinking = Array.isArray(message.thinking)
                ? (message.thinking as ThinkingPreview[])
                : undefined;
              const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : undefined;
              patchStreamMessage(streamMsgId, (m) => ({
                ...m,
                content,
                ...(thinking === undefined ? {} : { thinking }),
                ...(toolCalls === undefined ? {} : { toolCalls }),
                thinkingStreaming: false,
              }));
              break;
            }

            case "tool_execution_start": {
 // 运行时工具卡（折叠行「调用了 {tool}」）
              const frame = asRecord(data);
              const id = frame?.toolCallId;
              const tool = frame?.toolName;
              if (typeof id !== "string" || typeof tool !== "string") break;
              set((s) => ({
                streamTools: [...s.streamTools, { id, tool, args: frame?.args, status: "running" }],
              }));
              break;
            }

            case "tool_execution_update":
              break; // 进度帧：卡片无展示位（结果由 end 定终态）

            case "tool_execution_end": {
              const frame = asRecord(data);
              const id = frame?.toolCallId;
              if (typeof id !== "string") break;
              const isError = frame?.isError === true;
              const result = toolResultText(frame?.result);
              set((s) => ({
                streamTools: s.streamTools.map((t) =>
                  t.id === id ? { ...t, result, isError, status: isError ? "error" : "ok" } : t,
                ),
              }));
 // 提案载荷（仅 PROPOSAL 工具下发 details）
              const proposal = proposalFromToolResult(frame?.result);
              if (proposal !== null) {
                set((s) => ({
                  proposals: [
                    ...s.proposals,
                    { proposalId: proposal.proposalId, type: proposal.type, preview: proposal.preview, status: "pending" as const },
                  ],
                }));
              }
              break;
            }

            case "turn_end": {
 // 轮次结束：占用条数据（口径 = getContextUsage）
              const usage = parseContextUsage(asRecord(data)?.contextUsage);
              if (usage !== null) set({ contextUsage: usage });
              break;
            }

            case "compaction_start":
              set({ statusNote: "正在压缩上下文…" });
              break;

            case "compaction_end": {
              const aborted = asRecord(data)?.aborted === true;
              set({ statusNote: aborted ? "上下文压缩已取消" : "上下文已压缩" });
              break;
            }

            case "auto_retry_start": {
              const frame = asRecord(data);
              const attempt = typeof frame?.attempt === "number" ? frame.attempt : 0;
              const maxAttempts = typeof frame?.maxAttempts === "number" ? frame.maxAttempts : 0;
              set({ statusNote: `请求失败，正在重试（${attempt}/${maxAttempts}）…` });
              break;
            }

            case "auto_retry_end": {
              const frame = asRecord(data);
              set({
                statusNote: frame?.success === true ? null : (typeof frame?.finalError === "string" ? frame.finalError : "重试失败"),
              });
              break;
            }

            case "agent_end": {
              if (currentStreamMsgId !== streamMsgId) break; // 流已作废：不污染新流状态
              const frame = asRecord(data);
              const usage = parseContextUsage(frame?.contextUsage);
              const stopReason = frame?.stopReason;
              const errorMessage = typeof frame?.errorMessage === "string" ? frame.errorMessage : "";
              // 思维链未收到 thinking_end 就结束（模型/传输边界）：同样收尾折叠
              patchStreamMessage(streamMsgId, (m) =>
                m.thinkingStreaming === true ? { ...m, thinkingStreaming: false } : m,
              );
              currentStreamMsgId = null;
              set({
                streaming: false,
                statusNote: null,
                ...(usage === null ? {} : { contextUsage: usage }),
                // 失败/中止：错误条提示（aborted 由断连横幅/主动停止表达，不重复报错）
                ...(stopReason === "error"
                  ? { streamError: describeStreamError("AGENT_ERROR", errorMessage || "模型调用失败") }
                  : {}),
              });
              void get().loadSessions(); // 本轮已落库：刷新列表（摘要/条数/最近活动）
              break;
            }

            case "error": {
 // HTTP 级错误（fetchSSE 在非 2xx / 网络失败时补发）：错误条 + 输入恢复
              const frame = asRecord(data);
              const code = typeof frame?.code === "string" ? frame.code : "";
              const message = typeof frame?.message === "string" ? frame.message : "";
              patchStreamMessage(streamMsgId, (m) =>
                m.thinkingStreaming === true ? { ...m, thinkingStreaming: false } : m,
              );
              currentStreamMsgId = null;
              set({
                streaming: false,
                statusNote: null,
                streamError: describeStreamError(code, message),
                // 会话已不存在（他处删除/文件被外部删除）：丢掉会话身份，下一条消息新建会话
                ...(code === "SESSION_NOT_FOUND" ? { currentSessionId: null } : {}),
              });
              break;
            }
          }
        },
        onTimeout: () => {
 // 60s 无任何事件（半开连接兜底）：横幅「上次会话已取消」+ 清空未确认提案
 // 身份守卫：done 后微窗口内新发一轮时旧流已过期，其超时回调不得污染新流
          if (currentStreamMsgId !== streamMsgId) return;
          patchStreamMessage(streamMsgId, (m) =>
            m.thinkingStreaming === true ? { ...m, thinkingStreaming: false } : m,
          );
          currentStreamMsgId = null;
          set({ streaming: false, disconnected: true, proposals: [], streamTools: [], statusNote: null });
        },
        onEnd: () => {
 // 流正常关闭（服务端 EOF / error 事件终止）：幂等收尾（agent_end/error 已复位 streaming）
 // 身份守卫：同上——旧流的 onEnd 不得复位新流的 streaming / 清空新流身份
          if (currentStreamMsgId !== streamMsgId) return;
          patchStreamMessage(streamMsgId, (m) =>
            m.thinkingStreaming === true ? { ...m, thinkingStreaming: false } : m,
          );
          currentStreamMsgId = null;
          set((s) => (s.streaming ? { streaming: false, statusNote: null } : {}));
        },
      });
    },

    resendLast: () => {
      const { messages, streaming } = get();
      if (streaming || !lastSentText) return;
 // 断连残留清理：无条件移除尾部 assistant（断连语义 = 整轮取消，半截回答一并丢弃），
 // 再移除与重发文本相同的最后一条 user 消息（避免重复气泡）
      let next = messages;
      const last = next[next.length - 1];
      if (last?.role === "assistant") next = next.slice(0, -1);
      const lastUser = next[next.length - 1];
      if (lastUser?.role === "user" && lastUser.content === lastSentText) next = next.slice(0, -1);
      set({ messages: next });
      get().sendMessage(lastSentText);
    },

    confirmProposal: (proposalId) => runProposalAction(proposalId, confirmProposalApi, "confirmed"),
    rejectProposal: (proposalId) => runProposalAction(proposalId, rejectProposalApi, "rejected"),
  };
});

// 项目切换联动：仅在 config.id 真正变化时动作——null → id（打开）清空并加载新列表；
// id → null（关闭）/ id → id'（直接切项目）清空（关闭不请求）。
// 模块加载即订阅；订阅回调不抛错（loadSessions 内部已 catch），不影响 project store 使用者
let prevProjectId: string | null = useProjectStore.getState().config?.id ?? null;
useProjectStore.subscribe((state) => {
  const projectId = state.config?.id ?? null;
  if (projectId === prevProjectId) return;
  prevProjectId = projectId;
 // 清空会话 + 消息 + SSE 运行态（clearSessions 内部中止在途流并作废在途请求）
  useChatStore.getState().clearSessions();
  if (projectId !== null) {
    void useChatStore.getState().loadSessions();
  }
});
