// 拆解 S2：批抽取结果的校验与归一（纯函数、无 IO、不碰 db）。
//
// 契约：docs/design/60-decompose.md §5（抽取 schema 口径表）与 §4（逐章对齐护栏）。
// 分工：模型原始 JSON（`unknown`，不信任）进 → 干净结果出。**唯一整批失败条件是缺章**
// （runner 捕获后整批重试：重试代价 = 一批 token，而缺章的产出本来就不完整）；
// 其余问题（超条数 / 白名单外关系 / 端点不存在 / 字段超长）一律就地截断或丢弃，记入 `discarded`
// 供调用方写日志——纯函数不做 IO，也不因坏字段整批失败。
//
// 上限、白名单与归一规则单一定义在本模块并导出；散文与注释只引用常量名，不复述数字。

import type {
  DecomposeBatchResult,
  DecomposeCharacter,
  DecomposeExtractedChapter,
  DecomposeLocation,
  DecomposeRelation,
  DecomposeSetting,
  RelationType,
} from "@whispering233/ai-editor-shared";
import { normalizeRelationType } from "@whispering233/ai-editor-shared";
import { normalizeEntityName } from "./merge.js";

/** 章摘要长度上限（写入 outline 节点 `summary`，会被聚焦章注入使用——见 20-context.md §2） */
export const DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS = 200;
/** 实体 `description` 长度上限 */
export const DECOMPOSE_DESCRIPTION_MAX_CHARS = 300;
/** 人物 `motivation` 长度上限 */
export const DECOMPOSE_MOTIVATION_MAX_CHARS = 200;
/** 人物 `personality` 条数上限 */
export const DECOMPOSE_PERSONALITY_MAX_ITEMS = 6;
/** 每章人物条数上限 */
export const DECOMPOSE_CHAPTER_MAX_CHARACTERS = 12;
/** 每章设定条数上限 */
export const DECOMPOSE_CHAPTER_MAX_SETTINGS = 8;
/** 每章地点条数上限 */
export const DECOMPOSE_CHAPTER_MAX_LOCATIONS = 8;
/** 每章关系条数上限 */
export const DECOMPOSE_CHAPTER_MAX_RELATIONS = 12;

/**
 * 关系类型白名单 = 「AI 可产出」的 shared `RELATION_TYPES` 子集（docs/design/60-decompose.md §5）。
 * **不给全量**：`plants` / `advances` / `resolves` 锚定伏笔、`appears_in` / `occurs_at` / `occurs_in`
 * 锚定大纲节点与时间轴、`depends_on` / `involves` / `plot_edge` 属伏笔与画布——这些都是**创作期**由用户
 * 决定的语义，从正文里猜必然错位（模型会把「提到了地点」写成 `occurs_at`）。剩下的结构关系
 * （`belongs_to` / `owns` / `masters`）与人物关系（含 `kills`）才是正文能可靠支撑的。
 * 白名单外一律丢弃：不猜测、不映射到「近似类型」。
 * `satisfies readonly RelationType[]`：类型写错字（不在 shared `RELATION_TYPES`）编译期报红，
 * 否则白名单里的错字会让该关系被静默丢弃。
 */
export const DECOMPOSE_RELATION_TYPES = [
  "ally",
  "rival",
  "mentor",
  "family",
  "kills",
  "belongs_to",
  "owns",
  "masters",
] as const satisfies readonly RelationType[];
export type DecomposeRelationType = (typeof DECOMPOSE_RELATION_TYPES)[number];

/** 归一结果：干净批结果 + 截断/丢弃记录（调用方负责写日志） */
export interface ExtractionNormalization {
  result: DecomposeBatchResult;
  discarded: string[];
}

/**
 * 校验与归一一批抽取结果。
 *
 * - `expectedChapterIndexes` = 本批应覆盖的章序（1-based 文件位置序），来自 `decompose_batches.chapter_ids` 的映射；
 *   结果**按该顺序**输出，缺章抛错（runner 捕获后整批重试），批外章条目丢弃。
 * - `knownNames` = 本批之外的累计候选名字（滚动故事圣经里已出现过的人物/设定/地点名）；
 *   关系端点必须落在「本批 ∪ 累计」集合内，否则丢弃（§6 第 1 层：防模型幻觉出不存在的人物）。
 */
