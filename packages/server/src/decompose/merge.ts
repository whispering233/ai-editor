// 拆解 S3：规则归并 + 写入计划（纯函数、无 IO、不碰 db）。
//
// 契约：docs/design/60-decompose.md §6（三层归并）与 §6.1（`merge_written` 三路比对）。
// 分工：本模块只算「该写什么」——实体/关系/章摘要回写/报告的实际落库与一次别名归并 LLM 调用属后续卡。
// 阈值与上限单一定义在本模块并导出；散文与注释只引用常量名，不复述数字。

import { RELATION_TYPE_META, normalizeRelationType } from "@whispering233/ai-editor-shared";
import type { DecomposeBatchResult, DecomposeRelation, RelationType } from "@whispering233/ai-editor-shared";

/** 落库阈值：人物与关系要求跨章出现 ≥ 该章数（单章出现的路人/一次性互动只进报告，§5） */
export const DECOMPOSE_MENTION_MIN_CHAPTERS = 2;
/** 别名组名字数上限（超过多半是把不同实体错并成一个，保守丢弃） */
export const DECOMPOSE_ALIAS_GROUP_MAX = 4;
/** 别名组名字数下限（单名组成立不了合并） */
export const DECOMPOSE_ALIAS_GROUP_MIN_NAMES = 2;
/** 别名归并候选条数上限：候选按提及次数截断 top，超出部分不参与合并（§6 第 2 层） */
export const DECOMPOSE_ALIAS_CANDIDATE_MAX = 60;

/** 抽取实体类别（正文能可靠支撑的三类；伏笔/事件/时间点/参考资料不参与拆解） */
export type DecomposeEntityKind = "character" | "setting" | "location";

/** 归并后的实体候选（第 1 层产物 = 别名归并的输入候选） */
export interface MergedEntityCandidate {
  type: DecomposeEntityKind;
  /** 归一化后的规范名 */
  name: string;
  /** 出现章序（升序、去重） */
  chapters: number[];
}

/** 归并后的关系候选（对称关系已方向归一） */
export interface MergedRelationCandidate {
  source: string;
  target: string;
  type: string;
  chapters: number[];
}

export interface MergeOutcome {
  entities: MergedEntityCandidate[];
  relations: MergedRelationCandidate[];
  /** 未达 DECOMPOSE_MENTION_MIN_CHAPTERS 的线索：报告里透明化（§6.2 第 6 段），不落库 */
  filtered: { characters: MergedEntityCandidate[]; relations: MergedRelationCandidate[] };
}

/**
 * 名字归一化（**单一来源**）：trim + 折叠空白（含全角空格 U+3000）为单个半角空格。
 * 这是「同名同类型 → 同一实体」的比较基准，S2 的关系端点存在性校验与 S3 的实体去重必须同口径。
 */
export function normalizeEntityName(name: string): string {
  return name.replace(/[\s\u3000]+/gu, " ").trim();
}

/**
 * S3 第 1 层：零 LLM 成本的规则归并。
 * - 实体：名字归一化后「同名同类型 → 同一实体」（人物 / 设定 / 地点各自成集）；
 * - 关系：按 `(source, target, relation_type)` 去重 + 对称关系方向归一；
 * - 阈值：人物与关系要求跨章出现 ≥ DECOMPOSE_MENTION_MIN_CHAPTERS（设定与地点不设阈值——
 *   一次出现也可能是重要宝物/剑法，靠提示词约束「只抽对剧情有影响的」）。
 */
export function mergeCandidates(results: readonly DecomposeBatchResult[]): MergeOutcome {
  const entities = new Map<string, MergedEntityCandidate>();
  const relations = new Map<string, MergedRelationCandidate>();

  for (const result of results) {
    for (const chapter of result.chapters) {
      for (const character of chapter.characters) addEntity(entities, "character", character.name, chapter.chapterIndex);
      for (const setting of chapter.settings) addEntity(entities, "setting", setting.name, chapter.chapterIndex);
      for (const location of chapter.locations) addEntity(entities, "location", location.name, chapter.chapterIndex);
      for (const relation of chapter.relations) addRelation(relations, relation, chapter.chapterIndex);
    }
  }

  const keptEntities: MergedEntityCandidate[] = [];
  const filteredCharacters: MergedEntityCandidate[] = [];
  for (const entity of entities.values()) {
    if (entity.type === "character" && entity.chapters.length < DECOMPOSE_MENTION_MIN_CHAPTERS) {
      filteredCharacters.push(entity);
    } else {
      keptEntities.push(entity);
    }
  }
  const keptRelations: MergedRelationCandidate[] = [];
  const filteredRelations: MergedRelationCandidate[] = [];
  for (const relation of relations.values()) {
    const target = relation.chapters.length < DECOMPOSE_MENTION_MIN_CHAPTERS ? filteredRelations : keptRelations;
    target.push(relation);
  }

  return {
    entities: keptEntities,
    relations: keptRelations,
    filtered: { characters: filteredCharacters, relations: filteredRelations },
  };
}

