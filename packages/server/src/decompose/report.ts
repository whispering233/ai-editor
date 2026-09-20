// 拆解 S4：报告内容（六段）与全书剧情摘要的一次聚合调用。
//
// 契约：docs/design/60-decompose.md §6.2（六段结构）/ §2（S4 = 一次调用，输入 = 各章摘要）。
// 分工：本模块只**产文本 + 调一次模型**——报告实体与块文档的落库归 `merge-write.ts`。
// 正文 = 纯文本小标题 + 段落（服务端按行拆段落块，不做 markdown 语义转换，与参考资料导入同口径）。
// 数值上限与文案单一定义在本模块并导出；散文与注释只引用常量名，不复述数字。

import { completeOnce, type DecomposeLlmDeps } from "./llm.js";
import { SPLIT_LONG_BLOCK_FACTOR } from "./split.js";

/** 报告实体的落点口径：`entities.type`（第 7 种实体）+ `data.type` / `tags` / 名字后缀共用这个词 */
export const DECOMPOSE_REPORT_ENTITY_TYPE = "reference";
export const DECOMPOSE_REPORT_KIND = "拆解报告";

/** 全书剧情摘要长度上限（提示词按常量插值，落库前同口径截断） */
export const DECOMPOSE_REPORT_PLOT_MAX_CHARS = 1200;

/** 报告六段标题（顺序即正文顺序；§6.2 的六段） */
export const DECOMPOSE_REPORT_SECTIONS = [
  "一、作品概览",
  "二、全书剧情摘要",
  "三、人物小传汇总",
  "四、结构与节奏",
  "五、已合并的别名组",
  "六、被阈值滤掉的单章线索",
] as const;

/** 报告实体名（`name` = 《书名》拆解报告；`data.type` / `tags` 用 DECOMPOSE_REPORT_KIND） */
export function decomposeReportName(bookName: string): string {
  return `《${bookName}》${DECOMPOSE_REPORT_KIND}`;
}

/** 章条目（章序 = 1-based 文件位置序；标题取大纲节点标题，摘要取批结果） */
export interface ReportChapter {
  index: number;
  title: string;
  summary: string;
  /** 章正文投影长度（`document_records.content_text`；读取投影，不解析块体） */
  length: number;
}

/** 人物小传条目（落库人物：role + description + 出现章范围，§6.2 第 3 段） */
export interface ReportCharacter {
  name: string;
  role: string;
  description: string;
  chapters: readonly number[];
}

/** 已合并的别名组（§6 第 2 层的产物 + 模型给的依据，供人工核对） */
export interface ReportAliasGroup {
  canonical: string;
  aliases: readonly string[];
  reason: string;
}

/** 六段报告的事实输入（全部来自服务端确定性数据 + 一次剧情摘要调用） */
export interface DecomposeReportFacts {
  bookName: string;
  chapters: readonly ReportChapter[];
  batchCount: number;
  characters: readonly ReportCharacter[];
  chapterLengths: readonly { index: number; title: string; length: number }[];
  aliasGroups: readonly ReportAliasGroup[];
  /** 第 6 段：被阈值滤掉的单章线索（人物名 / 关系文本） */
  filteredCharacters: readonly string[];
  filteredRelations: readonly string[];
  /** 用户手工编辑过、重跑时不动的行（三路比对 keep-and-report，§6.1） */
  keptUserEdited: readonly string[];
}

/** 报告正文（六段；纯文本小标题 + 段落，由调用方按行拆块） */
export function buildDecomposeReportText(facts: DecomposeReportFacts, plotSummary: string): string {
  return [
    DECOMPOSE_REPORT_SECTIONS[0],
    `《${facts.bookName}》共 ${facts.chapters.length} 章，正文 ${totalCharsOf(facts)} 字，落库人物 ${facts.characters.length} 位，拆解批数 ${facts.batchCount} 批。`,
    "",
    DECOMPOSE_REPORT_SECTIONS[1],
    plotSummary === "" ? "（无章摘要可聚合）" : plotSummary,
    "",
    DECOMPOSE_REPORT_SECTIONS[2],
    ...(facts.characters.length === 0 ? ["（无落库人物）"] : facts.characters.map(characterLine)),
    "",
    DECOMPOSE_REPORT_SECTIONS[3],
    rhythmLine(facts),
    longChapterLine(facts),
    "",
    DECOMPOSE_REPORT_SECTIONS[4],
    ...(facts.aliasGroups.length === 0 ? ["（本轮未合并别名组）"] : facts.aliasGroups.map(aliasGroupLine)),
    "",
    DECOMPOSE_REPORT_SECTIONS[5],
    `人物：${listOrNone(facts.filteredCharacters)}`,
    `关系：${listOrNone(facts.filteredRelations)}`,
    ...(facts.keptUserEdited.length === 0
      ? []
      : [`未改动（用户手工编辑过，重跑不覆盖）：${facts.keptUserEdited.join("；")}`]),
  ].join("\n");
}

