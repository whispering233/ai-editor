// 大纲画布页（路由 `#/canvas`；契约：docs/ui/DESIGN.md `outline-canvas`）。
//
// 画布是**观察面**，不是第二个大纲页：结构与顺序的唯一编辑入口仍是大纲树——本页拖动卡片
// **只改坐标**（`localStorage` `ai-editor:canvas:{projectId}`，不进 outline.json / 备份 / 云端包），
// 不改父子 / 章序 / 卷归属。
// 节点 = 章（唯一）：卷与场景不上画布，层级由卡片上的卷号徽标表达（components/outline-canvas/ChapterCard）。
// 摆位 = 确定性网格（lib/outline-canvas-layout 纯函数）：缺坐标的章按可见章序每行 8 张补位、
// 已有手工坐标不动、新章落网格末尾；首次进入（无存量视口）→ fitView，有存量视口则恢复。
//
// 连线 = `plot_edge`（章 → 章）：关系的列表是唯一事实源（`listRelations`），边每次从它派生
// （lib/outline-canvas-edges）；建边 / 删边 / 改标签成功后**重拉列表**，不手工 push 平行状态。
// 拖出即连（自连 / 落空静默取消、重复 409 → toast）；点边开右侧抽屉；`Delete` 键先过
// ConfirmDialog 才真删（React Flow 的删除变更被 onEdgesChange 拦下，见 handleEdgesChange）。
// 单击卡片 = 选中并聚焦其邻边（其余边降透明）；点空白取消；双击卡片 = `#/outline/:id`。
//
// 高度链：外壳抵消中栏 p-6 后铺满（`-m-6` + `h-[calc(100%+3rem)]`，同写作页 / 人物工作台），
// 画布容器 `flex-1 min-h-0` 一路到 ReactFlow（`h-full w-full`）——本页不自任滚动容器。
import "@xyflow/react/dist/base.css";
import "../components/outline-canvas/canvas-theme.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
  type OnNodeDrag,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import { Button, ConfigProvider } from "antd";
import { EmptyState } from "../components/ui/empty-state";
import { ChapterCard, type ChapterCardNode } from "../components/outline-canvas/ChapterCard";
import { PlotEdgeDrawer } from "../components/outline-canvas/PlotEdgeDrawer";
import { ConfirmDialog } from "../components/outline/dialogs";
import { useOutlineLoader } from "../hooks/use-outline-loader";
import { navigate } from "../hooks/use-route";
import {
  ApiError,
  createRelation,
  deleteRelation,
  listRelations,
  type RelationSummaryItem,
} from "../lib/api";
import {
  CANVAS_CARD_HEIGHT,
  CANVAS_CARD_WIDTH,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  canvasChapterCards,
  layoutCanvasChapters,
  pruneCanvasPositions,
  readCanvasState,
  writeCanvasState,
  type CanvasChapterCard,
  type CanvasSavedState,
} from "../lib/outline-canvas-layout";
import { buildNodeHookMarks, HOOK_MARK_TYPES, type NodeHookMark } from "../lib/outline-hooks";
import {
  adjacentPlotEdgeIds,
  canvasPlotEdges,
  plotEdgeCreatePayload,
  plotEdgeDeleteTargets,
  PLOT_EDGE_DIM_OPACITY,
  PLOT_EDGE_RELATION_TYPE,
} from "../lib/outline-canvas-edges";
import { errorBannerClass, skeletonClass } from "../lib/styles";
import { cn } from "../lib/utils";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 节点类型表（模块级常量：每次渲染新建对象会让 React Flow 重挂全部节点） */
const NODE_TYPES: NodeTypes = { chapter: ChapterCard };

/** 首帧 fitView 的上界：小书（1–2 章）不放大到满屏，`maxZoom: 1` 保持不变即可 */
const FIT_VIEW_OPTIONS = { padding: 0.1, maxZoom: 1 } as const;

interface CanvasFlowProps {
  projectId: string | null;
  cards: readonly CanvasChapterCard[];
  marks: Map<string, NodeHookMark[]> | null;
}

