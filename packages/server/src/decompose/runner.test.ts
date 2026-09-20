// 卡 21.6 拆解 S2 批执行器测试：串行批循环 / 逐章对齐重试 / 失败批不阻塞 / 滚动故事圣经 /
// 暂停（批间）与续拆（跳过 done 批）/ 切书自动暂停 / 重启归一 / stage = merge 口径 / job 级失败。
//
// 全部经 **faux provider（内存运行时注册假模型）离线跑**，不触网、不调真实模型；
// 批循环是后台任务（路由不 await）⇒ 断言前统一用 `waitFor` 轮询等服务端落库。

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  contentText,
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  type AssistantMessage,
  type Context,
} from "@earendil-works/pi-ai";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { DecomposeBatchResult, DecomposeJobRes } from "@whispering233/ai-editor-shared";
import { decomposeBatchResultSchema } from "@whispering233/ai-editor-shared/schemas";
import {
  completeBatch,
  createDecomposeJob,
  getDecomposeBatch,
  getDecomposeJob,
  getDocument,
  listDecomposeBatches,
  listEntities,
  nowIso,
  startBatchAttempt,
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
import { resetModelRuntime } from "../model-runtime.js";
import { setProjectRoot } from "../routes/project.js";
import { createDecomposeRoutes, type DecomposeRouteDeps } from "../routes/decompose.js";
import { DECOMPOSE_BATCH_TARGET_CHARS } from "./batching.js";
import {
  DECOMPOSE_CHAPTER_MAX_CHARACTERS,
  DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS,
  DECOMPOSE_RELATION_TYPES,
} from "./extract.js";
import { ingestDecomposeProject } from "./job.js";
import {
  DECOMPOSE_BATCH_MAX_ATTEMPTS,
  DECOMPOSE_BIBLE_MAX_CHARS,
  emptyStoryBible,
  extendStoryBible,
  startDecomposeJob,
  storyBibleText,
} from "./runner.js";
import { splitNovelWithSlices } from "./split.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const UPLOAD_HEADERS = { ...HOST_HEADERS, "content-type": "application/octet-stream" };

/** 样本单章原文（标题行 + 正文）：12 章会在组批上限处拆成 [1..10] 与 [11,12] 两批 */
function chapterSource(position: number): string {
  return `第${position}章 标题${position}\n${"正文".repeat(150 + (position - 1) * 20)}`;
}

function novelText(chapterCount: number): string {
  return Array.from({ length: chapterCount }, (_, position) => chapterSource(position + 1)).join("\n");
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 章序区间（含端点） */
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

/** 一批的模型输出（可选注入 relation / 改摘要前缀） */
function batchJson(options: { indexes: readonly number[]; summaryPrefix?: string; relation?: { source: string; target: string; type: string } }): string {
  const summaryPrefix = options.summaryPrefix ?? "摘要";
  return JSON.stringify({
    chapters: options.indexes.map((index) => ({
      chapterIndex: index,
      chapterTitle: `标题${index}`,
      summary: `${summaryPrefix}${index}`,
      characters: [{ name: `人物${index}`, role: "配角", description: `描述${index}` }],
      settings: [],
      locations: [],
      relations:
        options.relation !== undefined && index === options.indexes[options.indexes.length - 1]
          ? [{ ...options.relation, evidence: "证据" }]
          : [],
    })),
  });
}

/** S3 别名归并回复：无组（批循环测试不关心别名合并） */
const NO_ALIASES = JSON.stringify({ groups: [] });
/** S4 报告回复（全书剧情摘要正文；报告调用恒发一次） */
const PLOT_SUMMARY = "全书剧情摘要。";

/** 组装带中间件的测试 app（与 index.ts 同款装配顺序） */
function buildApp(deps: DecomposeRouteDeps): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/decompose", createDecomposeRoutes(deps));
  return app;
}

function post(app: Hono, path: string, query = ""): Promise<Response> {
  return app.request(`/api/v1/decompose${path}${query === "" ? "" : `?${query}`}`, {
    method: "POST",
    headers: HOST_HEADERS,
  });
}

function postNovel(app: Hono, path: string, body: Uint8Array, query: string): Promise<Response> {
  return app.request(`/api/v1/decompose${path}?${query}`, { method: "POST", headers: UPLOAD_HEADERS, body });
}

/** start 的 query（file_name 固定，书名可改；extra 追加 scope 等参数） */
function startQuery(name: string, extra = ""): string {
  return `file_name=${encodeURIComponent("斗破苍穹.txt")}&name=${encodeURIComponent(name)}${extra}`;
}

function bookDir(name: string): string {
  return join(tmpRoot, "books", name);
}

/** 启动拆解（断言 200），返回响应 data（extra = 追加的 query，如 scope） */
async function startOk(
  app: Hono,
  name: string,
  chapterCount = 12,
  extra = "",
): Promise<{ jobId: string; batchCount: number }> {
  const res = await postNovel(app, "/start", bytesOf(novelText(chapterCount)), startQuery(name, extra));
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

/** GET /decompose/job 的响应 data（进度轮询面） */
async function getJob(app: Hono): Promise<DecomposeJobRes> {
  const res = await app.request("/api/v1/decompose/job", { headers: HOST_HEADERS });
  expect(res.status).toBe(200);
  return (await res.json()).data as DecomposeJobRes;
}

/** 轮询到 job 状态为终态（done / failed）——批循环 + S3/S4 都是后台任务 */
async function pollJob(app: Hono, label: string): Promise<DecomposeJobRes> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const job = await getJob(app);
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等待超时：${label}`);
}

/** 轮询等待（fire-and-forget 的批循环是后台任务；超时即测试失败） */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等待超时：${label}`);
}

