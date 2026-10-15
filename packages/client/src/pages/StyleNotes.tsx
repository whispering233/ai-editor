// 作家风格说明页（`#/style`）——预置风格说明的渲染 / 编辑 / 导入 `.md` / 恢复预置。
//
// 契约：
// - 视觉 / 几何 = `docs/ui/DESIGN.md` §作家文风练习区「作家风格说明」：页头常驻模板；默认态 =
//   `card` 面 markdown（`@ant-design/x-markdown`）；页头右端组 = `[编辑]` `[导入 .md]` `[恢复预置]`；
//   编辑态 = `Input.TextArea`（md 源码，上限取 shared 常量）+ `[保存]`（primary）+ `[取消]`；
//   有用户覆盖时一行 `caption-text`「当前为自定义版本」；恢复预置后按钮组只留 `[编辑]` `[导入 .md]`
// - 数据 = `docs/api/120-api-practice.md`「作家风格说明素材包」：读 = 用户覆盖 `??` 预置
//   （`getPracticeStylePack`，`customized` 判覆盖），写 = `PUT`（**禁用空内容**——空覆盖等于恢复预置，
//   语义上无意义），恢复 = `DELETE`（幂等）
// - **导入与恢复预置都会丢弃当前生效内容** ⇒ 一律先过受控确认框（复用 `components/ui/dialog.tsx`；
//   `[确认]` 走 `type="primary" danger`——与删书确认框同口径）
// - 保存 = 页内「保存」按钮 + 全站 `Ctrl/Cmd+S`（既有注册栈 `useSaveShortcut`）：失败必须
//   `return false` 阻断存档；导入 / 恢复不是「保存当前编辑」，**不接快捷键**
// - 作家未解析（存量工作区 `author_id` 缺失 / 未知）→ 空态且**不给任何动作按钮**（端点必然 400）
//
// 分层：`StyleNotesBody` = 纯展示（无 effect、无请求，导出供 SSR 走查——仓内无 jsdom）；
// 默认导出 = 容器（取数 + 保存 / 导入 / 恢复动作 + 确认框）。
import { useEffect, useRef, useState } from "react";
import {
  MAX_PRACTICE_STYLE_PACK_CHARS,
  resolveAuthor,
  type AuthorEntry,
  type PracticeStylePack,
} from "@whispering233/ai-editor-shared";
import Markdown from "@ant-design/x-markdown";
import { Alert, Button, Input, Skeleton } from "antd";
import { EditOutlined, ImportOutlined } from "@ant-design/icons";
import {
  ApiError,
  getPracticeStylePack,
  resetPracticeStylePack,
  updatePracticeStylePack,
} from "../lib/api";
import { readTextFile } from "../lib/document-io";
import { useSaveShortcut } from "../lib/save-shortcut";
import { AUTHOR_MISSING_HINT } from "../lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 编辑态文本域行数下限（内容更多时自动长高；纯布局常量，无第二处引用） */
const EDIT_MIN_ROWS = 16;

export interface StyleNotesBodyProps {
  /** 当前工作区的预置作家（`null` = 未解析 → 空态、无动作按钮） */
  author: AuthorEntry | null;
  /** 生效内容（用户覆盖 `??` 预置）；`null` = 加载中或加载失败（由 `loadError` 区分） */
  pack: PracticeStylePack | null;
  loadError: string | null;
  onRetry: () => void;
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  saving: boolean;
  /** 保存失败文案（编辑态内可见，不静默） */
  saveError: string | null;
  /** 「保存」（`Ctrl/Cmd+S` 走同一动作） */
  onSave: () => void;
  onImportClick: () => void;
  onResetClick: () => void;
}