export function normalizeExtraction(
  raw: unknown,
  expectedChapterIndexes: readonly number[],
  knownNames: readonly string[] = [],
): ExtractionNormalization {
  const discarded: string[] = [];
  const chaptersByIndex = new Map<number, JsonRecord>();
  for (const item of asArray(asRecord(raw)?.chapters)) {
    const chapter = asRecord(item);
    const chapterIndex = chapter === null ? null : asChapterIndex(chapter.chapterIndex);
    if (chapter === null || chapterIndex === null) {
      discarded.push("丢弃无法解析的章条目（缺 chapterIndex）");
      continue;
    }
    if (chaptersByIndex.has(chapterIndex)) {
      discarded.push(`第${chapterIndex}章在批结果里重复出现，只取首条`);
      continue;
    }
    chaptersByIndex.set(chapterIndex, chapter);
  }

  const missing = expectedChapterIndexes.filter((chapterIndex) => !chaptersByIndex.has(chapterIndex));
  if (missing.length > 0) {
    throw new Error(`拆解批结果缺章：${missing.join("、")}（整批重试）`);
  }
  const expected = new Set(expectedChapterIndexes);
  for (const chapterIndex of chaptersByIndex.keys()) {
    if (!expected.has(chapterIndex)) discarded.push(`第${chapterIndex}章不在本批范围内，已丢弃`);
  }

  // 关系端点的存在性判据：本批全部章的名字 ∪ 累计候选集合（同口径归一化后再比较）
  const known = new Set<string>([...knownNames.map(normalizeEntityName)]);
  for (const chapter of chaptersByIndex.values()) {
    for (const name of entityNamesOf(chapter)) known.add(name);
  }

  const chapters = expectedChapterIndexes.map((chapterIndex) =>
    normalizeChapter(chaptersByIndex.get(chapterIndex) as JsonRecord, chapterIndex, known, discarded),
  );
  return { result: { chapters }, discarded };
}

/** 单章归一：条数上限截断 + 字段收窄；丢弃项（含原因）追加进 `discarded` */
function normalizeChapter(
  raw: JsonRecord,
  chapterIndex: number,
  known: ReadonlySet<string>,
  discarded: string[],
): DecomposeExtractedChapter {
  const label = `第${chapterIndex}章`;
  const summary = asText(raw.summary) ?? "";

  const characters = cap(
    asArray(raw.characters).map(normalizeCharacter).filter(isPresent),
    DECOMPOSE_CHAPTER_MAX_CHARACTERS,
    `${label}：人物超 DECOMPOSE_CHAPTER_MAX_CHARACTERS，已截断`,
    discarded,
  );
  const settings = cap(
    asArray(raw.settings).map(normalizeSetting).filter(isPresent),
    DECOMPOSE_CHAPTER_MAX_SETTINGS,
    `${label}：设定超 DECOMPOSE_CHAPTER_MAX_SETTINGS，已截断`,
    discarded,
  );
  const locations = cap(
    asArray(raw.locations).map(normalizeLocation).filter(isPresent),
    DECOMPOSE_CHAPTER_MAX_LOCATIONS,
    `${label}：地点超 DECOMPOSE_CHAPTER_MAX_LOCATIONS，已截断`,
    discarded,
  );

  const relations: DecomposeRelation[] = [];
  for (const item of asArray(raw.relations)) {
    const { relation, reason } = filterRelation(item, known);
    if (relation === null) {
      discarded.push(`${label}：${reason}`);
      continue;
    }
    relations.push(relation);
  }

  return {
    chapterIndex,
    // 标题取**模型回声**（缺则用章序兜底）——只为批结果可读（进度页展开行 / 日志）；
    // 章标题的权威来源 = S1 写的大纲节点标题（切分清洗后的标题），两源并存是有意的：
    // S3 回写章摘要时只写 `summary`，不得用本字段覆盖标题（见 merge-write.ts）
    chapterTitle: asText(raw.chapterTitle) ?? `第${chapterIndex}章`,
    summary: clip(summary, DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS),
    characters,
    settings,
    locations,
    relations: cap(relations, DECOMPOSE_CHAPTER_MAX_RELATIONS, `${label}：关系超 DECOMPOSE_CHAPTER_MAX_RELATIONS，已截断`, discarded),
  };
}

/**
 * 人物归一：`name` 缺失即丢弃；`description` / `motivation` 截断、`personality` 截条数。
 * `ability_panel` / `custom_fields` 契约禁止填（§5：能力面板是用户自定义字段树，AI 建树会污染结构）
 * ——输出是**显式取字段**，禁止填的字段根本没有落点（不是「过滤掉」而是「不读」）。
 */
