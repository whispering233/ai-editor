// 右栏 ChatPanel（U5）：
// 常驻右栏（桌面态宽度 = clamp(视口×40%, 240, 960)，中栏吸收剩余——1:5:4 在 1600-2400 视口精确成立，
// 见 DESIGN.md §Layout），<1024px 折叠为抽屉（fixed + 遮罩，开关在信息条右侧）
// 结构（自上而下）：会话标题行（下拉切换同项目会话 + 新会话）→ 断连横幅 → 错误条 →
// 消息流（user 气泡 / assistant 无气泡宋体排版 / 历史工具折叠记录 / 运行时工具行 / 提案卡）→
// focus 小条 → 输入区（Enter 发送 / Shift+Enter 换行）
// 无项目打开时整体禁用（灰显 + 「打开项目后可用」，不请求会话数据，「位置与形态」）
// S7 数据源已接入（S8.1 联调完成）：proposals（提案卡）/ streamTools（运行时工具行）
// 由 SSE 事件经 store 瞬态字段自动填充渲染；提案确认/拒绝已接 S7.5 真实 API（S8.2 解锁，
// store 驱动状态迁移：confirmed/rejected/stale 终态 + 404 移除卡片）
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { Bubble, Conversations, Sender } from "@ant-design/x";
import type { ConversationItemType } from "@ant-design/x";
import { Alert, Badge, Button, Collapse, Dropdown as AntDropdown, Select, Tag, theme } from "antd";
import type { MenuProps } from "antd";
import {
  BulbOutlined,
  CloseOutlined,
  DoubleRightOutlined,
  DownOutlined,
  MessageOutlined,
  PlusOutlined,
  RightOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import Markdown from "@ant-design/x-markdown";
import { useMediaQuery } from "../../hooks/use-media-query";
import { CHAT_MIN_WIDTH } from "../../hooks/use-panels";
import { useProjectStore } from "../../stores/project";
import {
  getDecomposeJob,
  getSessionThinking,
  getSettingsLlm,
  resolveNames,
  updateSettingsLlm,
  type ResolvedNames,
  type SettingsLlmConfig,
  type ThinkingLevel,
} from "../../lib/api";
import { isDecomposeSession, isJobRunning } from "../../lib/decompose";
import { TypeChip } from "../ui/tag-chip";
import {
  collectIdCandidates,
  summarizePreview,
  summarizeToolCall,
} from "../../lib/tool-call-summary";
import {
  useChatStore,
  type ChatMessageView,
  type FocusContext,
  type ProposalCard,
} from "../../stores/chat";
import { SessionStatusBar } from "./session-status-bar";
import type { ChatSessionSummary } from "@whispering233/ai-editor-shared";

import { formatRelativeTime } from "@whispering233/ai-editor-shared";
import { cn } from "../../lib/utils";
import { skeletonClass } from "../../lib/styles";
import { ConfirmDialog } from "../outline/dialogs";

// ============ 文案映射（会话切换/提案卡/focus 小条） ============
// 会话相对时间用 shared formatRelativeTime（Sidebar/Dashboard 同源；≥30 天回退绝对时间，非法输入原样返回）

/** 提案 type → 中文标题（「提案卡片」；未知 type 显示原始名） */
const PROPOSAL_TYPE_LABELS: Record<string, string> = {
  propose_create_entity: "新建实体",
  propose_update_entity: "更新实体",
  propose_add_relation: "新增关系",
  propose_outline_node: "新建大纲节点",
  // F9 + G2 修订：时间轴 AI 排序提案（propose_reorder_timepoints 取代 propose_reorder_events——
  // 事件不再带 time_label，语义序载体为时间点实体，见 「AI 排序入口」）
  propose_reorder_timepoints: "重排时间轴时间点",
};

/** focus 实体类型 → 中文（focus 小条展示；未知类型显示原文） */
const FOCUS_TYPE_LABELS: Record<string, string> = {
  character: "角色",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  event: "事件",
  timepoint: "时间点",
  reference: "参考资料",
};

/**
 * focus 小条文案（C2，用户反馈 #2：不再直显裸 entity id）。
 * name 三态：string = names/resolve 解析出的名称；null = 解析失败（退 id，信息不丢）；
 * undefined = 解析中（只显示类型名，不闪 id）。无类型时仅显示名称，皆空 → 「当前内容」。
 */
export function focusLabel(ctx: FocusContext, name?: string | null): string {
  const raw = ctx.focus_entity_id ?? ctx.focus_node_id ?? "";
  const typeLabel = ctx.focus_entity_type
    ? (FOCUS_TYPE_LABELS[ctx.focus_entity_type] ?? ctx.focus_entity_type)
    : ctx.focus_node_id
      ? "大纲节点"
      : "";
  const display = name === undefined ? "" : (name ?? raw);
  if (typeLabel && display) return `${typeLabel} ${display}`;
  return typeLabel || display || "当前内容";
}

/** 防御性读取历史工具调用字段（tool_calls JSON 列形状见，未知形状容错） */
interface ToolCallShape {
  id?: string;
  tool?: string;
  name?: string;
  args?: unknown;
}
/**
 * 渲染层双形态归一（修历史行展开显示 `{}`）：
 * - 落库/续聊重建形态 = LLM wire 形状 { id, type: "function", function: { name, arguments: string } }
 *   （server chat.ts 直存 agent 输出，存储不动——续聊重建依赖该形状回喂模型）
 * - 运行时 SSE tool_call 事件 = 内部形状 { id, tool, args }
 * 归一输出内部形状；wire.arguments 为 JSON 串 → parse 失败保留原文（原始渲染兜底）
 */
export const asToolCall = (c: unknown): ToolCallShape => {
  if (typeof c !== "object" || c === null) return {};
  const wire = c as {
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: unknown };
  };
  if (wire.type === "function" && wire.function) {
    let args: unknown = wire.function.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        // parse 失败（非常规 JSON）保留原串，渲染兜底展示原文
      }
    }
    return { id: wire.id, tool: wire.function.name, name: wire.function.name, args };
  }
  return wire as ToolCallShape;
};

