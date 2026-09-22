#!/usr/bin/env node
// 批大小实测 harness（卡 3 · dev-only，不入 src）
//
// 目的：用同一模型、同一 S2 提示词与同一 Agent 调用路径（`dist/decompose/llm.js`）跑四档批大小，
// 对比墙钟 / token / 失败与截断 / 抽取完整性，为 `DECOMPOSE_BATCH_TARGET_CHARS` 的保持或上调
// 提供实测依据（docs/design/60-decompose.md §4 组批）。
//
// 用法：
//   node scripts/decompose-batch-experiment.mjs run --tier current|2x|4x|full [--limit N]
//   node scripts/decompose-batch-experiment.mjs report
//
// 四档（数值不复刻常量）：
//   current = `planBatches` 真实现（target / 章数上限直接读 dist 常量）；
//   2x / 4x  = 本文件同款贪心装箱按 target 参数化（启动时断言与真实现逐字一致）；
//   full     = 全部章一个批（不看 target）。
//
// 口径与 dev-only 简化（写进报告）：
// - 「批大小」这个变量单独隔离：项目数据快照一律为空、不做跨批累积（无 db；快照是独立课题，§4.1）；
// - 提示词与每批固定开销直接引用生产实现（`buildBatchPrompt` / `batchOverheadTokensUpperBound`）——单一来源，不复制措辞；
// - 逐批串行、整批重试 ≤ `DECOMPOSE_BATCH_MAX_ATTEMPTS`（与生产同：缺章 → 重试 → 失败继续后续批）；
// - 模型 = pi 设置里的默认模型（`resolveActiveSelection`，与生产同源），出站走生产同款 undici dispatcher。
//
// 存量工件的口径：`references/decompose-batch-experiment/*.json` 产生于**旧措辞 system 提示**（「source / target 必须是
// 本章或上文出现过的名字」）+ 空快照；复测 = 重跑本 harness（自动改用生产措辞）。旧措辞压制跨批端点 ⇒
// 实测落差对生产语义偏保守（判定不变）。
//
// 产物（gitignored）：`references/decompose-batch-experiment/` 各档原始 JSON + 对比报告 + 盲评材料；
// 会话与临时文件：`/tmp/opencode/decompose-card3-run/<tier>/`。

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { projectSessionsDir } from "../packages/agent/dist/index.js";
import {
  DECOMPOSE_BATCH_MAX_CHAPTERS,
  DECOMPOSE_BATCH_TARGET_CHARS,
  planBatches,
} from "../packages/server/dist/decompose/batching.js";
import { normalizeExtraction } from "../packages/server/dist/decompose/extract.js";
import {
  DECOMPOSE_BATCH_MAX_ATTEMPTS,
  batchOverheadTokensUpperBound,
  buildBatchPrompt,
} from "../packages/server/dist/decompose/runner.js";
import { DECOMPOSE_MENTION_MIN_CHAPTERS } from "../packages/server/dist/decompose/merge.js";
import { decomposeSessionId, openDecomposeSession, parseModelJson } from "../packages/server/dist/decompose/llm.js";
import { splitNovelWithSlices } from "../packages/server/dist/decompose/split.js";
import { applyHttpProxySettings, configureHttpDispatcher } from "../packages/server/dist/http-dispatcher.js";
import { getModelRuntime, getSettingsManager, resolveActiveSelection } from "../packages/server/dist/model-runtime.js";
import { DECOMPOSE_CHARS_PER_TOKEN, DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER } from "../packages/server/dist/routes/decompose.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOK_PATH = join(repoRoot, "references", "三少爷的剑.txt");
const ARTIFACT_DIR = join(repoRoot, "references", "decompose-batch-experiment");
const DEFAULT_RUN_DIR = "/tmp/opencode/decompose-card3-run";

const BOOK_NAME = "三少爷的剑";

