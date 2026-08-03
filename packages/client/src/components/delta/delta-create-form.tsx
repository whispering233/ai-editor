// 变更记录创建表单（S12.3；契约 doc/ui/pages/outline.md「变更记录 · 新建变更」+ endpoints.md L395-434）
// 数据：POST /api/v1/delta（createDelta）——node_id = 当前节点，目标/字段/op/值/描述由作者填写；
//   目标实体列表 GET /entity/:type；目标实体详情 GET /entity/:type/:id（update 自动取 from）
// 交互：内联展开（就地为主不弹窗）；目标类型默认「大纲节点」、目标默认当前节点；字段下拉按目标类型
//   （实体 = ENTITY_DATA_SCHEMAS keys、节点 = 决策 23 字段集）；op 推断纯函数（数组 add/remove、
//   标量 set/update——update 的 from 自动取目标当前 data 值并标注「旧值：xxx」，作者无需手填；
//   data 后续被改 → compute 时跳过 + conflicts 标注，决策 9 修订机制兜底）；值/描述必填校验；
//   成功 → onCreated（父刷新列表 + 收起）；VALIDATION_ERROR → 行内提示；OUTLINE_NODE_NOT_FOUND → toast + 收起
// 样式 token 类（layout.md §3，oracle 红线：禁止硬编码色类）
import { useEffect, useState } from "react";
import type { DeltaOp, EntitySummary, EntityType } from "@ai-editor/shared";
import { ApiError, CLIENT_NETWORK_ERROR, createDelta, getEntityDetail, listEntities } from "../../lib/api";
import {
  DELTA_TARGET_TYPE_OPTIONS,
  buildDeltaChange,
  entityDeltaFieldOptions,
  inferOpOptions,
  isArrayField,
  isNumericField,
  nodeDeltaFieldOptions,
} from "../../lib/delta-create";
import { formatDeltaValue, targetTypeLabel } from "../../lib/delta";
import { findNode, flattenTree } from "../../lib/outline-tree";
import { cn } from "../../lib/utils";
import { useProjectStore } from "../../stores/project";
import { useUiStore } from "../../stores/ui";
import { Button } from "@/components/ui/button";

/** 表单控件通用样式（仿 OutlineDetail FIELD_CLASS：token 类 select/textarea/Input） */
const FIELD_CLASS =
  "w-full rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** op → 中文标签（操作选择器；与 lib/delta DELTA_OP_LABEL 语义一致，此处仅表单选项用） */
const OP_OPTION_LABEL: Record<DeltaOp, string> = {
  set: "设为",
  update: "更新",
  add: "追加",
  remove: "移除",
};

