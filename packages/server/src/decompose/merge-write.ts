// 拆解 S3 落库 + S4 报告写盘（卡 21.7）：按 merge.ts 的写入计划把归并产物落进业务表。
//
// 契约：docs/design/60-decompose.md §6（归并三层）/ §6.1（`merge_written` 三路比对与重跑幂等）/
// §6.2（报告落点：一条 `entities(reference)` + 其块文档）；docs/api/120-api-decompose.md §rerun。
// 口径：
// - **写入计划是唯一写入依据**（create / reuse / keep-user-edited / soft-delete / keep-and-report）：
//   计划外的一律不碰（回收站里的旧行不参与）；用户手工建的同名行**复用同一行但不写内容**（不重复建）；
// - **记录面两条**：本 job 清单（软删面）+ 跨轮 baseline = 历史全部 job 的 `merge_written` 并集
//   （同一 id 取最新一次记录）⇒ 续拆时同名实体/关系复用同一行、跨轮未重现的产物不软删、报告更新同一条；
// - **增量更新**（跨轮复用已存在的行）：`mergeEntityData` 的字段口径（description 取更长者 / 数组取并集 /
//   `role` 本轮非空则覆盖 / 其余仅库内为空时填），**无变化则不写**，写了必须刷新清单条目里的 `updated_at`；
// - **消失行**：实体 → `softDeleteEntity`（进回收站可还原，§6.1）；关系 → `deleteRelation` **物理删**——
//   本仓关系没有回收站路径（relations 软删只作为实体级联的副作用存在，`docs/api/70-api-trash.md` 只服务
//   实体与大纲节点），与「手动删关系 = 物理删」同口径；产物重现时按新行创建，幂等性不靠旧行；
// - **章摘要回写只写 `summary`**：章标题的权威来源 = S1 写的大纲节点标题（split 清洗后），
//   批结果里的 `chapterTitle` 只是模型回声——回写它会覆盖用户改过的标题；
// - **模型调用只在 `llm.ts`**：S3 一次别名归并（只针对人物）+ S4 一次全书剧情摘要；
// - 上限与文案常量单一定义并导出；散文与注释只引用常量名，不复述数字。

import type { DecomposeBatchResult, EntityRow, EntitySummary } from "@whispering233/ai-editor-shared";
import { MAX_ENTITY_LIST_LIMIT, blocksToPlainMd } from "@whispering233/ai-editor-shared";
import {
  createEntity,
  createRelation,
  deleteRelation,
  deriveChapterOrder,
  findOutlineNode,
  getDocumentTextLengths,
  getEntity,
  getRelation,
  listDecomposeBatches,
  listDecomposeJobs,
  listEntities,
  listRelations,
  readOutlineFile,
  softDeleteEntity,
  updateEntity,
  updateOutlineNode,
  upsertDocument,
  withTransaction,
  writeMergeWritten,
  writeOutlineFile,
  type Db,
  type DecomposeJobRow,
} from "@whispering233/ai-editor-db";
import type { ProjectContext } from "../middleware/project.js";
import { DECOMPOSE_DESCRIPTION_MAX_CHARS } from "./extract.js";
import { doneBatchResults, paragraphBlocksOf } from "./job.js";
import { parseModelJson, type DecomposeSession, type ModelRequest } from "./llm.js";
import {
  DECOMPOSE_ALIAS_CANDIDATE_MAX,
  DECOMPOSE_ALIAS_GROUP_MAX,
  DECOMPOSE_ALIAS_GROUP_MIN_NAMES,
  dedupeCandidates,
  mergeCandidates,
  normalizeEntityName,
  planMergeWrite,
  selectAliasCandidates,
  validateAliasGroups,
  type AliasCandidate,
  type DecomposeEntityKind,
  type MergeOutcome,
  type MergeSnapshotRow,
  type MergeWritePlanItem,
  type MergeWrittenEntry,
  type MergedEntityCandidate,
  type MergedRelationCandidate,
} from "./merge.js";
import {
  DECOMPOSE_REPORT_ENTITY_TYPE,
  DECOMPOSE_REPORT_KIND,
  buildDecomposeReportText,
  completeReportPlot,
  decomposeReportName,
  type DecomposeReportFacts,
  type ReportAliasGroup,
  type ReportChapter,
  type ReportCharacter,
} from "./report.js";

/** 归并清单里关系条目的 `type`（关系表无类型列；实体条目用 `entities.type`，报告用 `DECOMPOSE_REPORT_ENTITY_TYPE`） */
export const DECOMPOSE_MERGE_RELATION_TYPE = "relation";
/** 别名后缀（§6 第 3 层：别名进 description 的「（又称：X、Y）」，不动 schema） */
export const DECOMPOSE_ALIAS_NOTE_PREFIX = "（又称：";
export const DECOMPOSE_ALIAS_NOTE_SEPARATOR = "、";
/** 实体类别：关系端点**同名跨类型**时的解析优先级（先人物，再设定，末地点） */
export const DECOMPOSE_ENTITY_KINDS = ["character", "setting", "location"] as const satisfies readonly DecomposeEntityKind[];

/** 报告在写入计划里的归并身份（与实体/关系身份格式不冲突：实体身份必带类别前缀） */
const REPORT_PRODUCT_KEY = "report";

