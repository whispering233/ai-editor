// 时间轴列表页（C3，决策 26；替换中栏占位）
// 路由：#/timeline（1 段 → 列表页）；#/timeline/:id 详情页见 TimelineDetail.tsx（C4，main.tsx 2 段分支）
// 数据：GET /api/v1/entity/event（EntitySummary，服务端恒按 sort_order 升序，决策 26）+
//   GET /api/v1/relation?source_type=event&relation_type=occurs_in&depth=1（全量锚定边，
//   行内「N 节点」计数——列表响应无关系计数，一次批量拉取避免 N+1；同 HookPanel depEdges 模式）
// 契约：doc/ui/pages/timeline.md（布局线框/信息层级/关键交互/状态）
// 关键交互：
//  - 新建：POST /entity/event（name/description/time_label/tags）+ 有锚点节点再 POST /relation
//    （event → outline_node，occurs_in）→ toast + 刷新（追加至列表尾部——服务端 NULL 沉底）
//  - 拖拽排序：组块级 HTML5 DnD（F4：同 time_label 归组后拖拽组块；组内事件不 draggable 防误拖，
//    drop 后对组内事件按序逐个 PUT /entity/event/:id/move——见 components/timeline/Timeline.tsx）
//  - 行 ⋯ 菜单：详情（跳 #/timeline/:id）/编辑（同新建表单预填，PUT）/移入回收站（ConfirmDialog 软删）
//  - 标签筛选：顶部 [全部] [tag…] 客户端过滤（筛选后再分组；tag 从当前列表聚合，timeline.md）
//  - 数据刷新：useDataRefresh 订阅 dataVersion（AI 提案确认写库 / InfoBar 刷新按钮）
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  createEntity,
  createRelation,
  deleteEntity,
  listEntities,
  listRelations,
  moveEntityEvent,
  updateEntity,
  type RelationSummaryItem,
} from "../lib/api";
import { buildEventDetailPatch, collectEventTags, filterEventsByTag, parseTagsInput, tagsToInput } from "../lib/timeline";
import { flattenTree } from "../lib/outline-tree";
import { cn } from "../lib/utils";
import { ConfirmDialog } from "../components/outline/dialogs";
import { Timeline as TimelineView } from "../components/timeline/Timeline";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 事件表单（新建/编辑共用；tags 为输入框字符串，提交前 parseTagsInput） */
interface EventForm {
  name: string;
  description: string;
  timeLabel: string;
  tagsInput: string;
}

const EMPTY_FORM: EventForm = { name: "", description: "", timeLabel: "", tagsInput: "" };

