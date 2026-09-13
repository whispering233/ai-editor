// 人物关系网 / 其他关联分区纯函数（卡 3.6）
// 契约：`docs/ui/DESIGN.md` §数据展示 `character-relations`（分组 + 方向箭头 + 对称关系显示去重 +
// 「其他关联」折叠区）与 `docs/design/10-data-model.md` §14（关系网 = `relation_records`，
// **不参与 computeState**——故全部在 tab 之下、两个视图共享）。
//
// 分区判据 = **另一端端点类型**（另一端是 `character` → 关系网；否则 → 其他关联）——
// 不维护白名单，将来新增人↔人关系类型自动落对分区。
// 本模块只做数据整形（分区/分组/去重/排序/文案），不碰 DOM、不发请求，便于单测（仓内无 jsdom）。
import { ENTITY_TYPES, RELATION_TYPES, RELATION_TYPE_META } from "@whispering233/ai-editor-shared";
import type { EntityType } from "@whispering233/ai-editor-shared";
import type { RelationSummaryItem } from "./api";
import { entityDetailPath } from "./entity-paths";
import { relationTypeLabel } from "./entity-detail";

/**
 * 人↔人关系类型（关系网区「+ 添加人物关系」下拉集）= 注册表 `group === "character"` 派生
 * （`ally`/`rival`/`mentor`/`family`/`kills`）；序 = `RELATION_TYPES` 序。
 */
export const INTER_CHARACTER_RELATION_TYPES: readonly string[] = RELATION_TYPES.filter(
  (t) => RELATION_TYPE_META[t].group === "character",
);

/**
 * 对称关系类型（语义对称，不区分方向）= 注册表 `symmetric` 派生（`ally`/`rival`/`family`）：
 * 同时存在 A→B 与 B→A 两条边时**合并显示一行 + 「双向」徽标**。
 * **仅显示层去重**——不自动建反边（不做双写）；删行只删其中一条（见 `characterRelationDeleteDescription`）。
 * `mentor`（师徒）/ `kills` 有向，不去重。
 */
export const SYMMETRIC_CHARACTER_RELATION_TYPES: readonly string[] = RELATION_TYPES.filter(
  (t) => RELATION_TYPE_META[t].symmetric === true,
);

/** 关系端点（另一端） */
export interface CharacterRelationEndpoint {
  type: string;
  id: string;
  name: string;
}

/** 行方向：out = 本角色 → 对方；in = 对方 → 本角色；both = 对称关系的双向合并行；self = 自环 */
export type CharacterRelationDirection = "out" | "in" | "both" | "self";

/** 关系网/其他关联的一行 */
export interface CharacterRelationRow {
  /** 行 key（含类型与端点，稳定） */
  key: string;
  /** 删除目标：本行代表的那条边（**合并行 = 本角色为 source 的那条**） */
  relationId: string;
  relationType: string;
  other: CharacterRelationEndpoint;
  direction: CharacterRelationDirection;
  /** `metadata` 备注（无内容 → null） */
  note: string | null;
}

/** 按关系类型分组的关系网内容（组序 = `RELATION_TYPES` 序，未知类型置尾） */
export interface CharacterRelationGroup {
  relationType: string;
  rows: CharacterRelationRow[];
}

/** 「另一端」备注截断长度（长 metadata 会撑破行布局） */
export const RELATION_NOTE_MAX_LENGTH = 120;

/** 关系视角入参（行构造统一入口：自环名称需要本角色名） */
export interface CharacterRelationSelf {
  selfId: string;
  selfName: string;
}

/** 方向判据（本角色为 source 且对方不是自己 → out；反之 in；两端都是自己 → self；都不是 → null） */
function directionOf(
  relation: RelationSummaryItem,
  selfId: string,
): CharacterRelationDirection | null {
  const isSource = relation.sourceId === selfId;
  const isTarget = relation.targetId === selfId;
  if (isSource && isTarget) return "self";
  if (isSource) return "out";
  if (isTarget) return "in";
  return null;
}

/**
 * 另一端端点（另一端 = 不是本角色的那一端；自环时两端都是自己 → 返回本角色自身）。
 * 名称：联表 `targetName`/`sourceName` 优先，缺省用 id（与既有 `relationEndpointName` 同口径）；
 * 自环/两端同 id 时用本角色名（联表值优先——它是权威展示名）。
 */