/** S3 + S4 的入参：项目 / job / 本 job 的拆解会话（模型调用与过程条目都写它）/ 时间（本模块不生成时间） */
export interface DecomposeMergeInput {
  project: ProjectContext;
  jobId: string;
  session: DecomposeSession;
  now: string;
}

/** 一轮 S3 + S4 的收尾统计（runner 只记日志；断言走库内数据） */
export interface DecomposeMergeSummary {
  entities: number;
  relations: number;
  aliasGroups: number;
  reportId: string;
}

/** 单个实体在全书提及里的归并素材 */
export interface MentionAggregate {
  /** 全部提及里最长的一条 description（最完整的一条：别名归并候选的 short summary 与实体 description 共用） */
  description: string;
  /** 按类型收敛的其余字段（首个非空值胜出；`description` 不在其中，它由 appendAliasNote 组装） */
  data: Record<string, unknown>;
}

/**
 * S3 别名归并候选（§6 第 2 层）：人物候选（第 1 层去重后）+ 出现章数 + 首次出现章 + 短摘要。
 * 短摘要 = 该人物出现章里最完整的一条 `description`（截断）——LLM 只看到这份清单，看不到原文。
 */
export function buildAliasCandidates(results: readonly DecomposeBatchResult[]): AliasCandidate[] {
  const mentions = aggregateMentions(results);
  return dedupeCandidates(results)
    .entities.filter((entity) => entity.type === "character")
    .map((entity) => ({
      name: entity.name,
      chapterCount: entity.chapters.length,
      firstChapter: entity.chapters[0] ?? 0,
      summary: clipText(mentions.get(entityIdentity(entity.type, entity.name))?.description ?? ""),
    }));
}

/** 提及素材聚合（纯函数）：`description` 取最长的一条，其余字段取首个非空值（跨章提及并成一行实体） */
export function aggregateMentions(results: readonly DecomposeBatchResult[]): Map<string, MentionAggregate> {
  const aggregates = new Map<string, MentionAggregate>();
  const absorb = (type: string, entity: Record<string, unknown>): void => {
    const name = normalizeEntityName(typeof entity.name === "string" ? entity.name : "");
    if (name === "") return;
    const key = entityIdentity(type, name);
    const aggregate = aggregates.get(key) ?? { description: "", data: {} };
    const description = typeof entity.description === "string" ? entity.description : "";
    if (description.length > aggregate.description.length) aggregate.description = description;
    for (const [field, value] of Object.entries(entity)) {
      if (field === "name" || field === "description" || value === undefined) continue;
      if (aggregate.data[field] === undefined) aggregate.data[field] = value;
    }
    aggregates.set(key, aggregate);
  };
  for (const result of results) {
    for (const chapter of result.chapters) {
      for (const character of chapter.characters) absorb("character", character);
      for (const setting of chapter.settings) absorb("setting", setting);
      for (const location of chapter.locations) absorb("location", location);
    }
  }
  return aggregates;
}

/** 描述 + 「（又称：X、Y）」；描述为空时只留别称（§6 第 3 层） */
export function appendAliasNote(description: string, aliases: readonly string[]): string {
  if (aliases.length === 0) return description;
  const note = `${DECOMPOSE_ALIAS_NOTE_PREFIX}${aliases.join(DECOMPOSE_ALIAS_NOTE_SEPARATOR)}）`;
  return description === "" ? note : `${description}${note}`;
}

/**
 * 章摘要回写大纲（§5）：**只写 `summary`**（章标题权威 = S1 写的大纲节点标题）。一次读 + 一次写
 * （逐节点调用会让 N 章 × 原子写 fsync 变成 N 次落盘，同 S1 建档的取舍）；摘要与节点现值相同则不触碰该节点。
 * @returns 实际改动的章数
 */
export function writeChapterSummaries(
  project: ProjectContext,
  results: readonly DecomposeBatchResult[],
  now: string,
): number {
  const summaryByIndex = new Map<number, string>();
  for (const result of results) {
    for (const chapter of result.chapters) summaryByIndex.set(chapter.chapterIndex, chapter.summary);
  }
  if (summaryByIndex.size === 0) return 0;
  const tree = readOutlineFile(project.root);
  let changed = 0;
  for (const entry of deriveChapterOrder(project.root)) {
    const summary = summaryByIndex.get(entry.chapterNumber);
    if (summary === undefined) continue;
    const node = findOutlineNode(tree, entry.chapterId);
    if (node === undefined || node.summary === summary) continue;
    updateOutlineNode(tree, entry.chapterId, { summary }, now);
    changed++;
  }
  if (changed > 0) writeOutlineFile(project.root, tree);
  return changed;
}

/** 报告章条目（章序 = 文件位置序；标题取大纲节点、摘要取批结果、长度取正文投影） */
export function reportChapters(project: ProjectContext, results: readonly DecomposeBatchResult[]): ReportChapter[] {
  const order = deriveChapterOrder(project.root);
  const tree = readOutlineFile(project.root);
  const lengths = getDocumentTextLengths(project.db, "chapter", order.map((entry) => entry.chapterId));
  const summaryByIndex = new Map<number, string>();
  for (const result of results) {
    for (const chapter of result.chapters) summaryByIndex.set(chapter.chapterIndex, chapter.summary);
  }
  return order.map((entry) => ({
    index: entry.chapterNumber,
    title: findOutlineNode(tree, entry.chapterId)?.title ?? "",
    summary: summaryByIndex.get(entry.chapterNumber) ?? "",
    length: lengths.get(entry.chapterId) ?? 0,
  }));
}

