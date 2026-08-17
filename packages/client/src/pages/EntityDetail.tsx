// 实体详情/编辑页（S3.6；替换 T7.1 占位壳；U8 起「新增关联」用共用 CreateRelationDialog；
//   S5.4 起元信息行「变更记录 N 条」展开「状态预览」区块——POST /delta/compute + conflicts 标注）
// 路由：#/entities/:type/:id；数据：GET /api/v1/entity/:type/:id（含双向 relations + deltaCount）
// 契约：doc/ui/pages/entity-detail.md——data 表单按类型差异化（lib/entity-detail.ts detailFieldsForType）、
//   PUT partial 浅合并（diffData 只提交变更字段）、关系 1 跳双向展示 + 创建对话框（409 RELATION_EXISTS 提示，
//   组件抽至 components/entity/create-relation-dialog.tsx，详情模式 source 固定本实体）、
//   删关系物理删确认（决策 12 修订：轻量可重建）、软删直接执行（H2：不弹确认）+ 级联计数、404 引导
// 边界：custom_fields 仅在响应 data 已有该键时显示（MVP 无法新增键）；「问 AI」入口待 chat store
//   就绪后补（layout.md §3.3 带上下文进聊天）
import { useEffect, useState } from "react";
import { formatTimestamp } from "@whispering233/ai-editor-shared";
import type { EntityType } from "@whispering233/ai-editor-shared";
import { ConfirmDialog } from "../components/outline/dialogs";
import { CreateRelationDialog } from "../components/entity/create-relation-dialog";
import { ParentSettingSelect } from "../components/entity/parent-setting-select";
import { ComputePreview } from "../components/delta/compute-preview";
import { Breadcrumb } from "../components/page-nav/Breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { detailFieldsForType, diffData, relationTypeLabel, settingHierarchyFromRelations, type DetailFieldConfig } from "../lib/entity-detail";
import { flattenTree } from "../lib/outline-tree";
import { cn } from "../lib/utils";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const TYPE_LABEL: Record<EntityType, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  // C1 类型补全（决策 26 event 时间轴事件；时间轴专属 UI 由 C2 实现）
  event: "事件",
  // G2.3 类型补全（G2 时间标签点；泛型详情页可用——仅名称可编辑，data 空）
  timepoint: "时间点",
};

/** 字段值 → 表单字符串（undefined/null → 空串） */
function fieldValue(form: Record<string, unknown>, key: string): string {
  const v = form[key];
  return v === undefined || v === null ? "" : String(v);
}

/** 标签列表编辑器（character.personality/abilities、setting.rules） */
function TagsEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={v}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            className="h-8 flex-1 text-sm"
          />
          <Button
            variant="outline"
            type="button"
            className="h-8 px-2 text-xs"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            删除
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        type="button"
        className="h-8 self-start px-2 text-xs"
        onClick={() => onChange([...values, ""])}
      >
        + 添加
      </Button>
    </div>
  );
}

/** custom_fields 键值组编辑器（仅有值时显示；行内部 state，变更回调给父表单） */
function CustomFieldsEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>(() =>
    Object.entries(value ?? {}).map(([k, v]) => ({ key: k, value: String(v ?? "") })),
  );

  // 外部值变化（重拉详情）时同步
  useEffect(() => {
    setRows(Object.entries(value ?? {}).map(([k, v]) => ({ key: k, value: String(v ?? "") })));
  }, [value]);

  function commit(next: Array<{ key: string; value: string }>) {
    setRows(next);
    const record: Record<string, unknown> = {};
    for (const r of next) {
      if (r.key.trim()) record[r.key.trim()] = r.value;
    }
    onChange(record);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={r.key}
            onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
            placeholder="键"
            className="h-8 w-28 text-sm"
          />
          <Input
            value={r.value}
            onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            placeholder="值"
            className="h-8 flex-1 text-sm"
          />
          <Button
            variant="outline"
            type="button"
            className="h-8 px-2 text-xs"
            onClick={() => commit(rows.filter((_, j) => j !== i))}
          >
            删除
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        type="button"
        className="h-8 self-start px-2 text-xs"
        onClick={() => commit([...rows, { key: "", value: "" }])}
      >
        + 添加字段
      </Button>
    </div>
  );
}

