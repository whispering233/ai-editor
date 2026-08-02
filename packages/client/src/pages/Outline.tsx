// 大纲树页面（S2.3；替换 T7.1 占位壳）
// 路由：#/outline；数据：GET /api/v1/outline（整树）；操作：POST/PUT/DELETE /outline、PUT /project/config（设当前位置）
// 设计契约：doc/ui/pages/outline.md——整树渲染（卷→章→场景缩进 + 折叠）、⋯ 菜单（编辑/新建子节点/移动到…/
//   设为当前位置/移入回收站）、MVP 拖拽兜底用「移动到…」对话框、软删确认 + 级联计数 toast、回收站折叠区
// 刷新策略：所有写操作成功后统一 loadOutline() 重拉整树（服务端权威——move 重排 order、软删级联子树、
//   还原级联；本地补丁易与服务端不一致；本地文件读取毫秒级，重拉成本可忽略）。outline 树数据仍在
//   project store（跨页共用：顶栏当前位置标题映射、画布投影），本页只持有 UI 态（折叠/操作条/对话框/回收站）
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { formatTimestamp } from "@ai-editor/shared";
import type { OutlineNode } from "@ai-editor/shared";
import { CHILD_TYPE, ConfirmDialog, CreateNodeDialog, EditNodeDialog, MoveNodeDialog, TYPE_LABEL } from "../components/outline/dialogs";
import { Button } from "../components/ui/button";
import {
  ApiError,
  deleteOutlineNode,
  getTrashList,
  purgeOutlineNode,
  restoreOutlineNode,
  type OutlineNodeType,
  type TrashOutlineNode,
} from "../lib/api";
import { cn } from "../lib/utils";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 页面级对话框状态（创建/编辑/移动） */
type DialogState =
  | { kind: "create"; type?: OutlineNodeType; parentId?: string; lockedType?: OutlineNodeType }
  | { kind: "edit"; node: OutlineNode }
  | { kind: "move"; node: OutlineNode }
  | null;

/** 错误码 → 页级横幅文案（layout.md §3.2：各页定义映射） */
function describeOutlineError(code: string | null): string {
  switch (code) {
    case "OUTLINE_NODE_NOT_FOUND":
      return "节点不存在（可能已被彻底删除），大纲已刷新";
    case "CLIENT_NETWORK_ERROR":
      return "无法连接服务，请确认 ai-editor 服务已启动";
    default:
      return "操作失败，请稍后重试";
  }
}

