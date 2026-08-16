// 画布页（S10.1；替换 T7.1 占位壳）
// 路由：#/canvas（layout.md §1）；中栏内容区页面（画布区域占满可用高度，内部滚动）
// 数据：大纲 = project store 全局树（决策 1：画布是同一数据的投影，节点即大纲，无游离节点）；
//   连线 = GET /api/v1/relation?source_type=outline_node&relation_type=plot_edge&depth=1
//   （lib/canvas parsePlotEdges 解析；创建 POST /relation、标签编辑 PUT /relation/:id、删除 DELETE /relation/:id 物理删）；
//   伏笔标记 = S9.2 并行三请求模式（plants/advances/resolves，Promise.all 降级）
// 布局：坐标/缩放存 localStorage（决策 10：key ai-editor:canvas:{project_id}，按项目隔离，
//   丢失自动布局不视为异常）；拖拽坐标防抖 300ms 写、缩放即时写
// 交互（canvas.md 关键交互）：
//   - 拖拽节点卡移动；[重新布局] 一键重排（S10.4：保留已拖拽坐标，仅新节点补位）；[-] 百分比 [+] + 滚轮缩放；
//     「全部节点|仅场景」切换
//   - 节点卡右侧把手拖出连线 → 松到目标节点 → 直接 POST 创建（UX1 拖出即连，无标签不打断拖放流）；
//     选中连线 → 线中点标签内联编辑（PUT /relation/:id，metadata 整体替换；空标签提交 {} 清除）
//   - 点击连线高亮 → 中点下方 [删除连线] → ui store confirm 二次确认（物理删不可恢复，可随时重建）
//   - 连线创建中（拖线期间）禁用 hover 路径高亮（UX1 hover 冲突规避：不降透明，连线目标清晰可辨）
//   - 画布说明角标常驻（「连线与坐标仅用于推演展示，不参与状态计算」，可收起）
// 画布增强（S10.2-S10.5，inkos 参考，自研不引库）：
//   - 连线绘制质量：语义色（目标层级：场景琥珀/章蓝/卷青，hover 路径/选中高亮紫）+ 粗细 1.5→2.5 +
//     流动虚线动画 + 箭头 marker（端点收窄到卡边框，edgeBorderPoint）；色值常量在 lib/canvas.ts
//   - 小地图：右下角只读缩略图（节点类型色矩形 + 视口框，纯函数 minimapRectangles；滚动/缩放/尺寸变化同步）
//   - hover 路径高亮：hover 节点 → dfsForwardPath 出边向前 DFS（visited 防环）→ 路径紫圈/紫线，
//     非路径节点与边 opacity 0.2；本地 UI 态不写回数据层（决策 10 投影语义）
// 状态：空态（大纲无节点 → 引导去 #/outline）、节点区骨架、关系错误重试横幅、连线操作 toast
// 刷新：useDataRefresh 订阅 dataVersion（AI 提案确认/InfoBar 刷新 → 重拉树 + 连线 + 伏笔标记）
// 样式：一律 token 类（layout.md §3，禁硬编码 zinc/white/black——oracle 红线）；动画克制（§4.3）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { Info, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  createRelation,
  deleteRelation,
  listRelations,
  updateRelationMeta,
} from "../lib/api";
import { TYPE_LABEL } from "../components/outline/dialogs";
import { NodeHookMarkBadge } from "../components/outline/node-hook-badge";
import {
  autoLayout,
  CANVAS_CARD_H,
  CANVAS_CARD_W,
  clampZoom,
  describeCanvasEdgeError,
  dfsForwardPath,
  EDGE_ARROW_MARKER_ID,
  EDGE_COLORS,
  edgeArrowMarkerEnd,
  edgeBorderPoint,
  edgeMidpoint,
  edgeOpacity,
  edgePath,
  edgeStrokeColor,
  edgeStrokeWidth,
  filterSceneNodes,
  filterVisibleEdges,
  flattenCanvasNodes,
  MAX_ZOOM,
  mergeLayout,
  MINIMAP_SIZE,
  minimapRectangles,
  MIN_ZOOM,
  nodeCenter,
  parsePlotEdges,
  readCanvasLayout,
  writeCanvasLayout,
  type CanvasEdge,
  type CanvasNodePositions,
  type CanvasNodeType,
  type CanvasPoint,
  type FlatCanvasNode,
  type MinimapViewport,
} from "../lib/canvas";
import { buildNodeHookMarks, HOOK_MARK_TYPES, type NodeHookMark } from "../lib/outline-hooks";
import { cn } from "../lib/utils";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 节点拖拽进行态（pointer 事件；坐标换算见 clientToCanvas——除以 zoom 保持拖拽速度与视觉一致） */
interface DragState {
  nodeId: string;
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
}

/** 已就绪连线（几何计算一次，SVG 路径与标签锚点共用） */
interface RenderedEdge {
  edge: CanvasEdge;
  d: string;
  mid: CanvasPoint;
  /** 目标节点类型（语义色映射输入；节点消失 → null → 默认灰） */
  targetType: CanvasNodeType | null;
}

