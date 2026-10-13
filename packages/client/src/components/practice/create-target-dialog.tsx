// 新建文风目标弹窗（卡 9）
//
// 契约：`docs/ui/DESIGN.md` §文风练习区「新建目标 / 新建样本弹窗」= 受控 Dialog（复用
// `components/ui/dialog.tsx`，不新造浮层、不新增色值 / 字号 / 圆角）；字段 = 名字 +「我的观察」（可选）；
// 上限取 shared 常量（`docs/api/120-api-practice.md`：名字 trim 非空 + `MAX_PRACTICE_TARGET_NAME_CHARS`，
// 观察上限 `MAX_PRACTICE_OBSERVATION_CHARS`——**文案由常量插值，不复述数字**）。
// 分层：`CreateTargetFormBody` = 纯展示（SSR 走查用，仓内无 jsdom；弹窗外壳走 portal，SSR 不支持）；
//       `CreateTargetDialog` = 容器（表单状态 + 请求）。创建成功 = toast + 关窗 + 交调用方刷新列表。
import { useState, type FormEvent } from "react";
import { Button, Input } from "antd";
import {
  MAX_PRACTICE_OBSERVATION_CHARS,
  MAX_PRACTICE_TARGET_NAME_CHARS,
} from "@whispering233/ai-editor-shared";
import { ApiError, createPracticeTarget } from "../../lib/api";
import { useUiStore } from "../../stores/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** 字段标签（与新建样本弹窗同款；DESIGN「按钮与表单」之下的标签档） */
const FIELD_LABEL_CLASS = "mb-1 text-sm font-medium text-foreground";
/** 字段说明 / 上限提示（caption 档） */
const FIELD_HINT_CLASS = "mt-1 text-xs text-muted-foreground";
/** 内联错误（含服务端 message 透传） */
const FIELD_ERROR_CLASS = "mt-1 text-xs text-destructive";

export interface CreateTargetFormBodyProps {
  name: string;
  onNameChange: (value: string) => void;
  observation: string;
  onObservationChange: (value: string) => void;
  /** 名字的前端校验错误（提交时才可能非空） */
  nameError: string | null;
  submitting: boolean;
  /** 提交失败提示（服务端 message 透传，不吞错） */
  submitError: string | null;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}

/** 新建文风目标表单内容体（纯展示：无 effect、无请求） */
export function CreateTargetFormBody({
  name,
  onNameChange,
  observation,
  onObservationChange,
  nameError,
  submitting,
  submitError,
  onSubmit,
  onCancel,
}: CreateTargetFormBodyProps) {
  return (
    <form id="create-practice-target-form" onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <p className={FIELD_LABEL_CLASS}>文风目标名</p>
        <Input
          autoFocus
          value={name}
          maxLength={MAX_PRACTICE_TARGET_NAME_CHARS}
          disabled={submitting}
          placeholder="如：汪曾祺的克制冷叙述"
          onChange={(e) => onNameChange(e.target.value)}
        />
        {nameError !== null && <p className={FIELD_ERROR_CLASS}>{nameError}</p>}
      </div>

      <div>
        <p className={FIELD_LABEL_CLASS}>我的观察（可选）</p>
        <Input.TextArea
          value={observation}
          rows={3}
          maxLength={MAX_PRACTICE_OBSERVATION_CHARS}
          disabled={submitting}
          placeholder="你自己留意到的文风特点，如：多用短句、少形容词"
          onChange={(e) => onObservationChange(e.target.value)}
        />
        {/* 上限提示：数字由常量插值（数值单源，禁复述） */}
        <p className={FIELD_HINT_CLASS}>最多 {MAX_PRACTICE_OBSERVATION_CHARS} 字，留空则不记录</p>
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

export interface CreateTargetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 创建成功（调用方据此重拉列表；不做乐观更新） */
  onCreated: () => void;
}

/** 新建文风目标弹窗（容器：名字 / 观察状态 + POST /practice/targets） */
export function CreateTargetDialog({ open, onOpenChange, onCreated }: CreateTargetDialogProps) {
  const [name, setName] = useState("");
  const [observation, setObservation] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** 关窗即清空（Esc / 遮罩 / X / 取消四条路径等价；下次打开是干净表单） */
  function close(): void {
    setName("");
    setObservation("");
    setNameError(null);
    setSubmitError(null);
    onOpenChange(false);
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === "") {
      // 必填只在前端判（服务端同样 400，但本地提示更快、更贴近字段）
      setNameError("请填文风目标名");
      return;
    }
    const trimmedObservation = observation.trim();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createPracticeTarget({
        name: trimmedName,
        // 留空 = 不送该字段（服务端写 NULL）；不制造空串观察
        ...(trimmedObservation === "" ? {} : { observation: trimmedObservation }),
      });
      useUiStore.getState().showToast(`已新建目标《${created.name}》`);
      close();
      onCreated();
    } catch (err) {
      // 不吞错：服务端 400（超上限 / 字段非法）与网络失败都留在框内可读
      setSubmitError(err instanceof ApiError ? err.message : "创建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog open onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建文风目标</DialogTitle>
        </DialogHeader>
        <CreateTargetFormBody
          name={name}
          onNameChange={(value) => {
            setName(value);
            setNameError(null);
          }}
          observation={observation}
          onObservationChange={setObservation}
          nameError={nameError}
          submitting={submitting}
          submitError={submitError}
          onSubmit={(e) => void handleSubmit(e)}
          onCancel={close}
        />
      </DialogContent>
    </Dialog>
  );
}
