// 时间轴事件详情页（C4，决策 26；启用 main.tsx C3 留的 #/timeline/:id 占位与列表页「详情」菜单）
// 路由：#/timeline/:id（2 段）；数据：GET /api/v1/entity/event/:id（EntityDetailRes：完整 data + relations）
// 契约：doc/ui/pages/timeline.md「详情页（#/timeline/:id）」——字段编辑（name/description/time_label/tags）、
//   occurs_in 关联管理（添加：大纲节点选择器 → POST /relation event → outline_node；取消：确认后
//   DELETE /relation/:id 物理删）、软删（级联计数 toast → 跳回列表）、三态（加载骨架 / 404 / 保存失败内联）
// 参照：EntityDetail.tsx（面包屑/保存交互/404 引导/软删确认）、HookPanel/Timeline OutlineNodeSelect（节点选择）
// 关键决策：
//  - 404 错误码为 ENTITY_NOT_FOUND（事件走泛型实体路由，server/src/routes/entity.ts；timeline.md 的
//    EVENT_NOT_FOUND 为文档示意名，ErrorCode 枚举无此码——客户端以实际契约码判定）
//  - 已关联节点标题取关系 targetName（服务端联表填充大纲节点标题，endpoints.md L430），点击跳
//    #/outline/:nodeId 定位；节点选择器允许重复选择——服务端 409 RELATION_EXISTS 判重（选实现最简，
//    提示沿用 entity-detail.md「这条关系已经存在」）
//  - 关联节点选择器（UX3）：全屏模态 Dialog → Base UI Popover 轻量非模态弹层（components/ui/popover.tsx）——
//    不打断详情页编辑；409 内联提示保留在 Popover 内，选择后提交成功关闭 + 重拉详情
//  - 元信息行不展示「变更记录 N 条」入口：事件不产生 Delta（决策 26），timeline.md 信息层级仅
//    createdAt/updatedAt
//  - 未保存离开守卫：EntityDetail 无此模式，不做（避免过度设计）
import { useEffect, useState } from "react";
import { formatTimestamp } from "@whispering233/ai-editor-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  createRelation,
  deleteEntity,
  deleteRelation,
  getEntityDetail,
  updateEntity,
  type EntityDetailRes,
  type RelationSummaryItem,
} from "../lib/api";
import {
  buildEventDetailPatch,
  eventFormFromDetail,
  type EventDetailForm,
} from "../lib/timeline";
import { buildOccursRelationBody, occursInRelations } from "../lib/timeline-detail";
import { flattenTree } from "../lib/outline-tree";
import { cn } from "../lib/utils";
import { Breadcrumb } from "../components/page-nav/Breadcrumb";
import { ConfirmDialog } from "../components/outline/dialogs";
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
  const [deleteRelationTarget, setDeleteRelationTarget] = useState<RelationSummaryItem | null>(null);
  // 软删确认
  const [deleteTarget, setDeleteTarget] = useState(false);

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

  // 数据变更信号：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉详情（表单以服务端权威为准重置）
  useDataRefresh(() => void loadDetail());

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

  /** 软删确认后执行：DELETE → toast（级联计数）→ 跳回列表 */
  async function handleDelete() {
    if (!detail) return;
    try {
      const res = await deleteEntity("event", id);
      const parts: string[] = [];
      if (res.cascaded.relations > 0) parts.push(`${res.cascaded.relations} 条关联`);
      if (res.cascaded.deltas > 0) parts.push(`${res.cascaded.deltas} 条变更记录`);
      useUiStore.getState().showToast(
        `已移入回收站，可随时还原${parts.length > 0 ? `（含 ${parts.join("、")}）` : ""}`,
      );
      setDeleteTarget(false);
      navigate("/timeline");
    } catch (err) {
      throw err; // 冒泡给 ConfirmDialog 内联显示
    }
  }

  // ============ 渲染 ============

  if (notFound) {
    return (
      <section>
        <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">该事件不存在或已被删除</p>
          <div className="mt-4 flex justify-center gap-2">
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
        </div>
      </section>
    );
  }

  const occurring = detail === null ? [] : occursInRelations(detail.relations, id);

  return (
    <section>
      {/* header：面包屑（时间轴 › 事件名，返回列表入口）+ 操作 */}
      <div className="mb-1 flex items-center gap-3">
        <Breadcrumb
          items={[
            { label: "时间轴", href: "/timeline" },
            { label: detail?.name ?? "…" },
          ]}
        />
        <h1 className="min-w-0 truncate text-xl font-semibold">{detail?.name ?? "…"}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" type="button" onClick={() => void handleSave()} disabled={!detail || saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={!detail}
            className="text-destructive hover:bg-destructive/10"
            onClick={() => setDeleteTarget(true)}
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
          {loadError === CLIENT_NETWORK_ERROR ? "无法连接服务，请确认 ai-editor 服务已启动。" : "详情加载失败，请重试。"}
          <Button variant="outline" className="ml-3" type="button" onClick={() => void loadDetail()}>
            重试
          </Button>
        </div>
      )}

      {detail && form && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* 左栏：基础信息表单（name + data 三字段，timeline.md 详情页字段编辑） */}
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
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">时间标签</p>
                <Input
                  value={form.timeLabel}
                  onChange={(e) => setForm((f) => (f ? { ...f, timeLabel: e.target.value } : f))}
                  placeholder="如：第二天黄昏（自由文本，不参与排序）"
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">标签</p>
                <Input
                  value={form.tagsInput}
                  onChange={(e) => setForm((f) => (f ? { ...f, tagsInput: e.target.value } : f))}
                  placeholder="如：主线，战争（逗号/回车分隔）"
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
              <p className="py-6 text-center text-sm text-muted-foreground">暂无关联节点，新增一个</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {occurring.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                    <button
                      type="button"
                      onClick={() => navigate(`/outline/${r.targetId}`)}
                      title="跳转大纲定位"
                      className="min-w-0 flex-1 truncate text-left text-foreground underline-offset-2 hover:text-primary hover:underline"
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

      {/* 软删确认（级联说明；计数在删除后 toast 呈现，与大纲页/实体详情页一致） */}
      {deleteTarget && (
        <ConfirmDialog
          title="移入回收站"
          description={`将《${detail?.name ?? ""}》移入回收站。关联关系与变更记录将一并移入，可在回收站还原。`}
          confirmLabel="移入回收站"
          danger
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(false)}
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
