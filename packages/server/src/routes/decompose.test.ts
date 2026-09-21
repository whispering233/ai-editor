// 卡 21.4 拆解 analyze 路由测试：POST /api/v1/decompose/analyze（切分预览，无状态）
// 覆盖：正常预览（编码 / 章列表全量 / 统计 / 警告 / 默认书名）/ 超体积 400 / 空文本与空白文本 400 /
// query 校验 400 / **不要求项目已打开** / 范围只影响 estimate（章列表不变、越界落成零批）/
// estimate 公式（批数 + 每批固定开销 + 每章输出）/ costApprox 两态（未配置模型凭据 → null；
// 注入内存运行时 + faux 费率 → 按 pi 模型目录 `Model.cost` 算出）。
// fixture 全部自造，不读 test-project/（该目录整体不入库）。

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type {
  DecomposeAnalyzeRes,
  DecomposeBatchRes,
  DecomposeBatchResult,
  DecomposeContinueRes,
  DecomposeJobLogRes,
  DecomposeJobRes,
  DecomposePlanRes,
  DecomposeStartRes,
  OutlineFileVolume,
} from "@whispering233/ai-editor-shared";
import {
  completeBatch,
  createDecomposeJob,
  deriveChapterOrder,
  getDecomposeJob,
  getDocument,
  getDocumentTextLengths,
  listDecomposeBatches,
  listDecomposeJobs,
  nowIso,
  OUTLINE_FILE_NAME,
  readOutlineFile,
  readProjectFile,
  updateJobStatus,
} from "@whispering233/ai-editor-db";
import { projectSessionsDir } from "@whispering233/ai-editor-agent";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { readLastProject } from "../last-project.js";
import { DECOMPOSE_BATCH_TARGET_CHARS } from "../decompose/batching.js";
import { ingestDecomposeProject } from "../decompose/job.js";
import { DECOMPOSE_LOG_CUSTOM_TYPE, decomposeSessionId } from "../decompose/llm.js";
import { DECOMPOSE_SNAPSHOT_MAX_CHARS, isDecomposeJobActive } from "../decompose/runner.js";
import { splitNovelWithSlices } from "../decompose/split.js";
import { setProjectRoot } from "./project.js";
import { resetModelRuntime } from "../model-runtime.js";
import {
  DECOMPOSE_BATCH_OVERHEAD_TOKENS,
  DECOMPOSE_CHARS_PER_TOKEN,
  DECOMPOSE_MAX_FILE_BYTES,
  DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER,
  DECOMPOSE_PROMPT_OVERHEAD_TOKENS,
  createDecomposeRoutes,
  type DecomposeRouteDeps,
} from "./decompose.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const UPLOAD_HEADERS = { ...HOST_HEADERS, "content-type": "application/octet-stream" };

/** 样本里的单章原文（标题行 + 正文；每章字数按序递增）——novelText 与切片抽检比对共用同一份 */
function chapterSource(position: number): string {
  return `第${position}章 标题${position}\n${"正文".repeat(150 + (position - 1) * 20)}`;
}

/** 造一份可切分样本：章数 ≥ 切分器下限、每章正文长于微段阈值（否则会落退化等分）；
 * 每章字数按序递增 ⇒ 字分布（min / median / max）有区分度 */
function novelText(chapterCount: number): string {
  return Array.from({ length: chapterCount }, (_, position) => chapterSource(position + 1)).join("\n");
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 组装带中间件的测试 app（与 index.ts 同款装配顺序） */
function buildApp(deps: DecomposeRouteDeps = {}): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/decompose", createDecomposeRoutes(deps));
  return app;
}

function postAnalyze(app: Hono, body: Uint8Array, query: string): Promise<Response> {
  return app.request(`/api/v1/decompose/analyze?${query}`, {
    method: "POST",
    headers: UPLOAD_HEADERS,
    body,
  });
}

/** 请求 + 断言 200，返回响应 data */
async function analyzeOk(app: Hono, body: Uint8Array, query: string): Promise<DecomposeAnalyzeRes> {
  const res = await postAnalyze(app, body, query);
  expect(res.status).toBe(200);
  return (await res.json()).data as DecomposeAnalyzeRes;
}

/** 内存运行时 + 内存 settings：注册一个带费率的 faux provider（费率进 pi 模型目录）。
 * `responses` = 脚本化的模型输出（start 会起 S2 批循环，须给确定性的假输出；空数组 = 不排队） */
async function runtimeWithCost(input: number, output: number, responses: readonly string[] = []): Promise<DecomposeRouteDeps> {
  const faux = fauxProvider({
    models: [
      {
        id: "faux-a",
        name: "Faux A",
        contextWindow: 128_000,
        maxTokens: 8192,
        cost: { input, output, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "faux-key" }));
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  if (responses.length > 0) faux.setResponses(responses.map((text) => fauxAssistantMessage(text)));
  return { runtime, settings: SettingsManager.inMemory({}) };
}

// ============ 环境隔离 ============
//
// HOME 隔离（pi agent dir → $HOME/.pi/agent，不读真实模型目录/settings）+ 清空本机可能存在的
// provider env key（本文件有「未配置模型/凭据 → costApprox = null」用例，必须确定性无凭据）。

let tmpRoot: string;
let originalHome: string | undefined;
const credentialEnv: Array<[string, string]> = [];

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-decompose-"));
  setCurrentProject(null);
  setProjectRoot(tmpRoot); // start 在 <创作根>/books/<书名>/ 建档
  originalHome = process.env.HOME;
  process.env.HOME = tmpRoot;
  for (const key of Object.keys(process.env)) {
    if (!/(API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key)) continue;
    credentialEnv.push([key, process.env[key]!]);
    delete process.env[key];
  }
  resetModelRuntime(); // 单例按新 HOME / 新 env 重建
});

