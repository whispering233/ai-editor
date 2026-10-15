// 新建题目弹窗（卡 5）
//
// 契约：`docs/ui/DESIGN.md` §作家文风练习区「新建题目弹窗」= 受控 Dialog（复用
// `components/ui/dialog.tsx`，不新造浮层、不新增色值 / 字号 / 圆角）；字段 = 题目（必填 `input`）
// + 写作要求（可空 `TextArea`）。
// - 上限取 shared 常量（`docs/api/120-api-practice.md`「自由练习」：`topic` trim 非空 +
//   `MAX_PRACTICE_TOPIC_CHARS`；`brief` 可空 + `MAX_PRACTICE_BRIEF_CHARS`）——提示文案的数字由
//   常量插值，不复述
// - 提交 = `POST /practice/free`（`topic_source: "user"`）；**不做乐观更新**：成功后重拉列表由调用方
//   负责（`onCreated`），本弹窗只关窗
// - 「让 AI 出题」不走本弹窗（它建的是空题行，见列表页的页头按钮）——两条入口不在同一处收口，
//   是为了让「自拟题」的必填校验只活在一个表单里
//
// 分层：`CreatePieceFormBody` = 纯展示（SSR 走查用；弹窗外壳走 portal，SSR 不支持）；
//       `CreatePieceDialog` = 容器（表单状态 + POST /practice/free）。
import { useState, type FormEvent } from "react";
import { Button, Input } from "antd";
import {
  MAX_PRACTICE_BRIEF_CHARS,
  MAX_PRACTICE_TOPIC_CHARS,
} from "@whispering233/ai-editor-shared";
import { ApiError, createPracticePiece } from "../../lib/api";
import { useUiStore } from "../../stores/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** 字段块（标签 + 控件 + 提示；间距由容器 gap 给，不在标签上写 margin） */
const FIELD_CLASS = "flex flex-col gap-1";
/** 字段标签（标签档） */
const FIELD_LABEL_CLASS = "text-sm font-medium text-foreground";
/** 字段说明 / 上限提示（caption 档） */
const FIELD_HINT_CLASS = "text-xs text-muted-foreground";
/** 内联错误（含服务端 message 透传） */
const FIELD_ERROR_CLASS = "text-xs text-destructive";

export interface CreatePieceFormBodyProps {
  topic: string;
  onTopicChange: (value: string) => void;
  brief: string;
  onBriefChange: (value: string) => void;
  topicError: string | null;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}

/** 新建题目表单内容体（纯展示：无 effect、无请求） */
export function CreatePieceFormBody({
  topic,
  onTopicChange,
  brief,
  onBriefChange,
  topicError,
  submitting,
  submitError,
  onSubmit,
  onCancel,
}: CreatePieceFormBodyProps) {
  return (
    <form id="create-practice-piece-form" onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className={FIELD_CLASS}>
        <p className={FIELD_LABEL_CLASS}>题目</p>
        <Input
          autoFocus
          value={topic}
          maxLength={MAX_PRACTICE_TOPIC_CHARS}
          disabled={submitting}
          placeholder={`如：写一段雨夜的告别（最多 ${MAX_PRACTICE_TOPIC_CHARS} 字）`}
          onChange={(e) => onTopicChange(e.target.value)}
        />
        {topicError !== null && <p className={FIELD_ERROR_CLASS}>{topicError}</p>}
      </div>

      <div className={FIELD_CLASS}>
        <p className={FIELD_LABEL_CLASS}>写作要求</p>
        <Input.TextArea
          value={brief}
          rows={4}
          maxLength={MAX_PRACTICE_BRIEF_CHARS}
          disabled={submitting}
          placeholder="字数、视角、必须写到的东西……（可留空）"
          onChange={(e) => onBriefChange(e.target.value)}
        />
        {/* 上限提示：数字由常量插值（数值单源，禁复述） */}
        <p className={FIELD_HINT_CLASS}>最多 {MAX_PRACTICE_BRIEF_CHARS} 字</p>
      </div>

      {submitError !== null && <p className={FIELD_ERROR_CLASS}>{submitError}</p>}

      <DialogFooter>
        <Button onClick={onCancel} disabled={submitting}>
          取消
        </Button>
        <Button type="primary" htmlType="submit" loading={submitting}>
          创建
        </Button>
      </DialogFooter>
    </form>
  );
}

export interface CreatePieceDialogProps {
  onOpenChange: (open: boolean) => void;
  /** 创建成功（调用方据此重拉列表；不做乐观更新） */
  onCreated: () => void;
}

/** 新建题目弹窗（容器：题目 / 写作要求状态 + POST /practice/free） */
export function CreatePieceDialog({ onOpenChange, onCreated }: CreatePieceDialogProps) {
  // 只在挂载时取初值：调用点在打开时才挂载本组件（关窗即卸载）⇒ 每次打开都是干净表单
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState("");
  const [topicError, setTopicError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedTopic = topic.trim();
    if (trimmedTopic === "") {
      setTopicError("请填写题目");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const trimmedBrief = brief.trim();
      await createPracticePiece({
        topic_source: "user",
        topic: trimmedTopic,
        // 留空 = 不送该字段（服务端写空串 = 无写作要求）
        ...(trimmedBrief === "" ? {} : { brief: trimmedBrief }),
      });
      useUiStore.getState().showToast("已新建题目");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      // 不吞错：服务端 400（超上限 / 未关联作家）与网络失败都留在框内可读
      setSubmitError(err instanceof ApiError ? err.message : "创建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建题目</DialogTitle>
        </DialogHeader>
        <CreatePieceFormBody
          topic={topic}
          onTopicChange={(value) => {
            setTopic(value);
            setTopicError(null);
          }}
          brief={brief}
          onBriefChange={setBrief}
          topicError={topicError}
          submitting={submitting}
          submitError={submitError}
          onSubmit={(e) => void handleSubmit(e)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