export default function EntityDetail({ type, id }: { type: string; id: string }) {
  const entityType = type as EntityType;

  const [detail, setDetail] = useState<EntityDetailRes | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 表单值（detail.data 副本；null = 未加载） */
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [relationDialogOpen, setRelationDialogOpen] = useState(false);
  const [deleteRelationTarget, setDeleteRelationTarget] = useState<RelationSummaryItem | null>(null);
  /** 「变更记录 N 条」展开状态（S5.4：下方渲染状态预览区块） */
  const [deltaOpen, setDeltaOpen] = useState(false);
  /** 设定层级修改态（决策 30，I3b：修改/清除上级——先建后删，防数据丢失） */
  const [hierarchySaving, setHierarchySaving] = useState(false);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);

  const fields = detailFieldsForType(entityType);

  /** 加载详情（id/type 变化重载；成功重置表单为 data 副本） */
  async function loadDetail() {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const res = await getEntityDetail(entityType, id);
      setDetail(res);
      setForm(JSON.parse(JSON.stringify(res.data)) as Record<string, unknown>);
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
    // 依赖仅 [entityType, id]：loadDetail 每次渲染重建，但页面切换才需重载（项目未启用 exhaustive-deps 检查）
  }, [entityType, id]);

  // 数据变更信号（问题 1）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉详情——
  // 表单以服务端权威为准整体重置（AI 改动的字段随之同步，本地未保存编辑被覆盖属预期语义）
  useDataRefresh(() => void loadDetail());

  /** 保存：diffData 只提交变更字段（partial 浅合并）；成功后重拉（服务端权威） */
  async function handleSave() {
    if (!detail || !form || saving) return;
    const changed = diffData(detail.data, form);
    if (!changed) {
      useUiStore.getState().showToast("没有变更");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateEntity(entityType, id, { data: changed });
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

  /** 设置字段值（tags/select 等通用入口） */
  function setField(key: string, value: unknown) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  /** 软删直接执行（H2：不再弹二次确认）：DELETE → toast（级联计数）→ 跳回列表 */
  async function handleDelete() {
    if (!detail) return;
    try {
      const res = await deleteEntity(entityType, id);
      const parts: string[] = [];
      if (res.cascaded.relations > 0) parts.push(`${res.cascaded.relations} 条关联`);
      if (res.cascaded.deltas > 0) parts.push(`${res.cascaded.deltas} 条变更记录`);
      useUiStore.getState().showToast(
        `已移入回收站，可随时还原${parts.length > 0 ? `（含 ${parts.join("、")}）` : ""}`,
      );
      navigate(`/entities/${entityType}`);
    } catch (err) {
      useUiStore.getState().showToast(
        err instanceof ApiError ? err.message : "删除失败，请重试",
        "error",
      );
    }
  }

  /** 删除关系（物理删，确认后执行） */
  async function handleDeleteRelation() {
    if (!deleteRelationTarget) return;
    try {
      await deleteRelation(deleteRelationTarget.id);
      useUiStore.getState().showToast("已删除关系");
      setDeleteRelationTarget(null);
      await loadDetail();
    } catch (err) {
      throw err;
    }
  }

  /**
   * 修改上级（决策 30，I3b）：先建新边再删旧父边——建失败则旧父保留（防数据丢失）；
   * 新父与当前相同 → 幂等跳过（不重建关系）。服务端防环/自指兜底（400 VALIDATION_ERROR 内联提示）。
   */
  async function handleSetParent(newParentId: string) {
    if (!detail || hierarchySaving) return;
    const current = settingHierarchyFromRelations(detail.relations, id).parent;
    if (newParentId === current?.parentId) return; // 幂等：未变更不重建
    setHierarchySaving(true);
    setHierarchyError(null);
    try {
      await createRelation({
        source_type: "setting",
        source_id: id,
        target_type: "setting",
        target_id: newParentId,
        relation_type: "belongs_to",
      });
      if (current) await deleteRelation(current.relationId); // 先建后删
      useUiStore.getState().showToast(current ? "已修改上级设定" : "已设置上级设定");
      await loadDetail();
    } catch (err) {
      setHierarchyError(err instanceof ApiError ? err.message : "修改上级失败，请重试");
    } finally {
      setHierarchySaving(false);
    }
  }

  /** 清除上级（决策 30）：删除旧父边（物理删，可重新设置） */
  async function handleClearParent() {
    if (!detail || hierarchySaving) return;
    const current = settingHierarchyFromRelations(detail.relations, id).parent;
    if (!current) return;
    setHierarchySaving(true);
    setHierarchyError(null);
    try {
      await deleteRelation(current.relationId);
      useUiStore.getState().showToast("已清除上级设定");
      await loadDetail();
    } catch (err) {
      setHierarchyError(err instanceof ApiError ? err.message : "清除上级失败，请重试");
    } finally {
      setHierarchySaving(false);
    }
  }

  /** 关系行端点名称（本实体端用名称，另一端优先联表名称，缺省 id） */
  function relationEndpointName(r: RelationSummaryItem, side: "source" | "target"): string {
    const isSelf = (side === "source" ? r.sourceId : r.targetId) === id;
    if (isSelf) return detail?.name ?? "本实体";
    return (side === "source" ? r.sourceName : r.targetName) ?? (side === "source" ? r.sourceId : r.targetId);
  }

  // ============ 渲染 ============

  if (notFound) {
    return (
      <section>
        <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-14 text-center">
          <p className="text-sm text-zinc-600">该实体不存在或已被删除</p>
          <div className="mt-4 flex justify-center gap-2">
            <a
              href="#/trash"
              className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
            >
              去回收站
            </a>
            <Button variant="outline" type="button" onClick={() => navigate(`/entities/${entityType}`)}>
              返回列表
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      {/* header：面包屑（实体 › 类型 › 名称，返回列表入口）+ 操作 */}
      <div className="mb-1 flex items-center gap-3">
        <Breadcrumb
          items={[
            { label: "实体", href: "/entities/character" },
            { label: TYPE_LABEL[entityType], href: `/entities/${entityType}` },
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
            className="text-red-600 hover:bg-red-50"
            onClick={() => void handleDelete()}
          >
            移入回收站
          </Button>
        </div>
      </div>
      {/* 元信息行（文字与「变更记录 N 条」入口同用 muted-foreground，双主题一致） */}
      {detail && (
        <p className="mb-4 text-xs text-muted-foreground">
          创建于 {formatTimestamp(detail.createdAt)} · 更新于 {formatTimestamp(detail.updatedAt)} ·{" "}
          <button
            type="button"
            onClick={() => setDeltaOpen((v) => !v)}
            title="展开状态预览：计算该实体在任意大纲节点处的累积状态"
            className="rounded-md border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            变更记录 {detail.deltaCount} 条
          </button>
        </p>
      )}

      {/* 状态预览区块（S5.4：元信息行入口展开；位于表单上方） */}
      {detail && deltaOpen && (
        <ComputePreview type={entityType} id={id} currentData={detail.data} deltaCount={detail.deltaCount} />
      )}

      {/* 加载骨架 */}
      {loading && !detail && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-md border border-zinc-200 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-zinc-100" />
            ))}
          </div>
          <div className="space-y-3 rounded-md border border-zinc-200 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-zinc-100" />
            ))}
          </div>
        </div>
      )}

      {/* 加载失败 */}
      {!loading && !detail && loadError !== null && (
        <div className="rounded-md border border-zinc-200 p-4 text-sm text-zinc-600">
          {loadError === CLIENT_NETWORK_ERROR ? "无法连接服务，请确认 ai-editor 服务已启动。" : "详情加载失败，请重试。"}
          <Button variant="outline" className="ml-3" type="button" onClick={() => void loadDetail()}>
            重试
          </Button>
        </div>
      )}

      {detail && form && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* 左栏：data 表单（按类型差异化渲染） */}
          <div className="rounded-md border border-zinc-200 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-700">基础信息</h2>
            <div className="flex flex-col gap-3">
              {fields.map((f) => (
                <div key={f.key}>
                  <p className="mb-1 text-sm font-medium text-zinc-700">{f.label}</p>
                  <FormField
                    field={f}
                    value={form[f.key]}
                    onChange={(v) => setField(f.key, v)}
                  />
                </div>
              ))}
              {/* custom_fields：响应 data 已有该键时显示（MVP 边界：无键时不可新增，见文件头注释） */}
              {"custom_fields" in detail.data && (
                <div>
                  <p className="mb-1 text-sm font-medium text-zinc-700">自定义字段</p>
                  <CustomFieldsEditor
                    value={form.custom_fields as Record<string, unknown> | undefined}
                    onChange={(v) => setField("custom_fields", v)}
                  />
                </div>
              )}
            </div>
            {saveError && <p className="mt-3 text-sm text-red-600">{saveError}</p>}
          </div>

          {/* 右栏：关联（1 跳双向）——setting 类型前置「层级」区块（决策 30：父子边独自分区，
              下方关联列表过滤掉层级边，避免同一条边两处重复展示） */}
          <div className="rounded-md border border-zinc-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-700">关联</h2>
              <Button
                variant="outline"
                type="button"
                className="h-8 px-2 text-xs"
                onClick={() => setRelationDialogOpen(true)}
              >
                + 新增关联
              </Button>
            </div>

            {/* 层级区块（仅 setting）：父/子分区展示 + 设置/修改/清除上级（决策 30） */}
            {entityType === "setting" &&
              (() => {
                const h = settingHierarchyFromRelations(detail.relations, id);
                return (
                  <div className="mb-4 border-b border-zinc-100 pb-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-700">层级（设定父子）</h3>
                      <div className="flex items-center gap-2">
                        <ParentSettingSelect
                          value={h.parent?.parentId ?? null}
                          valueName={h.parent?.parentName}
                          excludeIds={[id]}
                          onChange={(v) => {
                            if (v) void handleSetParent(v);
                          }}
                          placeholder="设置上级"
                        />
                        {h.parent && (
                          <Button
                            variant="outline"
                            type="button"
                            className="h-8 px-2 text-xs text-red-600 hover:bg-red-50"
                            disabled={hierarchySaving}
                            onClick={() => void handleClearParent()}
                          >
                            清除
                          </Button>
                        )}
                      </div>
                    </div>
                    {hierarchyError && <p className="mb-2 text-sm text-red-600">{hierarchyError}</p>}
                    <div className="flex flex-col gap-1.5 text-sm">
                      <span className="text-zinc-500">
                        上级：
                        {h.parent ? (
                          <button
                            type="button"
                            title="打开上级设定"
                            className="ml-1 rounded-md border border-border px-1.5 py-0.5 text-zinc-700 hover:bg-muted hover:text-foreground"
                            onClick={() => navigate(`/entities/setting/${h.parent!.parentId}`)}
                          >
                            {h.parent.parentName ?? h.parent.parentId}
                          </button>
                        ) : (
                          <span className="ml-1 text-zinc-400">（独立设定——暂无上级）</span>
                        )}
                      </span>
                      <span className="text-zinc-500">
                        子设定：
                        {h.children.length === 0 ? (
                          <span className="ml-1 text-zinc-400">（无）</span>
                        ) : (
                          h.children.map((c) => (
                            <button
                              key={c.relationId}
                              type="button"
                              title="打开子设定"
                              className="ml-1 rounded-md border border-border px-1.5 py-0.5 text-zinc-700 hover:bg-muted hover:text-foreground"
                              onClick={() => navigate(`/entities/setting/${c.childId}`)}
                            >
                              {c.childName ?? c.childId}
                            </button>
                          ))
                        )}
                      </span>
                    </div>
                  </div>
                );
              })()}

            {(() => {
              // 关联列表：setting 类型过滤掉层级边（belongs_to setting→setting）
              const list =
                entityType === "setting"
                  ? detail.relations.filter(
                      (r) => !(r.relationType === "belongs_to" && r.sourceType === "setting" && r.targetType === "setting"),
                    )
                  : detail.relations;
              return list.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-400">
                  {entityType === "setting" ? "暂无其他关联，新增一个" : "暂无关联，新增一个"}
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {list.map((r) => {
                    const isSource = r.sourceId === id;
                    const left = relationEndpointName(r, "source");
                    const right = relationEndpointName(r, "target");
                    return (
                      <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                        <span className="min-w-0 max-w-28 truncate text-zinc-700">{left}</span>
                        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
                          {relationTypeLabel(r.relationType)} {isSource ? "→" : "←"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-zinc-700">{right}</span>
                        <Button
                          variant="outline"
                          type="button"
                          className="h-7 shrink-0 px-2 text-xs text-red-600 hover:bg-red-50"
                          onClick={() => setDeleteRelationTarget(r)}
                        >
                          删除
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </div>
        </div>
      )}

      {/* 新增关联对话框（共用组件，详情模式：源固定为本实体，U8） */}
      {relationDialogOpen && (
        <CreateRelationDialog
          source={{ type: entityType, id, name: detail?.name ?? "" }}
          onCreated={loadDetail}
          onClose={() => setRelationDialogOpen(false)}
        />
      )}

      {/* 删关系确认（物理删，不可恢复） */}
      {deleteRelationTarget && (
        <ConfirmDialog
          title="删除关系"
          description={`删除关系「${relationEndpointName(deleteRelationTarget, "source")} ${relationTypeLabel(deleteRelationTarget.relationType)} ${relationEndpointName(deleteRelationTarget, "target")}」？物理删除不可恢复，可重新建立。`}
          confirmLabel="删除"
          danger
          onConfirm={handleDeleteRelation}
          onClose={() => setDeleteRelationTarget(null)}
        />
      )}

    </section>
  );
}

/** 单个 data 字段控件（text/textarea/number/tags/select/toggle/outline-node） */
function FormField({
  field,
  value,
  onChange,
}: {
  field: DetailFieldConfig;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.control) {
    case "textarea":
      return (
        <textarea
          value={fieldValue({ [field.key]: value }, field.key)}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
        />
      );
    case "number":
      return (
        <Input
          type="number"
          value={fieldValue({ [field.key]: value }, field.key)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className="h-8 text-sm"
        />
      );
    case "tags":
      return (
        <TagsEditor
          values={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          placeholder="输入后回车添加下一项"
        />
      );
    case "select":
      return (
        <select
          value={fieldValue({ [field.key]: value }, field.key)}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
        >
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
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-zinc-900"
        />
      );
    case "outline-node":
      return <OutlineNodeSelect value={fieldValue({ [field.key]: value }, field.key)} onChange={onChange} />;
    default:
      return (
        <Input
          value={fieldValue({ [field.key]: value }, field.key)}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm"
        />
      );
  }
}

/** 大纲节点选择器（hook.expected_resolve_node_id；选项来自 outline store 的树）。
 * 清空（「未设置」）→ onChange(null)：服务端 schema 为 z.string().nullable()，「未设置」应存 null
 * 而非空串（决策 21 健康指标按 null 判定），见 lib/entity-detail.ts diffData 的 null 透传语义 */
function OutlineNodeSelect({ value, onChange }: { value: string; onChange: (v: string | null) => void }) {
  const outline = useProjectStore((s) => s.outline);
  const options = flattenTree(outline?.children ?? []);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className={cn(
        "w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400",
        value === "" && "text-zinc-400",
      )}
    >
      <option value="">未设置</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {"　".repeat(o.depth)}
          {o.label}
        </option>
      ))}
    </select>
  );
}
