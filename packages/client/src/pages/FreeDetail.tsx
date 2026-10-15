// 自由练习详情页（`#/free/:pieceId`，卡 5）——题目卡 → 我的稿 → 点评卡。
//
// 契约：
// - 视觉 / 几何 = `docs/ui/DESIGN.md` §作家文风练习区「自由练习详情」+ §Layout「中栏页头结构」
//   （页头常驻模板）：页头 title = 题目（空则不挂标题、写「待出题」，`truncateTitle`）；
//   三段纵向；题目卡 = `card` 面只读文本（`whitespace-pre-wrap`，不渲染 markdown），空题态给
//   `[让 AI 出题]` + 一行 `caption-text` 引导；我的稿 = 纯文本 `TextArea`（**不引块编辑器**），
//   字体 / 字号 / 行高**间接引用 `--writing-*`**（与写作面同源，**不引 `--paper-bg`**）
// - 数据 = `docs/api/120-api-practice.md`「自由练习」：`GET /practice/free/:id`（**唯一**返回稿件全文
//   与卡体的读端点）+ `PUT /practice/free/:id`（用户写稿唯一入口）。`feedback` **原样透传**
//   （读取侧只防「非对象」）⇒ **禁止对响应 schema 调 `.parse()`**；可渲染视图由
//   `lib/practice.practiceFeedbackView` 收窄（两形态卡体同形）
// - 点评卡**复用仿写页的 `FeedbackCardView`**：两形态卡体同形，差别只在依据侧那一行的标签
//   （仿写 = 「范文特征」、自由练习 = 「风格特征」）+ 引用校验源（`docs/design/60-practice.md` §6）
//   ⇒ 传 `traitLabel`，不在本页另写一份卡面
// - 保存 = 页内「保存」按钮 + 全站 `Ctrl/Cmd+S`（既有注册栈 `useSaveShortcut`；键位常量单一来源 =
//   `lib/save-shortcut.ts`）；动作本体 = `lib/free-practice.saveFreeDraft`（页面把它的布尔**原样返回**）
// - 触发 = `POST /chat` + `context.practice_free_piece_id`（发一条**普通用户消息**，留痕在会话历史、
//   不引入隐藏语义）：点评 = 「请点评我的自由练习稿」，出题 = 「请出一道练习题目」（空题态）
// - 帧刷新 = `tool_execution_end` 的 `details` 帧（聊天 store 的 `lastToolDetails`）= 刷新信号：
//   **出题帧刷新题目、点评帧刷新卡体，两处共用同一个「本 id 的新帧才重拉」守卫**
//   （帧里没有题目也没有卡体，二者一律从 `GET /practice/free/:id` 读）
// - 用户侧文案口径（`60-practice.md` §4）：只用「题目 / 写作要求 / 我的稿 / 点评」——不出现
//   「topic_source」这类接口侧词
//
// 分层：`FreePieceSections` / 两个整页态 = 纯展示（无 effect、无请求，导出供 SSR 走查——仓内无 jsdom，
// 组件测试用 `react-dom/server`）；默认导出 = 容器（取数 + 保存 + 触发点评 / 出题）。
import { useEffect, useRef, useState } from "react";
import type { PracticePieceDetail } from "@whispering233/ai-editor-shared";
import { MAX_PRACTICE_DRAFT_CHARS } from "@whispering233/ai-editor-shared";
import { Button, Input, Skeleton } from "antd";
import { ApiError, getPracticePiece } from "../lib/api";
import {
  FREE_REVIEW_MESSAGE,
  FREE_TOPIC_MESSAGE,
  freePracticeSignalPieceId,
  freePracticeTopicText,
  freePracticeTopicTitle,
  saveFreeDraft,
  shouldRefreshFreePiece,
} from "../lib/free-practice";
import { formatSavedAt, formatTextLength } from "../lib/manuscript";
import { canRequestPracticeReview } from "../lib/practice";
import { useSaveShortcut } from "../lib/save-shortcut";
import { errorBannerClass } from "../lib/styles";
import { cn } from "../lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedbackCardView } from "./PracticeDetail";
import { navigate } from "../hooks/use-route";
import {
  useWritingPrefs,
  toWritingTypeCssVars,
  type WritingPrefs,
} from "../hooks/use-writing-prefs";
import { useChatStore } from "../stores/chat";
import { useUiStore } from "../stores/ui";

