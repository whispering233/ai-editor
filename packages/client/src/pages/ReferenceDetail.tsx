// 参考资料详情页（决策 36 + 决策 43 批次十一；references.md）
// 卡 11.4：三类形态——草稿 md（#/references/new/md）、草稿 link（#/references/new/link）、编辑态（#/references/:id）
//   - 编辑态 = 详情页即编辑器（决策 43：无「阅读/编辑」切换；列表页编辑入口已收敛于此，B1 修复）
//   - file 类：标题（点击行内编辑）+ 分类 + 标签（datalist + TagSuggest）+ 内容编辑器
//     （11.5 换 @uiw/react-md-editor，当前 textarea 骨架）+ 建立关联 + 删除；保存 PUT（服务端先写文件后更新 DB）
//   - link 类：标题 + URL（必填）+ 分类 + 标签 + 内容（备注）+ 建立关联 + 删除
//   - 草稿态：标题必填（md）/ URL 必填（link）→ POST 创建（file 落盘）→ 跳转编辑态
// 焦点上报（决策 35）：编辑态上报 focus_entity_type/id；草稿态无实体不上报
import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Link2, Trash2 } from "lucide-react";
import type { EntityDetailRes } from "../lib/api";
import { createEntity, deleteEntity, getEntityDetail, listEntities, updateEntity } from "../lib/api";
import { ApiError } from "../lib/api";
import { REFERENCE_TYPES } from "@whispering233/ai-editor-shared";
import type { ReferenceTypeValue } from "@whispering233/ai-editor-shared";
import { applyTagSuggestion, parseTagsInput, suggestTags, tagsToInput } from "../lib/timeline";
import { navigate } from "../hooks/use-route";
import { useUiStore } from "../stores/ui";
import { cn } from "../lib/utils";
import { errorBannerClass, inputClass, skeletonClass } from "../lib/styles";
import { Button } from "../components/ui/button";
import { TagSuggest } from "../components/timeline/TagSuggest";
import { CreateRelationDialog, type RelationSource } from "../components/entity/create-relation-dialog";

const TYPE_LABELS: Record<ReferenceTypeValue, string> = {
  material: "素材摘抄",
  inspiration: "灵感记录",
  theory: "写作理论",
  reference: "设定参考",
};

/** 详情页表单（编辑态/草稿态共用；11.5 起 content 由 markdown 编辑器驱动） */
interface EditForm {
  name: string;
  type: ReferenceTypeValue;
  tagsInput: string;
  content: string;
  url: string;
}

const EMPTY_FORM: EditForm = { name: "", type: "material", tagsInput: "", content: "", url: "" };