/** 四档定义：label + target 字数 + 单批章数上限（full = 全书一批，两者都是 Infinity） */
const TIER_SPECS = {
  current: { label: "当前值", targetChars: DECOMPOSE_BATCH_TARGET_CHARS, maxChapters: DECOMPOSE_BATCH_MAX_CHAPTERS },
  "2x": { label: "2×", targetChars: DECOMPOSE_BATCH_TARGET_CHARS * 2, maxChapters: DECOMPOSE_BATCH_MAX_CHAPTERS },
  "4x": { label: "4×", targetChars: DECOMPOSE_BATCH_TARGET_CHARS * 4, maxChapters: DECOMPOSE_BATCH_MAX_CHAPTERS },
  full: { label: "全文一批", targetChars: Number.POSITIVE_INFINITY, maxChapters: Number.POSITIVE_INFINITY },
};

// ── 组批 ─────────────────────────────────────────────────────────────────────

/**
 * 参数化贪心装箱：与生产 `planBatches`（batching.ts）同款规则，只是 target / 章数上限可传参。
 * `planForTier(current)` 走真实现；2× / 4× 走本函数——启动时断言两者在 current 参数下逐字一致。
 */
function packBatches(chapters, targetChars, maxChapters) {
  const batches = [];
  for (const chapter of chapters) {
    const current = batches[batches.length - 1];
    if (
      current !== undefined &&
      current.chapterIndexes.length < maxChapters &&
      current.charCount + chapter.charCount <= targetChars
    ) {
      current.chapterIndexes.push(chapter.index);
      current.charCount += chapter.charCount;
      continue;
    }
    batches.push({ chapterIndexes: [chapter.index], charCount: chapter.charCount });
  }
  return batches;
}

/** 自检：参数化装箱在 current 参数下必须与生产 `planBatches` 逐字一致（否则实测口径失真） */
function assertPackerMatchesProduction(chapters) {
  const production = JSON.stringify(planBatches(chapters));
  const harness = JSON.stringify(packBatches(chapters, DECOMPOSE_BATCH_TARGET_CHARS, DECOMPOSE_BATCH_MAX_CHAPTERS));
  if (production !== harness) throw new Error("harness 装箱与生产 planBatches 不一致——实测口径失真，停止运行");
}

function planForTier(chapters, tier) {
  const spec = TIER_SPECS[tier];
  if (tier === "current") return planBatches(chapters);
  return packBatches(chapters, spec.targetChars, spec.maxChapters);
}

// ── 素材 ─────────────────────────────────────────────────────────────────────

/** 读样本 → `split.ts` 真实现切章 → 章文本取归一化文本上的切片（不得拿 charCount 当偏移量） */
function loadChapters() {
  const { result, text, slices } = splitNovelWithSlices(new Uint8Array(readFileSync(BOOK_PATH)));
  const sliceByIndex = new Map(slices.map((slice) => [slice.index, slice]));
  const chapters = result.chapters.map((chapter) => {
    const slice = sliceByIndex.get(chapter.index);
    if (slice === undefined) throw new Error(`切分结果缺第${chapter.index}章的切片`);
    return { index: chapter.index, title: chapter.title, charCount: chapter.charCount, text: text.slice(slice.start, slice.end) };
  });
  return { result, chapters };
}

// ── 跑一档 ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** 失败分类（报告按类计数；文案判据只做 dev-only 归因，不承担业务语义） */
function classifyError(message) {
  if (message.includes("缺章")) return "missing_chapters";
  if (message.includes("JSON")) return "json_parse";
  if (message.includes("模型调用失败") || message.includes("assistant")) return "provider";
  return "other";
}

/**
 * 一批执行（与生产 runBatch 同形：整批重试 ≤ `DECOMPOSE_BATCH_MAX_ATTEMPTS`，缺章是最常见败因）。
 * 返回本批记录：成功带归一结果与原始文本，失败带最后一次错误（失败尝试拿不到 usage——llm.ts 抛错即丢）。
 */
