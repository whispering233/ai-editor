// 人物详情（卡 3.2）：双视图 tab（初始化数据 / 当前位置数据）——替换工作台右栏原来的泛型 `EntityDetail`。
// 卡 3.3：字段三分渲染（「基础信息」不可变 + 姓名入力 / 「可变数据」可变 + 能力面板宿主位）、`description` 必填
//   （仅前端）+ `current_position` 失效回落与「配置未加载不误判」三态判据。
// 契约：`docs/ui/DESIGN.md` §数据展示 `character-workbench`（页头壳保持 + tab 行 + 只读语义 + 两分区）与 `tabs`
//   （antd line 型；页内 tab **不进 URL**，刷新回落默认 tab；有 tab 的页面页头传 `divider={false}`——
//   tab 条自带 1px hairline 底线即分割线，与设置页同款）；
//   `docs/design/10-data-model.md` §14：不变式 1（不可变字段不参与 Delta、人工可编辑）、
//   不变式 2（不可变字段两视图必然相同）、不变式 3（**只有「初始化数据」可编辑**、
//   「当前位置数据」= `computeState(at_node = current_position)`、**只读**）；
//   `docs/db/schema.md`「人物 data 分层」（字段归属 + `description` 必填仅前端校验）。
// 页头：复用 `PageHeader` 壳（标题 + 保存/移入回收站 + 元信息行）；**取消**元信息行「变更记录 N 条」按钮
//   （入口被 tab 2 吸收——状态预览不再需要手动展开）。
// 只读语义：tab 2 的输入控件全部 `disabled`（**不隐藏**——字段位置稳定才好对比）+ 区首 caption「由变更记录累积，只读」。
// 关系区块：本卡保持既有能力（1 跳双向列表 + 新建关联 + 物理删），形态暂为通用卡片；
//   卡 3.6 重构为「人物关系网（人↔人）+ 其他关联（折叠区）」——届时本区块被替换。
// 数据：GET /entity/character/:id（含 relations + deltaCount）、PUT partial（diffData 只提交变更字段 + 姓名）、
//   DELETE（软删 + 级联计数 → 跳 `#/characters`）、POST /delta/compute（tab 2 自动计算）、POST/DELETE /relation。
import { useEffect, useMemo, useRef, useState } from "react";
import { HolderOutlined } from "@ant-design/icons";
import { formatTimestamp, panelLeafPaths } from "@whispering233/ai-editor-shared";
import type { ComputeStateResult } from "@whispering233/ai-editor-shared";
import { Button, Input, Select, Tabs } from "antd";
import type { InputRef } from "antd";
import { ComputeResult } from "../delta/compute-preview";
import { CreateRelationDialog } from "../entity/create-relation-dialog";
import { ConfirmDialog } from "../outline/dialogs";
import { EmptyState } from "../ui/empty-state";
import { PageHeader } from "../ui/page-header";
import { SectionCard } from "../ui/section-card";
import { navigate } from "../../hooks/use-route";
import { useDataRefresh } from "../../hooks/use-data-refresh";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  computeDeltaState,
  deleteEntity,
  deleteRelation,
  getEntityDetail,
  updateEntity,
  type EntityDetailRes,
  type RelationSummaryItem,
} from "../../lib/api";
import {
  characterFieldGroups,
  hasCharacterBasicsErrors,
  resolveCurrentAtNode,
  resolveTabState,
  readOnlyFieldValue,
  validateCharacterBasics,
  type CharacterBasicsErrors,
  type CharacterPositionState,
  type CharacterViewTab,
} from "../../lib/character-detail";
import { diffData, relationTypeLabel, type DetailFieldConfig } from "../../lib/entity-detail";
import { entityListPath } from "../../lib/entity-paths";
import { flattenTree, type FlatNodeOption } from "../../lib/outline-tree";
import { useSaveShortcut } from "../../lib/save-shortcut";
import { enterBehavior, moveArrayItem } from "../../lib/tags-editor";
import { useProjectStore } from "../../stores/project";
import { useUiStore } from "../../stores/ui";
import { cn } from "../../lib/utils";
import { skeletonClass } from "../../lib/styles";

