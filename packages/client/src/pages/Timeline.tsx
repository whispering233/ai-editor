// 时间轴列表页（C3，决策 26；G2.3 双实体重构）
// 路由：#/timeline（1 段 → 列表页）；#/timeline/:id 详情页见 TimelineDetail.tsx（C4，main.tsx 2 段分支）
// 数据（G2 双实体，timeline.md「路由与数据」）：
//   GET /api/v1/entity/timepoint（时间点实体，恒按 sort_order 升序——组间顺序，拖拽为权威）
//   + GET /api/v1/entity/event（事件实体，恒按 sort_order 升序——组内排序键，拖拽为权威）
//   + GET /api/v1/relation?source_type=timepoint&relation_type=occurs_at&depth=1（挂载边，
//     timepoint → event 1:n——构建 eventId → timepointId 挂载映射）
//   + GET /api/v1/relation?source_type=event&relation_type=occurs_in&depth=1（全量锚定边，
//     行内「N 节点」计数——同 HookPanel depEdges 模式）
// 契约：doc/ui/pages/timeline.md（G2 布局线框/双实体模型/双入口/双轨拖拽/信息层级/状态）
// 关键交互（G2）：
//  - 新建时间点：POST /entity/timepoint（name = 时间标签文本）→ 时间轴末尾追加
//  - 新建事件（双入口）：顶部「+ 新建事件」= 不挂载（入未挂载区）；组尾「+ 在此时间点新建事件」=
//    POST /entity/event + POST /relation（timepoint → event，occurs_at 挂载该时间点）
//  - 拖拽（双轨）：时间点整组 = PUT /entity/timepoint/:id/move（只重排组间序，内部事件不动）；
//    事件单条 = 同组 PUT /entity/event/:id/move；跨组 POST /entity/event/:id/move_to（改挂载+重排）
//  - 时间点重命名：组标题 [重命名] 行内编辑 → PUT /entity/timepoint/:id { name }
//  - AI 排序（F9）：注入聊天预设指令（工具名 propose_reorder_timepoints 保证出现——LLM 依赖
//    工具名发现）→ 提案卡确认后 Executor 重排 timepoint.sort_order → notifyDataChanged → 本页
//    useDataRefresh 自动重拉（无需本页处理刷新）
//  - 数据刷新：useDataRefresh 订阅 dataVersion（AI 提案确认写库 / InfoBar 刷新按钮）
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ListOrdered } from "lucide-react";
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
  moveEntityEventTo,
  moveEntityTimepoint,
  updateEntity,
  type RelationSummaryItem,
} from "../lib/api";
import {
  applyTagSuggestion,
  buildEventDetailPatch,
  collectEventTags,
  filterEventsByTag,
  parseTagsInput,
  suggestTags,
  tagsToInput,
} from "../lib/timeline";
import { buildOccursAtRelationBody } from "../lib/timeline-detail";
import { flattenTree } from "../lib/outline-tree";
import { cn } from "../lib/utils";
import { Timeline as TimelineView } from "../components/timeline/Timeline";
import { TagSuggest } from "../components/timeline/TagSuggest";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useChatStore } from "../stores/chat";
import { useUiStore } from "../stores/ui";

/** 事件表单（新建/编辑共用；G2：time_label 已移除——时间标签 = 时间点挂载；tags 为输入框字符串） */
interface EventForm {
  name: string;
  description: string;
  tagsInput: string;
}

const EMPTY_FORM: EventForm = { name: "", description: "", tagsInput: "" };

/** 软删目标（H1：事件与时间点共用同一处理函数，kind 决定 DELETE 实体类型） */
type DeleteTarget =
  | { kind: "event"; entity: EntitySummary }
  | { kind: "timepoint"; entity: EntitySummary };

