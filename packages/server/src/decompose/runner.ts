// 拆解 S2 批执行器（卡 21.6）：串行批循环 + 滚动故事圣经 + 逐章对齐重试 + 取消通道（暂停 / 切书 / 重启归一）
// + job 收口（卡 21.7：批全部收口后跑 S3 归并与 S4 报告，随后 job 置 `done`）与单批重跑入口。
//
// 契约：docs/design/60-decompose.md §2（S3/S4 在全部批完成后各跑一次）、§4（批调度：组批 / 重试 / 串行 /
// 滚动故事圣经）、§5（抽取 schema 口径）、§7（状态机、续拆、单批重跑）；docs/api/120-api-decompose.md
// §pause / §resume / §rerun；状态不变式见 docs/db/schema.md「decompose 两表」（状态归一**只归一 job 行**）。本模块的四条口径：
// - **续拆取「第一个未完成批」**：`done` 之外的批（`pending` / `running` / `failed`）都算未完成——
//   服务端重启残留的 `running` 批由这里承接，不单独归一；
// - **单批重跑只重跑该批**（§7）：重新抽取该批 → S3 重算（`merge_written` 三路比对保幂等）→ S4 重建报告；
// - **S2 不写业务表**：批结果只落 `decompose_batches.result`（实体 / 关系 / 大纲 / 正文只由 S3/S4 写）；
// - **批跑完时 job 留在 `running`**，全部批收口后才由 S3+S4 推到 `done`（job.ts 的 `deriveStage` 据
//   「批是否全部收口」推出 `merge` / `report`）。
//
// 调用路径：`start` 建档后、`resume` 续拆后各起一轮（路由**不 await**：长任务是后台跑）。
// 暂停 / 切书 = 置 abort：**当前批跑完即停**，已发出的模型调用不 abort（结果不浪费，批级幂等靠 `done` 跳过）。
// 模型调用只经 pi 的 `ModelRuntime`（`getModelRuntime()` / `getSettingsManager()` 唯一入口）——
// 业务代码不自建 fetch / HTTP agent（出站行为统一由启动时装的全局 undici dispatcher 承担）。
// 阈值与提示词里的数字一律取自常量（提示词按常量插值生成，散文不复述数字）。

import type { DecomposeBatchResult, OutlineFileTree } from "@whispering233/ai-editor-shared";
import {
  completeBatch,
  deriveChapterOrder,
  failBatch,
  findOutlineNode,
  getDecomposeJob,
  getDocumentTexts,
  listDecomposeBatches,
  nowIso,
  readOutlineFile,
  setJobError,
  startBatchAttempt,
  updateJobStatus,
  type DecomposeBatchRow,
  type DecomposeJobRow,
} from "@whispering233/ai-editor-db";
import type { ProjectContext } from "../middleware/project.js";
import {
  DECOMPOSE_CHAPTER_MAX_CHARACTERS,
  DECOMPOSE_CHAPTER_MAX_LOCATIONS,
  DECOMPOSE_CHAPTER_MAX_RELATIONS,
  DECOMPOSE_CHAPTER_MAX_SETTINGS,
  DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS,
  DECOMPOSE_DESCRIPTION_MAX_CHARS,
  DECOMPOSE_MOTIVATION_MAX_CHARS,
  DECOMPOSE_PERSONALITY_MAX_ITEMS,
  DECOMPOSE_RELATION_TYPES,
  normalizeExtraction,
} from "./extract.js";
import { doneBatchResults } from "./job.js";
import { completeOnce, parseModelJson, type DecomposeLlmDeps, type ModelRequest } from "./llm.js";
import { normalizeEntityName } from "./merge.js";
import { runDecomposeMerge } from "./merge-write.js";

/** 批并发度：串行是既定口径（§4——不在 pi 的重试链里，429 / 限流要自己兜，后台任务慢比失败好）。
 * 单点可调：改成 N 即按 N 批一组并发跑；同组共用一份故事圣经快照（组内后批看不到同组前批的产出）。 */
export const DECOMPOSE_CONCURRENCY = 1;
/** 单批尝试上限（含首次）：缺章 → 整批重试；超上限标 `failed` 并继续后续批（不阻塞整个 job） */
export const DECOMPOSE_BATCH_MAX_ATTEMPTS = 3;
/** 滚动故事圣经长度上限（跨批携带的名字 / 关系 / 上批摘要的总预算；与 `DECOMPOSE_BATCH_OVERHEAD_TOKENS` 同量级） */
export const DECOMPOSE_BIBLE_MAX_CHARS = 1200;

