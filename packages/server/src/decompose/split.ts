// 章节切分（拆解 S0 解析层）。
// 契约：docs/design/60-decompose.md §3——四层 = 归一化（编码探测 + 换行归一）→ 候选扫描 →
// 聚合校验与修复（规则融合 + 结构性评分 / 相邻重复合并 / 微段修复 / 超长块回扫 / 卷首目录页启发式）→ 退化等分。
// 纯函数、无 IO：字节入口 splitNovel 接受 Uint8Array，其余全部在字符串上工作。
// 阈值单一定义在本模块并导出；散文与注释只引用常量名，不复述数字。

/** 标题行长度上限（strip 后）：实测样本的合法标题都远短于此，超限候选为 0 ⇒ 只保留长度护栏 */
export const SPLIT_TITLE_MAX_CHARS = 40;
/** 相邻重复标题合并的最大间距（实测形态 = 裸行标题紧跟缩进的同名行） */
export const SPLIT_DUP_MERGE_CHARS = 60;
/** 微段修复阈值（同时是退化路径的中位段长下限） */
export const SPLIT_MIN_SEGMENT_CHARS = 200;
/** 判「有章节结构」所需的最少候选数 */
export const SPLIT_MIN_CHAPTERS = 5;
/** 超长块判定系数：段长 > 该系数 × 中位段长 ⇒ 回扫补漏 */
export const SPLIT_LONG_BLOCK_FACTOR = 3;
/** 目录页判定：连续命中数下限 */
export const SPLIT_TOC_RUN_MIN = 6;
/** 目录页判定：单节长度上限 */
export const SPLIT_TOC_SEGMENT_CHARS = 120;
/** 退化等分的每份目标字数 */
export const SPLIT_FALLBACK_TARGET_CHARS = 4000;
/** 分卷时卷标记数上限（超出 ⇒ 单卷「全书」兜底） */
export const SPLIT_MAX_VOLUMES = 30;

/** 编码探测结果（api/120-api-decompose.md §analyze 的 encoding） */
export type NovelEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "gb18030";

/** 警告码（与 api/120-api-decompose.md 的 warnings 表逐字一致） */
export const SPLIT_WARNING_CODES = [
  "NUMBERING_RESTART",
  "LONG_BLOCK",
  "DUPLICATE_MERGED",
  "TOC_DROPPED",
  "FALLBACK_EQUAL_SPLIT",
] as const;
export type SplitWarningCode = (typeof SPLIT_WARNING_CODES)[number];

export interface SplitWarning {
  code: SplitWarningCode;
  message: string;
}

/** 章（文件位置序）；charCount = 该段原文（含标题行）的字数——**近似计数，不是切片长**（§3.4） */
export interface SplitChapter {
  index: number;
  title: string;
  charCount: number;
  volumeIndex: number;
}

/**
 * 章原文切片：归一化文本上的真实偏移 `[start, end)`（含标题行）。
 * 消费方要裁章文本必须用它，**不得拿 `charCount` 当偏移量**（近似计数：正常路径 trim 掉分隔换行、
 * 退化路径不含空行分隔符 ⇒ 当偏移量会错位或丢字符，§3.4）。
 */
export interface SplitChapterSlice {
  index: number;
  title: string;
  start: number;
  end: number;
}

/** 切分结果 + 切片几何（`text` = 归一化文本，切片即其上的偏移） */
export interface SplitWithSlices {
  result: SplitResult;
  text: string;
  slices: SplitChapterSlice[];
}

export interface SplitVolume {
  index: number;
  title: string;
}

export interface SplitStats {
  min: number;
  median: number;
  max: number;
}

export interface SplitResult {
  encoding: NovelEncoding;
  totalChars: number;
  chapters: SplitChapter[];
  volumes: SplitVolume[];
  stats: SplitStats;
  warnings: SplitWarning[];
}

/** 单卷兜底（root 仅接纳卷、章只能挂卷 ⇒ 无卷标记时也必须有一卷） */
const SINGLE_VOLUME: SplitVolume = { index: 0, title: "全书" };
/** 首个章标记之前的内容成章（作者自述/简介/水印，参与抽取） */
const PREAMBLE_TITLE = "前言";
/** 评分维度数：序号连续性 / 长度均匀度 / 数量合理性 / marker 一致性 / 覆盖率（等权） */
const SCORE_DIMENSIONS = 5;

// ── 第一层 · 归一化 ────────────────────────────────────────────────────────────

