// 实体 / 关系常量
// 常量命名 UPPER_SNAKE_CASE，as const 保持字面量类型

/** 实体类型（entities 表 type 列 CHECK 约束）——event 为时间轴事件；timepoint 为 G2 时间标签点（name=时间标签文本，data 空，G2 修订）；reference 为参考资料 */
export const ENTITY_TYPES = ["character", "setting", "location", "hook", "event", "timepoint", "reference"] as const;

/** 实体类型（单数，从常量派生；与 types/entity.ts 的 EntityType 一致，测试断言保证） */
export type EntityTypeValue = (typeof ENTITY_TYPES)[number];

/** 实体类型 → 中文标签（names/resolve 与前端徽标共用；口径对齐 client 主流页面——character 用「人物」） */
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
 * 预定义关系类型（关系类型表，共 17 个）
 * belongs_to 所属 / owns 拥有 / masters 掌握 / ally·rival·mentor·family 人物间 /
 * kills 击杀 / appears_in 出现于大纲节点 / occurs_at 发生在地点（大纲节点→地点）＋
 * timepoint→event 1:n 挂载（G2 时间标签点，——同一关系类型双语义，端点类型区分） /
 * plot_edge 剧情连线（画布推演）/ plants·advances·resolves 伏笔管理 /
 * depends_on 伏笔依赖 / involves 伏笔涉及 /
 * occurs_in 事件锚定 发生于 | event→大纲节点，
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

/**
 * 关系类型分组（UI 语义分区）：character 人↔人 / structure 层级与归属 / anchor 大纲节点锚定 /
 * hook 伏笔链路 / mount 时间轴挂载（由时间轴 UI 专管，通用对话框不暴露）/ canvas 画布推演。
 */
export type RelationTypeGroup = "character" | "structure" | "anchor" | "hook" | "mount" | "canvas";

/**
 * 关系类型属性注册表（**单一来源**）：client 中文标签、人物页人↔人子集、对话框排除集、
 * tools 冲突检测的对称口径一律由此派生，禁止手抄清单。`Record<RelationType, …>` ⇒
 * 新增预定义类型必须补属性，否则编译失败。
 * `symmetric` 仅对称类型（语义对等，展示层合并 + 冲突检测把单向存在报为缺口）标注——
 * 未标注即有向；自定义类型一律有向。
 */
export const RELATION_TYPE_META: Record<
  RelationType,
  { label: string; group: RelationTypeGroup; symmetric?: true }
> = {
  belongs_to: { label: "所属", group: "structure" },
  owns: { label: "拥有", group: "structure" },
  masters: { label: "掌握", group: "structure" },
  ally: { label: "盟友", group: "character", symmetric: true },
  rival: { label: "对手", group: "character", symmetric: true },
  mentor: { label: "师徒", group: "character" },
  family: { label: "家族", group: "character", symmetric: true },
  kills: { label: "击杀", group: "character" },
  appears_in: { label: "出现于", group: "anchor" },
  occurs_at: { label: "发生于", group: "mount" },
  plot_edge: { label: "剧情连线", group: "canvas" },
  plants: { label: "埋设", group: "hook" },
  advances: { label: "推进", group: "hook" },
  resolves: { label: "回收", group: "hook" },
  depends_on: { label: "依赖", group: "hook" },
  involves: { label: "涉及", group: "hook" },
  occurs_in: { label: "锚定于", group: "anchor" },
};

/** 实体列表 `limit` 上限（**单一定义**）：REST schema（types/api.ts 的 `.max()`）、
 * db 查询层 clamp（queries/entity.ts）、工具调用点（tools 的 listEntities 调用）与
 * 提案 schema 的 maxItems 一律引用本常量——散文与注释不得复述数字（AGENTS.md「数值单源」）。 */
export const MAX_ENTITY_LIST_LIMIT = 200;

/** 实体列表 `limit` 缺省（**单一定义**）：REST schema 的 `.default()` 与 db 查询层 `??` 兜底同源。 */
export const DEFAULT_ENTITY_LIST_LIMIT = 50;

/**
 * 角色优先级档（character 专属，**有序**）：作者视角的档位分类。
 * **单一定义**（`docs/db/schema.md`「人物 data 分层」）——档位取值、顺序、中文标签只在此处出现：
 * UI 下拉、AI 工具说明、列表 `sort=priority` 的 rank 一律由此派生，禁止手抄第二份表。
 * 数组顺序 = 排序 rank（主角在前）。**未分级 = 键缺失 / `null` / 未知值**，不是第五档。
 */
export const CHARACTER_PRIORITIES = ["protagonist", "major", "minor", "extra"] as const;

/** 角色优先级档（从 CHARACTER_PRIORITIES 派生） */
export type CharacterPriority = (typeof CHARACTER_PRIORITIES)[number];

/** 角色优先级档 → 中文标签（`Record<CharacterPriority, …>` ⇒ 增删档位必须同步补标签，否则编译失败） */
export const CHARACTER_PRIORITY_LABELS: Record<CharacterPriority, string> = {
  protagonist: "主角",
  major: "主要配角",
  minor: "配角",
  extra: "龙套",
};

/**
 * 档位 rank（0 起，= `CHARACTER_PRIORITIES` 下标）：未分级（缺键 / `null` / 非字符串 / 未知串）→ `null`。
 * 排序消费方（db 的 SQL CASE 由同一数组顺序生成）按「有档位者在前、`null` 沉底」处理。
 */
export function characterPriorityRank(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const rank = CHARACTER_PRIORITIES.indexOf(value as CharacterPriority);
  return rank < 0 ? null : rank;
}

/** 伏笔管理关系（伏笔关系约定：大纲节点 → hook） */
export const HOOK_RELATION_TYPES = ["plants", "advances", "resolves"] as const;

/** 伏笔管理关系类型 */
export type HookRelationType = (typeof HOOK_RELATION_TYPES)[number];
