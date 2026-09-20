// 卡 21.4 拆解 analyze 路由测试：POST /api/v1/decompose/analyze（切分预览，无状态）
// 覆盖：正常预览（编码 / 章列表全量 / 统计 / 警告 / 默认书名）/ 超体积 400 / 空文本与空白文本 400 /
// query 校验 400 / **不要求项目已打开** / 范围只影响 estimate（章列表不变、越界落成零批）/
// estimate 公式（批数 + 每批固定开销 + 每章输出）/ costApprox 两态（未配置模型凭据 → null；
// 注入内存运行时 + faux 费率 → 按 pi 模型目录 `Model.cost` 算出）。
// fixture 全部自造，不读 test-project/（该目录整体不入库）。

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type {
  DecomposeAnalyzeRes,
  DecomposeBatchRes,
  DecomposeBatchResult,
  DecomposeJobRes,
  DecomposeStartRes,
  OutlineFileVolume,
} from "@whispering233/ai-editor-shared";
import {
  completeBatch,
  createDecomposeJob,
  getDecomposeJob,
  getDocument,
  getDocumentTextLengths,
  listDecomposeBatches,
  nowIso,
  readOutlineFile,
  readProjectFile,
  updateJobStatus,
} from "@whispering233/ai-editor-db";
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
import { setProjectRoot } from "./project.js";
import { resetModelRuntime } from "../model-runtime.js";
import {
  DECOMPOSE_BATCH_OVERHEAD_TOKENS,
  DECOMPOSE_CHARS_PER_TOKEN,
  DECOMPOSE_MAX_FILE_BYTES,
  DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER,
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

/** 内存运行时 + 内存 settings：注册一个带费率的 faux provider（费率进 pi 模型目录） */
async function runtimeWithCost(input: number, output: number): Promise<DecomposeRouteDeps> {
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

/** 一批的最小契约形状（S2 才写，本卡测试直接落库造） */
function batchResult(): DecomposeBatchResult {
  return {
    chapters: [
      { chapterIndex: 1, chapterTitle: "标题1", summary: "绝密摘要标记", characters: [], settings: [], locations: [], relations: [] },
    ],
  };
}

describe("POST /decompose/start（S1 建档）", () => {
  it("建档成功：大纲卷章 / 正文全量导入 / 批规划落库 / 切项目 + lastProject", async () => {
    const deps = await runtimeWithCost(0.5, 1.5);
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
    expect(batches[0]).toMatchObject({ seq: 1, status: "pending", attempts: 0, error: null });
    expect(batches[0].chapter_ids).toEqual(chapterIds); // 批行按章序映射到章节点 id

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
    const started = await startOk(app, bytesOf(novelText(6)), startQuery("进度"));
    const project = getCurrentProject()!;

    const running = await jobData(app);
    expect(running).toMatchObject({
      jobId: started.jobId,
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

    completeBatch(project.db, { jobId: started.jobId, seq: 1, result: batchResult(), now: nowIso() });
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
    const started = await startOk(app, bytesOf(novelText(6)), startQuery("单批"));
    const project = getCurrentProject()!;

    expect(await batchData(app, "1")).toEqual({ seq: 1, status: "pending", attempts: 0, error: null, result: null });

    completeBatch(project.db, { jobId: started.jobId, seq: 1, result: batchResult(), now: nowIso() });
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
    const started = await startOk(app, bytesOf(novelText(6)), startQuery("脏结果"));
    const project = getCurrentProject()!;
    // db 层只保证坏 JSON 不抛错：`[1,2]` 这类非契约形状会原样落库
    completeBatch(project.db, { jobId: started.jobId, seq: 1, result: [1, 2] as unknown as DecomposeBatchResult, now: nowIso() });

    const data = await batchData(app, "1");
    expect(data.result).toBeNull(); // 不透出脏数据
    expect(data.status).toBe("done"); // 状态照常（只是结果不可信）
  });
});