const BOM_UTF8 = [0xef, 0xbb, 0xbf];
const BOM_UTF16LE = [0xff, 0xfe];
const BOM_UTF16BE = [0xfe, 0xff];

function startsWithBytes(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, position) => bytes[position] === byte);
}

function decode(bytes: Uint8Array, encoding: string, fatal = false): string {
  return new TextDecoder(encoding, { fatal }).decode(bytes);
}

/**
 * 字节层：BOM 探测（UTF-8 / UTF-16LE / UTF-16BE）→ 严格 UTF-8 解码（fatal）→ 失败回退 GB18030。
 * 实测样本是 GB18030（`file` 判为 ISO-8859），按 UTF-8 直读必乱码。TextDecoder 原生支持，不引入依赖。
 */
export function decodeNovel(bytes: Uint8Array): { encoding: NovelEncoding; text: string } {
  if (startsWithBytes(bytes, BOM_UTF8)) return { encoding: "utf-8-bom", text: decode(bytes, "utf-8") };
  if (startsWithBytes(bytes, BOM_UTF16LE)) return { encoding: "utf-16le", text: decode(bytes, "utf-16le") };
  if (startsWithBytes(bytes, BOM_UTF16BE)) return { encoding: "utf-16be", text: decode(bytes, "utf-16be") };
  try {
    return { encoding: "utf-8", text: decode(bytes, "utf-8", true) };
  } catch {
    return { encoding: "gb18030", text: decode(bytes, "gb18030") };
  }
}

/** 文本层：换行归一（CRLF / CR / NEL / U+2028 / U+2029 → \n）、去 BOM、行尾空白清理 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n|[\r\u0085\u2028\u2029]/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u3000]+$/u, ""))
    .join("\n")
    .trim();
}

// ── 第二层 · 候选扫描 ─────────────────────────────────────────────────────────

type ChapterRuleId = "zhang" | "hui" | "jie" | "keyword" | "english";

/** 编号数字：阿拉伯数字 + 中文数字（含「两」「〇」） */
const NUMBER_TOKEN = "[0-9〇零一二三四五六七八九十百千两]+";

interface ChapterRuleSpec {
  id: ChapterRuleId;
  /** 标记本体（行首锚由 line 提供，行内匹配由 inline 提供） */
  source: string;
  line: RegExp;
  inline: RegExp;
}

function chapterRule(id: ChapterRuleId, source: string, flags = ""): ChapterRuleSpec {
  return { id, source, line: new RegExp(`^\\s*${source}`, flags), inline: new RegExp(source, `${flags}g`) };
}

/** 模式表按优先级：章/回/节 → 卷（单独扫描）→ 前置关键词 → 英文章节 */
const CHAPTER_RULES: ChapterRuleSpec[] = [
  chapterRule("zhang", `第\\s*(${NUMBER_TOKEN})\\s*章`),
  chapterRule("hui", `第\\s*(${NUMBER_TOKEN})\\s*回`),
  chapterRule("jie", `第\\s*(${NUMBER_TOKEN})\\s*节`),
  chapterRule("keyword", "(序章|楔子|前言|引子|尾声|终章|后记|番外|外传|附录)"),
  chapterRule("english", "((?:chapter|section)\\s+(?:[0-9]+|[ivxlcdm]+))", "i"),
  // 「数字编号式」(`1. 标题`) 有意不作规则：实测命中全是正文列表项（`1，同行者：…`），0 真阳——不要顺手加上
];

const VOLUME_LINE_PATTERN = new RegExp(`^\\s*第\\s*(${NUMBER_TOKEN})\\s*(卷|部|篇)`);

/**
 * 计数词歧义排除：「第三部分 / 第三节课 / 第三部队 / 第三集合」这类「第 N + 计数词」不是标记。
 * 只在后续字紧跟标记字（无间隔）时排除，正常标题（`第一章 相遇`）不受影响。
 */
const AMBIGUOUS_FOLLOWER_CHARS = new Set(["分", "课", "队", "合"]);

const CHINESE_DIGITS: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CHINESE_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 编号解析：仅用于提示与评分，永不参与排序 */
function parseNumberToken(token: string): number | null {
  if (/^[0-9]+$/.test(token)) return Number(token);
  let total = 0;
  let digit: number | null = null;
  for (const char of token) {
    const plain = CHINESE_DIGITS[char];
    if (plain !== undefined) {
      digit = plain;
      continue;
    }
    const unit = CHINESE_UNITS[char];
    if (unit === undefined) return null;
    total += (digit ?? 1) * unit;
    digit = null;
  }
  return total + (digit ?? 0);
}

