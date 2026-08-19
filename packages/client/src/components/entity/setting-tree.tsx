// 设定树视图（批次四 I4，决策 30 + 批次八 O5）：实体关系页第 6 个 tab「设定树」。
// 契约：doc/ui/pages/entity-list.md「设定树 Tab」——全量 setting + 全量 belongs_to 层级边
// → buildSettingTree 组装递归树；父节点折叠箭头（默认全展开）、节点行 = 名称 + 类别徽标 +
// 直接子数、点击跳详情；只读视图（改父在详情页「层级」区块单一入口）；设定 > 200 截断提示 +
// 父截断提升为根防御。顶栏「全部展开 / 全部折叠」按钮（O5 起：展开态提升到视图层 collapsedIds，
// 缺省空 = 全展开；全部折叠 = 收集所有非叶子 id 仅保留根级）。样式 token 类（layout.md §3），
// 重试按钮带边框（H4）。
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { listEntities, listRelations } from "../../lib/api";
import {
  buildSettingTree,
  expandableSettingNodeIds,
  type SettingTreeNode,
} from "../../lib/setting-tree";
import { cn } from "../../lib/utils";
import { skeletonClass } from "../../lib/styles";
import { EmptyState } from "../ui/empty-state";
import { navigate } from "../../hooks/use-route";

/** 设定树拉取上限（listEntities limit 最大 200；超量截断提示 + 孤儿提升防御） */
const TREE_SETTING_LIMIT = 200;

function SettingTreeNodeRow({
  node,
  depth,
  collapsedIds,
  onToggle,
}: {
  node: SettingTreeNode;
  depth: number;
  /** 折叠节点 id 集合（O5 起提升，受控：节点展开态 = !collapsedIds.has(node.id)） */
  collapsedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const expanded = !collapsedIds.has(node.id);
  return (
    <li>
      <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: `${depth * 16}px` }}>
        {/* 折叠箭头（叶子占位保缩进对齐）；点击切展开态，不跳转 */}
        <button
          type="button"
          aria-label={hasChildren ? (expanded ? "折叠" : "展开") : undefined}
          className={cn(
            "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground",
            !hasChildren && "invisible",
          )}
          onClick={() => onToggle(node.id)}
          disabled={!hasChildren}
        >
          <svg
            viewBox="0 0 16 16"
            className={cn("size-3.5 transition-transform", !expanded && "-rotate-90")}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="m6 4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => navigate(`/entities/setting/${node.id}`)}
          title={`打开《${node.name}》`}
          className="min-w-0 truncate rounded-md px-1 py-0.5 text-sm text-foreground hover:bg-muted hover:text-foreground"
        >
          {node.name}
        </button>
        {node.category && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {node.category}
          </span>
        )}
        {hasChildren && (
          <span className="shrink-0 text-xs text-muted-foreground/70">
            {node.children.length} 个子设定
          </span>
        )}
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => (
            <SettingTreeNodeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              collapsedIds={collapsedIds}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SettingTreeView({ reloadKey }: { reloadKey: number }) {
  const [roots, setRoots] = useState<SettingTreeNode[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [hasOrphanEdges, setHasOrphanEdges] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 内部重载计数（错误重试） */
  const [tick, setTick] = useState(0);
  /** 折叠节点 id 集合（O5 起提升到视图层，缺省空 = 全展开，支持顶栏全部展开/折叠）；
   *  reload/tick 重拉后指向已删 id 的残留无害、不清空（集合只作存在性判断） */
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  /** 单个节点折叠切换（可展开节点 onToggle；叶子 disabled 不触发） */
  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 全部折叠：收集所有非叶子节点 id（仅保留根级，叶子无箭头不在集合） */
  function collapseAll() {
    if (roots === null) return;
    setCollapsedIds(new Set(expandableSettingNodeIds(roots)));
  }

  /** 全部展开：清空折叠集合 */
  function expandAll() {
    setCollapsedIds(new Set());
  }

  /** 树是否可交互（非加载/非空态/非失败时渲染按钮；加载/空态分支已提前 return） */
  const canToggle = roots !== null && roots.length > 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setRoots(null);
    (async () => {
      try {
        const [settingRes, edgesRes] = await Promise.all([
          listEntities("setting", { limit: TREE_SETTING_LIMIT, sort: "name" }),
          listRelations({
            source_type: "setting",
            target_type: "setting",
            relation_type: "belongs_to",
            depth: 1,
          }),
        ]);
        if (cancelled) return;
        const edges = edgesRes.relations.map((r) => ({
          childId: r.sourceId,
          parentId: r.targetId,
        }));
        const tree = buildSettingTree(settingRes.items, edges);
        setRoots(tree.roots);
        setHasOrphanEdges(tree.hasOrphanEdges);
        setTruncated(settingRes.total > TREE_SETTING_LIMIT); // total 为准（截断提示）
      } catch {
        if (!cancelled) setFailed(true);
        setRoots(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, tick]);

  if (failed) {
    return (
      <div className="mt-3 flex items-center justify-center gap-3 rounded-md border border-border px-3 py-6 text-sm text-muted-foreground">
        设定树加载失败
        <Button variant="outline" type="button" size="sm" onClick={() => setTick((t) => t + 1)}>
          重试
        </Button>
      </div>
    );
  }

  if (loading && roots === null) {
    return (
      <div className="mt-3 flex flex-col gap-1">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className={cn(skeletonClass, "h-7")}
            style={{ marginLeft: `${(i % 3) * 16}px` }}
          />
        ))}
      </div>
    );
  }

  if (roots !== null && roots.length === 0) {
    return (
      <EmptyState
        className="mt-3"
        action={
          <Button type="button" onClick={() => navigate("/entities/setting")}>
            去「设定」tab 新建
          </Button>
        }
      >
        还没有设定，先新建一个吧
      </EmptyState>
    );
  }

  return (
    <div className="mt-3">
      {/* 顶栏操作：全部展开 / 全部折叠（批次八 O5，与大纲页顶栏同款 border 文字按钮，H4） */}
      <div className="mb-2 flex items-center gap-2">
        <Button variant="outline" type="button" size="sm" disabled={!canToggle} onClick={expandAll}>
          全部展开
        </Button>
        <Button
          variant="outline"
          type="button"
          size="sm"
          disabled={!canToggle}
          onClick={collapseAll}
        >
          全部折叠
        </Button>
      </div>
      <ul>
        {roots?.map((n) => (
          <SettingTreeNodeRow
            key={n.id}
            node={n}
            depth={0}
            collapsedIds={collapsedIds}
            onToggle={toggleCollapse}
          />
        ))}
      </ul>
      {(truncated || hasOrphanEdges) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {truncated
            ? `设定数量超过 ${TREE_SETTING_LIMIT}，仅展示前 ${TREE_SETTING_LIMIT} 个（可按名称搜索定位）；`
            : ""}
          {hasOrphanEdges ? "部分设定的上级未在展示范围内，已作为独立节点展示。" : ""}
        </p>
      )}
    </div>
  );
}
