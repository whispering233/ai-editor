// 自由练习列表页（`#/free`，卡 5）——平铺题目行 + 新建题目弹窗 + 「让 AI 出题」。
//
// 契约：
// - 视觉 / 几何 = `docs/ui/DESIGN.md` §作家文风练习区「自由练习列表」+ §Layout「中栏页头结构」
//   （页头常驻模板：`section: h-full min-h-0 flex flex-col` + 内容进内层 `flex min-h-0 flex-1
//   flex-col overflow-y-auto`）；行语言 = `data-row` / `type-badge`（不新增色值 / 字号 / 圆角）
// - 数据 = `docs/api/120-api-practice.md`「自由练习」：一次拿全部篇（列表不回稿件与卡体）；
//   四态徽标与空题占位文案的唯一派生入口 = `lib/free-practice.ts`（页面不各写一份）；
//   相对时间复用 shared `formatRelativeTime`（全站同一套，不新造第二套格式化）
// - 「让 AI 出题」= `topic_source: "ai"` 建空题行 → 发一条**普通用户消息**（触发文案 = 常量）
//   + 聚焦右栏聊天输入框，然后**跳进这一篇的详情**。为什么必须跳详情：题目的产生是 AI 写库后由
//   `tool_execution_end` 帧驱动的重拉，而该帧守卫只在详情页（列表页不订阅帧）——留在列表页会看不到
//   题目出现（同一 `[+ 新建题目]` 的流程则是建完刷新列表，不做乐观更新）
// - 用户侧文案口径（`60-practice.md` §4）：只用「题目 / 写作要求 / 我的稿 / 点评」
//
// 分层：`FreeList` / `FreePieceRow` = 纯展示（无 effect、无请求，导出供 SSR 走查——仓内无 jsdom）；
// 默认导出 = 容器（取数 + 弹窗开关 + 建空题行并触发出题）。
import { useEffect, useRef, useState } from "react";
import type { PracticePieceSummary } from "@whispering233/ai-editor-shared";
import { formatRelativeTime, resolveAuthor } from "@whispering233/ai-editor-shared";
import { Alert, Button, Skeleton } from "antd";
import { PlusOutlined, RobotOutlined } from "@ant-design/icons";
import { ApiError, createPracticePiece, getPracticePieces } from "../lib/api";
import {
  FREE_TOPIC_MESSAGE,
  freePracticeStatus,
  freePracticeTopicLabel,
  freePracticeTopicText,
} from "../lib/free-practice";
import { cn } from "../lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TypeChip } from "@/components/ui/tag-chip";
import { CreatePieceDialog } from "@/components/practice/create-piece-dialog";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useChatStore } from "../stores/chat";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

// ============ 纯展示层（导出供 SSR 走查） ============

export interface FreePieceRowProps {
  piece: PracticePieceSummary;
}

/** 题目行（`data-row` 行语言）：题目（`truncate`；空题 = 「（待出题）」灰字）+ 四态徽标 + 相对时间；
 * 整行 = 进该篇详情的链接——hash 导航不另接 onClick，键盘/中键也照常工作 */
export function FreePieceRow({ piece }: FreePieceRowProps) {
  const topic = freePracticeTopicText(piece.topic);
  return (
    <a
      href={`#/free/${piece.id}`}
      className="flex items-center gap-3 border-b border-border/50 py-2 transition-colors last:border-b-0 hover:bg-muted"
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          topic === "" ? "text-muted-foreground" : "text-foreground",
        )}
        title={topic === "" ? undefined : topic}
      >
        {freePracticeTopicLabel(piece.topic)}
      </span>
      <TypeChip className="shrink-0">{freePracticeStatus(piece)}</TypeChip>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatRelativeTime(piece.updatedAt)}
      </span>
    </a>
  );
}

export interface FreeListProps {
  /** `null` = 加载中（骨架）；`[]` = 无练习篇（空态） */
  pieces: PracticePieceSummary[] | null;
}

