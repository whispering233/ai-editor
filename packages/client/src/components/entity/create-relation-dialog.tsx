// 建立关联对话框（U8 抽共用；「新增关联」+ 「关联 Tab」）
// 两模式：
// - 详情模式（source 非 null）：源固定为本端点——实体详情页「本实体：{name}」、大纲节点详情页（S12.2）
// 「本节点：{name}」（source.type 支持 outline_node，端点类型），方向「本端点 → 关联对象」
// - 列表模式（source 为 null）：暴露源实体选择（类型下拉默认 character + 实体下拉 listEntities limit 100），方向「源 → 目标」
// 目标端类型支持四类实体 + 大纲节点（outline store 树，无需请求）；409 RELATION_EXISTS → 内联「这条关系已经存在」；
// 成功 → toast「已建立关系」→ onCreated → onClose。样式 token 类。
// 关系类型下拉口径（含伏笔锚点仅章的源端过滤）见 lib/relation-types.ts（卡片 1.6）——
// 源端点层级由调用点显式传入（nodeType），不靠 store 反查。
// 关系类型下拉 = `select-free-input`（DESIGN.md）：选项 = 调用方预定义子集 ∪ 本项目已用**自定义**类型
// （挂载时一次 `GET /relation?depth=1` 派生，失败静默降级为只有预定义子集），无匹配给「将新建『X』」；
// 提交前用 shared 语法函数预校验（非法值内联报错且不发请求）。
// 布局：左右三段式「源 -关系-> 目标」——grid-cols-[1fr_auto_1fr]（sm 起），窄屏垂直堆叠；
// 中列关系类型下拉 + 「→」箭头（mt-auto 沉底对齐两端实体下拉），三列各有小标题（源实体/关系类型/目标实体）。
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AutoComplete, Button, Select } from "antd";
import { ENTITY_TYPES, relationTypeSyntaxError } from "@whispering233/ai-editor-shared";
import type { EntitySummary, EntityType } from "@whispering233/ai-editor-shared";
import {
  ApiError,
  createRelation,
  listEntities,
  listRelations,
  type CreateRelationBody,
  type OutlineNodeType,
} from "../../lib/api";
import { flattenTree } from "../../lib/outline-tree";
import {
  customRelationTypeUsages,
  dialogRelationTypeOptions,
  relationTypeSelectOptions,
} from "../../lib/relation-types";
import type { RelationTypeUsage } from "../../lib/relation-types";
import { useProjectStore } from "../../stores/project";
import { useUiStore } from "../../stores/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TYPE_LABEL: Record<EntityType, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  // C1 类型补全（event 时间轴事件；时间轴专属 UI 由 C2 实现）
  event: "事件",
  // G2.3 类型补全（G2 时间标签点；源端下拉随 ENTITY_TYPES 出现——挂载关系不在此对话框创建）
  timepoint: "时间点",
  // 参考资料 reference
  reference: "参考资料",
};

/**
 * `select-free-input` 的 `filterOption`：antd 6.6.2 combobox 模式该项默认 `false`
 * （`@rc-component/select` 源码：`filterOption === undefined && mode === 'combobox'` → false），
 * **必须显式传**，否则打字不筛。匹配口径 = label 大小写不敏感包含。
 */
function filterByLabel(input: string, option?: { label?: unknown }): boolean {
  return String(option?.label ?? "").toLowerCase().includes(input.toLowerCase());
}

/**
 * 源端点（详情模式传入；null = 列表模式自由选择源）。
 * 判别联合：实体源（EntityType）与大纲节点源（outline_node，S12.2 节点详情页作为源）——
 * **大纲节点源强制携带 `nodeType`**（卡片 1.6：关系类型下拉按层级过滤，伏笔三类仅章可见；
 * 编译期即拒绝"忘传层级"，运行期兜底见 lib/relation-types.ts 的 fail-closed 口径）。
 */
export type RelationSource =
  | { type: EntityType; id: string; name: string }
  | { type: "outline_node"; id: string; name: string; nodeType: OutlineNodeType };

