// 卡 21.6 拆解 S2 批执行器测试：串行批循环 / 逐章对齐重试 / 失败批不阻塞 / 项目数据快照（起始快照 + 本轮累积）/
// 暂停（批间）与续拆（跳过 done 批）/ 切书自动暂停 / 重启归一 / stage = merge 口径 / job 级失败。
//
// 全部经 **faux provider（内存运行时注册假模型）离线跑**，不触网、不调真实模型；
// 批循环是后台任务（路由不 await）⇒ 断言前统一用 `waitFor` 轮询等服务端落库。

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  contentText,
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  type AssistantMessage,
  type Context,
} from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { MAX_ENTITY_LIST_LIMIT, DECOMPOSE_SESSION_ID_PREFIX, type DecomposeBatchResult, type DecomposeJobRes } from "@whispering233/ai-editor-shared";
import { decomposeBatchResultSchema } from "@whispering233/ai-editor-shared/schemas";
import {
  completeBatch,
  createDecomposeJob,
  createEntity,
  createRelation,
  deriveChapterOrder,
  findOutlineNode,
  getDecomposeBatch,
  getDecomposeJob,
  getDocument,
  listDecomposeBatches,
  listEntities,
  nowIso,
  readOutlineFile,
  startBatchAttempt,
  updateJobStatus,
  writeOutlineFile,
} from "@whispering233/ai-editor-db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
  type ProjectContext,
} from "../middleware/project.js";
import { resetModelRuntime } from "../model-runtime.js";
import { setProjectRoot } from "../routes/project.js";
import { createDecomposeRoutes, type DecomposeRouteDeps } from "../routes/decompose.js";
import { createChatRoutes } from "../routes/chat.js";
import { DECOMPOSE_BATCH_TARGET_CHARS } from "./batching.js";
import {
  DECOMPOSE_CHAPTER_MAX_CHARACTERS,
  DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS,
  DECOMPOSE_RELATION_TYPES,
} from "./extract.js";
import { ingestDecomposeProject } from "./job.js";
import { decomposeSessionId, decomposeWorkerSessionId } from "./llm.js";
import {
  DECOMPOSE_BATCH_MAX_ATTEMPTS,
  DECOMPOSE_KEPT_SESSIONS,
  DECOMPOSE_RATE_LIMIT_BASE_DELAY_MS,
  DECOMPOSE_RATE_LIMIT_JITTER_MIN,
  DECOMPOSE_RATE_LIMIT_MAX_DELAY_MS,
  DECOMPOSE_ROLE_ORDER,
  DECOMPOSE_SNAPSHOT_MAX_CHARS,
  DECOMPOSE_SNAPSHOT_PREV_CHAPTERS,
  decomposeRateLimitDelayMs,
  emptyStoryBible,
  extendStoryBible,
  isDecomposeJobActive,
  pruneDecomposeSessions,
  readStartSnapshot,
  snapshotComposition,
  snapshotText,
  startDecomposeJob,
  type DecomposeStartSnapshot,
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
  app.route("/api/v1/chat", createChatRoutes()); // 拆解会话的 chat 侧守卫（删除守卫的「在跑轮次」分支）
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

/** 按给定文本启动拆解（等长章节样本要整份文本；`startOk` 的按章数样本字数递增） */
async function startTextOk(
  app: Hono,
  name: string,
  text: string,
  extra = "",
): Promise<{ jobId: string; batchCount: number }> {
  const res = await postNovel(app, "/start", bytesOf(text), startQuery(name, extra));
  expect(res.status).toBe(200);
  return (await res.json()).data;
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
    concurrency: 1,
    model: null,
    now: nowIso(),
  });
  return jobId;
}

// ============ faux provider（离线假模型；记录每次调用的上下文） ============

type ScriptedStep = string | ((context: Context) => Promise<AssistantMessage>);

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
          return typeof step === "function" ? await step(context) : fauxAssistantMessage(step);
        }),
      ),
  };
}

/** 一次调用（`Context`）的用户消息文本 */
function promptTextOf(context: Context): string {
  const content = context.messages[0].content;
  return typeof content === "string" ? content : contentText(content);
}

/** 第 n 次调用的用户消息（项目数据快照 + 本批正文） */
function promptOf(calls: readonly Context[], index: number): string {
  return promptTextOf(calls[index]);
}

/**
 * 批输出（内容应答版）：章号取自提示词里的 `### 第N章` 行——分段并发下各段调用交错，
 * 按顺序排队的脚本会把批次与输出对错位（批 2 拿到批 3 的输出 ⇒ 缺章重试）。
 */