/**
 * S3 + S4 一轮：别名归并调用 → 四步纯管线 → 三路比对 → 落库（实体 / 关系 / 章摘要 / 报告）→ 写 `merge_written`。
 * 幂等由三路比对保证（同一份批结果跑两遍：实体/关系数量不变，报告更新同一条）；**跨轮 baseline** =
 * 历史全部 job 的 `merge_written` 并集（§6.1）⇒ 续拆时同名行复用 + 增量更新，跨轮未重现的产物不软删。
 * 调用方（runner 收口路径）负责 job 状态；本模块只写业务数据与清单。
 */
export async function runDecomposeMerge(input: DecomposeMergeInput): Promise<DecomposeMergeSummary> {
  const jobs = listDecomposeJobs(input.project.db);
  // 历史 job 全保留（§7.1）⇒ 目标 job 按 id 取，不取「最新一行」（多 job 并存时后者可能不是本轮）
  const job = jobs.find((row) => row.id === input.jobId);
  if (job === undefined) throw new Error(`拆解 job 不存在：${input.jobId}`);
  const baseline = mergeBaselineOf(jobs);
  const doneSeqs = listDecomposeBatches(input.project.db, input.jobId)
    .filter((batch) => batch.status === "done")
    .map((batch) => batch.seq);
  const results = doneBatchResults(input.project.db, input.jobId, doneSeqs);

  const aliasGroups = await completeAliasGroups(input.session, results); // S3 第 2 层：全书一次
  const outcome = mergeCandidates(results, aliasGroups); // S3 第 1 层：四步有序纯管线
  const mentions = aggregateMentions(results);
  writeChapterSummaries(input.project, results, input.now);

  const snapshot = readMergeSnapshot(input.project, baseline);
  const reportName = decomposeReportName(input.project.config.name);
  const products = buildMergeProducts({ outcome, mentions, aliasGroups, snapshot, reportName });
  const plan = planMergeWrite(
    [...products.values()].map((product) => ({ key: product.key, id: product.id })),
    job.merge_written,
    [...snapshot.rows.values()],
    [...baseline.values()],
  );
  const facts: DecomposeReportFacts = {
    bookName: input.project.config.name,
    ...reportFacts({
      outcome,
      mentions,
      aliasGroups,
      chapters: reportChapters(input.project, results),
      batchCount: listDecomposeBatches(input.project.db, input.jobId).length,
      keptUserEdited: keptUserEditedLabels(input.project, plan, job.merge_written),
    }),
  };
  const reportText = buildDecomposeReportText(facts, await completeReportPlot(input.session, facts.chapters));

  // 落库与清单写在同一事务：中途失败（如用户手工建了同一枚关系 ⇒ RELATION_EXISTS）整体回滚，
  // 不留「行已写、清单没记」的半成品——那会让下一轮把同一产物当新产物再创建一遍（幂等破口）
  const entries = withTransaction(input.project.db, () => {
    const writtenEntries = executeMergePlan({
      project: input.project,
      plan,
      products,
      written: job.merge_written,
      entityByName: snapshot.entityByName,
      reportName,
      reportText,
      now: input.now,
    });
    writeMergeWritten(input.project.db, input.jobId, writtenEntries, input.now);
    return writtenEntries;
  });
  const summary: DecomposeMergeSummary = {
    entities: outcome.entities.length,
    relations: outcome.relations.length,
    aliasGroups: aliasGroups.length,
    reportId: entries.find((entry) => entry.type === DECOMPOSE_REPORT_ENTITY_TYPE)?.id ?? "",
  };
  // 过程条目（不参与 LLM 上下文）：归并计数与报告落点——批表没有的信息（§8 时间线口径）
  input.session.log({
    kind: "merge_done",
    text: `归并完成：实体 ${summary.entities} / 关系 ${summary.relations} / 别名组 ${summary.aliasGroups}`,
  });
  input.session.log({ kind: "report_done", text: `报告完成：${reportName}（id=${summary.reportId}）` });
  return summary;
}

// ============ S3 别名归并调用（§6 第 2 层；全书一次） ============

/** 别名归并调用：LLM 只看候选清单；命中硬校验的组才生效（缺依据的组按保守原则直接丢弃） */
async function completeAliasGroups(
  session: DecomposeSession,
  results: readonly DecomposeBatchResult[],
): Promise<ReportAliasGroup[]> {
  const all = buildAliasCandidates(results);
  const candidates = selectAliasCandidates(all);
  if (all.length > candidates.length) {
    console.warn(`[decompose] 别名候选超出 ${DECOMPOSE_ALIAS_CANDIDATE_MAX} 条，按提及次数截断后归并`);
  }
  const { text } = await session.complete(aliasPrompt(candidates));
  const proposed = proposedGroupsOf(parseModelJson(text));
  const validation = validateAliasGroups(proposed, candidates);
  if (validation.rejected.length > 0) {
    console.warn(`[decompose] 别名组丢弃：${validation.rejected.map((item) => item.reason).join("；")}`);
  }
  // 只把 accepted 传进 applyAliasGroups（mergeCandidates 不重跑校验；原始组可以发明实体名）
  return proposed.filter((group) => validation.accepted.includes(group));
}

