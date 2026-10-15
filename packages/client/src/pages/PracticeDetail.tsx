// 练习页（`#/practice/:sampleId`，卡 10；卡 4 改版页头，卡 5 复用卡面组件）：
// 范文（只读）→ 我的稿（可编辑）→ 点评卡。
//
// 契约：
// - 视觉 / 几何 = `docs/ui/DESIGN.md` §作家文风练习区「练习详情」+ §Layout「中栏页头结构」（页头常驻模板）：
//   页头 title = 片段说明（空则回作品名，`truncateTitle`）+ description = 作品名 + 作家名；
//   三段纵向；我的稿 = 纯文本 `TextArea`（**不引块编辑器**），字体 / 字号 / 行高**间接引用 `--writing-*`**
//   （与写作面同源，**不引 `--paper-bg`**——练习稿不着纸）
// - 数据 = `docs/api/120-api-practice.md`：`GET /practice/samples/:id`（**唯一**返回范文全文与卡体的读端点）
//   + `PUT /practice/samples/:id`（全系统唯一的用户写稿入口）。`feedback` **原样透传**（读取侧只防「非对象」）
//   ⇒ **禁止对响应 schema 调 `.parse()`**；可渲染视图由 `lib/practice.ts` 的 `practiceFeedbackView` 收窄
// - 作品名 / 作家名来自 shared 常量（`resolveAuthor` + `practiceWorkLabel`——服务端不复制作品名）
// - 保存 = 页内「保存」按钮 + 全站 `Ctrl/Cmd+S`（既有注册栈 `useSaveShortcut`；键位常量单一来源 =
//   `lib/save-shortcut.ts`）；动作本体 = `lib/practice.savePracticeDraft`（页面把它的布尔**原样返回**：
//   `false` = 失败，各页自己 catch ⇒ promise 恒 resolve，只有这个信号能阻断存档）
// - 点评 = `POST /chat` + `context.practice_sample_id`（发一条**普通用户消息**，留痕在会话历史、
//   不引入隐藏语义）；卡体即时刷新来自 `tool_execution_end` 的 `details` 帧（聊天 store 的
//   `lastToolDetails`）= **刷新信号**，卡体仍从 `GET /practice/samples/:id` 读（帧里只有写库结果）
// - 文案口径（`60-practice.md`）：用户侧只用「范文 / 我的稿 / 点评 / 作品」
//
// 分层：`PracticeSampleSections` / `FeedbackCardView` / 两个整页态 = 纯展示（无 effect、无请求，
// 导出供 SSR 走查——仓内无 jsdom，组件测试用 `react-dom/server`）；默认导出 = 容器（取数 + 保存 + 触发点评）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AuthorEntry,
  PracticeFeedbackCard,
  PracticeSampleDetail,
} from "@whispering233/ai-editor-shared";
import { MAX_PRACTICE_DRAFT_CHARS, resolveAuthor } from "@whispering233/ai-editor-shared";
import { Button, Input, Skeleton, Typography } from "antd";
import { ApiError, getPracticeSample } from "../lib/api";
import {
  PRACTICE_REVIEW_MESSAGE,
  canRequestPracticeReview,
  practiceFeedbackSignalSampleId,
  practiceFeedbackView,
  practiceWorkLabel,
  savePracticeDraft,
  shouldRefreshPracticeCard,
  type PracticeFeedbackDimension,
} from "../lib/practice";
import { formatSavedAt, formatTextLength } from "../lib/manuscript";
import { useSaveShortcut } from "../lib/save-shortcut";
import { errorBannerClass } from "../lib/styles";
import { cn } from "../lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { navigate } from "../hooks/use-route";
import { useWritingPrefs, toWritingTypeCssVars, type WritingPrefs } from "../hooks/use-writing-prefs";
import { useChatStore } from "../stores/chat";
import { useProjectStore } from "../stores/project";
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