/** 页面全貌（页头 + 内容区；动作经 props 传入，纯展示） */
export function StyleNotesBody({
  author,
  pack,
  loadError,
  onRetry,
  editing,
  draft,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  saving,
  saveError,
  onSave,
  onImportClick,
  onResetClick,
}: StyleNotesBodyProps) {
  const customized = pack?.customized === true;
  return (
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="作家风格说明"
        controls={
          author !== null && !editing ? (
            <span className="ml-auto flex items-center gap-2">
              <Button size="small" icon={<EditOutlined />} onClick={onStartEdit}>
                编辑
              </Button>
              <Button size="small" icon={<ImportOutlined />} onClick={onImportClick}>
                导入 .md
              </Button>
              {/* 恢复预置只在对预置有覆盖时出现（无覆盖时它是个 no-op 按钮） */}
              {customized && (
                <Button size="small" onClick={onResetClick}>
                  恢复预置
                </Button>
              )}
            </span>
          ) : undefined
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {author === null ? (
          <EmptyState padding="sm">{AUTHOR_MISSING_HINT}</EmptyState>
        ) : editing ? (
          <SectionCard title="编辑风格说明">
            <Input.TextArea
              value={draft}
              rows={EDIT_MIN_ROWS}
              maxLength={MAX_PRACTICE_STYLE_PACK_CHARS}
              disabled={saving}
              onChange={(e) => onDraftChange(e.target.value)}
            />
            {saveError !== null ? (
              <p className="mt-2 text-sm text-destructive">{saveError}</p>
            ) : (
              // 上限提示：数字由常量插值（数值单源，不复述）
              <p className="mt-2 text-xs text-muted-foreground">
                最多 {MAX_PRACTICE_STYLE_PACK_CHARS} 字
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Button type="primary" loading={saving} onClick={onSave}>
                保存
              </Button>
              <Button disabled={saving} onClick={onCancelEdit}>
                取消
              </Button>
            </div>
          </SectionCard>
        ) : pack === null ? (
          loadError !== null ? (
            <Alert
              type="error"
              showIcon
              message={loadError}
              action={
                <Button size="small" onClick={onRetry}>
                  重试
                </Button>
              }
            />
          ) : (
            <Skeleton active title={false} paragraph={{ rows: 4 }} />
          )
        ) : (
          <div className="flex flex-col gap-2">
            {customized && <p className="text-xs text-muted-foreground">当前为自定义版本</p>}
            <SectionCard>
              <Markdown>{pack.content}</Markdown>
            </SectionCard>
          </div>
        )}
      </div>
    </section>
  );
}

/** 待确认的破坏性动作（两者都会丢弃当前生效内容） */
type PendingAction = "import" | "reset";

export default function StyleNotes() {
  const authorId = useProjectStore((s) => s.config?.authorId ?? null);
  const author = resolveAuthor(authorId);
  const showToast = useUiStore((s) => s.showToast);

  const [pack, setPack] = useState<PracticeStylePack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  /** 保存失败（编辑态内可见）与导入失败（页内一行）分开记：两者出现的位置不同 */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  /** 已读入、等待确认的导入内容（`null` = 还没选文件） */
  const [importText, setImportText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (author === null) {
      setPack(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setPack(null);
    setLoadError(null);
    getPracticeStylePack()
      .then((res) => {
        if (!cancelled) setPack(res);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "加载失败，请重试");
      });
    return () => {
      cancelled = true;
    };
    // 依赖按 [authorId, reloadTick] 记（作者对象由 authorId 派生；本仓库未启用 exhaustive-deps 规则）
  }, [authorId, reloadTick]);

  /** 保存编辑中的 md 源码（页内「保存」与 `Ctrl/Cmd+S` 的同一入口）；**返回 false = 本次失败** */
  async function save(): Promise<boolean> {
    if (draft.trim() === "") {
      setSaveError("风格说明不能为空");
      return false;
    }
    setSaving(true);
    setSaveError(null);
    try {
      setPack(await updatePracticeStylePack(draft));
      setEditing(false);
      showToast("风格说明已保存");
      return true;
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "保存失败，请重试");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // 只在编辑态接快捷键：非编辑态的本页没有「保存当前编辑」语义
  useSaveShortcut(() => save(), editing);

  function startEdit(): void {
    setDraft(pack?.content ?? "");
    setSaveError(null);
    setActionError(null);
    setEditing(true);
  }

  function cancelEdit(): void {
    setEditing(false);
    setSaveError(null);
  }

  function closePending(): void {
    setPending(null);
    setImportText(null);
    setActionError(null);
  }

  /** 选文件 → 读文本（UTF-8 → GB18030 回落）→ 校验 → **开确认框**（确认前不写库） */
  async function handleImportFile(file: File | null): Promise<void> {
    if (file === null) return;
    setActionError(null);
    const text = await readTextFile(file).catch(() => null);
    if (text === null) {
      setActionError("读不出文件内容，请换一个文件");
      return;
    }
    if (text.trim() === "") {
      setActionError("这个文件里没有文本");
      return;
    }
    if (text.length > MAX_PRACTICE_STYLE_PACK_CHARS) {
      setActionError(
        `文件太长（${text.length} 字，最多 ${MAX_PRACTICE_STYLE_PACK_CHARS} 字），请先裁剪再导入`,
      );
      return;
    }
    setImportText(text);
    setPending("import");
  }

  /** 确认框的落地动作（失败留框并就地报错，不关框——重新选文件的代价比再看一眼错误高） */
  async function confirmPending(): Promise<void> {
    if (pending === null) return;
    setSaving(true);
    setActionError(null);
    try {
      if (pending === "import") {
        if (importText === null) return;
        setPack(await updatePracticeStylePack(importText));
        showToast("已导入风格说明");
      } else {
        setPack(await resetPracticeStylePack());
        showToast("已恢复预置风格说明");
      }
      closePending();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "操作失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <StyleNotesBody
        author={author}
        pack={pack}
        loadError={loadError}
        onRetry={() => setReloadTick((t) => t + 1)}
        editing={editing}
        draft={draft}
        onDraftChange={setDraft}
        onStartEdit={startEdit}
        onCancelEdit={cancelEdit}
        saving={saving}
        saveError={saveError}
        onSave={() => void save()}
        onImportClick={() => {
          setActionError(null);
          fileInputRef.current?.click();
        }}
        onResetClick={() => {
          setActionError(null);
          setPending("reset");
        }}
      />
      {/* 导入的选文件入口（`[导入 .md]` 触发；读出的文本先进确认框，不直接写库） */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown"
        aria-label="选择风格说明文件"
        className="hidden"
        onChange={(e) => {
          void handleImportFile(e.target.files?.[0] ?? null);
          e.target.value = ""; // 同一文件可再次选择（否则 change 不触发）
        }}
      />
      {actionError !== null && pending === null && (
        <p className="mt-2 text-sm text-destructive">{actionError}</p>
      )}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) closePending();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{pending === "import" ? "导入风格说明" : "恢复预置风格说明"}</DialogTitle>
            <DialogDescription>
              {pending === "import"
                ? "导入会替换当前生效的风格说明，原有内容不再保留。"
                : "恢复预置会丢弃当前自定义版本，回到产品预置的风格说明。"}
            </DialogDescription>
          </DialogHeader>
          {actionError !== null && <p className="mt-2 text-sm text-destructive">{actionError}</p>}
          <DialogFooter>
            <Button onClick={closePending} disabled={saving}>
              取消
            </Button>
            <Button type="primary" danger loading={saving} onClick={() => void confirmPending()}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
