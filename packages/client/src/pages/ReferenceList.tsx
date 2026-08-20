// 参考资料列表页（决策 36 + 决策 43 批次十一；references.md）
// 卡 11.1 交互重构（决策 43 + B1 修复）：
//   - 点击标题 = 行内编辑（Enter 提交 / Esc 取消 / 失焦保存，决策 37/38 模式）
//   - 双击行 = 进详情页（编辑态/按钮区不触发）
//   - 移除 Pencil 编辑按钮与编辑 Dialog（B1 异步回填竞态根除——完整编辑收敛到详情页）
//   - 行信息 = [标题、分类徽标、标签、来源]（来源列按旧 source 字段先行，kind 细化随 11.2）
//   - 保留删除按钮、右键菜单（决策 40 复用）、新建 Dialog（11.4 分流为两按钮后移除）
// 数据：listEntities("reference", { limit: 200 }) 一次全量拉取（参考资料量小），
//   分类/标签/关键词过滤在前端（列表摘要 summary.type/tags/source 由 db toSummary 提供）
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { BookOpenText, ExternalLink, Loader2, Plus, Search, Trash2 } from "lucide-react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { REFERENCE_TYPES } from "@whispering233/ai-editor-shared";
import type { ReferenceTypeValue } from "@whispering233/ai-editor-shared";
import { createEntity, deleteEntity, listEntities, updateEntity } from "../lib/api";
import { ApiError } from "../lib/api";
import { parseTagsInput } from "../lib/timeline";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";
import { cn } from "../lib/utils";
import { errorBannerClass, inputClass, sectionCardClass, skeletonClass } from "../lib/styles";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { RowContextMenu } from "../components/entity/row-context-menu";
import { EmptyState } from "../components/ui/empty-state";

/** 分类中文映射（列表徽标 / 下拉选项） */
const TYPE_LABELS: Record<ReferenceTypeValue, string> = {
  material: "素材摘抄",
  inspiration: "灵感记录",
  theory: "写作理论",
  reference: "设定参考",
};

/** 新建表单（11.4 分流前暂用 Dialog；仅新建，编辑已收敛详情页——B1 修复） */
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

  // 新建对话框（仅新建；编辑入口 = 双击详情页，B1 修复语义）
  const [dialogOpen, setDialogOpen] = useState(false);
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
      if (Array.isArray(tags))
        for (const t of tags) if (typeof t === "string" && t !== "") set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // 过滤后可见列表：分类 + 标签 + 关键词（前端过滤，列表量小）
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
          const content =
            typeof it.summary?.content === "string"
              ? (it.summary.content as string).toLowerCase()
              : "";
          if (!name.includes(kw) && !content.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }, [items, keyword, activeType, activeTag]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleCreate() {
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
        ...(parseTagsInput(form.tagsInput).length > 0
          ? { tags: parseTagsInput(form.tagsInput) }
          : {}),
      };
      await createEntity("reference", { name, data });
      useUiStore.getState().showToast(`已创建参考资料《${name}》`);
      setDialogOpen(false);
      useUiStore.getState().notifyDataChanged();
      setReloadTick((t) => t + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  /** 行内编辑标题提交（决策 43：点击标题行内编辑，PUT name；失败 toast 后 rethrow——组件保持编辑态 + 保留输入值，对齐时间轴 editFailureRecovery） */
  async function handleRename(id: string, name: string) {
    try {
      await updateEntity("reference", id, { name });
      useUiStore.getState().notifyDataChanged();
      setReloadTick((t) => t + 1);
    } catch (e) {
      useUiStore
        .getState()
        .showToast(e instanceof ApiError ? e.message : "保存失败，请重试", "error");
      throw e;
    }
  }

  async function handleDelete(item: EntitySummary) {
    try {
      await deleteEntity("reference", item.id);
      useUiStore.getState().showToast(`已移入回收站：《${item.name}》，可随时还原`);
      setReloadTick((t) => t + 1);
    } catch (e) {
      useUiStore
        .getState()
        .showToast(e instanceof ApiError ? e.message : "删除失败，请重试", "error");
    }
  }

  const disabled = config === null;

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 固定区：标题 + 操作 */}
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">参考资料</h1>
        <span
          className={cn("ml-auto", disabled && "cursor-not-allowed")}
          title={disabled ? "请先打开项目" : undefined}
        >
          <Button type="button" disabled={disabled} onClick={openCreate}>
            <Plus className="size-3.5" />
            新建参考资料
          </Button>
        </span>
      </div>

      {/* 筛选行：关键词搜索 + 分类 select + 标签 select */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
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
          <div className="space-y-2">
            {/* 骨架 × 3 */}
            {[0, 1, 2].map((i) => (
              <div key={i} className={cn(skeletonClass, "h-16 w-full")} />
            ))}
          </div>
        ) : visible === null || visible.length === 0 ? (
          <EmptyState
            icon={<BookOpenText className="size-7 text-muted-foreground/40" />}
            action={
              keyword !== "" || activeType !== "all" || activeTag !== null ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setKeyword("");
                    setActiveType("all");
                    setActiveTag(null);
                  }}
                >
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
              <RefRow
                key={it.id}
                item={it}
                onRename={handleRename}
                onDelete={handleDelete}
                onGoto={() => navigate(`#/references/${it.id}`)}
                onRelationCreated={() => setReloadTick((t) => t + 1)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 新建对话框（仅新建；编辑已收敛详情页——B1 修复；11.4 分流两按钮后移除） */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建参考资料</DialogTitle>
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
                onChange={(e) =>
                  setForm((f) => ({ ...f, type: e.target.value as ReferenceTypeValue }))
                }
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
                  if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    form.tagsInput.trim() !== ""
                  ) {
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
            </div>
            {formError !== null && <p className="text-xs text-destructive">{formError}</p>}
            <div className="flex justify-end gap-1.5 pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
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
  /** 行内编辑标题提交（页面 PUT name + 刷新；失败 rethrow——组件保持编辑态） */
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (item: EntitySummary) => void;
  /** 双击行进详情页 */
  onGoto: () => void;
  /** 建立关联成功后的数据刷新（页面 reloadTick+1） */
  onRelationCreated: () => void;
}