/** 点评卡一行：左 = 固定宽标签，右 = 值（四行恒在，缺字段画 `—`，不因缺字段少一行） */
function FeedbackRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap text-foreground">{children}</span>
    </div>
  );
}

/** 空值口径 = `—`（与只读字段同款） */
function orDash(text: string): ReactNode {
  return text === "" ? <span className="text-muted-foreground">—</span> : text;
}

/**
 * 引用行：范文引用在前、我的稿引用在后，每句用 `「」` 包起（全站引用用户文本的同一写法）。
 * 每组带来源词——两侧引用混在一行里，用户要能看出哪句出自范文、哪句出自自己的稿。
 * **不做原文高亮定位**（DESIGN.md §文风练习区「不做」项）；无引用 → `null`（调用方画 `—`）。
 */
function quotesNode(dimension: PracticeFeedbackDimension): ReactNode {
  const groups = [
    { label: "范文", quotes: dimension.sample_quotes },
    { label: "我的稿", quotes: dimension.draft_quotes },
  ].filter((group) => group.quotes.length > 0);
  if (groups.length === 0) return null;
  return (
    <span className="text-foreground/80">
      {groups.map((group) => (
        <span key={group.label} className="mr-2">
          {group.label}
          {group.quotes.map((quote) => `「${quote}」`).join("")}
        </span>
      ))}
    </span>
  );
}

export interface FeedbackCardViewProps {
  /** 卡体（`GET` 响应的 `feedback`；未点评 = `null`）。**原样传入**，本层不做 schema 校验 */
  feedback: PracticeFeedbackCard | null;
}

/** 点评卡卡面：`summary`（caption）+ 每维度一组（维度名 + 四行）；无卡 / 无可展示内容 → 一行空态 */
export function FeedbackCardView({ feedback }: FeedbackCardViewProps) {
  const card = practiceFeedbackView(feedback);
  if (card === null) {
    return <Typography.Text type="secondary">还没点评</Typography.Text>;
  }
  return (
    <div className="flex flex-col gap-4">
      {card.summary !== null && <Typography.Text type="secondary">{card.summary}</Typography.Text>}
      {card.dimensions.map((dimension, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          {/* 维度名（`section-title` 级）；写入侧不约束非空 ⇒ 空名退「维度 N」，不出现无标题的一组 */}
          <Typography.Title level={5}>
            {dimension.name === "" ? `维度 ${index + 1}` : dimension.name}
          </Typography.Title>
          <FeedbackRow label="范文特征">{orDash(dimension.sample_trait)}</FeedbackRow>
          <FeedbackRow label="你的写法">{orDash(dimension.draft_trait)}</FeedbackRow>
          <FeedbackRow label="引用">{quotesNode(dimension) ?? orDash("")}</FeedbackRow>
          <FeedbackRow label="建议">{orDash(dimension.advice)}</FeedbackRow>
        </div>
      ))}
    </div>
  );
}

export interface PracticeSampleSectionsProps {
  /** 样本详情（范文 / 卡体 / 目标名都从这里来） */
  detail: PracticeSampleDetail;
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
  /** 有（**已保存且与输入一致**的）稿件才可点：AI 读的是库里的 `draft`，未保存的输入不在库里
   * （不一致时点评的是旧稿——与用户眼前看到的不是同一份） */
  canReview: boolean;
  /** 生成中：禁点（否则点了没反应） */
  reviewing: boolean;
  onRequestReview: () => void;
}

/** 练习页三段（范文 → 我的稿 → 点评卡）；页头之外的全部滚动内容，纯 props */
export function PracticeSampleSections({
  detail,
  draft,
  onDraftChange,
  writingPrefs,
  saving,
  savedAt,
  saveError,
  onSave,
  canReview,
  reviewing,
  onRequestReview,
}: PracticeSampleSectionsProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* 一、范文：快照只读（`whitespace-pre-wrap`，不渲染 markdown），不给编辑入口 */}
      <SectionCard title="范文">
        <p className="whitespace-pre-wrap text-sm text-foreground">{detail.text}</p>
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
            placeholder="在这里写下你的仿写…"
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

      {/* 三、点评卡：卡体 + 「让 AI 点评」（有稿才可点 → 发一条普通用户消息） */}
      <SectionCard
        title="点评卡"
        action={
          <Button
            disabled={!canReview || reviewing}
            title={canReview ? undefined : "先写下我的稿并保存，再让 AI 点评"}
            onClick={onRequestReview}
          >
            让 AI 点评
          </Button>
        }
      >
        <FeedbackCardView feedback={detail.feedback} />
      </SectionCard>
    </div>
  );
}

