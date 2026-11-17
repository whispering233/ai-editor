// 关联 tab 视图（U8；「关联 Tab（实体关系总览）」）
// 数据：GET /api/v1/relation?depth=1 一次拉全量（MVP 关系量级小），过滤全部前端实现
// （服务端 source_type / target_type 支持 AND，但名称 q 不支持模糊，统一在前端过滤）。
// 过滤（filterRelations 纯函数，可单测）：源类型 / 目标类型（各自独立，空串 = 不限；同时给 = AND）/
// 关系类型 / 名称（sourceName/targetName 任一包含、大小写不敏感；名称可能 undefined——回退 id）。
// 行：源（端点类型徽标 + 源名）→ 关系类型标签（relationTypeLabel + 方向箭头 →）→ 目标（徽标 + 目标名）→ [编辑说明][删除]；
// 端点名旁的类型徽标**排在名称前**（列内对齐，见 DESIGN.md §relations-view）；端点点击跳各自宿主段详情（人物/设定/地点/伏笔/事件/时间点/参考资料 →
// characters|setting|locations|hooks|timeline|timepoints|references）；大纲节点（S12.2 起）跳 #/outline/:nodeId。
// 删除：ConfirmDialog 物理删确认（不可恢复，可重新建立）→ DELETE → toast「已删除关系」→ 重拉。
// 空态两种：无任何关系「还没有关联，建立一条」+ [建立关联]；过滤无结果「没有匹配的关联」+ [清空过滤]。
// scope 模式（S12.2 大纲节点详情页）：传入端点范围 → 服务端过滤该端点作为 source 的关系
// （source_type+source_id，depth=1），隐藏前端过滤区（列表短，无过滤必要）。
// 样式 token 类（禁止硬编码色类）。
import { useEffect, useState } from "react";
import { ENTITY_TYPES, RELATION_TYPES, ENTITY_TYPE_LABELS } from "@whispering233/ai-editor-shared";
import { ApiError, CLIENT_NETWORK_ERROR, deleteRelation, listRelations } from "../../lib/api";
import type { RelationSummaryItem } from "../../lib/api";
import { relationTypeLabel } from "../../lib/entity-detail";
import { customRelationTypeUsages, relationTypeSelectOptions } from "../../lib/relation-types";
import { ConfirmDialog } from "../outline/dialogs";
import { EditRelationDialog } from "./edit-relation-dialog";
import { EmptyState } from "../ui/empty-state";
import { entityDetailPath } from "../../lib/entity-paths";
import type { EntityType } from "@whispering233/ai-editor-shared";
import { Alert, Button, Input, Select, Skeleton } from "antd";
import { TypeChip } from "@/components/ui/tag-chip";
import { PageDivider } from "@/components/ui/page-header";
import { DeleteOutlined, EditOutlined, SearchOutlined } from "@ant-design/icons";
import { navigate } from "../../hooks/use-route";
import { useUiStore } from "../../stores/ui";

/** 端点类型 → 中文徽标（`relation_records` 端点类型）：实体类型中文名的**单一来源 = shared `ENTITY_TYPE_LABELS`**
 * （曾在本文件手抄一张只含四类的表 → `event` / `timepoint` / `reference` 徽标原样漏出英文）；
 * `outline_node` 不是实体类型（大纲节点），单独补上。未知类型仍原样显示（不骗人）。 */
export const ENDPOINT_TYPE_LABEL: Record<string, string> = {
  ...ENTITY_TYPE_LABELS,
  outline_node: "大纲节点",
};

