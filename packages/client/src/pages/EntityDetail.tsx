// 实体详情/编辑页（S3.6；替换 T7.1 占位壳）
// 路由：#/entities/:type/:id；数据：GET /api/v1/entity/:type/:id（含双向 relations + deltaCount）
// 契约：doc/ui/pages/entity-detail.md——data 表单按类型差异化（lib/entity-detail.ts detailFieldsForType）、
//   PUT partial 浅合并（diffData 只提交变更字段）、关系 1 跳双向展示 + 创建对话框（409 RELATION_EXISTS 提示）、
//   删关系物理删确认（决策 12 修订：轻量可重建）、软删确认 + 级联计数、404 引导
// 边界：custom_fields 仅在响应 data 已有该键时显示（MVP 无法新增键）；「问 AI」入口待 chat store
//   就绪后补（layout.md §3.3 带上下文进聊天）；Delta 明细无 REST 端点（原型注释），deltaCount 仅数字
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { RELATION_TYPES } from "@ai-editor/shared";
import { formatTimestamp } from "@ai-editor/shared";
import type { EntitySummary, EntityType } from "@ai-editor/shared";
import { ConfirmDialog } from "../components/outline/dialogs";
import { Breadcrumb } from "../components/page-nav/Breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  createRelation,
  deleteEntity,
  deleteRelation,
  getEntityDetail,
  listEntities,
  updateEntity,
  type CreateRelationBody,
  type EntityDetailRes,
  type RelationSummaryItem,
} from "../lib/api";
import { detailFieldsForType, diffData, relationTypeLabel, type DetailFieldConfig } from "../lib/entity-detail";
import { flattenTree } from "../lib/outline-tree";
import { cn } from "../lib/utils";
import { navigate } from "../hooks/use-route";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const TYPE_LABEL: Record<EntityType, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
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

/** 新增关联对话框：另一端类型（实体四类或大纲节点）+ id 选择 + 关系类型下拉 */
function CreateRelationDialog({
  entityType,
  entityId,
  onCreated,
  onClose,
}: {
  entityType: EntityType;
  entityId: string;
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const outline = useProjectStore((s) => s.outline);
  /** 另一端类型（"outline_node" = 大纲节点，schema.md relation_records 端点类型） */
  const [otherType, setOtherType] = useState<EntityType | "outline_node">("character");
  const [otherEntities, setOtherEntities] = useState<EntitySummary[] | null>(null);
  const [otherId, setOtherId] = useState("");
  const [relationType, setRelationType] = useState<string>(RELATION_TYPES[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 另一端类型变化 → 拉实体列表（大纲节点用 outline store 的树，无需请求）
  useEffect(() => {
    setOtherId("");
    if (otherType === "outline_node") {
      setOtherEntities(null);
      return;
    }
    setOtherEntities(null);
    listEntities(otherType, { limit: 100 })
      .then((res) => setOtherEntities(res.items))
      .catch(() => setOtherEntities([]));
  }, [otherType]);

  const outlineOptions = flattenTree(outline?.children ?? []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!otherId) {
      setError("请选择关联对象");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateRelationBody = {
        source_type: entityType,
        source_id: entityId,
        target_type: otherType,
        target_id: otherId,
        relation_type: relationType,
      };
      await createRelation(body);
      useUiStore.getState().showToast("已建立关系");
      await onCreated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "RELATION_EXISTS") {
        setError("这条关系已经存在");
      } else {
        setError(err instanceof ApiError ? err.message : "创建失败，请重试");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增关联</DialogTitle>
        </DialogHeader>
        <form id="create-relation-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700">关联对象类型</p>
          <select
            value={otherType}
            onChange={(e) => setOtherType(e.target.value as EntityType | "outline_node")}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            <option value="character">人物</option>
            <option value="setting">设定</option>
            <option value="location">地点</option>
            <option value="hook">伏笔</option>
            <option value="outline_node">大纲节点</option>
          </select>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700">关联对象</p>
          {otherType === "outline_node" ? (
            <select
              value={otherId}
              onChange={(e) => setOtherId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              <option value="">选择大纲节点…</option>
              {outlineOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {"　".repeat(o.depth)}
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={otherId}
              onChange={(e) => setOtherId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              <option value="">选择{TYPE_LABEL[otherType]}…</option>
              {(otherEntities ?? []).map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700">关系类型</p>
          <select
            value={relationType}
            onChange={(e) => setRelationType(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            {RELATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {relationTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-zinc-400">方向：本实体 → 关联对象</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="create-relation-form" disabled={submitting}>
            建立
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [deleteTarget, setDeleteTarget] = useState(false);

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

  /** 软删确认后执行：DELETE → toast（级联计数）→ 跳回列表 */
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
      setDeleteTarget(false);
      navigate(`/entities/${entityType}`);
    } catch (err) {
      throw err; // 冒泡给 ConfirmDialog 内联显示
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
            onClick={() => setDeleteTarget(true)}
          >
            移入回收站
          </Button>
        </div>
      </div>
      {/* 元信息行 */}
      {detail && (
        <p className="mb-4 text-xs text-zinc-400">
          创建于 {formatTimestamp(detail.createdAt)} · 更新于 {formatTimestamp(detail.updatedAt)} ·{" "}
          <span title="MVP 无按实体查 Delta 明细的 REST 端点；查看状态变化请在大纲中按节点查看，或在聊天中让 AI 计算">
            变更记录 {detail.deltaCount} 条
          </span>
        </p>
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

          {/* 右栏：关联（1 跳双向） */}
          <div className="rounded-md border border-zinc-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-700">关联（1 跳）</h2>
              <Button
                variant="outline"
                type="button"
                className="h-8 px-2 text-xs"
                onClick={() => setRelationDialogOpen(true)}
              >
                + 新增关联
              </Button>
            </div>
            {detail.relations.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-400">暂无关联，新增一个</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {detail.relations.map((r) => {
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
            )}
          </div>
        </div>
      )}

      {/* 新增关联对话框 */}
      {relationDialogOpen && (
        <CreateRelationDialog
          entityType={entityType}
          entityId={id}
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

      {/* 软删确认（级联说明；计数在删除后 toast 呈现，与大纲页一致） */}
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
