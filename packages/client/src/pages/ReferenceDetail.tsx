// 参考资料详情页（决策 36，批次九；references.md）
// 结构：面包屑（back + 标题）+ 全文详读（宋体长文滚动）+ 来源/标签/时间 + 编辑/删除
// 数据：getEntityDetail("reference", id)；编辑对话框复用列表页表单形态（标题/分类/内容/来源/标签）
import { useEffect, useState } from "react";
import { BookOpenText, ExternalLink, Loader2, Pencil, Trash2 } from "lucide-react";
import type { EntityDetailRes } from "../lib/api";
import { deleteEntity, getEntityDetail, updateEntity } from "../lib/api";
import { ApiError } from "../lib/api";
import { REFERENCE_TYPES } from "@whispering233/ai-editor-shared";
import type { ReferenceTypeValue } from "@whispering233/ai-editor-shared";
import { parseTagsInput, tagsToInput } from "../lib/timeline";
import { navigate } from "../hooks/use-route";
import { useUiStore } from "../stores/ui";
import { cn } from "../lib/utils";
import { errorBannerClass, inputClass, skeletonClass } from "../lib/styles";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";

const TYPE_LABELS: Record<ReferenceTypeValue, string> = {
  material: "素材摘抄",
  inspiration: "灵感记录",
  theory: "写作理论",
  reference: "设定参考",
};

interface EditForm {
  name: string;
  type: ReferenceTypeValue;
  content: string;
  source: string;
  tagsInput: string;
}

export default function ReferenceDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<EntityDetailRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // 编辑对话框
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    getEntityDetail("reference", id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "加载失败，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadTick]);

  if (error !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className={cn(errorBannerClass)}>{error}</p>
        <Button variant="outline" size="sm" onClick={() => setReloadTick((t) => t + 1)}>
          重试
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate("#/references")}>
          返回列表
        </Button>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="space-y-3 p-4">
        <div className={cn(skeletonClass, "h-8 w-1/3")} />
        <div className={cn(skeletonClass, "h-64 w-full")} />
      </div>
    );
  }

  const current = detail as NonNullable<typeof detail>; // early return 后非空（闭包引用绕开 TS 收窄）
  const type = (current.data?.type as ReferenceTypeValue | undefined) ?? "material";
  const content = typeof current.data?.content === "string" ? (detail.data.content as string) : "";
  const source = typeof current.data?.source === "string" ? (detail.data.source as string) : "";
  const tags: string[] = Array.isArray(current.data?.tags) ? (detail.data.tags as unknown[]).filter((t): t is string => typeof t === "string" && t !== "") : [];
  const createdAt = current.createdAt;
  const updatedAt = current.updatedAt;

  function openEdit() {
    setForm({
      name: current.name,
      type,
      content,
      source,
      tagsInput: tagsToInput(current.data?.tags),
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (form === null) return;
    const name = form.name.trim();
    if (name === "") {
      setFormError("标题必填");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const data = {
        type: form.type,
        ...(form.content.trim() !== "" ? { content: form.content } : {}),
        ...(form.source.trim() !== "" ? { source: form.source } : {}),
        ...(parseTagsInput(form.tagsInput).length > 0 ? { tags: parseTagsInput(form.tagsInput) } : {}),
      };
      await updateEntity("reference", current.id, { data });
      useUiStore.getState().showToast("已保存");
      setDialogOpen(false);
      setReloadTick((t) => t + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteEntity("reference", current.id);
      useUiStore.getState().showToast("已移入回收站，可随时还原");
      navigate("#/references");
    } catch (e) {
      useUiStore.getState().showToast(e instanceof ApiError ? e.message : "删除失败，请重试", "error");
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 面包屑 + 操作 */}
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <a href="#/references" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          ← 参考资料
        </a>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="min-w-0 truncate text-sm text-foreground">{detail.name}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={openEdit}>
            <Pencil className="size-3.5" />
            编辑
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="size-3.5" />
            删除
          </Button>
        </div>
      </div>

      {/* 标题 + 元信息 */}
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="font-serif text-xl font-medium">{detail.name}</h1>
          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {TYPE_LABELS[type] ?? type}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {tags.map((t) => (
            <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">
              {t}
            </span>
          ))}
          {source !== "" && (
            <a
              href={/^https?:\/\//.test(source) ? source : undefined}
              target={/^https?:\/\//.test(source) ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {source}
              {/^https?:\/\//.test(source) && <ExternalLink className="size-3" />}
            </a>
          )}
          <span>创建 {formatTime(createdAt)}</span>
          <span>更新 {formatTime(updatedAt)}</span>
        </div>
      </div>

      {/* 全文（宋体长文滚动区） */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card p-5">
        {content !== "" ? (
          <div className="whitespace-pre-wrap break-words font-serif text-base leading-7 text-foreground">
            {content}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <BookOpenText className="size-8 text-muted-foreground/40" />
            本条参考资料暂无内容
            <Button variant="outline" size="sm" onClick={openEdit}>
              去补充
            </Button>
          </div>
        )}
      </div>

      {/* 编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑参考资料</DialogTitle>
          </DialogHeader>
          {form !== null && (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm text-muted-foreground">标题</span>
                <input className={cn(inputClass, "w-full")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-muted-foreground">分类</span>
                <select className={cn(inputClass, "w-full")} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ReferenceTypeValue })}>
                  {(REFERENCE_TYPES as readonly ReferenceTypeValue[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-muted-foreground">内容</span>
                <textarea className={cn(inputClass, "min-h-40 w-full resize-y leading-6")} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-muted-foreground">来源（可选）</span>
                <input className={cn(inputClass, "w-full")} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-muted-foreground">标签</span>
                <input className={cn(inputClass, "w-full")} value={form.tagsInput} onChange={(e) => setForm({ ...form, tagsInput: e.target.value })} placeholder="逗号分隔" />
              </label>
              {formError !== null && <p className="text-xs text-destructive">{formError}</p>}
              <div className="flex justify-end gap-1.5 pt-1">
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                  取消
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  保存
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** 时间显示（同 Sidebar 紧凑格式：当年 MM-DD、跨年 YY-MM-DD） */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : `${pad(d.getFullYear() % 100)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
