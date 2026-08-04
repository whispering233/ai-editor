// 关联 tab 视图（U8；契约 doc/ui/pages/entity-list.md「关联 Tab（实体关系总览）」）
// 数据：GET /api/v1/relation?depth=1 一次拉全量（MVP 关系量级小），过滤全部前端实现：
//   服务端 source_type+target_type 同时传是 AND 语义，无法表达「任一端」OR 过滤；名称 q 服务端也不支持。
// 过滤（filterRelations 纯函数，可单测）：端点类型（sourceType/targetType 任一匹配）/ 关系类型 /
//   名称（sourceName/targetName 包含、大小写不敏感；名称可能 undefined——回退 id）。
// 行：源名（端点类型徽标）→ 关系类型标签（relationTypeLabel + 方向箭头 →）→ 目标名（徽标）→ [删除]；
//   端点名为四类实体时点击跳详情 #/entities/:type/:id；大纲节点（S12.2 起）跳 #/outline/:nodeId。
// 删除：ConfirmDialog 物理删确认（不可恢复，可重新建立）→ DELETE → toast「已删除关系」→ 重拉。
// 空态两种：无任何关系「还没有关联，建立一条」+ [建立关联]；过滤无结果「没有匹配的关联」+ [清空过滤]。
// scope 模式（S12.2 大纲节点详情页）：传入端点范围 → 服务端过滤该端点作为 source 的关系
//   （source_type+source_id，depth=1），隐藏前端过滤区（列表短，无过滤必要）。
// 样式 token 类（layout.md §3，禁止硬编码色类）。
import { useEffect, useState } from "react";
import { ENTITY_TYPES, RELATION_TYPES } from "@whispering233/ai-editor-shared";
import { ApiError, CLIENT_NETWORK_ERROR, deleteRelation, listRelations } from "../../lib/api";
import type { RelationSummaryItem } from "../../lib/api";
import { relationTypeLabel } from "../../lib/entity-detail";
import { ConfirmDialog } from "../outline/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { navigate } from "../../hooks/use-route";
import { useUiStore } from "../../stores/ui";

/** 端点类型 → 中文徽标（relation_records 端点类型，schema.md；未知原样显示） */
export const ENDPOINT_TYPE_LABEL: Record<string, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  outline_node: "大纲节点",
};

/** 过滤条件（"" = 全部） */
export interface RelationFilter {
  /** 端点类型：sourceType 或 targetType 任一匹配（服务端 AND 语义无法表达，前端过滤） */
  endpointType: string;
  /** 关系类型 */
  relationType: string;
  /** 名称关键词（源/目标名称包含；大小写不敏感；trim 后为空忽略） */
  nameQuery: string;
}

export const EMPTY_RELATION_FILTER: RelationFilter = {
  endpointType: "",
  relationType: "",
  nameQuery: "",
};

/** 按过滤条件筛选关系（纯函数；名称缺失回退 id，id 也能被搜到） */
export function filterRelations(relations: RelationSummaryItem[], filter: RelationFilter): RelationSummaryItem[] {
  const q = filter.nameQuery.trim().toLowerCase();
  return relations.filter((r) => {
    if (filter.endpointType !== "" && r.sourceType !== filter.endpointType && r.targetType !== filter.endpointType) {
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

/** 端点类型徽标（人物/设定/地点/伏笔/大纲节点） */
function EndpointBadge({ type }: { type: string }) {
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      {ENDPOINT_TYPE_LABEL[type] ?? type}
    </span>
  );
}

/** 端点名（含徽标）：四类实体跳实体详情；大纲节点（S12.2 起）跳节点详情 #/outline/:nodeId；未知类型灰显不可点 */
function EndpointLink({ type, id, name }: { type: string; id: string; name?: string }) {
  const label = name ?? id;
  const clickable =
    (ENTITY_TYPES as readonly string[]).includes(type) || type === "outline_node";
  if (!clickable) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-muted-foreground" title={label}>
          {label}
        </span>
        <EndpointBadge type={type} />
      </span>
    );
  }
  const href = type === "outline_node" ? `/outline/${id}` : `/entities/${type}/${id}`;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => navigate(href)}
        title={`打开《${label}》`}
        className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
      >
        {label}
      </button>
      <EndpointBadge type={type} />
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

  return (
    <div>
      {/* 过滤区：端点类型 + 关系类型 + 名称搜索（前端过滤；scope 模式隐藏——列表已按端点过滤） */}
      {scope === undefined && (
        <div className="mb-2 mt-3 flex flex-wrap items-center gap-3">
          <select
            value={filter.endpointType}
            onChange={(e) => setFilter((f) => ({ ...f, endpointType: e.target.value }))}
            aria-label="端点类型过滤"
            className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">全部端点类型</option>
            {Object.entries(ENDPOINT_TYPE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={filter.relationType}
            onChange={(e) => setFilter((f) => ({ ...f, relationType: e.target.value }))}
            aria-label="关系类型过滤"
            className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">全部关系类型</option>
            {RELATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {relationTypeLabel(t)}
              </option>
            ))}
          </select>
          <Input
            value={filter.nameQuery}
            onChange={(e) => setFilter((f) => ({ ...f, nameQuery: e.target.value }))}
            placeholder="搜索源/目标名称…"
            className="w-52"
          />
        </div>
      )}

      {/* 错误态：请求失败 → 区块内重试 */}
      {error !== null && (
        <div className="mb-3 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {error === CLIENT_NETWORK_ERROR ? "无法连接服务，请确认 ai-editor 服务已启动。" : "关系加载失败，请重试。"}
          <Button variant="outline" className="ml-3" type="button" onClick={() => setTick((t) => t + 1)}>
            重试
          </Button>
        </div>
      )}

      {/* 加载骨架（首次加载） */}
      {loading && relations === null && error === null && (
        <div className="overflow-hidden rounded-md border border-border">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-0">
              <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/6 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
              <div className="ml-auto h-4 w-12 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {/* 空态两种：无任何关系 vs 过滤无结果 */}
      {!loading && relations !== null && relations.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">还没有关联，建立一条</p>
          <Button className="mt-4" type="button" onClick={onOpenCreate}>
            + 建立关联
          </Button>
        </div>
      )}
      {!loading && relations !== null && relations.length > 0 && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">没有匹配的关联</p>
          <Button variant="outline" className="mt-4" type="button" onClick={() => setFilter(EMPTY_RELATION_FILTER)}>
            清空过滤
          </Button>
        </div>
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
                    <span className="shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-center text-xs text-muted-foreground">
                      {relationTypeLabel(r.relationType)} →
                    </span>
                    <span className="min-w-0 flex-1">
                      <EndpointLink type={r.targetType} id={r.targetId} name={r.targetName} />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-1/4 min-w-0 shrink-0">
                      <EndpointLink type={r.sourceType} id={r.sourceId} name={r.sourceName} />
                    </span>
                    <span className="w-1/4 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-center text-xs text-muted-foreground">
                      {relationTypeLabel(r.relationType)} →
                    </span>
                    <span className="min-w-0 flex-1">
                      <EndpointLink type={r.targetType} id={r.targetId} name={r.targetName} />
                    </span>
                  </>
                )}
                <Button
                  variant="outline"
                  type="button"
                  className="h-7 w-14 shrink-0 px-2 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteTarget(r)}
                >
                  删除
                </Button>
              </li>
            ))}
          </ul>
        </div>
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