function batchJsonFromPrompt(prompt: string): string {
  return batchJson({ indexes: [...prompt.matchAll(/^### 第(\d+)章/gm)].map((match) => Number(match[1])) });
}

/** 内容应答的拦截结果（`Error` = 让这次调用以模型错误收场，用来演练限流一类失败路径） */
type ScriptedOutcome = AssistantMessage | Error | null | Promise<AssistantMessage | Error | null>;

/**
 * 内容应答脚本：批提示词 → 按提示词章号现造输出；别名归并 → 无组；报告 → 固定剧情摘要。
 * `turns` = 预排步数（多排无妨，队列按调用顺序消费；排少了会拿到「No more faux responses」）。
 * `intercept` 优先于内置路由（可挂起 / 抛错，用来构造暂停与限流场景）。
 */
function contentAwareScript(
  model: FakeModel,
  turns: number,
  intercept?: (context: Context) => ScriptedOutcome,
): void {
  model.script(
    Array.from({ length: turns }, () => async (context: Context) => {
      const intercepted = await intercept?.(context);
      if (intercepted instanceof Error) throw intercepted;
      if (intercepted !== undefined && intercepted !== null) return intercepted;
      const system = context.systemPrompt ?? "";
      if (system.includes("逐章抽取员")) return fauxAssistantMessage(batchJsonFromPrompt(promptTextOf(context)));
      return fauxAssistantMessage(system.includes("全书报告员") ? PLOT_SUMMARY : NO_ALIASES);
    }),
  );
}

/** 一次运行里各批的提示词（键 = 该批首个章号；按批定位，不依赖调用顺序） */
function batchPromptsOf(calls: readonly Context[]): Map<number, string> {
  const prompts = new Map<number, string>();
  for (const call of calls) {
    const text = promptTextOf(call);
    const first = /^### 第(\d+)章/m.exec(text);
    if (first !== null) prompts.set(Number(first[1]), text);
  }
  return prompts;
}

/**
 * 等长章节的样本文本（每章字数相同 ⇒ 组批后的批字数相同 ⇒ 段划分按累计字数落在正中，
 * 断言可以写死「段 k 含哪几批」）。
 */
function uniformNovelText(chapterCount: number): string {
  return Array.from(
    { length: chapterCount },
    (_, position) => `第${position + 1}章 标题${position + 1}\n${"正文".repeat(200)}`,
  ).join("\n");
}

/** 写创作根拆解配置（建 job 时读一次并快照；见 `decompose/config.ts`） */
function writeConcurrencyConfig(concurrency: number): void {
  mkdirSync(join(tmpRoot, ".ai-editor"), { recursive: true });
  writeFileSync(join(tmpRoot, ".ai-editor", "config.json"), JSON.stringify({ decompose: { concurrency } }));
}

/** 快照名字命中（防 `人物1` 命中 `人物10` 一类前缀假阳） */
function hasSnapshotName(prompt: string, index: number): boolean {
  return new RegExp(`人物${index}(?![0-9])`).test(prompt);
}

/** 批结果形状（`batchJson` 的 JSON 文本 → 契约形状；夹具落库用） */
function parsedBatch(options: { indexes: readonly number[]; summaryPrefix?: string }): DecomposeBatchResult {
  return decomposeBatchResultSchema.parse(JSON.parse(batchJson(options)));
}

/** 拆解会话文件条目（`<项目根>/sessions/<时间戳>_<会话 id>.jsonl`；header 除外） */
function sessionEntriesOf(projectRoot: string, sessionId: string): Record<string, unknown>[] {
  const dir = join(projectRoot, "sessions");
  const file = readdirSync(dir).find((name) => name.endsWith(`_${sessionId}.jsonl`));
  if (file === undefined) throw new Error(`拆解会话文件不存在：${sessionId}`);
  return readFileSync(join(dir, file), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.type !== "session");
}

/** 会话里的过程条目（§8 时间线） */
function sessionLogsOf(
  projectRoot: string,
  sessionId: string,
): Array<{ kind: string; text: string; batchSeq?: number; at: string }> {
  return sessionEntriesOf(projectRoot, sessionId)
    .filter((entry) => entry.type === "custom")
    .map((entry) => entry.data as { kind: string; text: string; batchSeq?: number; at: string });
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
    expect(firstPrompt).toContain("【项目数据快照】（本批是首批，尚无上文）");
    expect(firstPrompt).toContain("### 第1章 标题1");
    expect(firstPrompt).toContain("正文正文");
    expect(firstPrompt).not.toContain("### 第11章"); // 批边界：本批只带自己那几章
    const systemPrompt = model.calls[0].systemPrompt ?? "";
    expect(systemPrompt).toContain(String(DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS));
    expect(systemPrompt).toContain(String(DECOMPOSE_CHAPTER_MAX_CHARACTERS));
    for (const relationType of DECOMPOSE_RELATION_TYPES) expect(systemPrompt).toContain(relationType);
  });

  it("本轮累积进下一批：名字与上批摘要进提示词；跨批关系端点保留（S2 不再预丢）", async () => {
    const model = await fakeModel();
    // 第二批的关系端点「人物1」只在第一批出现过（本批实体是人物11 / 人物12）⇒ 仍保留，交 S3 悬空过滤
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
    expect(secondPrompt).toContain("名字：人物1"); // 本轮累积的名字进下一批的快照
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

  it("提示词与 §4.1 对齐：端点措辞不再说死「必须本章或上文出现」（分段下不阻止跨段关系）", async () => {
    const model = await fakeModel();
    model.script([batchJson({ indexes: range(1, 10) }), batchJson({ indexes: range(11, 12) }), NO_ALIASES, PLOT_SUMMARY]);
    const app = buildApp(model.deps);

    await startOk(app, "提示词对齐");
    await pollJob(app, "收口");

    const systemPrompt = model.calls[0].systemPrompt ?? "";
    expect(systemPrompt).not.toContain("必须是本章或上文出现过的名字");
    expect(systemPrompt).toContain("不必等它先在本段出现");
    // 端点判据仍只在 S3：抽取层不因名字集合丢弃（跨段关系照落库）
    const relation = { source: "段一人物", target: "段二人物", type: "ally" };
    model.script([batchJson({ indexes: range(1, 10), relation }), batchJson({ indexes: range(11, 12) }), NO_ALIASES, PLOT_SUMMARY]);
    const jobId = ingestProject("跨段端点", 12);
    const project = getCurrentProject()!;
    await startDecomposeJob(project, model.deps);
    const batch = decomposeBatchResultSchema.parse(getDecomposeBatch(project.db, jobId, 1)!.result);
    expect(batch.chapters[9].relations).toEqual([{ ...relation, evidence: "证据" }]);
  });
});

// ============ 分段并发（§2.2：段间并行、段内串行；§4.1 起始快照各段共用） ============

describe("分段并发", () => {
  it("段内滚动、段间并集：各段只看到自己段内的累积；批次与输出按内容对齐；时间线带段号", async () => {
    const model = await fakeModel();
    contentAwareScript(model, 8);
    const app = buildApp(model.deps);
    writeConcurrencyConfig(2); // 建 job 时读创作根配置一次（快照进 job 行）

    // 40 章等长 ⇒ 4 批（每批 10 章、字数相同）⇒ 并发 2 时分段 = [[1,2],[3,4]]
    const started = await startTextOk(app, "分段", uniformNovelText(40));
    const project = getCurrentProject()!;
    expect(getDecomposeJob(project.db)!.concurrency).toBe(2); // 并发数快照
    await waitFor(() => listDecomposeBatches(project.db, started.jobId).every((batch) => batch.status === "done"), "四批 done");
    const job = await pollJob(app, "分段收口");
    expect(job).toMatchObject({ status: "done", progress: { done: 4, failed: 0, total: 4 } });

    const prompts = batchPromptsOf(model.calls);
    // 按批定位提示词（不依赖交错顺序）：四批各自的快照以首个章号区分
    expect([...prompts.keys()].sort((a, b) => a - b)).toEqual([1, 11, 21, 31]);
    // 段 1 的批 2：看得到段 1 自己的产物（批 1 的名字与摘要）
    expect(prompts.get(11)).toContain("名字：人物1、人物2");
    expect(prompts.get(11)).toContain("上一批摘要：摘要1");
    // 段 2 的批 3：段内尚无可累积 ⇒ 空快照（**段间不共享本轮产物**）
    expect(prompts.get(21)).toContain("【项目数据快照】（本批是首批，尚无上文）");
    // 段 2 的批 4：只看到段 2 的产物（批 3 的名字），看不到段 1 的
    expect(hasSnapshotName(prompts.get(31)!, 21)).toBe(true);
    expect(hasSnapshotName(prompts.get(31)!, 1)).toBe(false);

    // 每段一枚 worker 会话；`batch_start` 带段号（§2.2 时间线口径）
    const worker1 = decomposeWorkerSessionId(started.jobId, 1);
    const worker2 = decomposeWorkerSessionId(started.jobId, 2);
    const startsOf = (sessionId: string) =>
      sessionLogsOf(project.root, sessionId)
        .filter((log) => log.kind === "batch_start")
        .map((log) => log.text);
    expect(startsOf(worker1)).toEqual([
      "批 1 开始（段 1/2；10 章；快照 名字 0 / 关系 0）",
      "批 2 开始（段 1/2；10 章；快照 名字 10 / 关系 0）",
    ]);
    expect(startsOf(worker2)).toEqual([
      "批 3 开始（段 2/2；10 章；快照 名字 0 / 关系 0）",
      "批 4 开始（段 2/2；10 章；快照 名字 10 / 关系 0）",
    ]);
    // 每段一条快照组成条目（段起点规模）
    for (const sessionId of [worker1, worker2]) {
      expect(sessionLogsOf(project.root, sessionId)[0]).toMatchObject({
        kind: "snapshot",
        text: "快照：人物 0 / 设定 0 / 地点 0 / 关系 0 / 前置摘要 0 条",
      });
    }
    // 段内串行 + 段间并集进 S3：四批产物都在报告里（S3/S4 写主会话）
    expect(sessionLogsOf(project.root, decomposeSessionId(started.jobId)).map((log) => log.kind)).toEqual([
      "merge_done",
      "report_done",
    ]);
  });

  it("批数少于并发数 → 段数 = 批数（不空转、不建空 worker 会话）", async () => {
    const model = await fakeModel();
    contentAwareScript(model, 6);
    const app = buildApp(model.deps);
    writeConcurrencyConfig(4);

    const started = await startTextOk(app, "段数上限", uniformNovelText(12)); // 12 章 ⇒ 2 批
    const project = getCurrentProject()!;
    await waitFor(() => listDecomposeBatches(project.db, started.jobId).every((batch) => batch.status === "done"), "两批 done");
    await pollJob(app, "收口");

    expect(getDecomposeJob(project.db)!.concurrency).toBe(4); // 快照 = 配置值（段数在派生日才受批数限制）
    const workers = sessionIdsIn(project.root)
      .filter((id) => id.startsWith(`${decomposeSessionId(started.jobId)}-w`))
      .sort();
    expect(workers).toEqual([decomposeWorkerSessionId(started.jobId, 1), decomposeWorkerSessionId(started.jobId, 2)]);
    const starts = workers.flatMap((id) =>
      sessionLogsOf(project.root, id)
        .filter((log) => log.kind === "batch_start")
        .map((log) => log.text),
    );
    expect(starts.sort()).toEqual([
      "批 1 开始（段 1/2；10 章；快照 名字 0 / 关系 0）",
      "批 2 开始（段 2/2；2 章；快照 名字 0 / 关系 0）",
    ]);
  });

  it("暂停按段：每段当前批跑完即停（在途 ≤ 段数），后续批不开跑", async () => {
    const model = await fakeModel();
    let releaseBatch!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    let gated = 0;
    contentAwareScript(model, 8, (context) => {
      if (!(context.systemPrompt ?? "").includes("逐章抽取员") || gated++ >= 2) return null;
      return (async () => {
        await gate;
        return fauxAssistantMessage(batchJsonFromPrompt(promptTextOf(context)));
      })();
    });
    const app = buildApp(model.deps);
    writeConcurrencyConfig(2);

    const started = await startTextOk(app, "暂停按段", uniformNovelText(40)); // 4 批 ⇒ 2 段 × 2 批
    const project = getCurrentProject()!;
    // 段间并行的直接证据：两段各一批同时在飞（段内串行 ⇒ 每段至多一批）
    await waitFor(
      () => listDecomposeBatches(project.db, started.jobId).filter((batch) => batch.status === "running").length === 2,
      "两段各一批在飞",
    );
    const paused = await post(app, "/job/pause");
    expect(paused.status).toBe(200);
    releaseBatch();
    await waitFor(() => !isDecomposeJobActive(started.jobId), "轮次收尾");
    await new Promise((resolve) => setTimeout(resolve, 20)); // 后续批窗口（应有而不发生）

    expect(model.calls).toHaveLength(2); // 每段只跑完当前批；各段第二批判未开跑（在途 ≤ 段数）
    expect(listDecomposeBatches(project.db, started.jobId).map((batch) => [batch.seq, batch.status])).toEqual([
      [1, "done"],
      [2, "pending"],
      [3, "done"],
      [4, "pending"],
    ]);
    expect(getDecomposeJob(project.db)!.status).toBe("paused");
  });

  it("续拆：段划分与并发数取 job 快照（改配置不影响），每段按段内已完成批重建累积（跨段不串）", async () => {
    const model = await fakeModel();
    // 40 章等长 ⇒ 4 批、并发 2 ⇒ 段 [[1,2],[3,4]]（直接 S1 建档：批执行前状态是确定性夹具）
    const project = initProject(bookDir("续拆分段"), { name: "续拆分段" });
    setCurrentProject(project);
    const split = splitNovelWithSlices(bytesOf(uniformNovelText(40)));
    const { jobId } = ingestDecomposeProject({
      project,
      split,
      scopedChapters: split.result.chapters,
      scopeStart: 1,
      scopeEnd: 40,
      concurrency: 2,
      model: null,
      now: nowIso(),
    });
    // 前置：段 1 的批 1 与段 2 的批 3 已完成（各自带独立摘要标记）
    completeBatch(project.db, { jobId, seq: 1, result: parsedBatch({ indexes: range(1, 10), summaryPrefix: "段一摘要" }), now: nowIso() });
    completeBatch(project.db, { jobId, seq: 3, result: parsedBatch({ indexes: range(21, 30), summaryPrefix: "段二摘要" }), now: nowIso() });
    updateJobStatus(project.db, jobId, "paused", nowIso());
    writeConcurrencyConfig(4); // 反向对照：resume 不读当前配置（段划分只认 job 快照）
    contentAwareScript(model, 6);
    const app = buildApp(model.deps);

    const resumed = await post(app, "/job/resume");
    expect(resumed.status).toBe(200);
    await waitFor(() => listDecomposeBatches(project.db, jobId).every((batch) => batch.status === "done"), "续拆后四批 done");
    await pollJob(app, "续拆收口");

    const prompts = batchPromptsOf(model.calls);
    // 段 1 的批 2：只看得到段 1 已完成批（批 1）的产物
    expect(hasSnapshotName(prompts.get(11)!, 1)).toBe(true);
    expect(prompts.get(11)).toContain("上一批摘要：段一摘要1");
    expect(prompts.get(11)).not.toContain("段二摘要");
    // 段 2 的批 4：只看得到段 2 已完成批（批 3）的产物
    expect(hasSnapshotName(prompts.get(31)!, 21)).toBe(true);
    expect(prompts.get(31)).toContain("上一批摘要：段二摘要21");
    expect(prompts.get(31)).not.toContain("段一摘要");
    // 已完成批不重跑（attempts 不变：批 1 / 3 由夹具直接置 done，从未 startBatchAttempt）
    expect(listDecomposeBatches(project.db, jobId).map((batch) => [batch.seq, batch.attempts])).toEqual([
      [1, 0],
      [2, 1],
      [3, 0],
      [4, 1],
    ]);
    // 段号按快照重算（仍 2 段）：`batch_start` 的段号不是配置里的 4
    const rerunStarts = sessionIdsIn(project.root)
      .flatMap((id) => sessionLogsOf(project.root, id))
      .filter((log) => log.kind === "batch_start")
      .map((log) => log.text);
    expect(rerunStarts.every((text) => text.includes("/2；"))).toBe(true);
  });

  it("单批重跑：只重跑该批、段不变，按段内已完成批重建累积，跑完重建 S3/S4", async () => {
    const model = await fakeModel();
    contentAwareScript(model, 8);
    const app = buildApp(model.deps);
    writeConcurrencyConfig(2);

    const started = await startTextOk(app, "分段重跑", uniformNovelText(40)); // 4 批 ⇒ 段 [[1,2],[3,4]]
    const project = getCurrentProject()!;
    await waitFor(() => listDecomposeBatches(project.db, started.jobId).every((batch) => batch.status === "done"), "四批 done");
    await pollJob(app, "首次收口");
    const callsBefore = model.calls.length;

    // 重跑段 2 的首批（批 3）：输出换一份摘要（重跑生效的证据）
    contentAwareScript(model, 4, (context) => {
      if (!(context.systemPrompt ?? "").includes("逐章抽取员")) return null;
      const prompt = promptTextOf(context);
      if (!/^### 第21章/m.test(prompt)) return null;
      return fauxAssistantMessage(batchJson({ indexes: range(21, 30), summaryPrefix: "重跑段二" }));
    });
    const rerun = await post(app, "/job/batches/3/rerun");
    expect(rerun.status).toBe(200);
    const second = await pollJob(app, "重跑收口");
    expect(second.status).toBe("done");

    // 只重跑该批（attempts +1），其余批不动
    expect(listDecomposeBatches(project.db, started.jobId).map((batch) => [batch.seq, batch.attempts])).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 1],
    ]);
    expect(decomposeBatchResultSchema.parse(getDecomposeBatch(project.db, started.jobId, 3)!.result).chapters[0].summary).toBe("重跑段二21");
    // 重跑批的提示词按**段内已完成批重建**（批 4 的产物进快照；段 1 的批 1/2 不进）
    const rerunPrompts = model.calls.slice(callsBefore).filter((call) => /^### 第21章/m.test(promptTextOf(call)));
    expect(rerunPrompts).toHaveLength(1);
    expect(hasSnapshotName(promptTextOf(rerunPrompts[0]), 31)).toBe(true);
    expect(hasSnapshotName(promptTextOf(rerunPrompts[0]), 1)).toBe(false);
    // 时间线：段号不变（段 2/2），批开始条目追加一条（段内累积规模来自批 4）
    const worker2Starts = sessionLogsOf(project.root, decomposeWorkerSessionId(started.jobId, 2))
      .filter((log) => log.kind === "batch_start")
      .map((log) => log.text);
    expect(worker2Starts[2]).toBe("批 3 开始（段 2/2；10 章；快照 名字 10 / 关系 0）");
    // 无事可做的段（段 1 全 done）不重开会话、不追加条目：worker 1 的时间线原样
    expect(sessionLogsOf(project.root, decomposeWorkerSessionId(started.jobId, 1)).map((log) => log.kind)).toEqual([
      "snapshot",
      "batch_start",
      "batch_done",
      "batch_start",
      "batch_done",
    ]);
  });

  it("429 / 限流：批内重试之间指数退避 + 抖动（不改重试上限；退避时长可断言）", async () => {
    const model = await fakeModel();
    const sleeps: number[] = [];
    let batchCalls = 0;
    contentAwareScript(model, 6, (context) => {
      if (!(context.systemPrompt ?? "").includes("逐章抽取员")) return null;
      if (batchCalls++ > 0) return null; // 只有第一次批调用限流
      return new Error("429 Too Many Requests: rate limit exceeded");
    });
    // pi 的 Agent 层默认自带重试（`retry.enabled`）：关掉才能让 429 落到本模块的退避路径
    const app = buildApp({
      ...model.deps,
      settings: SettingsManager.inMemory({ retry: { enabled: false } }),
      sleep: async (ms: number) => void sleeps.push(ms),
    });
    writeConcurrencyConfig(2);

    const started = await startTextOk(app, "限流退避", uniformNovelText(12)); // 2 批 ⇒ 2 段（各 1 批）
    const project = getCurrentProject()!;
    await waitFor(
      () => listDecomposeBatches(project.db, started.jobId).every((batch) => batch.status === "done"),
      "两批 done（限流批重试后成功）",
    );
    await pollJob(app, "收口");
    await pollJob(app, "收口");

    // 退避一次：下界 = 起始 × 抖动下界，上界 = 起始（第 1 次失败）
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(DECOMPOSE_RATE_LIMIT_BASE_DELAY_MS * DECOMPOSE_RATE_LIMIT_JITTER_MIN);
    expect(sleeps[0]).toBeLessThan(DECOMPOSE_RATE_LIMIT_BASE_DELAY_MS);
    // 限流批重试一次后成功（attempts = 2；另一批 1），job 照常收口
    expect(listDecomposeBatches(project.db, started.jobId).map((batch) => batch.attempts).sort()).toEqual([1, 2]);
    // 时间线把退避写进失败条目（不静默）
    const failedText = sessionIdsIn(project.root)
      .flatMap((id) => sessionLogsOf(project.root, id))
      .find((log) => log.kind === "attempt_failed")?.text ?? "";
    expect(failedText).toContain("429");
    expect(failedText).toMatch(/；限流退避 \d+ 毫秒后重试$/);

    // 退避计算（纯函数）：指数上升、封顶、抖动区间 [下界, 1)
    expect(decomposeRateLimitDelayMs(1, 0)).toBe(Math.round(DECOMPOSE_RATE_LIMIT_BASE_DELAY_MS * DECOMPOSE_RATE_LIMIT_JITTER_MIN));
    expect(decomposeRateLimitDelayMs(2, 0)).toBe(Math.round(DECOMPOSE_RATE_LIMIT_BASE_DELAY_MS * 2 * DECOMPOSE_RATE_LIMIT_JITTER_MIN));
    expect(decomposeRateLimitDelayMs(99, 0.999)).toBeLessThanOrEqual(DECOMPOSE_RATE_LIMIT_MAX_DELAY_MS);
    // 封顶后仍带抖动：随机源取下界 ⇒ 等待 = 封顶值 × 抖动下界（严格小于封顶值，不会被退化成恒等）
    expect(decomposeRateLimitDelayMs(99, 0)).toBe(Math.round(DECOMPOSE_RATE_LIMIT_MAX_DELAY_MS * DECOMPOSE_RATE_LIMIT_JITTER_MIN));
  });

  it("一段抛错：全体段落定后才上报（兄弟段被等待，job 不在残留段在飞时置 failed）", async () => {
    const model = await fakeModel();
    let releaseSibling!: () => void;
    const siblingGate = new Promise<void>((resolve) => {
      releaseSibling = resolve;
    });
    let siblingInFlight = false;
    // 段 1 的批调用限流（触发退避 → 注入的 sleep 抛错 ⇒ 段 1 reject）；段 2 的批调用挂起（保持在途）
    contentAwareScript(model, 6, (context) => {
      const prompt = promptTextOf(context);
      if (/^### 第11章/m.test(prompt)) {
        siblingInFlight = true;
        return siblingGate.then(() => fauxAssistantMessage(batchJsonFromPrompt(prompt)));
      }
      if (/^### 第1章/m.test(prompt)) return new Error("429 Too Many Requests: rate limit exceeded");
      return null;
    });
    const app = buildApp({
      ...model.deps,
      settings: SettingsManager.inMemory({ retry: { enabled: false } }),
      sleep: () => Promise.reject(new Error("退避等待被打断")),
    });
    writeConcurrencyConfig(2);

    const started = await startTextOk(app, "段异常收口", uniformNovelText(12)); // 2 批 ⇒ 2 段（各 1 批）
    const project = getCurrentProject()!;
    await waitFor(() => siblingInFlight, "段 2 的批调用已在飞");
    await new Promise((resolve) => setTimeout(resolve, 20)); // 段 1 的 rejection 链全是微任务：一个宏任务边界足够

    // 兄弟段仍在写库 ⇒ 不提前上报 job 失败、轮次登记不注销（删除守卫 / 单批重跑不得与残留段重叠）
    expect(getDecomposeJob(project.db)!.status).toBe("running");
    expect(isDecomposeJobActive(started.jobId)).toBe(true);
    expect(listDecomposeBatches(project.db, started.jobId).map((batch) => batch.status)).toEqual(["running", "running"]);

    releaseSibling();
    await pollJob(app, "段异常上报");
    // 兄弟段跑完才上报：原错误消息保留、段 2 的批已 done、轮次登记已清（收尾语义与单段一致）
    expect(getDecomposeJob(project.db)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("退避等待被打断"),
    });
    expect(listDecomposeBatches(project.db, started.jobId).map((batch) => batch.status)).toEqual(["running", "done"]);
    expect(isDecomposeJobActive(started.jobId)).toBe(false);
  });
});

// ============ 拆解会话落盘与过程条目（§2.1 / §8 时间线口径；卡 22.2） ============

describe("拆解会话落盘", () => {
  it("过程条目：快照组成 / 批开始 / 失败尝试 / 批完成（计数 + 用量）/ 归并 / 报告；会话名 = 《书名》拆解", async () => {
    const model = await fakeModel();
    const missingFirstChapter = batchJson({ indexes: range(2, 10) });
    model.script([
      missingFirstChapter, // 第 1 批首次尝试缺章 ⇒ 重试（记一条失败条目）
      batchJson({ indexes: range(1, 10) }),
      batchJson({ indexes: range(11, 12) }),
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "记录");
    const project = getCurrentProject()!;
    await pollJob(app, "job 收口");

    // 主会话（计划留档 + 汇总 + S3/S4）与会话名
    const mainId = decomposeSessionId(started.jobId);
    const entries = sessionEntriesOf(project.root, mainId);
    expect(entries.find((entry) => entry.type === "session_info")?.name).toBe("《记录》拆解");
    expect(sessionLogsOf(project.root, mainId).map((log) => log.kind)).toEqual(["merge_done", "report_done"]);
    // S2 各批写本段 worker 会话（默认并发 1 ⇒ 段 1/1 一枚），会话名带段号
    const workerId = decomposeWorkerSessionId(started.jobId, 1);
    expect(sessionEntriesOf(project.root, workerId).find((entry) => entry.type === "session_info")?.name).toBe(
      "《记录》拆解 · 段 1/1",
    );
    const logs = sessionLogsOf(project.root, workerId);
    expect(logs.map((log) => log.kind)).toEqual([
      "snapshot",
      "batch_start",
      "attempt_failed",
      "batch_done",
      "batch_start",
      "batch_done",
    ]);
    // 快照组成条目（§8）：每段一条，只有计数与省略告知（不带批锚）
    expect(logs[0]).toMatchObject({ text: "快照：人物 0 / 设定 0 / 地点 0 / 关系 0 / 前置摘要 0 条" });
    expect(logs[0]?.batchSeq).toBeUndefined();
    // `batch_start` 带段号（§2.2 时间线）
    expect(logs[1]).toMatchObject({ batchSeq: 1, text: "批 1 开始（段 1/1；10 章；快照 名字 0 / 关系 0）" });
    expect(logs[2]?.text).toContain("批 1 第 1 次尝试失败：");
    expect(logs[3]?.text).toContain("批 1 完成：人物 10 / 设定 0 / 地点 0 / 关系 0；本次用量 输入 ");
    expect(logs[4]).toMatchObject({ batchSeq: 2, text: "批 2 开始（段 1/1；2 章；快照 名字 10 / 关系 0）" }); // 段内累积进批开始规模
    // S3/S4 写主会话
    const mainLogs = sessionLogsOf(project.root, mainId);
    expect(mainLogs[0]?.text).toContain("归并完成：实体 ");
    expect(mainLogs[1]?.text).toMatch(/^报告完成：《记录》拆解报告（id=ref-.+）$/);
    expect([...logs, ...mainLogs].every((log) => !Number.isNaN(Date.parse(log.at)))).toBe(true);
    // 过程条目**不进模型请求**（custom entry 不参与 LLM 上下文）
    for (const call of model.calls) expect(JSON.stringify(call.messages)).not.toContain("批 1 开始");
    for (const call of model.calls) expect(JSON.stringify(call.messages)).not.toContain("快照：人物");
  });

  it("快照组成条目：起始快照各块计数（读库一次，不随批刷新）", async () => {
    const model = await fakeModel();
    const jobId = ingestProject("快照组成", 6); // 直接 S1：6 章 = 一批
    const project = getCurrentProject()!;
    const hero = createEntity(project.db, { type: "character", name: "萧炎", data: { role: "主角" } });
    const elder = createEntity(project.db, { type: "character", name: "药老", data: { role: "配角" } });
    createEntity(project.db, { type: "setting", name: "斗气" });
    createEntity(project.db, { type: "location", name: "乌坦城" });
    createRelation(
      project.db,
      { sourceType: "character", sourceId: hero.id, targetType: "character", targetId: elder.id, relationType: "mentor" },
      project.root,
    );
    model.script([batchJson({ indexes: range(1, 6) }), NO_ALIASES, PLOT_SUMMARY]);

    await startDecomposeJob(project, model.deps);

    // 段内累积（默认并发 1 ⇒ 段 1/1）：段起点快照组成 + 批开始规模都写在 worker 会话里
    const logs = sessionLogsOf(project.root, decomposeWorkerSessionId(jobId, 1));
    expect(logs[0]).toMatchObject({ kind: "snapshot", text: "快照：人物 2 / 设定 1 / 地点 1 / 关系 1 / 前置摘要 0 条" });
    expect(logs[1]).toMatchObject({ kind: "batch_start", batchSeq: 1, text: "批 1 开始（段 1/1；6 章；快照 名字 2 / 关系 1）" });
  });

  it("DELETE /chat/sessions/<拆解会话>：暂停后当前批仍在飞 → 409（主 + 段 worker 都拦）；轮次收尾后可删", async () => {
    const model = await fakeModel();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    model.script([
      async () => {
        await gate;
        return fauxAssistantMessage(batchJson({ indexes: range(1, 6) }));
      },
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);
    const app = buildApp(model.deps);

    const started = await startOk(app, "删除守卫", 6);
    const project = getCurrentProject()!;
    await waitFor(() => model.calls.length >= 1, "批调用已发出");

    // job 行已置 paused（模拟暂停），但在飞批仍会写回这枚会话文件 ⇒ 仍禁删（§7.2）
    updateJobStatus(project.db, started.jobId, "paused", nowIso());
    const sessionId = decomposeSessionId(started.jobId);
    const busy = await app.request(`/api/v1/chat/sessions/${sessionId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(busy.status).toBe(409);
    expect((await busy.json()).error.code).toBe("DECOMPOSE_JOB_RUNNING");
    // 段 worker 会话（`decompose-<jobId>-w<k>`）同样会被在途段原地重建 ⇒ 同受保护
    const workerId = decomposeWorkerSessionId(started.jobId, 1);
    const workerBusy = await app.request(`/api/v1/chat/sessions/${workerId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(workerBusy.status).toBe(409);
    expect((await workerBusy.json()).error.code).toBe("DECOMPOSE_JOB_RUNNING");

    release();
    await waitFor(() => !isDecomposeJobActive(started.jobId), "轮次收尾");
    const after = await app.request(`/api/v1/chat/sessions/${sessionId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(after.status).toBe(200);
    expect(sessionIdsIn(project.root)).not.toContain(sessionId);
    // 轮次收尾后 worker 会话也不再受保护（在飞批的 assistant 消息已让它落盘）
    const workerAfter = await app.request(`/api/v1/chat/sessions/${workerId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(workerAfter.status).toBe(200);
    expect(sessionIdsIn(project.root)).not.toContain(workerId);
  });
});

// ============ 拆解会话保留上限（§7.2） ============

/** 会话文件落盘（形态与生产一致：pi 写完首条 assistant 消息才会把 header + 条目刷到磁盘） */
function writeSessionFile(projectRoot: string, sessionId: string): void {
  const manager = SessionManager.create(projectRoot, join(projectRoot, "sessions"), { id: sessionId });
  manager.appendSessionInfo(`《测试》${sessionId}`);
  manager.appendMessage(fauxAssistantMessage("ok"));
}

/** 造一枚历史 job 行（`created_at` 由测试给 ⇒ 保留窗口的排序确定；空批规划 = 不调模型） */
function historicalJob(project: ProjectContext, createdAt: string): string {
  const job = createDecomposeJob(project.db, {
    scopeStart: 1,
    scopeEnd: 1,
    batchTargetChars: DECOMPOSE_BATCH_TARGET_CHARS,
    concurrency: 1,
    model: null,
    batches: [],
    now: createdAt,
  });
  updateJobStatus(project.db, job.id, "done", createdAt);
  return job.id;
}

/** `<项目根>/sessions` 下的会话 id（pi 文件名 = `<时间戳>_<会话 id>.jsonl`，时间戳段不含 `_`） */
function sessionIdsIn(projectRoot: string): string[] {
  return readdirSync(join(projectRoot, "sessions"))
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => name.slice(name.indexOf("_") + 1, -".jsonl".length));
}

describe("拆解会话保留上限（§7.2）", () => {
  it("新一轮开跑前清理：只剩最近 5 枚 decompose- 会话；chat 会话不受影响；新会话里有不静默的过程条目", async () => {
    const model = await fakeModel();
    model.script([NO_ALIASES]); // 空批 job 收口只发一次别名归并调用（无章摘要 ⇒ 报告不发请求）
    const project = initProject(bookDir("保留上限"), { name: "保留上限" });
    setCurrentProject(project);
    // 六枚历史 job + 各自的会话文件（主 + 段 worker 各一枚）；另造一枚 chat 会话（无前缀 ⇒ 永不参与）
    const jobIds = [1, 2, 3, 4, 5, 6].map((n) => {
      const jobId = historicalJob(project, `2026-01-01T00:00:0${n}.000Z`);
      writeSessionFile(project.root, decomposeSessionId(jobId));
      writeSessionFile(project.root, decomposeWorkerSessionId(jobId, 1));
      return jobId;
    });
    writeSessionFile(project.root, "chat-keep");
    // 新一轮 = 第七枚 job（最新）⇒ 保留窗口 = 最近 5 枚；最旧两枚 job 的**全部会话（主 + worker）**该被清掉
    const newJobId = historicalJob(project, "2026-02-01T00:00:00.000Z");
    updateJobStatus(project.db, newJobId, "running", nowIso());

    await startDecomposeJob(project, model.deps);

    const ids = sessionIdsIn(project.root);
    // 保留窗口内 4 枚旧 job 各主 + worker（2 枚 × 4）+ 本轮主会话（空批 job ⇒ 无 worker）
    expect(ids.filter((id) => id.startsWith(DECOMPOSE_SESSION_ID_PREFIX))).toHaveLength((DECOMPOSE_KEPT_SESSIONS - 1) * 2 + 1);
    expect(ids).toContain("chat-keep");
    const newest = decomposeSessionId(newJobId);
    expect(ids).toContain(newest);
    for (const old of jobIds.slice(0, 2)) {
      expect(ids).not.toContain(decomposeSessionId(old)); // 主会话按精确 id 命中
      expect(ids).not.toContain(decomposeWorkerSessionId(old, 1)); // worker 按 `-w` 前缀命中
    }
    // 窗口内 job 的 worker 会话不受影响
    for (const kept of jobIds.slice(2)) expect(ids).toContain(decomposeWorkerSessionId(kept, 1));
    // 不静默：过程条目写在本轮会话里（枚数与上限都由常量插值，散文不复述数字）
    expect(sessionLogsOf(project.root, newest)[0]).toEqual({
      kind: "session_pruned",
      text: `已清理 4 份更早的拆解记录（保留最近 ${DECOMPOSE_KEPT_SESSIONS} 个 job 的全部会话）`,
      at: expect.any(String),
    });
  });

  it("在跑的 job 的会话绝不删（含暂停后仍在飞的轮次）；清理幂等；轮次收尾后不再受保护", async () => {
    const model = await fakeModel();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    model.script([
      async () => {
        await gate;
        return fauxAssistantMessage(NO_ALIASES);
      },
    ]);
    const project = initProject(bookDir("保留上限·在跑"), { name: "在跑" });
    setCurrentProject(project);
    // 先起一枚 job 的轮次并卡在模型调用上（在跑轮次）；会话文件（主 + worker）已在上一次轮次落盘（续拆形态）
    const runningJobId = historicalJob(project, "2026-01-01T00:00:01.000Z");
    const runningSession = decomposeSessionId(runningJobId);
    const runningWorker = decomposeWorkerSessionId(runningJobId, 1);
    writeSessionFile(project.root, runningSession);
    writeSessionFile(project.root, runningWorker);
    updateJobStatus(project.db, runningJobId, "running", nowIso());
    const run = startDecomposeJob(project, model.deps);
    await waitFor(() => model.calls.length >= 1, "本轮调用已发出");
    // 暂停（job 行已是 paused，但本轮仍在飞）+ 补五枚更新的 job（把它挤出保留窗口）
    updateJobStatus(project.db, runningJobId, "paused", nowIso());
    const olderJobId = historicalJob(project, "2026-01-01T00:00:00.000Z");
    writeSessionFile(project.root, decomposeSessionId(olderJobId));
    for (const n of [3, 4, 5, 6, 7]) writeSessionFile(project.root, decomposeSessionId(historicalJob(project, `2026-01-01T00:00:0${n}.000Z`)));

    // 超出保留窗口的两枚 job：旧 job 被删，在跑的 job 的主 + worker 都不动（job 行 paused ⇒ 只靠「有在跑轮次」守住）
    expect(await pruneDecomposeSessions(project)).toBe(1);
    expect(sessionIdsIn(project.root)).toContain(runningSession);
    expect(sessionIdsIn(project.root)).toContain(runningWorker);
    expect(sessionIdsIn(project.root)).not.toContain(decomposeSessionId(olderJobId));
    // 幂等：再跑一次无副作用（同一批 job 仍然只剩同一枚可删）
    const afterFirst = sessionIdsIn(project.root).sort();
    expect(await pruneDecomposeSessions(project)).toBe(0);
    expect(sessionIdsIn(project.root).sort()).toEqual(afterFirst);

    // 轮次收尾后不再受保护（清理不会把该 job 的会话永久钉住）：主 + worker 一并清
    release();
    await run;
    expect(await pruneDecomposeSessions(project)).toBe(2);
    expect(sessionIdsIn(project.root)).not.toContain(runningSession);
    expect(sessionIdsIn(project.root)).not.toContain(runningWorker);
  });

  it("开会话抛错（缺模型）也不静默：删除日志已落，job 走 failJob 且不 reject", async () => {
    // 无凭据 / 无模型的运行时 ⇒ `openDecomposeSession` 抛「未配置可用模型」，而清理就发生在它之前
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });
    await runtime.refresh({ allowNetwork: false });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const project = initProject(bookDir("保留上限·开会话失败"), { name: "开会话失败" });
      setCurrentProject(project);
      const jobIds = [1, 2, 3, 4, 5, 6].map((n) => {
        const jobId = historicalJob(project, `2026-01-01T00:00:0${n}.000Z`);
        writeSessionFile(project.root, decomposeSessionId(jobId));
        return jobId;
      });
      const newJobId = historicalJob(project, "2026-02-01T00:00:00.000Z");
      updateJobStatus(project.db, newJobId, "running", nowIso());

      await startDecomposeJob(project, { runtime, settings: SettingsManager.inMemory({}) }); // 不 reject = 后台任务兜底

      // 删除不静默：开会话抛错时只剩这条日志，必须已经落下
      expect(logSpy.mock.calls.map((call) => call.join(" "))).toContain(
        `[decompose] 已清理 2 份更早的拆解会话（保留最近 ${DECOMPOSE_KEPT_SESSIONS} 个 job 的全部会话）`,
      );
      const ids = sessionIdsIn(project.root);
      for (const old of jobIds.slice(0, 2)) expect(ids).not.toContain(decomposeSessionId(old));
      // job 走 failJob：错误摘要 + failed；本轮会话没建成（开会话在落盘前抛错）
      expect(getDecomposeJob(project.db)).toMatchObject({
        status: "failed",
        error: expect.stringContaining("未配置可用模型"),
      });
      expect(ids).not.toContain(decomposeSessionId(newJobId));
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
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
    expect(promptOf(model.calls, 0)).toContain("【项目数据快照】（本批是首批，尚无上文）"); // 脏结果未进本轮累积
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
      concurrency: 1,
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

// ============ job 级失败与项目数据快照（§4.1） ============

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

/** 空快照夹具（各用例只填关心的那块） */
function startOf(over: Partial<DecomposeStartSnapshot>): DecomposeStartSnapshot {
  return { characters: [], settings: [], locations: [], relations: [], prevSummaries: [], ...over };
}

describe("项目数据快照（起始快照 + 本轮累积）", () => {
  it("起始快照三块：人物按 role 排序 / 设定地点只给名字 / 关系 / 紧邻范围起点的连续 K 章摘要", () => {
    ingestProject("起始快照", 8); // 8 章 ⇒ 范围可取到中间的起点（S1 直接建档，不起批循环）
    const project = getCurrentProject()!;

    // 章摘要（S3 回写的位置）——范围从第 5 章开始 ⇒ 前置窗口 = 第 4、3、2 章（第 1 / 5 章不取）
    const tree = readOutlineFile(project.root);
    const chapterOrder = deriveChapterOrder(project.root);
    for (const [chapterNumber, summary] of [
      [1, "第一章摘要"],
      [2, "第二章摘要"],
      [3, "第三章摘要"],
      [4, "第四章摘要"],
      [5, "第五章摘要"],
    ] as const) {
      const chapterId = chapterOrder.find((entry) => entry.chapterNumber === chapterNumber)!.chapterId;
      findOutlineNode(tree, chapterId)!.summary = summary;
    }
    writeOutlineFile(project.root, tree);

    // 库里已有的人物 / 设定 / 地点 / 关系（乱序写入：断言的是 role 排序结果）
    const addCharacter = (name: string, role: string) => createEntity(project.db, { type: "character", name, data: { role } });
    addCharacter("路人甲", "路人"); // 词表外 → 末位
    addCharacter("龙套甲", "龙套");
    addCharacter("女主", "主要配角");
    addCharacter("男主", "主角");
    addCharacter("反派甲", "反派");
    const yao = addCharacter("药老", "配角");
    const xiao = createEntity(project.db, { type: "character", name: "萧炎" }); // 没填 role
    createEntity(project.db, { type: "setting", name: "斗气" });
    createEntity(project.db, { type: "location", name: "乌坦城" });
    createRelation(
      project.db,
      { sourceType: "character", sourceId: xiao.id, targetType: "character", targetId: yao.id, relationType: "mentor" },
      project.root,
    );

    const snapshot = readStartSnapshot({
      project,
      scopeStart: 5,
      chapterOrder: deriveChapterOrder(project.root),
      tree: readOutlineFile(project.root),
    });
    expect(snapshot.characters.slice(0, 5).map((character) => [character.name, character.role])).toEqual([
      ["男主", "主角"],
      ["女主", "主要配角"],
      ["药老", "配角"],
      ["反派甲", "反派"],
      ["龙套甲", "龙套"],
    ]);
    // 词表外的 role 与未填 role 同归末位（同权重的先后由稳定排序保持查询顺序，不做更强断言）
    expect(snapshot.characters.slice(5).map((character) => character.name).sort()).toEqual(["萧炎", "路人甲"]);
    expect(DECOMPOSE_ROLE_ORDER).toEqual(["主角", "主要配角", "配角", "反派", "龙套"]);
    expect([...snapshot.settings, ...snapshot.locations]).toEqual(["斗气", "乌坦城"]); // 设定 / 地点只给名字
    expect(snapshot.relations).toEqual(["萧炎→药老（mentor）"]);
    expect(snapshot.prevSummaries).toEqual([
      { chapterNumber: 4, summary: "第四章摘要" }, // 紧邻起点者在最前
      { chapterNumber: 3, summary: "第三章摘要" },
      { chapterNumber: 2, summary: "第二章摘要" },
    ]);
    expect(DECOMPOSE_SNAPSHOT_PREV_CHAPTERS).toBe(3);

    // 范围从第 1 章开始 → 无前置块
    expect(readStartSnapshot({ project, scopeStart: 1, chapterOrder, tree }).prevSummaries).toEqual([]);

    // 渲染：三块都进「项目数据快照」文本
    const text = snapshotText(snapshot, emptyStoryBible());
    expect(text).toContain("名字：男主（主角）、女主（主要配角）");
    expect(text).toContain("设定 / 地点：斗气、乌坦城");
    expect(text).toContain("已有关系：萧炎→药老（mentor）");
    expect(text).toContain("第4章摘要：第四章摘要");
  });

  it("超预算丢弃顺序：设定 / 地点名先丢，名字最后丢（尾部先丢，保留项完整）", () => {
    const settings = Array.from({ length: 60 }, (_, index) => `设定${index + 1}${"长".repeat(30)}`);
    const text = snapshotText(
      startOf({
        characters: [{ name: "萧炎", role: "主角" }],
        settings,
        relations: ["萧炎→药老（mentor）", "药老→萧炎（mentor）"],
        prevSummaries: [{ chapterNumber: 4, summary: "第四章摘要" }],
      }),
      emptyStoryBible(),
    );
    expect(text.length).toBeLessThanOrEqual(DECOMPOSE_SNAPSHOT_MAX_CHARS);
    // 先丢的块：设定 / 地点名被裁（头部保留、尾部丢弃 + 显式告知），保留项仍是完整名字
    const settingsLine = text.split("\n").find((line) => line.startsWith("设定 / 地点："))!;
    const kept = settingsLine.replace("设定 / 地点：", "").split("、");
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(settings.length);
    for (const name of kept) expect(settings).toContain(name);
    expect(text).toMatch(/（已省略 \d+ 个设定 \/ 地点名）/);
    // 后丢的块原样保留
    expect(text).toContain("名字：萧炎（主角）");
    expect(text).toContain("已有关系：萧炎→药老（mentor）、药老→萧炎（mentor）");
    expect(text).toContain("第4章摘要：第四章摘要");
  });

  it("预算继续吃紧：按 关系 → 前置摘要 → 名字 顺序丢，每一块都带告知文案", () => {
    const text = snapshotText(
      startOf({
        characters: [{ name: "萧炎", role: "主角" }],
        relations: Array.from({ length: 200 }, (_, index) => `人物${index}→人物${index + 1}（ally）`),
        prevSummaries: Array.from({ length: 12 }, (_, index) => ({ chapterNumber: index + 1, summary: "摘".repeat(200) })),
      }),
      emptyStoryBible(),
    );
    expect(text.length).toBeLessThanOrEqual(DECOMPOSE_SNAPSHOT_MAX_CHARS);
    expect(text).toMatch(/（已省略 200 个关系）/); // 关系整块丢光
    expect(text).toMatch(/（已省略 \d+ 个摘要）/); // 再接着丢前置摘要（上一批摘要排在最前）
    expect(text).toContain("名字：萧炎（主角）"); // 人物名最后丢 —— 本场景里还轮不到它
    expect(text).not.toMatch(/（已省略 \d+ 个名字）/);
  });

  it("极端预算：名字也按尾部丢弃并显式告知（不静默截断），头部保留", () => {
    const characters = Array.from({ length: 400 }, (_, index) => ({ name: `人物${index + 1}${"长".repeat(10)}`, role: "配角" }));
    const text = snapshotText(startOf({ characters }), emptyStoryBible());
    expect(text.length).toBeLessThanOrEqual(DECOMPOSE_SNAPSHOT_MAX_CHARS);
    expect(text.startsWith("名字：人物1长")).toBe(true); // 头部保留
    expect(text).toMatch(/（已省略 \d+ 个名字）/);
  });

  it("空快照 → 空文本（提示词走「尚无上文」），本轮累积与起始快照合并成同一份文本", () => {
    expect(snapshotText(startOf({}), emptyStoryBible())).toBe("");
    const bible = extendStoryBible(emptyStoryBible(), {
      chapters: [
        {
          chapterIndex: 1,
          chapterTitle: "第1章",
          summary: "上一批摘要",
          characters: [{ name: "药老" }],
          settings: [],
          locations: [],
          relations: [{ source: "药老", target: "萧炎", type: "mentor" }],
        },
      ],
    });
    const text = snapshotText(startOf({ characters: [{ name: "萧炎", role: "主角" }] }), bible);
    expect(text).toContain("名字：萧炎（主角）、药老"); // 两层合进同一份文本（带 role 的在前，本轮累积名接在后面）
    expect(text).toContain("上一批摘要：上一批摘要");
    expect(text).toContain("已有关系：药老→萧炎（mentor）");
  });

  it("预算裁掉名字渲染时，端点名不在提示词里（提示词快照受预算裁剪，抽取结果不受影响）", async () => {
    const model = await fakeModel();
    const jobId = ingestProject("快照全集"); // 默认 6 章 = 一批
    const project = getCurrentProject()!;
    for (let index = 0; index < 60; index++) {
      createEntity(project.db, { type: "setting", name: `设定${index + 1}${"长".repeat(30)}` });
    }
    // 渲染顺序与 `listEntities` 一致 ⇒ 末条必被预算裁掉（快照文本里的省略计数 > 0）
    const droppedName = listEntities(project.db, { type: "setting", limit: MAX_ENTITY_LIST_LIMIT }).items.at(-1)!.name;
    model.script([
      batchJson({ indexes: range(1, 6), relation: { source: droppedName, target: "人物1", type: "ally" } }),
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);

    await startDecomposeJob(project, model.deps);

    const firstPrompt = promptOf(model.calls, 0);
    expect(firstPrompt).toMatch(/（已省略 \d+ 个设定 \/ 地点名）/); // 快照确实被裁
    expect(firstPrompt).not.toContain(droppedName); // 该端点名只在库里、没进提示词
    const batch = decomposeBatchResultSchema.parse(getDecomposeBatch(project.db, jobId, 1)!.result);
    expect(batch.chapters[5].relations).toEqual([{ source: droppedName, target: "人物1", type: "ally", evidence: "证据" }]);
  });

  it("起始快照分页取全：同类型实体超过一页时，超出页的名字仍进快照（提示词渲染受预算裁剪，端点保留不依赖它）", async () => {
    const model = await fakeModel();
    const jobId = ingestProject("分页取全"); // 默认 6 章 = 一批
    const project = getCurrentProject()!;
    const names = Array.from(
      { length: MAX_ENTITY_LIST_LIMIT + 50 },
      (_, index) => `角色${index + 1}号${"长".repeat(4)}`,
    );
    for (const name of names) createEntity(project.db, { type: "character", name });
    // 首页（`listEntities` 单页上限）之外的某个名字：只读首页的旧实现必然漏掉它
    const firstPage = new Set(
      listEntities(project.db, { type: "character", limit: MAX_ENTITY_LIST_LIMIT }).items.map((item) => item.name),
    );
    const beyondPage = names.find((name) => !firstPage.has(name))!;

    const snapshot = readStartSnapshot({
      project,
      scopeStart: 1,
      chapterOrder: deriveChapterOrder(project.root),
      tree: readOutlineFile(project.root),
    });
    expect(snapshot.characters).toHaveLength(names.length); // 分页取全（只取首页 = 少 50 个）
    // 渲染预算装不下这么多名字 ⇒ 提示词里被裁；端点保留与名字集合无关（S2 不判端点，交 S3 悬空过滤）
    expect(snapshotText(snapshot, emptyStoryBible())).toMatch(/（已省略 \d+ 个名字）/);

    model.script([
      batchJson({ indexes: range(1, 6), relation: { source: beyondPage, target: "人物1", type: "ally" } }),
      NO_ALIASES,
      PLOT_SUMMARY,
    ]);
    await startDecomposeJob(project, model.deps);

    const batch = decomposeBatchResultSchema.parse(getDecomposeBatch(project.db, jobId, 1)!.result);
    expect(batch.chapters[5].relations).toEqual([{ source: beyondPage, target: "人物1", type: "ally", evidence: "证据" }]);
    // 快照组成条目报的是全集计数（不是一页）+ 与渲染同源的省略告知（写在段 worker 会话里）
    const logs = sessionLogsOf(project.root, decomposeWorkerSessionId(jobId, 1));
    expect(logs[0]?.kind).toBe("snapshot");
    expect(logs[0]?.text).toContain(`人物 ${names.length} /`);
    expect(logs[0]?.text).toContain("（已省略 ");
  });

  it("起始快照的关系不分页：超过一页条数的关系全部进快照（当轮规模计数）", () => {
    ingestProject("关系取全");
    const project = getCurrentProject()!;
    const source = createEntity(project.db, { type: "character", name: "甲" });
    const target = createEntity(project.db, { type: "character", name: "乙" });
    const total = MAX_ENTITY_LIST_LIMIT + 5; // > 一页
    for (let index = 1; index <= total; index++) {
      createRelation(
        project.db,
        {
          sourceType: "character",
          sourceId: source.id,
          targetType: "character",
          targetId: target.id,
          relationType: `类型${index}`,
        },
        project.root,
      );
    }

    const snapshot = readStartSnapshot({
      project,
      scopeStart: 1,
      chapterOrder: deriveChapterOrder(project.root),
      tree: readOutlineFile(project.root),
    });
    expect(snapshot.relations).toHaveLength(total);
    expect(snapshotComposition(snapshot, emptyStoryBible()).merged.relations).toBe(total);
  });
});