export function DeltaCreateForm({
  nodeId,
  onCreated,
  onClose,
}: {
  /** 触发节点（node_id 固定 = 当前详情节点） */
  nodeId: string;
  /** 创建成功回调（父：刷新变更记录列表 + 收起表单） */
  onCreated: () => void;
  onClose: () => void;
}) {
  const outline = useProjectStore((s) => s.outline);

  // ============ 表单草稿状态 ============
  /** 目标类型（默认大纲节点——最常见的「本节点触发了什么变化」场景） */
  const [targetType, setTargetType] = useState<string>("outline_node");
  /** 目标 id（outline_node 默认当前节点；实体待选） */
  const [targetId, setTargetId] = useState<string>(nodeId);
  const [field, setField] = useState("");
  const [op, setOp] = useState<DeltaOp>("add");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ============ 目标实体列表 / 详情 data（update 自动 from） ============
  const [entityList, setEntityList] = useState<EntitySummary[] | null>(null);
  const [entityListError, setEntityListError] = useState<string | null>(null);
  const [entityListTick, setEntityListTick] = useState(0);
  const [targetData, setTargetData] = useState<Record<string, unknown> | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  // 目标类型切换：outline_node → 目标重置为当前节点；实体 → 清空目标等待选择 + 拉列表
  useEffect(() => {
    if (targetType === "outline_node") {
      setTargetId(nodeId);
      setEntityList(null);
      setEntityListError(null);
      setTargetData(null);
      setDataError(null);
      return;
    }
    setTargetId("");
    setTargetData(null);
    setDataError(null);
    let cancelled = false;
    setEntityList(null);
    setEntityListError(null);
    listEntities(targetType as EntityType)
      .then((res) => {
        if (!cancelled) setEntityList(res.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setEntityList(null);
          setEntityListError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [targetType, nodeId, entityListTick]);

  // 目标实体详情（op=update 的 from 数据源）；目标变更时重拉
  useEffect(() => {
    if (targetType === "outline_node" || targetId === "") return;
    let cancelled = false;
    setTargetData(null);
    setDataError(null);
    getEntityDetail(targetType as EntityType, targetId)
      .then((res) => {
        if (!cancelled) setTargetData(res.data);
      })
      .catch((err) => {
        if (!cancelled) {
          setTargetData(null);
          setDataError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [targetType, targetId]);

  // 目标切换 → 重置字段/值/提交错误（防止跨目标沿用旧字段语义与旧值）
  useEffect(() => {
    setField("");
    setValue("");
    setSubmitError(null);
  }, [targetType, targetId]);

  // ============ 派生值（字段选项 / 当前值 / op 可用集） ============

  const targetNode = targetType === "outline_node" && targetId !== "" ? findNode(outline?.children ?? [], targetId) : null;
  /** 字段下拉项（实体按类型 schema keys；节点按选中节点层级字段，节点缺失 → 并集兜底） */
  const fieldOptions =
    targetType === "outline_node" ? nodeDeltaFieldOptions(targetNode?.type ?? null) : entityDeltaFieldOptions(targetType);
  /** 字段作用域（isArrayField/isNumericField 查表用） */
  const fieldScope = targetType === "outline_node" ? (targetNode?.type ?? "scene") : targetType;
  /** 目标当前值（update from 来源：实体 → 详情 data；节点 → 树中 node.data） */
  const currentValue = targetType === "outline_node" ? targetNode?.data?.[field] : targetData?.[field];
  /** 当前字段的 op 可用集（数组 add/remove、标量 update/set 或仅 set） */
  const opInfo = inferOpOptions({ array: isArrayField(fieldScope, field), currentValue });

  /** 字段切换 → 按推断重置 op（作者随后可手动切换）；currentValue 须取新字段的目标当前值（闭包内是旧字段） */
  function handleFieldChange(next: string) {
    setField(next);
    const nextValue = targetType === "outline_node" ? targetNode?.data?.[next] : targetData?.[next];
    setOp(inferOpOptions({ array: isArrayField(fieldScope, next), currentValue: nextValue }).default);
  }

  // ============ 提交 ============

  async function handleSubmit() {
    if (submitting) return;
    if (targetId === "") {
      setSubmitError("请选择变更目标");
      return;
    }
    if (field === "") {
      setSubmitError("请选择变更字段");
      return;
    }
    const desc = description.trim();
    if (desc === "") {
      setSubmitError("请填写描述（本节点触发了什么变化）");
      return;
    }
    const built = buildDeltaChange({ field, op, rawValue: value, numeric: isNumericField(fieldScope, field), currentValue });
    if ("error" in built) {
      setSubmitError(built.error);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createDelta({
        node_id: nodeId,
        target_type: targetType,
        target_id: targetId,
        changes: [built.change],
        description: desc,
      });
      useUiStore.getState().showToast("已记录变更");
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.code === "OUTLINE_NODE_NOT_FOUND") {
        // 节点已被 purge：记录无意义 → toast + 收起（父页面将随树刷新进入 404 态）
        useUiStore.getState().showToast("节点不存在（可能已被删除），无法记录变更", "error");
        onClose();
        return;
      }
      setSubmitError(err instanceof ApiError ? err.message : "提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  // ============ 渲染 ============

  const entityType = targetType as EntityType;
  const isEntity = targetType !== "outline_node";

  return (
    <div className="mb-3 space-y-3 rounded-md border border-border bg-muted/40 p-3">
      {/* ① 目标：类型 + 实体/节点选择 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">目标类型</p>
          <select value={targetType} onChange={(e) => setTargetType(e.target.value)} className={FIELD_CLASS} aria-label="目标类型">
            {DELTA_TARGET_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">目标</p>
          {isEntity ? (
            entityListError !== null ? (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <span>
                  {entityListError === CLIENT_NETWORK_ERROR
                    ? "无法连接服务，请确认 ai-editor 服务已启动"
                    : "实体列表加载失败"}
                </span>
                <Button variant="outline" size="xs" type="button" onClick={() => setEntityListTick((t) => t + 1)}>
                  重试
                </Button>
              </div>
            ) : entityList === null ? (
              <p className="py-1 text-xs text-muted-foreground">加载中…</p>
            ) : entityList.length === 0 ? (
              <p className="py-1 text-xs text-muted-foreground">暂无{targetTypeLabelOf(entityType)}</p>
            ) : (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className={cn(FIELD_CLASS, targetId === "" && "text-muted-foreground")}
                aria-label="目标实体"
              >
                <option value="">请选择{targetTypeLabelOf(entityType)}</option>
                {entityList.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            )
          ) : (
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className={FIELD_CLASS}
              aria-label="目标大纲节点"
            >
              {flattenTree(outline?.children ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {"　".repeat(o.depth)}
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ② 字段 + 操作 + 值 */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">字段</p>
          <select
            value={field}
            onChange={(e) => handleFieldChange(e.target.value)}
            className={cn(FIELD_CLASS, field === "" && "text-muted-foreground")}
            aria-label="变更字段"
          >
            <option value="">请选择字段</option>
            {fieldOptions.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">操作</p>
          <select
            value={op}
            onChange={(e) => setOp(e.target.value as DeltaOp)}
            className={cn(FIELD_CLASS, "min-w-20")}
            aria-label="操作"
          >
            {opInfo.options.map((o) => (
              <option key={o} value={o}>
                {OP_OPTION_LABEL[o]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">
            {op === "set" || op === "update" ? "新值" : op === "add" ? "追加值" : "移除值"}
          </p>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={op === "remove" ? "按值匹配删除" : ""}
            className={FIELD_CLASS}
          />
        </div>
      </div>

      {/* ③ update 的 from 自动取值标注（决策 9 修订：作者无需手填旧值；data 后续被改 → compute 冲突标注兜底） */}
      {op === "update" && (
        <p className="text-xs text-muted-foreground">
          {dataError !== null ? (
            <>
              目标数据获取失败，无法自动取旧值（
              {dataError === "ENTITY_NOT_FOUND" ? "目标已不存在" : "请稍后重试"}
              ）——可将操作改为「设为」
            </>
          ) : (
            <>
              旧值：{formatDeltaValue(currentValue)}（自动取自目标当前数据，无需手填）
            </>
          )}
        </p>
      )}

      {/* ④ 描述 */}
      <div>
        <p className="mb-1 text-xs font-medium text-foreground">描述</p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="本节点触发了什么变化，如：张三获得断剑认可"
          className={cn(FIELD_CLASS, "resize-none")}
        />
      </div>

      {/* ⑤ 提交区 */}
      {submitError !== null && <p className="text-sm text-destructive">{submitError}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={submitting}>
          取消
        </Button>
        <Button size="sm" type="button" onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? "提交中…" : "创建变更"}
        </Button>
      </div>
    </div>
  );
}

/** 实体类型 → 中文（目标选择占位/空态文案；复用 lib/delta targetTypeLabel） */
function targetTypeLabelOf(t: EntityType): string {
  return targetTypeLabel(t);
}