afterEach(() => {
  resetModelRuntime();
  const project = getCurrentProject();
  if (project !== null) closeProject(project); // 关闭 start 打开的项目（临时目录随后删除）
  setCurrentProject(null);
  setProjectRoot(null);
  for (const [key, value] of credentialEnv.splice(0)) process.env[key] = value;
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ============ POST /api/v1/decompose/analyze ============

describe("POST /decompose/analyze（切分预览）", () => {
  it("正常预览：编码 / 章列表全量 / 统计 / 警告 / 默认书名", async () => {
    const app = buildApp();
    const text = novelText(6);
    const data = await analyzeOk(app, bytesOf(text), `file_name=${encodeURIComponent("斗破苍穹.txt")}`);

    expect(data.encoding).toBe("utf-8");
    expect(data.totalChars).toBe(text.length);
    expect(data.chapters.map((chapter) => chapter.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(data.chapters.map((chapter) => chapter.title)).toEqual(["标题1", "标题2", "标题3", "标题4", "标题5", "标题6"]);
    // 章字数 = 标题行（「第N章 标题N」= 7 字）+ 分隔换行 + 正文（300 起、每章 +40）
    expect(data.chapters.map((chapter) => chapter.charCount)).toEqual([308, 348, 388, 428, 468, 508]);
    expect(data.chapters.every((chapter) => chapter.volumeIndex === 0)).toBe(true);
    expect(data.volumes).toEqual([{ index: 0, title: "全书" }]);
    // 真切分（而非退化等分）：等分兜底会带 FALLBACK_EQUAL_SPLIT 警告
    expect(data.warnings.map((warning) => warning.code)).not.toContain("FALLBACK_EQUAL_SPLIT");

    // 字分布：偶数章取中位两章均值；ΣcharCount = totalChars - 章间分隔换行数（切片 trim 掉分隔换行，§3.4）
    expect(data.stats).toEqual({ min: 308, median: (388 + 428) / 2, max: 508 });
    expect(data.chapters.reduce((total, chapter) => total + chapter.charCount, 0)).toBe(text.length - 5);

    expect(data.defaultName).toBe("斗破苍穹");
  });

  it("estimate：批数 + 每批固定开销 + 每章输出；llmCalls = 批数 + 归并 + 报告", async () => {
    const app = buildApp();
    const data = await analyzeOk(app, bytesOf(novelText(6)), "file_name=a.txt");

    // 六章 ≈ 1800 字，远小于每批目标字数且章数未触上限 ⇒ 单批；归并 + 报告 = 2 次调用
    expect(data.estimate.batchCount).toBe(1);
    expect(data.estimate.llmCalls).toBe(data.estimate.batchCount + 2);
    const scopeChars = data.chapters.reduce((total, chapter) => total + chapter.charCount, 0);
    expect(data.estimate.inputTokensApprox).toBe(
      Math.ceil(scopeChars / DECOMPOSE_CHARS_PER_TOKEN) + data.estimate.batchCount * DECOMPOSE_BATCH_OVERHEAD_TOKENS,
    );
    expect(data.estimate.outputTokensApprox).toBe(data.chapters.length * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER);
    expect(data.estimate.costApprox).toBeNull(); // 无凭据（见下方 costApprox 用例）
  });

  it("每批固定开销从快照预算派生（回退成手写数字 ⇒ 改预算时预估静默失真）", () => {
    // 快照预算是固定开销的量级主导项：开销必须 ≥ 它的 token 换算（手写 800 这类小数字会当场报红）
    expect(DECOMPOSE_BATCH_OVERHEAD_TOKENS).toBeGreaterThanOrEqual(
      Math.ceil(DECOMPOSE_SNAPSHOT_MAX_CHARS / DECOMPOSE_CHARS_PER_TOKEN),
    );
    expect(DECOMPOSE_BATCH_OVERHEAD_TOKENS).toBe(
      Math.ceil(DECOMPOSE_SNAPSHOT_MAX_CHARS / DECOMPOSE_CHARS_PER_TOKEN) + DECOMPOSE_PROMPT_OVERHEAD_TOKENS,
    );
  });

  it("范围只影响 estimate：章列表仍全量返回；越界范围 → 零批但归并/报告照跑", async () => {
    const app = buildApp();
    const body = bytesOf(novelText(6));
    const full = await analyzeOk(app, body, "file_name=a.txt");
    const scoped = await analyzeOk(app, body, "file_name=a.txt&scope_start=1&scope_end=2");
    const outOfRange = await analyzeOk(app, body, "file_name=a.txt&scope_start=99");

    // 章列表（含标题与字数）与范围无关 —— 范围只约束 LLM 分析，正文始终全量导入
    expect(scoped.chapters).toEqual(full.chapters);
    expect(outOfRange.chapters).toEqual(full.chapters);
    expect(scoped.totalChars).toBe(full.totalChars);

    expect(scoped.estimate.outputTokensApprox).toBe(2 * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER);
    expect(scoped.estimate.inputTokensApprox).toBeLessThan(full.estimate.inputTokensApprox);
    expect(scoped.estimate.batchCount).toBe(1);

    // 空范围：零批，但归并 + 报告仍会跑（llmCalls = 0 + 2）
    expect(outOfRange.estimate).toEqual({
      batchCount: 0,
      llmCalls: 2,
      inputTokensApprox: 0,
      outputTokensApprox: 0,
      costApprox: null,
    });
  });

  it("costApprox：注入 pi 模型目录（faux 费率）→ 按 Model.cost 与每百万 token 口径算出", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const data = await analyzeOk(app, bytesOf(novelText(6)), "file_name=a.txt");

    expect(typeof data.estimate.costApprox).toBe("number");
    expect(data.estimate.costApprox).toBeCloseTo(
      (data.estimate.inputTokensApprox * 0.5 + data.estimate.outputTokensApprox * 1.5) / 1_000_000,
      9,
    );
  });

  it("costApprox：未配置模型/凭据 → null，其余预览字段照常", async () => {
    const app = buildApp();
    const data = await analyzeOk(app, bytesOf(novelText(6)), "file_name=a.txt");

    expect(data.estimate.costApprox).toBeNull();
    expect(data.estimate.batchCount).toBe(1);
    expect(data.chapters).toHaveLength(6);
  });

  it("超体积 → 400 DECOMPOSE_FILE_TOO_LARGE", async () => {
    const app = buildApp();
    const res = await postAnalyze(app, new Uint8Array(DECOMPOSE_MAX_FILE_BYTES + 1), "file_name=a.txt");

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("DECOMPOSE_FILE_TOO_LARGE");
  });

  it("空文件 / 只有空白 → 400 DECOMPOSE_FILE_INVALID", async () => {
    const app = buildApp();
    const empty = await postAnalyze(app, new Uint8Array(0), "file_name=a.txt");
    const blank = await postAnalyze(app, bytesOf("\n \n\n"), "file_name=a.txt");

    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe("DECOMPOSE_FILE_INVALID");
    expect(blank.status).toBe(400);
    expect((await blank.json()).error.code).toBe("DECOMPOSE_FILE_INVALID");
  });

  it("query 非法（缺 file_name / scope_start 越界）→ 400 VALIDATION_ERROR", async () => {
    const app = buildApp();
    const body = bytesOf(novelText(6));
    const missing = await postAnalyze(app, body, "");
    const zeroStart = await postAnalyze(app, body, "file_name=a.txt&scope_start=0");

    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("VALIDATION_ERROR");
    expect(zeroStart.status).toBe(400);
    expect((await zeroStart.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("不要求项目已打开：无当前项目也能预览", async () => {
    const app = buildApp();
    expect(getCurrentProject()).toBeNull(); // 前提：确实没有项目上下文

    const data = await analyzeOk(app, bytesOf(novelText(6)), "file_name=a.txt");
    expect(data.chapters).toHaveLength(6);
  });

  it("默认书名：无扩展名 → 原名；带路径分隔符 → 取文件名", async () => {
    const app = buildApp();
    const body = bytesOf(novelText(6));
    expect((await analyzeOk(app, body, "file_name=无扩展名")).defaultName).toBe("无扩展名");
    expect((await analyzeOk(app, body, `file_name=${encodeURIComponent("d:/书/某书.txt")}`)).defaultName).toBe("某书");
  });
});

// ============ 卡 21.5：POST /api/v1/decompose/start（S1 建档）+ GET /job + GET /job/batches/:seq ============
//
// 覆盖：建档三向落库（outline.json 卷章 / document_records 正文 / decompose_batches 批行）/ 书名冲突 409 /
// 凭据缺失 400 且不留半成品项目 / 非法书名（路径逃逸）400 / 超体积与空文本 400 不建目录 /
// **范围只影响批规划、正文全量导入** / GET /job 不含批结果正文 + 多 job 取最新（created_at desc → id desc）/
// 单批结果形状守卫（db 层不校验形状）/ 切片逐章抽检（首/中/末，证明未拿 charCount 当偏移量）。

/** start 的 query（file_name 固定，书名可改；extra 追加 scope 等参数） */
function startQuery(name: string, extra = ""): string {
  return `file_name=${encodeURIComponent("斗破苍穹.txt")}&name=${encodeURIComponent(name)}${extra}`;
}

/** 书目录（创作根/books/<书名>） */
function bookDir(name: string): string {
  return join(tmpRoot, "books", name);
}

function postStart(app: Hono, body: Uint8Array, query: string): Promise<Response> {
  return app.request(`/api/v1/decompose/start?${query}`, { method: "POST", headers: UPLOAD_HEADERS, body });
}

async function startOk(app: Hono, body: Uint8Array, query: string): Promise<DecomposeStartRes> {
  const res = await postStart(app, body, query);
  expect(res.status).toBe(200);
  return (await res.json()).data as DecomposeStartRes;
}

async function jobData(app: Hono): Promise<DecomposeJobRes> {
  const res = await app.request("/api/v1/decompose/job", { headers: HOST_HEADERS });
  expect(res.status).toBe(200);
  return (await res.json()).data as DecomposeJobRes;
}

async function batchData(app: Hono, seq: string): Promise<DecomposeBatchRes> {
  const res = await app.request(`/api/v1/decompose/job/batches/${seq}`, { headers: HOST_HEADERS });
  expect(res.status).toBe(200);
  return (await res.json()).data as DecomposeBatchRes;
}

async function planData(app: Hono, query = ""): Promise<DecomposePlanRes> {
  const res = await app.request(`/api/v1/decompose/plan${query === "" ? "" : `?${query}`}`, { headers: HOST_HEADERS });
  expect(res.status).toBe(200);
  return (await res.json()).data as DecomposePlanRes;
}

function postContinue(app: Hono, query = ""): Promise<Response> {
  return app.request(`/api/v1/decompose/continue${query === "" ? "" : `?${query}`}`, {
    method: "POST",
    headers: HOST_HEADERS,
  });
}

/** 一批的最小契约形状（S2 才写；本节测试直接落库造；覆盖给定章序的 JSON 用于脚本化 S2 输出） */
function batchResult(): DecomposeBatchResult {
  return {
    chapters: [
      { chapterIndex: 1, chapterTitle: "标题1", summary: "绝密摘要标记", characters: [], settings: [], locations: [], relations: [] },
    ],
  };
}

function batchJsonOf(indexes: readonly number[]): string {
  return JSON.stringify({
    chapters: indexes.map((index) => ({
      chapterIndex: index,
      chapterTitle: `标题${index}`,
      summary: `摘要${index}`,
      characters: [],
      settings: [],
      locations: [],
      relations: [],
    })),
  });
}

/** 轮询等待（start 会起 S2 批循环且后台跑：断言收口状态前先等它落库） */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等待超时：${label}`);
}

/**
 * 直接跑 S1（**不经 route**，因此不起 S2 批循环）：进度投影 / 单批结果 / 结果形状守卫这类
 * 「批执行前」的状态需要确定性夹具——经 route 建 job 的话，后台批循环会实时改写批行（赛跑）。
 */
function ingestProject(name: string, chapterCount = 6, scope: { start?: number; end?: number } = {}): string {
  const project = initProject(bookDir(name), { name });
  setCurrentProject(project);
  const split = splitNovelWithSlices(bytesOf(novelText(chapterCount)));
  const start = scope.start ?? 1;
  const end = scope.end ?? chapterCount;
  const { jobId } = ingestDecomposeProject({
    project,
    split,
    scopedChapters: split.result.chapters.filter((chapter) => chapter.index >= start && chapter.index <= end),
    scopeStart: start,
    scopeEnd: end,
    model: null,
    now: nowIso(),
  });
  return jobId;
}

describe("POST /decompose/start（S1 建档）", () => {
  it("建档成功：大纲卷章 / 正文全量导入 / 批规划落库 / 切项目 + lastProject", async () => {
    // start 建档后同一响应内起 S2（后台跑）：脚本化一批假输出 ⇒ 批行收口为 done（批执行细节见 runner.test.ts）
    const deps = await runtimeWithCost(0.5, 1.5, [batchJsonOf([1, 2, 3, 4, 5, 6])]);
    const app = buildApp(deps);
    const data = await startOk(app, bytesOf(novelText(6)), startQuery("斗破苍穹"));
    const dir = bookDir("斗破苍穹");

    // 响应 + 切换语义
    expect(data.projectPath).toBe(dir);
    expect(data.name).toBe("斗破苍穹");
    expect(data.status).toBe("running");
    expect(data.batchCount).toBe(1);
    expect(data.jobId.startsWith("job-")).toBe(true);
    const project = getCurrentProject();
    expect(project?.root).toBe(dir);
    expect(data.projectId).toBe(project?.config.id);
    expect(readProjectFile(dir)?.name).toBe("斗破苍穹");
    expect(readLastProject(tmpRoot)).toBe(dir); // 创作根 .ai-editor/config.json 的 lastProject

    // ① 大纲：单卷「全书」+ 6 章（标题 = 切分清洗后的标题；summary 留空待 S3 回写）
    const tree = readOutlineFile(dir);
    expect(tree.children).toHaveLength(1);
    const volume = tree.children[0] as OutlineFileVolume;
    expect(volume.type).toBe("volume");
    expect(volume.title).toBe("全书");
    const chapters = volume.children ?? [];
    expect(chapters).toHaveLength(6);
    expect(chapters.map((chapter) => chapter.title)).toEqual(["标题1", "标题2", "标题3", "标题4", "标题5", "标题6"]);
    expect(chapters.every((chapter) => chapter.type === "chapter" && chapter.summary === undefined)).toBe(true);

    // ② 正文：每章一行文档（段落块 + 服务端派生投影）
    const db = project!.db;
    const chapterIds = chapters.map((chapter) => chapter.id);
    expect(getDocumentTextLengths(db, "chapter", chapterIds).size).toBe(6);
    const firstBlocks = JSON.parse(getDocument(db, "chapter", chapterIds[0])!.content) as Array<{
      type: string;
      content: unknown[];
    }>;
    // 每行一个段落块（标题行 + 正文行 + 切片末尾的分隔换行 = 空段落）；块类型全为 paragraph
    expect(firstBlocks.map((block) => block.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(firstBlocks[2].content).toEqual([]);
    expect(getDocument(db, "chapter", chapterIds[0])!.content_text).toBe(chapterSource(1).split("\n").join("\n\n"));

    // ③ job + 批规划行
    const job = getDecomposeJob(db)!;
    expect(job.id).toBe(data.jobId);
    expect(job.status).toBe("running"); // S1 完成即 running（批执行归 S2 runner）
    expect(job.scope_start).toBe(1);
    expect(job.scope_end).toBe(6);
    expect(job.batch_target_chars).toBe(DECOMPOSE_BATCH_TARGET_CHARS);
    const available = await deps.runtime!.getAvailable();
    expect(job.model).toBe(`${available[0].provider}/${available[0].id}`); // 审计用 provider/modelId
    const batches = listDecomposeBatches(db, job.id);
    expect(batches).toHaveLength(1);
    expect(batches[0].chapter_ids).toEqual(chapterIds); // 批行按章序映射到章节点 id（批规划 = S1 产物）
    await waitFor(() => listDecomposeBatches(db, job.id)[0].status === "done", "S2 批收口");
    expect(listDecomposeBatches(db, job.id)[0]).toMatchObject({ seq: 1, status: "done", attempts: 1, error: null });

    // 批规划与 analyze 预估同源（同一 planBatches，确定性）
    const preview = await analyzeOk(app, bytesOf(novelText(6)), `file_name=a.txt`);
    expect(data.batchCount).toBe(preview.estimate.batchCount);
  });

  it("多卷书：大纲按卷标记分卷（卷→章；卷标题 = 切分卷标题）", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const text = [
      "第一卷 少年游",
      chapterSource(1),
      chapterSource(2),
      chapterSource(3),
      "第二卷 风云录",
      chapterSource(4),
      chapterSource(5),
      chapterSource(6),
    ].join("\n");
    const data = await startOk(app, bytesOf(text), startQuery("分卷"));
    const project = getCurrentProject()!;
    const tree = readOutlineFile(bookDir("分卷"));

    // 卷 → 章：两卷各挂 volumeIndex 命中的章（首卷卷标记行随「前言」章保留，不下沉成新章）
    const volumes = tree.children as OutlineFileVolume[];
    expect(volumes.map((volume) => [volume.title, (volume.children ?? []).map((chapter) => chapter.title)])).toEqual([
      ["少年游", ["前言", "标题1", "标题2", "标题3"]],
      ["风云录", ["标题4", "标题5", "标题6"]],
    ]);
    const chapterIds = volumes.flatMap((volume) => (volume.children ?? []).map((chapter) => chapter.id));
    expect(getDocumentTextLengths(project.db, "chapter", chapterIds).size).toBe(7); // 正文全量（含「前言」章）
    expect(data.batchCount).toBe(1);
    expect(listDecomposeBatches(project.db, data.jobId)[0].chapter_ids).toEqual(chapterIds);
  });

  it("切片逐章抽检：首 / 中 / 末章正文与原文逐字一致（未拿 charCount 当偏移量）", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    await startOk(app, bytesOf(novelText(6)), startQuery("抽检"));
    const db = getCurrentProject()!.db;
    const tree = readOutlineFile(bookDir("抽检"));
    const chapters = (tree.children[0] as OutlineFileVolume).children ?? [];

    for (const position of [1, 3, 6]) {
      const chapterId = chapters[position - 1].id;
      const document = getDocument(db, "chapter", chapterId)!;
      const lines = chapterSource(position).split("\n");
      // 逐字一致：首行 = 原标题行、末行 = 原正文行（charCount 当偏移量会立刻错位）
      expect(document.content_text).toBe(lines.join("\n\n"));
      const blocks = JSON.parse(document.content) as Array<{ content: Array<{ text: string }> }>;
      expect(blocks[0].content[0].text).toBe(lines[0]);
      expect(blocks[1].content[0].text).toBe(lines[1]);
      // 切片边界精确：中间章的切片到下一章起点（末尾带一个分隔换行 = 空段落），末章到文件末
      expect(blocks).toHaveLength(position === 6 ? 2 : 3);
      expect(blocks[blocks.length - 1].content).toEqual(position === 6 ? [{ type: "text", text: lines[1] }] : []);
    }
  });

  it("范围只影响批规划：正文与大纲仍全量导入（scope 2..3）", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const data = await startOk(app, bytesOf(novelText(6)), startQuery("范围", "&scope_start=2&scope_end=3"));
    const project = getCurrentProject()!;
    const tree = readOutlineFile(bookDir("范围"));
    const chapters = (tree.children[0] as OutlineFileVolume).children ?? [];

    expect(data.batchCount).toBe(1);
    const job = getDecomposeJob(project.db)!;
    expect([job.scope_start, job.scope_end]).toEqual([2, 3]); // job 记录的范围 = 请求范围
    expect(listDecomposeBatches(project.db, job.id)[0].chapter_ids).toEqual([chapters[1].id, chapters[2].id]);
    // 全量：大纲 6 章、正文 6 行文档（范围不裁正文）
    expect(chapters).toHaveLength(6);
    expect(getDocumentTextLengths(project.db, "chapter", chapters.map((chapter) => chapter.id)).size).toBe(6);
  });

  it("范围夹取：scope_end 超章数 → 夹到末章（等同全量）；scope_start 越界 → 零批但正文照导入", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const clamped = await startOk(app, bytesOf(novelText(6)), startQuery("夹取", "&scope_end=999"));
    const clampedProject = getCurrentProject()!;
    const clampedJob = getDecomposeJob(clampedProject.db)!;

    expect([clampedJob.scope_start, clampedJob.scope_end]).toEqual([1, 6]);
    expect(clamped.batchCount).toBe(1);

    const empty = await startOk(app, bytesOf(novelText(6)), startQuery("落空", "&scope_start=99"));
    const emptyProject = getCurrentProject()!;
    const emptyJob = getDecomposeJob(emptyProject.db)!;
    const emptyChapters = (readOutlineFile(bookDir("落空")).children[0] as OutlineFileVolume).children ?? [];

    expect(empty.batchCount).toBe(0); // 范围落空：零批不报 400（与 analyze 同口径）
    expect(listDecomposeBatches(emptyProject.db, emptyJob.id)).toEqual([]);
    expect([emptyJob.scope_start, emptyJob.scope_end]).toEqual([99, 6]); // start > end = 落空
    expect(emptyJob.status).toBe("running");
    expect(getDocumentTextLengths(emptyProject.db, "chapter", emptyChapters.map((chapter) => chapter.id)).size).toBe(6);
  });

  it("书名冲突 → 409 PROJECT_ALREADY_EXISTS（不覆盖已存在的书）", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const first = await startOk(app, bytesOf(novelText(6)), startQuery("重名"));
    const res = await postStart(app, bytesOf(novelText(6)), startQuery("重名"));

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("PROJECT_ALREADY_EXISTS");
    expect(readProjectFile(bookDir("重名"))?.id).toBe(first.projectId); // 原书未被改写
    expect(listDecomposeBatches(getCurrentProject()!.db, first.jobId)).toHaveLength(1); // 也没多出一条 job
  });

  it("凭据缺失 → 400 LLM_API_KEY_MISSING 且不留半成品项目", async () => {
    const app = buildApp(); // 真实运行时：HOME 隔离 + 无凭据（见 beforeEach）
    const res = await postStart(app, bytesOf(novelText(6)), startQuery("无凭据"));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("LLM_API_KEY_MISSING");
    expect(existsSync(bookDir("无凭据"))).toBe(false);
    expect(existsSync(join(tmpRoot, "books"))).toBe(false); // 连 books/ 都没建
    expect(getCurrentProject()).toBeNull();
  });

  it("非法书名（路径逃逸）→ 400 INVALID_PROJECT_PATH，books/ 外零写入", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    for (const name of ["../evil", "a/b", "a\\b", "..", "\u0000"]) {
      const res = await postStart(app, bytesOf(novelText(6)), startQuery(name));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_PROJECT_PATH");
    }
    expect(existsSync(join(tmpRoot, "evil"))).toBe(false);
    expect(existsSync(join(tmpRoot, "books"))).toBe(false);
  });

  it("超体积 / 空文本 / 缺 name → 400，且不建目录", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const tooLarge = await postStart(app, new Uint8Array(DECOMPOSE_MAX_FILE_BYTES + 1), startQuery("大文件"));
    const empty = await postStart(app, new Uint8Array(0), startQuery("空文件"));
    const missingName = await postStart(app, bytesOf(novelText(6)), `file_name=a.txt`);

    expect((await tooLarge.json()).error.code).toBe("DECOMPOSE_FILE_TOO_LARGE");
    expect((await empty.json()).error.code).toBe("DECOMPOSE_FILE_INVALID");
    expect(missingName.status).toBe(400);
    expect((await missingName.json()).error.code).toBe("VALIDATION_ERROR");
    expect(existsSync(join(tmpRoot, "books"))).toBe(false);
  });
});

describe("GET /decompose/job（进度轮询）", () => {
  it("当前项目没有 job → 404 DECOMPOSE_JOB_NOT_FOUND（batches 同码）", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    setCurrentProject(initProject(bookDir("空项目"), { name: "空项目" }));

    const job = await app.request("/api/v1/decompose/job", { headers: HOST_HEADERS });
    const batch = await app.request("/api/v1/decompose/job/batches/1", { headers: HOST_HEADERS });

    expect(job.status).toBe(404);
    expect((await job.json()).error.code).toBe("DECOMPOSE_JOB_NOT_FOUND");
    expect(batch.status).toBe(404);
    expect((await batch.json()).error.code).toBe("DECOMPOSE_JOB_NOT_FOUND");
  });

  it("不含批结果正文；stage 从 extract → merge；章节标题/序号/字数与大纲同源", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    // 直接跑 S1（本用例看的是批执行**前**的投影；经 route 起 job 的话后台批循环会实时改写批行）
    const jobId = ingestProject("进度");
    const project = getCurrentProject()!;

    const running = await jobData(app);
    expect(running).toMatchObject({
      jobId,
      status: "running",
      stage: "extract", // 批未收口 = 逐章抽取
      scopeStart: 1,
      scopeEnd: 6,
      error: null,
      report: null, // 报告（S4）尚未落盘
    });
    expect(running.progress).toEqual({ done: 0, failed: 0, total: 1 });
    expect(running.batches[0].chapterIndexes).toEqual([1, 2, 3, 4, 5, 6]);
    expect(running.batches[0].chapterTitles).toEqual(["标题1", "标题2", "标题3", "标题4", "标题5", "标题6"]);
    const chapterIds = (readOutlineFile(project.root).children[0] as OutlineFileVolume).children!.map((c) => c.id);
    const textLengths = getDocumentTextLengths(project.db, "chapter", chapterIds);
    expect(running.batches[0].charCount).toBe([...textLengths.values()].reduce((total, length) => total + length, 0));
    expect(running.batches[0]).not.toHaveProperty("result"); // 列表口径不含批结果正文

    completeBatch(project.db, { jobId, seq: 1, result: batchResult(), now: nowIso() });
    const settled = await jobData(app);

    expect(settled.progress).toEqual({ done: 1, failed: 0, total: 1 });
    expect(settled.stage).toBe("merge"); // 批全部收口 ⇒ 归并
    expect(settled.batches[0].status).toBe("done");
    expect(JSON.stringify(settled)).not.toContain("绝密摘要标记"); // 结果正文不出现在进度响应里
  });

  it("stage：pending → ingest；done → done", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const project = initProject(bookDir("阶段"), { name: "阶段" });
    setCurrentProject(project);
    const job = createDecomposeJob(project.db, {
      scopeStart: 1,
      scopeEnd: 1,
      batchTargetChars: DECOMPOSE_BATCH_TARGET_CHARS,
      model: null,
      batches: [{ seq: 1, chapterIds: [] }],
      now: "2026-08-01T10:00:00Z",
    });

    expect(await jobData(app)).toMatchObject({ status: "pending", stage: "ingest", report: null });
    updateJobStatus(project.db, job.id, "done", "2026-08-01T10:01:00Z");
    expect(await jobData(app)).toMatchObject({ status: "done", stage: "done" });
  });

  it("多 job 并存取最新：created_at 降序 → id 降序", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const project = initProject(bookDir("多job"), { name: "多job" });
    setCurrentProject(project);
    const makeJob = (now: string) =>
      createDecomposeJob(project.db, {
        scopeStart: 1,
        scopeEnd: 1,
        batchTargetChars: DECOMPOSE_BATCH_TARGET_CHARS,
        model: null,
        batches: [],
        now,
      });
    const first = makeJob("2026-08-01T10:00:00Z");
    const second = makeJob("2026-08-01T10:00:00Z"); // 同一 created_at ⇒ 判据落在 id 降序
    const expected = first.id > second.id ? first : second;
    const other = first.id > second.id ? second : first;

    expect((await jobData(app)).jobId).toBe(expected.id);
    expect((await jobData(app)).jobId).not.toBe(other.id);

    const later = makeJob("2026-08-01T11:00:00Z"); // created_at 更新 ⇒ 盖过 id 排序
    expect((await jobData(app)).jobId).toBe(later.id);
  });
});

describe("GET /decompose/job/batches/:seq（单批结果）", () => {
  it("未完成 → result null；完成后 → 契约形状；越界 / 非数字 → 404 DECOMPOSE_BATCH_NOT_FOUND", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const jobId = ingestProject("单批"); // 直接跑 S1：本用例要的正是「批未跑」的初始行（见 ingestProject 注释）
    const project = getCurrentProject()!;

    expect(await batchData(app, "1")).toEqual({ seq: 1, status: "pending", attempts: 0, error: null, result: null });

    completeBatch(project.db, { jobId, seq: 1, result: batchResult(), now: nowIso() });
    const done = await batchData(app, "1");
    expect(done.status).toBe("done");
    expect(done.result?.chapters[0]).toMatchObject({ chapterIndex: 1, chapterTitle: "标题1", summary: "绝密摘要标记" });

    for (const seq of ["99", "0", "abc"]) {
      const res = await app.request(`/api/v1/decompose/job/batches/${seq}`, { headers: HOST_HEADERS });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("DECOMPOSE_BATCH_NOT_FOUND");
    }
  });

  it("批 result 脏形状（db 层不校验）→ 守卫后按「未完成」透出", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const jobId = ingestProject("脏结果"); // 直接跑 S1（同上：不经 route ⇒ 无后台批循环改写）
    const project = getCurrentProject()!;
    // db 层只保证坏 JSON 不抛错：`[1,2]` 这类非契约形状会原样落库
    completeBatch(project.db, { jobId, seq: 1, result: [1, 2] as unknown as DecomposeBatchResult, now: nowIso() });

    const data = await batchData(app, "1");
    expect(data.result).toBeNull(); // 不透出脏数据
    expect(data.status).toBe("done"); // 状态照常（只是结果不可信）
  });
});

// ============ 卡 22.4：GET /api/v1/decompose/job/log（拆解记录时间线） ============
//
// 覆盖：只投影 `customType = decompose` 的 custom 条目（message / model_change / session_info /
// 别的扩展的 custom 条目一律滤掉 ⇒ 原文与模型产出不可能泄漏）、顺序 = 文件顺序 /
// job 在但会话文件被删 → 200 空数组（不回 404）/ 无 job → 404 DECOMPOSE_JOB_NOT_FOUND。

/** 过程条目（时间线唯一写入方 = server `decompose/llm.ts` 的 `log()`，形状与它逐字同源） */
interface SeededLog {
  kind: string;
  text: string;
  batchSeq?: number;
}

/**
 * 落一枚真拆解会话文件（会话 id = `decompose-<jobId>`，与 llm.ts 同一组装函数）并写入条目。
 * pi 只在文件里出现 assistant 消息后才落盘（`SessionManager._persist`）⇒ 夹具补一轮问答。
 * 同时混入非 decompose 条目（其它 customType / 原文消息 / 元数据），供「滤除」断言用。
 */
function seedDecomposeSession(projectRoot: string, jobId: string, logs: readonly SeededLog[]): string {
  const sessionId = decomposeSessionId(jobId);
  const manager = SessionManager.create(projectRoot, projectSessionsDir(projectRoot), { id: sessionId });
  manager.appendSessionInfo("《时间线》拆解");
  for (const log of logs) {
    manager.appendCustomEntry(DECOMPOSE_LOG_CUSTOM_TYPE, { ...log, at: new Date().toISOString() });
  }
  manager.appendCustomEntry("other-extension", { kind: "other", text: "别的扩展写的条目" });
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "批 1 正文原文：绝不外泄标记" }],
    timestamp: Date.now(),
  });
  manager.appendMessage(fauxAssistantMessage("绝密摘要标记"));
  return sessionId;
}

async function logData(app: Hono): Promise<DecomposeJobLogRes> {
  const res = await app.request("/api/v1/decompose/job/log", { headers: HOST_HEADERS });
  expect(res.status).toBe(200);
  return (await res.json()).data as DecomposeJobLogRes;
}

describe("GET /decompose/job/log（拆解记录时间线）", () => {
  it("只投影 customType=decompose 的条目（顺序 = 文件顺序）；原文 / 批产出 / 别的扩展条目都不进响应", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const jobId = ingestProject("时间线");
    const project = getCurrentProject()!;
    const sessionId = seedDecomposeSession(project.root, jobId, [
      { kind: "batch_start", batchSeq: 1, text: "批 1 开始（3 章）" },
      { kind: "attempt_failed", batchSeq: 1, text: "批 1 第 1 次尝试失败：模型输出缺章 2" },
      { kind: "merge_done", text: "归并完成：实体 12 / 关系 3" },
    ]);

    const data = await logData(app);

    expect(data.sessionId).toBe(sessionId);
    expect(data.sessionId).toBe(decomposeSessionId(jobId));
    expect(data.entries.map((entry) => [entry.kind, entry.text, entry.batchSeq])).toEqual([
      ["batch_start", "批 1 开始（3 章）", 1],
      ["attempt_failed", "批 1 第 1 次尝试失败：模型输出缺章 2", 1],
      ["merge_done", "归并完成：实体 12 / 关系 3", undefined],
    ]);
    expect(data.entries.every((entry) => !Number.isNaN(Date.parse(entry.at)))).toBe(true);
    expect(data.entries.every((entry) => entry.id !== "")).toBe(true);

    const raw = JSON.stringify(data);
    expect(raw).not.toContain("绝不外泄标记"); // 原文消息（user）不进响应
    expect(raw).not.toContain("绝密摘要标记"); // 批结果正文（assistant）不进响应
    expect(raw).not.toContain("别的扩展写的条目"); // 其它 customType 被滤掉
    expect(raw).not.toContain("《时间线》拆解"); // session_info / model_change 等元数据条目不进响应
  });

  it("拆解会话文件不存在（尚未落盘 / 被用户删掉）→ 200 + entries: []（不回 404）", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    ingestProject("无会话"); // 直接跑 S1：job 已落库，但没有任何会话文件（没起 S2）

    const data = await logData(app);
    expect(data.entries).toEqual([]);
  });

  it("当前项目没有 job → 404 DECOMPOSE_JOB_NOT_FOUND", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    setCurrentProject(initProject(bookDir("无 job"), { name: "无 job" }));

    const res = await app.request("/api/v1/decompose/job/log", { headers: HOST_HEADERS });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("DECOMPOSE_JOB_NOT_FOUND");
  });
});

// ============ 卡 22.7：GET /decompose/plan + POST /decompose/continue（续拆） ============
//
// 覆盖：plan 缺省范围（未拆章最小覆盖区间）/ 已拆标注（历史**所有** job 的 done 批并集）/ 显式范围
// （defaulted=false + decomposedInScope = 将重拆）/ 不落库 / stats 与 estimate（与 analyze 同一实现、
// 同一公式与同一费率口径）/ 无章 404 / 范围非法 400 / 无未拆章 → 0-0；continue 互斥 409（running /
// paused）/ 空范围 400 / 凭据缺失 400 不落行 / 成功时 **S1' 只落 job 与批规划**（outline.json 与
// document_records 未被改动）+ batchCount 与 plan 同源 + 历史 job 全留 + 批行章序正确。

/** 已拆夹具：按 scope 落一个 job 并把它的批标 `done`、job 置 `done`（模拟历史 job 拆过的章） */
function decomposedJob(name: string, chapterCount: number, scope: { start: number; end: number }): string {
  const jobId = ingestProject(name, chapterCount, scope);
  const project = getCurrentProject()!;
  for (const batch of listDecomposeBatches(project.db, jobId)) {
    completeBatch(project.db, { jobId, seq: batch.seq, result: batchResult(), now: nowIso() });
  }
  updateJobStatus(project.db, jobId, "done", nowIso());
  return jobId;
}

/** 大纲里的章节点 id（文件位置序；单卷兜底 ⇒ children[0] 是卷） */
function chapterIdsOf(root: string): string[] {
  const tree = readOutlineFile(root);
  return (tree.children[0] as OutlineFileVolume).children!.map((chapter) => chapter.id);
}

describe("GET /decompose/plan（续拆预览）", () => {
  it("缺省范围 = 未拆章最小覆盖区间；已拆章带标注；不落库、无状态", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const jobId = decomposedJob("续拆缺省", 6, { start: 1, end: 2 });
    const project = getCurrentProject()!;
    const chapterIds = chapterIdsOf(project.root);
    const lengths = getDocumentTextLengths(project.db, "chapter", chapterIds);

    const plan = await planData(app);

    expect(plan).toMatchObject({ scopeStart: 3, scopeEnd: 6, defaulted: true, remainingCount: 4, decomposedInScope: 0 });
    expect(plan.chapters.map((chapter) => chapter.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.chapters.map((chapter) => chapter.decomposed)).toEqual([true, true, false, false, false, false]);
    expect(plan.chapters[0]).toMatchObject({ title: "标题1", volumeIndex: 0, charCount: lengths.get(chapterIds[0]) });
    // 没有新 job / 批行落库（预览无副作用）
    expect(listDecomposeJobs(project.db)).toHaveLength(1);
    expect(listDecomposeBatches(project.db, jobId)).toHaveLength(1);
  });

  it("显式范围含已拆章 = 有意重拆：defaulted=false + decomposedInScope；estimate 与 analyze 同一实现", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    decomposedJob("续拆显式", 6, { start: 1, end: 2 });
    const project = getCurrentProject()!;
    const chapterIds = chapterIdsOf(project.root);
    const lengths = getDocumentTextLengths(project.db, "chapter", chapterIds);

    const plan = await planData(app, "scope_start=1&scope_end=4");

    expect(plan).toMatchObject({ scopeStart: 1, scopeEnd: 4, defaulted: false, remainingCount: 4, decomposedInScope: 2 });
    // 公式单源：输入 = 范围正文 / 每字 token 数 + 每批固定开销；输出 = 章数 × 每章输出；调用 = 批数 + 归并 + 报告
    const chars = [1, 2, 3, 4].reduce((sum, index) => sum + (lengths.get(chapterIds[index - 1]) ?? 0), 0);
    const inputTokens = Math.ceil(chars / DECOMPOSE_CHARS_PER_TOKEN) + plan.estimate.batchCount * DECOMPOSE_BATCH_OVERHEAD_TOKENS;
    const outputTokens = 4 * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER;
    expect(plan.estimate).toEqual({
      batchCount: plan.estimate.batchCount,
      llmCalls: plan.estimate.batchCount + 2,
      inputTokensApprox: inputTokens,
      outputTokensApprox: outputTokens,
      costApprox: (inputTokens * 0.5 + outputTokens * 1.5) / 1_000_000, // 费率口径 = pi 模型目录 Model.cost（每百万 token）
    });
    // 跨端点同源：同一组章（4 章）在 analyze 与 plan 上组批与调用数一致
    const analyze = await analyzeOk(app, bytesOf(novelText(6)), "file_name=同源.txt&scope_start=1&scope_end=4");
    expect(analyze.estimate.batchCount).toBe(plan.estimate.batchCount);
    expect(analyze.estimate.llmCalls).toBe(plan.estimate.llmCalls);
  });

  it("范围参数非法（非整数 / 越界 / start > end）→ 400 VALIDATION_ERROR", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    decomposedJob("续拆非法", 6, { start: 1, end: 2 });

    for (const query of ["scope_start=abc", "scope_start=0", "scope_start=5&scope_end=2"]) {
      const res = await app.request(`/api/v1/decompose/plan?${query}`, { headers: HOST_HEADERS });
      expect(res.status, query).toBe(400);
      expect((await res.json()).error.code, query).toBe("VALIDATION_ERROR");
    }
  });

  it("没有已打开项目 → 409 NO_PROJECT_OPEN；项目里没有章 → 404 DECOMPOSE_NO_CHAPTERS", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));

    const noProject = await app.request("/api/v1/decompose/plan", { headers: HOST_HEADERS });
    expect(noProject.status).toBe(409);
    expect((await noProject.json()).error.code).toBe("NO_PROJECT_OPEN");

    setCurrentProject(initProject(bookDir("没有章"), { name: "没有章" }));
    const empty = await app.request("/api/v1/decompose/plan", { headers: HOST_HEADERS });
    expect(empty.status).toBe(404);
    expect((await empty.json()).error.code).toBe("DECOMPOSE_NO_CHAPTERS");
  });

  it("无未拆章 → scopeStart/scopeEnd = 0、remainingCount = 0（零批 + 归并/报告两次调用）", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    decomposedJob("续拆全拆完", 6, { start: 1, end: 6 });

    const plan = await planData(app);

    expect(plan).toMatchObject({ scopeStart: 0, scopeEnd: 0, defaulted: true, remainingCount: 0, decomposedInScope: 0 });
    expect(plan.chapters.every((chapter) => chapter.decomposed)).toBe(true);
    expect(plan.estimate).toMatchObject({ batchCount: 0, llmCalls: 2, outputTokensApprox: 0 });
  });
});

describe("POST /decompose/continue（续拆启动）", () => {
  it("已有未收尾 job（running / paused）→ 409 DECOMPOSE_JOB_STATE，不落新 job", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const jobId = ingestProject("续拆互斥", 6, { start: 1, end: 2 }); // job 留在 running
    const project = getCurrentProject()!;

    const running = await postContinue(app);
    expect(running.status).toBe(409);
    expect((await running.json()).error.code).toBe("DECOMPOSE_JOB_STATE");

    updateJobStatus(project.db, jobId, "paused", nowIso());
    const paused = await postContinue(app);
    expect(paused.status).toBe(409);
    expect((await paused.json()).error.code).toBe("DECOMPOSE_JOB_STATE");

    expect(listDecomposeJobs(project.db)).toHaveLength(1);
  });

  it("缺省范围里没有未拆章 → 400 DECOMPOSE_NOTHING_TO_DO，不落新 job", async () => {
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    decomposedJob("续拆无事可做", 6, { start: 1, end: 6 });
    const project = getCurrentProject()!;

    const res = await postContinue(app);

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("DECOMPOSE_NOTHING_TO_DO");
    expect(listDecomposeJobs(project.db)).toHaveLength(1);
  });

  it("缺模型/凭据 → 400 LLM_API_KEY_MISSING（在建 job 之前校验），不落 job 行", async () => {
    const app = buildApp(); // 缺省 deps：本文件已隔离 HOME + 清空 provider env ⇒ 无凭据
    decomposedJob("续拆无凭据", 6, { start: 1, end: 2 });
    const project = getCurrentProject()!;

    const res = await postContinue(app);

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("LLM_API_KEY_MISSING");
    expect(listDecomposeJobs(project.db)).toHaveLength(1);
  });

  it("成功：S1' 只落 job 与批规划（不动 outline.json / document_records）；batchCount 与 plan 同源", async () => {
    // 空脚本：批必失败（faux 无排队响应）⇒ S2/S3 不会写业务表；S3 的第一次模型调用（别名归并）就在
    // 写章摘要之前 ⇒ 本用例期间 outline.json 不会被 S3 改写（否定断言的确定性来源）
    const app = buildApp(await runtimeWithCost(0.5, 1.5));
    const firstJobId = decomposedJob("续拆落job", 6, { start: 1, end: 2 });
    const project = getCurrentProject()!;
    const outlineBefore = readFileSync(join(project.root, OUTLINE_FILE_NAME), "utf8");
    const chapterIds = chapterIdsOf(project.root);
    const documentsBefore = chapterIds.map((id) => getDocument(project.db, "chapter", id)?.content ?? null);
    const plan = await planData(app);

    const res = await postContinue(app);
    expect(res.status).toBe(200);
    const data = (await res.json()).data as DecomposeContinueRes;

    expect(data).toMatchObject({
      scopeStart: plan.scopeStart,
      scopeEnd: plan.scopeEnd,
      status: "running",
      batchCount: plan.estimate.batchCount, // 预览说几批，落的就是几批（同一组批实现）
    });
    // 历史 job 全留（行与批结果都在 data.db）：两行
    expect(new Set(listDecomposeJobs(project.db).map((job) => job.id))).toEqual(new Set([firstJobId, data.jobId]));
    // 新 job 的批行 = 未拆章（3–6，一批；章序经大纲映射回文件位置序）
    const numberById = new Map(deriveChapterOrder(project.root).map((entry) => [entry.chapterId, entry.chapterNumber]));
    expect(
      listDecomposeBatches(project.db, data.jobId).map((batch) => batch.chapter_ids.map((id) => numberById.get(id))),
    ).toEqual([[3, 4, 5, 6]]);
    // **S1' 的否定断言**：不建大纲、不导正文（正文是 S1 的全量一次性产物）
    expect(readFileSync(join(project.root, OUTLINE_FILE_NAME), "utf8")).toBe(outlineBefore);
    expect(chapterIds.map((id) => getDocument(project.db, "chapter", id)?.content ?? null)).toEqual(documentsBefore);
    // S2 后台跑（不 await）：等这一轮收尾，避免用例结束后写库
    await waitFor(() => !isDecomposeJobActive(data.jobId), "续拆轮次收尾");
  });
});