/** 我的稿的书写面行数下限（内容更多时自动长高；纯布局常量，无第二处引用） */
const DRAFT_MIN_ROWS = 12;

/**
 * 稿面字号 / 字体 / 行高的**间接引用**（DESIGN.md §文风练习区「我的稿」）：
 * 值来自容器上的 `--writing-*`（`toWritingTypeCssVars`），这里不写死任何字号 / 字体
 * ——prefs 档位常量唯一出处 = `hooks/use-writing-prefs.ts`。
 */
const DRAFT_TEXTAREA_STYLE = {
  fontFamily: "var(--writing-font)",
  fontSize: "var(--writing-font-size)",
  lineHeight: "var(--writing-line-height)",
} as const;

// ============ 纯展示层（导出供 SSR 走查） ============

export interface FreePieceSectionsProps {
  /** 篇详情（题目 / 写作要求 / 卡体都从这里来） */
  detail: PracticePieceDetail;
  /** 我的稿（本地可编辑副本；提交由容器发 `PUT`） */
  draft: string;
  onDraftChange: (value: string) => void;
  /** 写作面偏好（`--writing-*` 变量来源；容器调 `useWritingPrefs` 后传入——纯展示层不碰 localStorage） */
  writingPrefs: WritingPrefs;
  saving: boolean;
  /** 最近一次保存**完成**的本地时刻（`null` = 本页尚未保存过） */
  savedAt: Date | null;
  /** 保存失败文案（错误条 + 重试，不静默） */
  saveError: string | null;
  onSave: () => void;
  /** 有（**已保存且与输入一致**的）稿件才可点：AI 读的是库里的 `draft`，未保存的输入不在库里 */
  canReview: boolean;
  /** 一轮生成在途（`streaming`）：点评与出题两个按钮都禁点（点了也发不出去） */
  streaming: boolean;
  onRequestReview: () => void;
  /** 空题态的「让 AI 出题」（题目由 AI 经工具写入，本页收到写库帧后重拉） */
  onRequestTopic: () => void;
}

/** 自由练习详情三段（题目卡 → 我的稿 → 点评卡）；页头之外的全部滚动内容，纯 props */
export function FreePieceSections({
  detail,
  draft,
  onDraftChange,
  writingPrefs,
  saving,
  savedAt,
  saveError,
  onSave,
  canReview,
  streaming,
  onRequestReview,
  onRequestTopic,
}: FreePieceSectionsProps) {
  const topic = freePracticeTopicText(detail.topic);
  const brief = freePracticeTopicText(detail.brief);
  return (
    <div className="flex flex-col gap-4">
      {/* 一、题目卡：题目 + 写作要求（只读，不渲染 markdown、不给编辑入口）；空题态 = 引导 + 让 AI 出题 */}
      <SectionCard title="题目">
        {topic === "" ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              这一篇还没有题目——让 AI 出一题，题目写好会显示在这里
            </p>
            <span>
              <Button disabled={streaming} onClick={onRequestTopic}>
                让 AI 出题
              </Button>
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm whitespace-pre-wrap text-foreground">{topic}</p>
            {/* 写作要求空串 = 无（`120-api-practice.md`）⇒ 整块不渲染，不出空标题 */}
            {brief !== "" && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">写作要求</span>
                <p className="text-sm whitespace-pre-wrap text-foreground">{brief}</p>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* 二、我的稿：纯文本 TextArea + 页内「保存」（button-primary）+ 字数 / 保存态 */}
      <SectionCard
        title="我的稿"
        action={
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{formatTextLength(draft.length) ?? "0 字"}</span>
              {saving && <span>保存中…</span>}
              {!saving && savedAt !== null && (
                <span className="tabular-nums">已保存 · {formatSavedAt(savedAt)}</span>
              )}
            </span>
            <Button type="primary" loading={saving} onClick={onSave}>
              保存
            </Button>
          </div>
        }
      >
        {/* 只在容器上给排版三变量（**不给 `--paper-bg`**）：textarea 侧只做间接引用 */}
        <div style={toWritingTypeCssVars(writingPrefs)}>
          <Input.TextArea
            value={draft}
            maxLength={MAX_PRACTICE_DRAFT_CHARS}
            autoSize={{ minRows: DRAFT_MIN_ROWS }}
            placeholder="在这里写下你的练习稿…"
            style={DRAFT_TEXTAREA_STYLE}
            onChange={(event) => onDraftChange(event.target.value)}
          />
        </div>
        {/* 上限提示：数字由常量插值（数值单源，禁复述） */}
        <p className="mt-1 text-xs text-muted-foreground">最多 {MAX_PRACTICE_DRAFT_CHARS} 字</p>
        {saveError !== null && (
          <div className={cn(errorBannerClass, "mt-2 flex items-center gap-3")}>
            <span className="min-w-0 flex-1">{saveError}</span>
            <Button size="small" onClick={onSave}>
              重试
            </Button>
          </div>
        )}
      </SectionCard>

      {/* 三、点评卡：卡体 + 「让 AI 点评」（有稿才可点 → 发一条普通用户消息）；依据侧标签 = 「风格特征」 */}
      <SectionCard
        title="点评卡"
        action={
          <Button
            disabled={!canReview || streaming}
            title={canReview ? undefined : "先写下我的稿并保存，再让 AI 点评"}
            onClick={onRequestReview}
          >
            让 AI 点评
          </Button>
        }
      >
        <FeedbackCardView feedback={detail.feedback} traitLabel="风格特征" />
      </SectionCard>
    </div>
  );
}

/** 篇不存在 / 已删除（GET/PUT 404 `PRACTICE_NOT_FOUND`） */
export function FreePieceMissing() {
  return (
    <section>
      <EmptyState padding="lg" action={<Button onClick={() => navigate("/free")}>返回列表</Button>}>
        该练习篇不存在或已被删除
      </EmptyState>
    </section>
  );
}

/** 详情加载失败（网络层 / 服务端错误：展示服务端文案 + 重试） */
export function FreeLoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section>
      <EmptyState padding="lg" action={<Button onClick={onRetry}>重试</Button>}>
        练习篇加载失败
        <span className="mt-1 block text-xs text-muted-foreground/70">{message}</span>
      </EmptyState>
    </section>
  );
}