export function CreateRelationDialog({
  source,
  lockTargetType,
  relationTypes,
  onCreated,
  onClose,
}: {
  source: RelationSource | null;
  /**
   * 目标端类型锁定（人物关系网「+ 添加人物关系」：人↔人语义）——锁定后不渲染目标类型下拉，
   * 改为只读卡片（同源端样式）；省略 = 现行自由选择（其他关联区/列表模式不受影响）。
   */
  lockTargetType?: EntityType;
  /**
   * 关系类型下拉覆盖（省略 = `dialogRelationTypeOptions(source)` 基集）；
   * 人物关系网传人↔人 5 类（`lib/character-relations.ts`）——**入口收窄**，其他关系类型走「其他关联」入口。
   * 调用方保证传入值非空（空数组会让默认值 undefined）；本组件不做静态校验。
   */
  relationTypes?: readonly string[];
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const outline = useProjectStore((s) => s.outline);
  // 关系类型选项（本组件内只读：挂载后不变，对话框开/关即重挂）
  const typeOptions = relationTypes ?? dialogRelationTypeOptions(source);
  // 本项目已用自定义类型（挂载时拉一次全量关系派生；失败静默降级为只有预定义子集，不阻断建关系）
  const [customUsages, setCustomUsages] = useState<RelationTypeUsage[]>([]);
  // 列表模式源端（详情模式不用）
  const [sourceType, setSourceType] = useState<EntityType>("character");
  const [sourceEntities, setSourceEntities] = useState<EntitySummary[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  // 目标端（两模式共用；"outline_node" = 大纲节点，relation_records 端点类型；锁定类型优先）
  const [otherType, setOtherType] = useState<EntityType | "outline_node">(
    lockTargetType ?? "character",
  );
  const [otherEntities, setOtherEntities] = useState<EntitySummary[] | null>(null);
  const [otherId, setOtherId] = useState("");
  // 默认关系类型 = 当前源端可选集的首项（保证默认值 ⊆ 选项集，源端过滤后仍成立）
  const [relationType, setRelationType] = useState<string>(() => typeOptions[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 挂载时拉一次全量关系 → 派生已用自定义类型（失败静默降级，不阻断建关系）
  useEffect(() => {
    let cancelled = false;
    listRelations({ depth: 1 })
      .then((res) => {
        if (!cancelled) setCustomUsages(customRelationTypeUsages(res.relations));
      })
      .catch(() => {
        if (!cancelled) setCustomUsages([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 列表模式：源类型变化 → 拉实体列表
  useEffect(() => {
    if (source) return;
    setSourceId("");
    setSourceEntities(null);
    listEntities(sourceType, { limit: 100 })
      .then((res) => setSourceEntities(res.items))
      .catch(() => setSourceEntities([]));
  }, [source, sourceType]);

  // 目标端类型变化 → 拉实体列表（大纲节点用 outline store 的树，无需请求）
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
  // 关系类型选项：调用方预定义子集 + 已用自定义类型（带条数，自定义在后）
  const relationTypeOptions = relationTypeSelectOptions(typeOptions, customUsages);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!source && !sourceId) {
      setError("请选择源实体");
      return;
    }
    if (!otherId) {
      setError("请选择关联对象");
      return;
    }
    // 语法预校验（shared 纯函数，与 REST schema / db 守卫同源）：非法值内联报错且不发请求
    const relationTypeError = relationTypeSyntaxError(relationType);
    if (relationTypeError !== null) {
      setError(relationTypeError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateRelationBody = {
        source_type: source ? source.type : sourceType,
        source_id: source ? source.id : sourceId,
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>新增关联</DialogTitle>
        </DialogHeader>
        <form id="create-relation-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* 左右布局：源 -关系-> 目标 一行三段式；窄屏（sm 以下）垂直堆叠 */}
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
            {/* 左列：源实体（详情模式固定本实体禁选卡片；列表模式自由选择） */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">源实体</p>
              {source ? (
                <div
                  title={source.name}
                  className="min-w-0 truncate rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-foreground"
                >
                  {source.type === "outline_node" ? "本节点" : "本实体"}：{source.name}
                </div>
              ) : (
                <>
                  <Select
                    className="w-full"
                    value={sourceType}
                    onChange={(value) => setSourceType(value as EntityType)}
                    options={ENTITY_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
                  />
                  <Select
                    className="w-full"
                    value={sourceId}
                    onChange={(value) => setSourceId(value)}
                    options={[
                      { value: "", label: `选择${TYPE_LABEL[sourceType]}…` },
                      ...(sourceEntities ?? []).map((it) => ({ value: it.id, label: it.name })),
                    ]}
                  />
                </>
              )}
            </div>
            {/* 中列：关系类型 + 方向箭头（mt-auto 沉底与两端实体下拉对齐，表达「源 关系→ 目标」） */}
            <div className="flex flex-col gap-2 sm:w-44">
              <p className="text-sm font-medium text-foreground">关系类型</p>
              {/* 自由输入下拉（`select-free-input`）：filterOption 必须显式传（combobox 模式默认不筛）；
                  `onChange` 在无值时可能给 undefined → 兜底空串；无匹配给「将新建『X』」提示；
                  浮层宽度按内容（窄列 176px 下跟触发器宽会截断长自定义类型名——DESIGN.md §select-option-selected） */}
              <AutoComplete
                className="w-full"
                aria-label="关系类型"
                value={relationType}
                onChange={(value) => setRelationType(value ?? "")}
                options={relationTypeOptions}
                filterOption={filterByLabel}
                notFoundContent={`将新建『${relationType}』`}
                popupMatchSelectWidth={false}
              />
              <span
                aria-hidden="true"
                className="mt-auto pb-1 text-center text-xl leading-none text-muted-foreground select-none"
              >
                →
              </span>
            </div>
            {/* 右列：目标实体（大纲节点用 outline store 树） */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">目标实体</p>
              {lockTargetType === undefined ? (
                <Select
                  className="w-full"
                  value={otherType}
                  onChange={(value) => setOtherType(value as EntityType | "outline_node")}
                  options={[
                    { value: "character", label: "人物" },
                    { value: "setting", label: "设定" },
                    { value: "location", label: "地点" },
                    { value: "hook", label: "伏笔" },
                    { value: "outline_node", label: "大纲节点" },
                  ]}
                />
              ) : (
                /* 类型锁定态：只读卡片（同源端样式）——人物关系网仅人↔人 */
                <div className="min-w-0 truncate rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-foreground">
                  {TYPE_LABEL[lockTargetType]}
                </div>
              )}
              {otherType === "outline_node" ? (
                <Select
                  className="w-full"
                  value={otherId}
                  onChange={(value) => setOtherId(value)}
                  options={[
                    { value: "", label: "选择大纲节点…" },
                    ...outlineOptions.map((o) => ({
                      value: o.id,
                      label: `${`　`.repeat(o.depth)}${o.label}`,
                    })),
                  ]}
                />
              ) : (
                <Select
                  className="w-full"
                  value={otherId}
                  onChange={(value) => setOtherId(value)}
                  options={[
                    { value: "", label: `选择${TYPE_LABEL[otherType]}…` },
                    ...(otherEntities ?? []).map((it) => ({ value: it.id, label: it.name })),
                  ]}
                />
              )}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="primary"
            htmlType="submit"
            form="create-relation-form"
            disabled={submitting}
          >
            建立
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
