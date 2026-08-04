// canvas 纯函数测试（S10.1）：扁平化/自动布局确定性/localStorage 容错/连线解析过滤/仅场景过滤/几何/文案
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
  edgeMidpoint,
  edgePath,
  filterSceneNodes,
  filterVisibleEdges,
  flattenCanvasNodes,
  MAX_ZOOM,
  mergeLayout,
  MIN_ZOOM,
  nodeCenter,
  parseCanvasLayout,
  parsePlotEdges,
  readCanvasLayout,
  writeCanvasLayout,
  type CanvasNodePositions,
  type CanvasPoint,
  type FlatCanvasNode,
} from "./canvas";

// ============ fixtures ============

/** 三层大纲树 fixture：卷1（章1[场景A,场景B]、章2）、卷2（直挂章3[场景C]）、直挂章4（root 下） */function outlineFixture(): OutlineTree {
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
function rel(sourceId: string, targetId: string, overrides?: Partial<RelationSummaryItem>): RelationSummaryItem {
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
    expect(nodes.map((n) => n.id)).toEqual(["vol-1", "ch-1", "sc-1", "sc-2", "ch-2", "vol-2", "ch-3", "sc-3", "ch-4"]);
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
    expect(flattenCanvasNodes({ id: "root", type: "root", schemaVersion: 1, children: [] })).toEqual([]);
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
  const fallback: CanvasNodePositions = { "vol-1": { x: 48, y: 48 }, "sc-1": { x: 104, y: 172 }, "sc-2": { x: 104, y: 248 } };

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
    const merged = mergeLayout({ "sc-1": { x: 9, y: 9 }, "ghost": { x: 1, y: 1 } }, fallback, nodes);
    expect(merged).not.toHaveProperty("ghost");
  });

  it("stored 为 null（无布局记录）→ 全部 fallback", () => {
    expect(mergeLayout(null, fallback, nodes)).toEqual(fallback);
  });

  it("空节点列表 → 空坐标表", () => {
    expect(mergeLayout({ "ghost": { x: 1, y: 1 } }, fallback, [])).toEqual({});
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
    const edges = parsePlotEdges([
      rel("sc-3", "sc-1"),
      rel("sc-1", "sc-2"),
      rel("sc-2", "sc-3"),
    ]);
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
    const m = d.match(/^M ([\d.]+) ([\d.]+) C ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+)$/);
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

// ============ 错误文案 ============

describe("describeCanvasEdgeError（连线操作错误码 → 文案）", () => {
  it("RELATION_EXISTS → 「这条连线已经存在」（canvas.md 失败分支）", () => {
    expect(describeCanvasEdgeError("RELATION_EXISTS")).toBe("这条连线已经存在");
  });

  it("VALIDATION_ERROR → 参数问题", () => {
    expect(describeCanvasEdgeError("VALIDATION_ERROR")).toBe("连线参数有误");
  });

  it("CLIENT_NETWORK_ERROR → 连接失败引导", () => {
    expect(describeCanvasEdgeError("CLIENT_NETWORK_ERROR")).toBe("无法连接服务，请确认 ai-editor 服务已启动");
  });

  it("未知/空错误码 → null（调用方用 err.message 兜底）", () => {
    expect(describeCanvasEdgeError("SOME_UNKNOWN")).toBeNull();
    expect(describeCanvasEdgeError(null)).toBeNull();
  });
});