/**
 * 全书剧情摘要调用（S4 的**唯一**模型调用）：输入 = 各章摘要（不是原文，成本与总字数无关）。
 * 无章摘要时不调用模型（无输入可聚合），由调用方按空文本落报告。
 */
export async function completeReportPlot(deps: DecomposeLlmDeps, chapters: readonly ReportChapter[]): Promise<string> {
  const withSummary = chapters.filter((chapter) => chapter.summary !== "");
  if (withSummary.length === 0) return "";
  const request = {
    system: [
      "你是小说拆解流水线的全书报告员。输入是各章摘要，输出是**一段连贯的全书剧情摘要**（纯文本，不要 JSON、不要标题、不要分点符号）。",
      `按剧情推进顺序串起主线：起因、关键转折、高潮、结局；不要逐章复述，不要编造摘要里没有的情节。不超过 ${DECOMPOSE_REPORT_PLOT_MAX_CHARS} 字。`,
    ].join("\n"),
    user: withSummary.map((chapter) => `第${chapter.index}章 ${chapter.title}：${chapter.summary}`).join("\n"),
  };
  const text = (await completeOnce(deps, request)).trim();
  return text.length <= DECOMPOSE_REPORT_PLOT_MAX_CHARS ? text : text.slice(0, DECOMPOSE_REPORT_PLOT_MAX_CHARS);
}

// ── 模块私有 ─────────────────────────────────────────────────────────────────

function totalCharsOf(facts: DecomposeReportFacts): number {
  return facts.chapterLengths.reduce((sum, chapter) => sum + chapter.length, 0);
}

function characterLine(character: ReportCharacter): string {
  const role = character.role === "" ? "" : `（${character.role}）`;
  const description = character.description === "" ? "" : `：${character.description}`;
  return `- ${character.name}${role}${description}（出现第 ${chapterRangeText(character.chapters)} 章）`;
}

/** 出现章范围：首–末（单章 = 同一个数） */
function chapterRangeText(chapters: readonly number[]): string {
  if (chapters.length === 0) return "—";
  const first = Math.min(...chapters);
  const last = Math.max(...chapters);
  return first === last ? String(first) : `${first}–${last}`;
}

/** 第 4 段前半：章字数分布（最短 / 中位 / 最长，带章号与标题） */
function rhythmLine(facts: DecomposeReportFacts): string {
  if (facts.chapterLengths.length === 0) return "章字数：无已导入正文。";
  const lengths = facts.chapterLengths.map((chapter) => chapter.length).sort((left, right) => left - right);
  const shortest = facts.chapterLengths.find((chapter) => chapter.length === lengths[0]);
  const longest = facts.chapterLengths.find((chapter) => chapter.length === lengths[lengths.length - 1]);
  return `章字数：最短 ${lengths[0]} 字（第 ${shortest?.index ?? 0} 章 ${shortest?.title ?? ""}）、中位 ${median(lengths)} 字、最长 ${lengths[lengths.length - 1]} 字（第 ${longest?.index ?? 0} 章 ${longest?.title ?? ""}）。`;
}

/**
 * 第 4 段后半：疑似合并章——按章正文长度与中位数的**同一倍数阈值**（`SPLIT_LONG_BLOCK_FACTOR`）重新判定
 * （切分阶段的警告不落库、S3 时也没有原文可重切 ⇒ 只能按章节字数重导，
 * 与切分阶段基于段长的判定可能略有差异；口径写进报告，不静默）。
 */
function longChapterLine(facts: DecomposeReportFacts): string {
  const lengths = facts.chapterLengths.map((chapter) => chapter.length).sort((left, right) => left - right);
  if (lengths.length === 0) {
    return `疑似合并章：无（判据：章正文长度 > 中位数 × ${SPLIT_LONG_BLOCK_FACTOR}）。`;
  }
  const threshold = median(lengths) * SPLIT_LONG_BLOCK_FACTOR;
  const suspected = facts.chapterLengths.filter((chapter) => chapter.length > threshold);
  const criterion = `判据：章正文长度 > 中位数 × ${SPLIT_LONG_BLOCK_FACTOR}（与切分阶段的判定可能略有差异）`;
  return suspected.length === 0
    ? `疑似合并章：无（${criterion}）。`
    : `疑似合并章：${suspected.map((chapter) => `第 ${chapter.index} 章 ${chapter.title}（${chapter.length} 字）`).join("、")}（${criterion}）。`;
}

function aliasGroupLine(group: ReportAliasGroup): string {
  const reason = group.reason === "" ? "" : `（依据：${group.reason}）`;
  return `- ${group.canonical} ← ${group.aliases.join("、")}${reason}`;
}

function listOrNone(items: readonly string[]): string {
  return items.length === 0 ? "无" : items.join("、");
}

/** 中位数（偶数个取中间两数均值；与切分预览的 stats.median 同口径） */
function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
