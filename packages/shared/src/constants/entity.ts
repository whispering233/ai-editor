// 实体 / 关系常量
// 契约来源：doc/database/schema.md（entities 表 type CHECK、预定义关系类型表第 66-80 行）
// 常量命名 UPPER_SNAKE_CASE，as const 保持字面量类型

/** 实体类型（entities 表 type 列 CHECK 约束，schema.md）——event 为时间轴事件（决策 26）；timepoint 为 G2 时间标签点（name=时间标签文本，data 空，决策 26 G2 修订）；reference 为参考资料（决策 36） */
export const ENTITY_TYPES = ["character", "setting", "location", "hook", "event", "timepoint", "reference"] as const;

/** 实体类型（单数，从常量派生；与 types/entity.ts 的 EntityType 一致，测试断言保证） */
export type EntityTypeValue = (typeof ENTITY_TYPES)[number];

/** 实体类型 → 中文标签（决策 47 names/resolve 与前端徽标共用；口径对齐 client 主流页面——character 用「人物」） */
export const ENTITY_TYPE_LABELS: Record<EntityTypeValue, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  event: "事件",
  timepoint: "时间点",
  reference: "参考资料",
};

/**
 * 预定义关系类型（schema.md 关系类型表，共 17 个）
 * belongs_to 所属 / owns 拥有 / masters 掌握 / ally·rival·mentor·family 人物间 /
 * kills 击杀 / appears_in 出现于大纲节点 / occurs_at 发生在地点（大纲节点→地点）＋
 *   timepoint→event 1:n 挂载（G2 时间标签点，决策 26 修订——同一关系类型双语义，端点类型区分） /
 * plot_edge 剧情连线（画布推演）/ plants·advances·resolves 伏笔管理 /
 * depends_on 伏笔依赖 / involves 伏笔涉及 /
 * occurs_in 事件锚定 发生于 | event→大纲节点，决策 26
 */
export const RELATION_TYPES = [
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
] as const;

/** 关系类型（从 RELATION_TYPES 派生） */
export type RelationType = (typeof RELATION_TYPES)[number];

/** 剧情连线关系类型（决策 10：画布连线用 plot_edge，metadata 存连线标签） */
export const PLOT_EDGE_TYPE = "plot_edge" as const;

/** 伏笔管理关系（hooks.md 伏笔关系约定：大纲节点 → hook） */
export const HOOK_RELATION_TYPES = ["plants", "advances", "resolves"] as const;

/** 伏笔管理关系类型 */
export type HookRelationType = (typeof HOOK_RELATION_TYPES)[number];