/** 拆解 runner 可注入依赖（测试注入内存运行时 + faux provider 离线跑通；缺省走 pi 单例） */
export type DecomposeRunnerDeps = DecomposeLlmDeps;

/** 一批里的单章素材（章序 = 1-based 文件位置序；正文 = 服务端派生的 `content_text` 投影） */
interface BatchChapter {
  index: number;
  title: string;
  text: string;
}

// ============ 滚动故事圣经（§4） ============

/** 滚动故事圣经：跨批携带「已出现的实体名 + 关系 + 上一批摘要」——**不带上文原文** */
export interface StoryBible {
  /** 人物 / 设定 / 地点的名字（按 `normalizeEntityName` 去重、保持出现顺序） */
  names: string[];
  /** 已出现的关系（`源→靶（类型）`，去重） */
  relations: string[];
  /** **上一批**各章摘要（整批替换：跨批只需最近一批，不占预算） */
  summaries: string[];
}

export function emptyStoryBible(): StoryBible {
  return { names: [], relations: [], summaries: [] };
}

/**
 * 归并一批抽取结果进圣经（纯函数，返回新对象）：名字与关系累计去重，摘要整批替换。
 * 名字集合同时是 `normalizeExtraction` 的 `knownNames`——跨批关系端点靠它才不被当成幻觉丢弃。
 */
export function extendStoryBible(bible: StoryBible, result: DecomposeBatchResult): StoryBible {
  const seenNames = new Set(bible.names.map(normalizeEntityName));
  const names = [...bible.names];
  for (const chapter of result.chapters) {
    for (const entity of [...chapter.characters, ...chapter.settings, ...chapter.locations]) {
      const key = normalizeEntityName(entity.name);
      if (key === "" || seenNames.has(key)) continue;
      seenNames.add(key);
      names.push(entity.name);
    }
  }
  const relations = [...bible.relations];
  const seenRelations = new Set(relations);
  for (const chapter of result.chapters) {
    for (const relation of chapter.relations) {
      const line = `${relation.source}→${relation.target}（${relation.type}）`;
      if (seenRelations.has(line)) continue;
      seenRelations.add(line);
      relations.push(line);
    }
  }
  return { names, relations, summaries: result.chapters.map((chapter) => chapter.summary).filter((summary) => summary !== "") };
}

/**
 * 圣经文本（受 `DECOMPOSE_BIBLE_MAX_CHARS` 约束）：名字行优先保留（模型判关系端点靠它），
 * 摘要与关系按顺序填剩余预算，超预算的尾部条目丢弃（新信息在前）。
 */