/**
 * 直接跑 S1（**不经 route** ⇒ 不起 S2 批循环）：需要「批执行前」状态确定性夹具时用（经 route 建 job 会直接开跑）。
 * 调用顺序与 start 路由一致：先切项目（归一在 job 存在之前）再建档。
 */
function ingestProject(name: string, chapterCount = 6): string {
  const project = initProject(bookDir(name), { name });
  setCurrentProject(project);
  const split = splitNovelWithSlices(bytesOf(novelText(chapterCount)));
  const { jobId } = ingestDecomposeProject({
    project,
    split,
    scopedChapters: split.result.chapters,
    scopeStart: 1,
    scopeEnd: chapterCount,
    model: null,
    now: nowIso(),
  });
  return jobId;
}

// ============ faux provider（离线假模型；记录每次调用的上下文） ============

type ScriptedStep = string | (() => Promise<AssistantMessage>);

interface FakeModel {
  deps: DecomposeRouteDeps;
  /** 按调用顺序排队下一步输出（字符串 = 模型正文；函数 = 自定义，可挂起等测试放行） */
  script(steps: readonly ScriptedStep[]): void;
  /** 已发生的调用（按顺序；`systemPrompt` 与 `messages` 即提示词） */
  calls: Context[];
}

async function fakeModel(): Promise<FakeModel> {
  const faux = fauxProvider({
    models: [{ id: "faux-a", name: "Faux A", contextWindow: 128_000, maxTokens: 8192 }],
  });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "faux-key" }));
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  const calls: Context[] = [];
  return {
    deps: { runtime, settings: SettingsManager.inMemory({}) },
    calls,
    script: (steps) =>
      faux.setResponses(
        steps.map((step) => async (context) => {
          calls.push(context);
          return typeof step === "function" ? await step() : fauxAssistantMessage(step);
        }),
      ),
  };
}

/** 第 n 次调用的用户消息（故事圣经 + 本批正文） */
function promptOf(calls: readonly Context[], index: number): string {
  const content = calls[index].messages[0].content;
  return typeof content === "string" ? content : contentText(content);
}

// ============ 环境隔离（HOME + 凭据环境变量；与 routes/decompose.test.ts 同款） ============

let tmpRoot: string;
let originalHome: string | undefined;
const credentialEnv: Array<[string, string]> = [];

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-decompose-runner-"));
  setCurrentProject(null);
  setProjectRoot(tmpRoot);
  originalHome = process.env.HOME;
  process.env.HOME = tmpRoot;
  for (const key of Object.keys(process.env)) {
    if (!/(API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key)) continue;
    credentialEnv.push([key, process.env[key]!]);
    delete process.env[key];
  }
  resetModelRuntime();
});

