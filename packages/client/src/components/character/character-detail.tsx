// 人物详情（卡 3.2）：四 tab（人物档案 / 阅读进度 / 人物关系网 / 其他关联）——替换工作台右栏原来的泛型 `EntityDetail`。// 卡 3.3：`description` 必填（**仅前端**）+ `current_position` 失效回落与「配置未加载不误判」三态判据。
// 卡 6.2：**删「基础信息 / 可变数据」分区**（数据层可变性分层不进 UI）——一个 card 内档案式字段网格
//   （label 左置、单行字段两列、长文本/标签列表整行）；阅读进度 tab **同一网格、值画纯文本**（非 disabled 输入框）。
// 契约：`docs/ui/DESIGN.md` §数据展示 `character-workbench`（页头壳保持 + tab 行 + 只读语义 + 档案网格）与 `tabs`
//   （antd line 型；页内 tab **不进 URL**，刷新回落默认 tab；有 tab 的页面页头传 `divider={false}`——
//   tab 条自带 1px hairline 底线即分割线，与设置页同款）；
//   `docs/design/10-data-model.md` §14：不变式 1（不可变字段不参与 Delta、人工可编辑）、
//   不变式 2（不可变字段两视图必然相同）、不变式 3（**只有「人物档案」可编辑**、
//   「阅读进度」= `computeState(at_node = current_position)`、**只读**）；
//   `docs/db/schema.md`「人物 data 分层」（字段归属 + `description` 必填仅前端校验）。
// 页头：复用 `PageHeader` 壳（标题 + 保存/移入回收站 + 元信息行）；**取消**元信息行「变更记录 N 条」按钮
//   （入口被 tab 2 吸收——状态预览不再需要手动展开）。
// 只读语义：阅读进度 tab **不渲染输入控件与面板工具条**（字段值 = 纯文本、面板 = 名称+值行）——
//   两 tab 的字段 label 与网格位置逐一致（对比无位移），比一排灰底 disabled 输入框干净。
// 卡 3.3 修复轮（oracle 三条打磨）：对象值只读渲染不再 `[object Object]`（`readOnlyFieldValue` 走紧凑 JSON + 截断）；
//   「描述为空」提示（硬必填的前置提示，仅可编辑态）；大纲在途加载时 tab 2 在位置提示位补同一句加载文案。
// 关系区块：卡 3.6 建（人↔人关系网 + 其他关联）；卡 6.3 改为**彼此独立的 tab**（与两个字段 tab 平级——
//   关系不参与 `computeState`，但不放在字段 tab 之下、也不共享折叠壳：四个 tab = 四个数据集）。
// 数据：GET /entity/character/:id（含 relations + deltaCount）、PUT partial（diffData 只提交变更字段 + 姓名）、
//   DELETE（软删 + 级联计数 → 跳 `#/characters`）、POST /delta/compute（tab 2 自动计算）、POST/DELETE /relation。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HolderOutlined } from "@ant-design/icons";
import { formatTimestamp } from "@whispering233/ai-editor-shared";
import type { ComputeStateResult } from "@whispering233/ai-editor-shared";
import { Button, Input, Select, Tabs } from "antd";
import type { InputRef } from "antd";
import { ComputeResult } from "../delta/compute-preview";
import { PanelTree } from "./panel-tree";
import { CharacterRelations } from "./character-relations";
import { partitionCharacterRelations } from "../../lib/character-relations";
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
  getEntityDetail,
  updateEntity,
  type EntityDetailRes,
} from "../../lib/api";
import {
  characterDetailFields,
  hasCharacterBasicsErrors,
  isEmptyTextField,
  isSingleLineField,
  resolveCurrentAtNode,
  resolveTabState,
  readOnlyFieldValue,
  validateCharacterBasics,
  DESCRIPTION_EMPTY_HINT,
  OUTLINE_LOADING_TEXT,
  type CharacterBasicsErrors,
  type CharacterPositionState,
  type CharacterViewTab,
} from "../../lib/character-detail";
import { diffData, type DetailFieldConfig } from "../../lib/entity-detail";
import { entityListPath } from "../../lib/entity-paths";
import { chapterNodeOptions, type FlatNodeOption } from "../../lib/outline-tree";
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

