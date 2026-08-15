// lib/timeline-detail 纯函数测试（C4，决策 26；G2.3 修订：occurs_at 挂载提取/请求体构造）
// 覆盖：occurs_in 关系提取（详情页关联节点列表）、occurs_at 挂载提取（详情页挂载选择器）、
//       关联/挂载请求体构造
//       （事件表单共享函数 eventFormFromDetail / buildEventDetailPatch 已随函数迁入 timeline.test.ts）
import { describe, expect, it } from "vitest";
import type { RelationSummaryItem } from "./api";
import {
  buildOccursAtRelationBody,
  buildOccursRelationBody,
  mountedTimepointId,
  occursInRelations,
} from "./timeline-detail";

/** 构造关系摘要（只关心 relationType/sourceType/sourceId/targetId 等展示与过滤字段） */
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

describe("mountedTimepointId（详情 relations → 当前挂载时间点，G2 挂载选择器）", () => {
  it("occurs_at 且事件为 target 端 → 返回时间点 sourceId（timepoint → event 方向约定）", () => {
    const relations = [
      relOf({
        id: "r1",
        sourceType: "timepoint",
        sourceId: "tp-a",
        targetType: "event",
        targetId: "ev-a",
        relationType: "occurs_at",
      }),
      relOf({ id: "r2", sourceId: "ev-a", targetId: "sc-1" }), // occurs_in 不参与
    ];
    expect(mountedTimepointId(relations, "ev-a")).toBe("tp-a");
  });

  it("无挂载（无 occurs_at / 其他事件为 target）→ null", () => {
    const relations = [
      relOf({ id: "r1", sourceId: "ev-a", targetId: "sc-1" }),
      relOf({
        id: "r2",
        sourceType: "timepoint",
        sourceId: "tp-a",
        targetType: "event",
        targetId: "ev-b", // 其他事件为 target
        relationType: "occurs_at",
      }),
    ];
    expect(mountedTimepointId(relations, "ev-a")).toBeNull();
    expect(mountedTimepointId([], "ev-a")).toBeNull();
  });

  it("防御：occurs_at 双语义（大纲节点承载的「出现于」）——sourceType 非 timepoint 不参与", () => {
    const relations = [
      relOf({
        id: "r1",
        sourceType: "outline_node",
        sourceId: "sc-1",
        targetType: "event",
        targetId: "ev-a",
        relationType: "occurs_at",
      }),
    ];
    expect(mountedTimepointId(relations, "ev-a")).toBeNull();
  });
});

describe("buildOccursAtRelationBody（挂载请求体，G2 组内新建/详情选择器复用）", () => {
  it("timepoint → event，occurs_at；id 原样透传", () => {
    expect(buildOccursAtRelationBody("tp-a", "ev-1")).toEqual({
      source_type: "timepoint",
      source_id: "tp-a",
      target_type: "event",
      target_id: "ev-1",
      relation_type: "occurs_at",
    });
  });
});