/** 派生样式连线（S10.2/S10.5：语义色/粗细/透明度/流动虚线——展开新对象注入，不修改本体） */
interface DisplayEdge extends RenderedEdge {
  stroke: string;
  strokeWidth: number;
  opacity: number;
  /** 流动虚线动画（选中/hover 路径边） */
  dash: boolean;
}

/** 连线标签内联编辑进行态（UX1：选中连线 → 线中点输入框，draft 本地草稿） */
interface EditingLabelState {
  edgeId: string;
  draft: string;
}

export default function Canvas() {
  const outline = useProjectStore((s) => s.outline);
  const outlineLoading = useProjectStore((s) => s.outlineLoading);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const loadOutline = useProjectStore((s) => s.loadOutline);

  // ---- 布局与视图状态 ----
  const [positions, setPositions] = useState<CanvasNodePositions>({});
  const [zoom, setZoom] = useState(1);
  const [sceneOnly, setSceneOnly] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [loadAttempted, setLoadAttempted] = useState(false);

  // ---- 关系数据（连线 + 伏笔标记） ----
  const [edges, setEdges] = useState<CanvasEdge[] | null>(null);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [hookMarks, setHookMarks] = useState<Map<string, NodeHookMark[]> | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // ---- 画布增强交互态（S10.3/S10.5：本地 UI 态，不写回数据层——决策 10 投影语义） ----
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [viewportPx, setViewportPx] = useState<MinimapViewport | null>(null);

  // ---- 拖拽/连线创建交互态 ----
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [createFrom, setCreateFrom] = useState<string | null>(null);
  const [createCursor, setCreateCursor] = useState<CanvasPoint | null>(null);
  // ---- 连线标签线上编辑态（UX1） ----
  const [editingLabel, setEditingLabel] = useState<EditingLabelState | null>(null);
  const [labelSubmitting, setLabelSubmitting] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  // 最新 positions ref（卸载/离开项目前 flush 未落盘坐标用；cleanup 闭包只能拿到 effect 建立时的旧值）
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const edgesSeq = useRef(0);

  const projectId = config?.id ?? null;
  const noProject = config === null && !configLoading;

  // 数据变更信号（问题 1）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉树 + 连线
  // （伏笔标记 effect 依赖 outline 对象，树重拉后自动联动刷新——同 Outline.tsx）
  const reloadEdges = useCallback(async () => {
    const pid = projectId;
    if (pid === null) return;
    const seq = ++edgesSeq.current;
    try {
      const res = await listRelations({ source_type: "outline_node", relation_type: "plot_edge", depth: 1 });
      if (seq !== edgesSeq.current) return;
      setEdges(parsePlotEdges(res.relations));
      setEdgeError(null);
    } catch (err) {
      if (seq !== edgesSeq.current) return;
      setEdgeError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
    }
  }, [projectId]);
  useDataRefresh(() => {
    void loadOutline();
    void reloadEdges();
  });

  // 画布节点扁平化（渲染/自动布局统一输入；决策 1 投影）
  const nodes = useMemo(() => flattenCanvasNodes(outline), [outline]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // ---- 布局持久化（决策 10：按项目隔离；坐标防抖写、缩放即时写） ----

  /**
   * 已加载布局的项目 id（写守卫）：项目效果将本项目布局读入 state 后置位。
   * 写效果以此守卫——state 更新异步生效，项目加载/切换「当轮渲染」的守卫必为 false，
   * 写入效果自动跳过，杜绝把旧项目/空坐标串写进新项目键（下一轮渲染以正确数据补写）
   */
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);

  // 项目变化 → 重新读取该项目布局（localStorage 缺失 → 空表，由下方 merge 效果补自动布局初值）
  useEffect(() => {
    if (projectId === null) {
      setLoadedProjectId(null);
      setPositions({});
      setZoom(1);
      return;
    }
    const stored = readCanvasLayout(projectId);
    setLoadedProjectId(projectId);
    setZoom(stored?.zoom ?? 1);
    setPositions(stored?.nodes ?? {});
  }, [projectId]);

  /** 写守卫：仅当项目效果已应用（当前项目的布局已就绪）才允许写入 */
  const layoutLoaded = loadedProjectId === projectId;

  // 树变化（新节点/删除/移动）→ 合并：既有坐标保留（含未落盘的拖拽结果）、缺失节点自动布局初值、陈旧 id 丢弃。
  // 空节点（outline 未加载/空树）不动布局——防项目刷新瞬间把刚读入的存储布局合并为空表清掉；
  // !layoutLoaded 早退（oracle 审核）：切项目 A→B 时 loadOutline 不先清空旧树，旧项目节点会瞬时混入
  //   并合并进 positions → 防旧节点坐标经防抖写落入 B 的 localStorage 键（布局就绪后才允许合并）
  useEffect(() => {
    if (nodes.length === 0 || !layoutLoaded) return;
    setPositions((prev) => mergeLayout(prev, autoLayout(nodes), nodes));
  }, [nodes, layoutLoaded]);

  // 坐标防抖写（300ms，canvas.md「拖拽节点 → 坐标防抖写 localStorage」）
  useEffect(() => {
    if (projectId === null || !layoutLoaded) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      writeCanvasLayout(projectId, { nodes: positions, zoom });
    }, 300);
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        // 卸载/离开项目/缩放切换前 flush 未落盘坐标（300ms 内切页不丢最后拖拽，oracle 审核）。
        // 仅当 positions 自本 effect 建立后未再更新才 flush：拖拽帧的 cleanup 闭包捕获的是旧坐标
        //   （positionsRef 已是新值，引用不相等）→ 跳过——防抖语义保留，最新值由重设的定时器兜底；
        //   卸载/项目切换时闭包与 ref 同对象（坐标未变过）→ 补写，防 300ms 窗口内切走丢失
        if (positionsRef.current === positions && projectId !== null && layoutLoaded) {
          writeCanvasLayout(projectId, { nodes: positions, zoom });
        }
      }
    };
  }, [positions, projectId, zoom, layoutLoaded]);

  // 缩放即时写（canvas.md「缩放按钮 + 滚轮，zoom 写 localStorage」）
  useEffect(() => {
    if (projectId === null || !layoutLoaded) return;
    writeCanvasLayout(projectId, { nodes: positions, zoom });
  }, [zoom, projectId, layoutLoaded]);

  // ---- 数据加载 ----

  // 首次加载：outline 未加载且未尝试过 → loadOutline（store 内静默吞错，attempted 标记呈现失败态）
  useEffect(() => {
    if (outline === null && !outlineLoading && !loadAttempted) {
      setLoadAttempted(true);
      void loadOutline();
    }
  }, [outline, outlineLoading, loadAttempted, loadOutline]);

  // 连线加载：项目打开/切换时拉取（树变化不重拉——渲染侧按 positions 过滤缺失端点，删除节点后
  //   陈旧连线自动不渲染；创建/删除连线成功后由 reloadEdges 手动重拉）
  useEffect(() => {
    if (projectId === null) {
      setEdges(null);
      setEdgeError(null);
      return;
    }
    void reloadEdges();
  }, [projectId, reloadEdges]);

  // 伏笔标记（S9.2 并行三请求降级模式）：树就绪后拉取，依赖 outline 对象（树重拉自动联动刷新）
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

  // 滚轮缩放（canvas.md「缩放按钮 + 滚轮，zoom 写 localStorage」）：
  // React onWheel 被动监听无法 preventDefault，用原生监听 + passive:false；
  // 视口 div 可能晚于首帧渲染（大纲加载后），用 ref 回调在挂载时挂接、卸载时移除
  const wheelCleanup = useRef<(() => void) | null>(null);
  /** 小地图视口框 ResizeObserver 清理（挂接/卸载与滚轮监听同生命周期） */
  const viewportRoCleanup = useRef<(() => void) | null>(null);

  /** 小地图视口框同步（S10.3）：渲染像素坐标（相对内容区左上角，含缩放），整数化 + 相等跳过防滚动每帧重渲染 */
  const syncViewport = useCallback(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (vp === null || content === null) return;
    const vpRect = vp.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const next: MinimapViewport = {
      x: Math.round(vpRect.left - contentRect.left),
      y: Math.round(vpRect.top - contentRect.top),
      width: Math.round(vpRect.width),
      height: Math.round(vpRect.height),
    };
    setViewportPx((prev) =>
      prev !== null && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height
        ? prev
        : next,
    );
  }, []);

  const setViewportRef = useCallback((el: HTMLDivElement | null) => {
    viewportRef.current = el;
    wheelCleanup.current?.();
    wheelCleanup.current = null;
    viewportRoCleanup.current?.();
    viewportRoCleanup.current = null;
    if (el === null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clampZoom(Math.round((z + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    wheelCleanup.current = () => el.removeEventListener("wheel", onWheel);
    // 小地图视口框：挂载初始同步 + 容器尺寸变化（滚动由 viewport div onScroll 承担）
    syncViewport();
    const ro = new ResizeObserver(() => syncViewport());
    ro.observe(el);
    viewportRoCleanup.current = () => ro.disconnect();
  }, [syncViewport]);
  // 页面卸载清理（wheelCleanup/RO 挂接于视口 div，页面切走/卸载时移除）
  useEffect(() => () => {
    wheelCleanup.current?.();
    wheelCleanup.current = null;
    viewportRoCleanup.current?.();
    viewportRoCleanup.current = null;
  }, []);

  // 连线创建中按 Esc 取消
  useEffect(() => {
    if (createFrom === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCreateFrom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createFrom]);

  // ---- 视图派生（渲染输入） ----

  const visibleNodes = sceneOnly ? filterSceneNodes(nodes) : nodes;
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => filterVisibleEdges(edges ?? [], visibleIds), [edges, visibleIds]);

  // hover 陈旧态清理（oracle 审查）：hover 卷/章时切换「仅场景」或节点被外部刷新删除 →
  // 卡片从光标下卸载不触发 mouseleave → hoverPath 残留、全部可见节点/边停留 0.2 降透明。
  // hoveredNodeId 不在当前可见节点集即置 null；正常 hover 期间 setState 不触发（零渲染开销）
  useEffect(() => {
    if (hoveredNodeId !== null && !visibleIds.has(hoveredNodeId)) setHoveredNodeId(null);
  }, [hoveredNodeId, visibleIds]);

  /** 已就绪连线（几何一次计算；端点收窄到卡边框——箭头可见，S10.2；端点缺失/节点消失 → 跳过——决策 1 投影的防御） */
  const renderedEdges = useMemo<RenderedEdge[]>(() => {
    const out: RenderedEdge[] = [];
    for (const edge of visibleEdges) {
      const sPos = positions[edge.sourceId];
      const tPos = positions[edge.targetId];
      const sNode = nodesById.get(edge.sourceId);
      const tNode = nodesById.get(edge.targetId);
      if (!sPos || !tPos || !sNode || !tNode) continue;
      const sCenter = nodeCenter(sPos, sNode.type);
      const tCenter = nodeCenter(tPos, tNode.type);
      const from = edgeBorderPoint(sCenter, tCenter, CANVAS_CARD_W[sNode.type], CANVAS_CARD_H[sNode.type]);
      const to = edgeBorderPoint(tCenter, sCenter, CANVAS_CARD_W[tNode.type], CANVAS_CARD_H[tNode.type]);
      out.push({ edge, d: edgePath(from, to), mid: edgeMidpoint(from, to), targetType: tNode.type });
    }
    return out;
  }, [visibleEdges, positions, nodesById]);

  /**
   * hover 路径（S10.5：沿 plot_edge 出边向前 DFS 得 {nodeIds, edgeIds} 双集合；null = 未 hover）
   * UX1 hover 冲突规避：连线创建中（createFrom !== null）强制 null——拖线时禁用高亮，
   * 避免非路径节点/边全部降透明、看不清连线目标（canvas.md「创建连线」第 4 条）。
   */
  const hoverPath = useMemo(
    () => (hoveredNodeId !== null && createFrom === null ? dfsForwardPath(hoveredNodeId, visibleEdges) : null),
    [hoveredNodeId, createFrom, visibleEdges],
  );

  /** 派生连线（S10.2/S10.5：语义色三级优先级/粗细/透明度/流动虚线——展开新对象注入，不修改本体） */
  const displayEdges = useMemo<DisplayEdge[]>(() => {
    return renderedEdges.map((r) => {
      const selected = r.edge.id === selectedEdgeId;
      const onPath = hoverPath?.edgeIds.has(r.edge.id) ?? false;
      return {
        ...r,
        stroke: edgeStrokeColor(r.targetType, { onPath, selected }),
        strokeWidth: edgeStrokeWidth({ onPath, selected }),
        opacity: edgeOpacity({ offPath: hoverPath !== null && !onPath }),
        dash: onPath || selected,
      };
    });
  }, [renderedEdges, hoverPath, selectedEdgeId]);

  /** 小地图（S10.3：可见节点归一化矩形 + 视口框，右下角缩略图数据源） */
  const minimap = useMemo(
    () => minimapRectangles(visibleNodes, positions, zoom, viewportPx),
    [visibleNodes, positions, zoom, viewportPx],
  );

  /** 内容区尺寸（节点位置 + 卡片尺寸上界 + 边距；缩放容器宽高，滚动范围） */
  const contentSize = useMemo(() => {
    let w = 0;
    let h = 0;
    for (const n of nodes) {
      const pos = positions[n.id];
      if (!pos) continue;
      w = Math.max(w, pos.x + CANVAS_CARD_W[n.type]);
      h = Math.max(h, pos.y + CANVAS_CARD_H[n.type]);
    }
    return { w: w + 96, h: h + 96 };
  }, [nodes, positions]);

  const selectedEdge = useMemo(
    () => renderedEdges.find((r) => r.edge.id === selectedEdgeId) ?? null,
    [renderedEdges, selectedEdgeId],
  );

  /** 连线创建临时线（源节点中心 → 当前光标） */
  const tempEdge = useMemo(() => {
    if (createFrom === null || createCursor === null) return null;
    const sNode = nodesById.get(createFrom);
    const sPos = positions[createFrom];
    if (!sNode || !sPos) return null;
    return edgePath(nodeCenter(sPos, sNode.type), createCursor);
  }, [createFrom, createCursor, positions, nodesById]);

  // ---- 交互处理器 ----

  /** client 坐标 → canvas 坐标（除以 zoom：缩放容器 getBoundingClientRect 已含缩放，除以 zoom 还原） */
  function clientToCanvas(clientX: number, clientY: number): CanvasPoint {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  }

  /** 节点卡拖拽：pointerdown 记录起点，move 实时更新位置，up 结束（坐标防抖写由保存效果承担） */
  function handleNodePointerDown(e: ReactPointerEvent, node: FlatCanvasNode) {
    // 连线把手/交互子元素不触发卡片拖拽
    if ((e.target as HTMLElement).closest("[data-canvas-handle]")) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const pos = positions[node.id];
    if (!pos) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      nodeId: node.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    });
  }

  function handleNodePointerMove(e: ReactPointerEvent, nodeId: string) {
    if (dragState === null || dragState.nodeId !== nodeId) return;
    const dx = (e.clientX - dragState.startClientX) / zoom;
    const dy = (e.clientY - dragState.startClientY) / zoom;
    setPositions((prev) => {
      const cur = prev[nodeId];
      if (!cur) return prev;
      return { ...prev, [nodeId]: { x: dragState.origX + dx, y: dragState.origY + dy } };
    });
  }

  function handleNodePointerUp() {
    setDragState(null);
  }

  /** 连线创建：节点卡右侧把手按下 → 捕获指针 → 拖出临时线 → 松开命中目标卡 → 直接创建（UX1 拖出即连） */
  function handleEdgeHandleDown(e: ReactPointerEvent, node: FlatCanvasNode) {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedEdgeId(null);
    setCreateFrom(node.id);
    setCreateCursor(clientToCanvas(e.clientX, e.clientY));
  }

  function handleEdgeHandleMove(e: ReactPointerEvent) {
    if (createFrom === null) return;
    setCreateCursor(clientToCanvas(e.clientX, e.clientY));
  }

  /**
   * 连线创建松手（UX1 拖出即连）：命中目标卡 → **直接 POST 创建**（无标签 body 不带 metadata），
   * 不再弹 Dialog——拖放流不打断。自连（松回源卡）静默取消。
   * 终态错误沿用旧语义：RELATION_EXISTS/VALIDATION_ERROR → toast + 重拉（既有连线立即可见）；
   * 其余错误 toast 兜底（不内联展示——无对话框可挂）。
   */
  async function handleEdgeHandleUp(e: ReactPointerEvent) {
    if (createFrom === null) return;
    const sourceId = createFrom;
    // 松开点命中判定：elementFromPoint 找最近的节点卡（把手捕获不阻断命中测试）
    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
    const card = targetEl?.closest("[data-canvas-node-id]");
    const targetId = card?.getAttribute("data-canvas-node-id") ?? null;
    setCreateFrom(null);
    setCreateCursor(null);
    // 未命中 / 自连（松回源卡）静默取消
    if (targetId === null || targetId === sourceId) return;
    try {
      await createRelation({
        source_type: "outline_node",
        source_id: sourceId,
        target_type: "outline_node",
        target_id: targetId,
        relation_type: "plot_edge",
      });
      useUiStore.getState().showToast("已建立连线");
      await reloadEdges();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      const text = describeCanvasEdgeError(code);
      if (text !== null) {
        // 终态错误：toast 提示 + 重拉（RELATION_EXISTS 让既有连线立即可见）
        useUiStore.getState().showToast(text, "error");
        await reloadEdges();
        return;
      }
      useUiStore.getState().showToast(err instanceof ApiError ? err.message : "创建失败，请重试", "error");
    }
  }

  // ---- 连线标签线上编辑（UX1：选中连线 → 线中点内联输入框；Enter/失焦提交 PUT，Esc 取消） ----
  // labelSubmitRef 防重复提交：Enter/Esc 先置位，卸载/失焦触发的 blur 不再走提交路径
  const labelSubmitRef = useRef(false);

  /** 开始编辑（draft 取当前标签；无标签 → 空 draft 显示占位） */
  function startEditLabel(edge: CanvasEdge) {
    labelSubmitRef.current = false;
    setEditingLabel({ edgeId: edge.id, draft: edge.label ?? "" });
  }

  /** 提交：trim 后为空 → 提交 {} 清除标签（与 POST 创建侧 trim 对称）；成功 toast + 重拉 */
  async function commitLabel(edgeId: string, draft: string) {
    if (labelSubmitting) return;
    setLabelSubmitting(true);
    setEditingLabel(null);
    try {
      const trimmed = draft.trim();
      await updateRelationMeta(edgeId, trimmed === "" ? {} : { label: trimmed });
      useUiStore.getState().showToast("已保存标签");
      await reloadEdges();
    } catch (err) {
      useUiStore.getState().showToast(err instanceof ApiError ? err.message : "保存失败，请重试", "error");
    } finally {
      setLabelSubmitting(false);
    }
  }

  function handleLabelKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      labelSubmitRef.current = true;
      if (editingLabel !== null) void commitLabel(editingLabel.edgeId, editingLabel.draft);
    } else if (e.key === "Escape") {
      // 取消不提交（失焦守卫：置位后 blur 跳过）
      e.preventDefault();
      labelSubmitRef.current = true;
      setEditingLabel(null);
    }
  }

  function handleLabelBlur() {
    if (labelSubmitRef.current) return; // Enter/Esc 已处理
    if (editingLabel !== null) void commitLabel(editingLabel.edgeId, editingLabel.draft);
  }

  /** 删除选中连线：ui store confirm 二次确认（物理删不可恢复，可随时重建）→ DELETE → toast + 重拉 */
  async function handleDeleteSelectedEdge() {
    if (selectedEdge === null) return;
    const edge = selectedEdge.edge;
    const ok = await useUiStore.getState().confirm({
      title: "删除连线",
      description: `删除连线「${edge.label ?? "未命名"}」？物理删除不可恢复，可随时重建。`,
      danger: true,
    });
    if (!ok) return;
    try {
      // 清除标签编辑态：输入框随连线卸载会触发 blur——置位守卫防 blur 对已删连线补发 PUT（404）
      labelSubmitRef.current = true;
      setEditingLabel(null);
      await deleteRelation(edge.id);
      useUiStore.getState().showToast("已删除连线");
      setSelectedEdgeId(null);
      await reloadEdges();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      const text = describeCanvasEdgeError(code);
      useUiStore.getState().showToast(
        text ?? (err instanceof ApiError ? err.message : "删除失败，请重试"),
        "error",
      );
      // 404 残留（连线已被删除/物理清理）：清除选中并重拉
      if (code === "RELATION_NOT_FOUND") {
        setSelectedEdgeId(null);
        await reloadEdges();
      }
    }
  }

  /** 一键重排（S10.4，inkos position ?? 自动计算 幂等语义）：保留已拖拽坐标，仅新节点补位 + 孤儿兜底 */
  function handleRelayout() {
    setPositions((prev) => mergeLayout(prev, autoLayout(nodes), nodes));
  }

  function changeZoom(delta: number) {
    setZoom((z) => clampZoom(Math.round((z + delta) * 10) / 10));
  }

  // ============ 渲染 ============

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      {/* 工具栏（canvas.md 线框：自动布局 | 缩放 | 显示切换 | 画布说明） */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-serif text-xl font-medium">画布</h1>
        <Button variant="outline" type="button" onClick={handleRelayout} disabled={nodes.length === 0}>
          重新布局
        </Button>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            type="button"
            aria-label="缩小"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => changeZoom(-0.1)}
          >
            <Minus />
          </Button>
          <span className="w-12 text-center text-sm tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            type="button"
            aria-label="放大"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => changeZoom(0.1)}
          >
            <Plus />
          </Button>
        </div>
        {/* 显示切换（TabBar 药丸分段样式，layout.md §2.2） */}
        <div className="flex items-center gap-1 rounded-lg bg-secondary/30 p-1" role="group" aria-label="显示模式">
          {([false, true] as const).map((only) => (
            <button
              key={String(only)}
              type="button"
              onClick={() => setSceneOnly(only)}
              aria-pressed={sceneOnly === only}
              className={cn(
                "rounded-md border border-border px-2.5 py-1 text-xs transition-colors",
                sceneOnly === only
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {only ? "仅场景" : "全部节点"}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" type="button" onClick={() => setShowHint((v) => !v)} aria-expanded={showHint}>
          <Info />
          画布说明
        </Button>
      </div>

      {/* 说明角标（常驻小字，可收起；决策 9/10 语义提示） */}
      {showHint && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          连线与坐标仅用于推演展示，不参与状态计算
          <button type="button" className="rounded p-0.5 hover:bg-muted hover:text-foreground" aria-label="收起说明" onClick={() => setShowHint(false)}>
            <X className="size-3" />
          </button>
        </p>
      )}

      {/* 连线加载失败：横幅 + 重试（单区块失败不阻塞画布） */}
      {edgeError !== null && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {edgeError === CLIENT_NETWORK_ERROR ? "无法连接服务，请确认 ai-editor 服务已启动。" : "连线加载失败，请重试。"}
          <Button variant="outline" className="ml-3" type="button" onClick={() => void reloadEdges()}>
            重试
          </Button>
        </div>
      )}

      {noProject ? (
        /* 未打开项目：引导回首页（同 Outline.tsx 分支） */
        <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">未打开项目，无法查看画布</p>
          <a href="#/" className="mt-2 inline-block text-sm text-muted-foreground underline hover:text-foreground">
            回到首页打开或创建书籍
          </a>
        </div>
      ) : outlineLoading && outline === null ? (
        /* 加载骨架（节点区骨架，canvas.md 状态约定） */
        <div className="flex-1 overflow-hidden rounded-md border border-border bg-muted/20 p-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="mb-4 flex gap-4">
              <div className="h-24 w-60 animate-pulse rounded-lg bg-muted" />
              <div className="mt-6 h-24 w-52 animate-pulse rounded-lg bg-muted" />
              <div className="mt-12 h-20 w-44 animate-pulse rounded-lg bg-muted" />
            </div>
          ))}
        </div>
      ) : outline === null ? (
        /* 大纲加载失败（loadOutline 静默吞错后的兜底呈现） */
        <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          大纲加载失败
          <Button variant="outline" className="ml-3" type="button" onClick={() => setLoadAttempted(false)}>
            重试
          </Button>
        </div>
      ) : outline.children.length === 0 ? (
        /* 空态：大纲无节点 → 引导去大纲页（canvas.md 状态约定） */
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">大纲还是空的，先去搭大纲</p>
          <Button className="mt-4" type="button" onClick={() => navigate("/outline")}>
            去大纲
          </Button>
        </div>
      ) : visibleNodes.length === 0 ? (
        /* 仅场景模式无场景节点 */
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">当前大纲还没有场景节点</p>
          <Button variant="outline" className="mt-4" type="button" onClick={() => setSceneOnly(false)}>
            显示全部节点
          </Button>
        </div>
      ) : (
        /* 画布：滚动视口 + 缩放容器（transform scale，transform-origin 左上——canvas 坐标换算与 zoom 一致） */
        <div
          ref={setViewportRef}
          className="relative min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/20"
          onScroll={syncViewport}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedEdgeId(null);
          }}
        >
          <div
            ref={contentRef}
            className="relative"
            style={{
              width: contentSize.w,
              height: contentSize.h,
              transform: `scale(${zoom})`,
              transformOrigin: "0 0",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedEdgeId(null);
            }}
          >
            {/* 连线层（SVG 绝对定位铺满内容区；容器 pointer-events-none，路径/热区显式接管点击） */}
            <svg
              className="pointer-events-none absolute left-0 top-0"
              width={contentSize.w}
              height={contentSize.h}
              style={{ overflow: "visible" }}
            >
              <defs>
                {/* 连线箭头（S10.2 marker-end；fill=context-stroke 取引用路径的描边色——单 marker 多色） */}
                <marker
                  id={EDGE_ARROW_MARKER_ID}
                  viewBox="0 0 10 10"
                  refX={10}
                  refY={5}
                  markerWidth={10}
                  markerHeight={10}
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 Z" fill="context-stroke" />
                </marker>
              </defs>
              {displayEdges.map(({ edge, d, stroke, strokeWidth, opacity, dash }) => {
                const selected = edge.id === selectedEdgeId;
                return (
                  <g key={edge.id} opacity={opacity}>
                    {/* 可见描边（非缩放描边：任意 zoom 下粗细恒定；语义色三级优先级 + 选中/路径加粗 + 流动虚线 + 箭头） */}
                    <path
                      d={d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                      strokeDasharray={dash ? "6 4" : undefined}
                      vectorEffect="non-scaling-stroke"
                      markerEnd={edgeArrowMarkerEnd()}
                      className={dash ? "canvas-edge-flow" : undefined}
                    />
                    {/* 点击热区（透明粗描边承接点击；选中再点取消选中） */}
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      vectorEffect="non-scaling-stroke"
                      className="pointer-events-auto cursor-pointer"
                      onClick={() => setSelectedEdgeId(selected ? null : edge.id)}
                    />
                  </g>
                );
              })}
              {/* 连线创建临时线（虚线 primary，跟手） */}
              {tempEdge !== null && (
                <path
                  d={tempEdge}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {/* 连线中点标签（HTML 定位在缩放容器内，随缩放；未选中时 pointer-events-none 不挡节点点击；
                选中时变为可点标签（+ 标签占位）/ 内联输入框——UX1 线上编辑） */}
            {displayEdges.map(({ edge, mid, opacity }) => {
              const selected = edge.id === selectedEdgeId;
              const editing = selected && editingLabel !== null && editingLabel.edgeId === edge.id;
              if (editing) {
                // 线上编辑输入框（Enter/失焦提交、Esc 取消；z-20 盖过连线热区）
                return (
                  <div
                    key={`label-${edge.id}`}
                    className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: mid.x, top: mid.y }}
                  >
                    <Input
                      value={editingLabel.draft}
                      onChange={(e) => setEditingLabel({ edgeId: edge.id, draft: e.target.value })}
                      onKeyDown={handleLabelKeyDown}
                      onBlur={handleLabelBlur}
                      onFocus={(e) => e.currentTarget.select()}
                      maxLength={50}
                      placeholder="+ 标签"
                      autoFocus
                      aria-label="编辑连线标签"
                      className="h-7 w-44 rounded-md px-1.5 py-0.5 text-xs"
                    />
                  </div>
                );
              }
              return (
                <span
                  key={`label-${edge.id}`}
                  className={cn(
                    "pointer-events-none absolute max-w-44 -translate-x-1/2 -translate-y-1/2 truncate whitespace-nowrap rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground",
                    selected && "pointer-events-auto cursor-text",
                  )}
                  style={{
                    left: mid.x,
                    top: mid.y,
                    opacity,
                    // 选中态与连线高亮紫一致（单一来源 EDGE_COLORS.highlight，S10.2）；
                    // 无标签显示占位「+ 标签」，点击进入编辑（UX1）
                    ...(selected ? { borderColor: EDGE_COLORS.highlight, color: EDGE_COLORS.highlight } : {}),
                  }}
                  title={selected ? (edge.label === undefined ? "添加标签" : "编辑标签") : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    startEditLabel(edge);
                  }}
                >
                  {edge.label ?? (selected ? "+ 标签" : "未命名连线")}
                </span>
              );
            })}

            {/* 选中连线操作浮条（中点下方：显示标签 + [删除连线] + 关闭） */}
            {selectedEdge !== null && (
              <div
                className="absolute z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm"
                style={{ left: selectedEdge.mid.x, top: selectedEdge.mid.y + 26 }}
              >
                <span className="max-w-36 truncate px-1.5 text-xs text-muted-foreground">
                  {selectedEdge.edge.label ?? "未命名连线"}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  type="button"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => void handleDeleteSelectedEdge()}
                >
                  删除连线
                </Button>
                <button
                  type="button"
                  aria-label="取消选择"
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setSelectedEdgeId(null)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {/* 节点卡（绝对定位；拖拽 pointer 事件 + 连线拖出把手；hover 路径高亮派生样式） */}
            {visibleNodes.map((node) => {
              const pos = positions[node.id];
              if (!pos) return null;
              const marks = hookMarks?.get(node.id) ?? [];
              const isCreatingSource = createFrom === node.id;
              const isDragging = dragState?.nodeId === node.id;
              const isOnPath = hoverPath?.nodeIds.has(node.id) ?? false;
              return (
                <div
                  key={node.id}
                  data-canvas-node-id={node.id}
                  className={cn(
                    "group absolute cursor-grab touch-none select-none rounded-lg border bg-card p-2.5 transition-colors active:cursor-grabbing",
                    isCreatingSource ? "border-primary ring-2 ring-ring/40" : "border-border",
                    isDragging && "opacity-80",
                  )}
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: CANVAS_CARD_W[node.type],
                    height: CANVAS_CARD_H[node.type],
                    // hover 路径高亮（S10.5）：路径节点紫圈、非路径降透明 0.2（本地 UI 态，不写回数据层）
                    ...(hoverPath !== null
                      ? {
                          opacity: isOnPath ? 1 : 0.2,
                          boxShadow: isOnPath ? `0 0 0 2px ${EDGE_COLORS.highlight}` : undefined,
                        }
                      : {}),
                  }}
                  title="拖动调整位置"
                  onPointerDown={(e) => handleNodePointerDown(e, node)}
                  onPointerMove={(e) => handleNodePointerMove(e, node.id)}
                  onPointerUp={handleNodePointerUp}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId((cur) => (cur === node.id ? null : cur))}
                >
                  {/* 头部：类型徽标 + 标题 + 伏笔标记（S9.2 语义，画布节点卡复用 buildNodeHookMarks） */}
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {TYPE_LABEL[node.type]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={node.title}>
                      {node.title}
                    </span>
                    {marks.length > 0 && (
                      <span className="flex shrink-0 items-center gap-0.5">
                        {marks.map((mark) => (
                          <NodeHookMarkBadge key={`${mark.relationType}-${mark.hookId}`} mark={mark} />
                        ))}
                      </span>
                    )}
                  </div>
                  {/* 摘要（截断两行，可选） */}
                  {node.summary && (
                    <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">{node.summary}</p>
                  )}
                  {/* 连线拖出把手（右侧中点；按下拖到目标节点松手 → 创建连线） */}
                  <span
                    data-canvas-handle
                    className={cn(
                      "absolute top-1/2 -right-2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border bg-card transition-colors",
                      isCreatingSource ? "border-primary bg-primary/10" : "border-border hover:border-primary hover:bg-accent",
                    )}
                    title="拖出连线"
                    aria-label="拖出连线"
                    onPointerDown={(e) => handleEdgeHandleDown(e, node)}
                    onPointerMove={handleEdgeHandleMove}
                    onPointerUp={handleEdgeHandleUp}
                  />
                </div>
              );
            })}
          </div>

          {/* 小地图（S10.3：右下角缩略图，纯只读展示——MVP 不做点击跳转；
              pointer-events-none 不挡画布操作；节点类型色填充 + 视口框描边） */}
          <div className="pointer-events-none absolute right-2 bottom-2 z-10 overflow-hidden rounded-md border border-border bg-card/90 shadow-sm">
            <svg width={MINIMAP_SIZE.w} height={MINIMAP_SIZE.h}>
              {minimap.nodeRects.map((r) => (
                <rect key={r.id} x={r.x} y={r.y} width={r.w} height={r.h} rx={2} fill={EDGE_COLORS[r.type]} opacity={0.85} />
              ))}
              {minimap.viewportRect !== null && (
                <rect
                  x={minimap.viewportRect.x}
                  y={minimap.viewportRect.y}
                  width={minimap.viewportRect.w}
                  height={minimap.viewportRect.h}
                  fill="none"
                  stroke={EDGE_COLORS.highlight}
                  strokeWidth={1}
                />
              )}
            </svg>
          </div>
        </div>
      )}
    </section>
  );
}
