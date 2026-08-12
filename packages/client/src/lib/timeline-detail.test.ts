// lib/timeline-detail 纯函数测试（C4，决策 26）
// 覆盖：occurs_in 关系提取（详情页关联节点列表）、关联请求体构造
//       （事件表单共享函数 eventFormFromDetail / buildEventDetailPatch 已随函数迁入 timeline.test.ts）
import { describe, expect, it } from "vitest";
import type { RelationSummaryItem } from "./api";
import { buildOccursRelationBody, occursInRelations } from "./timeline-detail";

/** 构造关系摘要（只关心 relationType/sourceId/targetName 等展示与过滤字段） */
function relOf(over: Partial<RelationSummaryItem>): RelationSummaryItem {
  return {
    id: "rel-1",
    sourceType: "event",
    sourceId: "ev-a",
    targetType: "outline_node",
    targetId: "sc-1",
    relationType: "occurs_in",
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("occursInRelations（详情 relations → 锚定节点关系，timeline.md 关联列表）", () => {
  it("仅提取 occurs_in 且 sourceId === 本事件（事件为 source 端，决策 26 方向约定）", () => {
    const relations = [
      relOf({ id: "r1", sourceId: "ev-a", targetId: "sc-1", targetName: "第3章·灵根测试" }),
      relOf({ id: "r2", sourceId: "ev-a", targetId: "sc-9", targetName: "第5章·宗门大比" }),
    ];
    expect(occursInRelations(relations, "ev-a").map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("忽略其他事件为 source 的 occurs_in（多事件同节点场景各自锚定）", () => {
    const relations = [
      relOf({ id: "r1", sourceId: "ev-a", targetId: "sc-1" }),
      relOf({ id: "r2", sourceId: "ev-b", targetId: "sc-1" }),
    ];
    expect(occursInRelations(relations, "ev-a").map((r) => r.id)).toEqual(["r1"]);
  });

  it("忽略非 occurs_in 关系类型（详情 relations 含全部 1 跳类型）", () => {
    const relations = [relOf({ id: "r1", relationType: "plot_edge" }), relOf({ id: "r2", relationType: "involves" })];
    expect(occursInRelations(relations, "ev-a")).toEqual([]);
  });

  it("空/无匹配 → 空数组", () => {
    expect(occursInRelations([], "ev-a")).toEqual([]);
  });
});

describe("buildOccursRelationBody（关联请求体，endpoints.md POST /relation）", () => {
  it("event → outline_node，occurs_in；id 原样透传", () => {
    expect(buildOccursRelationBody("ev-a", "ch-3")).toEqual({
      source_type: "event",
      source_id: "ev-a",
      target_type: "outline_node",
      target_id: "ch-3",
      relation_type: "occurs_in",
    });
  });
});