export default function Outline() {
  const outline = useProjectStore((s) => s.outline);
  const outlineLoading = useProjectStore((s) => s.outlineLoading);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const loadOutline = useProjectStore((s) => s.loadOutline);
  const updateConfig = useProjectStore((s) => s.updateConfig);

  // 首次加载标记：loadOutline 在 store 内静默吞错，用 loadAttempted 呈现「加载失败 + 重试」
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 折叠的节点 id 集合（空集 = 全部展开） */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 当前展开操作条（⋯）的节点 id；null = 无 */
  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  /** 软删确认目标（⋯ 菜单「移入回收站」） */
  const [deleteTarget, setDeleteTarget] = useState<OutlineNode | null>(null);
  /** 彻底删除确认目标（回收站列表） */
  const [purgeTarget, setPurgeTarget] = useState<TrashOutlineNode | null>(null);
  const [busy, setBusy] = useState(false);
  /** 新创建节点高亮（原型「成功后新节点高亮」；3s 自动消失） */
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  // 回收站（大纲节点）折叠区状态
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashNodes, setTrashNodes] = useState<TrashOutlineNode[] | null>(null);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  /** 还原失败行内错误（如 409 OUTLINE_ANCESTOR_DELETED「需先还原祖先」） */
  const [trashActionError, setTrashActionError] = useState<string | null>(null);

  const noProject = config === null && !configLoading;

  // 首次加载：outline 未加载且未尝试过 → loadOutline
  useEffect(() => {
    if (outline === null && !outlineLoading && !loadAttempted) {
      setLoadAttempted(true);
      void loadOutline();
    }
  }, [outline, outlineLoading, loadAttempted, loadOutline]);

  // 新节点高亮自动消失（3s；每次设置高亮重开定时器）
  useEffect(() => {
    if (highlightedNodeId === null) return;
    const t = setTimeout(() => setHighlightedNodeId(null), 3000);
    return () => clearTimeout(t);
  }, [highlightedNodeId]);

  /** 加载回收站大纲节点列表 */
  async function loadTrash() {
    if (trashLoading) return;
    setTrashLoading(true);
    setTrashError(null);
    try {
      const res = await getTrashList();
      setTrashNodes(res.nodes);
    } catch (err) {
      setTrashNodes(null);
      setTrashError(err instanceof ApiError ? err.message : "回收站加载失败，请重试");
    } finally {
      setTrashLoading(false);
    }
  }

  /** 树变更后的统一刷新：展开目标父 + 重拉整树（刷新策略注释见文件头）；
   * highlightNodeId：创建成功后高亮新节点（原型「成功后自动展开父节点、新节点高亮」） */
  async function afterTreeChanged(expandParentId?: string, highlightNodeId?: string) {
    if (expandParentId) expand(expandParentId);
    await loadOutline();
    if (highlightNodeId) setHighlightedNodeId(highlightNodeId);
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 展开节点（collapsed 中移除该 id） */
  function expand(id: string) {
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  /** 收集所有有子节点的 id（「全部折叠」用）；scene 是叶子（判别收窄：node.type !== "scene"） */
  function collectParentIds(nodes: OutlineNode[], acc: string[] = []): string[] {
    for (const n of nodes) {
      if (n.type !== "scene" && n.children && n.children.length > 0) {
        acc.push(n.id);
        collectParentIds(n.children, acc);
      }
    }
    return acc;
  }

  /** ⋯ 菜单「设为当前位置」→ PUT /project/config（顶栏同步联动，layout.md §2.1） */
  async function handleSetCurrent(node: OutlineNode) {
    setBusy(true);
    try {
      await updateConfig({ current_position: node.id });
      useUiStore.getState().showToast("已设为当前位置");
      setOpenActionsFor(null);
    } catch {
      useUiStore.getState().showToast("设置失败：该节点可能已删除，无法设为当前位置", "error");
    } finally {
      setBusy(false);
    }
  }

  /** 软删确认后执行；OUTLINE_NODE_NOT_FOUND（已被 purge）→ 横幅 + 刷新树；其余错误冒泡给确认框显示 */
  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await deleteOutlineNode(deleteTarget.id);
      const { children, relations, deltas } = res.cascaded;
      const parts: string[] = [];
      if (children > 0) parts.push(`${children} 个子节点`);
      if (relations > 0) parts.push(`${relations} 条关联`);
      if (deltas > 0) parts.push(`${deltas} 条变化记录`);
      useUiStore.getState().showToast(
        `已移入回收站${parts.length > 0 ? `（含 ${parts.join("、")}）` : ""}`,
      );
      setDeleteTarget(null);
      setOpenActionsFor(null);
      await afterTreeChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === "OUTLINE_NODE_NOT_FOUND") {
        setError(describeOutlineError("OUTLINE_NODE_NOT_FOUND"));
        setDeleteTarget(null);
        setOpenActionsFor(null);
        await afterTreeChanged();
        return; // 已处理，不冒泡
      }
      throw err; // 冒泡给 ConfirmDialog 内联显示
    }
  }

  /** 回收站「还原」；409 OUTLINE_ANCESTOR_DELETED → 行内提示「需先还原祖先」。
   * MVP 边界（oracle 标注）：TrashOutlineNode 无 parentId 字段，还原后无法定位祖先展开——
   *   树重拉后还原的节点若在折叠祖先下需手动展开；未来 Trash 列表扩展 parentId 或展开全部后处理 */
  async function handleRestore(node: TrashOutlineNode) {
    setTrashActionError(null);
    setBusy(true);
    try {
      const res = await restoreOutlineNode(node.id);
      useUiStore.getState().showToast(
        `已还原《${node.title}》${res.restoredChildren > 0 ? `（含 ${res.restoredChildren} 个子节点）` : ""}`,
      );
      await afterTreeChanged();
      await loadTrash();
    } catch (err) {
      if (err instanceof ApiError && err.code === "OUTLINE_ANCESTOR_DELETED") {
        setTrashActionError("该节点的祖先仍在回收站，需先还原祖先");
      } else {
        setTrashActionError(err instanceof ApiError ? err.message : "还原失败，请重试");
      }
    } finally {
      setBusy(false);
    }
  }

  /** 回收站「彻底删除」（purge 不可恢复）；错误冒泡给确认框显示 */
  async function handlePurge() {
    if (!purgeTarget) return;
    try {
      await purgeOutlineNode(purgeTarget.id);
      useUiStore.getState().showToast("已彻底删除");
      setPurgeTarget(null);
      await loadTrash();
    } catch (err) {
      throw err;
    }
  }

  /** 整树渲染（内部递归函数，闭包共享页面 state，避免 props 爆炸；行结构见原型「行结构」注释） */
  function renderNodes(nodes: OutlineNode[], depth: number): ReactNode {
    return nodes.map((node) => {
      const hasChildren = node.type !== "scene" && (node.children?.length ?? 0) > 0;
      const isCollapsed = collapsed.has(node.id);
      const isCurrent = config?.currentPosition === node.id;
      const actionsOpen = openActionsFor === node.id;
      const childType = CHILD_TYPE[node.type];
      return (
        <div key={node.id}>
          {/* 行：折叠箭头 | 类型徽标 | 标题 | 摘要 | 更新于 | 当前位置徽标 | ⋯ */}
          <div
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-50",
              actionsOpen && "bg-zinc-50",
              node.id === highlightedNodeId && "bg-amber-50",
            )}
            style={{ paddingLeft: depth * 20 + 8 }}
          >
            {hasChildren ? (
              <button
                type="button"
                className="w-4 shrink-0 text-zinc-400 hover:text-zinc-600"
                onClick={() => toggleCollapsed(node.id)}
                aria-label={isCollapsed ? "展开" : "折叠"}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
              {TYPE_LABEL[node.type]}
            </span>
            <span className="min-w-0 truncate text-sm text-zinc-800">{node.title}</span>
            {node.summary && (
              <span className="hidden min-w-0 flex-1 truncate text-xs text-zinc-400 md:inline">
                {node.summary}
              </span>
            )}
            <span className="ml-auto shrink-0 text-xs text-zinc-400">{formatTimestamp(node.updatedAt)}</span>
            {isCurrent && (
              <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                当前位置
              </span>
            )}
            <button
              type="button"
              className="shrink-0 px-1 text-zinc-400 hover:text-zinc-700"
              onClick={() => setOpenActionsFor(actionsOpen ? null : node.id)}
              aria-label="操作菜单"
            >
              ⋯
            </button>
          </div>
          {/* ⋯ 操作条（行内展开，替代浮层菜单——MVP 简化，交互语义与原型 ⋯ 菜单一致） */}
          {actionsOpen && (
            <div
              className="mb-1 flex flex-wrap items-center gap-1.5 py-1"
              style={{ paddingLeft: depth * 20 + 44 }}
            >
              <button
                type="button"
                className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100"
                onClick={() => {
                  setDialog({ kind: "edit", node });
                  setOpenActionsFor(null);
                }}
              >
                编辑
              </button>
              {childType !== null && (
                <button
                  type="button"
                  className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100"
                  onClick={() => {
                    setDialog({ kind: "create", type: childType, parentId: node.id });
                    setOpenActionsFor(null);
                  }}
                >
                  新建{TYPE_LABEL[childType]}
                </button>
              )}
              <button
                type="button"
                className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100"
                onClick={() => {
                  setDialog({ kind: "move", node });
                  setOpenActionsFor(null);
                }}
              >
                移动到…
              </button>
              <button
                type="button"
                disabled={isCurrent || busy}
                className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
                onClick={() => void handleSetCurrent(node)}
              >
                设为当前位置
              </button>
              <button
                type="button"
                className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                onClick={() => {
                  setDeleteTarget(node);
                  setOpenActionsFor(null);
                }}
              >
                移入回收站
              </button>
            </div>
          )}
          {hasChildren && !isCollapsed && (
            <div>{renderNodes(node.children ?? [], depth + 1)}</div>
          )}
        </div>
      );
    });
  }

  /** 全部展开/折叠切换 */
  function toggleAllCollapse() {
    if (!outline) return;
    if (collapsed.size > 0) setCollapsed(new Set());
    else setCollapsed(new Set(collectParentIds(outline.children)));
  }

  return (
    <section>
      {/* 标题区：操作工具条 */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">大纲</h1>
        <div className="flex gap-2">
          <Button variant="outline" type="button" onClick={toggleAllCollapse} disabled={!outline || outline.children.length === 0}>
            {collapsed.size > 0 ? "全部展开" : "全部折叠"}
          </Button>
          <Button type="button" onClick={() => setDialog({ kind: "create" })}>
            + 新建节点
          </Button>
        </div>
      </div>

      {/* 页级错误横幅 */}
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {noProject ? (
        /* 未打开项目：引导回首页（侧栏无项目可点的现状接受项，S1.6 文档已说明） */
        <div className="rounded-md border border-dashed border-zinc-300 px-6 py-10 text-center">
          <p className="text-sm text-zinc-600">未打开项目，无法编辑大纲</p>
          <a href="#/" className="mt-2 inline-block text-sm text-zinc-500 underline hover:text-zinc-700">
            回到首页打开或创建书籍
          </a>
        </div>
      ) : outlineLoading && outline === null ? (
        /* 加载骨架 */
        <div className="space-y-2 rounded-md border border-zinc-200 p-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-5 animate-pulse rounded bg-zinc-100"
              style={{ width: `${92 - (i % 3) * 24}%`, marginLeft: (i % 3) * 20 }}
            />
          ))}
        </div>
      ) : outline === null ? (
        /* 加载失败（loadOutline 静默吞错后的兜底呈现） */
        <div className="rounded-md border border-zinc-200 p-4 text-sm text-zinc-600">
          大纲加载失败
          <Button
            variant="outline"
            className="ml-3"
            type="button"
            onClick={() => setLoadAttempted(false)}
          >
            重试
          </Button>
        </div>
      ) : outline.children.length === 0 ? (
        /* 空态：主按钮「新建第一卷」（类型锁定 volume，原型） */
        <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center">
          <p className="text-sm text-zinc-600">大纲还是空的，先建第一卷</p>
          <p className="mt-1 text-xs text-zinc-400">大纲是三层结构：卷 → 章 → 场景</p>
          <Button className="mt-4" type="button" onClick={() => setDialog({ kind: "create", lockedType: "volume" })}>
            新建第一卷
          </Button>
        </div>
      ) : (
        /* 整树渲染 */
        <div className="rounded-md border border-zinc-200 p-2">{renderNodes(outline.children, 0)}</div>
      )}

      {/* 回收站折叠区（大纲节点侧；#/trash 完整回收站页面由后续卡实现） */}
      <div className="mt-6 border-t border-zinc-100 pt-3">
        <button
          type="button"
          className="text-sm text-zinc-500 hover:text-zinc-700"
          onClick={() => {
            setTrashOpen((v) => !v);
            if (!trashOpen && trashNodes === null && !trashLoading) void loadTrash();
          }}
        >
          {trashOpen ? "▾ " : "▸ "}回收站（大纲节点）
        </button>
        {trashOpen && (
          <div className="mt-2">
            {trashLoading && <p className="text-sm text-zinc-500">加载中…</p>}
            {trashError !== null && (
              <p className="text-sm text-red-600">
                {trashError}{" "}
                <button type="button" className="underline" onClick={() => void loadTrash()}>
                  重试
                </button>
              </p>
            )}
            {!trashLoading && trashError === null && trashNodes !== null && (
              trashNodes.length === 0 ? (
                <p className="text-sm text-zinc-500">回收站没有大纲节点</p>
              ) : (
                <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
                  {trashNodes.map((n) => (
                    <li key={n.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
                        {TYPE_LABEL[n.type]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-700">{n.title}</span>
                      <span className="shrink-0 text-xs text-zinc-400">{formatTimestamp(n.deletedAt)}</span>
                      <button
                        type="button"
                        disabled={busy}
                        className="shrink-0 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
                        onClick={() => void handleRestore(n)}
                      >
                        还原
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="shrink-0 rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                        onClick={() => setPurgeTarget(n)}
                      >
                        彻底删除
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
            {trashActionError !== null && (
              <p className="mt-2 text-sm text-red-600">{trashActionError}</p>
            )}
          </div>
        )}
      </div>

      {/* 对话框 */}
      {dialog?.kind === "create" && (
        <CreateNodeDialog
          nodes={outline?.children ?? []}
          initialType={dialog.type}
          initialParentId={dialog.parentId}
          lockedType={dialog.lockedType}
          onCreated={afterTreeChanged}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "edit" && (
        <EditNodeDialog node={dialog.node} onSaved={afterTreeChanged} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "move" && (
        <MoveNodeDialog
          node={dialog.node}
          nodes={outline?.children ?? []}
          onMoved={afterTreeChanged}
          onClose={() => setDialog(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="移入回收站"
          description={`将《${deleteTarget.title}》移入回收站。子节点与关联的关系、变化记录将一并移入，可在回收站还原。`}
          confirmLabel="移入回收站"
          danger
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {purgeTarget && (
        <ConfirmDialog
          title="彻底删除"
          description={`将《${purgeTarget.title}》及其全部子节点彻底删除，不可恢复。此操作仅用于回收站清理，请确认。`}
          confirmLabel="彻底删除"
          danger
          onConfirm={handlePurge}
          onClose={() => setPurgeTarget(null)}
        />
      )}
    </section>
  );
}