/** 别名归并提示词（数值一律由常量插值，不在散文里复述） */
function aliasPrompt(candidates: readonly AliasCandidate[]): ModelRequest {
  return {
    system: [
      "你是小说拆解流水线的别名归并员。输入是全书人物候选清单（规范名 + 出现章数 + 首次出现章 + 短摘要）。",
      "任务：找出**同一人物**的多个名字，输出合并组。输出必须是 JSON（可以放 ```json 围栏），不要写解释文字。",
      "",
      '输出结构：{"groups":[{"canonical":"规范名","aliases":["别名"],"reason":"依据"}]}',
      "",
      "硬性口径：",
      "- canonical 与 aliases 里的每个名字都必须是输入清单里出现过的名字，不得发明新名字；",
      `- 每组名字数（含规范名）在 ${DECOMPOSE_ALIAS_GROUP_MIN_NAMES} 到 ${DECOMPOSE_ALIAS_GROUP_MAX} 之间；`,
      "- 同一个名字不能出现在两组里；",
      "- 只合并能确定的（称号、昵称、称谓、简称等有摘要支撑的同一个人）；**不确定就不要合并**，宁可有重复；",
      "- 每组必须有非空 reason（判定依据）；没有依据的组会被丢弃；",
      "- 没有可合并的名字就输出 {\"groups\":[]}。",
    ].join("\n"),
    user: candidates
      .map(
        (candidate) =>
          `- ${candidate.name}（出现 ${candidate.chapterCount} 章，首见第 ${candidate.firstChapter} 章）：${candidate.summary === "" ? "无摘要" : candidate.summary}`,
      )
      .join("\n"),
  };
}

/** 解析别名组提案：只收形状完整（规范名 + 别名数组 + 非空依据）的组（§6 保守原则：缺依据直接丢弃） */
function proposedGroupsOf(raw: unknown): ReportAliasGroup[] {
  const groups = asRecord(raw)?.groups;
  if (!Array.isArray(groups)) return [];
  const proposals: ReportAliasGroup[] = [];
  for (const item of groups) {
    const record = asRecord(item);
    const canonical = asText(record?.canonical);
    const reason = asText(record?.reason);
    const aliases = Array.isArray(record?.aliases) ? record.aliases.map(asText).filter(isPresent) : [];
    if (canonical === null || reason === null || aliases.length === 0) continue;
    proposals.push({ canonical, aliases, reason });
  }
  return proposals;
}

// ============ 库内快照与新产物（三路比对的两路） ============

/** 实体引用（关系端点解析结果：id + 类别，写关系时两端类型必须与库内一致） */
interface EntityRef {
  id: string;
  type: string;
}

/** 库内快照：活行（供三路比对）+ 归并身份索引（供新产物匹配既有行）+ 名字索引（供关系端点解析） */
interface MergeSnapshot {
  rows: Map<string, MergeSnapshotRow>;
  entityIdOf: Map<string, string>;
  relationIdOf: Map<string, string>;
  /** 归一化名字 → 活实体（关系端点解析；同名跨类型按 DECOMPOSE_ENTITY_KINDS 顺序取先者） */
  entityByName: Map<string, EntityRef>;
  /** 活实体 id → 归一化名字（活关系的归并身份只用名字，见 relationIdentity） */
  nameById: Map<string, string>;
  reportId: string | null;
}

/**
 * 跨轮比对面（§6.1）：**历史全部 job** 的 `merge_written` 并集——同一 id 取**最新一次**记录
 * （job 按创建时间升序读出 ⇒ 后者覆盖）。本 job 清单另存（它是软删面：只有本 job 写过的行才允许软删）。
 */
function mergeBaselineOf(jobs: readonly DecomposeJobRow[]): Map<string, MergeWrittenEntry> {
  const baseline = new Map<string, MergeWrittenEntry>();
  for (const job of jobs) for (const entry of job.merge_written) baseline.set(entry.id, entry);
  return baseline;
}

/**
 * 库内快照（§6.1 三路比对的第三路）：实体按 `类型:归一化名`、关系按 `源 id + 靶 id + 类型` 索引；
 * 报告行按 baseline 里 `DECOMPOSE_REPORT_ENTITY_TYPE` 的条目回读（§6.2「跨轮更新同一条」）。
 * **软删行不进快照**（回收站旧行不参与比对：产物重现时按新行创建，不复活旧行）。
 */
