// 新建范文样本弹窗（卡 4 改版）
//
// 契约：`docs/ui/DESIGN.md` §作家文风练习区「新建样本弹窗」= 受控 Dialog（复用
// `components/ui/dialog.tsx`，不新造浮层、不新增色值 / 字号 / 圆角）；字段 = 关联作品 `select`
// （预置作品 + 「其他」；必选，默认「其他」）+ 片段说明 `input`（可空）+ 范文 `TextArea`
// + 「导入文本文件」按钮（`.txt` / `.md`）。
// - 作品选项与「其他」文案**一律取 shared**（预置清单经 `AuthorEntry` 传入、兜底文案
//   `PRACTICE_OTHER_WORK_LABEL`），不手抄作品清单、不手抄「其他」字面量
// - 上限取 shared 常量（`docs/api/120-api-practice.md`「范文样本」：`text` trim 非空 +
//   `MAX_PRACTICE_SAMPLE_CHARS`；`excerpt_label` 可空 + `MAX_PRACTICE_EXCERPT_LABEL_CHARS`）
//   ——提示文案的数字由常量插值，不复述
// - 导入 = 「读文件（`readTextFile`：UTF-8 → GB18030 回落）→ 校验 → 落地」：超上限 / 空文件
//   只报框内错误并**保留用户已输入内容**，不静默截断、不覆盖；文件名去扩展名预填「片段说明」（可改可清）
// - 范文是**快照**：落库后不可变（`60-practice.md` §1），故本弹窗只负责粘贴 / 导入落库，不提供编辑入口
//
// 分层：`CreateSampleFormBody` = 纯展示（SSR 走查用；弹窗外壳走 portal，SSR 不支持）；
//       `CreateSampleDialog` = 容器（表单状态 + POST /practice/samples）。
import { useRef, useState, type FormEvent } from "react";
import { Button, Input, Select } from "antd";
import { ImportOutlined } from "@ant-design/icons";
import {
  MAX_PRACTICE_EXCERPT_LABEL_CHARS,
  MAX_PRACTICE_SAMPLE_CHARS,
  PRACTICE_OTHER_WORK_LABEL,
  type AuthorEntry,
} from "@whispering233/ai-editor-shared";
import { ApiError, createPracticeSample } from "../../lib/api";
import { readTextFile } from "../../lib/document-io";
import { useUiStore } from "../../stores/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** `select` 里「其他」的选项值：`work_id` 用 `null` 表达，控件的字符串值域拿空串兜底 */
export const OTHER_WORK_SELECT_VALUE = "";

/** 字段块（标签 + 控件 + 提示；间距由容器 gap 给，不在标签上写 margin） */
const FIELD_CLASS = "flex flex-col gap-1";
/** 字段标签（标签档） */
const FIELD_LABEL_CLASS = "text-sm font-medium text-foreground";
/** 字段说明 / 上限提示（caption 档） */
const FIELD_HINT_CLASS = "text-xs text-muted-foreground";
/** 内联错误（含服务端 message 透传） */
const FIELD_ERROR_CLASS = "text-xs text-destructive";

/** 文件名去掉扩展名 = 片段说明的预填值（超上限按上限裁——控件侧同样以它 `maxLength`） */
export function sampleExcerptLabelFromFileName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "").slice(0, MAX_PRACTICE_EXCERPT_LABEL_CHARS);
}

/** 导入落地判定（纯函数，便于钉住「不静默截断」） */
export type SampleImportPlan =
  | { action: "apply"; excerptLabel: string; text: string }
  | { action: "error"; message: string };

/**
 * 导入文本文件的落地判定：正文 trim 空（含空文件）→ 报错；超上限 → 报错并**丢弃这次导入**
 * （调用点保留原输入，绝不静默截断）；否则成功 = 正文原样 + 文件名预填片段说明。
 */
export function planSampleImport(fileName: string, text: string): SampleImportPlan {
  if (text.trim() === "") return { action: "error", message: "这个文件里没有文本" };
  if (text.length > MAX_PRACTICE_SAMPLE_CHARS) {
    return {
      action: "error",
      message: `文件太长（${text.length} 字，最多 ${MAX_PRACTICE_SAMPLE_CHARS} 字），请先裁剪再导入`,
    };
  }
  return { action: "apply", excerptLabel: sampleExcerptLabelFromFileName(fileName), text };
}

export interface CreateSampleFormBodyProps {
  /** 关联作品选项（预置作品清单 + 末尾「其他」） */
  workOptions: { value: string; label: string }[];
  workId: string;
  onWorkIdChange: (value: string) => void;
  excerptLabel: string;
  onExcerptLabelChange: (value: string) => void;
  text: string;
  onTextChange: (value: string) => void;
  excerptLabelError: string | null;
  textError: string | null;
  /** 导入失败文案（读不出文本 / 超上限；框内可见，原输入保留） */
  importError: string | null;
  onImportClick: () => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}