const ENTITY_TYPE = "character";
const LIST_ROUTE = entityListPath("character");

/** 字段值 → 表单字符串（undefined/null → 空串；与 `EntityDetail` 同语义） */
function fieldValue(raw: unknown): string {
  return raw === undefined || raw === null ? "" : String(raw);
}

/** 关系行端点名称（本实体端用本实体名，另一端优先联表名称，缺省 id） */
function relationEndpointName(
  relation: RelationSummaryItem,
  side: "source" | "target",
  selfName: string,
  selfId: string,
): string {
  const isSelf = (side === "source" ? relation.sourceId : relation.targetId) === selfId;
  if (isSelf) return selfName;
  return (
    (side === "source" ? relation.sourceName : relation.targetName) ??
    (side === "source" ? relation.sourceId : relation.targetId)
  );
}

/**
 * 标签列表编辑器（人物 `personality`）：拖拽排序 + 回车续行，交互语义与 `EntityDetail` 的私有实现一致
 * （本卡不复用泛型详情页的私有组件，见文件头注释——人物页与其持续分化）。
 * `disabled` = tab 2 只读态：输入与增删全部禁用（结构不变，位置稳定）。
 */
function TagsEditor({
  values,
  onChange,
  disabled,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const inputRefs = useRef<Array<InputRef | null>>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      {values.map((v, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-0.5 py-0.5 transition-colors",
            dragIndex === i && "opacity-40",
            dragOverIndex === i &&
              dragIndex !== null &&
              dragIndex !== i &&
              "bg-muted/60 ring-1 ring-ring",
          )}
          onDragOver={(e) => {
            if (dragIndex === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragOverIndex !== i) setDragOverIndex(i);
          }}
          onDrop={(e) => {
            if (dragIndex === null) return;
            e.preventDefault();
            if (dragIndex !== i) onChange(moveArrayItem(values, dragIndex, i));
            setDragIndex(null);
            setDragOverIndex(null);
          }}
        >
          <span className="flex shrink-0 cursor-grab active:cursor-grabbing">
            <Button
              color="default"
              variant="text"
              size="small"
              draggable={!disabled}
              disabled={disabled}
              title="拖拽排序"
              aria-label="拖拽排序"
              onDragStart={(e) => {
                if (disabled) return;
                setDragIndex(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              icon={<HolderOutlined className="text-base" />}
            />
          </span>
          <Input
            value={v}
            disabled={disabled}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const b = enterBehavior(values, i);
              if (!b) return;
              if (b.append) onChange([...values, ""]);
              requestAnimationFrame(() => inputRefs.current[b.focusIndex]?.focus());
            }}
            placeholder={placeholder}
            className="flex-1"
          />
          <Button disabled={disabled} onClick={() => onChange(values.filter((_, j) => j !== i))}>
            删除
          </Button>
        </div>
      ))}
      <Button className="self-start" disabled={disabled} onClick={() => onChange([...values, ""])}>
        + 添加
      </Button>
    </div>
  );
}

/** custom_fields 键值组编辑器（**仅有值时显示**——MVP 无法新增键，见 `EntityDetail` 同款边界） */
function CustomFieldsEditor({
  value,
  onChange,
  disabled,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>(() =>
    Object.entries(value ?? {}).map(([k, v]) => ({ key: k, value: String(v ?? "") })),
  );

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
          <div className="w-28">
            <Input
              value={r.key}
              disabled={disabled}
              onChange={(e) =>
                commit(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
              }
              placeholder="键"
            />
          </div>
          <Input
            value={r.value}
            disabled={disabled}
            onChange={(e) =>
              commit(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
            }
            placeholder="值"
            className="flex-1"
          />
          <Button disabled={disabled} onClick={() => commit(rows.filter((_, j) => j !== i))}>
            删除
          </Button>
        </div>
      ))}
      <Button
        className="self-start"
        disabled={disabled}
        onClick={() => commit([...rows, { key: "", value: "" }])}
      >
        + 添加字段
      </Button>
    </div>
  );
}

