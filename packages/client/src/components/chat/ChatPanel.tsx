// 右栏 ChatPanel（doc/ui/layout.md §2.4 + pages/chat.md U5 契约）：
// 常驻右栏（40% 栏宽，1:5:4 三栏布局），<1024px 折叠为抽屉（fixed + 遮罩，开关在信息条右侧）
// 结构（自上而下）：会话标题行（下拉切换同项目会话 + 新会话）→ 断连横幅 → 错误条 →
//   消息流（user 气泡 / assistant 无气泡宋体排版 / 历史工具折叠记录 / 运行时工具行 / 提案卡）→
//   focus 小条 → 输入区（Enter 发送 / Shift+Enter 换行）
// 无项目打开时整体禁用（灰显 + 「打开项目后可用」，不请求会话数据，chat.md「位置与形态」）
// S7 数据源已接入（S8.1 联调完成）：proposals（提案卡）/ streamTools（运行时工具行）
//   由 SSE 事件经 store 瞬态字段自动填充渲染；提案确认/拒绝按钮仍为锁定态（S8.2 解锁）
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useProjectStore } from "../../stores/project";
import { useChatStore, type FocusContext, type ProposalCard } from "../../stores/chat";
import type { ChatMessage } from "@ai-editor/shared";
import { formatRelativeTime } from "@ai-editor/shared";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

// ============ 文案映射（chat.md：会话切换/提案卡/focus 小条） ============
// 会话相对时间用 shared formatRelativeTime（Sidebar/Dashboard 同源；≥30 天回退绝对时间，非法输入原样返回）

/** 提案 type → 中文标题（chat.md「提案卡片」；未知 type 显示原始名） */
const PROPOSAL_TYPE_LABELS: Record<string, string> = {
  propose_create_entity: "新建实体",
  propose_update_entity: "更新实体",
  propose_add_relation: "新增关系",
  propose_outline_node: "新建大纲节点",
};

/** focus 实体类型 → 中文（focus 小条展示；未知类型显示原文） */
const FOCUS_TYPE_LABELS: Record<string, string> = {
  character: "角色",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
};

/** focus 小条名称（chat.md「focus 小条」：MVP 简化——不查实体名，显示 id 原文 + 类型名；S7 完善：查实体名） */
function focusLabel(ctx: FocusContext): string {
  const name = ctx.focus_entity_id ?? ctx.focus_node_id ?? "";
  const typeLabel = ctx.focus_entity_type
    ? (FOCUS_TYPE_LABELS[ctx.focus_entity_type] ?? ctx.focus_entity_type)
    : ctx.focus_node_id
      ? "大纲节点"
      : "";
  return typeLabel ? `${typeLabel} ${name}` : name || "当前内容";
}

/** 防御性读取历史工具调用字段（tool_calls JSON 列形状见 schema.md，未知形状容错） */
interface ToolCallShape {
  id?: string;
  tool?: string;
  name?: string;
  args?: unknown;
}
const asToolCall = (c: unknown): ToolCallShape => (typeof c === "object" && c !== null ? (c as ToolCallShape) : {});

// ============ 会话标题行：下拉切换同项目会话 + [新会话] ============