export function relationOtherEndpoint(
  relation: RelationSummaryItem,
  self: CharacterRelationSelf,
): CharacterRelationEndpoint | null {
  const direction = directionOf(relation, self.selfId);
  if (direction === null) return null;
  if (direction === "self") {
    return {
      type: relation.targetType,
      id: relation.targetId,
      name: relation.targetName ?? relation.sourceName ?? self.selfName,
    };
  }
  if (direction === "out") {
    return {
      type: relation.targetType,
      id: relation.targetId,
      name: relation.targetName ?? relation.targetId,
    };
  }
  return {
    type: relation.sourceType,
    id: relation.sourceId,
    name: relation.sourceName ?? relation.sourceId,
  };
}

/** `metadata` → 备注行（`label` 字符串优先；否则紧凑 JSON；空对象/非对象 → null）。防御：解析失败不抛错 */
export function characterRelationNote(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  const label = record.label;
  if (typeof label === "string" && label.trim() !== "") {
    return label.trim().slice(0, RELATION_NOTE_MAX_LENGTH);
  }
  const keys = Object.keys(record);
  if (keys.length === 0) return null;
  try {
    const json = JSON.stringify(record);
    if (typeof json !== "string" || json === "{}") return null;
    return json.slice(0, RELATION_NOTE_MAX_LENGTH);
  } catch {
    return null;
  }
}

/**
 * 分区（另一端端点类型）：`network` = 另一端是 `character`；`other` = 其余（`appears_in`/`belongs_to`/`owns`/`masters`…）。
 * 两端都不是本角色的脏数据（1 跳查询不应出现）→ 归入 `other`（不静默丢数据）。
 */
export function partitionCharacterRelations(
  relations: readonly RelationSummaryItem[],
  self: CharacterRelationSelf,
): { network: RelationSummaryItem[]; other: RelationSummaryItem[] } {
  const network: RelationSummaryItem[] = [];
  const other: RelationSummaryItem[] = [];
  for (const relation of relations) {
    const endpoint = relationOtherEndpoint(relation, self);
    if (endpoint !== null && endpoint.type === "character") network.push(relation);
    else other.push(relation);
  }
  return { network, other };
}

/** 类型序（`RELATION_TYPES` 下标；未知类型置尾，同尾按名称稳定） */
function relationTypeRank(relationType: string): number {
  const index = RELATION_TYPES.indexOf(relationType as (typeof RELATION_TYPES)[number]);
  return index === -1 ? RELATION_TYPES.length : index;
}

/** 行比较器（对方姓名 → 对方 id → 方向 → relationId，全序稳定） */
const DIRECTION_RANK: Record<CharacterRelationDirection, number> = {
  out: 0,
  both: 1,
  self: 2,
  in: 3,
};

function compareRows(a: CharacterRelationRow, b: CharacterRelationRow): number {
  return (
    a.other.name.localeCompare(b.other.name) ||
    a.other.id.localeCompare(b.other.id) ||
    DIRECTION_RANK[a.direction] - DIRECTION_RANK[b.direction] ||
    a.relationId.localeCompare(b.relationId)
  );
}

/** 边 → 行（方向为 null 的脏数据 → null，调用方跳过） */
function toRow(
  relation: RelationSummaryItem,
  self: CharacterRelationSelf,
  direction: CharacterRelationDirection,
): CharacterRelationRow | null {
  const other = relationOtherEndpoint(relation, self);
  if (other === null) return null;
  return {
    key: `${relation.relationType}:${direction}:${relation.id}`,
    relationId: relation.id,
    relationType: relation.relationType,
    other,
    direction,
    note: characterRelationNote(relation.metadata),
  };
}

/**
 * 关系网 → 按关系类型分组的行（含对称关系显示去重）。
 * - 分组：类型序（`RELATION_TYPES`）稳定；组内按对方姓名排序（`compareRows`）。
 * - **去重（仅 `SYMMETRIC_CHARACTER_RELATION_TYPES`）**：同一 (类型, 对方) 同时存在 out 与 in →
 *   合并一行（`direction: "both"`），`relationId` 取 **out 边**、备注取 out 边优先（缺省回退 in 边）。
 * - 有向类型（`mentor`/`kills`）不去重：A→B 与 B→A 是两条独立事实，各占一行。
 * - 自环（两端都是本角色）单独一行，不参与合并。
 */
