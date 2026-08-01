// 常量断言测试（T1.2）：常量集与文档逐一核对
// 文档来源：schema.md 关系类型表、hooks.md hook 字段、决策 21 half_life 映射、tools.md 工具目录
import { describe, expect, expectTypeOf, it } from "vitest";
import type { EntityType } from "../types/entity.js";
import {
  ANALYSIS_TOOLS,
  AUTO_TOOLS,
  DEFAULT_HALF_LIFE,
  ENTITY_TYPES,
  EXECUTOR_TOOLS,
  HOOK_ANALYSIS_TOOLS,
  HOOK_CATEGORIES,
  HOOK_RELATION_TYPES,
  HOOK_STATUSES,
  PAYOFF_TIMING,
  PLOT_EDGE_TYPE,
  PROPOSAL_TOOLS,
  QUERY_TOOLS,
  RELATION_TYPES,
  TOOL_NAMES,
  TOOL_PERMISSION,
} from "./index.js";

describe("实体 / 关系常量（schema.md）", () => {
  it("ENTITY_TYPES 为 4 种实体类型，且与 types 的 EntityType 一致", () => {
    expect(ENTITY_TYPES).toEqual(["character", "setting", "location", "hook"]);
    expectTypeOf<(typeof ENTITY_TYPES)[number]>().toEqualTypeOf<EntityType>();
  });

  it("RELATION_TYPES 含全部 16 个预定义关系类型（schema.md 第 66-80 行）", () => {
    expect(RELATION_TYPES).toEqual([
      "belongs_to",
      "owns",
      "masters",
      "ally",
      "rival",
      "mentor",
      "family",
      "kills",
      "appears_in",
      "occurs_at",
      "plot_edge",
      "plants",
      "advances",
      "resolves",
      "depends_on",
      "involves",
    ]);
    expect(RELATION_TYPES).toHaveLength(16);
  });

  it("分类常量：plot_edge 与伏笔三关系", () => {
    expect(PLOT_EDGE_TYPE).toBe("plot_edge");
    expect(HOOK_RELATION_TYPES).toEqual(["plants", "advances", "resolves"]);
  });
});

describe("伏笔常量（hooks.md + 决策 21）", () => {
  it("HOOK_STATUSES 4 个状态（planted → progressing → resolved / abandoned）", () => {
    expect(HOOK_STATUSES).toEqual(["planted", "progressing", "resolved", "abandoned"]);
    expect(HOOK_STATUSES).toHaveLength(4);
  });

  it("PAYOFF_TIMING 5 种节奏", () => {
    expect(PAYOFF_TIMING).toEqual(["immediate", "near_term", "mid_arc", "slow_burn", "endgame"]);
    expect(PAYOFF_TIMING).toHaveLength(5);
  });

  it("DEFAULT_HALF_LIFE 缺省映射与决策 21 一致（单位：章）", () => {
    expect(DEFAULT_HALF_LIFE).toEqual({
      immediate: 3,
      near_term: 8,
      mid_arc: 15,
      slow_burn: 25,
      endgame: 40,
    });
  });

  it("HOOK_CATEGORIES 为前端建议值（hooks.md 自由分类示例）", () => {
    expect(HOOK_CATEGORIES).toEqual([
      "mystery",
      "relationship",
      "item",
      "character_growth",
      "world_building",
    ]);
  });
});

describe("工具常量（tools.md 工具目录）", () => {
  it("TOOL_PERMISSION 两级权限：自动 / 提案确认", () => {
    expect(TOOL_PERMISSION).toEqual({ AUTO: "auto", PROPOSAL: "proposal" });
  });

  it("查询类 8 个（tools.md「查询类」）", () => {
    expect(QUERY_TOOLS).toEqual([
      "get_entity",
      "search_entities",
      "query_relationships",
      "get_outline",
      "get_outline_path",
      "compute_state",
      "get_delta_history",
      "get_entity_summary",
    ]);
    expect(QUERY_TOOLS).toHaveLength(8);
  });

  it("分析类 5 个（tools.md「分析类」）", () => {
    expect(ANALYSIS_TOOLS).toEqual([
      "analyze_consistency",
      "detect_conflicts",
      "trace_plot_paths",
      "find_orphan_elements",
      "suggest_connections",
    ]);
    expect(ANALYSIS_TOOLS).toHaveLength(5);
  });

  it("伏笔分析 5 个（hooks.md 工具扩展分析类）", () => {
    expect(HOOK_ANALYSIS_TOOLS).toEqual([
      "analyze_hook_health",
      "trace_hook_lifecycle",
      "suggest_hook_payoff",
      "find_hook_opportunities",
      "detect_hook_conflicts",
    ]);
    expect(HOOK_ANALYSIS_TOOLS).toHaveLength(5);
  });

  it("提案类 14 个（tools.md 9 + hooks.md 5，无重复）", () => {
    expect(PROPOSAL_TOOLS).toEqual([
      "propose_create_entity",
      "propose_update_entity",
      "propose_delete_entity",
      "propose_add_relation",
      "propose_remove_relation",
      "propose_add_delta",
      "propose_outline_node",
      "propose_move_node",
      "propose_delete_node",
      "propose_create_hook",
      "propose_update_hook",
      "propose_advance_hook",
      "propose_resolve_hook",
      "propose_abandon_hook",
    ]);
    expect(PROPOSAL_TOOLS).toHaveLength(14);
  });

  it("执行类 12 个（tools.md「执行类」，不暴露给 LLM）", () => {
    expect(EXECUTOR_TOOLS).toEqual([
      "create_entity",
      "update_entity",
      "delete_entity",
      "add_relation",
      "remove_relation",
      "add_delta",
      "create_outline_node",
      "move_node",
      "delete_node",
      "advance_hook",
      "resolve_hook",
      "abandon_hook",
    ]);
    expect(EXECUTOR_TOOLS).toHaveLength(12);
  });

  it("分组无重叠且全量 44 个", () => {
    expect(AUTO_TOOLS).toHaveLength(18);
    expect(TOOL_NAMES).toHaveLength(44);
    // 各分组互不重叠
    const all = [...QUERY_TOOLS, ...ANALYSIS_TOOLS, ...HOOK_ANALYSIS_TOOLS, ...PROPOSAL_TOOLS, ...EXECUTOR_TOOLS];
    expect(new Set(all).size).toBe(all.length);
    // 全量集合 = 各分组之和
    expect(new Set(TOOL_NAMES)).toEqual(new Set(all));
  });
});