function SessionTitleBar({ disabled, onClose }: { disabled: boolean; onClose?: () => void }) {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const setCurrentSession = useChatStore((s) => s.setCurrentSession);
  const newSession = useChatStore((s) => s.newSession);
  // 当前会话 = 列表中 id 匹配项；未选（null）/ 列表未加载 / 不在列表 → 新会话
  const currentSession = sessions?.find((s) => s.id === currentSessionId) ?? null;
  const title = currentSession ? currentSession.lastMessage || "（空会话）" : "新会话";

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2.5">
      <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" disabled={disabled} className="max-w-44 justify-start gap-1 px-1.5">
              <span className="truncate text-sm font-medium" title={title}>
                {title}
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>会话（本项目）</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {sessions && sessions.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">暂无历史会话</div>
          )}
          {sessions?.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onClick={() => setCurrentSession(s.id)}
              className={cn(s.id === currentSessionId && "bg-accent text-accent-foreground")}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{s.lastMessage || "（空会话）"}</span>
                <span className="text-xs text-muted-foreground">
                  {s.messageCount} 条 · {formatRelativeTime(s.updatedAt)}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground"
        disabled={disabled}
        onClick={newSession}
        aria-label="新会话"
        title="新会话"
      >
        <Plus className="size-4" />
      </Button>
      {onClose && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0 text-muted-foreground"
          onClick={onClose}
          aria-label="关闭聊天面板"
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}

// ============ 断连横幅：60s 无事件 / 流中断 → 「上次会话已取消」+ [重新发送]（chat.md「断连」） ============

function DisconnectBanner() {
  const disconnected = useChatStore((s) => s.disconnected);
  const setDisconnected = useChatStore((s) => s.setDisconnected);
  const resendLast = useChatStore((s) => s.resendLast);
  if (!disconnected) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
      <TriangleAlert className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">上次会话已取消</span>
      <Button size="xs" variant="outline" className="shrink-0" onClick={resendLast}>
        重新发送
      </Button>
      <button
        className="shrink-0 rounded p-0.5 hover:bg-destructive/15"
        onClick={() => setDisconnected(false)}
        aria-label="关闭断连提示"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ============ 错误条：error 事件 / 服务未就绪 / 网络失败（chat.md「错误态」） ============

function ErrorBar() {
  const streamError = useChatStore((s) => s.streamError);
  const setStreamError = useChatStore((s) => s.setStreamError);
  if (!streamError) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
      <CircleAlert className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{streamError}</span>
      <button
        className="shrink-0 rounded p-0.5 hover:bg-destructive/15"
        onClick={() => setStreamError(null)}
        aria-label="关闭错误提示"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ============ 工具调用折叠记录行（历史 assistant.toolCalls 与运行时 streamTools 共用） ============

/** 工具调用行：折叠态「调用了 {tool}」，展开显示 args 摘要与结果状态（chat.md「工具调用折叠记录」） */
function ToolCallRow({
  toolName,
  args,
  result,
  status,
}: {
  toolName: string;
  args?: unknown;
  result?: unknown;
  status?: "running" | "ok" | "error";
}) {
  const [open, setOpen] = useState(false);
  // 结果状态图标：成功 ✓ / 失败 ✗ / 进行中无标记（决策 18 成对：tool_result 挂到对应调用行）
  const ok = status === "ok" || result !== undefined;
  return (
    <div className="rounded-md border border-border/70 bg-muted/40 px-2 py-1">
      <button
        className="flex w-full items-center gap-1.5 text-left text-xs text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        <Wrench className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">调用了 {toolName}</span>
        {status === "error" && <span className="shrink-0 text-destructive">✗</span>}
        {ok && <span className="shrink-0 text-primary">✓</span>}
      </button>
      {open && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {typeof args === "string" ? args : JSON.stringify(args ?? {}, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ============ 消息条目：user 气泡 / assistant 无气泡宋体排版 + 历史工具折叠记录 ============

/** 历史 tool 消息按 toolCallId 挂到 assistant.toolCalls 行（决策 18 成对；孤儿半对不渲染） */
function MessageItem({ message, toolResults }: { message: ChatMessage; toolResults: Map<string, ChatMessage> }) {
  if (message.role === "user") {
    // user 气泡：右对齐 bg-secondary 圆角气泡（chat.md 结构图）
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          {message.content}
        </div>
      </div>
    );
  }
  if (message.role === "tool") return null; // tool 消息仅在所属 assistant 调用行内渲染（决策 18）
  // assistant：无气泡纯排版（chat.md：assistant 无气泡纯排版；正文宋体栈 17px/1.72，layout.md §3.3）
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  return (
    <div className="space-y-1.5">
      {toolCalls.map((c, i) => {
        const call = asToolCall(c);
        const callId = call.id ?? `hist-${i}`;
        const resultMsg = callId ? toolResults.get(callId) : undefined;
        return (
          <ToolCallRow
            key={callId}
            toolName={call.tool ?? call.name ?? "工具"}
            args={call.args}
            result={resultMsg?.content}
            status={resultMsg ? "ok" : undefined}
          />
        );
      })}
      {message.content ? (
        <p className="whitespace-pre-wrap font-serif text-[17px] leading-[1.72] text-foreground">{message.content}</p>
      ) : (
        // 空内容（流式占位 / 空消息）：不渲染占位行
        null
      )}
    </div>
  );
}

// ============ 提案卡（chat.md「提案卡片」；S7 接入确认/拒绝 API 后启用按钮） ============

function ProposalCardView({ proposal }: { proposal: ProposalCard }) {
  // S7 接入点：确认 → POST /proposal/:id/confirm（409 PROPOSAL_STALE → 卡标「数据已变化」+ 按钮禁用；
  //   404 → 移除卡片）；拒绝 → POST /proposal/:id/reject。当前 S7 未实现，按钮为锁定态
  const label = PROPOSAL_TYPE_LABELS[proposal.type] ?? proposal.type;
  return (
    <div className="rounded-lg border border-primary/25 bg-primary/5 p-2.5">
      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Sparkles className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">提案：{label}</span>
        {proposal.status === "confirmed" && <span className="shrink-0 text-xs text-primary">✓ 已确认</span>}
        {proposal.status === "rejected" && <span className="shrink-0 text-xs text-muted-foreground">已拒绝</span>}
        {proposal.status === "stale" && <span className="shrink-0 text-xs text-destructive">⚠ 数据已变化，此提案已失效</span>}
      </div>
      {/* preview 按 type 渲染（创建类字段键值 / 更新类 diff 列表 / 大纲类目标位置）：S7 完善结构化渲染，当前 JSON 摘要 */}
      {proposal.preview !== undefined && (
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {typeof proposal.preview === "string" ? proposal.preview : JSON.stringify(proposal.preview, null, 2)}
        </pre>
      )}
      <div className="mt-2 flex gap-1.5">
        {/* S7 接 onClick 前统一硬锁：pending 可点但无 onClick（死按钮误导），全态 disabled；
             disabled 按钮不触发 title（pointer-events-none），S7 接入时删除 disabled 并挂确认/拒绝 API */}
        <Button size="xs" disabled>
          确认
        </Button>
        <Button size="xs" variant="outline" disabled>
          拒绝
        </Button>
      </div>
    </div>
  );
}

// ============ focus 小条：输入区上方「正在讨论：…」（layout.md §4.2，可关闭） ============

function FocusBar() {
  const focusContext = useChatStore((s) => s.focusContext);
  const clearFocusContext = useChatStore((s) => s.clearFocusContext);
  if (!focusContext) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-border bg-accent/40 px-3 py-1.5 text-xs">
      <Sparkles className="size-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">正在讨论：{focusLabel(focusContext)}</span>
      <button
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
        onClick={clearFocusContext}
        aria-label="清除讨论上下文"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ============ 输入区：textarea（Enter 发送 / Shift+Enter 换行）+ 发送按钮 ============

function InputArea({ disabled }: { disabled: boolean }) {
  const [text, setText] = useState("");
  const streaming = useChatStore((s) => s.streaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const canSend = !disabled && !streaming && text.trim().length > 0;

  const handleSend = () => {
    if (!canSend) return;
    sendMessage(text);
    setText(""); // 乐观追加后清空输入（失败由错误条承接，文本可重输）
  };

  return (
    <div className="shrink-0 border-t border-border p-3">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter 发送 / Shift+Enter 换行（chat.md「关键交互·发送」）
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={streaming ? "AI 思考中…" : "输入消息…"}
          rows={1}
          disabled={disabled || streaming}
          className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Button onClick={handleSend} disabled={!canSend} className="shrink-0">
          {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {streaming ? "思考中" : "发送"}
        </Button>
      </div>
    </div>
  );
}

// ============ 消息流：历史消息 + 运行时工具行 + 提案卡 ============

function MessageList({ disabled }: { disabled: boolean }) {
  const messages = useChatStore((s) => s.messages);
  const messagesLoading = useChatStore((s) => s.messagesLoading);
  const streamTools = useChatStore((s) => s.streamTools);
  const proposals = useChatStore((s) => s.proposals);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 历史 tool 消息按 toolCallId 索引（决策 18 成对：assistant.toolCalls ↔ tool.tool_call_id）
  const toolResults = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) {
      if (m.role === "tool" && m.toolCallId) map.set(m.toolCallId, m);
    }
    return map;
  }, [messages]);

  // 新消息/加载完成自动滚动到底部（streaming 期间持续跟随）
  const tail = messages.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail, messagesLoading, streamTools.length, proposals.length]);

  if (disabled) {
    // 无项目打开：右栏禁用（chat.md「位置与形态」：灰显 + 「打开项目后可用」）
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4">
        <MessageSquare className="size-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground/70">打开项目后可用</p>
      </div>
    );
  }

  if (messagesLoading) {
    // 恢复历史加载态（chat.md「状态·加载态」：消息区骨架）
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {[0, 1].map((i) => (
          <div key={i} className="animate-pulse rounded-lg bg-muted/60" style={{ height: 40, width: i % 2 ? "70%" : "90%" }} />
        ))}
      </div>
    );
  }

  const empty = messages.length === 0 && streamTools.length === 0 && proposals.length === 0;
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {empty ? (
        // 空态引导语（chat.md「空态」）
        <div className="flex h-full flex-col items-center justify-center gap-1.5 p-4 text-center">
          <MessageSquare className="size-7 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">试试问：这个设定有没有漏洞？</p>
          <p className="text-sm text-muted-foreground">第 4 章剧情往哪走合理？</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} toolResults={toolResults} />
          ))}
          {/* 运行时工具记录（S7 SSE tool_call/tool_result 事件填充；折叠渲染同历史） */}
          {streamTools.map((t) => (
            <ToolCallRow key={t.id} toolName={t.tool} args={t.args} result={t.result} status={t.status} />
          ))}
          {/* 提案卡片（S7 SSE proposal 事件填充；决策 14 瞬态，流断开即清空） */}
          {proposals.map((p) => (
            <ProposalCardView key={p.proposalId} proposal={p} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 面板内部内容：标题行 + 横幅 + 消息流 + focus 小条 + 输入区 ============

function ChatPanelBody({ onClose }: { onClose?: () => void }) {
  const config = useProjectStore((s) => s.config);
  const disabled = !config;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SessionTitleBar disabled={disabled} onClose={onClose} />
      {!disabled && (
        <>
          <DisconnectBanner />
          <ErrorBar />
        </>
      )}
      <MessageList disabled={disabled} />
      {!disabled && (
        <>
          <FocusBar />
          <InputArea disabled={disabled} />
        </>
      )}
    </div>
  );
}

// ============ 外壳：桌面静态右栏（≥1024px） / 小屏抽屉（<1024px） ============

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // 桌面（≥1024px）：右栏 40% 静态列（1:5:4 严格比例，layout.md §0）
  if (isDesktop) {
    return (
      <aside className="flex min-w-0 flex-[4_1_40%] flex-col border-l border-border bg-background">
        <ChatPanelBody />
      </aside>
    );
  }

  // 小屏（<1024px）：fixed 抽屉 + 遮罩；关闭时不渲染
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      {/* 遮罩：点击关闭 */}
      <div className="absolute inset-0 bg-foreground/40 animate-in fade-in" onClick={onClose} />
      {/* 抽屉：右侧滑入 */}
      <div className="absolute inset-y-0 right-0 w-[85vw] max-w-md border-l border-border bg-background shadow-xl animate-in slide-in-from-right duration-300">
        <ChatPanelBody onClose={onClose} />
      </div>
    </div>
  );
}
