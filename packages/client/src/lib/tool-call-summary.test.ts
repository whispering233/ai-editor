// lib/tool-call-summary 纯函数测试（决策 47，批次十四）：
// summarizeToolCall 摘要渲染（id 解析/未知工具回退/字段省略/对象值键名列表）+ collectIdCandidates 收集
import { describe, expect, it } from "vitest";
import { collectIdCandidates, formatValue, summarizeToolCall } from "./tool-call-summary";
import type { ResolvedNames } from "./api";

/** 解析结果 fixture（决策 47：label = 类型中文，name = 名称） */
const names: ResolvedNames = {
  "char-1": { label: "人物", name: "张三" },
  "sc-2": { label: "场景", name: "决斗现场" },
  "hook-3": { label: "伏笔", name: "玉佩来历" },
  "rel-9": null, // 关系无名称 → null
};

describe("summarizeToolCall", () => {
  it("get_entity：id 解析为「实体「名称」」+ 类型字段", () => {
    const lines = summarizeToolCall("get_entity", { type: "character", id: "char-1" }, names);
    expect(lines).toEqual(["查询实体：实体「张三」", "类型：character"]);
  });

  it("query_relationships：源/目标 id 解析 + 关系类型 + 深度", () => {
    const lines = summarizeToolCall(
      "query_relationships",
      { source_type: "character", source_id: "char-1", relation_type: "ally", depth: 2 },
      names,
    );
    expect(lines).toEqual(["查询关系：源「张三」", "关系类型：ally", "深度：2"]);
  });

  it("propose_update_entity：patches → 变更字段键名列表（不 dump JSON）", () => {
    const lines = summarizeToolCall(
      "propose_update_entity",
      { entity_id: "char-1", patches: { combat_power: 150, personality: "多疑" } },
      names,
    );
    expect(lines).toEqual(["更新实体：实体「张三」", "变更字段：combat_power、personality"]);
  });

  it("id 解析失败（null）→ 该字段省略；全部省略 → 仅动词短语", () => {
    // rel-9 解析为 null → 省略字段
    const lines = summarizeToolCall("propose_remove_relation", { relation_id: "rel-9" }, names);
    expect(lines).toEqual(["移除关系"]);
    // 未知 id 同理
    const unknown = summarizeToolCall("suggest_connections", { entity_id: "char-不存在" }, names);
    expect(unknown).toEqual(["关系发现"]);
  });

  it("names 未提供（null/undefined）→ id 字段省略但非 id 字段照常", () => {
    const lines = summarizeToolCall("get_outline_path", { node_id: "sc-2" }, null);
    expect(lines).toEqual(["读取节点路径"]);
    const withPlain = summarizeToolCall(
      "search_entities",
      { type: "character", query: "张三" },
      undefined,
    );
    expect(withPlain).toEqual(["搜索实体：类型：character", "关键词：张三"]);
  });

  it("propose_reorder_timepoints：无参摘要（可读描述由 preview.changes 承载）", () => {
    const lines = summarizeToolCall(
      "propose_reorder_timepoints",
      { timepoint_ids: ["tp-a", "tp-b"] },
      names,
    );
    expect(lines).toEqual(["重排时间点"]);
  });

  it("未知工具 → null（调用方回退原始 JSON 兜底）", () => {
    expect(summarizeToolCall("some_future_tool", { id: "char-1" }, names)).toBeNull();
  });

  it("args 为 null/undefined/非对象 → 仅动词短语行", () => {
    expect(summarizeToolCall("get_outline", null, names)).toEqual(["读取大纲"]);
    expect(summarizeToolCall("get_outline", undefined, names)).toEqual(["读取大纲"]);
    expect(
      summarizeToolCall("get_outline", "nope" as unknown as Record<string, unknown>, names),
    ).toEqual(["读取大纲"]);
  });

  it("无参工具（find_orphan_elements）→ 动词短语行", () => {
    expect(summarizeToolCall("find_orphan_elements", {}, names)).toEqual(["孤立元素诊断"]);
  });

  it("未收录字段不渲染（不泄漏裸 id）", () => {
    // get_entity 的 fields 无 parent_id 定义 → 不渲染该字段
    const lines = summarizeToolCall(
      "get_entity",
      { type: "character", id: "char-1", parent_id: "char-99" },
      names,
    );
    expect(lines).toEqual(["查询实体：实体「张三」", "类型：character"]);
  });
});

describe("collectIdCandidates", () => {
  it("收集字符串值与数组内字符串元素", () => {
    expect(
      collectIdCandidates({
        id: "char-1",
        type: "character",
        timepoint_ids: ["tp-a", "tp-b"],
        depth: 2,
        tags: ["a"],
      }),
    ).toEqual(["char-1", "character", "tp-a", "tp-b", "a"]);
  });

  it("null/undefined/非对象 → 空数组", () => {
    expect(collectIdCandidates(null)).toEqual([]);
    expect(collectIdCandidates(undefined)).toEqual([]);
    expect(collectIdCandidates("x")).toEqual([]);
  });
});

describe("formatValue", () => {
  it("对象数组 → 项数（不输出 [object Object]）", () => {
    expect(formatValue([{ op: "update", field: "name" }, { op: "set", field: "age" }])).toBe("2 项");
  });

  it("字符串数组 → join；对象 → 键名列表；标量 → String", () => {
    expect(formatValue(["a", "b"])).toBe("a、b");
    expect(formatValue({ a: 1, b: 2 })).toBe("a、b");
    expect(formatValue(3)).toBe("3");
    expect(formatValue(true)).toBe("true");
  });
});