export interface FreeHeaderProps {
  /** 篇详情（`null` = 未加载：页头挂「自由练习」标题） */
  detail: PracticePieceDetail | null;
}

/** 自由练习页页头（纯展示，导出供 SSR 走查）：title = 题目（空题 → 「待出题」，`truncateTitle`） */
export function FreeHeader({ detail }: FreeHeaderProps) {
  return (
    <PageHeader
      title={detail === null ? "自由练习" : freePracticeTopicTitle(detail.topic)}
      truncateTitle
    />
  );
}

// ============ 容器 ============

export default function FreeDetail({ pieceId }: { pieceId: string }) {
  // 写作面偏好（全局一份，与章正文 / 参考资料正文共用同一 localStorage 键）
  const { prefs: writingPrefs } = useWritingPrefs();
  const showToast = useUiStore((s) => s.showToast);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const requestFocusInput = useChatStore((s) => s.requestFocusInput);
  const streaming = useChatStore((s) => s.streaming);

  const [detail, setDetail] = useState<PracticePieceDetail | null>(null);
  /** 加载失败（码 + 文案）：`PRACTICE_NOT_FOUND` → 整页 404 态，其余 → 加载失败 + 重试 */
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  /** 我的稿（本地可编辑副本；只在首拉 / 重试时与服务端同步） */
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * 载入详情并把稿件同步为本地副本（首拉 / 重试）。
   * **帧刷新不走这里**——刷新时用户可能正有未保存输入，覆盖它就是静默丢字。
   */
  async function loadDetail(): Promise<void> {
    try {
      const res = await getPracticePiece(pieceId);
      setDetail(res);
      setDraft(res.draft);
      setSavedAt(null);
      setSaveError(null);
    } catch (err) {
      setLoadError({
        code: err instanceof ApiError ? err.code : "CLIENT_NETWORK_ERROR",
        message: err instanceof ApiError ? err.message : "加载失败，请重试",
      });
    }
  }

  // 首拉：只随 pieceId 重拉（换篇 = 路由 key 变化 → 组件重挂，同章正文页口径）
  useEffect(() => {
    setDetail(null);
    setLoadError(null);
    void loadDetail();
  }, [pieceId]);

  /** 帧刷新：只换详情（题目 / 卡体 / 更新时间），不动在写的稿件；失败不砸掉已有内容，只提示一句 */
  async function refreshPiece(): Promise<void> {
    try {
      setDetail(await getPracticePiece(pieceId));
    } catch {
      showToast("刷新失败，重新打开这一篇可再看", "error");
    }
  }

  // 刷新信号（`tool_execution_end` 的 details）——**出题帧与点评帧共用**：帧里只有写库结果、
  // 没有题目也没有卡体 ⇒ 收到**本 id** 的新帧才重拉 `GET`。首帧守卫同 `hooks/use-data-refresh`：
  // ref 挂载时同步为当前序号（旧帧不消费）。
  const detailsFrame = useChatStore((s) => s.lastToolDetails);
  const detailsSeq = detailsFrame?.seq ?? null;
  const signalPieceId = freePracticeSignalPieceId(detailsFrame);
  const consumedSeqRef = useRef<number | null>(detailsSeq);
  useEffect(() => {
    if (
      !shouldRefreshFreePiece({
        seq: detailsSeq,
        seqConsumed: consumedSeqRef.current,
        signalPieceId,
        pieceId,
      })
    ) {
      return;
    }
    consumedSeqRef.current = detailsSeq;
    void refreshPiece();
  }, [detailsSeq, signalPieceId, pieceId]);

  /**
   * 提交保存（页内「保存」按钮与 Ctrl/Cmd+S 同一入口）：`false` = 本次保存失败。
   * 失败信号必须原样传回给 `useSaveShortcut`（阻断存档）——详见 `lib/free-practice.saveFreeDraft`。
   */
  async function saveDraft(): Promise<boolean> {
    setSaving(true);
    try {
      return await saveFreeDraft({
        pieceId,
        draft,
        onSaved: (updatedAt) => {
          // 服务端已存下这一份 ⇒ 详情里的「已保存稿件」镜像跟着前移
          // （「让 AI 点评」的可点性据此判定），版本戳同此更新
          setDetail((prev) => (prev === null ? prev : { ...prev, draft, updatedAt }));
          setSavedAt(new Date()); // 「已保存 · HH:MM」的时刻基准 = 这次保存完成的本地时刻
          setSaveError(null);
        },
        onFailed: (failure) => {
          // 篇已不存在（他处删除）→ 落到整页 404 态（同章正文页的 missing 分流）
          if (failure.code === "PRACTICE_NOT_FOUND") {
            setDetail(null);
            setLoadError(failure);
            return;
          }
          setSaveError(failure.message);
        },
      });
    } finally {
      setSaving(false);
    }
  }

  // 全站 Ctrl/Cmd + S：与页内「保存」同语义（键位常量唯一出处 = lib/save-shortcut）。
  // enabled = 详情已加载（无可保存对象时让快捷键落到存档阶段，同章正文页口径）。
  useSaveShortcut(() => saveDraft(), detail !== null);

  /**
   * 触发一轮练习对话：一条普通用户消息 + 本次发送的 `practice_free_piece_id`，并聚焦右栏输入框。
   * 点评与出题只差触发的用户文案（`60-practice.md` §4 步 1' 与步 3）。
   */
  function request(message: string): void {
    sendMessage(message, { practice_free_piece_id: pieceId });
    requestFocusInput();
  }

  const missing = loadError?.code === "PRACTICE_NOT_FOUND";
  if (missing) return <FreePieceMissing />;
  if (loadError !== null && detail === null) {
    return <FreeLoadFailure message={loadError.message} onRetry={() => void loadDetail()} />;
  }

  return (
    /* 页头常驻模板（DESIGN.md §Layout「中栏页头结构」）：section 恰好等于中栏滚动容器内容区 ⇒
       外壳不滚，滚动只发生在内层容器里（页头与三段标题留在视口）。 */
    <section className="flex h-full min-h-0 flex-col">
      <FreeHeader detail={detail} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {detail === null ? (
          <Skeleton active title={false} paragraph={{ rows: 4 }} />
        ) : (
          <FreePieceSections
            detail={detail}
            draft={draft}
            onDraftChange={setDraft}
            writingPrefs={writingPrefs}
            saving={saving}
            savedAt={savedAt}
            saveError={saveError}
            onSave={() => void saveDraft()}
            canReview={canRequestPracticeReview(detail, draft)}
            streaming={streaming}
            onRequestReview={() => request(FREE_REVIEW_MESSAGE)}
            onRequestTopic={() => request(FREE_TOPIC_MESSAGE)}
          />
        )}
      </div>
    </section>
  );
}