/** 文本索引：行 + 行首偏移（段长与切片都按这里算） */
interface TextIndex {
  text: string;
  lines: string[];
  starts: number[];
}

function indexText(text: string): TextIndex {
  const lines = text.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return { text, lines, starts };
}

interface ChapterCandidate {
  rule: ChapterRuleId;
  number: number | null;
  lineIndex: number;
  /** 段起点 = 该行行首偏移 */
  start: number;
  title: string;
  /** 归一化原始行（去掉全部空白）——相邻重复合并用（编号参与比较，「第一章 相遇/第二章 相遇」不算重复） */
  key: string;
}

interface VolumeMarker {
  start: number;
  title: string;
}

/** 分隔符（编号与标题之间）+ 前导全角空格 */
const TITLE_SEPARATOR = /^[\s\u3000:：、,.，。\-—]+/u;

/** 标题清洗：去编号前缀与前导全角空格；剥离后为空 → 保留原文行（如「第三十四章」） */
function cleanTitle(line: string, markerEnd: number): string {
  const rest = line.slice(markerEnd).replace(TITLE_SEPARATOR, "").trim();
  return rest.length > 0 ? rest : line.trim();
}

interface RuleMatch {
  number: number | null;
  end: number;
}

function matchChapterRule(line: string, spec: ChapterRuleSpec): RuleMatch | null {
  const match = spec.line.exec(line);
  if (!match) return null;
  const end = match[0].length;
  const numbered = spec.id !== "keyword" && spec.id !== "english";
  if (numbered && AMBIGUOUS_FOLLOWER_CHARS.has(line[end] ?? "")) return null;
  const token = spec.id === "keyword" ? null : match[1];
  return { number: token === null ? null : parseNumberToken(token), end };
}

/**
 * 逐行扫描：只考虑 strip 后长度 ≤ SPLIT_TITLE_MAX_CHARS 的行（实测校准：不加标点护栏——合法标题以标点结尾极常见；
 * 也不引入全角缩进判据——正文普遍缩进，重复标题改由相邻重复合并处理）。
 * 同行既匹配卷又匹配章 → 按卷处理（卷优先）。
 */
function scanMarkers(index: TextIndex): { candidates: ChapterCandidate[]; volumes: VolumeMarker[] } {
  const candidates: ChapterCandidate[] = [];
  const volumes: VolumeMarker[] = [];
  index.lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > SPLIT_TITLE_MAX_CHARS) return;
    const start = index.starts[lineIndex];
    const key = trimmed.replace(/\s/gu, "");
    const volume = VOLUME_LINE_PATTERN.exec(line);
    if (volume && !AMBIGUOUS_FOLLOWER_CHARS.has(line[volume[0].length] ?? "")) {
      volumes.push({ start, title: cleanTitle(line, volume[0].length) });
      return;
    }
    for (const spec of CHAPTER_RULES) {
      const match = matchChapterRule(line, spec);
      if (!match) continue;
      candidates.push({ rule: spec.id, number: match.number, lineIndex, start, title: cleanTitle(line, match.end), key });
      return;
    }
  });
  return { candidates, volumes };
}

// ── 第三层 · 规则融合 + 结构性评分 ────────────────────────────────────────────

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 序号连续性：编号已知的相邻候选里严格递增的比例 */
function numberingContinuity(candidates: ChapterCandidate[]): number {
  const numbers = candidates.map((candidate) => candidate.number).filter((number): number is number => number !== null);
  if (numbers.length < 2) return 0;
  let increasing = 0;
  for (let position = 1; position < numbers.length; position++) {
    if (numbers[position] > numbers[position - 1]) increasing++;
  }
  return increasing / (numbers.length - 1);
}

/** 长度均匀度：1 - 变异系数（段长越均匀越接近 1） */
function lengthUniformity(lengths: number[]): number {
  const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  if (mean === 0) return 0;
  const variance = lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) / lengths.length;
  return clamp01(1 - Math.sqrt(variance) / mean);
}