async function runBatch({ session, batch, chapters, seq, maxTokens }) {
  const startedMs = Date.now();
  const attempts = [];
  const chapterIndexes = batch.chapterIndexes;
  const prompt = buildBatchPrompt({ chapters, snapshotText: "" });
  for (let attempt = 1; attempt <= DECOMPOSE_BATCH_MAX_ATTEMPTS; attempt++) {
    const attemptStartedMs = Date.now();
    try {
      const completion = await session.complete(prompt);
      const normalized = normalizeExtraction(parseModelJson(completion.text), chapterIndexes);
      attempts.push({ attempt, ok: true, wallMs: Date.now() - attemptStartedMs, usage: completion.usage });
      return {
        seq,
        ok: true,
        chapterIndexes,
        batchChars: batch.charCount,
        promptChars: { system: prompt.system.length, user: prompt.user.length },
        wallMs: Date.now() - startedMs,
        attempts,
        usage: completion.usage,
        outputAtMaxTokens: completion.usage.output >= maxTokens,
        discarded: normalized.discarded,
        result: normalized.result,
        raw: completion.text,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ attempt, ok: false, wallMs: Date.now() - attemptStartedMs, error: message, kind: classifyError(message) });
    }
  }
  const last = attempts[attempts.length - 1];
  return {
    seq,
    ok: false,
    chapterIndexes,
    batchChars: batch.charCount,
    promptChars: { system: prompt.system.length, user: prompt.user.length },
    wallMs: Date.now() - startedMs,
    attempts,
    error: last?.error ?? "批未完成",
    errorKind: last?.kind ?? "other",
  };
}

/** 清掉本 job id 的旧会话文件（重跑同档时不复用旧会话——会话是过程记录，实测要干净起点） */
function clearSessionFiles(projectRoot, jobId) {
  const sessionsDir = projectSessionsDir(projectRoot);
  if (!existsSync(sessionsDir)) return;
  const suffix = `_${decomposeSessionId(jobId)}.jsonl`;
  for (const name of readdirSync(sessionsDir)) {
    if (name.endsWith(suffix)) unlinkSync(join(sessionsDir, name));
  }
}

