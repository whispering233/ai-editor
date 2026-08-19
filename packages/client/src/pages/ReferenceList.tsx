// 参考资料列表页（决策 36，批次九；references.md）
// 结构：固定区（标题 + 新建）+ 筛选行（分类/标签/搜索）+ 列表（divide-y 卡片）
// 数据：listEntities("reference", { q, tag, limit: 200 }) 一次全量拉取（参考资料量小），
//   type 分类过滤在前端（列表摘要 summary.type 由 db toSummary 提供）；
// 交互：新建/编辑 Dialog（标题/分类/内容/来源/标签）、软删直接执行 + toast（H2 语义）、
//   行点击跳详情 #/references/:id
import { useEffect, useMemo, useState } from "react";
import { BookOpenText, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { REFERENCE_TYPES } from "@whispering233/ai-editor-shared";
import type { ReferenceTypeValue } from "@whispering233/ai-editor-shared";
import { createEntity, deleteEntity, getEntityDetail, listEntities, updateEntity } from "../lib/api";
import { ApiError } from "../lib/api";
import { applyTagSuggestion, parseTagsInput, suggestTags, tagsToInput } from "../lib/timeline";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";
import { cn } from "../lib/utils";
import { errorBannerClass, inputClass, sectionCardClass, skeletonClass } from "../lib/styles";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { TagSuggest } from "../components/timeline/TagSuggest";
import { EmptyState } from "../components/ui/empty-state";

/** 分类中文映射（列表徽标 / 下拉选项） */
const TYPE_LABELS: Record<ReferenceTypeValue, string> = {
  material: "素材摘抄",
  inspiration: "灵感记录",
  theory: "写作理论",
  reference: "设定参考",
};

/** 参考资料表单（新建/编辑共用） */
interface RefForm {
  name: string;
  type: ReferenceTypeValue;
  content: string;
  source: string;
  tagsInput: string;
}

const EMPTY_FORM: RefForm = { name: "", type: "material", content: "", source: "", tagsInput: "" };

export default function ReferenceList() {
  const config = useProjectStore((s) => s.config);
  const [items, setItems] = useState<EntitySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  useDataRefresh(() => setReloadTick((t) => t + 1));

  // 筛选状态
  const [keyword, setKeyword] = useState("");
  const [activeType, setActiveType] = useState<ReferenceTypeValue | "all">("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // 新建/编辑对话框（editTarget 非空 = 编辑态）
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EntitySummary | null>(null);
  const [form, setForm] = useState<RefForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 数据加载
  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    listEntities("reference", { limit: 200 })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "加载失败，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // 聚合标签池（列表摘要 tags 前 3 个 —— 为覆盖全量已用 limit 200 拉取）
  const tagPool = useMemo(() => {
    const set = new Set<string>();
    for (const it of items ?? []) {
      const tags = it.summary?.tags;
      if (Array.isArray(tags)) for (const t of tags) if (typeof t === "string" && t !== "") set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // 标签输入建议（复用 F8 纯函数）
  const tagSuggestions = suggestTags(form.tagsInput, tagPool);

  // 过滤后可见列表：标签（服务端已筛） + 分类（前端）+ 关键词（前端 name/摘要命中）
  const visible = useMemo(() => {
    if (items === null) return null;
    const kw = keyword.trim().toLowerCase();
    return items
      .filter((it) => {
        if (activeType !== "all" && it.summary?.type !== activeType) return false;
        if (activeTag !== null && !Array.isArray(it.summary?.tags)) return false;
        if (activeTag !== null && !(it.summary?.tags as string[]).includes(activeTag)) return false;
        if (kw !== "") {
          const name = it.name.toLowerCase();
          const content = typeof it.summary?.content === "string" ? (it.summary.content as string).toLowerCase() : "";
          if (!name.includes(kw) && !content.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }, [items, keyword, activeType, activeTag]);

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(item: EntitySummary) {
    setEditTarget(item);
    const data = item.summary; // 列表摘要——编辑需完整 data，详情接口另行获取
    setForm({
      name: item.name,
      type: (data?.type as ReferenceTypeValue) ?? "material",
      content: typeof data?.content === "string" ? (data.content as string).slice(0, 0) : "", // 摘要截断——编辑以详情为准
      source: "",
      tagsInput: "",
    });
    // 编辑用完整详情（列表摘要 content 截断 120 字，需详情接口取全文）
    void getEntityDetail("reference", item.id).then((d) => {
      setForm({
        name: d.name,
        type: (d.data?.type as ReferenceTypeValue) ?? "material",
        content: typeof d.data?.content === "string" ? (d.data.content as string) : "",
        source: typeof d.data?.source === "string" ? (d.data.source as string) : "",
        tagsInput: tagsToInput(d.data?.tags),
      });
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
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
      if (editTarget === null) {
        await createEntity("reference", { name, data });
        useUiStore.getState().showToast(`已创建参考资料《${name}》`);
      } else {
        await updateEntity("reference", editTarget.id, { data });
        useUiStore.getState().showToast("已保存");
      }
      setDialogOpen(false);
      useUiStore.getState().notifyDataChanged();
      setReloadTick((t) => t + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: EntitySummary) {
    try {
      await deleteEntity("reference", item.id);
      useUiStore.getState().showToast(`已移入回收站：《${item.name}》，可随时还原`);
      setReloadTick((t) => t + 1);
    } catch (e) {
      useUiStore.getState().showToast(e instanceof ApiError ? e.message : "删除失败，请重试", "error");
    }
  }

  const disabled = config === null;

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 固定区：标题 + 操作 */}
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">参考资料</h1>
        <span className={cn("ml-auto", disabled && "cursor-not-allowed")} title={disabled ? "请先打开项目" : undefined}>
          <Button type="button" disabled={disabled} onClick={openCreate}>
            <Plus className="size-3.5" />
            新建参考资料
          </Button>
        </span>
      </div>

      {/* 筛选行：关键词搜索 + 分类 select + 标签 select */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className={cn(inputClass, "w-48 pl-8")}
            placeholder="搜索标题 / 内容摘要…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <select
          className={cn(inputClass, "w-32")}
          value={activeType}
          onChange={(e) => setActiveType(e.target.value as ReferenceTypeValue | "all")}
        >
          <option value="all">全部分类</option>
          {(REFERENCE_TYPES as readonly ReferenceTypeValue[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          className={cn(inputClass, "w-32")}
          value={activeTag ?? ""}
          onChange={(e) => setActiveTag(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">全部标签</option>
          {tagPool.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* 错误条（单区块失败不阻塞其他） */}
      {error !== null && (
        <div className={cn(errorBannerClass, "mb-2 flex items-center gap-2")}>
          <span className="flex-1">{error}</span>
          <Button variant="outline" size="xs" onClick={() => setReloadTick((t) => t + 1)}>
            重试
          </Button>
        </div>
      )}

      {/* 滚动区：列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items === null ? (
          <div className="space-y-2">{/* 骨架 × 3 */}
            {[0, 1, 2].map((i) => (
              <div key={i} className={cn(skeletonClass, "h-16 w-full")} />
            ))}
          </div>
        ) : visible === null || visible.length === 0 ? (
          <EmptyState
            icon={<BookOpenText className="size-7 text-muted-foreground/40" />}
            action={
              keyword !== "" || activeType !== "all" || activeTag !== null ? (
                <Button variant="outline" size="sm" onClick={() => { setKeyword(""); setActiveType("all"); setActiveTag(null); }}>
                  清空筛选
                </Button>
              ) : (
                <Button size="sm" disabled={disabled} onClick={openCreate}>
                  新建参考资料
                </Button>
              )
            }
          >
            {keyword !== "" || activeType !== "all" || activeTag !== null
              ? "未找到匹配的参考资料——换个关键词或清空筛选条件试试"
              : "还没有参考资料，先新建一条——把书籍摘抄、灵感记录、写作理论保存到这里，AI 创作顾问会参考它们给出建议"}
          </EmptyState>
        ) : (
          <div className={sectionCardClass + " divide-y divide-border"}>
            {visible.map((it) => (
              <RefRow key={it.id} item={it} onOpen={openEdit} onDelete={handleDelete} onGoto={() => navigate(`#/references/${it.id}`)} />
            ))}
          </div>
        )}
      </div>

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget === null ? "新建参考资料" : "编辑参考资料"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">标题</label>
              <input
                className={cn(inputClass, "flex-1")}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="如：五行相生与相克 摘抄"
              />
            </div>
            <div className="flex items-start gap-2">
              <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">分类</label>
              <select
                className={cn(inputClass, "flex-1")}
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ReferenceTypeValue }))}
              >
                {(REFERENCE_TYPES as readonly ReferenceTypeValue[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-start gap-2">
              <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">内容</label>
              <textarea
                className={cn(inputClass, "min-h-32 flex-1 resize-y leading-6")}
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="粘贴或记录参考内容全文…"
              />
            </div>
            <div className="flex items-start gap-2">
              <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">来源</label>
              <input
                className={cn(inputClass, "flex-1")}
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                placeholder="可选：URL / 书名 / 作者"
              />
            </div>
            <div className="flex items-start gap-2">
              <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">标签</label>
              <input
                className={cn(inputClass, "flex-1")}
                value={form.tagsInput}
                onChange={(e) => setForm((f) => ({ ...f, tagsInput: e.target.value }))}
                onKeyDown={(e) => {
                  // Enter 追加逗号继续输入（F8 回车添加下一项 + M1 修复）
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && form.tagsInput.trim() !== "") {
                    e.preventDefault();
                    setForm((f) => ({ ...f, tagsInput: `${f.tagsInput},` }));
                  }
                }}
                list="reference-tags"
                placeholder="逗号分隔，如：五行, 设定"
              />
              <datalist id="reference-tags">
                {tagPool.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <TagSuggest suggestions={tagSuggestions} visible={form.tagsInput.trim() !== ""} onPick={(t) => setForm((f) => ({ ...f, tagsInput: applyTagSuggestion(f.tagsInput, t) }))} />
            </div>
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
        </DialogContent>
      </Dialog>
    </section>
  );
}

interface RefRowProps {
  item: EntitySummary;
  onOpen: (item: EntitySummary) => void;
  onDelete: (item: EntitySummary) => void;
  onGoto: () => void;
}

/** 列表行：分类徽标 + 标题 + 摘要/content + 标签 + 来源 + 操作 */
function RefRow({ item, onOpen, onDelete, onGoto }: RefRowProps) {
  const type = (item.summary?.type as ReferenceTypeValue | undefined) ?? "material";
  const content = typeof item.summary?.content === "string" ? (item.summary.content as string) : "";
  const tags = Array.isArray(item.summary?.tags) ? (item.summary?.tags as string[]).filter((t): t is string => typeof t === "string" && t !== "") : [];
  return (
    <div className="group px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{TYPE_LABELS[type] ?? type}</span>
        <button type="button" onClick={onGoto} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:text-primary">
          {item.name}
        </button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => onOpen(item)} aria-label="编辑" title="编辑">
          <Pencil className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(item)} aria-label="删除" title="移入回收站">
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {content !== "" && (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{content}</p>
      )}
      {tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