function scoreCandidates(
  own: ChapterCandidate[],
  allCount: number,
  index: TextIndex,
  totalChars: number,
): number {
  const lengths = segmentLengths(index, own);
  const coverage = lengths.reduce((sum, length) => sum + length, 0) / totalChars;
  return (
    numberingContinuity(own) +
    lengthUniformity(lengths) +
    // 数量合理性：达到 SPLIT_MIN_CHAPTERS 即饱和
    clamp01(own.length / SPLIT_MIN_CHAPTERS) +
    // marker 一致性：该规则命中占全部章标记命中的比例（中文计数词混排 ⇒ 低分）
    own.length / allCount +
    clamp01(coverage)
  ) / SCORE_DIMENSIONS;
}

/**
 * 规则融合第一步：章/回/节/关键词/英文各自切一遍，按结构性评分选最优主规则。
 * 中文小说的计数词不固定（这本用「章」、那本用「回」），单条规则调参必然在某类书上翻车。
 * 同分取模式表先者（严格大于才替换）。
 */
function pickChapterRule(candidates: ChapterCandidate[], index: TextIndex, totalChars: number): ChapterRuleSpec {
  const scores = CHAPTER_RULES.map((spec) => {
    const own = candidates.filter((candidate) => candidate.rule === spec.id);
    return { spec, score: own.length === 0 ? 0 : scoreCandidates(own, candidates.length, index, totalChars) };
  });
  return scores.reduce((best, current) => (current.score > best.score ? current : best), scores[0]).spec;
}

// ── 段几何 ───────────────────────────────────────────────────────────────────

function segmentEnd(index: TextIndex, candidates: ChapterCandidate[], position: number): number {
  return position + 1 < candidates.length ? candidates[position + 1].start : index.text.length;
}

function segmentLength(index: TextIndex, from: number, to: number): number {
  return index.text.slice(from, to).trim().length;
}

function segmentLengths(index: TextIndex, candidates: ChapterCandidate[]): number[] {
  return candidates.map((candidate, position) => segmentLength(index, candidate.start, segmentEnd(index, candidates, position)));
}

// ── 第三层 · 聚合校验与修复 ───────────────────────────────────────────────────

/** 相邻重复合并：相邻候选归一化后相同且间距 < SPLIT_DUP_MERGE_CHARS → 合并（取后者为起点） */
function mergeAdjacentDuplicates(
  index: TextIndex,
  candidates: ChapterCandidate[],
): { kept: ChapterCandidate[]; merged: number } {
  const kept: ChapterCandidate[] = [];
  let merged = 0;
  for (const candidate of candidates) {
    const previous = kept[kept.length - 1];
    if (previous && previous.key === candidate.key && segmentLength(index, previous.start, candidate.start) < SPLIT_DUP_MERGE_CHARS) {
      kept[kept.length - 1] = candidate;
      merged++;
      continue;
    }
    kept.push(candidate);
  }
  return { kept, merged };
}

/** 卷首目录页启发式：连续 ≥ SPLIT_TOC_RUN_MIN 个命中且每节 < SPLIT_TOC_SEGMENT_CHARS → 判目录页丢弃 */
function dropTocRuns(index: TextIndex, candidates: ChapterCandidate[]): { kept: ChapterCandidate[]; dropped: number } {
  const lengths = segmentLengths(index, candidates);
  const dropped = new Set<number>();
  let runStart = 0;
  while (runStart < candidates.length) {
    let runEnd = runStart;
    while (runEnd < candidates.length && lengths[runEnd] < SPLIT_TOC_SEGMENT_CHARS) runEnd++;
    if (runEnd - runStart >= SPLIT_TOC_RUN_MIN) {
      for (let position = runStart; position < runEnd; position++) dropped.add(position);
    }
    runStart = Math.max(runEnd, runStart + 1);
  }
  return { kept: candidates.filter((_, position) => !dropped.has(position)), dropped: dropped.size };
}

/**
 * 微段修复：间距 < SPLIT_MIN_SEGMENT_CHARS → 并入前一段（该候选判误命中丢弃，其文本随前一段），
 * 并入后仍过短 → 继续上溯同类候选一并丢弃。段尾到文件末同理。文本不丢：只丢切点。
 */
function repairMicroSegments(index: TextIndex, candidates: ChapterCandidate[]): ChapterCandidate[] {
  const kept: ChapterCandidate[] = [];
  for (const candidate of candidates) {
    while (kept.length > 0 && segmentLength(index, kept[kept.length - 1].start, candidate.start) < SPLIT_MIN_SEGMENT_CHARS) {
      kept.pop();
    }
    kept.push(candidate);
  }
  while (kept.length > 0 && segmentLength(index, kept[kept.length - 1].start, index.text.length) < SPLIT_MIN_SEGMENT_CHARS) {
    kept.pop();
  }
  return kept;
}