async function runTier({ tier, limit, runDir, dryRun }) {
  if (!(tier in TIER_SPECS)) throw new Error(`未知档位: ${tier}（可选 ${Object.keys(TIER_SPECS).join(" / ")}）`);
  const spec = TIER_SPECS[tier];
  const startedAt = new Date().toISOString();

  // 出站与模型（与 server 启动同款：全局 undici dispatcher + pi 设置里的默认模型）
  const settings = getSettingsManager();
  applyHttpProxySettings(settings.getGlobalSettings().httpProxy);
  configureHttpDispatcher(settings.getHttpIdleTimeoutMs());
  const runtime = await getModelRuntime();
  const selection = await resolveActiveSelection(runtime, settings);
  if (selection === null) throw new Error("未配置可用模型：请先在设置页选择模型");
  const model = runtime.getModel(selection.provider, selection.modelId);
  if (model === undefined) throw new Error(`模型不可用: ${selection.provider}/${selection.modelId}`);
  const thinkingLevel =
    settings.getModelThinkingLevel(selection.provider, selection.modelId) ?? settings.getDefaultThinkingLevel();

  const { result: split, chapters } = loadChapters();
  assertPackerMatchesProduction(split.chapters);
  const planned = planForTier(split.chapters, tier).slice(0, limit ?? undefined);
  const chapterByIndex = new Map(chapters.map((chapter) => [chapter.index, chapter]));

  if (dryRun === true) {
    console.log(`[${tier}] ${split.chapters.length} 章 / ${split.totalChars} 字；target=${spec.targetChars}；计划 ${planned.length} 批`);
    for (const [position, batch] of planned.entries()) {
      console.log(`  - 批 ${position + 1}：${batch.chapterIndexes.length} 章 / ${batch.charCount} 字（${batch.chapterIndexes.join(",")}）`);
    }
    return null;
  }

  const projectRoot = join(runDir, tier, "project");
  mkdirSync(projectRoot, { recursive: true });
  const jobId = `batchexp-${tier}${limit === undefined ? "" : "-smoke"}`;
  clearSessionFiles(projectRoot, jobId);
  const session = await openDecomposeSession({}, { projectRoot, jobId, bookName: BOOK_NAME });

  const outPath = join(ARTIFACT_DIR, `tier-${tier}${limit === undefined ? "" : "-smoke"}.json`);
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const state = {
    tier,
    tierLabel: spec.label,
    book: BOOK_NAME,
    sourceFile: "references/三少爷的剑.txt",
    encoding: split.encoding,
    totalChars: split.totalChars,
    chapterCount: split.chapters.length,
    volumeCount: split.volumes.length,
    warnings: split.warnings,
    targetChars: spec.targetChars === Number.POSITIVE_INFINITY ? "full" : spec.targetChars,
    maxChaptersPerBatch: spec.maxChapters === Number.POSITIVE_INFINITY ? "full" : spec.maxChapters,
    plannedBatchCount: planned.length,
    plannedBatches: planned,
    limit: limit ?? null,
    model: {
      provider: selection.provider,
      id: selection.modelId,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      thinkingLevel,
    },
    systemPrompt: buildBatchPrompt({ chapters: [], snapshotText: "" }).system,
    snapshotPolicy: "empty（dev-only：无 db、不做跨批累积；只隔离批大小这一个变量）",
    jobId,
    sessionId: decomposeSessionId(jobId),
    startedAt,
    finishedAt: null,
    wallMsTotal: null,
    batches: [],
    totals: null,
  };
  const flush = () => writeFileSync(outPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  flush();

  console.log(`[${tier}] 切章 ${split.chapters.length} 章 / ${split.totalChars} 字；计划 ${planned.length} 批；模型 ${selection.provider}/${selection.modelId}（thinking=${thinkingLevel}）`);
  const tierStartedMs = Date.now();
  for (const [position, batch] of planned.entries()) {
    const seq = position + 1;
    const batchChapters = batch.chapterIndexes.map((index) => {
      const chapter = chapterByIndex.get(index);
      if (chapter === undefined) throw new Error(`计划批含未知章序 ${index}`);
      return chapter;
    });
    const batchStartedMs = Date.now();
    const record = await runBatch({ session, batch, chapters: batchChapters, seq, maxTokens: model.maxTokens });
    state.batches.push(record);
    state.wallMsTotal = Date.now() - tierStartedMs;
    state.totals = summarizeTier(state.batches, model.maxTokens);
    state.finishedAt = new Date().toISOString();
    flush();
    const status = record.ok
      ? `OK 输出 ${record.usage.output} token`
      : `FAIL(${record.errorKind}) ${record.error}`;
    console.log(
      `[${tier}] 批 ${seq}/${planned.length}：${batch.chapterIndexes.length} 章 / ${batch.charCount} 字；` +
        `${((Date.now() - batchStartedMs) / 1000).toFixed(1)}s；${status}`,
    );
    await sleep(200); // 档内串行的最小间隔（生产重试是即时的，这里只避免极端瞬时打点）
  }
  state.finishedAt = new Date().toISOString();
  state.wallMsTotal = Date.now() - tierStartedMs;
  state.totals = summarizeTier(state.batches, model.maxTokens);
  flush();
  console.log(`[${tier}] 完成：${(state.wallMsTotal / 1000).toFixed(1)}s；失败批 ${state.totals.failedBatches}；产物 ${outPath}`);
  return outPath;
}

/** 汇总一档：真实 usage 求和、失败 / 重试 / 截断计数、章覆盖 */
function summarizeTier(batches, maxTokens) {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, cost: 0 };
  const errorKinds = {};
  let attemptsTotal = 0;
  let retriedBatches = 0;
  let failedBatches = 0;
  let discardedTotal = 0;
  let outputAtMaxTokens = 0;
  const doneChapterIndexes = new Set();
  for (const batch of batches) {
    attemptsTotal += batch.attempts.length;
    if (batch.attempts.length > 1) retriedBatches += 1;
    if (!batch.ok) {
      failedBatches += 1;
      errorKinds[batch.errorKind] = (errorKinds[batch.errorKind] ?? 0) + 1;
      continue;
    }
    usage.input += batch.usage.input;
    usage.output += batch.usage.output;
    usage.cacheRead += batch.usage.cacheRead;
    usage.cacheWrite += batch.usage.cacheWrite;
    usage.reasoning += batch.usage.reasoning ?? 0;
    usage.totalTokens += batch.usage.totalTokens;
    usage.cost += batch.usage.cost?.total ?? 0;
    discardedTotal += batch.discarded.length;
    if (batch.usage.output >= maxTokens) outputAtMaxTokens += 1;
    for (const chapter of batch.result.chapters) doneChapterIndexes.add(chapter.chapterIndex);
  }
  return {
    executedBatches: batches.length,
    attemptsTotal,
    retriedBatches,
    failedBatches,
    errorKinds,
    discardedTotal,
    outputAtMaxTokens,
    doneChapterCount: doneChapterIndexes.size,
    usage,
  };
}