export default function ReferenceDetail({
  id,
  draft,
}: {
  id?: string;
  draft?: "md" | "link";
}) {
  const isDraft = draft !== undefined;
  const kind = draft === "md" ? "file" : "link"; // 草稿态 kind 由路由决定；编辑态从 data 读取

  // 决策 35：挂载/切换时上报页面焦点（当前参考资料作为「问 AI」上下文；草稿态无实体不上报）
  const setCurrentFocus = useUiStore((s) => s.setCurrentFocus);
  useEffect(() => {
    if (id !== undefined) {
      setCurrentFocus({ focus_entity_type: "reference", focus_entity_id: id });
    }
  }, [id, setCurrentFocus]);

  const [detail, setDetail] = useState<EntityDetailRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // 表单（编辑态由 detail 同步填充——无异步回填竞态，B1 修复语义；草稿态空表单）
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 标题行内编辑（详情页标题点击编辑，Enter 确认/Esc 取消）
  const [titleEditing, setTitleEditing] = useState(false);

  // 建立关联对话框（决策 43：两类详情页均含关联面板，源端点预填当前 reference）
  const [relationOpen, setRelationOpen] = useState(false);

  // 标签建议池（详情页独立聚合：datalist 自动补全 + TagSuggest 快捷选择，与列表页一致体验）
  const [tagPool, setTagPool] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    listEntities("reference", { limit: 200 })
      .then((res) => {
        if (cancelled) return;
        const set = new Set<string>();
        for (const it of res.items) {
          const tags = it.summary?.tags;
          if (Array.isArray(tags))
            for (const t of tags) if (typeof t === "string" && t !== "") set.add(t);
        }
        setTagPool([...set].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {
        /* 建议池加载失败不阻塞编辑（仅自动补全缺失） */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 编辑态：加载详情 → 同步填充表单（无竞态：表单在数据就绪后才渲染可编辑）
  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    getEntityDetail("reference", id)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        const data = d.data as Record<string, unknown>;
        setForm({
          name: d.name,
          type: (data?.type as ReferenceTypeValue | undefined) ?? "material",
          tagsInput: tagsToInput(data?.tags),
          content: typeof data?.content === "string" ? (data.content as string) : "",
          url: typeof data?.url === "string" ? (data.url as string) : "",
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "加载失败，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadTick]);

  const tagSuggestions = suggestTags(form.tagsInput, tagPool);

  /** 编辑态元数据（kind/url/file_name——来源列与保存分支判定） */
  const detailKind = (detail?.data as Record<string, unknown> | undefined)?.kind === "file" ? "file" : "link";
  const detailSource =
    detailKind === "file"
      ? `references/${(detail?.data as Record<string, unknown>)?.file_name ?? ""}`
      : typeof (detail?.data as Record<string, unknown>)?.url === "string"
        ? ((detail?.data as Record<string, unknown>).url as string)
        : typeof (detail?.data as Record<string, unknown>)?.source === "string"
          ? ((detail?.data as Record<string, unknown>).source as string)
          : "";

  /** 标题行内编辑提交（详情页：Enter 确认，失败 toast 后保持编辑态） */
  async function commitTitle() {
    const name = form.name.trim();
    if (name === "" || detail === null || name === detail.name) {
      setTitleEditing(false);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await updateEntity("reference", detail.id, { name });
      useUiStore.getState().showToast("已保存");
      setTitleEditing(false);
      setReloadTick((t) => t + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  /** 保存（编辑态 PUT / 草稿态 POST + 跳转）；file 类由服务端落盘（先写文件后更新 DB） */
  async function handleSave() {
    const name = form.name.trim();
    if (name === "") {
      setFormError("标题必填");
      return;
    }
    const url = form.url.trim();
    if (isDraft && draft === "link" && url === "") {
      setFormError("外源链接必须填写 URL");
      return;
    }
    if (!isDraft && detailKind === "link" && url === "") {
      setFormError("外源链接必须填写 URL");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const data: Record<string, unknown> = {
        type: form.type,
        content: form.content,
        ...(parseTagsInput(form.tagsInput).length > 0 ? { tags: parseTagsInput(form.tagsInput) } : {}),
      };
      if (isDraft) {
        data.kind = kind;
        if (kind === "link") data.url = url;
        const res = await createEntity("reference", { name, data });
        useUiStore.getState().showToast(`已创建参考资料《${name}》`);
        useUiStore.getState().notifyDataChanged();
        navigate(`#/references/${res.id}`);
      } else {
        if (detailKind === "link") data.url = url;
        await updateEntity("reference", detail!.id, { name, data });
        useUiStore.getState().showToast("已保存");
        useUiStore.getState().notifyDataChanged();
        setReloadTick((t) => t + 1);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "REFERENCE_FILE_MISSING") {
        setFormError("文件已在文件管理器中被删除，请到列表页「扫描」同步后再编辑");
      } else {
        setFormError(e instanceof ApiError ? e.message : "保存失败，请重试");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (detail === null) return;
    try {
      await deleteEntity("reference", detail.id);
      useUiStore.getState().showToast("已移入回收站，可随时还原");
      navigate("#/references");
    } catch (e) {
      useUiStore.getState().showToast(e instanceof ApiError ? e.message : "删除失败，请重试", "error");
    }
  }

  // ============ 错误 / 加载态（编辑态） ============
  if (!isDraft && error !== null) {
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

  if (!isDraft && detail === null) {
    return (
      <div className="space-y-3 p-4">
        <div className={cn(skeletonClass, "h-8 w-1/3")} />
        <div className={cn(skeletonClass, "h-64 w-full")} />
      </div>
    );
  }

  const currentKind = isDraft ? kind : detailKind;
  const source = isDraft ? "" : detailSource;

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 面包屑 + 操作 */}
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <a
          href="#/references"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← 参考资料
        </a>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="min-w-0 truncate text-sm text-foreground">
          {isDraft ? (draft === "md" ? "新建 md 文档" : "新建外源链接") : detail!.name}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setRelationOpen(true)} disabled={isDraft}>
            <Link2 className="size-3.5" />
            建立关联
          </Button>
          {!isDraft && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="size-3.5" />
              删除
            </Button>
          )}
        </div>
      </div>

      {/* 标题 + 元信息 */}
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-2">
          {titleEditing ? (
            <input
              autoComplete="off"
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitTitle();
                } else if (e.key === "Escape") {
                  setTitleEditing(false);
                }
              }}
              onBlur={() => void commitTitle()}
              className={cn(inputClass, "h-9 w-72 px-2 font-serif text-xl")}
              disabled={saving}
            />
          ) : (
            <h1
              className="font-serif text-xl font-medium"
              onClick={() => setTitleEditing(true)}
              title="点击编辑标题"
            >
              {isDraft ? (draft === "md" ? "新建 md 文档" : "新建外源链接") : detail!.name}
            </h1>
          )}
          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {TYPE_LABELS[form.type] ?? form.type}
          </span>
        </div>
        {/* 元信息：来源 + 创建/更新时间（决策 39：详情页保留） */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {currentKind === "link" && !isDraft && source !== "" && (
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
          {currentKind === "file" && !isDraft && source !== "" && (
            <span title={source}>{source}</span>
          )}
          {!isDraft && detail !== null && (
            <>
              <span>创建 {formatTime(detail.createdAt)}</span>
              <span>更新 {formatTime(detail.updatedAt)}</span>
            </>
          )}
        </div>
      </div>

      {/* 表单区（编辑态 = 详情页即编辑器；分类/标签/内容编辑） */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {/* 分类 */}
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
        {/* link 类：URL（必填） */}
        {currentKind === "link" && (
          <div className="flex items-start gap-2">
            <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">URL</label>
            <input
              className={cn(inputClass, "flex-1")}
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://…（必填）"
              disabled={saving}
            />
          </div>
        )}
        {/* 标签（datalist 自动补全 + TagSuggest 快捷选择，与列表页一致体验） */}
        <div className="flex items-start gap-2">
          <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">标签</label>
          <div className="relative min-w-0 flex-1">
            <input
              className={cn(inputClass, "w-full")}
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
              list="ref-detail-tags"
              placeholder="逗号分隔，如：五行, 设定"
              disabled={saving}
            />
            <datalist id="ref-detail-tags">
              {tagPool.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <TagSuggest
              suggestions={tagSuggestions}
              visible={form.tagsInput.trim() !== ""}
              onPick={(t) =>
                setForm((f) => ({ ...f, tagsInput: applyTagSuggestion(f.tagsInput, t) }))
              }
            />
          </div>
        </div>
        {/* 内容：file → markdown 正文（11.5 换 @uiw/react-md-editor）；link → 备注 */}
        <div className="flex items-start gap-2">
          <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">
            {currentKind === "file" ? "内容" : "备注"}
          </label>
          <textarea
            className={cn(inputClass, "min-h-64 flex-1 resize-y leading-6")}
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder={
              currentKind === "file"
                ? "markdown 正文（11.5 起为分屏编辑器）…"
                : "可选：外源链接备注 / 摘录…"
            }
            disabled={saving}
          />
        </div>
        {formError !== null && <p className="text-xs text-destructive">{formError}</p>}
        {/* 操作 */}
        <div className="flex justify-end gap-1.5 pt-1">
          {isDraft && (
            <Button variant="outline" onClick={() => navigate("#/references")} disabled={saving}>
              取消
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {isDraft ? "创建" : "保存"}
          </Button>
        </div>
      </div>

      {/* 建立关联对话框（决策 43：两类详情页均含；源端点预填当前 reference） */}
      {relationOpen && detail !== null && (
        <CreateRelationDialog
          source={{ type: "reference", id: detail.id, name: detail.name } as RelationSource}
          onCreated={() => {
            setRelationOpen(false);
            useUiStore.getState().showToast("已建立关联");
          }}
          onClose={() => setRelationOpen(false)}
        />
      )}
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