function readMergeSnapshot(project: ProjectContext, baseline: ReadonlyMap<string, MergeWrittenEntry>): MergeSnapshot {
  const snapshot: MergeSnapshot = {
    rows: new Map(),
    entityIdOf: new Map(),
    relationIdOf: new Map(),
    entityByName: new Map(),
    nameById: new Map(),
    reportId: null,
  };
  for (const type of DECOMPOSE_ENTITY_KINDS) {
    for (const entity of listAllLiveEntities(project.db, type)) {
      const name = normalizeEntityName(entity.name);
      snapshot.rows.set(entity.id, { id: entity.id, type: entity.type, updated_at: entity.updatedAt, deleted_at: null });
      snapshot.entityIdOf.set(entityIdentity(entity.type, name), entity.id);
      // 同名跨类型（如设定「龙」与人物「龙」）时按 DECOMPOSE_ENTITY_KINDS 顺序取先者：关系候选只有名字，无类型
      if (!snapshot.entityByName.has(name)) snapshot.entityByName.set(name, { id: entity.id, type: entity.type });
      snapshot.nameById.set(entity.id, name);
    }
  }
  const { relations } = listRelations(project.db, {}, 1, project.root);
  for (const relation of relations) {
    const row = getRelation(project.db, relation.id, project.root); // 列表投影不带 updated_at，按 id 补齐
    if (row === null) continue;
    snapshot.rows.set(row.id, {
      id: row.id,
      type: DECOMPOSE_MERGE_RELATION_TYPE,
      updated_at: row.updated_at,
      deleted_at: null,
    });
    const source = snapshot.nameById.get(row.source_id);
    const target = snapshot.nameById.get(row.target_id);
    // 端点不在三类实体里（大纲节点 / 其他类型实体）⇒ 不是拆解写的关系，不参与比对
    if (source === undefined || target === undefined) continue;
    snapshot.relationIdOf.set(relationIdentity(source, target, row.relation_type), row.id);
  }
  const reportId = reportEntryId(baseline.values());
  const report = reportId === null ? null : getEntity(project.db, reportId);
  if (report !== null) {
    snapshot.rows.set(report.id, { id: report.id, type: report.type, updated_at: report.updated_at, deleted_at: null });
    snapshot.reportId = report.id;
  }
  return snapshot;
}

/**
 * 报告实体 id（baseline 里类型为报告实体的条目）：**最新一次记录胜出**（报告被用户删掉后重跑会另建
 * 新行，那时并集里会有两条 reference 记录；取最旧的一条会每轮重复建行）。从未写过 → null。
 */
function reportEntryId(entries: Iterable<MergeWrittenEntry>): string | null {
  let reportId: string | null = null;
  for (const entry of entries) if (entry.type === DECOMPOSE_REPORT_ENTITY_TYPE) reportId = entry.id;
  return reportId;
}

/** 某类型的**全部**活实体（`listEntities` 每页上限 MAX_ENTITY_LIST_LIMIT ⇒ 分页取全：同名复用必须看全库） */
function listAllLiveEntities(db: Db, type: DecomposeEntityKind): EntitySummary[] {
  const entities: EntitySummary[] = [];
  for (let offset = 0; ; offset += MAX_ENTITY_LIST_LIMIT) {
    const page = listEntities(db, { type, limit: MAX_ENTITY_LIST_LIMIT, offset });
    entities.push(...page.items);
    if (page.items.length === 0 || entities.length >= page.total) return entities;
  }
}

/** 新产物（归并算出的应写入项）：实体 / 关系 / 报告 */
type MergeProduct =
  | { kind: "entity"; key: string; id: string | null; candidate: MergedEntityCandidate; data: Record<string, unknown> }
  | {
      kind: "relation";
      key: string;
      id: string | null;
      relation: MergedRelationCandidate;
      /** 归一化端点名（落库时才解析为实体 id——本轮新建的实体在计划算完之后才有 id） */
      source: string;
      target: string;
    }
  | { kind: "report"; key: string; id: string | null };

interface MergeProductInput {
  outcome: MergeOutcome;
  mentions: ReadonlyMap<string, MentionAggregate>;
  aliasGroups: readonly ReportAliasGroup[];
  snapshot: MergeSnapshot;
  reportName: string;
}

/**
 * 新产物清单（归并身份 → 应写入项）：实体 / 关系 / 报告。
 * 关系端点名字解析不到库内实体 → 跳过（防御：悬空关系已被纯管线滤掉，此处只在异常输入下触发）。
 */
function buildMergeProducts(input: MergeProductInput): Map<string, MergeProduct> {
  const products = new Map<string, MergeProduct>();
  const aliasesOf = aliasNotesOf(input.aliasGroups);
  for (const candidate of input.outcome.entities) {
    const key = entityIdentity(candidate.type, candidate.name);
    products.set(key, {
      kind: "entity",
      key,
      id: input.snapshot.entityIdOf.get(key) ?? null,
      candidate,
      data: entityDataOf(input.mentions.get(key), aliasesOf.get(candidate.name) ?? []),
    });
  }
  for (const relation of input.outcome.relations) {
    // 端点名字在此**不解析为 id**：本轮新建实体要到计划执行时才有 id（端点解析见 createRow）。
    // 身份只用归一化名字，故能与上一轮写的活关系对上（关系端点只有名字，见 relationIdentity）。
    const source = normalizeEntityName(relation.source);
    const target = normalizeEntityName(relation.target);
    const key = relationIdentity(source, target, relation.type);
    products.set(key, { kind: "relation", key, id: input.snapshot.relationIdOf.get(key) ?? null, relation, source, target });
  }
  products.set(REPORT_PRODUCT_KEY, { kind: "report", key: REPORT_PRODUCT_KEY, id: input.snapshot.reportId });
  return products;
}