/** 别名归并候选（§6 第 2 层输入：规范名 + 出现章数 + 首次出现章；LLM 只看到这份清单，看不到原文） */
export interface AliasCandidate {
  name: string;
  chapterCount: number;
  firstChapter: number;
}

/** 别名组（§6 第 2 层输出：规范名 + 别名列表；规范名必须是候选集合里的名字） */
export interface AliasGroup {
  canonical: string;
  aliases: readonly string[];
}

export interface AliasValidation {
  accepted: AliasGroup[];
  /** 被硬校验丢弃的组（保守原则：不确定就不合并，不做部分接受） */
  rejected: Array<{ group: AliasGroup; reason: string }>;
}

/**
 * 候选按提及次数（跨章数）降序截断 top DECOMPOSE_ALIAS_CANDIDATE_MAX——超出部分不参与合并。
 * 同提及次数保持入参顺序（`Array.prototype.sort` 稳定）⇒ 同一份输入两次调用结果一致。
 */
export function selectAliasCandidates(candidates: readonly AliasCandidate[]): AliasCandidate[] {
  return [...candidates].sort((left, right) => right.chapterCount - left.chapterCount).slice(0, DECOMPOSE_ALIAS_CANDIDATE_MAX);
}

/**
 * 别名组硬校验（§6 第 2 层）。四道闸门全过才接受：
 * ① 组内每个名字（含规范名）必须已存在于候选集合——禁止发明新名字，且候选集合已按
 *    DECOMPOSE_ALIAS_CANDIDATE_MAX 截断（被截断的名字视为不存在）；
 * ② 名字不得跨组重复（一个名字只能进一组）；
 * ③ 组内有效名字数 ∈ [DECOMPOSE_ALIAS_GROUP_MIN_NAMES, DECOMPOSE_ALIAS_GROUP_MAX]；
 * ④ 比较前先按 normalizeEntityName 归一（与实体去重同口径）。
 */
export function validateAliasGroups(groups: readonly AliasGroup[], candidates: readonly AliasCandidate[]): AliasValidation {
  const allowed = new Set(selectAliasCandidates(candidates).map((candidate) => normalizeEntityName(candidate.name)));
  const used = new Set<string>();
  const accepted: AliasGroup[] = [];
  const rejected: AliasValidation["rejected"] = [];

  for (const group of groups) {
    const names = [...new Set([group.canonical, ...group.aliases].map(normalizeEntityName))].filter((name) => name !== "");
    if (names.length < DECOMPOSE_ALIAS_GROUP_MIN_NAMES) {
      rejected.push({ group, reason: "组内有效名字少于 DECOMPOSE_ALIAS_GROUP_MIN_NAMES" });
      continue;
    }
    if (names.length > DECOMPOSE_ALIAS_GROUP_MAX) {
      rejected.push({ group, reason: "组内名字数超过 DECOMPOSE_ALIAS_GROUP_MAX" });
      continue;
    }
    if (names.some((name) => !allowed.has(name))) {
      rejected.push({ group, reason: "组内有名字不在候选集合（或已被 DECOMPOSE_ALIAS_CANDIDATE_MAX 截断）" });
      continue;
    }
    if (names.some((name) => used.has(name))) {
      rejected.push({ group, reason: "组内有名字已出现在前一组" });
      continue;
    }
    accepted.push(group);
    for (const name of names) used.add(name);
  }
  return { accepted, rejected };
}

// ── §6.1 三路比对 → 写入计划 ─────────────────────────────────────────────────

export type MergeWriteAction =
  | "create" // 新产物有、清单里没有
  | "reuse" // 新旧都有，库内 updated_at 等于清单记录值
  | "keep-user-edited" // 新旧都有，但 updated_at 变了（用户手工改过）
  | "soft-delete" // 清单里有、新产物没有，且 updated_at 未变
  | "keep-and-report"; // 清单里有、新产物没有，但 updated_at 变了（保留 + 报告里提示）

/** 新产物（归并算出的应写入项，尚未落库） */
export interface MergeWriteProduct {
  /** 归并身份（实体 = `${type}:${归一化 name}`；关系 = 归一化端点与类型拼出的稳定文本） */
  key: string;
  /** 库内同身份行的 id（调用方在库内快照里按身份解析；库内无 → null = 全新） */
  id: string | null;
}