function normalizeCharacter(value: unknown): DecomposeCharacter | null {
  const raw = asRecord(value);
  const name = asText(raw?.name);
  if (raw === null || name === null) return null;
  const character: DecomposeCharacter = { name };
  assign(character, "role", asText(raw.role));
  assign(character, "description", clip(asText(raw.description) ?? "", DECOMPOSE_DESCRIPTION_MAX_CHARS) || undefined);
  assign(character, "alias", asText(raw.alias));
  assign(character, "gender", asText(raw.gender));
  assign(character, "age", asAge(raw.age));
  assign(character, "race", asText(raw.race));
  const personality = asArray(raw.personality)
    .map(asText)
    .filter(isPresent)
    .slice(0, DECOMPOSE_PERSONALITY_MAX_ITEMS);
  if (personality.length > 0) character.personality = personality;
  assign(character, "motivation", clip(asText(raw.motivation) ?? "", DECOMPOSE_MOTIVATION_MAX_CHARS) || undefined);
  return character;
}

/** 设定归一：`rules` / `tags` 只留非空字符串（UI 把 rules 渲染成 tags 控件，长文本放进去会难看） */
function normalizeSetting(value: unknown): DecomposeSetting | null {
  const raw = asRecord(value);
  const name = asText(raw?.name);
  if (raw === null || name === null) return null;
  const setting: DecomposeSetting = { name };
  assign(setting, "description", clip(asText(raw.description) ?? "", DECOMPOSE_DESCRIPTION_MAX_CHARS) || undefined);
  const tags = textList(raw.tags);
  if (tags.length > 0) setting.tags = tags;
  const rules = textList(raw.rules);
  if (rules.length > 0) setting.rules = rules;
  return setting;
}

/** 地点归一：`type` 自由文本；`parent_id` 契约禁止填（不做地点层级，§5）——同人物，不读即不落 */
function normalizeLocation(value: unknown): DecomposeLocation | null {
  const raw = asRecord(value);
  const name = asText(raw?.name);
  if (raw === null || name === null) return null;
  const location: DecomposeLocation = { name };
  assign(location, "type", asText(raw.type));
  assign(location, "description", clip(asText(raw.description) ?? "", DECOMPOSE_DESCRIPTION_MAX_CHARS) || undefined);
  return location;
}

/** 关系过滤：白名单外 / 端点不在候选集合 / 缺字段 → 丢弃并给原因（`relation === null` ⇔ `reason !== null`） */
function filterRelation(value: unknown, known: ReadonlySet<string>): { relation: DecomposeRelation | null; reason: string | null } {
  const raw = asRecord(value);
  const source = asText(raw?.source);
  const target = asText(raw?.target);
  const type = normalizeRelationType(asText(raw?.type) ?? "");
  if (source === null || target === null || type === "") {
    return { relation: null, reason: "丢弃缺 source/target/type 的关系" };
  }
  if (!(DECOMPOSE_RELATION_TYPES as readonly string[]).includes(type)) {
    return { relation: null, reason: `关系「${source}→${target}（${type}）」的类型不在 DECOMPOSE_RELATION_TYPES，已丢弃` };
  }
  if (!known.has(normalizeEntityName(source)) || !known.has(normalizeEntityName(target))) {
    return { relation: null, reason: `关系「${source}→${target}（${type}）」的端点不在候选集合，已丢弃` };
  }
  const relation: DecomposeRelation = { source, target, type };
  assign(relation, "evidence", asText(raw?.evidence));
  return { relation, reason: null };
}

/** 本批某章里出现过的实体名（归一化；关系端点存在性判据的「本批」一半） */
function entityNamesOf(chapter: JsonRecord): string[] {
  const names: string[] = [];
  for (const key of ["characters", "settings", "locations"] as const) {
    for (const item of asArray(chapter[key])) {
      const name = asText(asRecord(item)?.name);
      if (name !== null) names.push(normalizeEntityName(name));
    }
  }
  return names;
}

// ── 小工具（模块私有） ────────────────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 非空字符串（trim 后非空）→ 原值；其余（null / 数字 / 对象 / 空串）一律当缺字段 */
function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() === "" ? null : value;
}

function asChapterIndex(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/** age 允许文本或数字（与 shared `characterDataSchema` 同口径） */
function asAge(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

/** 字符串数组字段（非字符串项丢弃；空数组视同未填） */
function textList(value: unknown): string[] {
  return asArray(value).map(asText).filter(isPresent);
}

/** 超长截断（先 trim：模型爱加首尾空白） */
function clip(value: string, maxChars: number): string {
  const text = value.trim();
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

/** 可选字段只在有值时赋值（避免 `undefined` / `null` 键进 JSON） */
function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null | undefined): void {
  if (value !== undefined && value !== null) target[key] = value;
}

/** 条数上限截断：截断时记一条 discarded（note 文案引用常量名，不复述数字） */
function cap<T>(items: readonly T[], maxItems: number, note: string, discarded: string[]): T[] {
  if (items.length <= maxItems) return [...items];
  discarded.push(note);
  return items.slice(0, maxItems);
}