interface ChapterBlock {
  title: string;
  start: number;
  end: number;
}

function buildBlocks(index: TextIndex, candidates: ChapterCandidate[]): ChapterBlock[] {
  return candidates.map((candidate, position) => ({
    title: candidate.title,
    start: candidate.start,
    end: segmentEnd(index, candidates, position),
  }));
}

function blockLength(index: TextIndex, block: ChapterBlock): number {
  return segmentLength(index, block.start, block.end);
}

/**
 * 超长块回扫：段长 > SPLIT_LONG_BLOCK_FACTOR × 中位段长 → 用更宽松的规则（允许行内出现、任意缩进）回扫补漏。
 * 补不到不静默处理：降级为预览里的「疑似合并章」提示。
 */
function splitLongBlock(index: TextIndex, block: ChapterBlock, spec: ChapterRuleSpec): ChapterBlock[] {
  const firstBreak = index.text.indexOf("\n", block.start);
  if (firstBreak === -1 || firstBreak >= block.end) return [block];
  const bodyStart = firstBreak + 1;
  const cuts: ChapterBlock[] = [];
  for (const match of index.text.slice(bodyStart, block.end).matchAll(spec.inline)) {
    const markerStart = bodyStart + (match.index ?? 0);
    if (AMBIGUOUS_FOLLOWER_CHARS.has(index.text[markerStart + match[0].length] ?? "")) continue;
    const lineStart = index.text.lastIndexOf("\n", markerStart) + 1;
    const breakAfter = index.text.indexOf("\n", markerStart);
    const lineEnd = breakAfter === -1 || breakAfter > block.end ? block.end : breakAfter;
    const title = cleanTitle(index.text.slice(lineStart, lineEnd), markerStart - lineStart + match[0].length);
    cuts.push({ title, start: markerStart, end: block.end });
  }
  if (cuts.length === 0) return [block];
  return [
    { ...block, end: cuts[0].start },
    ...cuts.map((cut, position) => ({ ...cut, end: cuts[position + 1]?.start ?? block.end })),
  ];
}

function rescanLongBlocks(
  index: TextIndex,
  blocks: ChapterBlock[],
  spec: ChapterRuleSpec,
  /** 章号位移：警告里的章号 = 该章在返回 chapters 里的 index（「前言」章插到首位时为 1） */
  chapterOffset: number,
): { blocks: ChapterBlock[]; warnings: SplitWarning[] } {
  if (blocks.length === 0) return { blocks, warnings: [] };
  const median = statsOf(blocks.map((block) => blockLength(index, block))).median;
  const threshold = SPLIT_LONG_BLOCK_FACTOR * median;
  const warnings: SplitWarning[] = [];
  const output: ChapterBlock[] = [];
  blocks.forEach((block, position) => {
    if (blockLength(index, block) <= threshold) {
      output.push(block);
      return;
    }
    // 关键词规则不做行内回扫：关键词可出现在正文里（「前言不搭后语」），错拆比提示更糟
    const found = spec.id === "keyword" ? [block] : splitLongBlock(index, block, spec);
    if (found.length > 1) {
      output.push(...found);
      return;
    }
    warnings.push({
      code: "LONG_BLOCK",
      message: `第 ${position + chapterOffset + 1} 章「${block.title}」疑似合并章：长度超过中位段长的 ${SPLIT_LONG_BLOCK_FACTOR} 倍且块内未找到章标记`,
    });
    output.push(block);
  });
  return { blocks: output, warnings };
}

/** 编号校验只产提示（非递增点计数）；编号永不参与排序——章序 = 文件位置序 */
function countNumberingRestarts(candidates: ChapterCandidate[]): number {
  let restarts = 0;
  let previous: number | null = null;
  for (const candidate of candidates) {
    if (candidate.number === null) continue;
    if (previous !== null && candidate.number <= previous) restarts++;
    previous = candidate.number;
  }
  return restarts;
}

// ── 第四层 · 退化等分 ────────────────────────────────────────────────────────

/** 装箱单元（段落 / 行）：`length` = 计数口径（charCount 的近似来源），`start`/`end` = 真实位置 */
interface TextBlock {
  length: number;
  start: number;
  end: number;
}

