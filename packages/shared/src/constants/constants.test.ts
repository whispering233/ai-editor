// 常量断言测试（T1.2）：常量集与文档逐一核对
// 文档来源：关系类型表、hook 字段、half_life 映射、工具目录
import { describe, expect, expectTypeOf, it } from "vitest";
import type { EntityType } from "../types/entity.js";
import {
  ANALYSIS_TOOLS,
  AUTO_TOOLS,
  BACKUP_FREQUENCIES,
  CONFLICT_LEVELS,
  DEFAULT_BACKUP_FREQUENCY_MINUTES,
  DEFAULT_HALF_LIFE,
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  EXECUTOR_TOOLS,
  HOOK_ANALYSIS_TOOLS,
  HOOK_CATEGORIES,
  HOOK_RELATION_TYPES,
  HOOK_STATUSES,
  MAX_BACKUP_NAME_LENGTH,
  MAX_BACKUPS_PER_PROJECT,
  OUTLINE_NODE_TYPE_LABELS,
  PAYOFF_TIMING,
  PLOT_EDGE_TYPE,
  PROPOSAL_TOOLS,
  QUERY_TOOLS,
  RELATION_TYPES,
  RELATION_TYPE_META,
  REMOVED_CHARACTER_FIELDS,
  SET_ONLY_FIELDS,
  IMMUTABLE_FIELDS,
  TOOL_NAMES,
  TOOL_PERMISSION,
} from "./index.js";

describe("实体 / 关系常量", () => {
  it("ENTITY_TYPES 为 7 种实体类型（含 event 时间轴事件；timepoint G2 时间标签点；reference 参考资料），且与 types 的 EntityType 一致", () => {
    expect(ENTITY_TYPES).toEqual(["character", "setting", "location", "hook", "event", "timepoint", "reference"]);
    expectTypeOf<(typeof ENTITY_TYPES)[number]>().toEqualTypeOf<EntityType>();
  });

  it("ENTITY_TYPE_LABELS 覆盖全部实体类型（names/resolve 用；character 口径 = 人物）", () => {
    expect(Object.keys(ENTITY_TYPE_LABELS).sort()).toEqual([...ENTITY_TYPES].sort());
    expect(ENTITY_TYPE_LABELS.character).toBe("人物");
    expect(ENTITY_TYPE_LABELS.reference).toBe("参考资料");
    expect(ENTITY_TYPE_LABELS.timepoint).toBe("时间点");
  });

  it("OUTLINE_NODE_TYPE_LABELS 覆盖卷/章/场景（names/resolve 用）", () => {
    expect(OUTLINE_NODE_TYPE_LABELS).toEqual({ volume: "卷", chapter: "章", scene: "场景" });
  });

  it("RELATION_TYPES 含全部 17 个预定义关系类型", () => {
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
      "occurs_in",
    ]);
    expect(RELATION_TYPES).toHaveLength(17);
  });

  it("分类常量：plot_edge 与伏笔三关系", () => {
    expect(PLOT_EDGE_TYPE).toBe("plot_edge");
    expect(HOOK_RELATION_TYPES).toEqual(["plants", "advances", "resolves"]);
  });

  it("RELATION_TYPE_META 覆盖全部预定义类型：label 非空、group 合法、对称集合恰为 ally/rival/family", () => {
    const groups = new Set(["character", "structure", "anchor", "hook", "mount", "canvas"]);
    expect(Object.keys(RELATION_TYPE_META).sort()).toEqual([...RELATION_TYPES].sort());
    for (const t of RELATION_TYPES) {
      expect(RELATION_TYPE_META[t].label.trim().length).toBeGreaterThan(0);
      expect(groups.has(RELATION_TYPE_META[t].group)).toBe(true);
    }
 // 抽样核对实际口径（避免只断言结构）
    expect(RELATION_TYPE_META.ally.label).toBe("盟友");
    expect(RELATION_TYPE_META.occurs_at).toEqual({ label: "发生于", group: "mount" });
    expect(RELATION_TYPE_META.plot_edge).toEqual({ label: "剧情连线", group: "canvas" });
 // 对称集合 = symmetric 派生（单一来源；tools/client 消费方同此口径）
    expect(RELATION_TYPES.filter((t) => RELATION_TYPE_META[t].symmetric === true)).toEqual([
      "ally",
      "rival",
      "family",
    ]);
  });
});

describe("大纲节点常量（麦基字段集）", () => {
  it("CONFLICT_LEVELS 为麦基冲突三层次（inner/personal/extra_personal）", () => {
    expect(CONFLICT_LEVELS).toEqual(["inner", "personal", "extra_personal"]);
    expect(CONFLICT_LEVELS).toHaveLength(3);
  });
});

