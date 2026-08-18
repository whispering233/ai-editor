// 变更记录创建表单（S12.3；S13.3 收紧：变更目标仅实体类型——「大纲节点」选项已移除，目标类型默认空需选择）
// 契约 doc/ui/pages/outline.md「变更记录 · 新建变更」+ endpoints.md L395-434
// 数据：POST /api/v1/delta（createDelta）——node_id = 当前节点，目标/字段/op/值/描述由作者填写；
//   目标实体列表 GET /entity/:type；目标实体详情 GET /entity/:type/:id（update 自动取 from）
// 交互：内联展开（就地为主不弹窗）；目标类型默认空（占位「请选择目标类型」，用户确认选择——S13.3）；
//   字段下拉按目标实体类型 = ENTITY_DATA_SCHEMAS keys；op 推断纯函数（数组 add/remove、
//   标量 set/update——update 的 from 自动取目标当前 data 值并标注「旧值：xxx」，作者无需手填；
//   data 后续被改 → compute 时跳过 + conflicts 标注，决策 9 修订机制兜底）；值/描述必填校验；
//   成功 → onCreated（父刷新列表 + 收起）；VALIDATION_ERROR → 行内提示；OUTLINE_NODE_NOT_FOUND → toast + 收起
// 样式 token 类（layout.md §3，oracle 红线：禁止硬编码色类）
import { useEffect, useState } from "react";
import type { DeltaOp, EntitySummary, EntityType } from "@whispering233/ai-editor-shared";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  createDelta,
  getEntityDetail,
  listEntities,
} from "../../lib/api";
import {
  DELTA_TARGET_TYPE_OPTIONS,
  buildDeltaChange,
  entityDeltaFieldOptions,
  inferOpOptions,
  isArrayField,
  isNumericField,
} from "../../lib/delta-create";
import { formatDeltaValue, targetTypeLabel } from "../../lib/delta";
import { cn } from "../../lib/utils";
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
  // ============ 表单草稿状态 ============
  /** 目标类型（S13.3 收紧：默认空——用户确认选择实体类型；大纲节点不再可选） */
  const [targetType, setTargetType] = useState<string>("");
  /** 目标实体 id（待选） */
  const [targetId, setTargetId] = useState<string>("");
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

  // 目标类型切换：重置目标等待选择 + 拉该类型实体列表（S13.3 起仅实体类型）
  useEffect(() => {
    setTargetId("");
    setTargetData(null);
    setDataError(null);
    if (targetType === "") {
      setEntityList(null);
      setEntityListError(null);
      return;
    }
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
  }, [targetType, entityListTick]);

  // 目标实体详情（op=update 的 from 数据源）；目标变更时重拉
  useEffect(() => {
    if (targetType === "" || targetId === "") return;
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

  /** 字段下拉项（实体按类型 schema keys——S13.3 起仅实体目标） */
  const fieldOptions = entityDeltaFieldOptions(targetType);
  /** 目标当前值（update from 来源：实体详情 data） */
  const currentValue = targetData?.[field];
  /** 当前字段的 op 可用集（数组 add/remove、标量 update/set 或仅 set） */
  const opInfo = inferOpOptions({ array: isArrayField(targetType, field), currentValue });

  /** 字段切换 → 按推断重置 op（作者随后可手动切换）；currentValue 须取新字段的目标当前值（闭包内是旧字段） */
  function handleFieldChange(next: string) {
    setField(next);
    setOp(
      inferOpOptions({ array: isArrayField(targetType, next), currentValue: targetData?.[next] })
        .default,
    );
  }

  // ============ 提交 ============

  async function handleSubmit() {
    if (submitting) return;
    if (targetType === "" || targetId === "") {
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
    const built = buildDeltaChange({
      field,
      op,
      rawValue: value,
      numeric: isNumericField(targetType, field),
      currentValue,
    });
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

  // S13.3：targetType 仅四类实体（默认 "" 未选态）；cast 到 EntityType 仅在非空分支使用
  //（targetId 守卫/字段选项均以空串短路），运行时安全——渲染分支才做实体化处理
  const entityType = targetType as EntityType;

  return (
    <div className="mb-3 space-y-3 rounded-md border border-border bg-muted/40 p-3">
      {/* ① 目标：类型 + 实体选择（S13.3 收紧：仅实体类型，无默认——用户先选类型） */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">目标类型</p>
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            className={cn(FIELD_CLASS, targetType === "" && "text-muted-foreground")}
            aria-label="目标类型"
          >
            <option value="">请选择目标类型</option>
            {DELTA_TARGET_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">目标</p>
          {targetType === "" ? (
            <p className="py-1 text-xs text-muted-foreground">请先选择目标类型</p>
          ) : entityListError !== null ? (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <span>
                {entityListError === CLIENT_NETWORK_ERROR
                  ? "无法连接服务，请确认 ai-editor 服务已启动"
                  : "实体列表加载失败"}
              </span>
              <Button
                variant="outline"
                size="xs"
                type="button"
                onClick={() => setEntityListTick((t) => t + 1)}
              >
                重试
              </Button>
            </div>
          ) : entityList === null ? (
            <p className="py-1 text-xs text-muted-foreground">加载中…</p>
          ) : entityList.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">
              暂无{targetTypeLabelOf(entityType)}
            </p>
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
            autoComplete="off"
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
            <>旧值：{formatDeltaValue(currentValue)}（自动取自目标当前数据，无需手填）</>
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
        <Button variant="outline" size="sm" type="button" onClick={onClose} disabled={submitting}>
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
