// outline-hooks 纯函数测试（S9.2）：关系行 → 节点标记映射——聚合/过滤/名称兜底/稳定排序/空数据
import { describe, expect, it } from "vitest";
import type { RelationSummaryItem } from "./api";
import { buildNodeHookMarks, HOOK_MARK_TYPE_ORDER, HOOK_MARK_TYPES } from "./outline-hooks";

/** 关系 fixture（默认 outline_node → hook 的 plants；hooks.md 标记关系方向） */
function rel(
  sourceId: string,
  targetId: string,
  relationType: string,
  overrides?: Partial<RelationSummaryItem>,
): RelationSummaryItem {
  return {
    id: `rel-${sourceId}-${targetId}-${relationType}`,
    sourceType: "outline_node",
    sourceId,
    targetType: "hook",
    targetId,
    targetName: `伏笔${targetId}`,
    relationType,
    createdAt: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

describe("HOOK_MARK_TYPES（标记类型常量）", () => {
  it("恰为 plants/advances/resolves 三类（hooks.md 生命周期关系）", () => {
    expect(HOOK_MARK_TYPES).toEqual(["plants", "advances", "resolves"]);
  });
});

describe("buildNodeHookMarks（关系行 → 节点标记映射）", () => {
  it("按 source_id 分组聚合：同一节点多类型/多伏笔归入同一列表", () => {
    const map = buildNodeHookMarks([
      rel("sc-12", "hook-1", "plants"),
      rel("sc-12", "hook-2", "plants"),
      rel("sc-12", "hook-1", "advances"),
      rel("sc-20", "hook-1", "advances"),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("sc-12")?.map((m) => m.hookId)).toEqual(["hook-1", "hook-2", "hook-1"]);
    expect(map.get("sc-20")?.map((m) => m.hookId)).toEqual(["hook-1"]);
  });

  it("过滤非标记类型（depends_on/involves/plot_edge 不构成节点标记）", () => {
    const map = buildNodeHookMarks([
      rel("sc-12", "hook-1", "plants"),
      rel("sc-12", "hook-1", "depends_on", { sourceType: "hook" }),
      rel("sc-12", "hook-1", "involves", { sourceType: "hook" }),
      rel("sc-12", "ch-9", "plot_edge", { targetType: "outline_node" }),
    ]);
    expect(map.size).toBe(1);
    expect(map.get("sc-12")?.map((m) => m.relationType)).toEqual(["plants"]);
  });

  it("过滤方向不符的关系（source 非 outline_node / target 非 hook 的脏数据）", () => {
    const map = buildNodeHookMarks([
      rel("sc-12", "hook-1", "plants", { sourceType: "chapter" }), // 节点侧语义不符
      rel("hook-1", "sc-12", "plants", { sourceType: "hook", targetType: "outline_node" }), // 反方向
      rel("sc-12", "char-3", "plants", { targetType: "character" }), // 对端非伏笔
    ]);
    expect(map.size).toBe(0);
  });

  it("名称兜底：targetName 缺失用 targetId（联表名可能缺省）", () => {
    const map = buildNodeHookMarks([rel("sc-12", "hook-9", "plants", { targetName: undefined })]);
    const mark = map.get("sc-12")?.[0];
    expect(mark?.hookName).toBe("hook-9");
  });

  it("名称优先：联表 targetName 存在时不用 id", () => {
    const map = buildNodeHookMarks([rel("sc-12", "hook-9", "plants")]);
    const mark = map.get("sc-12")?.[0];
    expect(mark?.hookName).toBe("伏笔hook-9");
    expect(mark?.hookId).toBe("hook-9");
  });

  it("稳定排序：类型序（plants → advances → resolves）优先，同类型按名称、名称同按 id", () => {
    // 乱序输入（跨请求合并后顺序不定）→ 输出按类型序 + 名称 + id 全序确定化
    const map = buildNodeHookMarks([
      rel("sc-1", "hook-z", "resolves"),
      rel("sc-1", "hook-a", "advances"),
      rel("sc-1", "hook-a", "plants"),
      rel("sc-1", "hook-b", "plants"),
    ]);
    expect(map.get("sc-1")?.map((m) => `${m.relationType}:${m.hookId}`)).toEqual([
      "plants:hook-a",
      "plants:hook-b",
      "advances:hook-a",
      "resolves:hook-z",
    ]);
  });

  it("同类型同名称（如 name 兜底 = id 时）按 hookId 保证全序", () => {
    const map = buildNodeHookMarks([
      rel("sc-1", "hook-9", "plants", { targetName: undefined }),
      rel("sc-1", "hook-2", "plants", { targetName: undefined }),
    ]);
    expect(map.get("sc-1")?.map((m) => m.hookId)).toEqual(["hook-2", "hook-9"]);
  });

  it("空输入 → 空映射（无标记节点不产生条目）", () => {
    expect(buildNodeHookMarks([]).size).toBe(0);
  });

  it("标记类型展示序常量与生命周期一致（埋下 → 推进 → 回收）", () => {
    expect(HOOK_MARK_TYPE_ORDER).toEqual(["plants", "advances", "resolves"]);
  });
});
