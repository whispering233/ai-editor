// 伏笔面板页（S9.1；替换 T7.1 占位壳）
// 路由：#/hooks（KNOWN_ROUTE_SEGMENTS + TabBar「伏笔」已就绪，layout.md §2.2）
// 数据：GET /api/v1/entity/hook（列表，EntitySummary：summary.status/summary.payoff_timing）+
//   GET /api/v1/relation?source_type=hook&relation_type=depends_on&depth=1（全量依赖边，行内「依赖:」展示）；
//   详情 GET /api/v1/entity/hook/:id（relations：plants/advances/resolves/depends_on/involves）
// 契约：doc/ui/pages/hook-panel.md（布局线框/信息层级/关键交互/状态）
// MVP 简化（backlog #13）：不展示 _health 指标与章节序（埋点章/预计回收章）——位置展示为详情
//   relations 的节点 id（plants source_id / resolves / data.expected_resolve_node_id）
// 关键交互（hook-panel.md）：
//  - 新建：POST /entity/hook + 有埋点节点再 POST /relation（outline_node → hook，plants）
//  - 推进/回收/废弃：复合写确认面板（提案式）——runLifecycleWrite / runAbandonWrite（lib/hook-panel），
//    确认前展示「将写入」内容；回收面板在存在依赖者时额外提示
//  - 行操作按钮全部展开（H3）：详情/推进/回收/废弃/编辑/移入回收站，禁止收进 ⋯ 菜单
//  - 依赖链：行内「依赖: …」可点击展开递归链（expandDependencyChain：深度 3 + 环守卫）
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { formatTimestamp, HOOK_CATEGORIES } from "@whispering233/ai-editor-shared";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { ArrowUp, Check, CheckCircle2, Circle, Eye, Pencil, Trash2, X } from "lucide-react";
import { AskAiButton } from "@/components/chat/AskAiButton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClass, errorBannerClass } from "@/lib/styles";
import { Input } from "@/components/ui/input";
import { SuggestionDatalist } from "@/components/ui/suggestion-datalist";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  createEntity,
  createRelation,
  deleteEntity,
  getEntityDetail,
  listEntities,
  listRelations,
  updateEntity,
  type EntityDetailRes,
  type RelationSummaryItem,
} from "../lib/api";
import { detailFieldsForType, diffData, type DetailFieldConfig } from "../lib/entity-detail";
import { HOOK_STATUS_LABEL, HOOK_TIMING_LABEL } from "../lib/entity-list";
import {
  anchorNodeForAbandon,
  buildPlantRelationBody,
  currentHookStatus,
  dependentsCount,
  dependencyNames,
  expandDependencyChain,
  groupHooksByStatus,
  involvesNames,
  nodeExists,
  relationsOfType,
  runAbandonWrite,
  runLifecycleWrite,
  type DepChainNode,
  type HookGroups,
  type HookLifecycleKind,
} from "../lib/hook-panel";
import { LIFECYCLE_STATUS } from "../lib/hook-panel";
import { flattenTree } from "../lib/outline-tree";
import { cn } from "../lib/utils";

import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 生命周期动作文案（确认面板标题/预览/toast） */
const LIFECYCLE_LABEL: Record<HookLifecycleKind, string> = {
  advance: "推进",
  resolve: "回收",
  abandon: "废弃",
};

/** 终态判定（resolved/abandoned 为生命周期终态——hooks.md；推进/回收/废弃入口禁用） */
function isTerminal(status: unknown): boolean {
  return status === "resolved" || status === "abandoned";
}

/** 字段值 → 表单字符串（undefined/null → 空串） */
function fieldValue(form: Record<string, unknown>, key: string): string {
  const v = form[key];
  return v === undefined || v === null ? "" : String(v);
}

/** 依赖链展开状态（行内「依赖: …」点击；key = 伏笔 id） */
interface ChainState {
  status: "loading" | "ready" | "error";
  nodes: DepChainNode[];
}