/** 端点类型过滤选项（源 / 目标两个下拉共用；含大纲节点） */
const ENDPOINT_TYPE_FILTER_OPTIONS = Object.entries(ENDPOINT_TYPE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

/** 过滤条件（"" = 全部） */
export interface RelationFilter {
  /** 源端点类型（"" = 不限） */
  sourceType: string;
  /** 目标端点类型（"" = 不限；与源类型同时给 = AND） */
  targetType: string;
  /** 关系类型 */
  relationType: string;
  /** 名称关键词（源/目标名称任一包含；大小写不敏感；trim 后为空忽略） */
  nameQuery: string;
}

export const EMPTY_RELATION_FILTER: RelationFilter = {
  sourceType: "",
  targetType: "",
  relationType: "",
  nameQuery: "",
};

/** 按过滤条件筛选关系（纯函数）：源类型 / 目标类型各自判断、同时给 = AND；名称缺失回退 id，id 也能被搜到 */
export function filterRelations(
  relations: RelationSummaryItem[],
  filter: RelationFilter,
): RelationSummaryItem[] {
  const q = filter.nameQuery.trim().toLowerCase();
  return relations.filter((r) => {
    if (filter.sourceType !== "" && r.sourceType !== filter.sourceType) {
      return false;
    }
    if (filter.targetType !== "" && r.targetType !== filter.targetType) {
      return false;
    }
    if (filter.relationType !== "" && r.relationType !== filter.relationType) {
      return false;
    }
    if (q) {
      const source = (r.sourceName ?? r.sourceId).toLowerCase();
      const target = (r.targetName ?? r.targetId).toLowerCase();
      if (!source.includes(q) && !target.includes(q)) {
        return false;
      }
    }
    return true;
  });
}

/** 端点类型徽标（人物/设定/地点/伏笔/大纲节点）；`shrink-0` = 名称再长也不挤压徽标（名称一侧负责截断） */
function EndpointBadge({ type }: { type: string }) {
  return <TypeChip className="shrink-0">{ENDPOINT_TYPE_LABEL[type] ?? type}</TypeChip>;
}

/** 端点名（含徽标）：**徽标恒在名称前**（徽标在尾时其 x 随名称长度浮动，跨行落不到同一竖线——DESIGN.md §relations-view）；
 * 四类实体跳实体详情；大纲节点（S12.2 起）跳节点详情 #/outline/:nodeId；未知类型灰显不可点 */
export function EndpointLink({ type, id, name }: { type: string; id: string; name?: string }) {
  const label = name ?? id;
  const clickable = (ENTITY_TYPES as readonly string[]).includes(type) || type === "outline_node";
  if (!clickable) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <EndpointBadge type={type} />
        <span className="min-w-0 truncate text-muted-foreground" title={label}>
          {label}
        </span>
      </span>
    );
  }
  const href =
    type === "outline_node" ? `/outline/${id}` : entityDetailPath(type as EntityType, id);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <EndpointBadge type={type} />
      <button
        type="button"
        onClick={() => navigate(href)}
        title={`打开《${label}》`}
        className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
      >
        {label}
      </button>
    </span>
  );
}

/** 端点显示名（确认框文案用；名称缺失回退 id） */
function endpointLabel(r: RelationSummaryItem, side: "source" | "target"): string {
  const name = side === "source" ? r.sourceName : r.targetName;
  const id = side === "source" ? r.sourceId : r.targetId;
  return name ?? id;
}