export function buildCharacterRelationGroups(
  network: readonly RelationSummaryItem[],
  self: CharacterRelationSelf,
): CharacterRelationGroup[] {
  /** (类型, 对方 id) → { out, in, self } 边桶 */
  interface Bucket {
    out: RelationSummaryItem[];
    in: RelationSummaryItem[];
    selfLoop: RelationSummaryItem[];
    other: CharacterRelationEndpoint;
  }
  const byType = new Map<string, Map<string, Bucket>>();
  for (const relation of network) {
    const direction = directionOf(relation, self.selfId);
    const endpoint = relationOtherEndpoint(relation, self);
    if (direction === null || endpoint === null) continue; // 脏数据（两端都不是本角色）——分区已兜进 other
    let buckets = byType.get(relation.relationType);
    if (buckets === undefined) {
      buckets = new Map();
      byType.set(relation.relationType, buckets);
    }
    let bucket = buckets.get(endpoint.id);
    if (bucket === undefined) {
      bucket = { out: [], in: [], selfLoop: [], other: endpoint };
      buckets.set(endpoint.id, bucket);
    }
    if (direction === "self") bucket.selfLoop.push(relation);
    else if (direction === "out") bucket.out.push(relation);
    else bucket.in.push(relation);
  }

  const groups: CharacterRelationGroup[] = [];
  for (const [relationType, buckets] of byType) {
    const symmetric = SYMMETRIC_CHARACTER_RELATION_TYPES.includes(relationType);
    const rows: CharacterRelationRow[] = [];
    for (const bucket of buckets.values()) {
      for (const relation of bucket.selfLoop) {
        const row = toRow(relation, self, "self");
        if (row !== null) rows.push(row);
      }
      if (symmetric && bucket.out.length > 0 && bucket.in.length > 0) {
        const out = bucket.out[0];
        const inbound = bucket.in[0];
        rows.push({
          key: `${relationType}:both:${out.id}:${inbound.id}`,
          relationId: out.id, // 删除删本角色为 source 的那条（文案已声明只删一条）
          relationType,
          other: bucket.other,
          direction: "both",
          note: characterRelationNote(out.metadata) ?? characterRelationNote(inbound.metadata),
        });
      } else {
        for (const relation of [...bucket.out, ...bucket.in]) {
          const row = toRow(relation, self, directionOf(relation, self.selfId) ?? "out");
          if (row !== null) rows.push(row);
        }
      }
    }
    rows.sort(compareRows);
    groups.push({ relationType, rows });
  }
  groups.sort(
    (a, b) =>
      relationTypeRank(a.relationType) - relationTypeRank(b.relationType) ||
      a.relationType.localeCompare(b.relationType),
  );
  return groups;
}

/** 其他关联 → 行（**不去重、不分组**；按类型序 → 对方姓名稳定排序） */
export function buildOtherRelationRows(
  other: readonly RelationSummaryItem[],
  self: CharacterRelationSelf,
): CharacterRelationRow[] {
  const rows: CharacterRelationRow[] = [];
  for (const relation of other) {
    const direction = directionOf(relation, self.selfId);
    const row = toRow(relation, self, direction ?? "out");
    if (row !== null) rows.push(row);
  }
  rows.sort(
    (a, b) =>
      relationTypeRank(a.relationType) - relationTypeRank(b.relationType) ||
      a.relationType.localeCompare(b.relationType) ||
      compareRows(a, b),
  );
  return rows;
}

/**
 * 端点 → **anchor href（hash 路由，含 `#` 前缀）**：
 * 实体类型（含 event/timepoint/reference 各宿主段）→ `entityDetailPath`；
 * 大纲节点 → `#/outline/:nodeId`；其余未知类型 → null（不可点，渲染纯文本）。
 * **必须带回 `#`**：仓内是 hash 路由，裸路径 href 会触发整页导航（丢路由，实测落到 `#/overview`）。
 * （`entityDetailPath` 返回的是 `navigate()` 用的路径，二者语义不同——此处显式加 `#`。）
 */
export function relationEndpointHref(type: string, id: string): string | null {
  if (type === "outline_node") return `#/outline/${id}`;
  if (!(ENTITY_TYPES as readonly string[]).includes(type)) return null;
  return `#${entityDetailPath(type as EntityType, id)}`;
}

/**
 * 删除确认文案（列出被删那条边的三段式）：
 * - `both`（合并行）额外声明「双向显示由两条独立的边合成，本次只删其中一条」——避免用户以为删掉了整段关系；
 * - `in` 方向按「对方 类型 本角色」书写（与既有详情页文案同构）。
 */
export function characterRelationDeleteDescription(
  row: CharacterRelationRow,
  selfName: string,
): string {
  const label = relationTypeLabel(row.relationType);
  const forward = `${selfName} ${label} ${row.other.name}`;
  if (row.direction === "both") {
    return `删除关系「${forward}」？双向显示由两条独立的边合成，本次只删除「${forward}」这一条；物理删除不可恢复，可重新建立。`;
  }
  if (row.direction === "in") {
    return `删除关系「${row.other.name} ${label} ${selfName}」？物理删除不可恢复，可重新建立。`;
  }
  return `删除关系「${forward}」？物理删除不可恢复，可重新建立。`;
}