export default function HookPanel() {
  const [items, setItems] = useState<EntitySummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // 数据变更信号（问题 1）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉列表 + 依赖边
  // （AI 可能新建/推进/回收伏笔；ref 守卫防首帧重复拉）
  useDataRefresh(() => setReloadTick((t) => t + 1));
  /** 全量 depends_on 边（GET /relation 一次拉全；行内「依赖:」与依赖者计数用；失败不阻塞列表） */
  const [depEdges, setDepEdges] = useState<RelationSummaryItem[]>([]);
  const [depEdgesFailed, setDepEdgesFailed] = useState(false);

  // 详情对话框（relations 全览）
  const [detailTarget, setDetailTarget] = useState<EntityDetailRes | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 复合写确认面板（推进/回收/废弃）
  const [lifecycleTarget, setLifecycleTarget] = useState<EntityDetailRes | null>(null);
  const [lifecycleKind, setLifecycleKind] = useState<HookLifecycleKind>("advance");
  const [lifecycleNodeId, setLifecycleNodeId] = useState("");
  const [lifecycleDesc, setLifecycleDesc] = useState("");
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [lifecycleSubmitting, setLifecycleSubmitting] = useState(false);

  // 编辑对话框（data 表单，同 EntityDetail）
  const [editTarget, setEditTarget] = useState<EntityDetailRes | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown> | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // 新建对话框
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createData, setCreateData] = useState<Record<string, unknown>>({});
  const [createPlantNodeId, setCreatePlantNodeId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // 依赖链展开（行内「依赖: …」点击）
  const [chains, setChains] = useState<Record<string, ChainState>>({});

  const config = useProjectStore((s) => s.config);
  const outline = useProjectStore((s) => s.outline);
  const nodeOptions = flattenTree(outline?.children ?? []);
  const groups: HookGroups | null = items === null ? null : groupHooksByStatus(items);

  // 列表加载（reloadTick 驱动重试/刷新；卸载或重载丢弃过期响应）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDepEdgesFailed(false);
    // 重载后旧依赖链状态失效（伏笔可能已删除/关系变化）——清空避免残留展开
    setChains({});
    // 列表 + 全量依赖边并行（互不依赖；依赖边失败仅降级隐藏「依赖:」列）
    void listEntities("hook", {})
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setItems(null);
          setError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
        }
      });
    void listRelations({ source_type: "hook", relation_type: "depends_on", depth: 1 })
      .then((res) => {
        if (!cancelled) setDepEdges(res.relations);
      })
      .catch(() => {
        if (!cancelled) setDepEdgesFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // 大纲未加载时兜底拉取（新建/面板节点选择器依赖；项目打开时已加载，防御直达路由场景）
  useEffect(() => {
    if (useProjectStore.getState().outline === null && useProjectStore.getState().config !== null) {
      void useProjectStore.getState().loadOutline();
    }
  }, []);

  // ============ 详情 ============

  /** 打开详情（GET 详情；relations 全览） */
  async function openDetail(hook: EntitySummary) {
    setDetailTarget(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetailTarget(await getEntityDetail("hook", hook.id));
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "详情加载失败，请重试");
    } finally {
      setDetailLoading(false);
    }
  }

  // ============ 推进/回收/废弃（复合写确认面板） ============

  /** 打开复合写面板：先拉详情（delta 的 from = 当前 data.status，决策 9 修订自动取） */
  async function openLifecycle(kind: HookLifecycleKind, hook: EntitySummary) {
    setLifecycleTarget(null);
    setLifecycleError(null);
    setLifecycleDesc("");
    try {
      const detail = await getEntityDetail("hook", hook.id);
      // 默认节点：current_position（决策 21 锚点口径；须在树中存在且未软删）
      const cp = useProjectStore.getState().config?.currentPosition;
      const defaultNode =
        cp !== null && cp !== undefined && cp !== "" && nodeExists(outline, cp) ? cp : "";
      setLifecycleNodeId(defaultNode);
      setLifecycleKind(kind);
      setLifecycleTarget(detail);
    } catch {
      useUiStore.getState().showToast("无法读取伏笔状态，请重试", "error");
    }
  }

  /** 复合写确认：按动作走 runLifecycleWrite / runAbandonWrite → toast → 刷新 */
  async function handleLifecycleConfirm() {
    const detail = lifecycleTarget;
    if (!detail || lifecycleSubmitting) return;
    const kind = lifecycleKind;
    setLifecycleSubmitting(true);
    setLifecycleError(null);
    try {
      if (kind === "abandon") {
        // 废弃锚点：current_position 优先，退化树末节点（anchorNodeForAbandon，同 executor 语义）
        const anchor = anchorNodeForAbandon(config, outline);
        if (anchor === null) {
          setLifecycleError("大纲为空，无法记录废弃变更");
          return;
        }
        await runAbandonWrite({
          hookId: detail.id,
          fromStatus: currentHookStatus(detail.data),
          nodeId: anchor,
          description: lifecycleDesc.trim(),
        });
      } else {
        if (lifecycleNodeId === "") {
          setLifecycleError("请选择大纲节点");
          return;
        }
        await runLifecycleWrite({
          kind,
          hookId: detail.id,
          fromStatus: currentHookStatus(detail.data),
          nodeId: lifecycleNodeId,
          description: lifecycleDesc.trim(),
        });
      }
      useUiStore.getState().showToast(`已${LIFECYCLE_LABEL[kind]}`);
      setLifecycleTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setLifecycleError(err instanceof ApiError ? err.message : "操作失败，请重试");
    } finally {
      setLifecycleSubmitting(false);
    }
  }

  // ============ 编辑（data 表单） ============

  /** 打开编辑对话框：拉详情 → 表单初始化为 data 副本 */
  async function openEdit(hook: EntitySummary) {
    setEditTarget(null);
    setEditError(null);
    try {
      const detail = await getEntityDetail("hook", hook.id);
      setEditTarget(detail);
      setEditForm(JSON.parse(JSON.stringify(detail.data)) as Record<string, unknown>);
    } catch {
      useUiStore.getState().showToast("无法读取伏笔数据，请重试", "error");
    }
  }

  /** 编辑保存：diffData 只提交变更字段（PUT partial 浅合并） */
  async function handleEditSave() {
    if (!editTarget || !editForm || editSaving) return;
    const changed = diffData(editTarget.data, editForm);
    if (!changed) {
      useUiStore.getState().showToast("没有变更");
      setEditTarget(null);
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await updateEntity("hook", editTarget.id, { data: changed });
      useUiStore.getState().showToast("已保存");
      setEditTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "保存失败，请重试");
    } finally {
      setEditSaving(false);
    }
  }

  // ============ 新建 ============

  /** 新建提交：POST /entity/hook → 有埋点节点再 POST /relation（plants）→ toast + 刷新 */
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = createName.trim();
    if (!name) {
      setCreateError("请输入名称");
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const res = await createEntity("hook", { name, data: createData });
      // 有埋点节点才建 plants 关系（hook-panel.md 新建交互）；新伏笔 id 必不存在同三元组——
      // 失败（如节点已软删 400）不阻塞创建：提示后刷新，可后续在详情补关联
      if (createPlantNodeId !== "") {
        try {
          await createRelation(buildPlantRelationBody(res.id, createPlantNodeId));
        } catch (plantErr) {
          useUiStore
            .getState()
            .showToast(
              `已创建伏笔《${name}》，但埋点关联失败：${plantErr instanceof ApiError ? plantErr.message : "未知错误"}`,
              "error",
            );
          setCreateOpen(false);
          setReloadTick((t) => t + 1);
          return;
        }
      }
      useUiStore.getState().showToast(`已创建伏笔《${name}》`);
      setCreateOpen(false);
      setCreateName("");
      setCreateData({});
      setCreatePlantNodeId("");
      setReloadTick((t) => t + 1);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "创建失败，请重试");
    } finally {
      setCreateSubmitting(false);
    }
  }

  // ============ 软删 ============

  /** 软删直接执行（H2：不再弹二次确认）：DELETE → toast（级联计数）→ 刷新 */
  async function handleDelete(hook: EntitySummary) {
    try {
      const res = await deleteEntity("hook", hook.id);
      const parts: string[] = [];
      if (res.cascaded.relations > 0) parts.push(`${res.cascaded.relations} 条关联`);
      if (res.cascaded.deltas > 0) parts.push(`${res.cascaded.deltas} 条变更记录`);
      useUiStore
        .getState()
        .showToast(
          `已移入回收站，可随时还原${parts.length > 0 ? `（含 ${parts.join("、")}）` : ""}`,
        );
      setReloadTick((t) => t + 1);
    } catch (err) {
      useUiStore
        .getState()
        .showToast(err instanceof ApiError ? err.message : "删除失败，请重试", "error");
    }
  }

  // ============ 依赖链展开 ============

  /**
   * 行内「依赖: …」点击展开/收起递归链：
   * BFS 按需 fetch 各伏笔详情累积 depends_on 边（层级 ≤ 展示深度），环守卫防死循环；
   * 名称优先详情 name，未 fetch 到的层级用关系的 targetName 兜底
   */
  async function toggleChain(hook: EntitySummary) {
    if (chains[hook.id]) {
      setChains((c) => {
        const next = { ...c };
        delete next[hook.id];
        return next;
      });
      return;
    }
    setChains((c) => ({ ...c, [hook.id]: { status: "loading", nodes: [] } }));
    try {
      const depsOf = new Map<string, RelationSummaryItem[]>();
      const names = new Map<string, string>();
      const queue: Array<{ id: string; depth: number }> = [{ id: hook.id, depth: 0 }];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const detail = await getEntityDetail("hook", id);
        names.set(id, detail.name);
        const deps = relationsOfType(detail.relations, "depends_on").filter(
          (r) => r.sourceId === id,
        );
        depsOf.set(id, deps);
        // 展示深度内的节点才需要取下一层边；更深层名称已由边 targetName 兜底
        if (depth >= 2) continue;
        for (const d of deps) {
          if (!names.has(d.targetId)) names.set(d.targetId, d.targetName ?? d.targetId);
          queue.push({ id: d.targetId, depth: depth + 1 });
        }
      }
      const nodes = expandDependencyChain({ startHookId: hook.id, depsOf, names });
      setChains((c) => ({ ...c, [hook.id]: { status: "ready", nodes } }));
    } catch {
      setChains((c) => ({ ...c, [hook.id]: { status: "error", nodes: [] } }));
    }
  }

  // ============ 渲染 ============

  return (
    <section>
      {/* header：标题 + 新建入口（hook-panel.md 线框） */}
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">伏笔池</h1>
        <Button type="button" className="ml-auto" onClick={() => setCreateOpen(true)}>
          + 新建伏笔
        </Button>
      </div>

      {/* 错误横幅（列表请求失败 → 重试） */}
      {error !== null && (
        <div className={cn(errorBannerClass, "mb-3 flex items-center gap-2")}>
          {error === CLIENT_NETWORK_ERROR
            ? "无法连接服务，请确认 ai-editor 服务已启动。"
            : "伏笔池加载失败，请重试。"}
          <Button
            variant="outline"
            className="ml-auto h-7 px-2 text-xs"
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
          >
            重试
          </Button>
        </div>
      )}

      {/* 加载骨架（分组骨架——hook-panel.md 状态） */}
      {loading && groups === null && error === null && (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, gi) => (
            <div key={gi} className="rounded-md border border-border">
              <div className="h-4 w-20 animate-pulse rounded bg-muted px-3 py-1.5" />
              {Array.from({ length: gi === 0 ? 3 : 1 }, (_, ri) => (
                <div
                  key={ri}
                  className="flex items-center gap-3 border-t border-border/70 px-3 py-2.5"
                >
                  <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                  <div className="ml-auto h-6 w-6 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 空态（hook-panel.md 原文） */}
      {!loading && groups !== null && items?.length === 0 && (
        <EmptyState
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              + 新建伏笔
            </Button>
          }
        >
          还没有伏笔。好伏笔要趁早埋下——先新建一个，或在聊天里让 AI 帮你规划。
        </EmptyState>
      )}

      {/* 分组列表（活跃/已回收/已废弃——hook-panel.md 线框） */}
      {groups !== null && items && items.length > 0 && (
        <div className="space-y-4">
          <HookGroupSection
            title="活跃"
            icon={<span className="size-2 shrink-0 rounded-full bg-primary" />}
            hooks={groups.active}
            depEdges={depEdges}
            depEdgesFailed={depEdgesFailed}
            chains={chains}
            onToggleChain={toggleChain}
            onDetail={openDetail}
            onLifecycle={openLifecycle}
            onEdit={openEdit}
            onDelete={(hook) => void handleDelete(hook)}
          />
          <HookGroupSection
            title="已回收"
            icon={<CheckCircle2 className="size-3.5 shrink-0 text-primary" />}
            hooks={groups.resolved}
            depEdges={depEdges}
            depEdgesFailed={depEdgesFailed}
            chains={chains}
            onToggleChain={toggleChain}
            onDetail={openDetail}
            onLifecycle={openLifecycle}
            onEdit={openEdit}
            onDelete={(hook) => void handleDelete(hook)}
          />
          <HookGroupSection
            title="已废弃"
            icon={<Circle className="size-3.5 shrink-0 text-muted-foreground" />}
            hooks={groups.abandoned}
            depEdges={depEdges}
            depEdgesFailed={depEdgesFailed}
            chains={chains}
            onToggleChain={toggleChain}
            onDetail={openDetail}
            onLifecycle={openLifecycle}
            onEdit={openEdit}
            onDelete={(hook) => void handleDelete(hook)}
          />
        </div>
      )}

      {/* 新建伏笔对话框：name + data 表单 + 埋点节点选择（hook-panel.md 新建交互） */}
      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建伏笔</DialogTitle>
          </DialogHeader>
          <form id="create-hook-form" onSubmit={handleCreate} className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">名称（必填）</p>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="如：身世之谜"
                maxLength={100}
              />
            </div>
            <HookDataFields
              fields={CREATE_DATA_FIELDS}
              data={createData}
              onChange={setCreateData}
              nodeOptions={nodeOptions}
            />
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">埋点节点（选填，可空）</p>
              <OutlineNodeSelect
                value={createPlantNodeId}
                onChange={setCreatePlantNodeId}
                nodeOptions={nodeOptions}
              />
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </form>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => setCreateOpen(false)}
              disabled={createSubmitting}
            >
              取消
            </Button>
            <Button type="submit" form="create-hook-form" disabled={createSubmitting}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 详情对话框：relations 全览（埋点/推进/回收节点 id + 依赖链 + involves） */}
      <Dialog
        open={detailTarget !== null || detailLoading}
        onOpenChange={(v) => !v && setDetailTarget(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>伏笔详情</DialogTitle>
          </DialogHeader>
          {detailLoading && <p className="py-4 text-sm text-muted-foreground">加载中…</p>}
          {detailError && <p className="py-4 text-sm text-destructive">{detailError}</p>}
          {detailTarget && <HookDetailView detail={detailTarget} />}
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setDetailTarget(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 推进/回收/废弃复合写确认面板（提案式确认交互） */}
      {lifecycleTarget && (
        <Dialog open onOpenChange={(v) => !v && !lifecycleSubmitting && setLifecycleTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {LIFECYCLE_LABEL[lifecycleKind]}伏笔《{lifecycleTarget.name}》
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              {lifecycleKind !== "abandon" && (
                <div>
                  <p className="mb-1 text-sm font-medium text-foreground">
                    大纲节点（默认当前位置）
                  </p>
                  <OutlineNodeSelect
                    value={lifecycleNodeId}
                    onChange={setLifecycleNodeId}
                    nodeOptions={nodeOptions}
                    placeholder="请选择节点"
                  />
                </div>
              )}
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">描述</p>
                <textarea
                  value={lifecycleDesc}
                  onChange={(e) => setLifecycleDesc(e.target.value)}
                  rows={2}
                  placeholder={
                    lifecycleKind === "abandon" ? "说明废弃原因" : "说明伏笔如何被推进/回收"
                  }
                  className={cn(inputClass, "w-full")}
                />
              </div>
              {/* 将写入预览（提案式确认：确认前展示写入内容） */}
              <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">将写入：</p>
                <p className="mt-1 text-muted-foreground">
                  status → {LIFECYCLE_STATUS[lifecycleKind]}
                  {lifecycleKind === "advance" && " + advances 关系"}
                  {lifecycleKind === "resolve" && " + resolves 关系"}
                  {" + 同步 status"}
                </p>
                {/* 回收依赖者提示（S3 降级：depends_on 边加载失败时无法确认依赖者，明示不可用） */}
                {lifecycleKind === "resolve" && depEdgesFailed && (
                  <p className="mt-2 text-sm text-destructive">依赖关系加载失败，无法确认依赖者</p>
                )}
                {lifecycleKind === "resolve" &&
                  !depEdgesFailed &&
                  dependentsCount(depEdges, lifecycleTarget.id) > 0 && (
                    <p className="mt-2 text-sm text-destructive">
                      有 {dependentsCount(depEdges, lifecycleTarget.id)} 个伏笔依赖此伏笔
                    </p>
                  )}
              </div>
              {lifecycleError && <p className="text-sm text-destructive">{lifecycleError}</p>}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setLifecycleTarget(null)}
                disabled={lifecycleSubmitting}
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() => void handleLifecycleConfirm()}
                disabled={lifecycleSubmitting}
              >
                {lifecycleSubmitting ? "提交中…" : `确认${LIFECYCLE_LABEL[lifecycleKind]}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 编辑对话框：data 表单（同 EntityDetail，含 status 受控枚举） */}
      {editTarget && editForm && (
        <Dialog open onOpenChange={(v) => !v && !editSaving && setEditTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>编辑伏笔《{editTarget.name}》</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <HookDataFields
                fields={detailFieldsForType("hook")}
                data={editForm}
                onChange={(next) => setEditForm((prev) => (prev ? { ...prev, ...next } : prev))}
                nodeOptions={nodeOptions}
              />
              {editError && <p className="text-sm text-destructive">{editError}</p>}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={editSaving}
              >
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

// ============ 子组件 ============

/** 分组卡片（活跃/已回收/已废弃；行主信息 = name + category 徽标 + 直接操作按钮 + 依赖链） */
function HookGroupSection({
  title,
  icon,
  hooks,
  depEdges,
  depEdgesFailed,
  chains,
  onToggleChain,
  onDetail,
  onLifecycle,
  onEdit,
  onDelete,
}: {
  title: string;
  icon: ReactNode;
  hooks: EntitySummary[];
  depEdges: RelationSummaryItem[];
  depEdgesFailed: boolean;
  chains: Record<string, ChainState>;
  onToggleChain: (hook: EntitySummary) => void;
  onDetail: (hook: EntitySummary) => void;
  onLifecycle: (kind: HookLifecycleKind, hook: EntitySummary) => void;
  onEdit: (hook: EntitySummary) => void;
  onDelete: (hook: EntitySummary) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1.5 text-sm font-medium text-foreground">
        {icon}
        <span>{title}</span>
        <span className="text-muted-foreground">({hooks.length})</span>
      </div>
      {hooks.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground/70">（空）</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {hooks.map((hook) => {
            const terminal = isTerminal(hook.summary.status);
            const deps = depEdgesFailed ? [] : dependencyNames(depEdges, hook.id);
            const chain = chains[hook.id];
            const category = typeof hook.summary.category === "string" ? hook.summary.category : "";
            return (
              <li key={hook.id} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-medium text-foreground" title={hook.name}>
                    {hook.name}
                  </span>
                  {category && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {category}
                    </span>
                  )}
                  {/* 操作按钮全部展开（H3：禁止收进 ⋯ 二级展开；图标 + title/aria-label） */}
                  <span className="ml-auto flex shrink-0 items-center gap-0.5">
                    {/* 行级「带上下文问 AI」（决策 35 修订） */}
                    <AskAiButton focus={{ focus_entity_type: "hook", focus_entity_id: hook.id }} title={`带伏笔《${hook.name}》问 AI`} />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      title="详情"
                      aria-label={`${hook.name} 详情`}
                      onClick={() => onDetail(hook)}
                    >
                      <Eye className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={terminal}
                      className="text-muted-foreground"
                      title="推进"
                      aria-label={`${hook.name} 推进`}
                      onClick={() => onLifecycle("advance", hook)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={terminal}
                      className="text-muted-foreground"
                      title="回收"
                      aria-label={`${hook.name} 回收`}
                      onClick={() => onLifecycle("resolve", hook)}
                    >
                      <Check className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={terminal}
                      className="text-muted-foreground"
                      title="废弃"
                      aria-label={`${hook.name} 废弃`}
                      onClick={() => onLifecycle("abandon", hook)}
                    >
                      <X className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      title="编辑"
                      aria-label={`${hook.name} 编辑`}
                      onClick={() => onEdit(hook)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      title="移入回收站"
                      aria-label={`${hook.name} 移入回收站`}
                      onClick={() => onDelete(hook)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                </div>
                {/* 依赖链行（行内「依赖: …」可点击展开递归链） */}
                {deps.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggleChain(hook)}
                    className="mt-0.5 flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    依赖: {deps.join("、")}
                  </button>
                )}
                {chain?.status === "loading" && (
                  <p className="mt-0.5 text-xs text-muted-foreground">依赖链展开中…</p>
                )}
                {chain?.status === "error" && (
                  <p className="mt-0.5 text-xs text-destructive">依赖链加载失败</p>
                )}
                {chain?.status === "ready" && chain.nodes.length > 1 && (
                  <ul className="mt-1 space-y-0.5 border-l border-border pl-2">
                    {chain.nodes.slice(1).map((n) => (
                      <li key={`${n.depth}-${n.hookId}`} className="text-xs text-muted-foreground">
                        {"　".repeat(n.depth - 1)}
                        {n.name}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 详情视图：元信息 + relations 分区（埋点/推进/回收节点 id + 依赖链 + involves） */
function HookDetailView({ detail }: { detail: EntityDetailRes }) {
  const id = detail.id;
  const status = typeof detail.data.status === "string" ? detail.data.status : "";
  const category = typeof detail.data.category === "string" ? detail.data.category : "";
  const plants = relationsOfType(detail.relations, "plants");
  const advances = relationsOfType(detail.relations, "advances");
  const resolves = relationsOfType(detail.relations, "resolves");
  const deps = dependencyNames(detail.relations, id);
  const dependents = relationsOfType(detail.relations, "depends_on")
    .filter((r) => r.targetId === id)
    .map((r) => r.sourceName ?? r.sourceId);
  const involves = involvesNames(detail.relations, id);
  const expectedResolve =
    typeof detail.data.expected_resolve_node_id === "string"
      ? detail.data.expected_resolve_node_id
      : "";

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium text-foreground">{detail.name}</span>
        {category && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {category}
          </span>
        )}
        {status && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {HOOK_STATUS_LABEL[status] ?? status}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        创建于 {formatTimestamp(detail.createdAt)} · 更新于 {formatTimestamp(detail.updatedAt)}
      </p>
      {/* 埋点/回收位置（MVP：节点 id；章节序后续迭代服务端现推——backlog #13） */}
      <RelationBlock
        title="埋点节点（plants）"
        items={plants.map((r) => r.sourceName ?? r.sourceId)}
      />
      <RelationBlock
        title="推进节点（advances）"
        items={advances.map((r) => r.sourceName ?? r.sourceId)}
      />
      <RelationBlock
        title="回收节点（resolves）"
        items={resolves.map((r) => r.sourceName ?? r.sourceId)}
      />
      <RelationBlock title="预计回收节点" items={expectedResolve ? [expectedResolve] : []} />
      <RelationBlock title="依赖（depends_on）" items={deps} />
      <RelationBlock title="被依赖（其他伏笔依赖本伏笔）" items={dependents} />
      <RelationBlock title="涉及（involves）" items={involves} />
    </div>
  );
}

/** relations 分区块（空态「无」） */
function RelationBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">无</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {items.map((it, i) => (
            <li
              key={`${it}-${i}`}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
            >
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============ 表单控件 ============

/** 新建对话框的 data 字段配置（不含 status——创建即埋设，决策 21；不含 expected_resolve_node_id 之外的引用） */
const CREATE_DATA_FIELDS: DetailFieldConfig[] = [
  { key: "category", label: "类别", control: "text" },
  { key: "expected_payoff", label: "预期回收", control: "textarea" },
  {
    key: "payoff_timing",
    label: "回收时机",
    control: "select",
    options: ["immediate", "near_term", "mid_arc", "slow_burn", "endgame"],
    optionsLabels: HOOK_TIMING_LABEL,
  },
  { key: "half_life", label: "半衰期（章数）", control: "number" },
  { key: "is_core", label: "主线伏笔", control: "toggle" },
  { key: "notes", label: "备注", control: "textarea" },
  { key: "expected_resolve_node_id", label: "预计回收节点", control: "outline-node" },
];

/** 伏笔 data 字段控件组（新建/编辑共用；字段出现与否由 data 决定——与实体详情页同语义） */
function HookDataFields({
  fields,
  data,
  onChange,
  nodeOptions,
}: {
  fields: DetailFieldConfig[];
  data: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  nodeOptions: Array<{ id: string; label: string; depth: number }>;
}) {
  return (
    <>
      {fields.map((f) => (
        <div key={f.key}>
          <p className="mb-1 text-sm font-medium text-foreground">{f.label}</p>
          <HookDataField
            field={f}
            value={data[f.key]}
            nodeOptions={nodeOptions}
            onValue={(v) => onChange({ ...data, [f.key]: v })}
          />
        </div>
      ))}
    </>
  );
}

/** 单个 data 字段控件（text/textarea/number/select/toggle/outline-node——同 EntityDetail FormField 控件集） */
function HookDataField({
  field,
  value,
  nodeOptions,
  onValue,
}: {
  field: DetailFieldConfig;
  value: unknown;
  nodeOptions: Array<{ id: string; label: string; depth: number }>;
  onValue: (v: unknown) => void;
}) {
  switch (field.control) {
    case "textarea":
      return (
        <textarea
          value={fieldValue({ [field.key]: value }, field.key)}
          onChange={(e) => onValue(e.target.value)}
          rows={2}
          className={cn(inputClass, "w-full")}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          value={fieldValue({ [field.key]: value }, field.key)}
          onChange={(e) => onValue(e.target.value === "" ? undefined : Number(e.target.value))}
          className="h-8 text-sm"
        />
      );
    case "select":
      return (
        <select
          value={fieldValue({ [field.key]: value }, field.key)}
          onChange={(e) => onValue(e.target.value)}
          className={cn(inputClass, "w-full")}
        >
          <option value="">未设置</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {field.optionsLabels?.[opt] ?? opt}
            </option>
          ))}
        </select>
      );
    case "toggle":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onValue(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
      );
    case "outline-node":
      return (
        <OutlineNodeSelect
          value={fieldValue({ [field.key]: value }, field.key)}
          onChange={onValue}
          nodeOptions={nodeOptions}
        />
      );
    default:
      return (
        <>
          <Input
            value={fieldValue({ [field.key]: value }, field.key)}
            onChange={(e) => onValue(e.target.value)}
            placeholder={
              field.key === "category" ? `如：${HOOK_CATEGORIES.join(" / ")}` : undefined
            }
            list={field.key === "category" ? "hook-category-suggestions" : undefined}
            className="h-8 text-sm"
          />
          {field.key === "category" && (
            <SuggestionDatalist id="hook-category-suggestions" options={HOOK_CATEGORIES} />
          )}
        </>
      );
  }
}

/** 大纲节点选择器（新建埋点/推进回收节点/expected_resolve_node_id 共用；选项来自 outline store 的树） */
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
      className={cn(cn(inputClass, "w-full"), value === "" && "text-muted-foreground")}
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