/** 段落边界（空行）优先于换行：拆出装箱单元（计数与位置都来自同一遍扫描，不再分头算） */
function fallbackBlocks(text: string): TextBlock[] {
  const paragraphs: TextBlock[] = [];
  const separator = /\n{2,}/g;
  let cursor = 0;
  for (let match = separator.exec(text); match !== null; match = separator.exec(text)) {
    paragraphs.push({ length: match.index - cursor, start: cursor, end: match.index });
    cursor = match.index + match[0].length;
  }
  paragraphs.push({ length: text.length - cursor, start: cursor, end: text.length });
  const blocks: TextBlock[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= SPLIT_FALLBACK_TARGET_CHARS) {
      blocks.push(paragraph);
      continue;
    }
    // 超长段落再按行拆：行位置在段落内按行长 + 1 个换行符累加
    let lineStart = paragraph.start;
    for (const line of text.slice(paragraph.start, paragraph.end).split("\n")) {
      blocks.push({ length: line.length, start: lineStart, end: lineStart + line.length });
      lineStart += line.length + 1;
    }
  }
  return blocks;
}

/**
 * 退化等分的每份（段落边界优先于换行；贪心装箱到 SPLIT_FALLBACK_TARGET_CHARS）：
 * `length` = 计数（charCount，与旧实现逐字同口径），`start`/`end` = 真实切片位置。
 * 两者在退化路径上**本来就不等**（计数不含空行分隔符，§3.4）——切片按位置、计数按旧口径。
 */
function fallbackParts(text: string): TextBlock[] {
  const parts: TextBlock[] = [];
  let size = 0;
  let start = 0;
  let end = 0;
  for (const block of fallbackBlocks(text)) {
    if (size >= SPLIT_FALLBACK_TARGET_CHARS) {
      parts.push({ length: size, start, end });
      size = 0;
    }
    // 分隔换行只存在于块之间：每份的首块不补换行，否则末尾会多出 1 个并不存在的字符（charCount > totalChars）
    if (size === 0) {
      start = block.start;
      size = block.length;
    } else {
      size += block.length + 1;
    }
    end = block.end;
  }
  if (size > 0) parts.push({ length: size, start, end });
  // 切片首尾相接：每份的 `end` 取下一份的 `start`（块之间的空行分隔符归前一份——
  // 与正常路径「切片到下一章起点」同口径），否则份与份之间的分隔符会落在所有切片之外。
  for (let position = 0; position < parts.length - 1; position++) {
    parts[position].end = parts[position + 1].start;
  }
  return parts;
}

function fallbackEqualSplit(text: string, encoding: NovelEncoding): { result: SplitResult; blocks: ChapterBlock[] } {
  const parts = fallbackParts(text);
  const blocks: ChapterBlock[] = parts.map((part, position) => ({
    title: `第${position + 1}部分`,
    start: part.start,
    end: part.end,
  }));
  const chapters: SplitChapter[] = parts.map((part, position) => ({
    index: position + 1,
    title: blocks[position].title,
    charCount: part.length,
    volumeIndex: 0,
  }));
  return {
    result: {
      encoding,
      totalChars: text.length,
      chapters,
      volumes: [SINGLE_VOLUME],
      stats: statsOf(chapters.map((chapter) => chapter.charCount)),
      warnings: [
        {
          code: "FALLBACK_EQUAL_SPLIT",
          message: `未检测到章节结构，已按字数等分（每份约 ${SPLIT_FALLBACK_TARGET_CHARS} 字）`,
        },
      ],
    },
    blocks,
  };
}

// ── 汇总 ─────────────────────────────────────────────────────────────────────

function statsOf(counts: number[]): SplitStats {
  if (counts.length === 0) return { min: 0, median: 0, max: 0 };
  const sorted = [...counts].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { min: sorted[0], median, max: sorted[sorted.length - 1] };
}

/** 卷判定：卷标记数 ∈ [2, SPLIT_MAX_VOLUMES] → 分卷，否则单卷「全书」 */
function buildVolumes(markers: VolumeMarker[]): SplitVolume[] {
  if (markers.length < 2 || markers.length > SPLIT_MAX_VOLUMES) return [SINGLE_VOLUME];
  return markers.map((marker, position) => ({ index: position, title: marker.title }));
}