/** 样本不存在 / 已删除（GET/PUT 404 `PRACTICE_NOT_FOUND`） */
export function PracticeSampleMissing() {
  return (
    <section>
      <EmptyState padding="lg" action={<Button onClick={() => navigate("/practice")}>返回列表</Button>}>
        该练习样本不存在或已被删除
      </EmptyState>
    </section>
  );
}

/** 详情加载失败（网络层 / 服务端错误：展示服务端文案 + 重试） */
export function PracticeLoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section>
      <EmptyState padding="lg" action={<Button onClick={onRetry}>重试</Button>}>
        练习样本加载失败
        <span className="mt-1 block text-xs text-muted-foreground/70">{message}</span>
      </EmptyState>
    </section>
  );
}

export interface PracticeHeaderProps {
  /** 样本详情（`null` = 未加载：页头只挂「练习」标题） */
  detail: PracticeSampleDetail | null;
  /** 当前工作区的预置作家（`null` = 未解析：说明行只画作品名） */
  author: AuthorEntry | null;
}

/** 练习页页头（纯展示，导出供 SSR 走查）：title = 片段说明（留空则回作品名，`truncateTitle`），
 * description = 作品名 + 作家名——作品名兜底走 `lib/practice.practiceWorkLabel`（不手抄「其他」） */
export function PracticeHeader({ detail, author }: PracticeHeaderProps) {
  const workName = detail === null ? "" : practiceWorkLabel(author, detail.workId);
  const excerptLabel = detail?.excerptLabel.trim() ?? "";
  return (
    <PageHeader
      title={detail === null ? "练习" : excerptLabel === "" ? workName : excerptLabel}
      truncateTitle
      description={
        detail !== null && (
          <span className="text-xs text-muted-foreground">
            {workName}
            {author !== null && ` · ${author.name}`}
          </span>
        )
      }
    />
  );
}

// ============ 容器 ============