export function storyBibleText(bible: StoryBible): string {
  const namesLine =
    bible.names.length === 0
      ? ""
      : clipLine(`已出现的名字：${bible.names.join("、")}`, DECOMPOSE_BIBLE_MAX_CHARS);
  const kept: string[] = [];
  let used = namesLine.length;
  for (const line of [
    ...bible.summaries.map((summary) => `上一批摘要：${summary}`),
    ...bible.relations.map((relation) => `已出现的关系：${relation}`),
  ]) {
    if (used + line.length + 1 > DECOMPOSE_BIBLE_MAX_CHARS) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [namesLine, ...kept].filter((line) => line !== "").join("\n");
}

// ============ 提示词（数值一律由常量插值，不在散文里复述） ============

/**
 * 批提示词：系统提示 = 角色 + 输出契约 + 各上限；用户消息 = 故事圣经 + 本批各章正文。
 * 输出契约即 `normalizeExtraction` 的输入形状（逐章对齐；缺章 → 整批重试）。
 */
function buildBatchPrompt(input: { chapters: readonly BatchChapter[]; bibleText: string }): ModelRequest {
  const bible = input.bibleText === "" ? "（本批是首批，尚无上文）" : input.bibleText;
  const body = input.chapters.map((chapter) => `### 第${chapter.index}章 ${chapter.title}\n${chapter.text}`).join("\n\n");
  return {
    system: [
      "你是小说拆解流水线的逐章抽取员。输入是长篇小说的其中若干章，输出必须是 JSON。",
      "每章产出一个条目（chapterIndex = 输入里的章序），不得合并章节、不得遗漏——漏章会让整批重跑。",
      "只输出 JSON（可以放 ```json 围栏），不要写解释文字。",
      "",
      '输出结构：{"chapters":[{"chapterIndex":1,"chapterTitle":"…","summary":"…","characters":[…],"settings":[…],"locations":[…],"relations":[…]}]}',
      "",
      "字段口径：",
      `- summary：本章剧情摘要，不超过 ${DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS} 字；`,
      "- characters[]：{name, role, description, alias, gender, age, race, personality, motivation}",
      "- name 必填；role 建议用：主角 / 主要配角 / 配角 / 反派 / 龙套；",
      `- description 必填且不超过 ${DECOMPOSE_DESCRIPTION_MAX_CHARS} 字；alias 只填一个最常用的别称，其余别名写进 description 的「（又称：X、Y）」；`,
      `- gender / age / race 只在文中明确时填；personality 不超过 ${DECOMPOSE_PERSONALITY_MAX_ITEMS} 条；motivation 不超过 ${DECOMPOSE_MOTIVATION_MAX_CHARS} 字；`,
      `- 不要输出 ability_panel 与 custom_fields；每章人物不超过 ${DECOMPOSE_CHAPTER_MAX_CHARACTERS} 条；`,
      `- settings[]：{name, description, tags, rules}——只抽对剧情有影响的设定；tags 写短标签、rules 写短句、description 不超过 ${DECOMPOSE_DESCRIPTION_MAX_CHARS} 字；每章不超过 ${DECOMPOSE_CHAPTER_MAX_SETTINGS} 条；`,
      `- locations[]：{name, type, description}——不输出上级地点；description 不超过 ${DECOMPOSE_DESCRIPTION_MAX_CHARS} 字；每章不超过 ${DECOMPOSE_CHAPTER_MAX_LOCATIONS} 条；`,
      `- relations[]：{source, target, type, evidence}——type 只能取 ${DECOMPOSE_RELATION_TYPES.join(" / ")}；source / target 必须是本章或上文出现过的名字；每章不超过 ${DECOMPOSE_CHAPTER_MAX_RELATIONS} 条。`,
    ].join("\n"),
    user: [`【故事圣经】${bible}`, "", "【本批正文】", body].join("\n"),
  };
}

// ============ 模型调用（唯一入口 = pi ModelRuntime 单例；实现在 llm.ts） ============

// ============ 批执行 ============

interface BatchOutcome {
  /** 已落库的批结果（失败 / 取消 → null） */
  result: DecomposeBatchResult | null;
  /** 本轮是否已把该批标 `failed` */
  failed: boolean;
}

interface BatchRunInput {
  project: ProjectContext;
  jobId: string;
  batch: DecomposeBatchRow;
  chapters: readonly BatchChapter[];
  bibleText: string;
  knownNames: readonly string[];
  deps: DecomposeRunnerDeps;
  signal: AbortSignal;
}

/**
 * 一批的执行：整批重试（≤ `DECOMPOSE_BATCH_MAX_ATTEMPTS`，含首次）——缺章是最常见的败因，
 * 重试代价 = 一批 token，而缺章的产出本来就不完整；超上限 → 标 `failed` 并继续后续批。
 * 取消（暂停 / 切书）时不再重试：批留在未完成状态，由续拆承接（`schema.md`「状态归一」不变式）。
 */
async function runBatch(input: BatchRunInput): Promise<BatchOutcome> {
  let lastError = "批未完成";
  for (let attempt = 1; attempt <= DECOMPOSE_BATCH_MAX_ATTEMPTS; attempt++) {
    if (input.signal.aborted) return { result: null, failed: false };
    if (startBatchAttempt(input.project.db, input.jobId, input.batch.seq, nowIso()) === null) {
      throw new Error(`拆解批不存在：job ${input.jobId} 批 ${input.batch.seq}`);
    }
    try {
      const text = await completeOnce(input.deps, buildBatchPrompt({ chapters: input.chapters, bibleText: input.bibleText }), input.jobId);
      const normalized = normalizeExtraction(
        parseModelJson(text),
        input.chapters.map((chapter) => chapter.index),
        input.knownNames,
      );
      if (normalized.discarded.length > 0) {
        console.warn(`[decompose] job ${input.jobId} 批 ${input.batch.seq} 归一丢弃：${normalized.discarded.join("；")}`);
      }
      completeBatch(input.project.db, { jobId: input.jobId, seq: input.batch.seq, result: normalized.result, now: nowIso() });
      return { result: normalized.result, failed: false };
    } catch (err) {
      lastError = errorMessage(err);
      console.warn(`[decompose] job ${input.jobId} 批 ${input.batch.seq} 第 ${attempt} 次尝试失败：${lastError}`);
    }
  }
  failBatch(input.project.db, { jobId: input.jobId, seq: input.batch.seq, error: lastError, now: nowIso() });
  return { result: null, failed: true };
}

/** 一批的素材：章序 / 标题来自大纲（章序 = 文件位置序），正文一次批量取投影（勿逐章查） */
function batchChapters(
  project: ProjectContext,
  batch: DecomposeBatchRow,
  tree: OutlineFileTree,
  chapterNumberById: ReadonlyMap<string, number>,
): BatchChapter[] {
  const texts = getDocumentTexts(project.db, "chapter", batch.chapter_ids);
  return batch.chapter_ids.flatMap((chapterId) => {
    const index = chapterNumberById.get(chapterId);
    // 章被物理删（回收站清除）后批行仍留旧 id：正文与章序都没了 ⇒ 从本批素材剔除，
    // 否则「缺章」判据会把整批判死（进度页同样跳过这些 id，见 job.ts 的 buildJobResponse）
    if (index === undefined) return [];
    return [{ index, title: findOutlineNode(tree, chapterId)?.title ?? "", text: texts.get(chapterId) ?? "" }];
  });
}

/**
 * 已完成批的抽取结果读取（续拆 / 单批重跑时重建滚动故事圣经）：实现在 `job.ts`——S3 归并读同一份
 * （不重建的话上文的名字与关系全丢，跨批关系端点会被当成幻觉丢弃）。
 */

/** 一轮批执行的入参（对象字段，便于后续扩展不破签名） */
interface ExecuteRunInput {
  project: ProjectContext;
  job: DecomposeJobRow;
  deps: DecomposeRunnerDeps;
  signal: AbortSignal;
  /** 单批重跑：该批即使已 `done` 也重跑一次（其余 `done` 批不动）；其旧结果不入故事圣经（已知的过期输入） */
  rerunSeq?: number;
}

/** 一轮批执行（S2）：串行逐批调模型，结果只写 `decompose_batches.result` */
async function executeRun(input: ExecuteRunInput): Promise<void> {
  const { project, job, deps, signal } = input;
  const batches = listDecomposeBatches(project.db, job.id);
  const pending = batches.filter((batch) => batch.status !== "done" || batch.seq === input.rerunSeq);
  const tree = readOutlineFile(project.root); // 一轮一份大纲快照（长任务里用户可能改标题）
  const chapterNumberById = new Map(deriveChapterOrder(project.root).map((entry) => [entry.chapterId, entry.chapterNumber]));
  let bible = doneBatchResults(
    project.db,
    job.id,
    batches
      .filter((batch) => batch.status === "done" && batch.seq !== input.rerunSeq)
      .map((batch) => batch.seq),
  ).reduce(extendStoryBible, emptyStoryBible());

  let executed = 0;
  let failed = 0;
  for (let start = 0; start < pending.length && !signal.aborted; start += DECOMPOSE_CONCURRENCY) {
    const outcomes = await Promise.all(
      pending.slice(start, start + DECOMPOSE_CONCURRENCY).map((batch) =>
        runBatch({
          project,
          jobId: job.id,
          batch,
          chapters: batchChapters(project, batch, tree, chapterNumberById),
          bibleText: storyBibleText(bible),
          knownNames: bible.names,
          deps,
          signal,
        }),
      ),
    );
    for (const outcome of outcomes) {
      executed++;
      if (outcome.failed) failed++;
      if (outcome.result !== null) bible = extendStoryBible(bible, outcome.result);
    }
  }
  console.log(
    `[decompose] job ${job.id} 批执行收尾：执行 ${executed} 批 / 失败 ${failed} 批${signal.aborted ? "（已暂停）" : ""}`,
  );
}

// ============ 进程内运行登记：取消通道 + 排队 ============
//
// job 是长任务：路由返回后由本模块继续跑。登记表两个用途：
// 1. **取消通道**：pause 路由与 `setCurrentProject`（切书 / 关项目）按 jobId 置 abort —— 当前批跑完即停；
// 2. **排队**：同一 job 上一轮尚未收尾（pause 后当前批仍在飞）时，新一轮先等它收尾再开——
//    否则两轮会取到同一个未完成批，重复计 attempts 与重复付费。

interface ActiveRun {
  controller: AbortController;
  done: Promise<void>;
}

const activeRuns = new Map<string, ActiveRun>();

/**
 * 中止一个 job 的在跑轮次（pause 路由用）：当前批跑完即停，**已发出的模型调用不 abort**。
 * 状态写入归调用方（pause 路由 / `setCurrentProject` 的归一）。
 * @returns 是否有在跑的一轮
 */
export function pauseDecomposeJob(jobId: string): boolean {
  const run = activeRuns.get(jobId);
  run?.controller.abort();
  return run !== undefined;
}

/** 中止全部在跑轮次（切书 / 关项目挂点：不做跨书后台跑） */
export function cancelRunningDecomposeJobs(): void {
  for (const run of activeRuns.values()) run.controller.abort();
}

/** 单批重跑选项（§7：`done` 与 `failed` 都可重跑，跑完重建 S3/S4） */
export interface DecomposeRunOptions {
  rerunSeq?: number;
}

/**
 * 启动 job 的批执行（**调用方不 await**：长任务）。状态前置校验归调用方（start / resume / rerun 各自置 `running`）。
 * 同一 job 已有在跑或排队的一轮时，本轮排在它后面（见上方「排队」）；批全部收口后接 S3 + S4 并把 job 置 `done`。
 * @returns 本轮收尾的 promise（调用方不 await；测试可 await）
 */
export function startDecomposeJob(
  project: ProjectContext,
  deps: DecomposeRunnerDeps = {},
  options: DecomposeRunOptions = {},
): Promise<void> {
  const job = getDecomposeJob(project.db); // 一项目一 job：取最新一行（db helper 口径）
  if (job === null || job.status !== "running") return Promise.resolve();
  // 资源加载与会话 cwd = 项目根（拆解不注入 AGENTS.md，但 cwd 仍是 pi 的会话身份上下文）
  const jobDeps: DecomposeRunnerDeps = deps.cwd === undefined ? { ...deps, cwd: project.root } : deps;
  const controller = new AbortController();
  const previous = activeRuns.get(job.id);
  const run: ActiveRun = { controller, done: Promise.resolve() };
  activeRuns.set(job.id, run);
  run.done = (async () => {
    try {
      await previous?.done; // 上一轮先收尾（含它正在飞的批落库）
      if (controller.signal.aborted) return;
      await executeRun({ project, job, deps: jobDeps, signal: controller.signal, rerunSeq: options.rerunSeq });
      if (controller.signal.aborted) return; // 暂停 / 切书：不跑 S3/S4（状态归暂停与续拆路径）
      await finishJob(project, job, jobDeps);
    } catch (err) {
      failJob(project, job, controller.signal, err);
    } finally {
      if (activeRuns.get(job.id) === run) activeRuns.delete(job.id);
    }
  })();
  return run.done;
}

/**
 * job 收口（§2「S3 只在全部批完成后跑一次」）：批全部收口 → S3 归并 + S4 报告 → job 置 `done`。
 * 有未收口批（暂停 / 崩溃残留）→ 什么都不做（状态归暂停与续拆路径）。
 * 状态回写前重读 job 行：S3/S4 期间可能被暂停 / 切书（长调用），不能盖掉那次状态。
 */
async function finishJob(project: ProjectContext, job: DecomposeJobRow, deps: DecomposeRunnerDeps): Promise<void> {
  const settled = listDecomposeBatches(project.db, job.id).every(
    (batch) => batch.status === "done" || batch.status === "failed",
  );
  if (!settled) return;
  const summary = await runDecomposeMerge({ project, jobId: job.id, deps, now: nowIso() });
  console.log(
    `[decompose] job ${job.id} 归并与报告收尾：实体 ${summary.entities} / 关系 ${summary.relations} / 别名组 ${summary.aliasGroups} / 报告 ${summary.reportId}`,
  );
  if (getDecomposeJob(project.db)?.status !== "running") return;
  updateJobStatus(project.db, job.id, "done", nowIso());
}

/**
 * job 级失败（批级失败不阻塞整个 job，故只在此处把 job 标 `failed`）：写错误摘要 + 状态。
 * 已取消（暂停 / 切书，含被 resume 顶替的旧轮）时不改状态——状态归暂停与续拆路径，
 * 否则旧轮的 `failed` 会盖掉新一轮刚写的 `running`。
 */
function failJob(project: ProjectContext, job: DecomposeJobRow, signal: AbortSignal, err: unknown): void {
  const message = errorMessage(err);
  console.error(`[decompose] job ${job.id} 执行失败：${message}`, err);
  try {
    setJobError(project.db, job.id, message, nowIso());
    if (!signal.aborted) updateJobStatus(project.db, job.id, "failed", nowIso());
  } catch (writeErr) {
    // 切书会先关旧库连接（start / open 路由的切换顺序）⇒ 写不进去是预期形态：
    // 该 job 行由「下次打开这本书时的归一」接管
    console.error(`[decompose] job ${job.id} 失败状态写入失败（库可能已关闭）`, writeErr);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 单行截断（圣经名字行的预算兜底；超长直接切，不引入省略号状态） */
function clipLine(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}
