// 新建练习样本弹窗（卡 9）
//
// 契约：`docs/ui/DESIGN.md` §文风练习区「新建目标 / 新建样本弹窗」= 受控 Dialog；字段 = 来源说明
// （用户手填，如「汪曾祺《受戒》节选」）+ 范文 `TextArea`（粘贴）；上限取 shared 常量
// （`docs/api/120-api-practice.md`：`source_label` / `text` 均 trim 非空 + `MAX_PRACTICE_SOURCE_LABEL_CHARS`
// / `MAX_PRACTICE_SAMPLE_CHARS`——**提示文案的数字由常量插值，不复述**）。
// 范文是**快照**：落库后不可变（`60-practice.md` §2），故本弹窗只负责粘贴落库，不提供编辑入口。
// 分层：`CreateSampleFormBody` = 纯展示（SSR 走查用；弹窗外壳走 portal，SSR 不支持）；
//       `CreateSampleDialog` = 容器（表单状态 + POST /practice/targets/:id/samples）。
import { useState, type FormEvent } from "react";
import { Button, Input } from "antd";
import {
  MAX_PRACTICE_SAMPLE_CHARS,
  MAX_PRACTICE_SOURCE_LABEL_CHARS,
} from "@whispering233/ai-editor-shared";
import { ApiError, createPracticeSample } from "../../lib/api";
import { useUiStore } from "../../stores/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FIELD_LABEL_CLASS = "mb-1 text-sm font-medium text-foreground";
const FIELD_HINT_CLASS = "mt-1 text-xs text-muted-foreground";
const FIELD_ERROR_CLASS = "mt-1 text-xs text-destructive";

export interface CreateSampleFormBodyProps {
  sourceLabel: string;
  onSourceLabelChange: (value: string) => void;
  text: string;
  onTextChange: (value: string) => void;
  sourceLabelError: string | null;
  textError: string | null;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}

/** 新建练习样本表单内容体（纯展示：无 effect、无请求） */
export function CreateSampleFormBody({
  sourceLabel,
  onSourceLabelChange,
  text,
  onTextChange,
  sourceLabelError,
  textError,
  submitting,
  submitError,
  onSubmit,
  onCancel,
}: CreateSampleFormBodyProps) {
  return (
    <form id="create-practice-sample-form" onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <p className={FIELD_LABEL_CLASS}>来源说明</p>
        <Input
          autoFocus
          value={sourceLabel}
          maxLength={MAX_PRACTICE_SOURCE_LABEL_CHARS}
          disabled={submitting}
          placeholder="如：汪曾祺《受戒》节选"
          onChange={(e) => onSourceLabelChange(e.target.value)}
        />
        {sourceLabelError !== null && <p className={FIELD_ERROR_CLASS}>{sourceLabelError}</p>}
      </div>

      <div>
        <p className={FIELD_LABEL_CLASS}>范文</p>
        <Input.TextArea
          value={text}
          rows={8}
          maxLength={MAX_PRACTICE_SAMPLE_CHARS}
          disabled={submitting}
          placeholder="把范文粘贴到这里（落库后作为快照保留，不再变动）"
          onChange={(e) => onTextChange(e.target.value)}
        />
        {textError !== null ? (
          <p className={FIELD_ERROR_CLASS}>{textError}</p>
        ) : (
          // 上限提示：数字由常量插值（数值单源，禁复述）
          <p className={FIELD_HINT_CLASS}>最多 {MAX_PRACTICE_SAMPLE_CHARS} 字</p>
        )}
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

export interface CreateSampleDialogProps {
  /** 目标（`null` = 关窗） */
  target: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  /** 创建成功（调用方据此重拉列表；不做乐观更新） */
  onCreated: () => void;
}

/** 新建练习样本弹窗（容器：来源说明 / 范文状态 + POST /practice/targets/:id/samples） */
export function CreateSampleDialog({ target, onOpenChange, onCreated }: CreateSampleDialogProps) {
  const [sourceLabel, setSourceLabel] = useState("");
  const [text, setText] = useState("");
  const [sourceLabelError, setSourceLabelError] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (target === null) return null;
  // 闭包里不能再靠形参的窄化（TS 对可变绑定一律重置）：先取出 id
  const targetId = target.id;

  /** 关窗即清空（Esc / 遮罩 / X / 取消四条路径等价；再次打开是干净表单，不残留上一条范文） */
  function close(): void {
    setSourceLabel("");
    setText("");
    setSourceLabelError(null);
    setTextError(null);
    setSubmitError(null);
    onOpenChange(false);
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedLabel = sourceLabel.trim();
    const trimmedText = text.trim();
    if (trimmedLabel === "" || trimmedText === "") {
      // 两个必填项各自报错（不合并成一条，用户知道该补哪个）
      setSourceLabelError(trimmedLabel === "" ? "请填来源说明" : null);
      setTextError(trimmedText === "" ? "请粘贴范文" : null);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createPracticeSample(targetId, {
        source_label: trimmedLabel,
        text: trimmedText,
      });
      useUiStore.getState().showToast(`已新建范文：${trimmedLabel}`);
      close();
      onCreated();
    } catch (err) {
      // 不吞错：服务端 400（超上限）与网络失败都留在框内可读
      setSubmitError(err instanceof ApiError ? err.message : "创建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建样本</DialogTitle>
        </DialogHeader>
        <CreateSampleFormBody
          sourceLabel={sourceLabel}
          onSourceLabelChange={(value) => {
            setSourceLabel(value);
            setSourceLabelError(null);
          }}
          text={text}
          onTextChange={(value) => {
            setText(value);
            setTextError(null);
          }}
          sourceLabelError={sourceLabelError}
          textError={textError}
          submitting={submitting}
          submitError={submitError}
          onSubmit={(e) => void handleSubmit(e)}
          onCancel={close}
        />
      </DialogContent>
    </Dialog>
  );
}