export default function PracticeDetail({ sampleId }: { sampleId: string }) {
  // 写作面偏好（全局一份，与章正文 / 参考资料正文共用同一 localStorage 键）
  const { prefs: writingPrefs } = useWritingPrefs();
  // 预置作家（页头 description 的作家名；练习工作区必有值，缺失时只画作品名）
  const author = resolveAuthor(useProjectStore((s) => s.config?.authorId ?? null));
  const showToast = useUiStore((s) => s.showToast);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const requestFocusInput = useChatStore((s) => s.requestFocusInput);
  const streaming = useChatStore((s) => s.streaming);

  const [detail, setDetail] = useState<PracticeSampleDetail | null>(null);
  /** 加载失败（码 + 文案）：`PRACTICE_NOT_FOUND` → 整页 404 态，其余 → 加载失败 + 重试 */
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  /** 我的稿（本地可编辑副本；只在首拉 / 重试时与服务端同步） */
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * 载入详情并把稿件同步为本地副本（首拉 / 重试）。
   * **点评帧刷新不走这里**——刷新时用户可能正有未保存输入，覆盖它就是静默丢字。
   */
  async function loadDetail(): Promise<void> {
    try {
      const res = await getPracticeSample(sampleId);
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

  // 首拉：只随 sampleId 重拉（换样本 = 路由 key 变化 → 组件重挂，同章正文页口径）
  useEffect(() => {
    setDetail(null);
    setLoadError(null);
    void loadDetail();
  }, [sampleId]);

  /** 点评帧刷新：只换详情（卡体 + 更新时间），不动在写的稿件；失败不砸掉已有卡体，只提示一句 */
  async function refreshCard(): Promise<void> {
    try {
      setDetail(await getPracticeSample(sampleId));
    } catch {
      showToast("点评卡刷新失败，重新打开这份样本可再看", "error");
    }
  }

  // 点评卡刷新信号（`tool_execution_end` 的 details）——帧里只有写库结果、没有卡体 ⇒ 收到**本样本**的
  // 新帧才重拉 `GET`。首帧守卫同 `hooks/use-data-refresh`：ref 挂载时同步为当前序号（旧帧不消费）。
  const detailsFrame = useChatStore((s) => s.lastToolDetails);
  const detailsSeq = detailsFrame?.seq ?? null;
  const signalSampleId = practiceFeedbackSignalSampleId(detailsFrame);
  const consumedSeqRef = useRef<number | null>(detailsSeq);
  useEffect(() => {
    if (
      !shouldRefreshPracticeCard({
        seq: detailsSeq,
        consumedSeq: consumedSeqRef.current,
        signalSampleId,
        sampleId,
      })
    ) {
      return;
    }
    consumedSeqRef.current = detailsSeq;
    void refreshCard();
  }, [detailsSeq, signalSampleId, sampleId]);

  /**
   * 提交保存（页内「保存」按钮与 Ctrl/Cmd+S 同一入口）：`false` = 本次保存失败。
   * 失败信号必须原样违背给 `useSaveShortcut`（阻断存档）——详见 `lib/practice.savePracticeDraft`。
   */
  async function saveDraft(): Promise<boolean> {
    setSaving(true);
    try {
      return await savePracticeDraft({
        sampleId,
        draft,
        onSaved: (updatedAt) => {
          // 服务端已存下这一份 ⇒ 详情里的「已保存稿件」镜像跟着前移
          // （「让 AI 点评」的可点性据此判定），版本戳同此更新
          setDetail((prev) => (prev === null ? prev : { ...prev, draft, updatedAt }));
          setSavedAt(new Date()); // 「已保存 · HH:MM」的时刻基准 = 这次保存完成的本地时刻
          setSaveError(null);
        },
        onFailed: (failure) => {
          // 样本已不存在（他处删除）→ 落到整页 404 态（同章正文页的 missing 分流）
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

  /** 「让 AI 点评」：一条普通用户消息 + 本次发送的 `practice_sample_id`，并聚焦右栏输入框 */
  function requestReview(): void {
    sendMessage(PRACTICE_REVIEW_MESSAGE, { practice_sample_id: sampleId });
    requestFocusInput();
  }

  const missing = loadError?.code === "PRACTICE_NOT_FOUND";
  if (missing) return <PracticeSampleMissing />;
  if (loadError !== null && detail === null) {
    return <PracticeLoadFailure message={loadError.message} onRetry={() => void loadDetail()} />;
  }

  // 作品名（`null` / 未知 id → 「其他」）；片段说明留空时页头回落到作品名
  return (
    /* 页头常驻模板（DESIGN.md §Layout「中栏页头结构」）：section 恰好等于中栏滚动容器内容区 ⇒
       外壳不滚，滚动只发生在内层容器里（页头与三段标题留在视口）。 */
    <section className="flex h-full min-h-0 flex-col">
      <PracticeHeader detail={detail} author={author} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {detail === null ? (
          <Skeleton active title={false} paragraph={{ rows: 4 }} />
        ) : (
          <PracticeSampleSections
            detail={detail}
            draft={draft}
            onDraftChange={setDraft}
            writingPrefs={writingPrefs}
            saving={saving}
            savedAt={savedAt}
            saveError={saveError}
            onSave={() => void saveDraft()}
            canReview={canRequestPracticeReview(detail, draft)}
            reviewing={streaming}
            onRequestReview={requestReview}
          />
        )}
      </div>
    </section>
  );
}