// ============ 输入区配置行：模型选择 + 思考强度 ============
// 位置：输入框正下方（用户反馈 #1——原先占着标题行下方，白占消息流高度）；两端对齐（反馈 #2）
// 回归纯配置：占用条已随会话状态栏下移一行（DESIGN.md `session-status-bar`——观测层与交互控件分层）

/** 思考强度档位（参考 pi ThinkingLevel：off/minimal/low/medium/high/xhigh/max；显示英文原文） */
const THINKING_LEVEL_OPTIONS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function ComposerConfigRow() {
  const [settings, setSettings] = useState<SettingsLlmConfig | null>(null);

  // 挂载后拉取 LLM 设置（激活 provider + 各家模型目录/key 状态 + 思考强度；失败静默——配置行降级隐藏）；
  // 无项目时本组件不渲染（父层 `!disabled`），故不需要 disabled 透传
  useEffect(() => {
    let cancelled = false;
    void getSettingsLlm()
      .then((res) => {
        if (!cancelled) setSettings(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 当前激活 provider 及其模型（撞名模型靠 provider 消歧——value 用 `${provider}::${model}` 复合）
  const activeProvider = settings?.providers.find((p) => p.id === settings.provider) ?? null;
  const currentModel = activeProvider?.models.find((m) => m.id === settings?.model) ?? null;
  /** 激活 provider 无有效 key → 整条工具条禁用（提示去设置页配 key） */
  const activeKeyless = settings !== null && (activeProvider === null || !activeProvider.authConfigured);

  /** 切换模型（选中即激活 provider+model 一对——跨 provider 选择时 key 来源同步切换） */
  function changeModel(composite: string): void {
    const sep = composite.indexOf("::");
    if (sep <= 0) return;
    const provider = composite.slice(0, sep);
    const id = composite.slice(sep + 2);
    setSettings((s) => (s ? { ...s, provider, model: id } : s)); // 乐观更新（失败静默，下拉回后端实际值）
    void updateSettingsLlm({ provider, model: id }).catch(() => {});
  }

  function changeThinking(level: ThinkingLevel): void {
    setSettings((s) => (s ? { ...s, thinkingLevel: level } : s));
    void updateSettingsLlm({ thinking_level: level }).catch(() => {});
  }

  if (settings === null) return null; // 设置未拉取：不阻塞聊天

  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <Select
        size="small"
        // 宽度：按内容自适应（模型名自然宽实测 135px），上限 192px；窄栏由 min-w-0 允许收缩
        className="min-w-0 max-w-48"
        // 浮层不跟随触发器宽度——跟随即截断（旧实现 112px 触发器把 DeepSeek V4 Flash 掐成 DeepSe…）
        popupMatchSelectWidth={false}
        value={`${settings.provider}::${settings.model}`}
        onChange={(value) => changeModel(value)}
        title={
          activeKeyless
            ? "当前 provider 未配置 API key：请切换到其他 provider 或在设置页配置"
            : "选择模型（按 provider 分组；未配置凭证的组禁用）"
        }
        aria-label="选择模型"
        options={settings.providers
          // pi 全量 provider（40 家、近千个模型）：下拉只列**已配置认证**的组 + 当前激活组
          // （未配置的组整组不可选，列出来只会把下拉撑成不可用；设置页负责引导录入 key）
          .filter((p) => p.authConfigured || p.id === settings.provider)
          .map((p) => {
            // 激活 provider 的组恒可选（无 key 时也允许切走/停留——防困死）；其余无 key 组禁用
            // （antd 分组对象无 disabled——组级禁用下推到组内每个 option）
            const groupDisabled = !p.authConfigured && p.id !== settings.provider;
            return {
              label: `${p.displayName}${p.authConfigured ? "" : "（未配置）"}`,
              options: p.models.map((m) => ({
                value: `${p.id}::${m.id}`,
                label: m.displayName ?? m.id,
                disabled: groupDisabled,
              })),
            };
          })}
      />
      <div className="flex shrink-0 items-center gap-1.5">
        <Select
          size="small"
          className="w-max shrink-0"
          // 同模型选择：浮层不跟随触发器宽度（跟随即截断——62.75px 触发器把 `minimal`/`medium`/`xhigh` 截成 `m…`/`xh…`）
          popupMatchSelectWidth={false}
          value={settings.thinkingLevel}
          disabled={activeKeyless || !currentModel?.reasoning}
          onChange={(value) => changeThinking(value as ThinkingLevel)}
          title="Thinking level"
          aria-label="思考强度"
          options={THINKING_LEVEL_OPTIONS.map((l) => ({ value: l, label: l }))}
        />
      </div>
    </div>
  );
}

// ============ 会话标题行：下拉切换同项目会话 + [新会话] ============
// - 为什么不用 `AntDropdown + Menu`：**Dropdown 自带一套 menu 样式，不吃 `Menu` 组件 token**
//   （`antd/es/dropdown/style/index.js` 的 `&-selected { backgroundColor: controlItemBgActive }`），
//   而 `controlItemBgActive` = 派生 `colorPrimaryBg`——本仓主色 seed 是深墨 #37352f，实测选中面
//   `rgb(120,119,113)` 压 `rgb(55,53,47)` 字 = 对比度 ~1.9:1 不可读（即用户报的「选中会话看不清字」）。
// - x `Conversations` 的选中/悬浮面走全局 `colorBgTextHover`（6% 黑灰面）+ `colorText` 字色，可读。

/**
 * 会话显示标题（列表项 / 标题按钮 / 删除确认框共用）：**会话名优先**（pi `session_info` 条目——
 * 拆解会话 = 「《书名》拆解」），其次末条摘要，最后「（空会话）」。
 */
export function sessionTitle(session: ChatSessionSummary): string {
  const name = session.name?.trim() ?? "";
  return name !== "" ? name : session.lastMessage || "（空会话）";
}

/**
 * 会话列表项（导出供渲染走查测试）：两行 = 标题 + 「条数 · 相对时间」；
 * 拆解会话（`decompose-` 前缀）带中性 `type-badge`「拆解」；
 * sessions 为 null（未加载）/ 空数组（无历史）→ 单条禁用提示项（x Conversations 无空态样式）。
 */
export function sessionItems(sessions: ChatSessionSummary[] | null): ConversationItemType[] {
  if (sessions === null || sessions.length === 0) {
    return [{ key: "__empty__", label: "暂无历史会话", disabled: true }];
  }
  return sessions.map((ss) => ({
    key: ss.id,
    label: (
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-sm">{sessionTitle(ss)}</span>
          {isDecomposeSession(ss.id) && <TypeChip className="shrink-0">拆解</TypeChip>}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {ss.messageCount} 条 · {formatRelativeTime(ss.updatedAt)}
        </span>
      </span>
    ),
  }));
}

/** 会话项菜单唯一项 key（导出供测试断言） */
export const MENU_KEY_DELETE_SESSION = "delete-session";

/**
 * 会话项操作菜单（DESIGN.md `chat-session-item-menu`；导出供渲染走查测试）：
 * 仅一项「删除会话」（antd danger 样式由 token 派发）；两种禁用：`streaming`（在途生成，服务端 409
 * `SESSION_BUSY` 兜底）/ `jobRunning` 且该项是拆解会话（拆解 job 在跑，服务端 409
 * `DECOMPOSE_JOB_RUNNING` 兜底——删文件会被在途任务原地重建）。
 *
 * 已知口径（有意）：一项目一 job（最新一行），故 job 在跑时同项目的拆解会话**一律**禁删；
 * 历史 job 的会话实际仍可删（服务端按会话 id ↔ job id 精确判定）。精确到「该项属于在跑的那个 job」
 * 需要 client 重抄服务端 `decomposeSessionId` 的 id 清洗规则——宁可少禁一点场景，也不两份清洗逻辑。
 * 浮层面由 x 的内部 Dropdown 承担（canvas 面 = `colorBgElevated`）。
 */
export function sessionItemMenu(
  streaming: boolean,
  jobRunning: boolean,
  onDelete: (sessionId: string) => void,
): (item: ConversationItemType) => MenuProps {
  return (item) => ({
    items: [
      {
        key: MENU_KEY_DELETE_SESSION,
        label: "删除会话",
        danger: true,
        disabled: streaming || (jobRunning && isDecomposeSession(item.key)),
      },
    ],
    onClick: ({ key, domEvent }) => {
 // 阻止冒泡：菜单点击不得触发会话项选中
      domEvent.stopPropagation();
      if (key === MENU_KEY_DELETE_SESSION) onDelete(item.key);
    },
  });
}

function SessionTitleBar({
  disabled,
  onClose,
  onToggleCollapse,
}: {
  disabled: boolean;
  onClose?: () => void;
  /** 收起右栏回调（F7：仅桌面静态栏传入——抽屉模式无收起能力）；渲染收起按钮 */
  onToggleCollapse?: () => void;
}) {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const setCurrentSession = useChatStore((s) => s.setCurrentSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const streaming = useChatStore((s) => s.streaming);
  const projectId = useProjectStore((s) => s.config?.id ?? null);
  // 当前会话 = 列表中 id 匹配项；未选（null）/ 列表未加载 / 不在列表 → 新会话
  const currentSession = sessions?.find((s) => s.id === currentSessionId) ?? null;
  const title = currentSession ? sessionTitle(currentSession) : "新会话";
  /** 弹层开关（自定义弹层不经 Menu 上报点击，不会自动关——选中项后手动关） */
  const [open, setOpen] = useState(false);
  /** 待删除会话（非 null 时渲染二次确认对话框） */
  const [deleteTarget, setDeleteTarget] = useState<ChatSessionSummary | null>(null);
  /** 当前项目的拆解 job 是否在跑（删除项禁用条件之一） */
  const [jobRunning, setJobRunning] = useState(false);

  // 下拉打开时现拉一次 job 状态：聊天面板常驻，不为此挂常驻轮询（`useDecomposeJob` 是页面级进度轮询）；
  // 打开后才起的 job 让这里的状态过期 → 服务端 409 `DECOMPOSE_JOB_RUNNING` 兜底（转 toast）
  function refreshJobRunning(): void {
    if (projectId === null) {
      setJobRunning(false);
      return;
    }
    void getDecomposeJob()
      .then((job) => setJobRunning(isJobRunning(job.status)))
      .catch(() => setJobRunning(false)); // 404 无 job / 网络失败：不拦删除（服务端仍是权威）
  }

  const conversationItems = useMemo(() => sessionItems(sessions), [sessions]);
  // 菜单由每项自行渲染（键由项回调透传）；菜单项按 streaming / job 在跑禁用（服务端 409 兼底）
  const itemMenu = useMemo(
    () =>
      sessionItemMenu(streaming, jobRunning, (sessionId) => {
        const target = sessions?.find((s) => s.id === sessionId) ?? null;
        if (target !== null) setDeleteTarget(target);
      }),
    [streaming, jobRunning, sessions],
  );

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2.5">
      <MessageOutlined className="shrink-0 text-muted-foreground" />
      <AntDropdown
        disabled={disabled}
        trigger={["click"]}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) refreshJobRunning();
        }}
        // 弹层 = x Conversations（项高 40px 是 x 默认值，本项目两行内容用 styles.item 抬到 auto）
        // 浮层面自补：旧的路由是 `AntDropdown + Menu`，那层面由 `.ant-dropdown-menu` 提供——换成 Conversations
        // 后弹层根只剩定位（背景透明、padding 0），故按 `ui/context-menu.tsx` 的同一套自绘浮层类补上
        // （bg-popover / shadow-md / ring-1 = DESIGN.md `dropdown-panel`：canvas 面 + 1px hairline + 仅浮层才有的阴影）
        popupRender={() => (
          <Conversations
            items={conversationItems}
            activeKey={currentSessionId ?? undefined}
            onActiveChange={(key) => {
              setCurrentSession(key);
              setOpen(false);
            }}
            menu={itemMenu}
            classNames={{ root: "rounded-lg bg-popover shadow-md ring-1 ring-foreground/10" }}
            styles={{
              root: { width: 320, maxHeight: 320 },
              item: { height: "auto", minHeight: 40, paddingBlock: 6 },
            }}
          />
        )}
      >
        <Button size="small" disabled={disabled} className="max-w-44 min-w-0">
          <span className="truncate text-sm font-medium" title={title}>
            {title}
          </span>
          <DownOutlined className="shrink-0 text-xs" />
        </Button>
      </AntDropdown>
      <Button
        color="default" variant="text"
        size="small"
        className="shrink-0"
        disabled={disabled}
        onClick={newSession}
        aria-label="新会话"
        title="新会话"
        icon={<PlusOutlined />}
      />
      {onToggleCollapse && (
        <Button
          color="default" variant="text"
          size="small"
          className="ml-auto shrink-0"
          onClick={onToggleCollapse}
          aria-label="收起聊天面板"
          title="收起聊天面板"
          // 图标 = 面板折叠同一族镜像对（DESIGN.md `icon-button`）：收起 = `»`（朝本侧边缘）
          icon={<DoubleRightOutlined />}
        />
      )}
      {onClose && (
        <Button
          color="default" variant="text"
          size="small"
          className="ml-auto shrink-0"
          onClick={onClose}
          aria-label="关闭聊天面板"
          icon={<CloseOutlined />}
        />
      )}
      {/* 删除会话二次确认（DESIGN.md `chat-session-item-menu`：danger + 「删除后无法恢复」）；
          onConfirm 抛错时对话框保持打开并显示错误，仅成功才关闭 */}
      {deleteTarget !== null && (
        <ConfirmDialog
          title="删除会话"
          description={
            isDecomposeSession(deleteTarget.id)
              ? `将删除拆解过程记录「${sessionTitle(deleteTarget)}」及其 ${deleteTarget.messageCount} 条消息——删除只影响过程记录，拆解数据不受影响。`
              : `将删除会话「${sessionTitle(deleteTarget)}」及其 ${deleteTarget.messageCount} 条消息，删除后无法恢复。`
          }
          confirmLabel="确认删除"
          danger
          onConfirm={() => deleteSession(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ============ 断连横幅：60s 无事件 / 流中断 → 「上次会话已取消」+ [重新发送]（「断连」） ============

function DisconnectBanner() {
  const disconnected = useChatStore((s) => s.disconnected);
  const setDisconnected = useChatStore((s) => s.setDisconnected);
  const resendLast = useChatStore((s) => s.resendLast);
  if (!disconnected) return null;
  return (
    <Alert
      banner
      type="warning"
      showIcon
      message="上次会话已取消"
      action={
        <Button size="small" onClick={resendLast}>
          重新发送
        </Button>
      }
      closable
      onClose={() => setDisconnected(false)}
    />
  );
}

// ============ 错误条：error 事件 / 服务未就绪 / 网络失败（「错误态」） ============

function ErrorBar() {
  const streamError = useChatStore((s) => s.streamError);
  const setStreamError = useChatStore((s) => s.setStreamError);
  if (!streamError) return null;
  return (
    <Alert
      banner
      type="error"
      showIcon
      message={streamError}
      closable
      onClose={() => setStreamError(null)}
    />
  );
}

// ============ 工具调用折叠记录行（历史 assistant.toolCalls 与运行时 streamTools 共用） ============

/** 工具调用行：折叠态「调用了 {tool}」，展开显示 args 摘要与结果状态（「工具调用折叠记录」；导出供渲染走查测试）
 * 展开态摘要渲染——id 参数经 names/resolve 解析为名称（不显示裸 id）；
 * 解析失败/未知工具 → 回退原始 JSON（不丢信息） */
export function ToolCallRow({
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
  // 展开态（受控——懒解析依赖 open；Collapse onChange 驱动）
  const [open, setOpen] = useState(false);
  /** id 批量解析结果（null = 未展开/解析中）；解析请求失败 → resolveFailed → 回退原始 JSON */
  const [names, setNames] = useState<ResolvedNames | null>(null);
  const [resolveFailed, setResolveFailed] = useState(false);
  // 结果状态：成功 ✓（result 挂载即成功）/ 失败 ✗ / 进行中（Badge processing）
  const ok = status === "ok" || result !== undefined;
  const err = status === "error";

  // 展开时收集 args 中的 id 候选 → names/resolve 批量解析（历史回放/流式同路径）；
  // 无候选不发请求；折叠/参数变化 → 重置（重新展开再解析）
  useEffect(() => {
    if (!open) {
      setNames(null);
      setResolveFailed(false);
      return;
    }
    const candidates = collectIdCandidates(args);
    if (candidates.length === 0) {
      setNames({});
      setResolveFailed(false);
      return;
    }
    let cancelled = false;
    setNames(null); // 重新展开 → 解析中（id 字段暂省略，完成后补全）
    setResolveFailed(false);
    void resolveNames(candidates)
      .then((res) => {
        if (!cancelled) setNames(res.names);
      })
      .catch(() => {
        if (!cancelled) setResolveFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, args]);

  // 摘要行：names=null（解析中）时 id 字段省略、非 id 字段照常（解析完成后自动补全）
  const summary = useMemo(
    () =>
      names === null ? null : summarizeToolCall(toolName, args as Record<string, unknown>, names),
    [toolName, args, names],
  );

  return (
    <Collapse
      ghost
      size="small"
      activeKey={open ? ["args"] : []}
      onChange={(keys) => setOpen(keys.includes("args"))}
      items={[
        {
          key: "args",
          label: (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <ToolOutlined className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">调用了 {toolName}</span>
              {err ? (
                <Badge status="error" title="调用失败" />
              ) : ok ? (
                <Badge status="success" title="调用成功" />
              ) : (
                <Badge status="processing" title="调用中" />
              )}
            </span>
          ),
          children: (
            <div className="max-h-40 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
              {/* 摘要渲染优先；未知工具 / 解析请求失败 → 原始 JSON 兜底 */}
              {resolveFailed || summary === null ? (
                <pre>{typeof args === "string" ? args : JSON.stringify(args ?? {}, null, 2)}</pre>
              ) : (
                <ul className="space-y-0.5">
                  {summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}

// ============ 思维链（DESIGN.md `thinking-block`：默认折叠为一行摘要，流式期间自动展开） ============

/**
 * 思维链块（导出供渲染走查测试）。两种数据形态共用一套渲染：
 * - **流式轮**（`live`）：文本由 `thinking_delta` 在客户端累积（全量），流式期间自动展开、结束后自动折叠；
 * - **历史回看**（`deferred`）：只有 240 字预览（`docs/api/80-api-chat.md` 按需端点契约），
 *   点展开才拉全文（带加载/失败态）。
 * 视觉：折叠 = 一行 caption + chevron（tertiary 字色，无底色无描边）；
 * 展开 = surface-soft 底 + 左侧 2px hairline-strong 竖线 + 限高 200px。
 */
export function ThinkingBlock({
  text,
  length,
  live = false,
  deferred = false,
  onRequestFull,
}: {
  /** 当前可见文本（live = 全量累积；历史 = 预览） */
  text: string;
  /** 原文总字数（摘要行展示；缺省回落当前文本长度） */
  length: number;
  /** 流式进行中（自动展开；结束后自动折叠） */
  live?: boolean;
  /** 全文未拉取（展开时调 onRequestFull） */
  deferred?: boolean;
  /** 拉全文（返回全文文本；抛错 → 失败态） */
  onRequestFull?: () => Promise<string>;
}) {
  const [open, setOpen] = useState(live);
  const [full, setFull] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // 折叠时序：开始流式 → 自动展开；本轮结束（live 变 false）→ 自动折叠为摘要行
  useEffect(() => {
    setOpen(live);
  }, [live]);

  const count = length > 0 ? length : text.length;
  const display = full ?? text;

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (!next || !deferred || full !== null || onRequestFull === undefined) return;
    setLoading(true);
    setFailed(false);
    void onRequestFull()
      .then((value) => setFull(value))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-left text-muted-foreground"
      >
        {open ? (
          <DownOutlined className="shrink-0 text-xs" />
        ) : (
          <RightOutlined className="shrink-0 text-xs" />
        )}
        <span className="min-w-0 truncate">思考过程 · {count} 字</span>
      </button>
      {open && (
        <div className="mt-1 max-h-48 overflow-auto border-l-2 border-input bg-muted px-2 py-1.5 text-xs whitespace-pre-wrap text-foreground/80">
          {loading ? "思维链加载中…" : failed ? "思维链加载失败" : display}
        </div>
      )}
    </div>
  );
}

// ============ 消息条目：user 气泡 / assistant 无气泡排版 + 思维链 + 历史工具折叠记录 ============

/** 历史 tool 消息按 toolCallId 挂到 assistant.toolCalls 行（成对；孤儿半对不渲染；导出供渲染走查测试） */
export function MessageItem({
  message,
  toolResults,
}: {
  message: ChatMessageView;
  toolResults: Map<string, ChatMessageView>;
}) {
  const { token } = theme.useToken();
  if (message.role === "user") {
    // user 气泡：右对齐（Bubble placement=end）；底色 = DESIGN.md `chat-bubble-user` 的
    // {colors.surface-muted}（= colorFillTertiary）。⚠ 不用 colorPrimaryBg：主色 seed 是深墨
    // #37352f，antd 派生的 colorPrimaryBg 实测为 #787771（中灰）——灰底压墨字对比度 ~1.9:1，不可读；
    // design-discipline.test.ts 有 primary-bg-token 守卫拦这个坑），字色随双算法切换。
    return (
      <div className="flex justify-end">
        <Bubble
          placement="end"
          content={message.content ?? ""}
          styles={{
            content: { background: token.colorFillTertiary, color: token.colorText },
            root: { maxWidth: "85%" },
          }}
        />
      </div>
    );
  }
  if (message.role === "tool") return null; // tool 消息仅在所属 assistant 调用行内渲染
  // assistant：x-markdown 流式正文（增量渲染内建：已完成消息 content 引用稳定，React.memo 不重渲；
  // 流式尾部块由 x-markdown streaming 优化处理）
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const content = message.content ?? "";
  const liveThinking = message.thinkingText;
  const historyThinking = message.thinking ?? [];
  return (
    <div className="space-y-1.5">
      {/* 思维链：流式轮全量（自动展开/折叠）；历史轮 240 字预览 + 按需拉全文。
          二选一渲染：message_end 后同一消息同时带 thinkingText（本轮累积）与 thinking（服务端预览）——
          两者都渲会出两个「思考过程」块（K6 oracle D1）。 */}
      {liveThinking !== undefined && liveThinking !== "" ? (
        <ThinkingBlock text={liveThinking} length={liveThinking.length} live={message.thinkingStreaming === true} />
      ) : (
        historyThinking.map((t) => (
          <ThinkingBlock
            key={`thinking-${t.blockIndex}`}
            text={t.preview}
            length={t.length}
            deferred={t.deferred}
            onRequestFull={() =>
              getSessionThinking(message.sessionId, message.id, t.blockIndex).then((res) => res.thinking)
            }
          />
        ))
      )}
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
            status={resultMsg?.isError === true ? "error" : resultMsg ? "ok" : undefined}
          />
        );
      })}
      {content.trim() !== "" ? (
        <Bubble content={<Markdown>{content}</Markdown>} />
      ) : // 空内容（流式占位 / 空消息）：不渲染（流式思考指示器由 MessageList 提供）
      null}
    </div>
  );
}

// ============ 提案卡（「提案卡片」；S8.2 已接 S7.5 confirm/reject 真实调用） ============

/** 提案卡（「提案卡片」；S8.2 已接 S7.5 confirm/reject 真实调用；导出供渲染走查测试）
 * preview 摘要化渲染（summary/changes/args 人类可读，不再 JSON dump） */
export function ProposalCardView({ proposal }: { proposal: ProposalCard }) {
  const confirmProposal = useChatStore((s) => s.confirmProposal);
  const rejectProposal = useChatStore((s) => s.rejectProposal);
  const label = PROPOSAL_TYPE_LABELS[proposal.type] ?? proposal.type;
  // 终态（confirmed/rejected/stale）与处理中（processing 在途）：按钮禁用——
  // 409 PROPOSAL_STALE 由 store 标 stale（卡标文案见上）+ 按钮随之禁用；
  // 404 NOT_FOUND / 409 MISMATCH 由 store 移除卡片（组件无需处理）；notFound 不渲染
  const busy = proposal.status !== "pending" || proposal.processing === true;

  // 收集 preview 中 args/changes 的 id 候选 → names/resolve 批量解析（名称渲染）
  const [names, setNames] = useState<ResolvedNames | null>(null);
  const [resolveFailed, setResolveFailed] = useState(false);
  useEffect(() => {
    const preview = proposal.preview;
    if (typeof preview !== "object" || preview === null) return; // 字符串/无 preview 无需解析
    const obj = preview as Record<string, unknown>;
    const candidates: string[] = [];
    if (typeof obj.args === "object" && obj.args !== null) {
      candidates.push(...collectIdCandidates(obj.args));
    }
    if (Array.isArray(obj.changes)) {
      for (const c of obj.changes) {
        if (typeof c === "object" && c !== null && typeof (c as { id?: unknown }).id === "string") {
          candidates.push((c as { id: string }).id);
        }
      }
    }
    if (candidates.length === 0) return; // 无候选不发请求（changes 字符串已含名称）
    let cancelled = false;
    setNames(null);
    setResolveFailed(false);
    void resolveNames(candidates)
      .then((res) => {
        if (!cancelled) setNames(res.names);
      })
      .catch(() => {
        if (!cancelled) setResolveFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [proposal.preview]);

  // 摘要行：预览数据人类可读；未知形态/解析失败 → 原始 JSON 兜底
  const previewLines = useMemo(
    () => summarizePreview(proposal.type, proposal.preview, names),
    [proposal.type, proposal.preview, names],
  );
  const showRawPreview =
    proposal.preview !== undefined &&
    (resolveFailed || (previewLines === null && typeof proposal.preview !== "string"));

  return (
    <div className="rounded-lg border border-primary/25 bg-primary/5 p-2.5">
      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <BulbOutlined className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">提案：{label}</span>
        {proposal.status === "confirmed" && (
          <span className="shrink-0 text-xs text-primary">✓ 已确认</span>
        )}
        {proposal.status === "rejected" && (
          <span className="shrink-0 text-xs text-muted-foreground">已拒绝</span>
        )}
        {proposal.status === "stale" && (
          <span className="shrink-0 text-xs text-destructive">⚠ 数据已变化，此提案已失效</span>
        )}
      </div>
      {/* preview 摘要渲染（summary 优先 + changes/args 逐行；不再 JSON dump） */}
      {previewLines !== null && (
        <ul className="mt-1 max-h-32 space-y-0.5 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
          {previewLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {showRawPreview && (
        <pre className="mt-1 max-h-32 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
          {typeof proposal.preview === "string"
            ? proposal.preview
            : JSON.stringify(proposal.preview, null, 2)}
        </pre>
      )}
      <div className="mt-2 flex gap-1.5">
        <Button
          size="small"
          type="primary"
          disabled={busy}
          onClick={() => void confirmProposal(proposal.proposalId)}
        >
          确认
        </Button>
        <Button
          size="small"
          disabled={busy}
          onClick={() => void rejectProposal(proposal.proposalId)}
        >
          拒绝
        </Button>
      </div>
    </div>
  );
}

// ============ focus 小条：输入区上方「正在讨论：…」（可关闭） ============

function FocusBar() {
  const focusContext = useChatStore((s) => s.focusContext);
  const clearFocusContext = useChatStore((s) => s.clearFocusContext);
  /** 名称解析结果：undefined = 解析中（只显类型名）/ string = 命中 / null = 失败（退 id） */
  const [resolvedName, setResolvedName] = useState<string | null | undefined>(undefined);
  const targetId = focusContext?.focus_entity_id ?? focusContext?.focus_node_id ?? null;

  // 焦点变化 → names/resolve 批量解析（单个 id；失败静默退 id 显示，不阻塞小条）
  useEffect(() => {
    setResolvedName(undefined);
    if (targetId === null) return;
    let cancelled = false;
    void resolveNames([targetId])
      .then((res) => {
        if (!cancelled) setResolvedName(res.names[targetId]?.name ?? null);
      })
      .catch(() => {
        if (!cancelled) setResolvedName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  if (!focusContext) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-border bg-muted px-3 py-1.5">
      <Tag
        icon={<BulbOutlined />}
        closable
        onClose={(e) => {
          e.preventDefault(); // 受控：不自动移除，由 store 清空驱动重渲
          clearFocusContext();
        }}
        style={{ marginInlineEnd: 0 }}
      >
        正在讨论：{focusLabel(focusContext, resolvedName)}
      </Tag>
    </div>
  );
}

// ============ 拆解会话只读态（DESIGN.md `chat-session-decompose`） ============
// 会话 id 前缀 `decompose-`（shared 常量）即 kind：正文照常渲染，输入区整体不渲染，只留一行只读说明。

/** 拆解会话只读说明条（顶部一行 `caption-text` + 类型徽标）；导出供 SSR 走查 */
export function DecomposeReadonlyBar() {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted px-3 py-1.5">
      <span className="text-xs text-muted-foreground">拆解过程记录 · 只读</span>
      <TypeChip>拆解</TypeChip>
    </div>
  );
}

/**
 * 底部区（focus 小条 + 输入区）：当前会话是拆解会话（`readonly`）时**输入区整体不渲染**——
 * 不是禁用：不留「换个会话就能发」的错觉。导出供 SSR 走查（zustand 的 getServerSnapshot 恒为初始态，
 * store 里的当前会话在 SSR 看不到）。
 */
export function ComposerArea({ readonly }: { readonly: boolean }) {
  if (readonly) return null;
  return (
    <>
      <FocusBar />
      <InputArea />
    </>
  );
}

// ============ 输入区：x Sender（Enter 发送 / Shift+Enter 换行，IME 安全内建） ============
// textarea 自研发送逻辑退役；loading = streaming 思考态。
// 行为修订注记：原实现 streaming 期间禁用输入框；x Sender 无 disabled 透传，改为
// streaming 仅禁发送（loading），允许预输入下一条消息（主流聊天产品同款，无红线约束）。

function InputArea() {
  const [text, setText] = useState("");
  const streaming = useChatStore((s) => s.streaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const focusInputSeq = useChatStore((s) => s.focusInputSeq);
  const senderRef = useRef<ComponentRef<typeof Sender> | null>(null);
  // 中栏右下「问 AI」悬浮按钮点击触发聚焦（SenderRef.inputElement = 原生 textarea）
  useEffect(() => {
    if (focusInputSeq > 0) senderRef.current?.inputElement?.focus();
  }, [focusInputSeq]);

  return (
    <div className="shrink-0 border-t border-border px-3 py-3">
      <Sender
        ref={senderRef}
        value={text}
        onChange={(value) => setText(value)}
        onSubmit={(value) => {
          const trimmed = value.trim();
          if (trimmed === "" || streaming) return;
          sendMessage(trimmed);
          setText(""); // 乐观追加后清空输入（失败由错误条承接，文本可重输）
        }}
        placeholder={streaming ? "AI 思考中…" : "输入消息…"}
        loading={streaming}
      />
      {/* 配置行：输入框下方（模型在左端、思考强度在右端）；状态栏另起一行（只读观测层） */}
      <ComposerConfigRow />
      <SessionStatusBar />
    </div>
  );
}

// ============ 消息流：历史消息 + 运行时工具行 + 提案卡 ============

function MessageList({ disabled }: { disabled: boolean }) {
  const messages = useChatStore((s) => s.messages);
  const messagesLoading = useChatStore((s) => s.messagesLoading);
  const streaming = useChatStore((s) => s.streaming);
  const statusNote = useChatStore((s) => s.statusNote);
  const streamTools = useChatStore((s) => s.streamTools);
  const proposals = useChatStore((s) => s.proposals);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 历史 tool 消息按 toolCallId 索引（成对：assistant.toolCalls ↔ tool.tool_call_id）
  const toolResults = useMemo(() => {
    const map = new Map<string, ChatMessageView>();
    for (const m of messages) {
      if (m.role === "tool" && m.toolCallId) map.set(m.toolCallId, m);
    }
    return map;
  }, [messages]);

  // 新消息/加载完成自动滚动到底部（messages 引用每次 delta 追加都变 → 流式期间持续跟随）
  const tail = messages.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail, messages, messagesLoading, streamTools.length, proposals.length, statusNote]);

  /** 流式思考指示：正在流 & 尾条 assistant 且尚无正文（首段 delta 前/工具等待期） */
  const showThinking =
    streaming &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant" &&
    (messages[messages.length - 1].content ?? "").trim() === "";

  if (disabled) {
    // 无项目打开：右栏禁用（「位置与形态」：灰显 + 「打开项目后可用」）
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4">
        <MessageOutlined className="text-2xl text-muted-foreground/70" />
        <p className="text-sm text-muted-foreground/70">打开项目后可用</p>
      </div>
    );
  }

  if (messagesLoading) {
    // 恢复历史加载态（「状态·加载态」：消息区骨架）
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {[0, 1].map((i) => (
          <div
            key={i}
            className={cn(skeletonClass, "rounded-lg bg-muted/60")}
            style={{ height: 40, width: i % 2 ? "70%" : "90%" }}
          />
        ))}
      </div>
    );
  }

  const empty = messages.length === 0 && streamTools.length === 0 && proposals.length === 0;
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {empty ? (
        // 空态引导语（「空态」）
        <div className="flex h-full flex-col items-center justify-center gap-1.5 p-4 text-center">
          <MessageOutlined className="text-2xl text-muted-foreground/70" />
          <p className="text-sm text-muted-foreground">试试问：这个设定有没有漏洞？</p>
          <p className="text-sm text-muted-foreground">第 4 章剧情往哪走合理？</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} toolResults={toolResults} />
          ))}
          {showThinking && <Bubble loading content="" />}
          {/* 状态提示（上下文压缩 / 自动重试）：caption 字色，不占视觉重心 */}
          {statusNote !== null && streaming && (
            <p className="text-xs text-muted-foreground">{statusNote}</p>
          )}
          {/* 运行时工具记录（tool_execution_* 事件填充；折叠渲染同历史） */}
          {streamTools.map((t) => (
            <ToolCallRow
              key={t.id}
              toolName={t.tool}
              args={t.args}
              result={t.result}
              status={t.status}
            />
          ))}
          {/* 提案卡片（tool_execution_end 的 result.details 填充；瞬态，流断开即清空） */}
          {proposals.map((p) => (
            <ProposalCardView key={p.proposalId} proposal={p} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 面板内部内容：标题行 + 横幅 + 消息流 + focus 小条 + 输入区 ============

function ChatPanelBody({
  onClose,
  onToggleCollapse,
}: {
  onClose?: () => void;
  onToggleCollapse?: () => void;
}) {
  const config = useProjectStore((s) => s.config);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const disabled = !config;
  // 拆解会话 = 只读态：顶部一行说明，底部输入区不渲染（DESIGN.md `chat-session-decompose`）
  const readonly = isDecomposeSession(currentSessionId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SessionTitleBar disabled={disabled} onClose={onClose} onToggleCollapse={onToggleCollapse} />
      {!disabled && readonly && <DecomposeReadonlyBar />}
      {!disabled && (
        <>
          <DisconnectBanner />
          <ErrorBar />
        </>
      )}
      <MessageList disabled={disabled} />
      {!disabled && <ComposerArea readonly={readonly} />}
    </div>
  );
}

// ============ 外壳：桌面静态右栏（≥1024px） / 小屏抽屉（<1024px） ============

export function ChatPanel({
  open,
  onClose,
  width,
  onToggleCollapse,
}: {
  open: boolean;
  onClose: () => void;
  /** 桌面态像素宽度（flex-basis 覆盖默认 40%）；undefined = 小屏默认百分比布局（抽屉不参与 flex） */
  width?: number;
  /** 收起右栏回调（F7：桌面态由 AppShell 传入；小屏抽屉无收起能力，不传即不渲染按钮） */
  onToggleCollapse?: () => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // 桌面（≥1024px）：右栏静态列——F7 起宽度由 AppShell 传入像素（flex-basis 覆盖默认 40%），
  // 收起按钮（PanelRightClose）在会话标题行右侧（onToggleCollapse 传入时渲染）
  if (isDesktop) {
    return (
      <aside
        className="flex min-w-0 flex-[4_1_40%] flex-col border-l border-border bg-background"
        style={
          width !== undefined ? { flex: `0 1 ${width}px`, minWidth: CHAT_MIN_WIDTH } : undefined
        }
      >
        <ChatPanelBody onToggleCollapse={onToggleCollapse} />
      </aside>
    );
  }

  // 小屏（<1024px）：fixed 抽屉 + 遮罩；关闭时不渲染
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      {/* 遮罩：点击关闭 */}
      <div className="absolute inset-0 animate-in bg-foreground/40 fade-in" onClick={onClose} />
      {/* 抽屉：右侧滑入 */}
      <div className="absolute inset-y-0 right-0 w-[85vw] max-w-md animate-in border-l border-border bg-background shadow-xl duration-300 slide-in-from-right">
        <ChatPanelBody onClose={onClose} />
      </div>
    </div>
  );
}