/** 规范名（归一化）→ 并入该人物的别名（别名组里除规范名以外的名字；只并人物） */
function aliasNotesOf(groups: readonly ReportAliasGroup[]): Map<string, string[]> {
  const aliasesOf = new Map<string, string[]>();
  for (const group of groups) {
    const canonical = normalizeEntityName(group.canonical);
    const aliases = group.aliases.map(normalizeEntityName).filter((name) => name !== "" && name !== canonical);
    aliasesOf.set(canonical, [...new Set([...(aliasesOf.get(canonical) ?? []), ...aliases])]);
  }
  return aliasesOf;
}

/** 实体落库 data：首个非空字段 + description（最长的一条，别名并进「（又称：…）」） */
function entityDataOf(aggregate: MentionAggregate | undefined, noteAliases: readonly string[]): Record<string, unknown> {
  const data: Record<string, unknown> = { ...(aggregate?.data ?? {}) };
  const description = appendAliasNote(aggregate?.description ?? "", noteAliases);
  if (description !== "") data.description = description;
  return data;
}

// ============ 写入计划执行（§6.1） ============

interface MergePlanExecution {
  project: ProjectContext;
  plan: readonly MergeWritePlanItem[];
  products: ReadonlyMap<string, MergeProduct>;
  written: readonly MergeWrittenEntry[];
  /** 库内快照的名字索引（计划执行时随本轮新建实体增长；关系端点在此解析） */
  entityByName: Map<string, EntityRef>;
  reportName: string;
  reportText: string;
  now: string;
}

/**
 * 按写入计划落库，返回新的 `merge_written` 清单：
 * - `create` → 建行（实体 / 关系 / 报告），记新行的 `updated_at`；
 * - `reuse` → 复用库内行 + **增量更新**（见 reuseRow）；
 * - `keep-user-edited` / `keep-and-report` → **不动**（用户编辑优先 / 分歧保留）；清单条目沿用本 job 清单里那条
 *   （跨轮条目本就不在本 job 清单里 ⇒ 不认领，不越权把用户行当作本管线所写）；
 * - `soft-delete` → 实体软删（回收站可还原）/ 关系物理删，条目从清单移除（旧行不再参与比对）。
 */