export default function Timeline() {
  // 时间点 / 事件列表（双实体，均按 sort_order 升序）
  const [timepoints, setTimepoints] = useState<EntitySummary[] | null>(null);
  const [items, setItems] = useState<EntitySummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // 数据变更信号（同 HookPanel）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉全部
  useDataRefresh(() => setReloadTick((t) => t + 1));
  /** 全量 occurs_at 挂载边（GET /relation 一次拉全；构建挂载映射；失败降级空数组——
   *  事件全部视为未挂载——不阻塞列表） */
  const [occursAtEdges, setOccursAtEdges] = useState<RelationSummaryItem[]>([]);
  const [occursAtFailed, setOccursAtFailed] = useState(false);
  /** 全量 occurs_in 边（行内「N 节点」计数；失败降级隐藏——不阻塞列表） */
  const [occursEdges, setOccursEdges] = useState<RelationSummaryItem[]>([]);
  const [occursEdgesFailed, setOccursEdgesFailed] = useState(false);

  // 标签筛选（timeline.md：tag 从当前列表聚合；activeTag null = 全部）
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // 标签建议池（F8：已存在标签全集，供表单 tags 输入建议；列表不足 50 条直接聚合已拉数据，
  // 达到默认 limit 50 说明可能截断 → 补拉全量 200；补拉失败静默降级用已拉列表聚合）
  const [tagPool, setTagPool] = useState<string[]>([]);

  // 新建对话框（G2 双入口：createTimepointId 非空 = 组尾「+ 在此时间点新建事件」预挂载）
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<EventForm>(EMPTY_FORM);
  const [createTimepointId, setCreateTimepointId] = useState<string | null>(null);
  const [createNodeId, setCreateNodeId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // 新建时间点对话框
  const [tpCreateOpen, setTpCreateOpen] = useState(false);
  const [tpName, setTpName] = useState("");
  const [tpError, setTpError] = useState<string | null>(null);
  const [tpSubmitting, setTpSubmitting] = useState(false);

  // 编辑对话框（预填 name + data；saveName 记录打开时的原名——name 变更才提交）
  const [editTarget, setEditTarget] = useState<EntitySummary | null>(null);
  const [editForm, setEditForm] = useState<EventForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const config = useProjectStore((s) => s.config);
  const outline = useProjectStore((s) => s.outline);
  const nodeOptions = flattenTree(outline?.children ?? []);
  const sendMessage = useChatStore((s) => s.sendMessage);

  // 四路并行：时间点 / 事件 / occurs_at 挂载边 / occurs_in 锚定边。
  // Promise.allSettled 统一收口 loading：全部完成才结束骨架（G1 同式）；各请求错误按语义分别处理：
  // 时间点或事件失败 → error 横幅（重试全部）；occurs_at/occurs_in 失败 → 降级不阻塞。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOccursAtFailed(false);
    setOccursEdgesFailed(false);
    void Promise.allSettled([
      listEntities("timepoint", {})
        .then((res) => {
          if (!cancelled) setTimepoints(res.items);
        })
        .catch((err) => {
          if (!cancelled) {
            setTimepoints(null);
            setError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
          }
        }),
      listEntities("event", {})
        .then((res) => {
          if (!cancelled) {
            setItems(res.items);
            // 标签建议池：先聚合已拉列表；满页（items 达到服务端 echo 的 limit，默认 50——可能截断）
            // → 补拉全量 200 聚合，避免标签池不全（F8）；补拉失败静默降级用已拉列表聚合
            setTagPool(collectEventTags(res.items));
            if (res.items.length >= res.limit) {
              void listEntities("event", { limit: 200 })
                .then((full) => {
                  if (!cancelled) setTagPool(collectEventTags(full.items));
                })
                .catch(() => {
                  // 补拉失败静默：标签池不全只是建议少，不阻塞表单（契约：失败静默）
                });
            }
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setItems(null);
            setError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
          }
        }),
      listRelations({ source_type: "timepoint", relation_type: "occurs_at", depth: 1 })
        .then((res) => {
          if (!cancelled) setOccursAtEdges(res.relations);
        })
        .catch(() => {
          if (!cancelled) setOccursAtFailed(true);
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

  // ============ 新建时间点（G2 双入口之一） ============

  /** 新建时间点提交：POST /entity/timepoint（name = 时间标签文本）→ toast + 刷新（时间轴末尾追加） */
  async function handleCreateTimepoint(e: FormEvent) {
    e.preventDefault();
    const name = tpName.trim();
    if (!name) {
      setTpError("请输入名称");
      return;
    }
    setTpSubmitting(true);
    setTpError(null);
    try {
      await createEntity("timepoint", { name });
      useUiStore.getState().showToast(`已创建时间点《${name}》`);
      setTpCreateOpen(false);
      setTpName("");
      setReloadTick((t) => t + 1);
    } catch (err) {
      setTpError(err instanceof ApiError ? err.message : "创建失败，请重试");
    } finally {
      setTpSubmitting(false);
    }
  }

  // ============ 新建事件（G2 双入口：顶部不挂载 / 组尾预挂载） ============

  /**
   * 新建提交：POST /entity/event → 预挂载时间点（createTimepointId 非空）→ 有锚点节点再
   * POST /relation（occurs_in）→ toast + 刷新。
   * 挂载/锚定失败不阻塞创建——提示后刷新，可后续拖拽/详情补（同 HookPanel 埋点失败语义）。
   */
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
      const tags = parseTagsInput(createForm.tagsInput);
      if (tags.length > 0) data.tags = tags;
      const res = await createEntity("event", { name, data });
      // 组尾新建：occurs_at 挂载到该时间点（timepoint → event，G2）；失败 → 事件入未挂载区可拖拽补
      if (createTimepointId !== null) {
        try {
          await createRelation(buildOccursAtRelationBody(createTimepointId, res.id));
        } catch (relErr) {
          useUiStore.getState().showToast(
            `已创建事件《${name}》，但挂载到时间点失败：${relErr instanceof ApiError ? relErr.message : "未知错误"}`,
            "error",
          );
          setCreateOpen(false);
          setCreateForm(EMPTY_FORM);
          setCreateTimepointId(null);
          setCreateNodeId("");
          setReloadTick((t) => t + 1);
          return;
        }
      }
      // 有锚点节点才建 occurs_in 关系（timeline.md 新建交互）
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
          setCreateForm(EMPTY_FORM);
          setCreateTimepointId(null);
          setCreateNodeId("");
          setReloadTick((t) => t + 1);
          return;
        }
      }
      useUiStore.getState().showToast(`已创建事件《${name}》`);
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      setCreateTimepointId(null);
      setCreateNodeId("");
      setReloadTick((t) => t + 1);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "创建失败，请重试");
    } finally {
      setCreateSubmitting(false);
    }
  }

  // ============ 编辑 ============

  /** 打开编辑：预填表单（name + data 两字段；tags 数组 → 逗号输入串；G2 无 time_label） */
  function openEdit(ev: EntitySummary) {
    const data = ev.summary as Record<string, unknown>;
    setEditTarget(ev);
    setEditError(null);
    setEditForm({
      name: ev.name,
      description: typeof data.description === "string" ? data.description : "",
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

  /** 软删直接执行（H2：不再弹二次确认）：DELETE → toast（级联计数）→ 刷新（事件与时间点共用） */
  async function handleDelete(target: DeleteTarget) {
    try {
      const res = await deleteEntity(target.kind, target.entity.id);
      const parts: string[] = [];
      if (res.cascaded.relations > 0) parts.push(`${res.cascaded.relations} 条关联`);
      if (res.cascaded.deltas > 0) parts.push(`${res.cascaded.deltas} 条变更记录`);
      useUiStore.getState().showToast(
        `已移入回收站，可随时还原${parts.length > 0 ? `（含 ${parts.join("、")}）` : ""}`,
      );
      setReloadTick((t) => t + 1);
    } catch (err) {
      useUiStore.getState().showToast(
        err instanceof ApiError ? err.message : "删除失败，请重试",
        "error",
      );
    }
  }

  // ============ 双轨拖拽（G2：页面负责 move 调用——成功/失败 toast + 刷新回滚） ============

  /** 时间点整组移动：PUT /entity/timepoint/:id/move（只重排组间序）；失败 → toast + 重拉回滚 */
  async function handleMoveTimepoint(id: string, order: number) {
    try {
      await moveEntityTimepoint(id, { order });
      useUiStore.getState().showToast("已调整时间点顺序");
    } catch (err) {
      useUiStore.getState().showToast(
        err instanceof ApiError ? `排序失败：${err.message}` : "排序失败，请重试",
        "error",
      );
    } finally {
      setReloadTick((t) => t + 1);
    }
  }

  /** 事件同组重排：PUT /entity/event/:id/move */
  async function handleMoveEvent(id: string, order: number) {
    try {
      await moveEntityEvent(id, { order });
      useUiStore.getState().showToast("已调整事件顺序");
    } catch (err) {
      useUiStore.getState().showToast(
        err instanceof ApiError ? `排序失败：${err.message}` : "排序失败，请重试",
        "error",
      );
    } finally {
      setReloadTick((t) => t + 1);
    }
  }

  /** 事件跨组改挂载：POST /entity/event/:id/move_to（timepointId null = 移出到未挂载区） */
  async function handleMoveEventTo(id: string, timepointId: string | null, order: number) {
    try {
      await moveEntityEventTo(id, { timepoint_id: timepointId, order });
      useUiStore.getState().showToast(timepointId === null ? "已移至未挂载区" : "已调整事件挂载与顺序");
    } catch (err) {
      useUiStore.getState().showToast(
        err instanceof ApiError ? `操作失败：${err.message}` : "操作失败，请重试",
        "error",
      );
    } finally {
      setReloadTick((t) => t + 1);
    }
  }

  /** 时间点重命名：PUT /entity/timepoint/:id { name }；失败 toast（组件已退出编辑态，无需 rethrow——调用方不消费） */
  async function handleRenameTimepoint(id: string, name: string) {
    try {
      await updateEntity("timepoint", id, { name });
      useUiStore.getState().showToast("已重命名");
      setReloadTick((t) => t + 1);
    } catch (err) {
      useUiStore.getState().showToast(
        err instanceof ApiError ? `重命名失败：${err.message}` : "重命名失败，请重试",
        "error",
      );
    }
  }

  /** 组尾「+ 在此时间点新建事件」：打开新建对话框并预挂载该时间点（G2 双入口） */
  function openCreateInTimepoint(timepointId: string) {
    setCreateForm(EMPTY_FORM);
    setCreateNodeId("");
    setCreateError(null);
    setCreateTimepointId(timepointId);
    setCreateOpen(true);
  }

  /** 顶部「+ 新建事件」：不挂载（事件入未挂载区，可后续拖拽挂载） */
  function openCreateEvent() {
    setCreateForm(EMPTY_FORM);
    setCreateNodeId("");
    setCreateError(null);
    setCreateTimepointId(null);
    setCreateOpen(true);
  }

  // ============ AI 排序（F9，timeline.md「AI 排序入口」） ============

  /**
   * AI 排序：向聊天注入预设指令（工具名 propose_reorder_timepoints 保证出现——LLM 依赖工具名发现；
   * G2：事件不再带 time_label，语义序载体变为时间点实体）；
   * agent 循环中 LLM 读取时间点列表（name = 时间标签文本）→ 调工具生成排序提案 → 提案卡展示预览 →
   * 用户确认后 Executor 校验并重排 timepoint.sort_order → notifyDataChanged → 本页 useDataRefresh 自动重拉。
   * 无项目态按钮已禁用（config === null），此处为状态层双保险。
   */
  function handleAiSort() {
    if (config === null) return;
    sendMessage("请按时间标签的语义先后顺序对时间轴时间点排序，并使用 propose_reorder_timepoints 工具生成排序提案。");
  }

  // ============ 渲染 ============

  const tagOptions = items === null ? [] : collectEventTags(items);
  const visible = items === null ? null : filterEventsByTag(items, activeTag);
  const occursCount = (id: string): number =>
    occursEdgesFailed ? 0 : occursEdges.filter((r) => r.sourceId === id).length;
  const hasOccursData = !occursEdgesFailed;
  // 标签建议（F8）：按各表单当前输入匹配标签池（suggestTags 空段不匹配 → 无建议区）
  const createSuggestions = suggestTags(createForm.tagsInput, tagPool);
  const editSuggestions = editForm === null ? [] : suggestTags(editForm.tagsInput, tagPool);

  /** 点选建议填入（F8，新建表单）：替换最后一段 + 追加逗号；输入框焦点由 TagSuggest onMouseDown 保持 */
  function pickCreateTag(tag: string) {
    setCreateForm((f) => ({ ...f, tagsInput: applyTagSuggestion(f.tagsInput, tag) }));
  }

  /** 点选建议填入（F8，编辑表单）：同 pickCreateTag，作用于编辑对话框表单 */
  function pickEditTag(tag: string) {
    setEditForm((f) => (f ? { ...f, tagsInput: applyTagSuggestion(f.tagsInput, tag) } : f));
  }

  // 滚动结构（G1）：页面分「固定区 + 滚动区」两段——header/标签筛选器恒固定，
  // 仅列表区独立滚动（占满 MainPanel 内容区高度：h-full 相对 flex-1 min-h-0 父级生效，
  // 与 Canvas.tsx §631 同式高度链）；错误横幅/骨架/空态/列表归滚动区（替代列表位置语义）
  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 固定区：header——标题 + 操作（timeline.md G2 线框：AI 排序 + 新建事件 + 新建时间点） */}
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">时间轴</h1>
        {/* AI 排序：注入聊天预设指令（F9）；无项目禁用——外层 span 承载 title 提示
            （按钮 disabled 态 pointer-events-none 吞掉 hover，原生 title 不弹） */}
        <span className={cn("ml-auto", !config && "cursor-not-allowed")} title={config ? undefined : "请先打开项目"}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!config}
            onClick={handleAiSort}
            aria-label="AI 排序"
          >
            <ListOrdered className="size-3.5" />
            AI 排序
          </Button>
        </span>
        <Button type="button" variant="outline" onClick={openCreateEvent}>
          + 新建事件
        </Button>
        <Button type="button" onClick={() => setTpCreateOpen(true)}>
          + 新建时间点
        </Button>
      </div>

      {/* 固定区：标签筛选器（timeline.md：tag 从当前列表聚合；[全部] 恒在首位）。
          G1：恒在滚动区外——列表滚动时仍可见（用户核心诉求「标签和按钮均可见」） */}
      {items !== null && items.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              activeTag === null
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted text-muted-foreground hover:text-foreground",
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
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                activeTag === tag
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* 滚动区：状态/列表（G1：flex-1 min-h-0 overflow-y-auto 独立滚动——错误横幅/骨架/空态/
           列表/无匹配均替代列表位置，归滚动区；header 与筛选器在滚动区外保持固定） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 错误横幅（时间点/事件列表请求失败 → 重试全部） */}
        {error !== null && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error === CLIENT_NETWORK_ERROR ? "无法连接服务，请确认 ai-editor 服务已启动。" : "时间轴加载失败，请重试。"}
            <Button variant="outline" className="ml-auto h-7 px-2 text-xs" type="button" onClick={() => setReloadTick((t) => t + 1)}>
              重试
            </Button>
          </div>
        )}

        {/* 加载骨架（行级 animate-pulse bg-muted，timeline.md 状态） */}
        {loading && (timepoints === null || items === null) && error === null && (
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

        {/* 空态（G2 文案：先定义时间标签点，再挂载事件；timeline.md 状态） */}
        {!loading &&
          timepoints !== null &&
          items !== null &&
          timepoints.length === 0 &&
          items.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                还没有时间点。先定义一个时间标签点（如「第二天黄昏」），再在其中挂载事件。
              </p>
              <Button className="mt-4" type="button" onClick={() => setTpCreateOpen(true)}>
                + 新建时间点
              </Button>
            </div>
          )}

        {/* 时间轴（G2 双实体：时间点组块 + 事件挂载 + 未挂载兜底区 + 双轨拖拽；
            数据编排在本页、渲染与拖拽协调在 components/timeline/；
            标签筛选无匹配 → 仅显示提示（不渲染空组列表））。
            ⚠ 条件**不含 !loading**：重拉（操作后 reloadTick+1）期间旧数据继续渲染——
            若卸载列表，滚动容器高度塌陷 → scrollTop 被 clamp 归零 → 操作后视觉焦点
            与操作点不一致（G3 交互优化）；loading 仅用于首次加载骨架（数据为 null 时） */}
        {timepoints !== null &&
          items !== null &&
          visible !== null &&
          !(activeTag !== null && visible.length === 0) && (
            <TimelineView
              timepoints={timepoints}
              events={visible}
              allEvents={items}
              occursAtEdges={occursAtFailed ? [] : occursAtEdges}
              occursCount={occursCount}
              hasOccursData={hasOccursData}
              onMoveTimepoint={handleMoveTimepoint}
              onMoveEvent={handleMoveEvent}
              onMoveEventTo={handleMoveEventTo}
              onRenameTimepoint={handleRenameTimepoint}
              onAddEventAt={openCreateInTimepoint}
              onDetail={(ev) => navigate(`/timeline/${ev.id}`)}
              onEdit={openEdit}
              onDelete={(ev) => void handleDelete({ kind: "event", entity: ev })}
              onDeleteTimepoint={(tp) => void handleDelete({ kind: "timepoint", entity: tp })}
            />
          )}

        {/* 标签筛选无匹配（timeline.md 状态：「没有匹配「{tag}」的事件」） */}
        {!loading && items !== null && items.length > 0 && visible !== null && visible.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
            没有匹配「{activeTag}」的事件
          </div>
        )}
      </div>

      {/* 新建时间点对话框（G2：name = 时间标签文本 → POST /entity/timepoint） */}
      <Dialog open={tpCreateOpen} onOpenChange={(v) => !v && setTpCreateOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建时间点</DialogTitle>
          </DialogHeader>
          <form id="create-timepoint-form" onSubmit={handleCreateTimepoint} className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">名称（必填，时间标签文本）</p>
              <Input
                value={tpName}
                onChange={(e) => setTpName(e.target.value)}
                placeholder="如：第二天黄昏"
                maxLength={100}
                autoFocus
              />
            </div>
            {tpError && <p className="text-sm text-destructive">{tpError}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setTpCreateOpen(false)} disabled={tpSubmitting}>
              取消
            </Button>
            <Button type="submit" form="create-timepoint-form" disabled={tpSubmitting}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建事件对话框（G2：移除 time_label 字段——时间标签由挂载表达；
          标题区分双入口：组尾挂载 vs 顶部不挂载） */}
      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {createTimepointId !== null ? "在此时间点新建事件（自动挂载）" : "新建事件（不挂载，入未挂载区）"}
            </DialogTitle>
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
              <p className="mb-1 text-sm font-medium text-foreground">标签</p>
              <Input
                value={createForm.tagsInput}
                onChange={(e) => setCreateForm((f) => ({ ...f, tagsInput: e.target.value }))}
                placeholder="如：主线，战争（逗号/回车分隔）"
              />
              {/* 标签输入建议（F8：点选即填，替换最后一段 + 追加逗号；无匹配不显示） */}
              <TagSuggest
                suggestions={createSuggestions}
                visible={createForm.tagsInput.trim() !== ""}
                onPick={pickCreateTag}
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

      {/* 编辑事件对话框（同新建表单预填；G2 无 time_label；timeline.md 行操作） */}
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
                <p className="mb-1 text-sm font-medium text-foreground">标签</p>
                <Input
                  value={editForm.tagsInput}
                  onChange={(e) => setEditForm((f) => (f ? { ...f, tagsInput: e.target.value } : f))}
                  placeholder="如：主线，战争（逗号/回车分隔）"
                />
                {/* 标签输入建议（F8：点选即填，替换最后一段 + 追加逗号；无匹配不显示） */}
                <TagSuggest
                  suggestions={editSuggestions}
                  visible={editForm.tagsInput.trim() !== ""}
                  onPick={pickEditTag}
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