afterEach(() => {
  resetModelRuntime();
  const project = getCurrentProject();
  if (project !== null) closeProject(project);
  setCurrentProject(null);
  setProjectRoot(null);
  for (const [key, value] of credentialEnv.splice(0)) process.env[key] = value;
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ============ S2 批循环（faux provider 端到端） ============

describe("S2 批循环", () => {
  it("start → 两批全 done → S3/S4 收口：批结果形状 / attempts / job done + report 投影", async () => {
    const model = await fakeModel();
    // 第一批输出放围栏 + 围栏后再带一段含花括号的说明文字（模型常见形态：只靠「首尾花括号」夹取会解析失败）
    model.script([
      `\`\`\`json\n${batchJson({ indexes: range(1, 10) })}\n\`\`\`\n以上是本章结果，字段口径见 {"chapters":[]}`,
      batchJson({ indexes: range(11, 12) }),
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "端到端");
    const project = getCurrentProject()!;
    await waitFor(() => listDecomposeBatches(project.db, started.jobId).every((batch) => batch.status === "done"), "两批 done");

    const batches = listDecomposeBatches(project.db, started.jobId);
    expect(batches.map((batch) => [batch.seq, batch.status, batch.attempts, batch.error])).toEqual([
      [1, "done", 1, null],
      [2, "done", 1, null],
    ]);
    // 批结果形状 = 契约 schema（落库前经 extract.ts 归一）
    const first = getDecomposeBatch(project.db, started.jobId, 1)!;
    const parsed = decomposeBatchResultSchema.parse(first.result);
    expect(parsed.chapters.map((chapter) => chapter.chapterIndex)).toEqual(range(1, 10));
    expect(parsed.chapters[0]).toMatchObject({
      chapterTitle: "标题1",
      summary: "摘要1",
      characters: [{ name: "人物1", role: "配角", description: "描述1" }],
    });

    // job：批全部收口后接 S3 归并 + S4 报告 ⇒ 收口为 done，阶段条到 done
    const job = await pollJob(app, "job 收口");
    expect(job).toMatchObject({ status: "done", stage: "done", error: null, progress: { done: 2, failed: 0, total: 2 } });
    expect(job.report).toMatchObject({ name: "《端到端》拆解报告" });
    expect(getDecomposeJob(project.db)!.status).toBe("done");

    // 提示词：本批正文与章序；数字全由常量插值（模型看到的数字与常量同源）
    expect(model.calls).toHaveLength(4); // 两批 + 一次别名归并 + 一次报告
    const firstPrompt = promptOf(model.calls, 0);
    expect(firstPrompt).toContain("【故事圣经】（本批是首批，尚无上文）");
    expect(firstPrompt).toContain("### 第1章 标题1");
    expect(firstPrompt).toContain("正文正文");
    expect(firstPrompt).not.toContain("### 第11章"); // 批边界：本批只带自己那几章
    const systemPrompt = model.calls[0].systemPrompt ?? "";
    expect(systemPrompt).toContain(String(DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS));
    expect(systemPrompt).toContain(String(DECOMPOSE_CHAPTER_MAX_CHARACTERS));
    for (const relationType of DECOMPOSE_RELATION_TYPES) expect(systemPrompt).toContain(relationType);
  });

  it("滚动故事圣经进下一批：名字与上批摘要进提示词，且跨批关系端点不被当幻觉丢弃", async () => {
    const model = await fakeModel();
    // 第二批的关系端点「人物1」只在第一批出现过 ⇒ 靠圣经的 knownNames 才留得下来
    model.script([
      batchJson({ indexes: range(1, 10) }),
      batchJson({ indexes: range(11, 12), relation: { source: "人物1", target: "人物11", type: "ally" } }),
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "圣经");
    const project = getCurrentProject()!;
    await waitFor(() => listDecomposeBatches(project.db, started.jobId).every((batch) => batch.status === "done"), "两批 done");

    const secondPrompt = promptOf(model.calls, 1);
    expect(secondPrompt).toContain("已出现的名字：");
    expect(secondPrompt).toContain("人物1");
    expect(secondPrompt).toContain("上一批摘要：摘要1");
    const second = decomposeBatchResultSchema.parse(getDecomposeBatch(project.db, started.jobId, 2)!.result);
    expect(second.chapters[1].relations).toEqual([{ source: "人物1", target: "人物11", type: "ally", evidence: "证据" }]);
  });

  it("缺章 → 整批重试（同一份提示词）；补齐后 done，attempts = 2", async () => {
    const model = await fakeModel();
    model.script([
      batchJson({ indexes: range(2, 10) }), // 漏第 1 章（本批应覆盖 1..10）
      batchJson({ indexes: range(1, 10) }),
      batchJson({ indexes: range(11, 12) }),
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "缺章重试");
    const project = getCurrentProject()!;
    await waitFor(() => listDecomposeBatches(project.db, started.jobId).every((batch) => batch.status === "done"), "重试后两批 done");

    const batches = listDecomposeBatches(project.db, started.jobId);
    expect(batches.map((batch) => batch.attempts)).toEqual([2, 1]);
    expect(batches[0].error).toBeNull(); // 重试成功 ⇒ 不留失败摘要
    expect((await pollJob(app, "重试后收口")).status).toBe("done");
    expect(model.calls).toHaveLength(5); // 3 批调用（含一次重试）+ 别名归并 + 报告
    expect(promptOf(model.calls, 0)).toBe(promptOf(model.calls, 1)); // 重试 = 同一份提示词
    expect(decomposeBatchResultSchema.parse(getDecomposeBatch(project.db, started.jobId, 1)!.result).chapters.map((c) => c.chapterIndex)).toEqual(range(1, 10));
  });

  it("失败批不阻塞后续批：重试用满上限 → 该批 failed，后批照跑，job 仍收口为 done", async () => {
    const model = await fakeModel();
    const missingFirstChapter = batchJson({ indexes: range(2, 10) });
    model.script([
      missingFirstChapter,
      missingFirstChapter,
      missingFirstChapter,
      batchJson({ indexes: range(11, 12) }),
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "失败批");
    const project = getCurrentProject()!;
    await waitFor(
      () => listDecomposeBatches(project.db, started.jobId).every((batch) => batch.status === "done" || batch.status === "failed"),
      "两批收口",
    );

    const batches = listDecomposeBatches(project.db, started.jobId);
    expect(batches.map((batch) => [batch.status, batch.attempts])).toEqual([
      ["failed", DECOMPOSE_BATCH_MAX_ATTEMPTS],
      ["done", 1],
    ]);
    expect(batches[0].error).toContain("缺章"); // 失败摘要 = 最后一次的错因
    expect(getDecomposeBatch(project.db, started.jobId, 1)!.result).toBeNull(); // 失败批不留残余结果
    // 批级失败不阻塞整个 job：全部批收口（含 failed）后照跑 S3/S4 并收口为 done（失败批可单批重跑）
    const job = await pollJob(app, "job 收口");
    expect(model.calls).toHaveLength(DECOMPOSE_BATCH_MAX_ATTEMPTS + 1 + 2); // 3 次重试 + 后批 + 归并 + 报告
    expect(job).toMatchObject({ status: "done", stage: "done", error: null, progress: { done: 1, failed: 1, total: 2 } });
    expect(getDecomposeJob(project.db)!.status).toBe("done");
    expect(job.report).not.toBeNull();
  });

  it("零批 job：S3/S4 照跑（无章摘要 ⇒ 不发报告调用），job 收口 done", async () => {
    const model = await fakeModel();
    model.script([NO_ALIASES]); // 只有别名归并一次调用（报告无章摘要可聚合）
    const app = buildApp(model.deps);

    const started = await startOk(app, "零批", 6, "&scope_start=99"); // 范围落空 ⇒ 零批 job
    expect(started.batchCount).toBe(0);
    const job = await pollJob(app, "零批 job 收口");
    expect(job).toMatchObject({ status: "done", stage: "done", progress: { done: 0, failed: 0, total: 0 } });
    expect(job.report).toMatchObject({ name: "《零批》拆解报告" });
    expect(model.calls).toHaveLength(1); // 无章摘要 ⇒ 报告调用不发（输入为空）
  });
});

// ============ 暂停 / 续拆 / 切书 / 重启归一 ============

describe("暂停与续拆", () => {
  it("暂停挂在批间：当前批结果不浪费，后续批不开跑；续拆跳过 done 批", async () => {
    const model = await fakeModel();
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let firstCallStarted!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      firstCallStarted = resolve;
    });
    model.script([
      async () => {
        firstCallStarted();
        await gate;
        return fauxAssistantMessage(batchJson({ indexes: range(1, 10) }));
      },
      batchJson({ indexes: range(11, 12) }),
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "暂停");
    await inFlight; // 第一批已在飞
    const project = getCurrentProject()!;
    const paused = await post(app, "/job/pause");
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({ data: { status: "paused" } });
    // 状态立刻可见（不等批收尾），批仍在跑
    expect(getDecomposeJob(project.db)!.status).toBe("paused");
    expect(listDecomposeBatches(project.db, started.jobId)[0].status).toBe("running");

    releaseGate(); // 已发出的调用不 abort：当前批结果照样落库
    await waitFor(() => listDecomposeBatches(project.db, started.jobId)[0].status === "done", "在飞批收尾");
    expect(model.calls).toHaveLength(1); // 时停点 = 批间：第二批没开跑
    expect(listDecomposeBatches(project.db, started.jobId)[1].status).toBe("pending");

    const resumed = await post(app, "/job/resume");
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ data: { status: "running" } });
    await waitFor(() => listDecomposeBatches(project.db, started.jobId).every((batch) => batch.status === "done"), "续拆后两批 done");
    expect(listDecomposeBatches(project.db, started.jobId).map((batch) => batch.attempts)).toEqual([1, 1]); // 第一批没重跑
    expect((await pollJob(app, "续拆收口")).status).toBe("done"); // 续拆跑完接 S3/S4
    expect(model.calls).toHaveLength(4);
  });

  it("读已完成批的 result 前守卫形状：脏 result 不进圣经（否则续拆直接崩）", async () => {
    const model = await fakeModel();
    const app = buildApp(model.deps);
    const jobId = ingestProject("脏结果守卫", 12); // 12 章 ⇒ 两批
    const project = getCurrentProject()!;
    // 第一批已 done 但 result 是脏形状（db 层不校验形状）⇒ 续拆重建圣经时必须丢弃它
    completeBatch(project.db, {
      jobId,
      seq: 1,
      result: { chapters: [{ summary: "脏标记" }] } as unknown as DecomposeBatchResult,
      now: nowIso(),
    });
    updateJobStatus(project.db, jobId, "paused", nowIso());
    model.script([batchJson({ indexes: range(11, 12) }), NO_ALIASES, PLOT_SUMMARY]);

    const resumed = await post(app, "/job/resume");
    expect(resumed.status).toBe(200);
    await waitFor(() => listDecomposeBatches(project.db, jobId)[1].status === "done", "第二批 done");
    expect(promptOf(model.calls, 0)).toContain("【故事圣经】（本批是首批，尚无上文）"); // 脏结果未进圣经
    expect(promptOf(model.calls, 0)).not.toContain("脏标记");
  });

  it("暂停在重试前生效：缺章的批不再重试，留在 running 由续拆承接", async () => {
    const model = await fakeModel();
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let firstCallStarted!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      firstCallStarted = resolve;
    });
    // 第一次输出缺章（本会触发整批重试）；后续排的正常输出不该被消费
    model.script([
      async () => {
        firstCallStarted();
        await gate;
        return fauxAssistantMessage(batchJson({ indexes: range(2, 10) }));
      },
      batchJson({ indexes: range(11, 12) }),
    ]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "暂停不重试");
    await inFlight;
    const project = getCurrentProject()!;
    await post(app, "/job/pause");
    releaseGate();
    await new Promise((resolve) => setTimeout(resolve, 50)); // 留出重试窗口（应有而不发生）

    expect(model.calls).toHaveLength(1); // 暂停后不再重试：不付第二批 token
    expect(listDecomposeBatches(project.db, started.jobId)[0]).toEqual(
      expect.objectContaining({ seq: 1, status: "running", attempts: 1, error: null }), // 未完成 → 续拆承接
    );
  });

  it("状态前置：running 不能续拆 / paused 不能重复暂停 / done 不能暂停", async () => {
    const model = await fakeModel();
    // 别名归并挂起：批全 done 后 job 仍在 running（S3 在飞）⇒ 此时暂停；归并收尾不得盖掉 paused
    let releaseMerge!: () => void;
    const mergeGate = new Promise<void>((resolve) => {
      releaseMerge = resolve;
    });
    let mergeStarted!: () => void;
    const inMerge = new Promise<void>((resolve) => {
      mergeStarted = resolve;
    });
    model.script([
      batchJson({ indexes: range(1, 10) }),
      batchJson({ indexes: range(11, 12) }),
      async () => {
        mergeStarted();
        await mergeGate;
        return fauxAssistantMessage(NO_ALIASES);
      },
      PLOT_SUMMARY,
    ]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "状态前置");
    const project = getCurrentProject()!;

    const resumeRunning = await post(app, "/job/resume");
    expect(resumeRunning.status).toBe(409);
    expect((await resumeRunning.json()).error.code).toBe("DECOMPOSE_JOB_STATE");

    await waitFor(() => listDecomposeBatches(project.db, started.jobId).every((batch) => batch.status === "done"), "两批 done");
    await inMerge; // S3 已在飞（job 仍 running）
    const pauseRunning = await post(app, "/job/pause");
    expect(pauseRunning.status).toBe(200);
    expect(await pauseRunning.json()).toMatchObject({ data: { status: "paused" } });
    releaseMerge();
    await new Promise((resolve) => setTimeout(resolve, 50)); // 归并收尾窗口（应有而不发生 done 回写）
    expect(getDecomposeJob(project.db)!.status).toBe("paused"); // 收尾不盖掉暂停

    const pausePaused = await post(app, "/job/pause");
    expect(pausePaused.status).toBe(409);
    expect((await pausePaused.json()).error.code).toBe("DECOMPOSE_JOB_STATE");

    updateJobStatus(project.db, started.jobId, "done", nowIso());
    const pauseDone = await post(app, "/job/pause");
    expect(pauseDone.status).toBe(409);
    expect((await pauseDone.json()).error.code).toBe("DECOMPOSE_JOB_STATE");
  });

  it("续拆前凭据缺失 → 400 LLM_API_KEY_MISSING 且不改状态", async () => {
    const model = await fakeModel();
    // 第一批挂起 ⇒ 暂停必定落在批中间（否则可能已收口 done，测试变成碰运气）
    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    let batchStarted!: () => void;
    const inBatch = new Promise<void>((resolve) => {
      batchStarted = resolve;
    });
    model.script([
      async () => {
        batchStarted();
        await batchGate;
        return fauxAssistantMessage(batchJson({ indexes: range(1, 10) }));
      },
    ]);
    const app = buildApp(model.deps);
    await startOk(app, "缺凭据续拆");
    await inBatch;
    const project = getCurrentProject()!;
    await post(app, "/job/pause");
    releaseBatch();
    expect(getDecomposeJob(project.db)!.status).toBe("paused");

    // 换一个没有凭据的空运行时（HOME 已隔离 ⇒ 走真实单例也读不到凭据）
    const bare = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
    const bareApp = buildApp({ runtime: bare, settings: SettingsManager.inMemory({}) });
    const res = await post(bareApp, "/job/resume");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("LLM_API_KEY_MISSING");
    expect(getDecomposeJob(project.db)!.status).toBe("paused"); // 状态原样，未留下「running 无 runner」
  });
});

// ============ 单批重跑（§rerun） ============

describe("单批重跑", () => {
  it("done 批重跑：只重跑该批（阶段先回 extract）→ 重建归并与报告 → 再次收口 done", async () => {
    const model = await fakeModel();
    model.script([batchJson({ indexes: range(1, 10) }), batchJson({ indexes: range(11, 12) }), NO_ALIASES, PLOT_SUMMARY]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "单批重跑");
    const project = getCurrentProject()!;
    const first = await pollJob(app, "首次收口");
    expect(first.report).not.toBeNull();
    const charactersBefore = listEntities(project.db, { type: "character" }).total;

    // 该批输出换一份摘要（报告重建的证据）+ 挂起 ⇒ 能观察到「job 回 running、阶段回 extract」
    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    model.script([
      async () => {
        await batchGate;
        return fauxAssistantMessage(batchJson({ indexes: range(1, 10), summaryPrefix: "重跑摘要" }));
      },
      NO_ALIASES,
      "重跑后的剧情摘要。",
    ]);

    const rerun = await post(app, "/job/batches/1/rerun");
    expect(rerun.status).toBe(200);
    expect(await rerun.json()).toMatchObject({ data: { status: "running", seq: 1 } });
    await waitFor(() => listDecomposeBatches(project.db, started.jobId)[0].status === "running", "重跑批在飞");
    expect(await getJob(app)).toMatchObject({ status: "running", stage: "extract" }); // 阶段先回 extract
    releaseBatch();

    const second = await pollJob(app, "重跑收口");
    expect(second.status).toBe("done");
    // 只有该批重跑（其余 done 批不动）
    expect(listDecomposeBatches(project.db, started.jobId).map((batch) => batch.attempts)).toEqual([2, 1]);
    expect(decomposeBatchResultSchema.parse(getDecomposeBatch(project.db, started.jobId, 1)!.result).chapters[0].summary).toBe("重跑摘要1");
    // 归并 + 报告重建：报告仍是同一条（不重复建），报告调用拿到的是重跑后的章摘要
    expect(second.report).toMatchObject({ entityId: first.report!.entityId });
    expect(promptOf(model.calls, 6)).toContain("重跑摘要1"); // S4 的输入 = 重算后的章摘要
    expect(getDocument(project.db, "reference", second.report!.entityId)!.content_text).toContain("重跑后的剧情摘要。");
    expect(listEntities(project.db, { type: "character" }).total).toBe(charactersBefore); // 归并幂等
    expect(model.calls).toHaveLength(7); // 首轮 4 次 + 重跑 3 次（该批 + 归并 + 报告）
  });

  it("状态前置与越界：running 时 409；批序号越界 404", async () => {
    const model = await fakeModel();
    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    model.script([
      async () => {
        await batchGate;
        return fauxAssistantMessage(batchJson({ indexes: range(1, 10) }));
      },
      batchJson({ indexes: range(11, 12) }),
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);
    const app = buildApp(model.deps);

    await startOk(app, "重跑前置");
    const project = getCurrentProject()!;
    const running = await post(app, "/job/batches/1/rerun");
    expect(running.status).toBe(409);
    expect((await running.json()).error.code).toBe("DECOMPOSE_JOB_STATE");

    releaseBatch();
    await pollJob(app, "收口");
    for (const seq of ["99", "0"]) {
      const res = await post(app, `/job/batches/${seq}/rerun`);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("DECOMPOSE_BATCH_NOT_FOUND");
    }
    expect(getDecomposeJob(project.db)!.status).toBe("done"); // 越界不触发重跑
  });

  it("缺凭据 → 400，且 job 状态与批结果均不变（不清已完成的 result）", async () => {
    const model = await fakeModel();
    model.script([batchJson({ indexes: range(1, 10) }), batchJson({ indexes: range(11, 12) }), NO_ALIASES, PLOT_SUMMARY]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "重跑缺凭据");
    const project = getCurrentProject()!;
    await pollJob(app, "收口");
    const resultBefore = getDecomposeBatch(project.db, started.jobId, 1)!.result;

    // 换一个没有凭据的空运行时（HOME 已隔离 ⇒ 走真实单例也读不到凭据）
    const bare = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
    const bareApp = buildApp({ runtime: bare, settings: SettingsManager.inMemory({}) });
    const res = await post(bareApp, "/job/batches/1/rerun");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("LLM_API_KEY_MISSING");
    expect(getDecomposeJob(project.db)!.status).toBe("done"); // 状态原样
    expect(getDecomposeBatch(project.db, started.jobId, 1)!.result).toEqual(resultBefore); // 批结果原样
  });
});

describe("切书与重启归一", () => {
  it("续拆取「第一个未完成批」：重启残留的 running 批被重取（不只取 pending）", async () => {
    const model = await fakeModel();
    const app = buildApp(model.deps);
    const jobId = ingestProject("续拆取批");
    const project = getCurrentProject()!;
    expect(listDecomposeBatches(project.db, jobId).map((batch) => batch.status)).toEqual(["pending"]);

    // 模拟「服务端崩在批中间」：批停在 running、job 归一为 paused（归一不动批行）
    startBatchAttempt(project.db, jobId, 1, nowIso());
    updateJobStatus(project.db, jobId, "paused", nowIso());
    model.script([batchJson({ indexes: range(1, 6) }), NO_ALIASES, PLOT_SUMMARY]);

    const resumed = await post(app, "/job/resume");
    expect(resumed.status).toBe(200);
    await waitFor(() => listDecomposeBatches(project.db, jobId)[0].status === "done", "残留 running 批被承接");
    expect(listDecomposeBatches(project.db, jobId)[0].attempts).toBe(2); // 重取 = 新一次尝试（不是跳过）
  });

  it("切书自动暂停：旧书 job 立刻 paused，切走后不再开下一批", async () => {
    const model = await fakeModel();
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let firstCallStarted!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      firstCallStarted = resolve;
    });
    model.script([
      async () => {
        firstCallStarted();
        await gate;
        return fauxAssistantMessage(batchJson({ indexes: range(1, 10) }));
      },
      batchJson({ indexes: range(11, 12) }),
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "切书源");
    await inFlight;
    const source = getCurrentProject()!;
    expect(getDecomposeJob(source.db)!.status).toBe("running");

    // 切到另一本书（与 open / start 路由同序：新项目就绪后调 setCurrentProject 单点）
    const target = initProject(bookDir("切书目标"), { name: "切书目标" });
    setCurrentProject(target);

    expect(getDecomposeJob(source.db)!.status).toBe("paused"); // 旧书不再「永远 running」
    releaseGate();
    await waitFor(() => listDecomposeBatches(source.db, started.jobId)[0].status === "done", "在飞批收尾");
    expect(model.calls).toHaveLength(1); // 跨书后台跑：切走即停

    closeProject(source); // 测试自管旧连接（afterEach 只关当前项目）
  });

  it("重启归一：打开项目时残留 running → paused，批行不动（只归一 job 行）", async () => {
    const project = initProject(bookDir("重启归一"), { name: "重启归一" });
    const job = createDecomposeJob(project.db, {
      scopeStart: 1,
      scopeEnd: 1,
      batchTargetChars: DECOMPOSE_BATCH_TARGET_CHARS,
      model: null,
      batches: [{ seq: 1, chapterIds: ["ch-none"] }],
      now: nowIso(),
    });
    // 模拟「进程崩在批中间」：job 与批都留在 running
    updateJobStatus(project.db, job.id, "running", nowIso());
    startBatchAttempt(project.db, job.id, 1, nowIso());
    expect(getDecomposeJob(project.db)!.status).toBe("running");

    setCurrentProject(project); // 打开项目 = 归一入口（与 disposeProjectRuntime 同一处）

    const normalized = getDecomposeJob(project.db)!;
    expect(normalized.status).toBe("paused");
    expect(normalized.error).toBeNull(); // 归一不动错误摘要
    // 批行不动：残留 running 批由续拆取批承接（「paused job + running 批」是合法组合）
    expect(listDecomposeBatches(project.db, job.id)).toEqual([
      expect.objectContaining({ seq: 1, status: "running", attempts: 1 }),
    ]);

    // 归一后的 paused job 不会被误启动（状态前置）：既不发模型调用，也不动批行
    const model = await fakeModel();
    await startDecomposeJob(project, model.deps);
    expect(model.calls).toHaveLength(0);
    expect(listDecomposeBatches(project.db, job.id)).toEqual([
      expect.objectContaining({ seq: 1, status: "running", attempts: 1 }),
    ]);
  });
});

// ============ job 级失败与滚动故事圣经（纯函数） ============

describe("job 级失败", () => {
  it("大纲文件损坏 → 写 job 级错误摘要 + failed；批循环不 reject（后台任务的兜底）", async () => {
    const model = await fakeModel();
    const jobId = ingestProject("job级错误");
    const project = getCurrentProject()!;
    writeFileSync(join(project.root, "outline.json"), "{ 坏 JSON");

    await startDecomposeJob(project, model.deps); // 不 reject = 后台任务不会变成未处理拒绝

    const job = getDecomposeJob(project.db)!;
    expect(job.status).toBe("failed");
    expect(job.error).toBeTruthy();
    expect(model.calls).toHaveLength(0); // 读大纲就失败 ⇒ 一次模型调用都没发出
    expect(listDecomposeBatches(project.db, jobId).map((batch) => batch.status)).toEqual(["pending"]);
  });
});

describe("滚动故事圣经（纯函数）", () => {
  const resultWith = (index: number, names: readonly string[], summary: string): DecomposeBatchResult => ({
    chapters: [
      {
        chapterIndex: index,
        chapterTitle: `第${index}章`,
        summary,
        characters: names.map((name) => ({ name })),
        settings: [],
        locations: [],
        relations: [{ source: names[0] ?? "甲", target: names[1] ?? names[0] ?? "乙", type: "ally" }],
      },
    ],
  });

  it("名字累计去重、摘要整批替换；文本受 DECOMPOSE_BIBLE_MAX_CHARS 约束且名字行优先保留", () => {
    const longName = (index: number): string => `人物${index}${"长".repeat(40)}`;
    let bible = emptyStoryBible();
    for (let index = 1; index <= 40; index++) {
      bible = extendStoryBible(bible, resultWith(index, [longName(index)], `很长的摘要${index}${"文".repeat(60)}`));
    }
    bible = extendStoryBible(bible, resultWith(41, [longName(1)], "最新摘要")); // 重名不重复计入

    expect(bible.names).toHaveLength(40);
    expect(bible.summaries).toEqual(["最新摘要"]); // 摘要整批替换 = 只留最近一批

    const text = storyBibleText(bible);
    expect(text.length).toBeLessThanOrEqual(DECOMPOSE_BIBLE_MAX_CHARS);
    expect(text.startsWith("已出现的名字：")).toBe(true); // 名字行优先保留（关系端点判据靠它）
    expect(storyBibleText(emptyStoryBible())).toBe(""); // 空圣经 → 空文本（提示词走「首批，尚无上文」）
  });
});
