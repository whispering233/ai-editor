// canvas 纯函数测试（S10.1 基础 + S10.2-S10.5 画布增强）：扁平化/自动布局确定性/localStorage 容错/
//   连线解析过滤/仅场景过滤/几何/绘制样式（语义色/粗细/透明度/箭头/边框交点）/小地图归一化/
//   一键重排语义/hover 路径 DFS/文案
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutlineTree } from "@whispering233/ai-editor-shared";
import type { RelationSummaryItem } from "./api";
import {
  autoLayout,
  CANVAS_CARD_H,
  CANVAS_CARD_W,
  canvasStorageKey,
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
  MINIMAP_PAD,
  MINIMAP_SIZE,
  minimapRectangles,
  MIN_ZOOM,
  nodeCenter,
  parseCanvasLayout,
  parsePlotEdges,
  readCanvasLayout,
  writeCanvasLayout,
  type CanvasEdge,
  type CanvasNodePositions,
  type CanvasPoint,
  type FlatCanvasNode,
} from "./canvas";

// ============ fixtures ============

/** 三层大纲树 fixture：卷1（章1[场景A,场景B]、章2）、卷2（直挂章3[场景C]）、直挂章4（root 下） */ function outlineFixture(): OutlineTree {
  return {
    id: "root",
    type: "root",
    schemaVersion: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updatedAt: "2026-08-01T10:00:00Z",
        children: [
          {
            id: "ch-1",
            type: "chapter",
            title: "第一章",
            updatedAt: "2026-08-01T10:00:00Z",
            children: [
              { id: "sc-1", type: "scene", title: "场景A", updatedAt: "2026-08-01T10:00:00Z" },
              { id: "sc-2", type: "scene", title: "场景B", updatedAt: "2026-08-01T10:00:00Z" },
            ],
          },
          {
            id: "ch-2",
            type: "chapter",
            title: "第二章",
            updatedAt: "2026-08-01T10:00:00Z",
            children: [],
          },
        ],
      },
      {
        id: "vol-2",
        type: "volume",
        title: "第二卷",
        updatedAt: "2026-08-01T10:00:00Z",
        children: [
          {
            id: "ch-3",
            type: "chapter",
            title: "第三章",
            updatedAt: "2026-08-01T10:00:00Z",
            children: [
              { id: "sc-3", type: "scene", title: "场景C", updatedAt: "2026-08-01T10:00:00Z" },
            ],
          },
        ],
      },
      {
        id: "ch-4",
        type: "chapter",
        title: "直挂章",
        updatedAt: "2026-08-01T10:00:00Z",
        children: [],
      },
    ],
  };
}