describe("伏笔常量", () => {
  it("HOOK_STATUSES 4 个状态（planted → progressing → resolved / abandoned）", () => {
    expect(HOOK_STATUSES).toEqual(["planted", "progressing", "resolved", "abandoned"]);
    expect(HOOK_STATUSES).toHaveLength(4);
  });

  it("PAYOFF_TIMING 5 种节奏", () => {
    expect(PAYOFF_TIMING).toEqual(["immediate", "near_term", "mid_arc", "slow_burn", "endgame"]);
    expect(PAYOFF_TIMING).toHaveLength(5);
  });

  it("Delta 字段约束常量（卡片 5.5）：单一定义——client 下拉与 tools 写入守卫共消费", () => {
 // 事实字段（只能用 op=set）：`docs/design/10-data-model.md` §4
    expect(SET_ONLY_FIELDS).toEqual({ hook: ["status"] });
 // character 已移除字段（schema 已删，写入只会留脏键）：`docs/db/schema.md`「人物 data 分层」
    expect(REMOVED_CHARACTER_FIELDS).toEqual(["status", "abilities"]);
  });

  it("不可变字段白名单（卡片 5.6）：character 仅 role/description——单一定义供 client 与 tools 消费", () => {
 // `docs/db/schema.md`「人物 data 分层」/`docs/design/10-data-model.md` §14 不变式 1
 //（client：字段下拉排除 + 基础信息区字段集；tools：`proposal/delta` 提案层守卫）
    expect(IMMUTABLE_FIELDS).toEqual({ character: ["role", "description"] });
 // 与「已移除字段」互斥：同一字段不得同时是不可变与已移除（否则消费方语义互诉）
    expect(IMMUTABLE_FIELDS.character.filter((f) => REMOVED_CHARACTER_FIELDS.includes(f))).toEqual([]);
  });

  it("DEFAULT_HALF_LIFE 缺省映射与 一致（单位：章）", () => {
    expect(DEFAULT_HALF_LIFE).toEqual({
      immediate: 3,
      near_term: 8,
      mid_arc: 15,
      slow_burn: 25,
      endgame: 40,
    });
  });

  it("HOOK_CATEGORIES 为前端建议值", () => {
    expect(HOOK_CATEGORIES).toEqual([
      "mystery",
      "relationship",
      "item",
      "character_growth",
      "world_building",
    ]);
  });
});

describe("工具常量", () => {
  it("TOOL_PERMISSION 两级权限：自动 / 提案确认", () => {
    expect(TOOL_PERMISSION).toEqual({ AUTO: "auto", PROPOSAL: "proposal" });
  });

  it("查询类 10 个", () => {
    expect(QUERY_TOOLS).toEqual([
      "get_entity",
      "search_entities",
      "search_references", //
      "query_relationships",
      "get_outline",
      "get_outline_path",
      "get_chapter_text", // 章正文只读（卡 12.9）
      "compute_state",
      "get_delta_history",
      "get_entity_summary",
    ]);
    expect(QUERY_TOOLS).toHaveLength(10);
  });

  it("分析类 5 个", () => {
    expect(ANALYSIS_TOOLS).toEqual([
      "analyze_consistency",
      "detect_conflicts",
      "trace_plot_paths",
      "find_orphan_elements",
      "suggest_connections",
    ]);
    expect(ANALYSIS_TOOLS).toHaveLength(5);
  });

  it("伏笔分析 5 个", () => {
    expect(HOOK_ANALYSIS_TOOLS).toEqual([
      "analyze_hook_health",
      "trace_hook_lifecycle",
      "suggest_hook_payoff",
      "find_hook_opportunities",
      "detect_hook_conflicts",
    ]);
    expect(HOOK_ANALYSIS_TOOLS).toHaveLength(5);
  });

  it("提案类 16 个", () => {
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
      "propose_reorder_timepoints",
      "propose_create_reference",
    ]);
    expect(PROPOSAL_TOOLS).toHaveLength(16);
  });

  it("执行类 13 个", () => {
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
      "reorder_timepoints",
    ]);
    expect(EXECUTOR_TOOLS).toHaveLength(13);
  });

  it("分组无重叠且全量 49 个", () => {
    expect(AUTO_TOOLS).toHaveLength(20); // +get_chapter_text（卡 12.9）
    expect(TOOL_NAMES).toHaveLength(49); // 48 + get_chapter_text(自动、正文只读)
 // 各分组互不重叠
    const all = [...QUERY_TOOLS, ...ANALYSIS_TOOLS, ...HOOK_ANALYSIS_TOOLS, ...PROPOSAL_TOOLS, ...EXECUTOR_TOOLS];
    expect(new Set(all).size).toBe(all.length);
 // 全量集合 = 各分组之和
    expect(new Set(TOOL_NAMES)).toEqual(new Set(all));
  });
});

describe("自动备份常量（B2.1）", () => {
  it("BACKUP_FREQUENCIES 为 [1, 5, 10, 15, 30, 60]", () => {
    expect(BACKUP_FREQUENCIES).toEqual([1, 5, 10, 15, 30, 60]);
    expect(BACKUP_FREQUENCIES).toHaveLength(6);
    expect(BACKUP_FREQUENCIES).toContain(DEFAULT_BACKUP_FREQUENCY_MINUTES);
  });

  it("缺省频率 = 10（新项目默认开启）", () => {
    expect(DEFAULT_BACKUP_FREQUENCY_MINUTES).toBe(10);
  });

  it("每项目保留最近 20 份（超出删除最旧，含覆盖前自动快照）", () => {
    expect(MAX_BACKUPS_PER_PROJECT).toBe(20);
  });

  it("手动备份自定义名称最大长度 = 30", () => {
    expect(MAX_BACKUP_NAME_LENGTH).toBe(30);
  });
});