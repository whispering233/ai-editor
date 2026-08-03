// RelationsView 纯逻辑测试（U8 关联 tab）：仓库无 jsdom / @testing-library 环境（node 纯逻辑测试），
// 只测过滤纯函数 filterRelations——前端过滤是关联视图的核心契约（服务端不支持「任一端」OR 与名称模糊）。
import { describe, expect, it } from "vitest";
import type { RelationSummaryItem } from "../../lib/api";
import { EMPTY_RELATION_FILTER, filterRelations } from "./relations-view";

const makeRel = (over: Partial<RelationSummaryItem> & { id: string }): RelationSummaryItem => ({
  sourceType: "character",
  sourceId: "char-1",
  sourceName: "张三",
  targetType: "location",
  targetId: "loc-1",
  targetName: "灵根峰",
  relationType: "appears_in",
  createdAt: "2026-08-01T10:00:00Z",
  ...over,
});

const SAMPLE = [
  makeRel({ id: "r1", sourceType: "character", sourceName: "张三", targetType: "location", targetName: "灵根峰", relationType: "appears_in" }),
  makeRel({ id: "r2", sourceType: "character", sourceName: "李四", targetType: "character", targetName: "王五", relationType: "rival" }),
  makeRel({ id: "r3", sourceType: "setting", sourceName: "修真界", targetType: "outline_node", sourceId: "set-1", targetId: "ch-1", targetName: "第一章·入门", relationType: "involves" }),
  makeRel({ id: "r4", sourceType: "outline_node", sourceName: "第二章·试炼", sourceId: "ch-2", targetType: "hook", targetId: "hook-1", targetName: "身世之谜", relationType: "plants" }),
];

describe("filterRelations（关联总览前端过滤）", () => {
  it("空过滤条件返回全部", () => {
    expect(filterRelations(SAMPLE, EMPTY_RELATION_FILTER)).toHaveLength(4);
  });

  it("端点类型过滤：源端或目标端任一匹配（OR 语义）", () => {
    const out = filterRelations(SAMPLE, { ...EMPTY_RELATION_FILTER, endpointType: "location" });
    expect(out.map((r) => r.id)).toEqual(["r1"]);
    const ch = filterRelations(SAMPLE, { ...EMPTY_RELATION_FILTER, endpointType: "outline_node" });
    expect(ch.map((r) => r.id)).toEqual(["r3", "r4"]); // r3 目标端、r4 源端
  });

  it("关系类型过滤", () => {
    const out = filterRelations(SAMPLE, { ...EMPTY_RELATION_FILTER, relationType: "rival" });
    expect(out.map((r) => r.id)).toEqual(["r2"]);
  });

  it("名称搜索：源名命中（大小写不敏感）", () => {
    const out = filterRelations(SAMPLE, { ...EMPTY_RELATION_FILTER, nameQuery: "张" });
    expect(out.map((r) => r.id)).toEqual(["r1"]);
    const upper = filterRelations(SAMPLE, { ...EMPTY_RELATION_FILTER, nameQuery: "灵根" });
    expect(upper.map((r) => r.id)).toEqual(["r1"]);
    // 拉丁字母真正触达 toLowerCase 分支（中文无大小写概念）
    const latin = [
      makeRel({ id: "r6", sourceType: "character", sourceName: "Avatar", targetType: "character", targetName: "Zhong San", relationType: "ally" }),
    ];
    expect(filterRelations(latin, { ...EMPTY_RELATION_FILTER, nameQuery: "avatar" })).toHaveLength(1);
    expect(filterRelations(latin, { ...EMPTY_RELATION_FILTER, nameQuery: "zhong" })).toHaveLength(1);
  });

  it("名称搜索：目标名命中", () => {
    const out = filterRelations(SAMPLE, { ...EMPTY_RELATION_FILTER, nameQuery: "身世" });
    expect(out.map((r) => r.id)).toEqual(["r4"]);
  });

  it("名称搜索：sourceName/targetName 缺失时回退 id 匹配", () => {
    const noName = [
      makeRel({ id: "r5", sourceName: undefined, targetName: undefined, sourceId: "char-9", targetId: "loc-9", relationType: "appears_in" }),
    ];
    expect(filterRelations(noName, { ...EMPTY_RELATION_FILTER, nameQuery: "char-9" })).toHaveLength(1);
    expect(filterRelations(noName, { ...EMPTY_RELATION_FILTER, nameQuery: "loc-9" })).toHaveLength(1);
  });

  it("名称搜索：空白关键词视为不过滤", () => {
    expect(filterRelations(SAMPLE, { ...EMPTY_RELATION_FILTER, nameQuery: "   " })).toHaveLength(4);
  });

  it("多条件叠加（AND）", () => {
    const out = filterRelations(SAMPLE, { ...EMPTY_RELATION_FILTER, endpointType: "outline_node", nameQuery: "入门" });
    expect(out.map((r) => r.id)).toEqual(["r3"]);
    const none = filterRelations(SAMPLE, { ...EMPTY_RELATION_FILTER, endpointType: "hook", relationType: "rival" });
    expect(none).toHaveLength(0);
  });
});
