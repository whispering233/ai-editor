// 时间轴事件详情页（C4，决策 26；G2.3 修订：time_label 移除 + 挂载时间点选择器）
// 路由：#/timeline/:id（2 段）；数据：GET /api/v1/entity/event/:id（EntityDetailRes：完整 data + relations）
// 契约：doc/ui/pages/timeline.md「详情页（#/timeline/:id）」——字段编辑（name/description/tags，G2 无
//   time_label）、**挂载时间点选择器（G2）**、occurs_in 关联管理（添加：大纲节点选择器 → POST /relation
//   event → outline_node；取消：确认后 DELETE /relation/:id 物理删）、软删（H2：直接执行，级联计数 toast → 跳回列表）、
//   三态（加载骨架 / 404 / 保存失败内联）
// 参照：EntityDetail.tsx（面包屑/保存交互/404 引导/软删直接执行）、HookPanel/Timeline OutlineNodeSelect（节点选择）
// 关键决策：
//  - 404 错误码为 ENTITY_NOT_FOUND（事件走泛型实体路由，server/src/routes/entity.ts；timeline.md 的
//    EVENT_NOT_FOUND 为文档示意名，ErrorCode 枚举无此码——客户端以实际契约码判定）
//  - 已关联节点标题取关系 targetName（服务端联表填充大纲节点标题，endpoints.md L430），点击跳
//    #/outline/:nodeId 定位；节点选择器允许重复选择——服务端 409 RELATION_EXISTS 判重（选实现最简，
//    提示沿用 entity-detail.md「这条关系已经存在」）
//  - 关联节点选择器（UX3）：全屏模态 Dialog → Base UI Popover 轻量非模态弹层（components/ui/popover.tsx）——
//    不打断详情页编辑；409 内联提示保留在 Popover 内，选择后提交成功关闭 + 重拉详情
//  - **挂载选择器（G2）**：当前挂载 = detail.relations 中 occurs_at（timepoint → event，事件为 target 端）
//    的 sourceId；变更即保存——POST /entity/event/:id/move_to { timepoint_id, order }（以 move_to 语义
//    统一，事务原子），order = 事件在当前全局序中的位置（列表 index，保位不跳位）；空 = 移出未挂载。
//    时间点/事件列表预拉（选择器选项 + 当前位置）；拉取失败 → 选择器重试（不阻塞详情主体）
//  - 元信息行不展示「变更记录 N 条」入口：事件不产生 Delta（决策 26），timeline.md 信息层级仅
//    createdAt/updatedAt
//  - 未保存离开守卫：EntityDetail 无此模式，不做（避免过度设计）
import { useEffect, useState } from "react";
import { formatTimestamp } from "@whispering233/ai-editor-shared";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  createRelation,
  deleteEntity,
  deleteRelation,
  getEntityDetail,
  listEntities,
  moveEntityEventTo,
  updateEntity,
  type EntityDetailRes,
  type RelationSummaryItem,
} from "../lib/api";
import {
  applyTagSuggestion,
  buildEventDetailPatch,
  collectEventTags,
  eventFormFromDetail,
  suggestTags,
  type EventDetailForm,
} from "../lib/timeline";
import {
  buildOccursRelationBody,
  occursInRelations,
  mountedTimepointId,
} from "../lib/timeline-detail";
import { flattenTree } from "../lib/outline-tree";
import { cn } from "../lib/utils";
import { inputClass } from "@/lib/styles";
import { Breadcrumb } from "../components/page-nav/Breadcrumb";
import { ConfirmDialog } from "../components/outline/dialogs";
import { TagSuggest } from "../components/timeline/TagSuggest";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