/** 单个字段控件（人物字段集：text/textarea/number/tags；`disabled` = tab 2 只读态） */
function FieldControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: DetailFieldConfig;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  switch (field.control) {
    case "textarea":
      return (
        <Input.TextArea
          value={fieldValue(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          value={fieldValue(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "tags":
      return (
        <TagsEditor
          values={Array.isArray(value) ? (value as string[]) : []}
          disabled={disabled}
          onChange={onChange}
          placeholder="输入后回车添加下一项"
        />
      );
    default:
      return (
        <Input
          value={fieldValue(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/**
 * 人物字段表单（两个 tab 共用同一字段集与控件形态——只读态靠 `disabled` 而非换渲染，字段位置才稳定）。
 * 字段集 = `detailFieldsForType("character")`（三分分区属卡 3.3；能力面板 `panel-tree` 属卡 3.4）。
 */
export function CharacterFieldsForm({
  fields,
  values,
  onChange,
  disabled,
  fieldErrors,
}: {
  fields: readonly DetailFieldConfig[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
 /** 字段级内联错误（键 → 文案；仅基础信息必填判据用，缺省无错误） */
  fieldErrors?: Partial<Record<string, string | null>>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {fields.map((f) => {
        const error = fieldErrors?.[f.key] ?? null;
        return (
          <div key={f.key}>
            <p className="mb-1 text-sm font-medium text-foreground">{f.label}</p>
            <FieldControl
              field={f}
              value={values[f.key]}
              disabled={disabled}
              onChange={(v) => onChange(f.key, v)}
            />
            {error !== null && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 能力面板宿主区块（卡片 3.3 预留挂载位；结构编辑控件属卡片 3.4）。
 * 本卡只做只读呈现（叶子点分路径 + 值）——面板是可变数据，两个 tab 都会显示，
 * tab 2 展示的是 `computeState` 累积后的叶子值（叶子路径口径见 shared `abilityPanelFieldPath`）。
 */
function CharacterPanelHost({ panel }: { panel: unknown }) {
  const leaves = panelLeafPaths(panel);
  return (
    <section className="mt-4 border-t border-border pt-3">
      <p className="mb-1 text-sm font-medium text-foreground">能力面板</p>
      {leaves.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无面板字段</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {leaves.map((leaf) => (
            <li key={leaf.path} className="flex items-baseline gap-2 text-sm">
              <span className="shrink-0 text-muted-foreground">{leaf.path}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {readOnlyFieldValue(leaf.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 人物字段两分区（**两个 tab 共用同一分区结构**——只读态靠 `disabled` 而非另一套渲染，字段位置才稳定）：
 * 「基础信息」（姓名 / 角色定位 / 描述，不可变）+「可变数据」（假名 / 性别 / 年龄 / 种族 / 动机 / 性格
 * + 能力面板宿主 + 已有 `custom_fields`）。
 */
function CharacterSections({
  name,
  onNameChange,
  values,
  onFieldChange,
  disabled,
  basicsErrors,
  showCustomFields,
}: {
 /** 姓名（`entities.name` 列，不是 data 字段；不可变但人工可编辑） */
  name: string;
  onNameChange: (v: string) => void;
  values: Record<string, unknown>;
  onFieldChange: (key: string, value: unknown) => void;
  disabled?: boolean;
 /** 基础信息必填判据（仅 tab 1 传入；tab 2 只读不校验） */
  basicsErrors?: CharacterBasicsErrors;
 /** `custom_fields` 仅在响应 data 已有该键时显示（MVP 边界：无键不可新增，同泛型详情页） */
  showCustomFields: boolean;
}) {
  const [basics, mutable] = characterFieldGroups();
  return (
    <div className="flex flex-col gap-4">
      <SectionCard title={basics.title}>
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-sm font-medium text-foreground">姓名</p>
            <Input
              value={name}
              disabled={disabled}
              onChange={(e) => onNameChange(e.target.value)}
            />
            {basicsErrors?.name != null && (
              <p className="mt-1 text-xs text-destructive">{basicsErrors.name}</p>
            )}
          </div>
          <CharacterFieldsForm
            fields={basics.fields}
            values={values}
            onChange={onFieldChange}
            disabled={disabled}
            fieldErrors={{ description: basicsErrors?.description ?? null }}
          />
        </div>
      </SectionCard>

      <SectionCard title={mutable.title}>
        <CharacterFieldsForm
          fields={mutable.fields}
          values={values}
          onChange={onFieldChange}
          disabled={disabled}
        />
        <CharacterPanelHost panel={values.ability_panel} />
        {showCustomFields && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1 text-sm font-medium text-foreground">自定义字段</p>
            {disabled ? (
              <div className="flex flex-col gap-1 text-sm">
                {Object.entries((values.custom_fields ?? {}) as Record<string, unknown>).map(
                  ([k, v]) => (
                    <div key={k} className="flex items-baseline gap-2">
                      <span className="shrink-0 text-muted-foreground">{k}</span>
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {readOnlyFieldValue(v)}
                      </span>
                    </div>
                  ),
                )}
              </div>
            ) : (
              <CustomFieldsEditor
                value={values.custom_fields as Record<string, unknown> | undefined}
                onChange={(v) => onFieldChange("custom_fields", v)}
              />
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * tab 2「当前位置数据」：只读渲染 `computeState(at_node = current_position)`。
 * - 计算节点默认取 `current_position`（须存在于大纲树）；**保留手动选节点下拉**（「第 N 章时他什么状态」）
 * - 结果自动计算（切换节点即重算；`deltaCount === 0` 时轻量空态、不发请求）
 * - conflicts / 状态差异 / 应用的变更记录 = 复用 `ComputeResult`（与 `ComputePreview` 同一实现，标注照搬）
 * - 字段视图的值 = 计算结果（尚未算出 → 初始 `data`），控件全部 `disabled`
 *
 * 依赖注入：`currentPosition` / `outlineNodes` 由容器从 project store 传入（本层不读 store）——
 * 既让展示层可在 `react-dom/server` 下直接走查（SSR 读不到 client store 的 setState 播种），
 * 也让「有/无当前位置」两种状态各有一份可断言渲染。
 */
function CharacterCurrentTab({
  detail,
  currentPosition,
  positionState,
  outlineNodes,
  outlineLoaded,
  outlineLoading,
  onLoadOutline,
}: {
  detail: EntityDetailRes;
 /** 项目当前位置（null = 未设置）——tab 2 计算节点默认值来源 */
  currentPosition: string | null;
 /** 当前位置四态（`pending` 尚未知 / `unset` 未设置 / `invalid` 已失效 / `ok`）——提示文案判据 */
  positionState: CharacterPositionState;
 /** 大纲节点选项（扁平树；深度用于缩进展示） */
  outlineNodes: readonly FlatNodeOption[];
 /** 大纲是否已加载（false → 给「加载大纲」入口，不静默失败） */
  outlineLoaded: boolean;
 /** 大纲在途加载（容器已自动拉取；在途时不给重复按钮，显加载文案） */
  outlineLoading: boolean;
  onLoadOutline: () => void;
}) {
  const nodeTitles = new Map(outlineNodes.map((o) => [o.id, o.label]));

  const [atNodeId, setAtNodeId] = useState<string>(() =>
    resolveCurrentAtNode(
      currentPosition,
      outlineNodes.map((o) => o.id),
    ),
  );
  const [result, setResult] = useState<ComputeStateResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 当前位置/大纲异步到位后的回填（惰性初始化只跑一次；用户已手动选择时不覆盖）——同 ComputePreview 语义
  useEffect(() => {
    setAtNodeId((prev) => {
      if (prev !== "") return prev;
      return resolveCurrentAtNode(
        currentPosition,
        outlineNodes.map((o) => o.id),
      );
    });
  }, [currentPosition, outlineNodes]);

  // 自动计算：节点已知且该角色有变更记录时拉取（切换节点即重算；过期响应丢弃）
  useEffect(() => {
    if (detail.deltaCount === 0 || atNodeId === "") {
      setResult(null);
      return;
    }
    let cancelled = false;
    setComputing(true);
    setError(null);
    computeDeltaState({ target_type: ENTITY_TYPE, target_id: detail.id, at_node_id: atNodeId })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult(null);
        if (err instanceof ApiError && err.code === "OUTLINE_NODE_NOT_FOUND") {
          setError("该节点已不存在，请重新选择计算节点");
        } else {
          setError(
            err instanceof ApiError ? err.message : "无法连接服务，请确认 ai-editor 服务已启动",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setComputing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detail.id, detail.deltaCount, atNodeId]);

  const stateValues = result?.state ?? detail.data;
  // 未设置位置的说明只在**已确认**未设置时展示（`pending`/`invalid` 另有文案，不得混淆）
  const showUnsetHint = positionState === "unset";
  const showInvalidHint = positionState === "invalid";

  return (
    <div className="flex flex-col gap-4">
      {/* 计算节点（默认当前位置；可手选——「第 N 章时他什么状态」） */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">计算节点（到达该节点时的累积状态）</span>
          {!outlineLoaded ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {outlineLoading ? "大纲加载中…" : "大纲未加载"}
              </span>
              {!outlineLoading && (
                <Button size="small" onClick={onLoadOutline}>
                  加载大纲
                </Button>
              )}
            </div>
          ) : (
            <Select
              className="min-w-56"
              value={atNodeId}
              onChange={(value) => setAtNodeId(value)}
              aria-label="计算节点"
              popupMatchSelectWidth={false}
              options={[
                { value: "", label: "请选择大纲节点" },
                ...outlineNodes.map((o) => ({
                  value: o.id,
                  label: `${"　".repeat(o.depth)}${o.label}`,
                })),
              ]}
            />
          )}
        </div>
      </div>

      {/* 只读说明（只读语义：控件 disabled 而非隐藏；见文件头注释） */}
      <p className="text-xs text-muted-foreground">由变更记录累积，只读</p>

      {showUnsetHint && (
        <p className="text-xs text-muted-foreground">
          未设置当前位置，显示初始数据——
          <a href="#/outline" className="text-primary hover:underline">
            去大纲设位置
          </a>
        </p>
      )}

      {showInvalidHint && (
        <p className="text-xs text-muted-foreground">
          当前位置已失效（节点已删除），显示初始数据——
          <a href="#/outline" className="text-primary hover:underline">
            去大纲重设
          </a>
        </p>
      )}

      {detail.deltaCount === 0 && (
        <p className="text-sm text-muted-foreground">暂无变更记录——当前状态即初始状态</p>
      )}

      {error !== null && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {computing && result === null && (
        <div className="space-y-2">
          <div className={cn(skeletonClass, "h-9")} />
          <div className={cn(skeletonClass, "h-9")} />
        </div>
      )}

      {/* 字段视图（只读）：同一分区结构（基础信息 / 可变数据）+ 只读态全 `disabled`；值 = 计算结果 */}
      <CharacterSections
        name={detail.name}
        onNameChange={() => {}}
        values={stateValues}
        onFieldChange={() => {}}
        disabled
        showCustomFields={"custom_fields" in detail.data}
      />

      {/* 计算明细（conflicts 警示 / 状态差异 / 应用的变更记录——与 ComputePreview 同实现） */}
      {!computing && result !== null && (
        <ComputeResult result={result} currentData={detail.data} nodeTitles={nodeTitles} />
      )}
    </div>
  );
}

/**
 * 关系区块（1 跳双向；本卡保持既有能力：列表 + 新建关联 + 物理删）。
 * 卡 3.6 将替换为「人物关系网（人↔人，按关系类型分组）+ 其他关联（折叠区）」。
 */
function CharacterRelations({
  detail,
  onChanged,
}: {
  detail: EntityDetailRes;
  onChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RelationSummaryItem | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteRelation(deleteTarget.id);
      useUiStore.getState().showToast("已删除关系");
      setDeleteTarget(null);
      onChanged();
    } catch (err) {
      throw err; // 冒泡给 ConfirmDialog 内联显示
    }
  }

  return (
    <div className="mt-4 rounded-md border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">关联</h2>
        <Button onClick={() => setDialogOpen(true)}>+ 新增关联</Button>
      </div>

      {detail.relations.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground/70">暂无关联，新增一个</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {detail.relations.map((r) => {
            const isSource = r.sourceId === detail.id;
            const left = relationEndpointName(r, "source", detail.name, detail.id);
            const right = relationEndpointName(r, "target", detail.name, detail.id);
            return (
              <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="max-w-28 min-w-0 truncate text-foreground">{left}</span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {relationTypeLabel(r.relationType)} {isSource ? "→" : "←"}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{right}</span>
                <Button danger size="small" className="shrink-0" onClick={() => setDeleteTarget(r)}>
                  删除
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {dialogOpen && (
        <CreateRelationDialog
          source={{ type: ENTITY_TYPE, id: detail.id, name: detail.name }}
          onCreated={() => {
            setDialogOpen(false);
            onChanged();
          }}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="删除关系"
          description={`删除关系「${relationEndpointName(deleteTarget, "source", detail.name, detail.id)} ${relationTypeLabel(deleteTarget.relationType)} ${relationEndpointName(deleteTarget, "target", detail.name, detail.id)}」？物理删除不可恢复，可重新建立。`}
          confirmLabel="删除"
          danger
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

export interface CharacterDetailViewProps {
  detail: EntityDetailRes;
  /** 姓名（`entities.name`；与 `form`（data）分开——`diffData` 只比 data） */
  name: string;
  onNameChange: (v: string) => void;
  form: Record<string, unknown>;
  onFieldChange: (key: string, value: unknown) => void;
  /** 当前 tab（受控；由容器以 `userTab ?? resolveTabState(...).tab` 合并） */
  tab: CharacterViewTab;
  onTabChange: (tab: CharacterViewTab) => void;
  /** 基础信息必填判据（仅 tab 1 内联展示；tab 2 只读不校验） */
  basicsErrors: CharacterBasicsErrors;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onDelete: () => void;
  /** 关系变更（建/删）后重拉详情 */
  onReload: () => void;
  /** 项目当前位置（tab 2 计算节点默认值） */
  currentPosition: string | null;
  /** 当前位置四态（`pending` 尚未知 / `unset` 未设置 / `invalid` 已失效 / `ok`）——提示文案判据 */
  positionState: CharacterPositionState;
  /** 大纲节点选项（扁平树；容器从 project store 传入） */
  outlineNodes: readonly FlatNodeOption[];
  /** 大纲是否已加载 */
  outlineLoaded: boolean;
  /** 大纲在途加载（容器自动拉取时给加载文案，不给重复按钮） */
  outlineLoading: boolean;
  onLoadOutline: () => void;
}

/**
 * 人物详情视图（展示层；数据与副作用在容器 `CharacterDetail`）——
 * 独立导出便于 `react-dom/server` 走查（仓内无 jsdom，见既有纪律）。
 */
export function CharacterDetailView({
  detail,
  name,
  onNameChange,
  form,
  onFieldChange,
  tab,
  onTabChange,
  basicsErrors,
  saving,
  saveError,
  onSave,
  onDelete,
  onReload,
  currentPosition,
  positionState,
  outlineNodes,
  outlineLoaded,
  outlineLoading,
  onLoadOutline,
}: CharacterDetailViewProps) {
  return (
    <section>
      {/* 页头（统一壳）：标题 + 操作 + 元信息行；有 tab 的页面传 divider={false}
          （antd line 型 Tabs 的导航条自带 1px hairline 底线即分割线——同设置页） */}
      <PageHeader
        title={detail.name}
        truncateTitle
        divider={false}
        className="mb-3"
        action={
          <>
            <Button onClick={onSave} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
            <Button danger onClick={onDelete}>
              移入回收站
            </Button>
          </>
        }
        description={
          /* 元信息行：只留时间戳——「变更记录 N 条」按钮已取消（入口被 tab 2 吸收） */
          <p className="text-xs text-muted-foreground">
            创建于 {formatTimestamp(detail.createdAt)} · 更新于 {formatTimestamp(detail.updatedAt)}
          </p>
        }
      />

      {/* 当前位置已失效（已软删/被删）：回落 tab 1 + 提示重设（在 tab 行之上，两个 tab 都可见） */}
      {positionState === "invalid" && (
        <p className="mb-3 text-xs text-muted-foreground">
          当前位置已失效（节点已删除）——
          <a href="#/outline" className="text-primary hover:underline">
            去大纲重设
          </a>
        </p>
      )}

      <Tabs
        activeKey={tab}
        onChange={(key) => onTabChange(key as CharacterViewTab)}
        items={[
          {
            key: "initial",
            label: "初始化数据",
            children: (
              <div className="flex flex-col gap-4">
                <CharacterSections
                  name={name}
                  onNameChange={onNameChange}
                  values={form}
                  onFieldChange={onFieldChange}
                  basicsErrors={basicsErrors}
                  showCustomFields={"custom_fields" in detail.data}
                />
                {saveError !== null && <p className="text-sm text-destructive">{saveError}</p>}
              </div>
            ),
          },
          {
            key: "current",
            label: "当前位置数据",
            children: (
              <CharacterCurrentTab
                detail={detail}
                currentPosition={currentPosition}
                positionState={positionState}
                outlineNodes={outlineNodes}
                outlineLoaded={outlineLoaded}
                outlineLoading={outlineLoading}
                onLoadOutline={onLoadOutline}
              />
            ),
          },
        ]}
      />

      {/* 关系（tab 之外：关系不参与 computeState，与状态视图正交——见 DESIGN.md `character-workbench`） */}
      <CharacterRelations detail={detail} onChanged={onReload} />
    </section>
  );
}

/**
 * 人物详情容器（数据 + 副作用）：加载/保存/软删 + 默认 tab 判据。
 * `onSaved`：保存成功后回调（工作台刷新左栏列表的姓名/角色定位）。
 */
export function CharacterDetail({ id, onSaved }: { id: string; onSaved?: () => void }) {
  const config = useProjectStore((s) => s.config);
  const outline = useProjectStore((s) => s.outline);
  const outlineLoading = useProjectStore((s) => s.outlineLoading);
  const loadOutline = useProjectStore((s) => s.loadOutline);
  const setCurrentFocus = useUiStore((s) => s.setCurrentFocus);

  const [detail, setDetail] = useState<EntityDetailRes | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  /** 姓名（`entities.name`；与 `form`（data）分开——`diffData` 只比 data） */
  const [formName, setFormName] = useState<string>("");
 /** 基础信息必填判据（仅前端；服务端不硬校验）——提交时算、成功/重拉时清 */
  const [basicsErrors, setBasicsErrors] = useState<CharacterBasicsErrors>({
    name: null,
    description: null,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 用户手动切换的 tab（null = 尚未切换 → 用默认判据） */
  const [userTab, setUserTab] = useState<CharacterViewTab | null>(null);

  // 挂载/切换角色时上报页面焦点（右下「问 AI」携带当前实体上下文）
  useEffect(() => {
    setCurrentFocus({ focus_entity_type: ENTITY_TYPE, focus_entity_id: id });
  }, [id, setCurrentFocus]);

  async function loadDetail() {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const res = await getEntityDetail(ENTITY_TYPE, id);
      setDetail(res);
      setForm(JSON.parse(JSON.stringify(res.data)) as Record<string, unknown>);
      setFormName(res.name);
      setBasicsErrors({ name: null, description: null });
    } catch (err) {
      setDetail(null);
      setForm(null);
      setFormName("");
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
    // 依赖仅 [id]：换角色才重载（loadDetail 每次渲染重建，与既有详情页同取舍）
  }, [id]);

  // 数据变更信号（InfoBar 刷新 / AI 提案确认写库）→ 重拉（表单以服务端权威为准整体重置）
  useDataRefresh(() => void loadDetail());

  // tab 2 需要大纲（计算节点选项）：直达人物页时 store 里可能还没拉——**自动兜底拉取**
  // （同 HookPanel「大纲未加载时兜底拉取」先例：项目打开时通常已加载，此处防直达路由场景）
  useEffect(() => {
    if (config !== null && outline === null && !outlineLoading) void loadOutline();
  }, [config, outline, outlineLoading, loadOutline]);

  /** 扁平大纲节点（memo：避免每次渲染新数组把子层的回填 effect 变成每渲染必跑） */
  const outlineNodes = useMemo(() => flattenTree(outline?.children ?? []), [outline]);

  async function handleSave() {
    if (!detail || !form || saving) return;
    // 基础信息必填（**仅前端**）：先拦下空姓名/空描述，避免无谓的服务端往返
    const errors = validateCharacterBasics({ name: formName, description: form.description });
    setBasicsErrors(errors);
    if (hasCharacterBasicsErrors(errors)) return;
    const changed = diffData(detail.data, form);
    const nextName = formName.trim();
    const nameChanged = nextName !== detail.name;
    if (!changed && !nameChanged) {
      useUiStore.getState().showToast("没有变更");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateEntity(ENTITY_TYPE, id, {
        ...(nameChanged ? { name: nextName } : {}),
        ...(changed ? { data: changed } : {}),
      });
      useUiStore.getState().showToast("已保存");
      await loadDetail();
      onSaved?.();
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

  // Ctrl/Cmd+S 保存（与既有详情页同语义）
  useSaveShortcut(() => void handleSave(), detail !== null && form !== null);

  /** 软删直接执行（不弹二次确认——与既有交互一致）：DELETE → toast（级联计数）→ 跳回列表 */
  async function handleDelete() {
    if (!detail) return;
    try {
      const res = await deleteEntity(ENTITY_TYPE, id);
      const parts: string[] = [];
      if (res.cascaded.relations > 0) parts.push(`${res.cascaded.relations} 条关联`);
      if (res.cascaded.deltas > 0) parts.push(`${res.cascaded.deltas} 条变更记录`);
      useUiStore
        .getState()
        .showToast(
          `已移入回收站，可随时还原${parts.length > 0 ? `（含 ${parts.join("、")}）` : ""}`,
        );
      navigate(LIST_ROUTE);
    } catch (err) {
      useUiStore
        .getState()
        .showToast(err instanceof ApiError ? err.message : "删除失败，请重试", "error");
    }
  }

  if (notFound) {
    return (
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
            <Button onClick={() => navigate(LIST_ROUTE)}>返回列表</Button>
          </div>
        }
      >
        该人物不存在或已被删除
      </EmptyState>
    );
  }

  if (loading && detail === null) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-md border border-border p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={cn(skeletonClass, "h-9")} />
          ))}
        </div>
        <div className="space-y-3 rounded-md border border-border p-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={cn(skeletonClass, "h-9")} />
          ))}
        </div>
      </div>
    );
  }

  if (detail === null || form === null) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        {loadError === CLIENT_NETWORK_ERROR
          ? "无法连接服务，请确认 ai-editor 服务已启动。"
          : "详情加载失败，请重试。"}
        <Button className="ml-3" onClick={() => void loadDetail()}>
          重试
        </Button>
      </div>
    );
  }

  /** 当前位置四态 + 默认 tab（单一判据：`config` 未加载 → `pending`，不得瞬时误判为「未设置」；已失效 → 回落 tab 1） */
  const tabState = resolveTabState({
    configLoaded: config !== null,
    currentPosition: config?.currentPosition ?? null,
    outlineLoaded: outline !== null,
    nodeIds: outlineNodes.map((o) => o.id),
  });

  return (
    <CharacterDetailView
      detail={detail}
      name={formName}
      onNameChange={setFormName}
      form={form}
      onFieldChange={(key, value) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev))}
      tab={userTab ?? tabState.tab}
      onTabChange={setUserTab}
      basicsErrors={basicsErrors}
      positionState={tabState.positionState}
      saving={saving}
      saveError={saveError}
      onSave={() => void handleSave()}
      onDelete={() => void handleDelete()}
      onReload={() => void loadDetail()}
      currentPosition={config?.currentPosition ?? null}
      outlineNodes={outlineNodes}
      outlineLoaded={outline !== null}
      outlineLoading={outlineLoading}
      onLoadOutline={() => void loadOutline()}
    />
  );
}