/** 画布本体：坐标 / 视口只在挂载时读一次（换书 → 外层以 projectId 为 key 重挂） */
function CanvasFlow({ projectId, cards, marks }: CanvasFlowProps) {
  const [saved, setSaved] = useState<CanvasSavedState>(() => readCanvasState(projectId));
  // 首帧视口二选一后**冻结**：落盘的视口不能让 `fitView` prop 翻转——否则 StoreUpdater 会清掉
  // 排队中的 fitView，首次进入就停在左上角（网格有 100 章时尤其明显）
  const initialViewport = useRef(saved.viewport).current;

  const positions = useMemo(() => layoutCanvasChapters(cards, saved.nodes), [cards, saved.nodes]);
  const flowNodes = useMemo<ChapterCardNode[]>(
    () =>
      cards.map((card) => ({
        id: card.id,
        type: "chapter",
        position: positions[card.id] ?? { x: 0, y: 0 },
        data: { card, marks: marks?.get(card.id) ?? [] },
        // 卡片尺寸 = lib 常量（网格步长与卡片几何同源；颜色仍全走主题表 / token 类）
        style: { width: CANVAS_CARD_WIDTH, height: CANVAS_CARD_HEIGHT },
      })),
    [cards, positions, marks],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<ChapterCardNode>(flowNodes);
  // 树 / 标记 / 坐标变化 → 收敛到 flowNodes（拖动中的位置由 onNodesChange 维护）
  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  /** 只放行拖动 / 选中：**节点不可删**（结构只在大纲树里改）——`Delete` 键的删除变更在这里掉 */
  const handleNodesChange = useCallback(
    (changes: NodeChange<ChapterCardNode>[]) =>
      onNodesChange(changes.filter((change) => change.type !== "remove")),
    [onNodesChange],
  );

  // ===== 连线（plot_edge）=====
  // 关系列表是唯一事实源：建边 / 删边 / 改标签成功后一律重拉，边从列表派生（不手工 push）
  const [relations, setRelations] = useState<RelationSummaryItem[] | null>(null);
  const loadPlotEdges = useCallback(async () => {
    try {
      const res = await listRelations({ relation_type: PLOT_EDGE_RELATION_TYPE, depth: 1 });
      setRelations(res.relations);
    } catch {
      // 连线是观察面的增强：拉不到就按「还没有连线」渲染，不阻塞画布、不出错误条
      setRelations([]);
    }
  }, []);
  useEffect(() => {
    void loadPlotEdges();
  }, [loadPlotEdges]);

  /** 获焦章（单击卡片；`null` = 没有聚焦，所有边原样） */
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  /** 抽屉里正在编辑的边（= 关系 id） */
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  /** 待二次确认的边 id（`null` = 没有删除请求） */
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);

  const visibleChapterIds = useMemo(() => new Set(cards.map((card) => card.id)), [cards]);
  const plotEdges = useMemo(
    () => canvasPlotEdges(relations, visibleChapterIds),
    [relations, visibleChapterIds],
  );
  const adjacentEdgeIds = useMemo(
    () => adjacentPlotEdgeIds(plotEdges, focusedNodeId),
    [plotEdges, focusedNodeId],
  );
  const flowEdges = useMemo<Edge[]>(
    () =>
      plotEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // 空标签不传：React Flow 收到 `undefined` 才不画文字（空串会留一个空文本框）
        label: edge.label === "" ? undefined : edge.label,
        style:
          focusedNodeId === null || adjacentEdgeIds.has(edge.id)
            ? undefined
            : { opacity: PLOT_EDGE_DIM_OPACITY },
      })),
    [plotEdges, focusedNodeId, adjacentEdgeIds],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flowEdges);
  // 关系列表 / 聚焦章变化 → 收敛到 flowEdges（选中态由 onEdgesChange 维护）
  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  /** 只放行选中态：**删除变更在这里被拦住**——边归服务端，必须过了 ConfirmDialog 才真删 */
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) =>
      onEdgesChange(changes.filter((change) => change.type !== "remove")),
    [onEdgesChange],
  );

  /** 拖出即连：自连 / 落空静默取消（不发请求）；重复 409 只提示、不重复加边 */
  const handleConnect = useCallback<OnConnect>(
    (connection) => {
      const payload = plotEdgeCreatePayload(connection.source, connection.target);
      if (payload === null) return;
      void createRelation(payload)
        .then(() => loadPlotEdges())
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.code === "RELATION_EXISTS") {
            useUiStore.getState().showToast("这条连线已存在", "error");
            return;
          }
          useUiStore
            .getState()
            .showToast(err instanceof ApiError ? err.message : "连线失败，请重试", "error");
        });
    },
    [loadPlotEdges],
  );

  /** `Delete` 键 / 抽屉按钮 → 先收集待确认的边（未知 id 丢弃），确认后才真删 */
  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const targets = plotEdgeDeleteTargets(
        plotEdges,
        deleted.map((edge) => edge.id),
      );
      if (targets.length === 0) return;
      setPendingDeleteIds(targets.map((target) => target.id));
    },
    [plotEdges],
  );

  /** 确认删边：物理删（不可恢复）→ 重拉列表；取消则什么都不做（边从未被移除） */
  async function handleConfirmEdgeDelete(): Promise<void> {
    for (const edge of plotEdgeDeleteTargets(plotEdges, pendingDeleteIds ?? [])) {
      await deleteRelation(edge.id);
    }
    await loadPlotEdges();
    setEditingEdgeId(null);
    useUiStore.getState().showToast("已删除连线");
  }

  /** 拖动结束 = 手工坐标落盘（只存这一张；其余章继续按可见章序网格补位） */
  const handleNodeDragStop: OnNodeDrag<ChapterCardNode> = (_event, node) => {
    const next: CanvasSavedState = {
      ...saved,
      nodes: pruneCanvasPositions(cards, { ...saved.nodes, [node.id]: node.position }),
    };
    setSaved(next);
    writeCanvasState(projectId, next);
  };

  /** 平移 / 缩放结束 = 视口落盘（下一次进入直接恢复；首次进入时 fitView 的结果也会落盘） */
  function handleMoveEnd(_event: MouseEvent | TouchEvent | null, viewport: Viewport) {
    const next: CanvasSavedState = { ...saved, viewport };
    setSaved(next);
    writeCanvasState(projectId, next);
  }

  const editingRelation =
    editingEdgeId === null ? undefined : relations?.find((relation) => relation.id === editingEdgeId);
  /** 端点说明的卡片文案（`第N章 章名`；两端都在 visibleChapterIds 内，必命中） */
  const edgeHeadline =
    editingRelation === undefined
      ? ""
      : [editingRelation.sourceId, editingRelation.targetId]
          .map((id) => {
            const card = cards.find((candidate) => candidate.id === id);
            return card === undefined ? id : `${card.chapterLabel} ${card.title}`;
          })
          .join(" → ");

  return (
    <div className="min-h-0 flex-1">
      <ReactFlow
        className="h-full w-full"
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={handleMoveEnd}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        onEdgeClick={(_event, edge) => setEditingEdgeId(edge.id)}
        // 单击卡片 = 选中并聚焦邻边；点空白取消；双击 = 跳大纲节点（所以双击不缩放）
        onNodeClick={(_event, node) => setFocusedNodeId(node.id)}
        onPaneClick={() => setFocusedNodeId(null)}
        onNodeDoubleClick={(_event, node) => navigate(`#/outline/${node.id}`)}
        deleteKeyCode="Delete"
        defaultViewport={initialViewport}
        fitView={initialViewport === undefined}
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={CANVAS_MAX_ZOOM}
        zoomOnDoubleClick={false}
        attributionPosition="bottom-left"
      >
        <Controls showInteractive={false} position="top-left" />
        <MiniMap position="top-right" pannable zoomable ariaLabel="章节缩略图" />
      </ReactFlow>
      {editingRelation !== undefined && (
        // key = 边 id：换边就重挂，草稿即该边的当前值（同 EditRelationDialog 的「挂载时取初值」）
        <PlotEdgeDrawer
          key={editingRelation.id}
          relation={editingRelation}
          headline={edgeHeadline}
          onSaved={loadPlotEdges}
          onRequestDelete={() => setPendingDeleteIds([editingRelation.id])}
          onClose={() => setEditingEdgeId(null)}
        />
      )}
      {pendingDeleteIds !== null && (
        <ConfirmDialog
          title="删除连线"
          description={`将删除 ${pendingDeleteIds.length} 条连线，删除后无法恢复。`}
          confirmLabel="删除"
          danger
          onConfirm={handleConfirmEdgeDelete}
          onClose={() => setPendingDeleteIds(null)}
        />
      )}
    </div>
  );
}

