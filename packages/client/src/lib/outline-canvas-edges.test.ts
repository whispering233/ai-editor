// 大纲画布连线纯函数单测（卡 C7）：建边 payload、脏边丢弃、邻边聚焦派生、删边确认路径
// 都是「服务端数据 ↔ 画布边」的边界——错了会凭空多边、删错边，或在刷屏的脏数据上打挂画布。
import { describe, expect, it } from "vitest";
import type { RelationSummaryItem } from "./api";
import {
  adjacentPlotEdgeIds,
  canvasPlotEdges,
  plotEdgeCreatePayload,
  plotEdgeDeleteTargets,
  plotEdgeLabel,
  PLOT_EDGE_DIM_OPACITY,
  PLOT_EDGE_RELATION_TYPE,
} from "./outline-canvas-edges";

function plotEdge(
  id: string,
  sourceId: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): RelationSummaryItem {
  return {
    id,
    sourceType: "outline_node",
    sourceId,
    targetType: "outline_node",
    targetId,
    relationType: PLOT_EDGE_RELATION_TYPE,
    metadata,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const visible = new Set(["ch-1", "ch-2", "ch-3"]);

describe("plotEdgeCreatePayload（拖出即连的请求体）", () => {
  it("两端都是章 → plot_edge、outline_node 端点、无 metadata（标签留到抽屉）", () => {
    expect(plotEdgeCreatePayload("ch-1", "ch-2")).toEqual({
      source_type: "outline_node",
      source_id: "ch-1",
      target_type: "outline_node",
      target_id: "ch-2",
      relation_type: "plot_edge",
    });
  });

  it("自连 / 落空（null / undefined / 空串）→ null（调用点静默取消，不发请求）", () => {
    expect(plotEdgeCreatePayload("ch-1", "ch-1")).toBeNull();
    expect(plotEdgeCreatePayload(null, "ch-2")).toBeNull();
    expect(plotEdgeCreatePayload("ch-1", null)).toBeNull();
    expect(plotEdgeCreatePayload(undefined, undefined)).toBeNull();
    expect(plotEdgeCreatePayload("", "ch-2")).toBeNull();
    expect(plotEdgeCreatePayload("ch-1", "")).toBeNull();
  });
});

describe("canvasPlotEdges（关系列表 → 画布边）", () => {
  it("两端都在可见章集合内才出边；edge.id = 关系 id", () => {
    const edges = canvasPlotEdges([plotEdge("rel-1", "ch-1", "ch-2")], visible);
    expect(edges).toEqual([{ id: "rel-1", source: "ch-1", target: "ch-2", label: "" }]);
  });

  it("脏边丢弃：端点已软删 / 非章（卷、场景、人物）不在可见集合内", () => {
    const edges = canvasPlotEdges(
      [
        plotEdge("rel-ok", "ch-1", "ch-2"),
        plotEdge("rel-deleted-chapter", "ch-1", "ch-gone"),
        plotEdge("rel-volume", "vol-1", "ch-1"),
        plotEdge("rel-scene", "scene-1", "ch-2"),
        plotEdge("rel-character", "ch-3", "char-1"),
      ],
      visible,
    );
    expect(edges.map((edge) => edge.id)).toEqual(["rel-ok"]);
  });

  it("自连边丢弃（服务端不拦，画布画出来只会是一个圈）", () => {
    expect(canvasPlotEdges([plotEdge("rel-loop", "ch-1", "ch-1")], visible)).toEqual([]);
  });

  it("非 plot_edge 关系不进画布", () => {
    const appearsIn: RelationSummaryItem = {
      ...plotEdge("rel-appears", "ch-1", "ch-2"),
      relationType: "appears_in",
    };
    expect(canvasPlotEdges([appearsIn], visible)).toEqual([]);
  });

  it("label 取 metadata.label（trim）；坏值 / 缺失 = 空串（不画文字）", () => {
    const edges = canvasPlotEdges(
      [
        plotEdge("rel-label", "ch-1", "ch-2", { label: "  追杀  " }),
        plotEdge("rel-blank", "ch-2", "ch-3", { label: "   " }),
        plotEdge("rel-missing", "ch-1", "ch-3"),
        plotEdge("rel-bad", "ch-2", "ch-1", { label: 42, description: "长说明不进线上" }),
      ],
      visible,
    );
    expect(edges.map((edge) => edge.label)).toEqual(["追杀", "", "", ""]);
  });

  it("关系列表未就绪（null）→ 空数组（画布先出节点、后补边）", () => {
    expect(canvasPlotEdges(null, visible)).toEqual([]);
  });

  it("plotEdgeLabel：非字符串值按空串处理", () => {
    expect(plotEdgeLabel(undefined)).toBe("");
    expect(plotEdgeLabel({ label: ["a"] })).toBe("");
    expect(plotEdgeLabel({ label: " 推进 " })).toBe("推进");
  });
});

describe("adjacentPlotEdgeIds（单击卡片 = 聚焦其邻边）", () => {
  const edges = canvasPlotEdges(
    [
      plotEdge("rel-1", "ch-1", "ch-2"),
      plotEdge("rel-2", "ch-2", "ch-3"),
      plotEdge("rel-3", "ch-3", "ch-1"),
      plotEdge("rel-4", "ch-3", "ch-3b"),
    ],
    new Set([...visible, "ch-3b"]),
  );

  it("任一端点命中即算邻边（方向不影响）", () => {
    expect([...adjacentPlotEdgeIds(edges, "ch-2")]).toEqual(["rel-1", "rel-2"]);
    expect([...adjacentPlotEdgeIds(edges, "ch-1")]).toEqual(["rel-1", "rel-3"]);
  });

  it("无邻边 → 空集；未聚焦（null）→ 空集（调用点据此不降透明）", () => {
    expect([...adjacentPlotEdgeIds(edges, "ch-9")]).toEqual([]);
    expect([...adjacentPlotEdgeIds(edges, null)]).toEqual([]);
  });

  it("降透明档位是个小于 1 的正数（0 会把边彻底藏掉）", () => {
    expect(PLOT_EDGE_DIM_OPACITY).toBeGreaterThan(0);
    expect(PLOT_EDGE_DIM_OPACITY).toBeLessThan(1);
  });
});

describe("plotEdgeDeleteTargets（删边确认路径）", () => {
  const edges = canvasPlotEdges(
    [plotEdge("rel-1", "ch-1", "ch-2"), plotEdge("rel-2", "ch-2", "ch-3")],
    visible,
  );

  it("Delete 键 / 抽屉删除按钮给出的 id 解析成待确认的边", () => {
    expect(plotEdgeDeleteTargets(edges, ["rel-2"]).map((edge) => edge.id)).toEqual(["rel-2"]);
  });

  it("未知 id（脏数据 / 并发重拉后的旧选中）丢弃，不误删别的边", () => {
    expect(plotEdgeDeleteTargets(edges, ["rel-gone"]).map((edge) => edge.id)).toEqual([]);
    expect(plotEdgeDeleteTargets(edges, ["rel-1", "rel-gone"]).map((edge) => edge.id)).toEqual(["rel-1"]);
  });

  it("空删除事件 → 空结果（调用点不弹确认框）", () => {
    expect(plotEdgeDeleteTargets(edges, [])).toEqual([]);
  });
});