export default function Timeline() {
  const [items, setItems] = useState<EntitySummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // 数据变更信号（同 HookPanel）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉列表 + 锚定边
  useDataRefresh(() => setReloadTick((t) => t + 1));
  /** 全量 occurs_in 边（GET /relation 一次拉全；行内「N 节点」计数；失败降级隐藏——不阻塞列表） */
  const [occursEdges, setOccursEdges] = useState<RelationSummaryItem[]>([]);
  const [occursEdgesFailed, setOccursEdgesFailed] = useState(false);

  // 标签筛选（timeline.md：tag 从当前列表聚合；activeTag null = 全部）
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // 新建对话框
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<EventForm>(EMPTY_FORM);
  const [createNodeId, setCreateNodeId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // 编辑对话框（预填 name + data；saveName 记录打开时的原名——name 变更才提交）
  const [editTarget, setEditTarget] = useState<EntitySummary | null>(null);
  const [editForm, setEditForm] = useState<EventForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // 软删确认
  const [deleteTarget, setDeleteTarget] = useState<EntitySummary | null>(null);

  const outline = useProjectStore((s) => s.outline);
  const nodeOptions = flattenTree(outline?.children ?? []);

  // 列表 + 锚定边并行（互不依赖；锚定边失败仅降级隐藏「N 节点」列）。
  // Promise.allSettled 统一收口 loading：两个请求都完成才结束骨架，避免列表慢于关系请求时
  // 「骨架消失 + 空白」窗口（oracle 修复）；各请求错误仍按原语义分别处理
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOccursEdgesFailed(false);
    void Promise.allSettled([
      listEntities("event", {})
        .then((res) => {
          if (!cancelled) setItems(res.items);
        })
        .catch((err) => {
          if (!cancelled) {
            setItems(null);
            setError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
          }
        }),
      listRelations({ source_type: "event", relation_type: "occurs_in", depth: 1 })
        .then((res) => {
          if (!cancelled) setOccursEdges(res.relations);
        })
        .catch(() => {
          if (!cancelled) setOccursEdgesFailed(true);
        }),
    ]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // 大纲未加载时兜底拉取（节点选择器依赖；项目打开时已加载，防御直达路由场景——同 HookPanel）
  useEffect(() => {
    if (useProjectStore.getState().outline === null && useProjectStore.getState().config !== null) {
      void useProjectStore.getState().loadOutline();
    }
  }, []);

  // ============ 新建 ============

  /** 新建提交：POST /entity/event → 有锚点节点再 POST /relation（occurs_in）→ toast + 刷新 */
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = createForm.name.trim();
    if (!name) {
      setCreateError("请输入名称");
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const data: Record<string, unknown> = {};
      if (createForm.description.trim() !== "") data.description = createForm.description.trim();
      if (createForm.timeLabel.trim() !== "") data.time_label = createForm.timeLabel.trim();
      const tags = parseTagsInput(createForm.tagsInput);
      if (tags.length > 0) data.tags = tags;
      const res = await createEntity("event", { name, data });
      // 有锚点节点才建 occurs_in 关系（timeline.md 新建交互）；失败不阻塞创建——提示后刷新，
      // 可后续在详情补关联（同 HookPanel 埋点失败语义）
      if (createNodeId !== "") {
        try {
          await createRelation({
            source_type: "event",
            source_id: res.id,
            target_type: "outline_node",
            target_id: createNodeId,
            relation_type: "occurs_in",
          });
        } catch (relErr) {
          useUiStore.getState().showToast(
            `已创建事件《${name}》，但节点关联失败：${relErr instanceof ApiError ? relErr.message : "未知错误"}`,
            "error",
          );
          setCreateOpen(false);
          setReloadTick((t) => t + 1);
          return;
        }
      }
      useUiStore.getState().showToast(`已创建事件《${name}》`);
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      setCreateNodeId("");
      setReloadTick((t) => t + 1);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "创建失败，请重试");
    } finally {
      setCreateSubmitting(false);
    }
  }

  // ============ 编辑 ============

  /** 打开编辑：预填表单（name + data 三字段；tags 数组 → 逗号输入串） */
  function openEdit(ev: EntitySummary) {
    const data = ev.summary as Record<string, unknown>;
    setEditTarget(ev);
    setEditError(null);
    setEditForm({
      name: ev.name,
      description: typeof data.description === "string" ? data.description : "",
      timeLabel: typeof data.time_label === "string" ? data.time_label : "",
      tagsInput: tagsToInput(data.tags),
    });
  }

  /** 编辑保存：buildEventDetailPatch 只提交变更字段（PUT partial 浅合并，与详情页共用同一实现） */
  async function handleEditSave() {
    const target = editTarget;
    const form = editForm;
    if (!target || !form || editSaving) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const patch = buildEventDetailPatch(
        { name: target.name, data: target.summary as Record<string, unknown> },
        form,
      );
      if (patch === null) {
        useUiStore.getState().showToast("没有变更");
        setEditTarget(null);
        return;
      }
      await updateEntity("event", target.id, patch);
      useUiStore.getState().showToast("已保存");
      setEditTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "保存失败，请重试");
    } finally {
      setEditSaving(false);
    }
  }

  // ============ 软删 ============

  /** 软删确认后执行：DELETE → toast（级联计数）→ 刷新 */
  async function handleDelete() {
    const ev = deleteTarget;
    if (!ev) return;
    try {
      const res = await deleteEntity("event", ev.id);
      const parts: string[] = [];
      if (res.cascaded.relations > 0) parts.push(`${res.cascaded.relations} 条关联`);
      if (res.cascaded.deltas > 0) parts.push(`${res.cascaded.deltas} 条变更记录`);
      useUiStore.getState().showToast(
        `已移入回收站，可随时还原${parts.length > 0 ? `（含 ${parts.join("、")}）` : ""}`,
      );
      setDeleteTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      throw err; // 冒泡给 ConfirmDialog 内联显示
    }
  }

  // ============ 组块移动（F4：拖拽回调实现——页面负责 move 调用） ============

  /**
   * 组块拖拽结果执行：按组内序逐次 PUT /entity/event/:id/move（moves 由组件 groupDropOrders 算好，
   * 单事件组 = F3 单次调用）；成功 → toast；失败 → toast + 重拉（回滚为服务端实际顺序）。
   */
  async function handleGroupMove(moves: Array<{ id: string; order: number }>) {
    try {
      for (const m of moves) {
        await moveEntityEvent(m.id, { order: m.order });
      }
      useUiStore.getState().showToast("已调整事件顺序");
    } catch (err) {
      useUiStore.getState().showToast(
        err instanceof ApiError ? `排序失败：${err.message}` : "排序失败，请重试",
        "error",
      );
    } finally {
      // 成功保持新序、失败回滚——均以服务端实际顺序为准，重拉列表
      setReloadTick((t) => t + 1);
    }
  }

  // ============ 渲染 ============

  const tagOptions = items === null ? [] : collectEventTags(items);
  const visible = items === null ? null : filterEventsByTag(items, activeTag);
  const occursCount = (id: string): number =>
    occursEdgesFailed ? 0 : occursEdges.filter((r) => r.sourceId === id).length;
  const hasOccursData = !occursEdgesFailed;

  return (
    <section>
      {/* header：标题 + 新建入口（timeline.md 线框） */}
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">时间轴</h1>
        <Button type="button" className="ml-auto" onClick={() => setCreateOpen(true)}>
          + 新建事件
        </Button>
      </div>

      {/* 错误横幅（列表请求失败 → 重试） */}
      {error !== null && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error === CLIENT_NETWORK_ERROR ? "无法连接服务，请确认 ai-editor 服务已启动。" : "时间轴加载失败，请重试。"}
          <Button variant="outline" className="ml-auto h-7 px-2 text-xs" type="button" onClick={() => setReloadTick((t) => t + 1)}>
            重试
          </Button>
        </div>
      )}

      {/* 加载骨架（行级 animate-pulse bg-muted，timeline.md 状态） */}
      {loading && items === null && error === null && (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
              <div className="h-4 w-4 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="ml-auto h-6 w-6 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {/* 空态（timeline.md 原文） */}
      {!loading && items !== null && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            还没有事件。先定义一个关键事件，再把它们排成故事的时间骨架。
          </p>
          <Button className="mt-4" type="button" onClick={() => setCreateOpen(true)}>
            + 新建事件
          </Button>
        </div>
      )}

      {/* 标签筛选器（timeline.md：tag 从当前列表聚合；[全部] 恒在首位） */}
      {items !== null && items.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs transition-colors",
              activeTag === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            全部
          </button>
          {tagOptions.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag((cur) => (cur === tag ? null : tag))}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs transition-colors",
                activeTag === tag
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* 事件时间轴（F4 时间点分组：垂直轴线 + 组块（标题 + 组内事件堆叠）+ 组块级拖拽；
          数据编排在本页、渲染与拖拽协调在 components/timeline/） */}
      {!loading && visible !== null && visible.length > 0 && (
        <TimelineView
          events={visible}
          occursCount={occursCount}
          hasOccursData={hasOccursData}
          onMove={handleGroupMove}
          onDetail={(ev) => navigate(`/timeline/${ev.id}`)}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
        />
      )}

      {/* 标签筛选无匹配（timeline.md 状态：「没有匹配「{tag}」的事件」） */}
      {!loading && items !== null && items.length > 0 && visible !== null && visible.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
          没有匹配「{activeTag}」的事件
        </div>
      )}

      {/* 新建事件对话框（timeline.md：name 必填 + description + time_label + tags + 可选锚点节点） */}
      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建事件</DialogTitle>
          </DialogHeader>
          <form id="create-event-form" onSubmit={handleCreate} className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">名称（必填）</p>
              <Input
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="如：主角踏入宗门"
                maxLength={100}
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">描述</p>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="事件发生了什么"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">时间标签</p>
              <Input
                value={createForm.timeLabel}
                onChange={(e) => setCreateForm((f) => ({ ...f, timeLabel: e.target.value }))}
                placeholder="如：第二天黄昏（自由文本，不参与排序）"
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">标签</p>
              <Input
                value={createForm.tagsInput}
                onChange={(e) => setCreateForm((f) => ({ ...f, tagsInput: e.target.value }))}
                placeholder="如：主线，战争（逗号/回车分隔）"
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">关联大纲节点（选填，可空）</p>
              <OutlineNodeSelect value={createNodeId} onChange={setCreateNodeId} nodeOptions={nodeOptions} />
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setCreateOpen(false)} disabled={createSubmitting}>
              取消
            </Button>
            <Button type="submit" form="create-event-form" disabled={createSubmitting}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑事件对话框（同新建表单预填；timeline.md 行操作） */}
      {editTarget && editForm && (
        <Dialog open onOpenChange={(v) => !v && !editSaving && setEditTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>编辑事件《{editTarget.name}》</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">名称（必填）</p>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, name: e.target.value } : f))}
                  maxLength={100}
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">描述</p>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, description: e.target.value } : f))}
                  rows={2}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">时间标签</p>
                <Input
                  value={editForm.timeLabel}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, timeLabel: e.target.value } : f))}
                  placeholder="如：第二天黄昏（自由文本，不参与排序）"
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">标签</p>
                <Input
                  value={editForm.tagsInput}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, tagsInput: e.target.value } : f))}
                  placeholder="如：主线，战争（逗号/回车分隔）"
                />
              </div>
              {editError && <p className="text-sm text-destructive">{editError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setEditTarget(null)} disabled={editSaving}>
                取消
              </Button>
              <Button type="button" onClick={() => void handleEditSave()} disabled={editSaving}>
                {editSaving ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 软删确认（级联提示，同 HookPanel/实体详情页） */}
      {deleteTarget && (
        <ConfirmDialog
          title="移入回收站"
          description={`将《${deleteTarget.name}》移入回收站。关联关系与变更记录将一并移入，可在回收站还原。`}
          confirmLabel="移入回收站"
          danger
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}

/** 大纲节点选择器（新建事件锚点；选项来自 outline store 的树——同 HookPanel OutlineNodeSelect） */
function OutlineNodeSelect({
  value,
  onChange,
  nodeOptions,
  placeholder = "未设置",
}: {
  value: string;
  onChange: (v: string) => void;
  nodeOptions: Array<{ id: string; label: string; depth: number }>;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        value === "" && "text-muted-foreground",
      )}
    >
      <option value="">{placeholder}</option>
      {nodeOptions.map((o) => (
        <option key={o.id} value={o.id}>
          {"　".repeat(o.depth)}
          {o.label}
        </option>
      ))}
    </select>
  );
}