/** 列表行（决策 43 卡 11.1）：第一行 [标题（点击行内编辑）+ 分类徽标 + 删除]，第二行 [标签 + 来源]；
 * 双击行 = 进详情页；右键菜单 [注入会话上下文、建立关联] 复用决策 40 */
function RefRow({ item, onRename, onDelete, onGoto, onRelationCreated }: RefRowProps) {
  const type = (item.summary?.type as ReferenceTypeValue | undefined) ?? "material";
  const tags = Array.isArray(item.summary?.tags)
    ? (item.summary?.tags as string[]).filter((t): t is string => typeof t === "string" && t !== "")
    : [];
  const source = typeof item.summary?.source === "string" ? (item.summary.source as string) : "";

  // 标题行内编辑（决策 43：点击标题进入，Enter 提交 / Esc 取消 / 失焦保存；对齐时间轴 TimelineEvent 模式）
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [saving, setSaving] = useState(false);

  /** 点击标题进入行内编辑（预填当前名） */
  function startEdit() {
    setNameValue(item.name);
    setEditing(true);
  }

  /** Enter/失焦提交：trim 后空/未变 → 退出编辑不发请求；saving 守卫防 Enter+blur 双提交；
   * 失败保持编辑态 + 保留输入值（页面已 toast，此处 catch 吞掉防 unhandled rejection） */
  async function commitEdit() {
    if (saving) return;
    const name = nameValue.trim();
    if (name === "" || name === item.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(item.id, name);
      setEditing(false);
    } catch {
      // 失败保持编辑态（setEditing(false) 未执行）+ 输入值保留，可修正后重试
    } finally {
      setSaving(false);
    }
  }

  /** 行双击（决策 43）：双击 = 详情；冲突防护：双击标题 = 编辑（第一击已把 span 换成输入框，
   * dblclick target 是输入框被 closest 拦截；极端时序由 editing 守卫拦截）；双击按钮区不跳详情 */
  function handleRowDoubleClick(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    if (editing) return;
    onGoto();
  }

  return (
    <RowContextMenu
      focus={{ focus_entity_type: "reference", focus_entity_id: item.id }}
      source={{ type: "reference", id: item.id, name: item.name }}
      onCreated={onRelationCreated}
      trigger={
        <div className="group px-3 py-2.5" onDoubleClick={handleRowDoubleClick} title="双击查看详情" />
      }
    >
      <div className="flex items-center gap-2">
        {editing ? (
          <input
            autoComplete="off"
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitEdit();
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
            onBlur={() => void commitEdit()}
            className={cn(inputClass, "h-7 min-w-0 flex-1 px-1.5 text-sm font-medium")}
            disabled={saving}
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:text-primary"
            title="点击编辑标题"
          >
            {item.name}
          </button>
        )}
        <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {TYPE_LABELS[type] ?? type}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(item)}
          aria-label="删除"
          title="移入回收站"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {(tags.length > 0 || source !== "") && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
          {source !== "" &&
            (/^https?:\/\//.test(source) ? (
              <a
                href={source}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                title={source}
              >
                <span className="max-w-56 truncate">{source}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            ) : (
              <span className="max-w-72 truncate text-xs text-muted-foreground" title={source}>
                {source}
              </span>
            ))}
        </div>
      )}
    </RowContextMenu>
  );
}