export function RelationsView({
  reloadKey,
  onOpenCreate,
  scope,
}: {
  /** 外部重载信号（建立关联成功后由宿主 +1，触发重拉） */
  reloadKey: number;
  /** 打开建立关联对话框（空态按钮用；宿主持有对话框） */
  onOpenCreate: () => void;
  /** 端点范围（S12.2 大纲节点详情页用）：仅查该端点作为 source 的 1 跳关系（服务端过滤），隐藏前端过滤区 */
  scope?: { type: string; id: string };
}) {
  const [relations, setRelations] = useState<RelationSummaryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 内部重载计数（错误重试 / 删除后刷新） */
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<RelationFilter>(EMPTY_RELATION_FILTER);
  const [deleteTarget, setDeleteTarget] = useState<RelationSummaryItem | null>(null);
  const [editTarget, setEditTarget] = useState<RelationSummaryItem | null>(null);

  // 拉关系列表：scope 模式按端点过滤（source_type+source_id，depth=1）；
  // 列表模式拉全量（depth=1 双向紧邻；进入 tab 挂载即拉，外部 reloadKey / 内部 tick 变化重拉）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query =
      scope !== undefined
        ? { source_type: scope.type, source_id: scope.id, depth: 1 as const }
        : { depth: 1 as const };
    listRelations(query)
      .then((res) => {
        if (!cancelled) setRelations(res.relations);
      })
      .catch((err) => {
        if (!cancelled) {
          setRelations(null);
          setError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, tick, scope?.type, scope?.id]);

  /** 删除关系（物理删，确认后执行；成功 toast + 重拉） */
  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteRelation(deleteTarget.id);
      useUiStore.getState().showToast("已删除关系");
      setDeleteTarget(null);
      setTick((t) => t + 1);
    } catch (err) {
      throw err; // 冒泡给 ConfirmDialog 内联显示
    }
  }

  const filtered = relations === null ? [] : filterRelations(relations, filter);
  // 关系类型过滤选项 = 预定义全量 ∪ 本页已拉到的自定义类型（本视图本就拉全量，零额外请求）
  const relationTypeFilterOptions = relationTypeSelectOptions(
    RELATION_TYPES,
    relations === null ? [] : customRelationTypeUsages(relations),
  );

  return (
    <div>
      {/* 页头控件行（由本视图渲染，工具栏随视图结构）：左=搜索/源类型/目标类型/关系类型；右=建立关联
          （前端过滤；scope 模式隐藏——列表已按端点过滤，操作入口由宿主详情页给） */}
      {scope === undefined && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {/* 搜索固定在最左（DESIGN.md「中栏页头结构」） */}
          <div className="w-48">
            <Input
              prefix={<SearchOutlined />}
              allowClear
              value={filter.nameQuery}
              onChange={(e) => setFilter((f) => ({ ...f, nameQuery: e.target.value }))}
              placeholder="搜索源/目标名称…"
            />
          </div>
          <Select
            size="medium"
            value={filter.sourceType === "" ? undefined : filter.sourceType}
            onChange={(value) =>
              setFilter((f) => ({ ...f, sourceType: value === undefined ? "" : String(value) }))
            }
            aria-label="源端点类型过滤"
            prefix={<span className="text-xs text-muted-foreground">源</span>}
            placeholder="全部类型"
            allowClear
            style={{ minWidth: 140 }}
            options={ENDPOINT_TYPE_FILTER_OPTIONS}
          />
          <Select
            size="medium"
            value={filter.targetType === "" ? undefined : filter.targetType}
            onChange={(value) =>
              setFilter((f) => ({ ...f, targetType: value === undefined ? "" : String(value) }))
            }
            aria-label="目标端点类型过滤"
            prefix={<span className="text-xs text-muted-foreground">目标</span>}
            placeholder="全部类型"
            allowClear
            style={{ minWidth: 140 }}
            options={ENDPOINT_TYPE_FILTER_OPTIONS}
          />
          <Select
            size="medium"
            value={filter.relationType === "" ? undefined : filter.relationType}
            onChange={(value) =>
              setFilter((f) => ({ ...f, relationType: value === undefined ? "" : String(value) }))
            }
            aria-label="关系类型过滤"
            placeholder="全部关系类型"
            allowClear
            style={{ minWidth: 140 }}
            options={relationTypeFilterOptions}
          />
          <Button type="primary" className="ml-auto" onClick={onOpenCreate}>
            + 建立关联
          </Button>
        </div>
      )}

      {/* 页头分割线（本视图渲染控件行 → 分割线同由此处放，与 `PageHeader` 同一实现；
          scope 模式无控件行也无分割线） */}
      {scope === undefined && <PageDivider className="mb-4" />}

      {/* 错误态：请求失败 → 区块内重试 */}
      {error !== null && (
        <Alert
          className="mb-3"
          type="error"
          showIcon
          message={
            error === CLIENT_NETWORK_ERROR
              ? "无法连接服务，请确认 ai-editor 服务已启动。"
              : "关系加载失败，请重试。"
          }
          action={
            <Button size="small" onClick={() => setTick((t) => t + 1)}>
              重试
            </Button>
          }
        />
      )}

      {/* 加载骨架（首次加载） */}
      {loading && relations === null && error === null && (
        <div className="rounded-md border border-border p-3">
          <Skeleton active title={false} paragraph={{ rows: 5 }} />
        </div>
      )}

      {/* 空态两种：无任何关系 vs 过滤无结果（均走 EmptyState 虚线卡） */}
      {!loading && relations !== null && relations.length === 0 && (
        <EmptyState
          padding="sm"
          action={
            <Button type="primary" onClick={onOpenCreate}>
              + 建立关联
            </Button>
          }
        >
          还没有关联，建立一条
        </EmptyState>
      )}
      {!loading && relations !== null && relations.length > 0 && filtered.length === 0 && (
        <EmptyState
          padding="sm"
          action={<Button onClick={() => setFilter(EMPTY_RELATION_FILTER)}>清空过滤</Button>}
        >
          没有匹配的关联
        </EmptyState>
      )}

      {/* 关联列表：scope 模式行 = 关系类型 → 目标 + [删除]（源固定为本端点）；列表模式三列（源/关系/目标） */}
      {!loading && relations !== null && filtered.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          {scope === undefined && (
            /* 表头：源 / 关系 / 目标 */
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span className="w-1/4 shrink-0">源</span>
              <span className="w-1/4 shrink-0">关系</span>
              <span className="flex-1">目标</span>
              <span className="w-14 shrink-0" />
            </div>
          )}
          <ul className="divide-y divide-border">
            {filtered.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                {scope !== undefined ? (
                  <>
                    <TypeChip className="shrink-0 truncate">
                      {relationTypeLabel(r.relationType)} →
                    </TypeChip>
                    <span className="min-w-0 flex-1">
                      <EndpointLink type={r.targetType} id={r.targetId} name={r.targetName} />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-1/4 min-w-0 shrink-0">
                      <EndpointLink type={r.sourceType} id={r.sourceId} name={r.sourceName} />
                    </span>
                    {/* 关系类型列：等宽 1/4 + 左对齐（与源/目标列、表头同列同对齐——居中会让 chip 相对表头位移） */}
                    <div className="w-1/4 min-w-0 shrink-0">
                      <TypeChip className="max-w-full truncate">
                        {relationTypeLabel(r.relationType)} →
                      </TypeChip>
                    </div>
                    <span className="min-w-0 flex-1">
                      <EndpointLink type={r.targetType} id={r.targetId} name={r.targetName} />
                    </span>
                  </>
                )}
                {/* 编辑说明（label / description）——按钮在删除左侧；保存后走既有重载路径 */}
                <Button
                  color="default" variant="text"
                  size="small"
                  aria-label={`编辑关系说明（${endpointLabel(r, "source")} → ${endpointLabel(r, "target")}）`}
                  title="编辑说明"
                  icon={<EditOutlined />}
                  onClick={() => setEditTarget(r)}
                />
                <Button
                  color="danger" variant="text"
                  size="small"
                  aria-label={`删除关系（${endpointLabel(r, "source")} → ${endpointLabel(r, "target")}）`}
                  title="删除（物理删，可重新建立）"
                  icon={<DeleteOutlined />}
                  onClick={() => setDeleteTarget(r)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 编辑关系说明（metadata 整体替换；成功 → toast + 重拉） */}
      {editTarget && (
        <EditRelationDialog
          relation={editTarget}
          onSaved={() => setTick((t) => t + 1)}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* 删关系确认（物理删，不可恢复，可重新建立——与详情页文案一致） */}
      {deleteTarget && (
        <ConfirmDialog
          title="删除关系"
          description={`删除关系「${endpointLabel(deleteTarget, "source")} ${relationTypeLabel(deleteTarget.relationType)} ${endpointLabel(deleteTarget, "target")}」？物理删除不可恢复，可重新建立。`}
          confirmLabel="删除"
          danger
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
