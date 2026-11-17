// 大纲画布页（路由 `#/canvas`；契约：docs/ui/DESIGN.md `outline-canvas`）。
//
// 画布是**观察面**，不是第二个大纲页：结构与顺序的唯一编辑入口仍是大纲树——本页拖动卡片
// **只改坐标**（`localStorage` `ai-editor:canvas:{projectId}`，不进 outline.json / 备份 / 云端包），
// 不改父子 / 章序 / 卷归属，也不做连线（连线卡另开）。
// 节点 = 章（唯一）：卷与场景不上画布，层级由卡片上的卷号徽标表达（components/outline-canvas/ChapterCard）。
// 摆位 = 确定性网格（lib/outline-canvas-layout 纯函数）：缺坐标的章按可见章序每行 8 张补位、
// 已有手工坐标不动、新章落网格末尾；首次进入（无存量视口）→ fitView，有存量视口则恢复。
//
// 高度链：外壳抵消中栏 p-6 后铺满（`-m-6` + `h-[calc(100%+3rem)]`，同写作页 / 人物工作台），
// 画布容器 `flex-1 min-h-0` 一路到 ReactFlow（`h-full w-full`）——本页不自任滚动容器。
import "@xyflow/react/dist/base.css";
import "../components/outline-canvas/canvas-theme.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
  type Edge,
  type OnNodeDrag,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import { Button, ConfigProvider } from "antd";
import { EmptyState } from "../components/ui/empty-state";
import { ChapterCard, type ChapterCardNode } from "../components/outline-canvas/ChapterCard";
import { useOutlineLoader } from "../hooks/use-outline-loader";
import { listRelations } from "../lib/api";
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
import { errorBannerClass, skeletonClass } from "../lib/styles";
import { cn } from "../lib/utils";
import { useProjectStore } from "../stores/project";

/** 节点类型表（模块级常量：每次渲染新建对象会让 React Flow 重挂全部节点） */
const NODE_TYPES: NodeTypes = { chapter: ChapterCard };

/** 本页不渲染边（连线属后续卡片；常量空数组避免每次渲染换引用） */
const EMPTY_EDGES: Edge[] = [];

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

  return (
    <div className="min-h-0 flex-1">
      <ReactFlow
        className="h-full w-full"
        nodes={nodes}
        edges={EMPTY_EDGES}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={handleMoveEnd}
        defaultViewport={initialViewport}
        fitView={initialViewport === undefined}
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={CANVAS_MAX_ZOOM}
        nodesConnectable={false}
        elementsSelectable={false}
        // 双击留给后续卡片的「跳大纲节点」手势，本卡不缩放
        zoomOnDoubleClick={false}
        attributionPosition="bottom-left"
      >
        <Controls showInteractive={false} position="top-left" />
        <MiniMap position="bottom-right" pannable zoomable ariaLabel="章节缩略图" />
      </ReactFlow>
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
      <div className="flex-1 overflow-y-auto p-6">
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