// ── 对比报告 + 盲评材料（report 子命令；只读各档 JSON） ────────────────────────

function readTierArtifact(tier) {
  const path = join(ARTIFACT_DIR, `tier-${tier}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** 确定性洗牌（盲评材料跨次运行稳定）：mulberry32 + 固定 seed */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 章级事实索引：章序 → { summary, characters, settings, locations, relations } */
function chapterFacts(tierArtifact) {
  const map = new Map();
  for (const batch of tierArtifact.batches) {
    if (!batch.ok) continue;
    for (const chapter of batch.result.chapters) map.set(chapter.chapterIndex, chapter);
  }
  return map;
}

/**
 * artifact 章集 → 标题行（估算每批固定开销用）：章序取规划批的并集，标题取结果里的章标题
 * （失败批的章没有结果 → 空标题，只影响这个上界估算的几个 token，方向 = 轻微低估）。
 * 开销本身**不在这里复述公式**——直接调生产 `batchOverheadTokensUpperBound`（与 `buildEstimate` 同源）。
 */
function artifactChapterHeadings(artifact) {
  const titles = new Map();
  for (const batch of artifact.batches) {
    if (!batch.ok) continue;
    for (const chapter of batch.result.chapters) titles.set(chapter.chapterIndex, chapter.chapterTitle ?? "");
  }
  return artifact.plannedBatches
    .flatMap((batch) => batch.chapterIndexes)
    .map((index) => ({ index, title: titles.get(index) ?? "" }));
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}m${String(totalSeconds % 60).padStart(2, "0")}s`;
}

function mdTable(header, rows) {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => ":---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function buildReport() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const tiers = Object.keys(TIER_SPECS).filter((tier) => readTierArtifact(tier) !== null);
  const missingTiers = Object.keys(TIER_SPECS).filter((tier) => readTierArtifact(tier) === null);
  const artifacts = new Map(tiers.map((tier) => [tier, readTierArtifact(tier)]));
  const facts = new Map(tiers.map((tier) => [tier, chapterFacts(artifacts.get(tier))]));
  const reference = artifacts.get("current") ?? artifacts.get(tiers[0]);
  const chapterCount = reference.chapterCount;

  // 1. 组批
  const planRows = tiers.map((tier) => {
    const artifact = artifacts.get(tier);
    const caps = artifact.plannedBatches.map((batch) => batch.chapterIndexes.length);
    const charCaps = artifact.plannedBatches.map((batch) => batch.charCount);
    const sums = artifact.plannedBatches.reduce((acc, batch) => {
      acc.chapters.push(...batch.chapterIndexes);
      return acc;
    }, { chapters: [] });
    return [
      `${tier}（${artifact.tierLabel}）`,
      String(artifact.targetChars),
      String(artifact.maxChaptersPerBatch),
      String(artifact.plannedBatchCount),
      (artifact.plannedBatches.reduce((sum, batch) => sum + batch.charCount, 0) / artifact.plannedBatchCount).toFixed(0),
      (sums.chapters.length / artifact.plannedBatchCount).toFixed(1),
      `${Math.min(...caps)}–${Math.max(...caps)}`,
      `${Math.min(...charCaps)}–${Math.max(...charCaps)}`,
    ];
  });

  // 2/3. 墙钟与 token
  const perfRows = tiers.map((tier) => {
    const { totals, wallMsTotal } = artifacts.get(tier);
    const okBatches = artifacts.get(tier).batches.filter((batch) => batch.ok);
    const avg = okBatches.length === 0 ? 0 : okBatches.reduce((sum, batch) => sum + batch.wallMs, 0) / okBatches.length;
    const slowest = okBatches.reduce((max, batch) => Math.max(max, batch.wallMs), 0);
    return [
      `${tier}（${artifacts.get(tier).tierLabel}）`,
      formatDuration(wallMsTotal),
      formatDuration(avg),
      formatDuration(slowest),
      String(totals.executedBatches),
      String(totals.attemptsTotal),
      String(totals.retriedBatches),
      String(totals.failedBatches),
      totals.errorKinds && Object.keys(totals.errorKinds).length > 0
        ? Object.entries(totals.errorKinds).map(([kind, count]) => `${kind}×${count}`).join("、")
        : "—",
      String(totals.outputAtMaxTokens),
    ];
  });
  const tokenRows = tiers.map((tier) => {
    const artifact = artifacts.get(tier);
    const u = artifact.totals.usage;
    const scopeChars = artifact.plannedBatches.reduce((sum, batch) => sum + batch.charCount, 0);
    const overheadTokens = batchOverheadTokensUpperBound(artifactChapterHeadings(artifact));
    const estimatedInput = Math.ceil(scopeChars / DECOMPOSE_CHARS_PER_TOKEN) + artifact.plannedBatchCount * overheadTokens;
    const estimatedOutput = scopeChars > 0 ? artifact.chapterCount * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER : 0;
    return [
      `${tier}（${artifact.tierLabel}）`,
      String(u.input),
      String(u.cacheRead),
      String(u.output),
      String(u.reasoning),
      `$${u.cost.toFixed(4)}`,
      String(overheadTokens),
      String(estimatedInput),
      `${(u.input / estimatedInput).toFixed(2)}×`,
      String(estimatedOutput),
    ];
  });

  // 4. 抽取完整性（质量代理）
  const qualityRows = tiers.map((tier) => {
    const artifact = artifacts.get(tier);
    const map = facts.get(tier);
    const chapters = [...map.values()];
    // 两遍：先收齐全档名字（关系端点判据 = 落库实体集合的近似），再算悬空
    const names = new Set(chapters.flatMap((chapter) => chapter.characters.map((character) => character.name.trim())));
    const mentionCounts = new Map();
    let settingCount = 0;
    let locationCount = 0;
    let relationCount = 0;
    let danglingRelations = 0;
    let emptySummaries = 0;
    let summaryChars = 0;
    for (const chapter of chapters) {
      for (const character of chapter.characters) {
        const key = character.name.trim();
        mentionCounts.set(key, (mentionCounts.get(key) ?? 0) + 1);
      }
      settingCount += chapter.settings.length;
      locationCount += chapter.locations.length;
      for (const relation of chapter.relations) {
        relationCount += 1;
        if (!names.has(relation.source.trim()) || !names.has(relation.target.trim())) danglingRelations += 1;
      }
      if (chapter.summary.trim() === "") emptySummaries += 1;
      summaryChars += chapter.summary.length;
    }
    const multiChapter = [...mentionCounts.values()].filter((count) => count >= DECOMPOSE_MENTION_MIN_CHAPTERS).length;
    const chapterCoverage = `${map.size}/${artifact.chapterCount}`;
    return [
      `${tier}（${artifact.tierLabel}）`,
      chapterCoverage,
      String(artifact.totals.doneChapterCount === artifact.chapterCount ? 0 : artifact.chapterCount - artifact.totals.doneChapterCount),
      String(artifact.totals.discardedTotal),
      String(names.size),
      String(multiChapter),
      String(settingCount),
      String(locationCount),
      String(relationCount),
      String(danglingRelations),
      String(emptySummaries),
      map.size === 0 ? "—" : (summaryChars / map.size).toFixed(0),
    ];
  });

  // 5. 逐章对照（只列跨档差异最大的章）
  const chapterDiffs = [];
  for (let index = 1; index <= chapterCount; index++) {
    const cells = tiers.map((tier) => {
      const chapter = facts.get(tier).get(index);
      if (chapter === undefined) return "—";
      return `${chapter.characters.length}/${chapter.settings.length}/${chapter.locations.length}/${chapter.relations.length}`;
    });
    const totalsPerTier = tiers.map((tier) => {
      const chapter = facts.get(tier).get(index);
      return chapter === undefined ? -1 : chapter.characters.length + chapter.settings.length + chapter.locations.length + chapter.relations.length;
    });
    chapterDiffs.push({ index, spread: Math.max(...totalsPerTier) - Math.min(...totalsPerTier), cells });
  }
  chapterDiffs.sort((a, b) => b.spread - a.spread);
  const diffRows = chapterDiffs.slice(0, 15).map((row) => [`第${row.index}章`, ...row.cells]);
  writeFileSync(
    join(ARTIFACT_DIR, "chapter-comparison.csv"),
    ["chapter," + tiers.map((tier) => `${tier}_characters/${tier}_settings/${tier}_locations/${tier}_relations`).join(","),
      ...[...chapterDiffs].sort((a, b) => a.index - b.index).map((row) => [`第${row.index}章`, ...row.cells].join(","))].join("\n") + "\n",
    "utf-8",
  );

  // 6. 盲评材料（逐章独立打乱 A/B/C/D；映射只写 blind-key.json）
  const rng = mulberry32(20260922);
  const sampleCount = Math.min(12, chapterCount);
  const sampleIndexes = Array.from({ length: sampleCount }, (_, i) => Math.round(((i + 0.5) * chapterCount) / sampleCount));
  const blindLines = [
    "# 批大小实测 · 人工盲评材料",
    "",
    "以下每章的摘要各有四份（A–D），来自四档不同批大小；**逐章独立打乱**，A/B/C/D 与档位无固定对应关系。",
    "请逐章判断四份摘要的「覆盖完整度（关键情节 / 人物是否漏）+ 准确性」，给 1（最好）～4（最差）排序；",
    "如某份明显是截断 / 空摘要 / 跑题，请直接标注。评分填进文末表格。",
    "",
    `揭盲映射在 \`blind-key.json\`（评分完成后再看）；档位匿名标签与真实档位的对应只在 key 里。`,
    "",
  ];
  const key = { seed: 20260922, instruction: "评分完成后再打开；A-D 逐章独立打乱", chapters: {} };
  for (const index of sampleIndexes) {
    const labels = shuffle(tiers, rng);
    const chapterTitle = facts.get(tiers[0]).get(index)?.chapterTitle ?? `第${index}章`;
    blindLines.push(`## 第${index}章 ${chapterTitle}`, "");
    key.chapters[index] = {};
    for (const [position, tier] of labels.entries()) {
      const label = "ABCD"[position];
      key.chapters[index][label] = tier;
      const summary = facts.get(tier).get(index)?.summary?.trim();
      blindLines.push(`- **${label}**：${summary === undefined || summary === "" ? "（无 / 空摘要）" : summary}`);
    }
    blindLines.push("");
  }
  blindLines.push("## 评分表", "", mdTable(["章", "A", "B", "C", "D"], sampleIndexes.map((index) => [`第${index}章`, "", "", "", ""])), "");
  writeFileSync(join(ARTIFACT_DIR, "blind-review.md"), `${blindLines.join("\n")}\n`, "utf-8");
  writeFileSync(join(ARTIFACT_DIR, "blind-key.json"), `${JSON.stringify(key, null, 2)}\n`, "utf-8");

  const conclusionPath = join(ARTIFACT_DIR, "conclusion.md");
  const conclusion = existsSync(conclusionPath) ? readFileSync(conclusionPath, "utf-8") : "（待填：见 docs/design/60-decompose.md §4 的回写口径）";
  const report = [
    "# 批大小实测对比报告（dev-only harness）",
    "",
    `- 样本：\`references/三少爷的剑.txt\`（${reference.encoding} / ${reference.totalChars} 字 / ${reference.chapterCount} 章 / ${reference.volumeCount} 卷）`,
    `- 模型：\`${reference.model.provider}/${reference.model.id}\`（${reference.model.name}，窗口 ${reference.model.contextWindow} / 输出上限 ${reference.model.maxTokens} / thinking=${reference.model.thinkingLevel}）`,
    `- 口径：S2 抽取只读路径（llm.ts 同一 Agent 路径）；快照为空（dev-only）；逐批串行、整批重试 ≤ ${DECOMPOSE_BATCH_MAX_ATTEMPTS}（含首次）`,
    "- 组批：current 档 = 生产 `planBatches` 真实现（target 直读常量）；2× / 4× = 同款装箱的参数化副本（启动断言与生产实现逐字一致）；full = 全部章一个批",
    `- 全文一批：默认模型窗口可容纳本样本全书（输入 ≈ 1.7×10⁵ token / 窗口 ${reference.model.contextWindow}）⇒ 无需降级为「窗口内最大连续章区间」`,
    `- 生成命令：\`node scripts/decompose-batch-experiment.mjs run --tier <tier>\` → \`node scripts/decompose-batch-experiment.mjs report\``,
    missingTiers.length === 0 ? "" : `- ⚠ 缺档位工件：${missingTiers.join(" / ")}（本报告不完整）`,
    "",
    "## 1. 组批",
    "",
    mdTable(["档", "target 字/批", "章数上限", "批数", "平均字/批", "平均章/批", "章/批范围", "字/批范围"], planRows),
    "",
    "## 2. 墙钟与调用",
    "",
    mdTable(["档", "总墙钟", "批均墙钟", "最慢批", "批数", "调用次数", "重试批", "失败批", "失败分类", "输出打满上限批"], perfRows),
    "",
    "> 口径：批均墙钟 / 最慢批只统计**成功批**，失败尝试的墙钟未计入 ⇒ 失败档的每批耗时被低估（总量口径请对照上表「总墙钟」）。",
    "",
    "## 3. Token 与成本",
    "",
    `估算输入 = ⌈范围字数 / \`DECOMPOSE_CHARS_PER_TOKEN\`⌉ + 批数 × 每批固定开销；开销**不复刻公式**——取生产 \`batchOverheadTokensUpperBound\`（与路由 \`buildEstimate\` 同源，按 artifact 章集的上界）。`,
    "",
    mdTable(["档", "输入 token", "缓存读", "输出 token", "思维 token", "成本", "每批固定开销", "估算输入", "真实/估算", "估算输出"], tokenRows),
    "",
    "> 口径：token 汇总只累加**成功批**（失败尝试拿不到 usage）、每批均值同 §2 ⇒ 失败档的实际成本被低估；「思维 token」是「输出 token」的子集（同一 usage 的细分），不是额外一项。",
    "",
    "## 4. 抽取完整性（质量代理）",
    "",
    mdTable(["档", "章覆盖", "缺章", "归一丢弃", "人物名（去重）", `≥${DECOMPOSE_MENTION_MIN_CHAPTERS} 章人物`, "设定", "地点", "关系", "悬空关系", "空摘要", "摘要均长"], qualityRows),
    "",
    "> 「`≥DECOMPOSE_MENTION_MIN_CHAPTERS` 章人物」= 出现章数达 S3 落库阈值的人物名数，是压噪音后的有效人物量级。",
    "",
    "## 5. 逐章对照（差异最大的 15 章；完整表见 `chapter-comparison.csv`）",
    "",
    `单元格 = 人物/设定/地点/关系；列序：${tiers.join(" / ")}`,
    "",
    mdTable(["章", ...tiers], diffRows),
    "",
    "## 6. 盲评材料",
    "",
    "- `blind-review.md`：每档章摘要抽样（逐章独立打乱为 A–D）+ 评分表模板",
    "- `blind-key.json`：揭盲映射（评分完成后再看）",
    "",
    "## 7. 结论",
    "",
    conclusion.trim(),
    "",
  ].join("\n");
  writeFileSync(join(ARTIFACT_DIR, "report.md"), report, "utf-8");
  console.log(`报告已生成：${join(ARTIFACT_DIR, "report.md")}`);
  console.log(`\n${report}`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { command: argv[0], tier: undefined, limit: undefined, runDir: DEFAULT_RUN_DIR, dryRun: false };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--tier") args.tier = argv[++i];
    else if (argv[i] === "--limit") args.limit = Number(argv[++i]);
    else if (argv[i] === "--run-dir") args.runDir = resolve(argv[++i]);
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else throw new Error(`未知参数: ${argv[i]}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.command === "report") {
  buildReport();
} else if (args.command === "run") {
  if (args.tier === undefined) throw new Error("run 需要 --tier current|2x|4x|full");
  await runTier({ tier: args.tier, limit: args.limit, runDir: args.runDir, dryRun: args.dryRun });
} else {
  console.error("用法: node scripts/decompose-batch-experiment.mjs run --tier current|2x|4x|full [--limit N] [--dry-run] [--run-dir <dir>]");
  console.error("      node scripts/decompose-batch-experiment.mjs report");
  process.exit(1);
}