/** 列表主体：加载态 / 空态 / 平铺题目行（页头之外的全部滚动内容） */
export function FreeList({ pieces }: FreeListProps) {
  if (pieces === null) return <Skeleton active title={false} paragraph={{ rows: 3 }} />;
  if (pieces.length === 0) {
    return <EmptyState padding="sm">还没有练习篇——新建题目，或让 AI 出一题</EmptyState>;
  }
  return (
    <div>
      {pieces.map((piece) => (
        <FreePieceRow key={piece.id} piece={piece} />
      ))}
    </div>
  );
}

// ============ 容器 ============

export default function Free() {
  /** 预置作家 id（练习工作区特有；缺失 / 未知 → 服务端按 400 拒，与仿写列表同一口径） */
  const author = resolveAuthor(useProjectStore((s) => s.config?.authorId ?? null));
  const sendMessage = useChatStore((s) => s.sendMessage);
  const requestFocusInput = useChatStore((s) => s.requestFocusInput);
  const showToast = useUiStore((s) => s.showToast);

  const [pieces, setPieces] = useState<PracticePieceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  /** 「让 AI 出题」在途（建行 + 跳转）：防连点 */
  const [creatingTopic, setCreatingTopic] = useState(false);
  /** 重拉时**仅首帧**置 `null`（后续保留旧列表，避免提案确认 / InfoBar 刷新时整页骨架闪） */
  const loadedOnceRef = useRef(false);

  // AI 提案确认 / InfoBar 刷新后重拉（列表数据统一订阅 dataVersion）
  useDataRefresh(() => setReloadTick((t) => t + 1));

  useEffect(() => {
    let cancelled = false;
    if (!loadedOnceRef.current) setPieces(null);
    setError(null);
    getPracticePieces()
      .then((res) => {
        if (cancelled) return;
        loadedOnceRef.current = true;
        setPieces(res.pieces);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "加载失败，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  /** 新建题目成功 → 重拉列表（不做乐观更新） */
  function reload(): void {
    setReloadTick((t) => t + 1);
  }

  /**
   * 「让 AI 出题」：先建**空题行**（`topic_source: "ai"`，题目由 `submit_practice_topic` 工具写入），
   * 再发一条普通用户消息把出题交给 AI，并聚焦右栏输入框；随后跳进该篇详情等题目落库
   * （建行失败只提示一句——列表里不会凭空多出一行）。
   */
  async function requestAiTopic(): Promise<void> {
    setCreatingTopic(true);
    try {
      const piece = await createPracticePiece({ topic_source: "ai" });
      sendMessage(FREE_TOPIC_MESSAGE, { practice_free_piece_id: piece.id });
      requestFocusInput();
      navigate(`/free/${piece.id}`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "创建失败，请重试", "error");
    } finally {
      setCreatingTopic(false);
    }
  }

  // 未解析到预置作家（配置未到 / 不在清单）时不能建篇：服务端同样按 400 拒（`120-api-practice.md` 前置条件）
  const disabled = author === null;

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 页头（常驻）：标题 + 控件行右端组 [+ 新建题目] [让 AI 出题] + 分割线 */}
      <PageHeader
        title="自由练习"
        controls={
          <span className="ml-auto flex items-center gap-2">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={disabled}
              onClick={() => setCreateOpen(true)}
            >
              新建题目
            </Button>
            <Button
              icon={<RobotOutlined />}
              loading={creatingTopic}
              disabled={disabled || creatingTopic}
              onClick={() => void requestAiTopic()}
            >
              让 AI 出题
            </Button>
          </span>
        }
      />

      {/* 错误条（页头之下、滚动区之上：页头常驻模板，见 DESIGN.md §Layout） */}
      {error !== null && (
        <Alert
          className="mb-2"
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={reload}>
              重试
            </Button>
          }
        />
      )}

      {/* 滚动区：列表（页头不随内容滚动） */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <FreeList pieces={pieces} />
      </div>

      {/* 每次打开都是新挂载（初值干净、关窗即卸载），不残留上一题 */}
      {createOpen && (
        <CreatePieceDialog
          onOpenChange={(open) => {
            if (!open) setCreateOpen(false);
          }}
          onCreated={reload}
        />
      )}
    </section>
  );
}