export default function OutlineCanvas() {
  const outline = useProjectStore((s) => s.outline);
  const outlineError = useProjectStore((s) => s.outlineError);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const projectId = config?.id ?? null;
  const { retry: retryOutline } = useOutlineLoader({ withMetadata: true });

  // 伏笔徽标（同大纲页数据流）：树就绪后并行拉三类标记关系 → buildNodeHookMarks 聚合为
  // 「节点 → 标记列表」；任一类型失败降级为空集（纯展示增强，不阻塞画布、不出错误条）
  const [hookMarks, setHookMarks] = useState<Map<string, NodeHookMark[]> | null>(null);
  useEffect(() => {
    if (outline === null) {
      setHookMarks(null);
      return;
    }
    let cancelled = false;
    void Promise.all(
      HOOK_MARK_TYPES.map((relationType) =>
        listRelations({ source_type: "outline_node", relation_type: relationType, depth: 1 })
          .then((res) => res.relations)
          .catch(() => []),
      ),
    ).then((groups) => {
      if (cancelled) return;
      setHookMarks(buildNodeHookMarks(groups.flat()));
    });
    return () => {
      cancelled = true;
    };
  }, [outline]);

  const cards = useMemo(() => canvasChapterCards(outline), [outline]);
  // antd 浮层挂到画布容器内（画布自身 overflow-hidden，挂 body 会与卡片错位）
  const canvasRef = useRef<HTMLElement>(null);
  const noProject = config === null && !configLoading;

  let body;
  if (noProject) {
    body = (
      <div className="flex-1 overflow-y-auto p-6">
        <EmptyState
          padding="sm"
          action={
            <a href="#/" className="text-sm text-muted-foreground underline hover:text-foreground">
              回到首页打开或创建书籍
            </a>
          }
        >
          未打开项目，无法查看大纲画布
        </EmptyState>
      </div>
    );
  } else if (outline === null) {
    body = (
      <div className="flex-1 overflow-y-auto p-6">
        {outlineError === null ? (
          // 网格骨架：与画布卡片同一网格节奏，避免加载完成时整页跳动
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className={cn(skeletonClass, "h-20 rounded-md")} />
            ))}
          </div>
        ) : (
          <div className={cn(errorBannerClass, "flex items-center gap-3")}>
            <span className="min-w-0 flex-1">大纲加载失败，画布暂不可用</span>
            <Button size="small" onClick={retryOutline}>
              重试
            </Button>
          </div>
        )}
      </div>
    );
  } else if (cards.length === 0) {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState
          padding="sm"
          action={
            <a href="#/outline" className="text-sm text-muted-foreground underline hover:text-foreground">
              去大纲新建第一卷
            </a>
          }
        >
          画布上还没有章节
        </EmptyState>
      </div>
    );
  } else {
    body = <CanvasFlow key={projectId ?? "none"} projectId={projectId} cards={cards} marks={hookMarks} />;
  }

  return (
    <ConfigProvider getPopupContainer={() => canvasRef.current ?? document.body}>
      <section ref={canvasRef} className="-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden">
        {body}
      </section>
    </ConfigProvider>
  );
}