function executeMergePlan(input: MergePlanExecution): MergeWrittenEntry[] {
  const { project, plan, products, written, now } = input;
  // 名字索引隔离到本轮：随本轮新建实体增长（关系端点解析要用；实体条目在计划里排在关系条目之前）
  const execution: MergePlanExecution = { ...input, entityByName: new Map(input.entityByName) };
  const writtenById = new Map(written.map((entry) => [entry.id, entry]));
  const entries: MergeWrittenEntry[] = [];
  for (const item of plan) {
    const previous = item.id === null ? undefined : writtenById.get(item.id);
    if (item.action === "keep-user-edited" || item.action === "keep-and-report") {
      if (previous !== undefined) entries.push(previous);
      continue;
    }
    if (item.action === "soft-delete") {
      if (previous !== undefined) dropRow(project, previous, now);
      continue;
    }
    const product = item.key === null ? undefined : products.get(item.key);
    if (product === undefined) {
      // 计划与产物同源：缺了即调用方 bug。宁可不写也不写错行，但不静默（§9「删除不静默」同口径）
      console.warn(`[decompose] 写入计划缺产物，跳过：${item.action} ${item.key ?? item.id ?? ""}`);
      continue;
    }
    if (item.action === "reuse") {
      const entry = reuseRow(project, product, execution, previous);
      if (entry !== null) entries.push(entry);
      continue;
    }
    const entry = createRow(project, product, execution);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

/**
 * `reuse`：库内行是上一轮（本 job 清单 / 跨轮 baseline 记录值一致）写的 ⇒ 复用并**增量更新**（§6 第 3 层）。
 * - 实体：把本轮 data 并进库内现值（口径见 `mergeEntityData`），**无变化则不写**（避免 `updated_at` 抖动）；
 * - **写了一定要记新版本戳**：漏了它下一轮会把我们自己的写入误判成「用户编辑过」，从此不再更新该行；
 * - 跨轮行（本 job 清单里没有）**首次写入时认领**：清单自此覆盖它（下一次它被重跑去掉就归软删面管）；
 * - 报告：正文每轮重建（重跑后章摘要 / 人物小传可能已变）；关系：无可增量字段（复用即不动）。
 * @returns 清单条目（没写且本 job 清单里也没有该行 → null，不凭空认领）
 */
function reuseRow(
  project: ProjectContext,
  product: MergeProduct,
  execution: MergePlanExecution,
  previous: MergeWrittenEntry | undefined,
): MergeWrittenEntry | null {
  if (product.id === null) return previous ?? null;
  if (product.kind === "report") {
    writeReportDocument(project.db, product.id, execution.reportText, execution.now);
    return previous ?? entityEntry(project.db, product.id);
  }
  if (product.kind === "entity") {
    const current = getEntity(project.db, product.id);
    if (current !== null) {
      const data = mergeEntityData(current.data, product.data);
      if (data !== current.data) {
        const next = updateEntity(project.db, product.id, { data });
        if (next !== null) return { id: next.id, type: next.type, updated_at: next.updated_at };
      }
    }
  }
  return previous ?? null;
}

/** 库内实体行的清单条目（报告正文重建后认领它；行不可见 → null） */
function entityEntry(db: Db, id: string): MergeWrittenEntry | null {
  const row = getEntity(db, id);
  return row === null ? null : { id: row.id, type: row.type, updated_at: row.updated_at };
}

/**
 * 增量更新（§6 第 3 层）：把本轮实体 data 并进库内现值。**无变化时返回入参本身**（同一引用）
 * —— 调用方据此判「不写」（`updated_at` 同时是 baseline 比对依据）。
 * - `description`：剥掉「（又称：…）」段后**取更长者**（与 `entityDataOf` 的「最长的一条」同口径），
 *   别名段取**并集**（不丢上一轮别名）；
 * - 数组字段（`personality` / `tags` / `rules`）：**并集**（库内在前 ⇒ 顺序稳定，重跑幂等）；
 * - `role`：本轮**非空则覆盖**（续拆后定位可能变化）；
 * - 其余字段（`gender` / `age` / `race` / `alias` / `type` / `motivation` …）：**仅库内为空时填**。
 */
export function mergeEntityData(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  let next: Record<string, unknown> | null = null;
  const write = (field: string, value: unknown): void => {
    next ??= { ...current };
    next[field] = value;
  };
  for (const [field, value] of Object.entries(incoming)) {
    if (field === "description" || value === undefined) continue;
    const existing = current[field];
    if (Array.isArray(existing) && Array.isArray(value)) {
      const union = [...new Set([...existing, ...value])];
      if (union.length !== existing.length) write(field, union);
      continue;
    }
    if (field === "role" ? isFilled(value) : !isFilled(existing)) {
      if (existing !== value) write(field, value);
    }
  }
  const previousDescription = textOf(current.description);
  const description = mergeDescription(previousDescription, textOf(incoming.description));
  if (description !== previousDescription) write("description", description);
  return next ?? current;
}

/** description 的「更长者胜 + 别名并集」（比较基准 = 剥掉别名段后的正文） */
function mergeDescription(previous: string, incoming: string): string {
  const before = splitAliasNote(previous);
  const after = splitAliasNote(incoming);
  const base = after.base.length > before.base.length ? after.base : before.base;
  return appendAliasNote(base, [...new Set([...before.aliases, ...after.aliases])]);
}

/** 拆开 `appendAliasNote` 拼上的「（又称：…）」段；不是该形态 → 整段当正文（别名取不到） */
function splitAliasNote(description: string): { base: string; aliases: string[] } {
  const index = description.lastIndexOf(DECOMPOSE_ALIAS_NOTE_PREFIX);
  if (index < 0 || !description.endsWith("）")) return { base: description, aliases: [] };
  const aliases = description
    .slice(index + DECOMPOSE_ALIAS_NOTE_PREFIX.length, -1)
    .split(DECOMPOSE_ALIAS_NOTE_SEPARATOR)
    .filter((alias) => alias !== "");
  return { base: description.slice(0, index), aliases };
}

/** 非空值（空串 / 空数组 / null / undefined 视同未填）——「库内为空才填」的判据 */
function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * `create`：建行（实体 / 关系 / 报告 + 报告块文档）；关系端点在此解析（本轮新建的实体此时才有 id）。
 * 关系端点解析失败（名字不在落库实体集合内）→ 跳过该关系并返回 null（不写清单：从未落库的条目不该进比对面）。
 */
function createRow(
  project: ProjectContext,
  product: MergeProduct,
  execution: MergePlanExecution,
): MergeWrittenEntry | null {
  if (product.kind === "entity") {
    const row = createEntity(project.db, { type: product.candidate.type, name: product.candidate.name, data: product.data });
    execution.entityByName.set(normalizeEntityName(row.name), { id: row.id, type: row.type });
    return { id: row.id, type: row.type, updated_at: row.updated_at };
  }
  if (product.kind === "relation") {
    const source = execution.entityByName.get(product.source);
    const target = execution.entityByName.get(product.target);
    if (source === undefined || target === undefined) {
      console.warn(`[decompose] 关系端点未落库，跳过写入：${product.source}→${product.target}（${product.relation.type}）`);
      return null;
    }
    const row = createRelation(
      project.db,
      {
        sourceType: source.type,
        sourceId: source.id,
        targetType: target.type,
        targetId: target.id,
        relationType: product.relation.type,
      },
      project.root,
    );
    return { id: row.id, type: DECOMPOSE_MERGE_RELATION_TYPE, updated_at: row.updated_at };
  }
  const row = createEntity(project.db, {
    type: DECOMPOSE_REPORT_ENTITY_TYPE,
    name: execution.reportName,
    data: { type: DECOMPOSE_REPORT_KIND, tags: [DECOMPOSE_REPORT_KIND] },
  });
  writeReportDocument(project.db, row.id, execution.reportText, execution.now);
  return { id: row.id, type: row.type, updated_at: row.updated_at };
}

/**
 * `soft-delete`：消失行。
 * 实体 → 软删（回收站可还原）；关系 → 物理删（本仓关系没有回收站路径，见文件头口径）。
 */
function dropRow(project: ProjectContext, entry: MergeWrittenEntry, now: string): void {
  if (entry.type === DECOMPOSE_MERGE_RELATION_TYPE) deleteRelation(project.db, entry.id);
  else softDeleteEntity(project.db, entry.id, now);
}

/** 报告正文落块文档（服务端按行拆段落块，不做 markdown 语义转换；投影从块重算） */
function writeReportDocument(db: Db, reportId: string, text: string, now: string): void {
  const blocks = paragraphBlocksOf(text);
  upsertDocument(db, {
    ownerKind: "reference",
    ownerId: reportId,
    content: JSON.stringify(blocks),
    contentText: blocksToPlainMd(blocks),
    now,
  });
}

// ============ 报告事实（§6.2 六段的输入） ============

interface ReportFactsInput {
  outcome: MergeOutcome;
  mentions: ReadonlyMap<string, MentionAggregate>;
  aliasGroups: readonly ReportAliasGroup[];
  chapters: readonly ReportChapter[];
  batchCount: number;
  keptUserEdited: readonly string[];
}

/** 报告事实：全部来自服务端确定性数据（人物小传取落库人物，第 6 段取阈值/悬空过滤的产物） */
function reportFacts(input: ReportFactsInput): Omit<DecomposeReportFacts, "bookName"> {
  return {
    chapters: input.chapters,
    batchCount: input.batchCount,
    characters: charactersOf(input.outcome.entities, input.mentions),
    chapterLengths: input.chapters.map((chapter) => ({ index: chapter.index, title: chapter.title, length: chapter.length })),
    aliasGroups: input.aliasGroups,
    filteredCharacters: input.outcome.filtered.characters.map((candidate) => candidate.name),
    filteredRelations: input.outcome.filtered.relations.map(relationText),
    keptUserEdited: input.keptUserEdited,
  };
}

/** 落库人物小传：`role` + `description` + 出现章范围（数据取提及素材，与实体落库同源） */
function charactersOf(
  entities: readonly MergedEntityCandidate[],
  mentions: ReadonlyMap<string, MentionAggregate>,
): ReportCharacter[] {
  return entities
    .filter((entity) => entity.type === "character")
    .map((entity) => {
      const aggregate = mentions.get(entityIdentity(entity.type, entity.name));
      const role = aggregate?.data.role;
      return {
        name: entity.name,
        role: typeof role === "string" ? role : "",
        description: aggregate?.description ?? "",
        chapters: entity.chapters,
      };
    });
}

/** `keep-and-report` 的行标签（用户手工编辑过、产物里已消失 ⇒ 保留不动，报告里提示） */
function keptUserEditedLabels(
  project: ProjectContext,
  plan: readonly MergeWritePlanItem[],
  written: readonly MergeWrittenEntry[],
): string[] {
  const writtenById = new Map(written.map((entry) => [entry.id, entry]));
  return plan
    .filter((item) => item.action === "keep-and-report" && item.id !== null)
    .map((item) => rowLabel(project, writtenById.get(item.id as string)));
}

/** 行标签：实体 = 名字（类别）；关系 = 两端名字 + 类型（读不到 → 退回 id，不静默丢行） */
function rowLabel(project: ProjectContext, entry: MergeWrittenEntry | undefined): string {
  if (entry === undefined) return "";
  if (entry.type === DECOMPOSE_MERGE_RELATION_TYPE) {
    const relation = getRelation(project.db, entry.id, project.root);
    if (relation === null) return entry.id;
    const source = getEntity(project.db, relation.source_id)?.name ?? relation.source_id;
    const target = getEntity(project.db, relation.target_id)?.name ?? relation.target_id;
    return `${source}→${target}（${relation.relation_type}）`;
  }
  const entity: EntityRow | null = getEntity(project.db, entry.id);
  return entity === null ? entry.id : `${entity.name}（${entity.type}）`;
}

// ============ 模块私有小工具 ============

/** 归并身份：实体 = `类别:归一化名`（与 merge.ts 的写入计划 key 文档同口径） */
function entityIdentity(type: string, name: string): string {
  return `${type}:${name}`;
}

/** 归并身份：关系 = 两端**归一化名字** + 类型（新产物在端点实体落库前就要能算出身份，见 buildMergeProducts） */
function relationIdentity(source: string, target: string, subject: string): string {
  return `${source}\u0000${target}\u0000${subject}`;
}


function relationText(relation: MergedRelationCandidate): string {
  return `${relation.source}→${relation.target}（${relation.type}）`;
}

/** 超长截断（模型爱加首尾空白；上限 = 抽取层的 description 上限） */
function clipText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= DECOMPOSE_DESCRIPTION_MAX_CHARS ? trimmed : trimmed.slice(0, DECOMPOSE_DESCRIPTION_MAX_CHARS);
}

type JsonRecord = Record<string, unknown>;

/** 模型输出不可信：非对象一律当缺字段 */
function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

/** 非空字符串（trim 后非空）→ 原值；其余当缺字段 */
function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() === "" ? null : value;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