/** `decompose_jobs.merge_written` 项（JSON 形状，字段名与库列同口径） */
export interface MergeWrittenEntry {
  id: string;
  type: string;
  updated_at: string;
}

/** 库内快照行（entities / relation_records 的投影：id + 类型 + 版本戳 + 软删标记） */
export interface MergeSnapshotRow {
  id: string;
  type: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MergeWritePlanItem {
  action: MergeWriteAction;
  /** 目标库行 id（`create` = 尚无行 → null） */
  id: string | null;
  /** 归并身份（来自新产物；清单残留侧没有身份 → null） */
  key: string | null;
}

/**
 * 三路比对：新产物 × `merge_written` 清单 × 库内快照 → 写入计划（不改 db）。
 *
 * 判据（§6.1）：`updated_at` 与清单记录值一致 ⇒ 这条行还是上一轮写的（可复用/可软删）；
 * 变了 ⇒ 用户手工编辑过（**用户编辑优先**：不覆盖、不软删，只在报告里提示）。
 * **软删行视同不存在**：回收站里的旧行不参与比对，产物重现时按新行创建（不复活旧行）。
 */
export function planMergeWrite(
  products: readonly MergeWriteProduct[],
  written: readonly MergeWrittenEntry[],
  snapshot: readonly MergeSnapshotRow[],
): MergeWritePlanItem[] {
  const writtenById = new Map(written.map((entry) => [entry.id, entry]));
  const liveById = new Map(snapshot.filter((row) => row.deleted_at === null).map((row) => [row.id, row]));
  const matched = new Set<string>();
  const plan: MergeWritePlanItem[] = [];

  for (const product of products) {
    const row = product.id === null ? undefined : liveById.get(product.id);
    const entry = product.id === null ? undefined : writtenById.get(product.id);
    if (row === undefined || entry === undefined) {
      plan.push({ action: "create", id: null, key: product.key });
      continue;
    }
    matched.add(row.id);
    plan.push({
      action: row.updated_at === entry.updated_at ? "reuse" : "keep-user-edited",
      id: row.id,
      key: product.key,
    });
  }

  for (const entry of written) {
    if (matched.has(entry.id)) continue;
    const row = liveById.get(entry.id);
    if (row === undefined) continue; // 已不在库内（软删/物理删）⇒ 无事可做
    plan.push({
      action: row.updated_at === entry.updated_at ? "soft-delete" : "keep-and-report",
      id: entry.id,
      key: null,
    });
  }
  return plan;
}

// ── 模块私有 ─────────────────────────────────────────────────────────────────

function addEntity(map: Map<string, MergedEntityCandidate>, type: DecomposeEntityKind, rawName: string, chapterIndex: number): void {
  const name = normalizeEntityName(rawName);
  if (name === "") return;
  const key = `${type}\u0000${name}`;
  const existing = map.get(key);
  if (existing === undefined) map.set(key, { type, name, chapters: [chapterIndex] });
  else addChapter(existing.chapters, chapterIndex);
}

function addRelation(map: Map<string, MergedRelationCandidate>, relation: DecomposeRelation, chapterIndex: number): void {
  const type = normalizeRelationType(relation.type);
  const source = normalizeEntityName(relation.source);
  const target = normalizeEntityName(relation.target);
  if (source === "" || target === "" || type === "") return;
  const [from, to] = orderEndpoints(source, target, type);
  const key = `${from}\u0000${to}\u0000${type}`;
  const existing = map.get(key);
  if (existing === undefined) map.set(key, { source: from, target: to, type, chapters: [chapterIndex] });
  else addChapter(existing.chapters, chapterIndex);
}

/**
 * 对称关系方向归一：语义对等的关系（`RELATION_TYPE_META` 标注 `symmetric` 的那些），A→B 与 B→A 是同一枚
 * 关系，统一按名字排序取一个方向（否则同一枚关系会存成两行）。判据 = shared `RELATION_TYPE_META.symmetric`
 * （单一定义，禁止手抄清单）；未标注的类型与自定义类型一律有向。
 */
function orderEndpoints(source: string, target: string, type: string): [string, string] {
  const symmetric = RELATION_TYPE_META[type as RelationType]?.symmetric === true;
  return symmetric && source > target ? [target, source] : [source, target];
}

/** 章序去重 + 升序（章数规模小，线性查重足够） */
function addChapter(chapters: number[], chapterIndex: number): void {
  if (chapters.includes(chapterIndex)) return;
  chapters.push(chapterIndex);
  chapters.sort((left, right) => left - right);
}