/**
 * 标签列表编辑器（人物 `personality`）：拖拽排序 + 回车续行，交互语义与 `EntityDetail` 的私有实现一致
 * （本卡不复用泛型详情页的私有组件，见文件头注释——人物页与其持续分化）。
 * 仅可编辑态使用（阅读进度 tab 走只读文本单元，不渲染本编辑器）。
 */
function TagsEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
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
              draggable
              title="拖拽排序"
              aria-label="拖拽排序"
              onDragStart={(e) => {
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
          <Button onClick={() => onChange(values.filter((_, j) => j !== i))}>
            删除
          </Button>
        </div>
      ))}
      <Button className="self-start" onClick={() => onChange([...values, ""])}>
        + 添加
      </Button>
    </div>
  );
}

/** custom_fields 键值组编辑器（**仅有值时显示**——MVP 无法新增键，见 `EntityDetail` 同款边界；仅可编辑态使用） */
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
              onChange={(e) =>
                commit(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
              }
              placeholder="键"
            />
          </div>
          <Input
            value={r.value}
            onChange={(e) =>
              commit(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
            }
            placeholder="值"
            className="flex-1"
          />
          <Button onClick={() => commit(rows.filter((_, j) => j !== i))}>删除</Button>
        </div>
      ))}
      <Button
        className="self-start"
        onClick={() => commit([...rows, { key: "", value: "" }])}
      >
        + 添加字段
      </Button>
    </div>
  );
}