function volumeIndexOf(start: number, volumes: SplitVolume[], markers: VolumeMarker[]): number {
  if (volumes.length <= 1) return 0;
  return Math.max(markers.filter((marker) => marker.start <= start).length - 1, 0);
}

function splitMarkedText(
  index: TextIndex,
  markers: { candidates: ChapterCandidate[]; volumes: VolumeMarker[] },
  encoding: NovelEncoding,
): { result: SplitResult; blocks: ChapterBlock[] } {
  const text = index.text;
  const spec = pickChapterRule(markers.candidates, index, text.length);
  // 规则融合第二步：关键词标记（序章/楔子/…）不参与计数词竞争，确定性并入主规则
  const selected = markers.candidates.filter((candidate) => candidate.rule === spec.id || candidate.rule === "keyword");

  const warnings: SplitWarning[] = [];
  const deduped = mergeAdjacentDuplicates(index, selected);
  if (deduped.merged > 0) {
    warnings.push({ code: "DUPLICATE_MERGED", message: `相邻重复标题合并 ${deduped.merged} 处` });
  }
  // 目录页判定必须早于微段修复：目录条目本来就短，晚判会被当误命中并掉，TOC_DROPPED 永不触发
  const withoutToc = dropTocRuns(index, deduped.kept);
  if (withoutToc.dropped > 0) {
    warnings.push({ code: "TOC_DROPPED", message: `丢弃了 ${withoutToc.dropped} 段作为目录页` });
  }
  const repaired = repairMicroSegments(index, withoutToc.kept);
  // 首个块起点在回扫前后不变（回扫只改块的 end）⇒ 提前判「前言」章，供回扫警告预留章号位移
  const firstStart = repaired[0]?.start ?? 0;
  const withPreamble = firstStart > 0 && segmentLength(index, 0, firstStart) > 0;
  const rescanned = rescanLongBlocks(index, buildBlocks(index, repaired), spec, withPreamble ? 1 : 0);
  warnings.push(...rescanned.warnings);

  const lengths = rescanned.blocks.map((block) => blockLength(index, block));
  if (rescanned.blocks.length < SPLIT_MIN_CHAPTERS || statsOf(lengths).median < SPLIT_MIN_SEGMENT_CHARS) {
    return fallbackEqualSplit(text, encoding);
  }

  const restarts = countNumberingRestarts(repaired);
  if (restarts > 0) {
    warnings.push({ code: "NUMBERING_RESTART", message: `检测到 ${restarts} 处编号重启，疑似多卷` });
  }

  const volumes = buildVolumes(markers.volumes);
  const blocks = withPreamble
    ? [{ title: PREAMBLE_TITLE, start: 0, end: firstStart }, ...rescanned.blocks]
    : rescanned.blocks;
  const chapters = blocks.map((block, position) => ({
    index: position + 1,
    title: block.title,
    charCount: blockLength(index, block),
    volumeIndex: volumeIndexOf(block.start, volumes, markers.volumes),
  }));
  return {
    result: {
      encoding,
      totalChars: text.length,
      chapters,
      volumes,
      stats: statsOf(chapters.map((chapter) => chapter.charCount)),
      warnings,
    },
    blocks,
  };
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

/**
 * 切分小说原始字节 + **章原文切片**：解码 → 归一化 → 候选扫描 → 聚合校验与修复 → 退化等分（纯函数，无 IO）。
 * `slices` 与 `result.chapters` 同序同源（同一份块几何）——S1 导入正文按切片裁文本（§3.4：不得用 charCount）。
 */
export function splitNovelWithSlices(bytes: Uint8Array): SplitWithSlices {
  const { encoding, text: decoded } = decodeNovel(bytes);
  const text = normalizeText(decoded);
  const index = indexText(text);
  if (text.length === 0) {
    return {
      result: { encoding, totalChars: 0, chapters: [], volumes: [SINGLE_VOLUME], stats: { min: 0, median: 0, max: 0 }, warnings: [] },
      text,
      slices: [],
    };
  }
  const { result, blocks } = splitMarkedText(index, scanMarkers(index), encoding);
  return {
    result,
    text,
    slices: blocks.map((block, position) => ({
      index: position + 1,
      title: block.title,
      start: block.start,
      end: block.end,
    })),
  };
}

/** 切分小说原始字节（切分结果本身；切片见 `splitNovelWithSlices`——纯函数，无 IO） */
export function splitNovel(bytes: Uint8Array): SplitResult {
  return splitNovelWithSlices(bytes).result;
}