export default function TimelineDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<EntityDetailRes | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 表单值（详情 data 副本；null = 未加载） */
  const [form, setForm] = useState<EventDetailForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 关联节点选择器 Popover（UX3 轻量弹层：非模态，不打断详情页）
  const [relationOpen, setRelationOpen] = useState(false);
  const [relNodeId, setRelNodeId] = useState("");
  const [relError, setRelError] = useState<string | null>(null);
  const [relSubmitting, setRelSubmitting] = useState(false);
  // 取消关联确认（物理删）
  const [deleteRelationTarget, setDeleteRelationTarget] = useState<RelationSummaryItem | null>(
    null,
  );
  // 标签建议池（F8：独立补拉全量 200 聚合已存在标签；失败静默——无建议区，不影响表单）
  const [tagPool, setTagPool] = useState<string[]>([]);
  // 挂载选择器数据（G2）：时间点列表（选项）+ 事件列表（当前位置保位）；失败 → 选择器重试
  const [timepoints, setTimepoints] = useState<EntitySummary[] | null>(null);
  const [events, setEvents] = useState<EntitySummary[] | null>(null);
  const [mountDataFailed, setMountDataFailed] = useState(false);
  const [mountSaving, setMountSaving] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);

  /** 补拉全量事件聚合标签池（F8；保存新标签后随 useDataRefresh 刷新，避免建议池陈旧——oracle P2） */
  async function loadTagPool(): Promise<void> {
    try {
      const res = await listEntities("event", { limit: 200 });
      setTagPool(collectEventTags(res.items));
    } catch {
      // 失败静默（契约：详情页独立补拉，失败仅无建议区）
    }
  }

  /**
   * 挂载选择器数据（G2）：时间点列表（选项）+ 事件列表（当前位置——move_to 保位用；
   * limit 200 拉全量——全局事件线性序，避免 >50 时 findIndex 落空）。
   * 失败 → mountDataFailed（选择器显示重试，不阻塞详情主体/表单）。
   */
  async function loadMountData(): Promise<void> {
    setMountDataFailed(false);
    try {
      const [tpRes, evRes] = await Promise.all([
        listEntities("timepoint", {}),
        listEntities("event", { limit: 200 }),
      ]);
      setTimepoints(tpRes.items);
      setEvents(evRes.items);
    } catch {
      setTimepoints(null);
      setEvents(null);
      setMountDataFailed(true);
    }
  }

  useEffect(() => {
    void loadTagPool();
    void loadMountData();
    // 依赖仅 []：挂载拉取一次；数据变更由 useDataRefresh 兜底刷新（main.tsx key=id 保证切页 remount）
  }, []);

  const outline = useProjectStore((s) => s.outline);
  const nodeOptions = flattenTree(outline?.children ?? []);

  /** 加载详情（id 变化重载；成功重置表单为 name + data 副本） */
  async function loadDetail() {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const res = await getEntityDetail("event", id);
      setDetail(res);
      setForm(eventFormFromDetail(res));
    } catch (err) {
      setDetail(null);
      setForm(null);
      if (err instanceof ApiError && err.code === "ENTITY_NOT_FOUND") {
        setNotFound(true);
      } else {
        setLoadError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
    // 依赖仅 [id]：loadDetail 每次渲染重建，但页面切换才需重载（同 EntityDetail）
  }, [id]);

  // 数据变更信号：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉详情（表单以服务端权威为准重置）+ 标签池 + 挂载数据
  useDataRefresh(() => {
    void loadDetail();
    void loadTagPool();
    void loadMountData();
  });

  // 大纲未加载时兜底拉取（节点选择器依赖；项目打开时已加载，防御直达路由场景——同 HookPanel/Timeline）
  useEffect(() => {
    if (useProjectStore.getState().outline === null && useProjectStore.getState().config !== null) {
      void useProjectStore.getState().loadOutline();
    }
  }, []);

  /** 保存：buildEventDetailPatch 只提交变更字段（partial 浅合并，与 C3 编辑对话框同语义）；成功后重拉 */
  async function handleSave() {
    if (!detail || !form || saving) return;
    const patch = buildEventDetailPatch({ name: detail.name, data: detail.data }, form);
    if (patch === null) {
      useUiStore.getState().showToast("没有变更");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateEntity("event", id, patch);
      useUiStore.getState().showToast("已保存");
      await loadDetail();
    } catch (err) {
      if (err instanceof ApiError && err.code === "ENTITY_NOT_FOUND") {
        setNotFound(true);
        return;
      }
      setSaveError(err instanceof ApiError ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  /**
   * 挂载变更即保存（G2，以 move_to 语义统一）：
   * POST /entity/event/:id/move_to { timepoint_id（空 = 移出未挂载）, order }——
   * order = 事件在当前全局事件序中的 index（保位不跳位：改挂载不动位置）；
   * 列表未拉到/未找到（防御）→ 全局序末尾（length——不改动其他事件相对序）。
   * 成功 → toast + 重拉详情（relations 更新）；失败 → 内联错误 + 选择器回退原值
   * （受控 value = mountedId，未变更 state 即回退）。
   */
  async function handleMountChange(nextTimepointId: string) {
    if (!detail || mountSaving || !timepoints || !events) return;
    const current = mountedTimepointId(detail.relations, id);
    if (nextTimepointId === (current ?? "")) return; // 未变更（含「未挂载」选未挂载）
    const idx = events.findIndex((ev) => ev.id === id);
    const order = idx === -1 ? events.length : idx; // 未找到 → 末尾（防御，保其余事件相对序）
    setMountSaving(true);
    setMountError(null);
    try {
      await moveEntityEventTo(id, {
        timepoint_id: nextTimepointId === "" ? null : nextTimepointId,
        order,
      });
      useUiStore.getState().showToast(nextTimepointId === "" ? "已移出挂载" : "已更新挂载时间点");
      await loadDetail();
    } catch (err) {
      if (err instanceof ApiError && err.code === "ENTITY_NOT_FOUND") {
        setNotFound(true);
        return;
      }
      setMountError(err instanceof ApiError ? err.message : "挂载保存失败，请重试");
    } finally {
      setMountSaving(false);
    }
  }

  /** 添加关联：POST /relation（event → outline_node，occurs_in）；409 判重内联提示，不关闭 Popover */
  async function handleAddRelation() {
    if (relNodeId === "" || relSubmitting) return;
    setRelSubmitting(true);
    setRelError(null);
    try {
      await createRelation(buildOccursRelationBody(id, relNodeId));
      useUiStore.getState().showToast("已关联大纲节点");
      setRelationOpen(false);
      await loadDetail();
    } catch (err) {
      if (err instanceof ApiError && err.code === "RELATION_EXISTS") {
        setRelError("这条关系已经存在");
        return;
      }
      setRelError(err instanceof ApiError ? err.message : "关联失败，请重试");
    } finally {
      setRelSubmitting(false);
    }
  }

  /** 取消关联（物理删，确认后执行；冒泡错误给 ConfirmDialog 内联显示） */
  async function handleDeleteRelation() {
    if (!deleteRelationTarget) return;
    try {
      await deleteRelation(deleteRelationTarget.id);
      useUiStore.getState().showToast("已取消关联");
      setDeleteRelationTarget(null);
      await loadDetail();
    } catch (err) {
      throw err;
    }
  }

  /** 软删直接执行（H2：不再弹二次确认）：DELETE → toast（级联计数）→ 跳回列表 */
  async function handleDelete() {
    if (!detail) return;
    try {
      const res = await deleteEntity("event", id);
      const parts: string[] = [];
      if (res.cascaded.relations > 0) parts.push(`${res.cascaded.relations} 条关联`);
      if (res.cascaded.deltas > 0) parts.push(`${res.cascaded.deltas} 条变更记录`);
      useUiStore
        .getState()
        .showToast(
          `已移入回收站，可随时还原${parts.length > 0 ? `（含 ${parts.join("、")}）` : ""}`,
        );
      navigate("/timeline");
    } catch (err) {
      useUiStore
        .getState()
        .showToast(err instanceof ApiError ? err.message : "删除失败，请重试", "error");
    }
  }

  // ============ 渲染 ============

  if (notFound) {
    return (
      <section>
        <EmptyState
          padding="lg"
          action={
            <div className="flex justify-center gap-2">
              <a
                href="#/trash"
                className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              >
                去回收站
              </a>
              <Button variant="outline" type="button" onClick={() => navigate("/timeline")}>
                返回列表
              </Button>
            </div>
          }
        >
          该事件不存在或已被删除
        </EmptyState>
      </section>
    );
  }

  const occurring = detail === null ? [] : occursInRelations(detail.relations, id);
  // 标签建议（F8：按表单当前输入匹配标签池；空段不匹配 → 无建议区）
  const tagSuggestions = form === null ? [] : suggestTags(form.tagsInput, tagPool);

  /** 点选建议填入（F8）：替换最后一段 + 追加逗号；输入框焦点由 TagSuggest onMouseDown 保持 */
  function pickTag(tag: string) {
    setForm((f) => (f ? { ...f, tagsInput: applyTagSuggestion(f.tagsInput, tag) } : f));
  }

  return (
    <section>
      {/* header：面包屑（时间轴 › 事件名，返回列表入口）+ 操作 */}
      <div className="mb-1 flex items-center gap-3">
        <Breadcrumb
          items={[{ label: "时间轴", href: "/timeline" }, { label: detail?.name ?? "…" }]}
        />
        <h1 className="min-w-0 truncate text-xl font-semibold">{detail?.name ?? "…"}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => void handleSave()}
            disabled={!detail || saving}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={!detail}
            className="text-destructive hover:bg-destructive/10"
            onClick={() => void handleDelete()}
          >
            移入回收站
          </Button>
        </div>
      </div>
      {/* 元信息行（事件不产生 Delta——决策 26，仅展示时间，timeline.md 信息层级） */}
      {detail && (
        <p className="mb-4 text-xs text-muted-foreground">
          创建于 {formatTimestamp(detail.createdAt)} · 更新于 {formatTimestamp(detail.updatedAt)}
        </p>
      )}

      {/* 加载骨架 */}
      {loading && !detail && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-md border border-border p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-muted" />
            ))}
          </div>
          <div className="space-y-3 rounded-md border border-border p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      )}

      {/* 加载失败 */}
      {!loading && !detail && loadError !== null && (
        <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          {loadError === CLIENT_NETWORK_ERROR
            ? "无法连接服务，请确认 ai-editor 服务已启动。"
            : "详情加载失败，请重试。"}
          <Button
            variant="outline"
            className="ml-3"
            type="button"
            onClick={() => void loadDetail()}
          >
            重试
          </Button>
        </div>
      )}

      {detail && form && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* 左栏：基础信息表单（name + data 两字段，G2 无 time_label——时间标签 = 挂载，
              timeline.md 详情页字段编辑 + 挂载时间点选择器） */}
          <div className="rounded-md border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">基础信息</h2>
            <div className="flex flex-col gap-3">
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">名称（必填）</p>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                  maxLength={100}
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">描述</p>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => (f ? { ...f, description: e.target.value } : f))}
                  rows={3}
                  placeholder="事件发生了什么"
                  className={cn(inputClass, "w-full")}
                />
              </div>
              {/* 挂载时间点选择器（G2）：显示当前挂载 + 选择器（可清空 = 移出未挂载）；
                  变更即保存 move_to（保位）。数据预拉失败 → 行内重试（不阻塞详情主体） */}
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">挂载时间点</p>
                {timepoints === null ? (
                  mountDataFailed ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      挂载数据加载失败
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        className="h-6 px-2 text-xs"
                        onClick={() => void loadMountData()}
                      >
                        重试
                      </Button>
                    </div>
                  ) : (
                    <div className="h-9 animate-pulse rounded bg-muted" />
                  )
                ) : (
                  <select
                    value={mountedTimepointId(detail.relations, id) ?? ""}
                    onChange={(e) => void handleMountChange(e.target.value)}
                    disabled={mountSaving}
                    className={cn(
                      cn(inputClass, "w-full"),
                      mountedTimepointId(detail.relations, id) === null && "text-muted-foreground",
                    )}
                  >
                    <option value="">未挂载</option>
                    {timepoints.map((tp) => (
                      <option key={tp.id} value={tp.id}>
                        {tp.name}
                      </option>
                    ))}
                  </select>
                )}
                {mountSaving && <p className="mt-1 text-xs text-muted-foreground">保存中…</p>}
                {mountError && <p className="mt-1 text-sm text-destructive">{mountError}</p>}
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">标签</p>
                <Input
                  value={form.tagsInput}
                  onChange={(e) => setForm((f) => (f ? { ...f, tagsInput: e.target.value } : f))}
                  placeholder="如：主线，战争（逗号/回车分隔）"
                />
                {/* 标签输入建议（F8：点选即填，替换最后一段 + 追加逗号；无匹配不显示） */}
                <TagSuggest
                  suggestions={tagSuggestions}
                  visible={form.tagsInput.trim() !== ""}
                  onPick={pickTag}
                />
              </div>
              {saveError && <p className="text-sm text-destructive">{saveError}</p>}
            </div>
          </div>

          {/* 右栏：occurs_in 关联节点管理（timeline.md 详情页核心交互；UX3：选择器为 Popover 轻量弹层） */}
          <div className="rounded-md border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">关联节点（occurs_in）</h2>
              <Popover
                open={relationOpen}
                onOpenChange={(v) => {
                  if (v) {
                    // 打开时重置选择态（防上次残留）
                    setRelNodeId("");
                    setRelError(null);
                    setRelationOpen(true);
                  } else if (!relSubmitting) {
                    // 提交中禁止关闭（409 内联提示需要停留；Esc/点击外部同理被守卫）
                    setRelationOpen(false);
                  }
                }}
              >
                <PopoverTrigger
                  render={
                    <Button variant="outline" type="button" className="h-8 px-2 text-xs">
                      + 关联场景/章节
                    </Button>
                  }
                />
                <PopoverContent className="flex flex-col gap-3">
                  <div>
                    <p className="mb-1 text-sm font-medium text-foreground">大纲节点</p>
                    <OutlineNodeSelect
                      value={relNodeId}
                      onChange={setRelNodeId}
                      nodeOptions={nodeOptions}
                      placeholder="请选择节点"
                    />
                  </div>
                  {relError && <p className="text-sm text-destructive">{relError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      type="button"
                      size="sm"
                      onClick={() => setRelationOpen(false)}
                      disabled={relSubmitting}
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleAddRelation()}
                      disabled={relSubmitting || relNodeId === ""}
                    >
                      {relSubmitting ? "关联中…" : "关联"}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {occurring.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                暂无关联节点，新增一个
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {occurring.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                    <button
                      type="button"
                      onClick={() => navigate(`/outline/${r.targetId}`)}
                      title="跳转大纲定位"
                      className="min-w-0 flex-1 truncate rounded-md border border-border px-1.5 py-0.5 text-left text-foreground hover:bg-muted hover:text-foreground"
                    >
                      {r.targetName ?? r.targetId}
                    </button>
                    <Button
                      variant="outline"
                      type="button"
                      className="h-7 shrink-0 px-2 text-xs text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteRelationTarget(r)}
                    >
                      取消关联
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* 取消关联确认（物理删不可恢复，可重新建立——同实体详情页关系删除语义） */}
      {deleteRelationTarget && (
        <ConfirmDialog
          title="取消关联"
          description={`取消《${deleteRelationTarget.targetName ?? deleteRelationTarget.targetId}》与事件的关联？物理删除不可恢复，可重新建立。`}
          confirmLabel="取消关联"
          danger
          onConfirm={handleDeleteRelation}
          onClose={() => setDeleteRelationTarget(null)}
        />
      )}
    </section>
  );
}

/** 大纲节点选择器（关联场景/章节；选项来自 outline store 的树——同 HookPanel/Timeline OutlineNodeSelect） */
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