/** 单个字段控件（档案网格单元：text / number / textarea / tags） */
function FieldControl({
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
        <Input.TextArea
          value={fieldValue(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          value={fieldValue(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
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
    // 枚举下拉（人物 `priority` 等）：选项与标签由字段配置给出（单一定义 = shared 常量）。
    // 清除 → `null`（= 未分级；空串不是合法档位，服务端 schema 会 400），故 allowClear 的
    // undefined 统一归一为 null
    case "select":
      return (
        <Select
          className="w-full"
          allowClear
          value={fieldValue(value) || undefined}
          onChange={(v: string | undefined) => onChange(v ?? null)}
          options={(field.options ?? []).map((opt) => ({
            value: opt,
            label: field.optionsLabels?.[opt] ?? opt,
          }))}
        />
      );
    default:
      return <Input value={fieldValue(value)} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** 档案字段行：label 左置固定 64px（`leading-8` 与 32px 控件同高对齐）+ 值区；整行字段跨两列 */
function ProfileRow({
  label,
  fullWidth,
  children,
}: {
  label: string;
  fullWidth?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-2", fullWidth === true && "md:col-span-2")}>
      <span className="h-8 w-16 shrink-0 text-sm leading-8 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** 只读值（阅读进度 tab）：空值 `—`（quaternary）；长文本换行不截断，单行字段截断 */
function ReadOnlyValue({ value, multiline }: { value: unknown; multiline: boolean }) {
  const text = readOnlyFieldValue(value);
  if (text === "") return <span className="text-muted-foreground/70">—</span>;
  return (
    <span
      className={cn("text-foreground", multiline ? "whitespace-pre-wrap break-words" : "truncate")}
    >
      {text}
    </span>
  );
}

/** 只读值单元（盒高与可编辑控件一致：单行 32px 居中；长文本给 6px 上下内边距） */
function ReadOnlyCell({ value, multiline }: { value: unknown; multiline: boolean }) {
  return (
    <div className={cn("text-sm leading-5", multiline ? "py-1.5" : "flex h-8 items-center")}>
      <ReadOnlyValue value={value} multiline={multiline} />
    </div>
  );
}

/** 档案字段（单行字段 label/值同一行；长文本与标签列表整行） */
function ProfileField({
  field,
  value,
  onChange,
  readOnly,
  error,
  hint,
}: {
  field: DetailFieldConfig;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly: boolean;
  error: string | null;
  hint: string | null;
}) {
  const fullWidth = !isSingleLineField(field);
  return (
    <ProfileRow label={field.label} fullWidth={fullWidth}>
      {readOnly ? (
        <ReadOnlyCell
          value={
            // 枚举字段只读展示中文标签（`priority` → 「主角」），不显原始 key
            typeof value === "string" && field.optionsLabels !== undefined
              ? (field.optionsLabels[value] ?? value)
              : value
          }
          multiline={fullWidth}
        />
      ) : (
        <FieldControl field={field} value={value} onChange={onChange} />
      )}
      {error !== null && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {error === null && hint !== null && (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
    </ProfileRow>
  );
}

/**
 * 人物字段表单（**纵向 label 在上**——新建弹窗专用；人物详情页走 `CharacterProfile` 的档案网格）。
 * 字段集由调用方切分（弹窗按「必填段 / 可选段」），控件形态与档案网格同源（`FieldControl`）。
 */
export function CharacterFieldsForm({
  fields,
  values,
  onChange,
  fieldErrors,
  fieldHints,
}: {
  fields: readonly DetailFieldConfig[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** 字段级内联错误（键 → 文案；仅基础信息必填判据用，缺省无错误） */
  fieldErrors?: Partial<Record<string, string | null>>;
  /** 字段级提示（键 → 文案；与错误同位、但用次级字色——如「描述为空，保存前需填写」） */
  fieldHints?: Partial<Record<string, string | null>>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {fields.map((f) => {
        const error = fieldErrors?.[f.key] ?? null;
        const hint = fieldHints?.[f.key] ?? null;
        return (
          <div key={f.key}>
            <p className="mb-1 text-sm font-medium text-foreground">{f.label}</p>
            <FieldControl
              field={f}
              value={values[f.key]}
              onChange={(v) => onChange(f.key, v)}
            />
            {error !== null && <p className="mt-1 text-xs text-destructive">{error}</p>}
            {error === null && hint !== null && (
              <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 人物档案 tab（**一个 card 内的档案式字段网格**）：
 * - **不再按可变性分区**（「基础信息 / 可变数据」是数据层概念，只服务变更记录白名单与 AI 提案边界，
 *   不在 UI 表达——见 `docs/design/10-data-model.md` §14）
 * - 顺序 = `characterDetailFields()`（单一清单）；单行字段 ≥md 两列，长文本/标签列表整行
 * - `readOnly`（阅读进度 tab）：**同一网格、label 逐一致**，值画纯文本（`ReadOnlyCell`）——不是 disabled 输入框
 * - 能力面板（`panel-tree`）与「自定义字段」在网格之下各自成块：树 / 键值对形态塞不进字段网格，与可变性无关
 */
function CharacterProfile({
  name,
  onNameChange,
  values,
  onFieldChange,
  readOnly,
  basicsErrors,
  showCustomFields,
  selfId,
}: {
  /** 姓名（`entities.name` 列，不是 data 字段；不可变但人工可编辑） */
  name: string;
  onNameChange: (v: string) => void;
  values: Record<string, unknown>;
  onFieldChange: (key: string, value: unknown) => void;
  /** 只读态（阅读进度 tab）：值画文本，不渲染输入控件 */
  readOnly?: boolean;
  /** 基础信息必填判据（仅档案 tab 传入；阅读进度视图不校验） */
  basicsErrors?: CharacterBasicsErrors;
  /** `custom_fields` 仅在响应 data 已有该键时显示（MVP 边界：无键不可新增，同泛型详情页） */
  showCustomFields: boolean;
  /** 本角色 id（面板「从角色复制」候选里排除自己） */
  selfId?: string;
}) {
  const fields = characterDetailFields();
  // 「描述为空」提示：仅**可编辑态**且值为空时给（阅读进度视图不保存，提示无意义）
  const descriptionHint =
    readOnly !== true && isEmptyTextField(values.description) ? DESCRIPTION_EMPTY_HINT : null;
  return (
    <SectionCard>
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
        <ProfileRow label="姓名">
          {readOnly === true ? (
            <div className="flex h-8 items-center text-sm leading-5 text-foreground">{name}</div>
          ) : (
            <Input value={name} onChange={(e) => onNameChange(e.target.value)} />
          )}
          {basicsErrors?.name != null && (
            <p className="mt-1 text-xs text-destructive">{basicsErrors.name}</p>
          )}
        </ProfileRow>
        {fields.map((f) => (
          <ProfileField
            key={f.key}
            field={f}
            value={values[f.key]}
            onChange={(v) => onFieldChange(f.key, v)}
            readOnly={readOnly === true}
            error={f.key === "description" ? (basicsErrors?.description ?? null) : null}
            hint={f.key === "description" ? descriptionHint : null}
          />
        ))}
      </div>

      <PanelTree
        panel={values.ability_panel}
        onChange={(next) => onFieldChange("ability_panel", next)}
        readOnly={readOnly === true}
        selfId={selfId}
      />

      {showCustomFields && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-1 text-sm font-medium text-foreground">自定义字段</p>
          {readOnly === true ? (
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
  );
}

/**
 * 阅读进度 tab：只读渲染 `computeState(at_node = current_position)`。
 * - 进度节点默认取 `current_position`（须存在于大纲树）；**保留手动选节点下拉**（「第 N 章时他什么状态」）
 * - 结果自动计算（切换节点即重算；`deltaCount === 0` 时轻量空态、不发请求）
 * - conflicts / 状态差异 / 应用的变更记录 = 复用 `ComputeResult`（与 `ComputePreview` 同一实现，标注照搬）
 * - 字段视图的值 = 计算结果（尚未算出 → 初始 `data`），**画纯文本**（同一档案网格）
 *
 * 依赖注入：`currentPosition` / `chapterNodes` 由容器从 project store 传入（本层不读 store）——
 * 既让展示层可在 `react-dom/server` 下直接走查（SSR 读不到 client store 的 setState 播种），
 * 也让「有/无阅读进度」两种状态各有一份可断言渲染。
 */
function CharacterCurrentTab({
  detail,
  currentPosition,
  positionState,
  chapterNodes,
  outlineLoaded,
  outlineLoading,
  onLoadOutline,
}: {
  detail: EntityDetailRes;
 /** 项目阅读进度（null = 未设置）——阅读进度 tab 的进度节点默认值来源 */
  currentPosition: string | null;
 /** 阅读进度四态（`pending` 尚未知 / `unset` 未设置 / `invalid` 已失效 / `ok`）——提示文案判据 */
  positionState: CharacterPositionState;
 /** 章节点选项（只列章；容器用 `chapterNodeOptions` 派生；depth 用于缩进展示） */
  chapterNodes: readonly FlatNodeOption[];
 /** 大纲是否已加载（false → 给「加载大纲」入口，不静默失败） */
  outlineLoaded: boolean;
 /** 大纲在途加载（容器已自动拉取；在途时不给重复按钮，显加载文案） */
  outlineLoading: boolean;
  onLoadOutline: () => void;
}) {
  const nodeTitles = new Map(chapterNodes.map((o) => [o.id, o.label]));

  const [atNodeId, setAtNodeId] = useState<string>(() =>
    resolveCurrentAtNode(
      currentPosition,
      chapterNodes.map((o) => o.id),
    ),
  );
  const [result, setResult] = useState<ComputeStateResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 阅读进度/大纲异步到位后的回填（惰性初始化只跑一次；用户已手动选择时不覆盖）——同 ComputePreview 语义
  useEffect(() => {
    setAtNodeId((prev) => {
      if (prev !== "") return prev;
      return resolveCurrentAtNode(
        currentPosition,
        chapterNodes.map((o) => o.id),
      );
    });
  }, [currentPosition, chapterNodes]);

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
          setError("该节点已不存在，请重新选择进度节点");
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
  // 大纲未到位时（位置有效但树还没加载）展示的是初始 data，不是位置累积结果 →
  // 必须在位置提示位给同一句加载文案（单一来源常量），否则会“看似已算完”
  const showOutlineLoadingHint = positionState === "ok" && !outlineLoaded && outlineLoading;

  return (
    <div className="flex flex-col gap-4">
      {/* 进度节点（默认阅读进度；可手选——「第 N 章时他什么状态」） */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">进度节点（到达该节点时的累积状态）</span>
          {!outlineLoaded ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {outlineLoading ? OUTLINE_LOADING_TEXT : "大纲未加载"}
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
              aria-label="进度节点"
              popupMatchSelectWidth={false}
              /* 可搜索：选项 value 是节点 id（搜不到标题）——必须显式 `optionFilterProp="label"` */
              showSearch
              optionFilterProp="label"
              options={[
                { value: "", label: "请选择大纲节点" },
                ...chapterNodes.map((o) => ({
                  value: o.id,
                  label: `${"　".repeat(o.depth)}${o.label}`,
                })),
              ]}
            />
          )}
        </div>
      </div>

      {/* 只读说明（阅读进度 = 变更记录累积，只读；值以文本画在与档案 tab 完全相同的网格里） */}
      <p className="text-xs text-muted-foreground">由变更记录累积，只读</p>

      {showOutlineLoadingHint && (
        <p className="text-xs text-muted-foreground">{OUTLINE_LOADING_TEXT}</p>
      )}

      {showUnsetHint && (
        <p className="text-xs text-muted-foreground">
          未设置阅读进度，显示人物档案初始值——
          <a href="#/outline" className="text-primary hover:underline">
            去大纲设进度
          </a>
        </p>
      )}

      {showInvalidHint && (
        <p className="text-xs text-muted-foreground">
          阅读进度已失效（节点已删除），显示人物档案初始值——
          <a href="#/outline" className="text-primary hover:underline">
            去大纲重设
          </a>
        </p>
      )}

      {detail.deltaCount === 0 && (
        <p className="text-sm text-muted-foreground">暂无变更记录——当前状态即人物档案初始值</p>
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

      {/* 字段视图（只读）：**同一档案网格**（label 与人物档案 tab 逐一致）+ 值画纯文本；值 = 计算结果 */}
      <CharacterProfile
        name={detail.name}
        onNameChange={() => {}}
        values={stateValues}
        onFieldChange={() => {}}
        readOnly
        showCustomFields={"custom_fields" in detail.data}
        selfId={detail.id}
      />

      {/* 计算明细（conflicts 警示 / 状态差异 / 应用的变更记录——与 ComputePreview 同实现） */}
      {!computing && result !== null && (
        <ComputeResult result={result} currentData={detail.data} nodeTitles={nodeTitles} />
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
  /** 项目阅读进度（阅读进度 tab 的进度节点默认值） */
  currentPosition: string | null;
  /** 阅读进度四态（`pending` 尚未知 / `unset` 未设置 / `invalid` 已失效 / `ok`）——提示文案判据 */
  positionState: CharacterPositionState;
  /** 章节点选项（只列章；容器用 `chapterNodeOptions` 从 project store 派生） */
  chapterNodes: readonly FlatNodeOption[];
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
  chapterNodes,
  outlineLoaded,
  outlineLoading,
  onLoadOutline,
}: CharacterDetailViewProps) {
  // 「其他关联 · N」标签条数：与关系区容器同一分区函数（纯函数单一来源，不另写一份判据）
  const otherCount = useMemo(
    () =>
      partitionCharacterRelations(detail.relations, {
        selfId: detail.id,
        selfName: detail.name,
      }).other.length,
    [detail.relations, detail.id, detail.name],
  );

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

      {/* 阅读进度已失效（已软删/被删）：回落人物档案 tab + 提示重设（在 tab 行之上，四个 tab 都可见） */}
      {positionState === "invalid" && (
        <p className="mb-3 text-xs text-muted-foreground">
          阅读进度已失效（节点已删除）——
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
            label: "人物档案",
            children: (
              <div className="flex flex-col gap-4">
                <CharacterProfile
                  name={name}
                  onNameChange={onNameChange}
                  values={form}
                  onFieldChange={onFieldChange}
                  basicsErrors={basicsErrors}
                  showCustomFields={"custom_fields" in detail.data}
                  selfId={detail.id}
                />
                {saveError !== null && <p className="text-sm text-destructive">{saveError}</p>}
              </div>
            ),
          },
          {
            key: "current",
            label: "阅读进度",
            children: (
              <CharacterCurrentTab
                detail={detail}
                currentPosition={currentPosition}
                positionState={positionState}
                chapterNodes={chapterNodes}
                outlineLoaded={outlineLoaded}
                outlineLoading={outlineLoading}
                onLoadOutline={onLoadOutline}
              />
            ),
          },
          {
            key: "relations",
            label: "人物关系网",
            children: (
              <CharacterRelations detail={detail} onChanged={onReload} pane="network" />
            ),
          },
          {
            key: "other",
            // 条数常显于标签 = 「不可藏」（涵盖 appears_in / belongs_to 等 AI 分析数据源）
            label: `其他关联 · ${otherCount}`,
            children: <CharacterRelations detail={detail} onChanged={onReload} pane="other" />,
          },
        ]}
      />
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

  // 阅读进度 tab 需要大纲（进度节点选项）：直达人物页时 store 里可能还没拉——**自动兜底拉取**
  // （同 HookPanel「大纲未加载时兜底拉取」先例：项目打开时通常已加载，此处防直达路由场景）
  useEffect(() => {
    if (config !== null && outline === null && !outlineLoading) void loadOutline();
  }, [config, outline, outlineLoading, loadOutline]);

  /** 扁平大纲节点（memo：避免每次渲染新数组把子层的回填 effect 变成每渲染必跑） */
  // 进度节点只列章（状态按章序前缀累积，场景/卷只是某章的别名——见 DESIGN.md `character-workbench`）
  const chapterNodes = useMemo(() => chapterNodeOptions(outline), [outline]);

  async function handleSave() {
    if (!detail || !form || saving) return;
    // 基础信息必填（**仅前端**）：先拦下空姓名/空描述，避免无谓的服务端往返
    const errors = validateCharacterBasics({ name: formName, description: form.description });
    setBasicsErrors(errors);
    if (hasCharacterBasicsErrors(errors)) return false; // 校验失败：Ctrl+S 据此不生成备份
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
        return false;
      }
      setSaveError(err instanceof ApiError ? err.message : "保存失败，请重试");
      return false; // 保存失败：Ctrl+S 据此不生成备份
    } finally {
      setSaving(false);
    }
  }

  // Ctrl/Cmd+S 保存（与既有详情页同语义）
  useSaveShortcut(() => handleSave(), detail !== null && form !== null);

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

  /** 阅读进度四态 + 默认 tab（单一判据：`config` 未加载 → `pending`，不得瞬时误判为「未设置」；已失效 → 回落人物档案 tab） */
  const tabState = resolveTabState({
    configLoaded: config !== null,
    currentPosition: config?.currentPosition ?? null,
    outlineLoaded: outline !== null,
    nodeIds: chapterNodes.map((o) => o.id),
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
      chapterNodes={chapterNodes}
      outlineLoaded={outline !== null}
      outlineLoading={outlineLoading}
      onLoadOutline={() => void loadOutline()}
    />
  );
}
