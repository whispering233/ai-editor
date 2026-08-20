// 参考资料列表页（决策 36 + 决策 43 批次十一；references.md）
// 卡 11.1 交互重构 + 卡 11.4 新建分流：
//   - 点击标题 = 行内编辑（Enter 提交 / Esc 取消 / 失焦保存，决策 37/38 模式）
//   - 双击行 = 进详情页（编辑态/按钮区不触发）
//   - 移除 Pencil 编辑按钮与编辑 Dialog（B1 异步回填竞态根除——完整编辑收敛到详情页）
//   - 行信息 = [标题、分类徽标、标签、来源]（来源列 11.4 起按 kind：file → 相对路径、link → URL 可点击）
//   - 新建入口分流两按钮（11.4）：「新建 md 文档」→ #/references/new/md、「新建外源链接」→ #/references/new/link
//   - 保留删除按钮、右键菜单（决策 40 复用）
// 数据：listEntities("reference", { limit: 200 }) 一次全量拉取（参考资料量小），
//   分类/标签/关键词过滤在前端（列表摘要 summary.type/tags/kind/file_name/url 由 db toSummary 提供）
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { BookOpenText, ExternalLink, FileText, Link2, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { REFERENCE_TYPES } from "@whispering233/ai-editor-shared";
import type { ReferenceTypeValue } from "@whispering233/ai-editor-shared";
import { deleteEntity, getReferenceScanStatus, listEntities, scanReferences, updateEntity } from "../lib/api";
import { ApiError } from "../lib/api";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";
import { cn } from "../lib/utils";
import { errorBannerClass, inputClass, sectionCardClass, skeletonClass } from "../lib/styles";
import { Button } from "../components/ui/button";
import { RowContextMenu } from "../components/entity/row-context-menu";
import { EmptyState } from "../components/ui/empty-state";

/** 分类中文映射（列表徽标 / 下拉选项） */
const TYPE_LABELS: Record<ReferenceTypeValue, string> = {
  material: "素材摘抄",
  inspiration: "灵感记录",
  theory: "写作理论",
  reference: "设定参考",
};

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

  // 扫描同步（决策 43 N6）：unsynced = 未同步文件数（null = 未探测/无项目）；
  // 列表加载/刷新时只读探测（无副作用），>0 显示提示条引导扫描
  const [scanBusy, setScanBusy] = useState(false);
  const [unsynced, setUnsynced] = useState<number | null>(null);

  // 探测未同步文件（数据刷新后重跑——本地新增/外部修改后列表刷新即重新提示）
  useEffect(() => {
    if (config === null) {
      setUnsynced(null);
      return;
    }
    let cancelled = false;
    getReferenceScanStatus()
      .then((res) => {
        if (!cancelled) setUnsynced(res.unsynced);
      })
      .catch(() => {
        if (!cancelled) setUnsynced(null); // 探测失败不阻塞列表（静默）
      });
    return () => {
      cancelled = true;
    };
  }, [config, reloadTick]);

  /** 扫描重建索引（POST /scan → toast 统计 + 刷新列表 + 清提示条） */
  async function handleScan() {
    if (scanBusy) return;
    setScanBusy(true);
    try {
      const r = await scanReferences();
      const parts = [
        r.added > 0 ? `新增 ${r.added}` : null,
        r.updated > 0 ? `更新 ${r.updated}` : null,
        r.restored > 0 ? `还原 ${r.restored}` : null,
        r.removed > 0 ? `移除 ${r.removed}` : null,
      ].filter((s): s is string => s !== null);
      useUiStore.getState().showToast(
        parts.length > 0 ? `扫描完成：${parts.join(" / ")}` : "扫描完成：已是最新",
      );
      setUnsynced(0);
      useUiStore.getState().notifyDataChanged();
      setReloadTick((t) => t + 1);
    } catch (e) {
      useUiStore
        .getState()
        .showToast(e instanceof ApiError ? e.message : "扫描失败，请重试", "error");
    } finally {
      setScanBusy(false);
    }
  }

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
          className={cn("ml-auto flex items-center gap-2", disabled && "cursor-not-allowed")}
          title={disabled ? "请先打开项目" : undefined}
        >
          <Button
            type="button"
            variant="outline"
            disabled={disabled || scanBusy}
            onClick={handleScan}
            title="扫描项目目录 references/ 下的本地文档，同步到索引"
          >
            <RefreshCw className={cn("size-3.5", scanBusy && "animate-spin")} />
            扫描
          </Button>
          <Button type="button" variant="outline" disabled={disabled} onClick={() => navigate("#/references/new/md")}>
            <FileText className="size-3.5" />
            新建 md 文档
          </Button>
          <Button type="button" disabled={disabled} onClick={() => navigate("#/references/new/link")}>
            <Link2 className="size-3.5" />
            新建外源链接
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

      {/* 未同步提示条（决策 43 N6）：检测到本地新增/外部修改 → 引导扫描（只读探测无副作用） */}
      {unsynced !== null && unsynced > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <RefreshCw className="size-3.5 shrink-0 text-primary" />
          <span className="flex-1">
            检测到 <b>{unsynced}</b> 个未同步的本地文档（文件管理器新增或修改）——扫描后将同步到索引
          </span>
          <Button variant="outline" size="xs" onClick={handleScan} disabled={scanBusy}>
            {scanBusy && <Loader2 className="size-3.5 animate-spin" />}
            立即扫描
          </Button>
        </div>
      )}

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
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={disabled} onClick={() => navigate("#/references/new/md")}>
                    新建 md 文档
                  </Button>
                  <Button size="sm" disabled={disabled} onClick={() => navigate("#/references/new/link")}>
                    新建外源链接
                  </Button>
                </div>
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

/** 列表行（决策 43 卡 11.1 + 11.4）：第一行 [标题（点击行内编辑）+ 分类徽标 + 删除]，第二行 [标签 + 来源]；
 * 来源列按 kind 渲染（11.4）：file → 相对路径文本、link → URL 可点击（存量无 kind 条目 → source 兼容）；
 * 双击行 = 进详情页；右键菜单 [注入会话上下文、建立关联] 复用决策 40 */
function RefRow({ item, onRename, onDelete, onGoto, onRelationCreated }: RefRowProps) {
  const type = (item.summary?.type as ReferenceTypeValue | undefined) ?? "material";
  const tags = Array.isArray(item.summary?.tags)
    ? (item.summary?.tags as string[]).filter((t): t is string => typeof t === "string" && t !== "")
    : [];
  // 来源：file → references/<file_name> 相对路径（文本）；link → url（可点击）；存量 → source 文本兼容
  const isFile = item.summary?.kind === "file";
  const source = isFile
    ? `references/${typeof item.summary?.file_name === "string" ? (item.summary.file_name as string) : ""}`
    : typeof item.summary?.url === "string"
      ? (item.summary.url as string)
      : typeof item.summary?.source === "string"
        ? (item.summary.source as string)
        : "";

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
            (!isFile && /^https?:\/\//.test(source) ? (
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