/** 新建范文样本表单内容体（纯展示：无 effect、无请求） */
export function CreateSampleFormBody({
  workOptions,
  workId,
  onWorkIdChange,
  excerptLabel,
  onExcerptLabelChange,
  text,
  onTextChange,
  excerptLabelError,
  textError,
  importError,
  onImportClick,
  submitting,
  submitError,
  onSubmit,
  onCancel,
}: CreateSampleFormBodyProps) {
  return (
    <form id="create-practice-sample-form" onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className={FIELD_CLASS}>
        <p className={FIELD_LABEL_CLASS}>关联作品</p>
        <Select
          className="w-full"
          value={workId}
          options={workOptions}
          popupMatchSelectWidth={false}
          disabled={submitting}
          onChange={(value: string) => onWorkIdChange(value)}
        />
      </div>

      <div className={FIELD_CLASS}>
        <p className={FIELD_LABEL_CLASS}>片段说明</p>
        <Input
          autoFocus
          value={excerptLabel}
          maxLength={MAX_PRACTICE_EXCERPT_LABEL_CHARS}
          disabled={submitting}
          placeholder="如：开头一段（可留空）"
          onChange={(e) => onExcerptLabelChange(e.target.value)}
        />
        {excerptLabelError !== null && <p className={FIELD_ERROR_CLASS}>{excerptLabelError}</p>}
      </div>

      <div className={FIELD_CLASS}>
        <div className="flex items-center gap-2">
          <p className={FIELD_LABEL_CLASS}>范文</p>
          <span className="ml-auto">
            <Button size="small" icon={<ImportOutlined />} disabled={submitting} onClick={onImportClick}>
              导入文本文件
            </Button>
          </span>
        </div>
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
        ) : importError !== null ? (
          <p className={FIELD_ERROR_CLASS}>{importError}</p>
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
  /** 当前工作区的预置作家（`null` = 未解析：选项只剩「其他」） */
  author: AuthorEntry | null;
  /** 预选作品（`null` = 「其他」；列表分组用它预选本组作品） */
  defaultWorkId: string | null;
  onOpenChange: (open: boolean) => void;
  /** 创建成功（调用方据此重拉列表；不做乐观更新） */
  onCreated: () => void;
}

/** 新建范文样本弹窗（容器：作品 / 片段说明 / 范文状态 + 文件导入 + POST /practice/samples） */
export function CreateSampleDialog({
  author,
  defaultWorkId,
  onOpenChange,
  onCreated,
}: CreateSampleDialogProps) {
  // 只在挂载时取初值：调用点在打开时才挂载本组件（关窗即卸载）⇒ 每次打开都是干净表单
  const [workId, setWorkId] = useState(defaultWorkId ?? OTHER_WORK_SELECT_VALUE);
  const [excerptLabel, setExcerptLabel] = useState("");
  const [text, setText] = useState("");
  const [excerptLabelError, setExcerptLabelError] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** 隐藏的文件选择框（导入入口：文件读进输入框，不新增传输形态） */
  const fileInputRef = useRef<HTMLInputElement>(null);

  const workOptions = [
    ...(author?.works ?? []).map((work) => ({ value: work.id, label: work.name })),
    { value: OTHER_WORK_SELECT_VALUE, label: PRACTICE_OTHER_WORK_LABEL },
  ];

  /** 导入文本文件：读 → 校验 → 落地或报错（失败时输入框原样不动） */
  async function importFile(file: File): Promise<void> {
    try {
      const plan = planSampleImport(file.name, await readTextFile(file));
      if (plan.action === "error") {
        setImportError(plan.message);
        return;
      }
      setText(plan.text);
      // 文件名预填片段说明（用户可改可清）；导入成功即清掉上一次的导入错误
      setExcerptLabel(plan.excerptLabel);
      setImportError(null);
      setTextError(null);
      setExcerptLabelError(null);
    } catch {
      setImportError("文件读取失败，请重试");
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedText = text.trim();
    if (trimmedText === "") {
      setTextError("请粘贴或导入范文");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const trimmedLabel = excerptLabel.trim();
      await createPracticeSample({
        // 空串 = 「其他」⇒ 送 null（服务端不认空串 work id）
        work_id: workId === OTHER_WORK_SELECT_VALUE ? null : workId,
        // 留空 = 不送该字段（服务端写空串）
        ...(trimmedLabel === "" ? {} : { excerpt_label: trimmedLabel }),
        text: trimmedText,
      });
      useUiStore.getState().showToast("已新建范文");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      // 不吞错：服务端 400（超上限 / 未知作品）与网络失败都留在框内可读
      setSubmitError(err instanceof ApiError ? err.message : "创建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建样本</DialogTitle>
        </DialogHeader>
        <CreateSampleFormBody
          workOptions={workOptions}
          workId={workId}
          onWorkIdChange={setWorkId}
          excerptLabel={excerptLabel}
          onExcerptLabelChange={(value) => {
            setExcerptLabel(value);
            setExcerptLabelError(null);
          }}
          text={text}
          onTextChange={(value) => {
            setText(value);
            setTextError(null);
            setImportError(null);
          }}
          excerptLabelError={excerptLabelError}
          textError={textError}
          importError={importError}
          onImportClick={() => fileInputRef.current?.click()}
          submitting={submitting}
          submitError={submitError}
          onSubmit={(e) => void handleSubmit(e)}
          onCancel={() => onOpenChange(false)}
        />
        {/* 导入入口：隐藏文件框（浏览器与桌面同一套；选完清空 value 以便重复选同一文件） */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md"
          className="hidden"
          aria-label="选择要导入的范文文件"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file !== undefined) void importFile(file);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}