/** 关系 fixture（默认 plot_edge，双端点 outline_node） */
function rel(
  sourceId: string,
  targetId: string,
  overrides?: Partial<RelationSummaryItem>,
): RelationSummaryItem {
  return {
    id: `rel-${sourceId}-${targetId}`,
    sourceType: "outline_node",
    sourceId,
    targetType: "outline_node",
    targetId,
    relationType: "plot_edge",
    createdAt: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

/** 内存版 localStorage（read/write 容错测试用；vitest node 环境无 localStorage） */
function stubLocalStorage() {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("localStorage", stub);
  return { store, stub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============ flattenCanvasNodes ============

describe("flattenCanvasNodes（大纲树 → 画布节点扁平列表）", () => {
  it("树序遍历：先序（卷→章→场景），含直接父 id 与深度", () => {
    const nodes = flattenCanvasNodes(outlineFixture());
    expect(nodes.map((n) => n.id)).toEqual([
      "vol-1",
      "ch-1",
      "sc-1",
      "sc-2",
      "ch-2",
      "vol-2",
      "ch-3",
      "sc-3",
      "ch-4",
    ]);
    const ch1 = nodes.find((n) => n.id === "ch-1")!;
    expect(ch1.parentId).toBe("vol-1");
    expect(ch1.depth).toBe(1);
    const sc1 = nodes.find((n) => n.id === "sc-1")!;
    expect(sc1.parentId).toBe("ch-1");
    expect(sc1.depth).toBe(2);
    const vol1 = nodes.find((n) => n.id === "vol-1")!;
    expect(vol1.parentId).toBeNull();
    expect(vol1.depth).toBe(0);
    // 直挂章（决策 19：chapter 可挂 root）：顶层 parentId null
    const ch4 = nodes.find((n) => n.id === "ch-4")!;
    expect(ch4.parentId).toBeNull();
    expect(ch4.depth).toBe(0);
  });

  it("携带标题与摘要（画布卡片渲染数据源）", () => {
    const tree = outlineFixture();
    (tree.children[0] as { children: unknown[] }).children[0] = {
      ...((tree.children[0] as { children: unknown[] }).children[0] as object),
      summary: "第一章摘要",
    } as never;
    const nodes = flattenCanvasNodes(tree);
    expect(nodes.find((n) => n.id === "ch-1")?.summary).toBe("第一章摘要");
    expect(nodes.find((n) => n.id === "vol-1")?.title).toBe("第一卷");
  });

  it("空树/未加载 → []（不抛错）", () => {
    expect(flattenCanvasNodes(null)).toEqual([]);
    expect(
      flattenCanvasNodes({ id: "root", type: "root", schemaVersion: 1, children: [] }),
    ).toEqual([]);
  });
});

// ============ autoLayout ============

describe("autoLayout（自动布局：树序左到右、同层自上而下）", () => {
  const nodes = flattenCanvasNodes(outlineFixture());

  it("确定性：同输入两次调用结果完全一致", () => {
    expect(autoLayout(nodes)).toEqual(autoLayout(nodes));
  });

  it("顶层（卷/直挂章）从左到右成列：x 递增、y 相同", () => {
    const pos = autoLayout(nodes);
    const v1 = pos["vol-1"];
    const v2 = pos["vol-2"];
    const ch4 = pos["ch-4"];
    expect(v2.x).toBeGreaterThan(v1.x);
    expect(ch4.x).toBeGreaterThan(v2.x);
    expect(v1.y).toBe(v2.y);
    expect(v2.y).toBe(ch4.y);
  });

  it("列内自上而下：章在卷下方、场景在章下方，且同层 y 递增", () => {
    const pos = autoLayout(nodes);
    expect(pos["ch-1"].y).toBeGreaterThan(pos["vol-1"].y);
    expect(pos["ch-2"].y).toBeGreaterThan(pos["ch-1"].y);
    expect(pos["sc-1"].y).toBeGreaterThan(pos["ch-1"].y);
    expect(pos["sc-2"].y).toBeGreaterThan(pos["sc-1"].y);
  });

  it("缩进关系：章相对卷右移、场景相对卷再右移", () => {
    const pos = autoLayout(nodes);
    expect(pos["ch-1"].x).toBeGreaterThan(pos["vol-1"].x);
    expect(pos["sc-1"].x).toBeGreaterThan(pos["ch-1"].x);
    // 同一卷下的场景 x 相同（同列同缩进）
    expect(pos["sc-1"].x).toBe(pos["sc-2"].x);
  });

  it("行距按卡片高度累加（排版与卡片尺寸一致，不重叠）", () => {
    const pos = autoLayout(nodes);
    expect(pos["sc-1"].y - pos["ch-1"].y).toBeGreaterThanOrEqual(CANVAS_CARD_H.chapter);
    expect(pos["sc-2"].y - pos["sc-1"].y).toBeGreaterThanOrEqual(CANVAS_CARD_H.scene);
    expect(pos["ch-4"].x - pos["vol-2"].x).toBeGreaterThanOrEqual(CANVAS_CARD_W.volume);
  });

  it("空节点列表 → 空坐标表", () => {
    expect(autoLayout([])).toEqual({});
  });
});

// ============ localStorage 持久化与容错 ============

describe("localStorage 布局持久化（决策 10：按项目隔离、损坏丢弃）", () => {
  it("键按项目隔离：ai-editor:canvas:{project_id}", () => {
    expect(canvasStorageKey("proj-abc")).toBe("ai-editor:canvas:proj-abc");
    expect(canvasStorageKey("proj-xyz")).not.toBe(canvasStorageKey("proj-abc"));
  });

  it("写入 → 读取往返一致（节点坐标 + 缩放）", () => {
    stubLocalStorage();
    const layout = { nodes: { "sc-1": { x: 120, y: 80 } }, zoom: 1.3 };
    writeCanvasLayout("proj-abc", layout);
    expect(readCanvasLayout("proj-abc")).toEqual(layout);
  });

  it("项目间互不干扰（同节点 id 不同项目各存各的）", () => {
    stubLocalStorage();
    writeCanvasLayout("proj-a", { nodes: { "sc-1": { x: 1, y: 2 } }, zoom: 1 });
    writeCanvasLayout("proj-b", { nodes: { "sc-1": { x: 9, y: 9 } }, zoom: 2 });
    expect(readCanvasLayout("proj-a")?.nodes["sc-1"]).toEqual({ x: 1, y: 2 });
    expect(readCanvasLayout("proj-b")?.nodes["sc-1"]).toEqual({ x: 9, y: 9 });
  });

  it("无记录 → null（走自动布局，不视为数据异常）", () => {
    stubLocalStorage();
    expect(readCanvasLayout("proj-empty")).toBeNull();
  });

  it("JSON 损坏（非法字符串）→ null", () => {
    stubLocalStorage();
    writeRaw("proj-bad", "{oops");
    expect(readCanvasLayout("proj-bad")).toBeNull();
  });

  it("结构不符（nodes 非对象 / 坐标非有限数值）→ null", () => {
    stubLocalStorage();
    writeRaw("proj-1", JSON.stringify({ nodes: "nope", zoom: 1 }));
    expect(readCanvasLayout("proj-1")).toBeNull();
    writeRaw("proj-2", JSON.stringify({ nodes: { "sc-1": { x: "a", y: 2 } }, zoom: 1 }));
    expect(readCanvasLayout("proj-2")).toBeNull();
    writeRaw("proj-3", JSON.stringify({ nodes: { "sc-1": { x: 1, y: Number.NaN } }, zoom: 1 }));
    expect(readCanvasLayout("proj-3")).toBeNull();
    writeRaw("proj-4", JSON.stringify({ nodes: { "sc-1": { x: 1, y: 2 } }, zoom: "big" }));
    // zoom 非法单独容错回退 1（坐标比缩放更核心）
    expect(readCanvasLayout("proj-4")).toEqual({ nodes: { "sc-1": { x: 1, y: 2 } }, zoom: 1 });
  });

  it("parseCanvasLayout 纯函数：顶层非对象 / nodes 数组 → null", () => {
    expect(parseCanvasLayout(null)).toBeNull();
    expect(parseCanvasLayout(42)).toBeNull();
    expect(parseCanvasLayout({ nodes: [1, 2], zoom: 1 })).toBeNull();
  });

  it("clampZoom：越界值夹取到 [0.5, 2]", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(3)).toBe(MAX_ZOOM);
    expect(clampZoom(1.25)).toBe(1.25);
  });
});

/** 直接写原始字符串（模拟损坏数据） */
function writeRaw(projectId: string, raw: string): void {
  localStorage.setItem(canvasStorageKey(projectId), raw);
}

// ============ mergeLayout ============

describe("mergeLayout（树变化后保持既有坐标）", () => {
  const nodes: FlatCanvasNode[] = [
    { id: "vol-1", type: "volume", title: "卷1", parentId: null, depth: 0 },
    { id: "sc-1", type: "scene", title: "场景A", parentId: "ch-1", depth: 2 },
    { id: "sc-2", type: "scene", title: "场景B", parentId: "ch-1", depth: 2 },
  ];
  const fallback: CanvasNodePositions = {
    "vol-1": { x: 48, y: 48 },
    "sc-1": { x: 104, y: 172 },
    "sc-2": { x: 104, y: 248 },
  };

  it("stored 有记录的节点保留（用户拖拽结果不被自动布局覆盖）", () => {
    const merged = mergeLayout({ "sc-1": { x: 999, y: 777 } }, fallback, nodes);
    expect(merged["sc-1"]).toEqual({ x: 999, y: 777 });
    expect(merged["vol-1"]).toEqual(fallback["vol-1"]);
  });

  it("stored 缺失节点用 fallback（新节点获得自动布局初值）", () => {
    const merged = mergeLayout({ "vol-1": { x: 1, y: 1 } }, fallback, nodes);
    expect(merged["sc-1"]).toEqual(fallback["sc-1"]);
    expect(merged["vol-1"]).toEqual({ x: 1, y: 1 });
  });

  it("已不在树中的 id 丢弃（stored 陈旧坐标不累积）", () => {
    const merged = mergeLayout({ "sc-1": { x: 9, y: 9 }, ghost: { x: 1, y: 1 } }, fallback, nodes);
    expect(merged).not.toHaveProperty("ghost");
  });

  it("stored 为 null（无布局记录）→ 全部 fallback", () => {
    expect(mergeLayout(null, fallback, nodes)).toEqual(fallback);
  });

  it("空节点列表 → 空坐标表", () => {
    expect(mergeLayout({ ghost: { x: 1, y: 1 } }, fallback, [])).toEqual({});
  });
});

// ============ parsePlotEdges ============

describe("parsePlotEdges（关系行 → 画布连线）", () => {
  it("过滤出 plot_edge 且双端点 outline_node；其余关系丢弃", () => {
    const edges = parsePlotEdges([
      rel("sc-1", "sc-2"),
      rel("sc-1", "ch-1", { relationType: "depends_on" }),
      rel("sc-1", "char-3", { targetType: "character" }),
      rel("hook-1", "sc-1", { sourceType: "hook" }),
      rel("sc-1", "ch-1", { targetType: "chapter" }),
    ]);
    expect(edges.map((e) => e.id)).toEqual([`rel-sc-1-sc-2`]);
  });

  it("标签取 metadata.label 非空字符串；缺省/空串/非字符串 → undefined", () => {
    const withLabel = parsePlotEdges([rel("sc-1", "sc-2", { metadata: { label: "路径A" } })]);
    expect(withLabel[0].label).toBe("路径A");
    const empty = parsePlotEdges([rel("sc-1", "sc-2", { metadata: { label: "   " } })]);
    expect(empty[0].label).toBeUndefined();
    const none = parsePlotEdges([rel("sc-1", "sc-2", { metadata: { other: 1 } })]);
    expect(none[0].label).toBeUndefined();
    const noMeta = parsePlotEdges([rel("sc-1", "sc-2")]);
    expect(noMeta[0].label).toBeUndefined();
  });

  it("标签去除首尾空格（与创建侧 trim 对称）", () => {
    const padded = parsePlotEdges([rel("sc-1", "sc-2", { metadata: { label: "  路径A  " } })]);
    expect(padded[0].label).toBe("路径A");
    const padsOnly = parsePlotEdges([rel("sc-1", "sc-2", { metadata: { label: " 　 " } })]);
    expect(padsOnly[0].label).toBeUndefined();
  });

  it("端点 id 原样保留（连线渲染/删除定位用）", () => {
    const edges = parsePlotEdges([rel("sc-1", "sc-2", { metadata: { label: "路径A" } })]);
    expect(edges[0]).toMatchObject({ id: "rel-sc-1-sc-2", sourceId: "sc-1", targetId: "sc-2" });
  });

  it("id 排序确定化（乱序输入 → 输出有序）", () => {
    const edges = parsePlotEdges([rel("sc-3", "sc-1"), rel("sc-1", "sc-2"), rel("sc-2", "sc-3")]);
    expect(edges.map((e) => e.id)).toEqual(["rel-sc-1-sc-2", "rel-sc-2-sc-3", "rel-sc-3-sc-1"]);
  });

  it("空输入 → 空数组", () => {
    expect(parsePlotEdges([])).toEqual([]);
  });
});

// ============ 仅场景过滤 ============

describe("仅场景过滤（canvas.md：隐藏卷/章，连线以 scene 为主）", () => {
  const nodes = flattenCanvasNodes(outlineFixture());

  it("filterSceneNodes：只留 scene 叶子", () => {
    const scenes = filterSceneNodes(nodes);
    expect(scenes.map((n) => n.id)).toEqual(["sc-1", "sc-2", "sc-3"]);
  });

  it("filterVisibleEdges：两端都可见才保留（挂到隐藏容器的连线随之隐藏）", () => {
    const edges = parsePlotEdges([rel("sc-1", "sc-2"), rel("sc-1", "ch-1"), rel("ch-1", "ch-2")]);
    const visible = filterVisibleEdges(edges, new Set(["sc-1", "sc-2", "sc-3"]));
    expect(visible.map((e) => e.id)).toEqual(["rel-sc-1-sc-2"]);
  });

  it("filterVisibleEdges：空可见集 → 空数组", () => {
    expect(filterVisibleEdges(parsePlotEdges([rel("sc-1", "sc-2")]), new Set())).toEqual([]);
  });
});

// ============ 连线几何 ============

describe("连线几何（贝塞尔路径 + 中点标签锚点）", () => {
  const from: CanvasPoint = { x: 100, y: 100 };
  const to: CanvasPoint = { x: 300, y: 200 };

  it("edgePath：M 起点 + C 三次贝塞尔（控制点水平出/入）", () => {
    const d = edgePath(from, to);
    const m = d.match(
      /^M ([\d.]+) ([\d.]+) C ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+)$/,
    );
    expect(m).not.toBeNull();
    const [, mx, my, c1x, c1y, c2x, c2y, x2, y2] = m!;
    expect([Number(mx), Number(my)]).toEqual([from.x, from.y]);
    // 控制点 y 与端点相同（水平切出）：曲线在两端水平进出
    expect([Number(c1y), Number(c2y)]).toEqual([from.y, to.y]);
    expect(Number(x2)).toBe(to.x);
    expect(Number(y2)).toBe(to.y);
    // 控制点 x 在端点内侧（向对方偏移）
    expect(Number(c1x)).toBeGreaterThan(from.x);
    expect(Number(c2x)).toBeLessThan(to.x);
  });

  it("edgeMidpoint：t=0.5 贝塞尔中点，落在端点之间（确定性）", () => {
    const m = edgeMidpoint(from, to);
    expect(m.x).toBeGreaterThan(from.x);
    expect(m.x).toBeLessThan(to.x);
    expect(m.y).toBeGreaterThan(from.y);
    expect(m.y).toBeLessThan(to.y);
    expect(edgeMidpoint(from, to)).toEqual(m);
  });

  it("edgeMidpoint 与 edgePath 同参数（标签锚点位于曲线正中）", () => {
    // 中点在 t=0.5 处解析：数值上 (P0+3C1+3C2+P1)/8
    const dx = Math.max(32, Math.abs(to.x - from.x) * 0.5);
    const expectMid = {
      x: (from.x + 3 * (from.x + dx) + 3 * (to.x - dx) + to.x) / 8,
      y: (from.y + 3 * from.y + 3 * to.y + to.y) / 8,
    };
    expect(edgeMidpoint(from, to)).toEqual(expectMid);
  });

  it("nodeCenter：卡片中心 = 左上角 + 半宽半高", () => {
    expect(nodeCenter({ x: 48, y: 48 }, "scene")).toEqual({
      x: 48 + CANVAS_CARD_W.scene / 2,
      y: 48 + CANVAS_CARD_H.scene / 2,
    });
  });
});

// ============ 连线绘制样式（S10.2） ============

describe("连线绘制样式（S10.2：语义色三级优先级/粗细/透明度/箭头）", () => {
  const edge: CanvasEdge = { id: "rel-1", sourceId: "sc-1", targetId: "sc-2" };

  it("edgeStrokeColor 三级优先级：onPath/selected → 高亮紫（覆盖目标类型色）", () => {
    expect(edgeStrokeColor("scene", { onPath: true })).toBe(EDGE_COLORS.highlight);
    expect(edgeStrokeColor("chapter", { onPath: true })).toBe(EDGE_COLORS.highlight);
    expect(edgeStrokeColor("volume", { selected: true })).toBe(EDGE_COLORS.highlight);
    expect(edgeStrokeColor("scene", { onPath: true, selected: true })).toBe(EDGE_COLORS.highlight);
  });

  it("edgeStrokeColor：目标节点类型映射（场景琥珀/章蓝/卷青）", () => {
    expect(edgeStrokeColor("scene")).toBe(EDGE_COLORS.scene);
    expect(edgeStrokeColor("chapter")).toBe(EDGE_COLORS.chapter);
    expect(edgeStrokeColor("volume")).toBe(EDGE_COLORS.volume);
  });

  it("edgeStrokeColor：无目标类型（节点消失）→ 默认灰", () => {
    expect(edgeStrokeColor(null)).toBe(EDGE_COLORS.default);
  });

  it("edgeStrokeColor：缺省 opts → 目标类型色（不误判高亮）", () => {
    expect(edgeStrokeColor("scene")).toBe(EDGE_COLORS.scene);
  });

  it("edgeStrokeWidth：默认 1.5；选中/hover 路径 2.5", () => {
    expect(edgeStrokeWidth()).toBe(1.5);
    expect(edgeStrokeWidth({})).toBe(1.5);
    expect(edgeStrokeWidth({ selected: true })).toBe(2.5);
    expect(edgeStrokeWidth({ onPath: true })).toBe(2.5);
    expect(edgeStrokeWidth({ onPath: true, selected: true })).toBe(2.5);
  });

  it("edgeOpacity：默认 1；非路径（hover 激活）0.2", () => {
    expect(edgeOpacity()).toBe(1);
    expect(edgeOpacity({})).toBe(1);
    expect(edgeOpacity({ offPath: false })).toBe(1);
    expect(edgeOpacity({ offPath: true })).toBe(0.2);
  });

  it("箭头 marker：id 与 marker-end 引用串（组件 defs 与 path 引用共用单一来源）", () => {
    expect(EDGE_ARROW_MARKER_ID).toBe("canvas-edge-arrow");
    expect(edgeArrowMarkerEnd()).toBe(`url(#${EDGE_ARROW_MARKER_ID})`);
  });

  // edge 参数保留占位（签名与任务规格一致，当前配色逻辑未使用）
  void edge;
});

describe("edgeBorderPoint（S10.2：端点收窄到卡边框，箭头可见）", () => {
  it("水平连线：收窄点落在目标卡水平边缘中点（y 不变、x 收窄半宽）", () => {
    const center = { x: 300, y: 100 }; // 目标卡中心（源卡在左侧）
    const p = edgeBorderPoint(center, { x: 100, y: 100 }, 168, 76);
    expect(p.y).toBe(100);
    expect(p.x).toBe(300 - 168 / 2);
  });

  it("垂直连线：收窄点落在目标卡垂直边缘中点（x 不变、y 收窄半高）", () => {
    const center = { x: 100, y: 300 }; // 目标卡中心（源卡在上方）
    const p = edgeBorderPoint(center, { x: 100, y: 100 }, 168, 76);
    expect(p.x).toBe(100);
    expect(p.y).toBe(300 - 76 / 2);
  });

  it("斜向连线：t = min(半宽/|dx|, 半高/|dy|) 先碰到的边收窄（落在边框上且不越界）", () => {
    // dx=200, dy=100：tx=84/200=0.42 > ty=38/100=0.38 → 先碰上下边（y=38），x=76 在水平范围内
    const p = edgeBorderPoint({ x: 0, y: 0 }, { x: 200, y: 100 }, 168, 76);
    expect(p.y).toBe(38);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(84);
    // 反向：dx=400, dy=50：tx=84/400=0.21 < ty=38/50=0.76 → 先碰左右边（x=84），y=10.5 在垂直范围内
    const q = edgeBorderPoint({ x: 0, y: 0 }, { x: 400, y: 50 }, 168, 76);
    expect(q.x).toBe(84);
    expect(Math.abs(q.y)).toBeLessThanOrEqual(38);
  });

  it("单轴分量为零：另一轴正常收窄（Infinity 不参与 min）", () => {
    const p = edgeBorderPoint({ x: 100, y: 300 }, { x: 100, y: 100 }, 168, 76);
    expect(p.x).toBe(100);
    expect(p.y).toBe(262);
  });

  it("退化：两点重合 → 原样返回（不除零）", () => {
    const c: CanvasPoint = { x: 100, y: 100 };
    expect(edgeBorderPoint(c, { x: 100, y: 100 }, 168, 76)).toEqual(c);
  });
});

// ============ 小地图（S10.3） ============

describe("minimapRectangles（S10.3：归一化矩形 + 视口框）", () => {
  const nodes: FlatCanvasNode[] = [
    { id: "vol-1", type: "volume", title: "卷1", parentId: null, depth: 0 },
    { id: "sc-1", type: "scene", title: "场景A", parentId: "ch-1", depth: 2 },
    { id: "sc-2", type: "scene", title: "场景B", parentId: "ch-1", depth: 2 },
  ];
  const positions: CanvasNodePositions = {
    "vol-1": { x: 48, y: 48 },
    "sc-1": { x: 104, y: 172 },
    "sc-2": { x: 104, y: 248 },
  };
  const viewport = { x: 0, y: 0, width: 900, height: 600 };

  it("节点矩形归一化：内容包围盒等比适配小地图内（居中、保比例、不越界）", () => {
    const mm = minimapRectangles(nodes, positions, 1, viewport);
    expect(mm.nodeRects).toHaveLength(3);
    expect(mm.nodeRects.map((r) => r.type)).toEqual(["volume", "scene", "scene"]);
    // 归一化后整体宽高比与内容包围盒一致（保比例）
    const contentW = 104 + 168 - 48;
    const contentH = 248 + 76 - 48;
    const r0 = mm.nodeRects[0];
    const r2 = mm.nodeRects[2];
    const ratio = (r2.y + r2.h - r0.y) / (r2.x + r2.w - r0.x);
    expect(ratio).toBeCloseTo(contentH / contentW, 5);
    // 全部落在小地图范围内
    for (const r of mm.nodeRects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(MINIMAP_SIZE.w);
      expect(r.y + r.h).toBeLessThanOrEqual(MINIMAP_SIZE.h);
    }
  });

  it("视口框：与内容同坐标系同比例（渲染像素 ÷ zoom 还原 canvas 坐标）", () => {
    const mm = minimapRectangles(nodes, positions, 1, viewport);
    expect(mm.viewportRect).not.toBeNull();
    // 宽高比 = 视口宽高比（900:600）
    expect(mm.viewportRect!.w / mm.viewportRect!.h).toBeCloseTo(1.5, 5);
  });

  it("zoom 参与换算：同渲染像素视口，zoom 越小视口框越大（canvas 可视区域越大）", () => {
    const z1 = minimapRectangles(nodes, positions, 1, viewport).viewportRect!;
    const z05 = minimapRectangles(nodes, positions, 0.5, viewport).viewportRect!;
    expect(z05.w).toBeCloseTo(z1.w * 2, 5);
    expect(z05.h).toBeCloseTo(z1.h * 2, 5);
  });

  it("空节点集 → 空 rects + 无视口框", () => {
    const mm = minimapRectangles([], positions, 1, viewport);
    expect(mm.nodeRects).toEqual([]);
    expect(mm.viewportRect).toBeNull();
  });

  it("全部节点无坐标 → 空 rects + 无视口框", () => {
    const mm = minimapRectangles(nodes, {}, 1, viewport);
    expect(mm.nodeRects).toEqual([]);
    expect(mm.viewportRect).toBeNull();
  });

  it("视口 null / 宽高非正 → 无视口框（节点矩形照常）", () => {
    expect(minimapRectangles(nodes, positions, 1, null).viewportRect).toBeNull();
    expect(
      minimapRectangles(nodes, positions, 1, { x: 0, y: 0, width: 0, height: 600 }).viewportRect,
    ).toBeNull();
    expect(
      minimapRectangles(nodes, positions, 1, { x: 0, y: 0, width: 900, height: 0 }).viewportRect,
    ).toBeNull();
    expect(minimapRectangles(nodes, positions, 1, viewport).nodeRects).toHaveLength(3);
  });

  it("单场景节点（极小内容）：scale clamp 到 1，矩形不放大占满小地图、居中摆放", () => {
    const mm = minimapRectangles([nodes[1]], { "sc-1": positions["sc-1"] }, 1, viewport);
    expect(mm.nodeRects).toHaveLength(1);
    const r = mm.nodeRects[0];
    expect(r.w).toBeCloseTo(CANVAS_CARD_W.scene, 5); // scale = 1（clamp 生效）
    expect(r.h).toBeCloseTo(CANVAS_CARD_H.scene, 5);
    expect(r.x).toBeCloseTo(
      MINIMAP_PAD + (MINIMAP_SIZE.w - 2 * MINIMAP_PAD - CANVAS_CARD_W.scene) / 2,
      5,
    );
    expect(r.y).toBeCloseTo(
      MINIMAP_PAD + (MINIMAP_SIZE.h - 2 * MINIMAP_PAD - CANVAS_CARD_H.scene) / 2,
      5,
    );
  });

  it("极大内容：scale clamp 下限（不归零，矩形仍可渲染）", () => {
    const big: FlatCanvasNode[] = [
      { id: "a", type: "scene", title: "A", parentId: null, depth: 0 },
      { id: "b", type: "scene", title: "B", parentId: null, depth: 0 },
    ];
    const mm = minimapRectangles(big, { a: { x: 0, y: 0 }, b: { x: 100000, y: 100000 } }, 1, null);
    const rA = mm.nodeRects.find((r) => r.id === "a")!;
    expect(rA.w).toBeGreaterThan(0);
    expect(rA.w).toBeLessThan(MINIMAP_SIZE.w);
  });
});

// ============ 重新布局（S10.4） ============

describe("重新布局（S10.4：一键重排幂等语义——旧坐标不动、新节点补位）", () => {
  it("已存坐标完整的布局重排后原样保留（幂等，旧节点纹丝不动）", () => {
    const nodes: FlatCanvasNode[] = [
      { id: "vol-1", type: "volume", title: "卷1", parentId: null, depth: 0 },
      { id: "sc-1", type: "scene", title: "场景A", parentId: "ch-1", depth: 2 },
    ];
    const fallback = autoLayout(nodes);
    const dragged: CanvasNodePositions = {
      "vol-1": { x: 999, y: 111 },
      "sc-1": { x: 555, y: 666 },
    };
    expect(mergeLayout(dragged, fallback, nodes)).toEqual(dragged);
  });

  it("树新增节点用自动布局初值补位，旧节点坐标不动（孤儿兜底同路径）", () => {
    const newNodes: FlatCanvasNode[] = [
      { id: "vol-1", type: "volume", title: "卷1", parentId: null, depth: 0 },
      { id: "sc-9", type: "scene", title: "新场景", parentId: "ch-1", depth: 2 },
    ];
    const fallback = autoLayout(newNodes);
    const dragged: CanvasNodePositions = { "vol-1": { x: 999, y: 111 } };
    const merged = mergeLayout(dragged, fallback, newNodes);
    expect(merged["vol-1"]).toEqual({ x: 999, y: 111 }); // 旧节点不动
    expect(merged["sc-9"]).toEqual(fallback["sc-9"]); // 新节点补位
  });
});

// ============ hover 路径高亮（S10.5） ============

describe("dfsForwardPath（S10.5：沿出边向前 DFS，visited 防环，双集合）", () => {
  const edges: CanvasEdge[] = [
    { id: "e1", sourceId: "A", targetId: "B" },
    { id: "e2", sourceId: "B", targetId: "C" },
    { id: "e3", sourceId: "A", targetId: "D" },
    { id: "e4", sourceId: "D", targetId: "C" },
    { id: "e5", sourceId: "C", targetId: "A" }, // 回边：A→B→C→A 成环
    { id: "e6", sourceId: "X", targetId: "A" }, // 指向起点：不应被反向遍历
    { id: "e7", sourceId: "B", targetId: "B" }, // 自环
  ];

  it("链式向前：A→B→C，双集合齐全且只含出边方向", () => {
    const { nodeIds, edgeIds } = dfsForwardPath("A", [edges[0], edges[1]]);
    expect([...nodeIds].sort()).toEqual(["A", "B", "C"]);
    expect([...edgeIds].sort()).toEqual(["e1", "e2"]);
  });

  it("方向性：指向起点的入边（e6）不遍历，源节点 X 不在结果", () => {
    const { nodeIds, edgeIds } = dfsForwardPath("A", edges);
    expect(nodeIds.has("X")).toBe(false);
    expect(edgeIds.has("e6")).toBe(false);
  });

  it("防环：A→B→C→A 回边不造成死循环，全部可达节点与出边都收集（含自环 e7）", () => {
    const { nodeIds, edgeIds } = dfsForwardPath("A", edges);
    expect([...nodeIds].sort()).toEqual(["A", "B", "C", "D"]);
    expect([...edgeIds].sort()).toEqual(["e1", "e2", "e3", "e4", "e5", "e7"]);
  });

  it("并行边（同 target 多条）：边都收集、目标节点只入栈一次", () => {
    const es: CanvasEdge[] = [
      { id: "p1", sourceId: "A", targetId: "B" },
      { id: "p2", sourceId: "A", targetId: "B" },
      { id: "p3", sourceId: "B", targetId: "C" },
    ];
    const { nodeIds, edgeIds } = dfsForwardPath("A", es);
    expect([...nodeIds].sort()).toEqual(["A", "B", "C"]);
    expect([...edgeIds].sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("孤立节点（无出边）→ 单节点集 + 空边集", () => {
    const { nodeIds, edgeIds } = dfsForwardPath("solo", edges);
    expect([...nodeIds]).toEqual(["solo"]);
    expect(edgeIds.size).toBe(0);
  });

  it("空边列表 → 仅起点", () => {
    const { nodeIds, edgeIds } = dfsForwardPath("A", []);
    expect([...nodeIds]).toEqual(["A"]);
    expect(edgeIds.size).toBe(0);
  });

  it("自环起点：visited 防环立即终止（自环边本身收集）", () => {
    const { nodeIds, edgeIds } = dfsForwardPath("B", [{ id: "s1", sourceId: "B", targetId: "B" }]);
    expect([...nodeIds]).toEqual(["B"]);
    expect([...edgeIds]).toEqual(["s1"]);
  });

  it("长链不截断：visited 终止而非深度限制（51 节点 50 边全收集）", () => {
    const chain: CanvasEdge[] = [];
    for (let i = 0; i < 50; i += 1)
      chain.push({ id: `c${i}`, sourceId: `n${i}`, targetId: `n${i + 1}` });
    const { nodeIds, edgeIds } = dfsForwardPath("n0", chain);
    expect(nodeIds.size).toBe(51);
    expect(edgeIds.size).toBe(50);
  });
});

// ============ 错误文案 ============

describe("describeCanvasEdgeError（连线操作错误码 → 文案）", () => {
  it("RELATION_EXISTS → 「这条连线已经存在」（canvas.md 失败分支）", () => {
    expect(describeCanvasEdgeError("RELATION_EXISTS")).toBe("这条连线已经存在");
  });

  it("VALIDATION_ERROR → 参数问题", () => {
    expect(describeCanvasEdgeError("VALIDATION_ERROR")).toBe("连线参数有误");
  });

  it("CLIENT_NETWORK_ERROR → 连接失败引导", () => {
    expect(describeCanvasEdgeError("CLIENT_NETWORK_ERROR")).toBe(
      "无法连接服务，请确认 ai-editor 服务已启动",
    );
  });

  it("未知/空错误码 → null（调用方用 err.message 兜底）", () => {
    expect(describeCanvasEdgeError("SOME_UNKNOWN")).toBeNull();
    expect(describeCanvasEdgeError(null)).toBeNull();
  });
});
