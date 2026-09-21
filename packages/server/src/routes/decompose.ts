// 拆解小说路由（analyze 预览 + start 建档 + job 进度 / 单批结果 + pause / resume）
//
// 契约单一来源：docs/api/120-api-decompose.md §analyze / §start / §job / §batches / §pause / §resume +
// 请求侧原始字节例外段（docs/api/api-public.md）；语义见 docs/design/60-decompose.md §3（切分）/
// §4（范围与预估、批调度）/ §7（状态机与续拆）。
// 口径：
// - **不要求项目已打开**：预览不落库、不建项目、无状态（改范围 = 客户端重传原始字节，服务端不留临时文件）；
//   start 总是**新建并打开**项目（等价 POST /project/open 的切换语义）；job / batches 读当前项目；
// - 请求体是**小说文件原始字节**（`application/octet-stream`），`file_name` / 书名 / 范围走 query；
// - 切分唯一实现 = `decompose/split.ts` 的 `splitNovelWithSlices`（analyze 与 start 同一份，确定性）；
// - **章列表全量返回**，范围**只影响批规划与预估**（正文始终全量导入，见 §4「范围」）；
// - estimate：批数走 `decompose/batching.ts` 的组批实现（与落批同一份）、`llmCalls = 批数 + 归并 + 报告`、
//   token 按字数与章数粗估；费率读 pi 模型目录 `Model.cost`（`getModelRuntime()` 唯一入口，**不自建定价表**），
//   未配置模型/凭据（或模型目录不可读）→ `costApprox = null`，预览照常返回。

import { existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { Hono, type Context } from "hono";
import type {
  DecomposeAnalyzeRes,
  DecomposeBatchRes,
  DecomposeJobLogRes,
  DecomposeStartRes,
} from "@whispering233/ai-editor-shared";
import {
  decomposeAnalyzeQuerySchema,
  decomposeBatchResultSchema,
  decomposeJobLogResSchema,
  decomposeLogEntrySchema,
  decomposeStartQuerySchema,
} from "@whispering233/ai-editor-shared/schemas";
import { readProjectSession, type SessionEntry } from "@whispering233/ai-editor-agent";
import { getDecomposeBatch, getDecomposeJob, nowIso, setJobError, updateJobStatus } from "@whispering233/ai-editor-db";
import { HttpError, ok } from "../middleware/error.js";
import { getModelRuntime, getSettingsManager, resolveActiveSelection } from "../model-runtime.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  requireCurrentProject,
  setCurrentProject,
} from "../middleware/project.js";
import { writeLastProject } from "../last-project.js";
import { BOOKS_DIR_NAME, getProjectRoot, resolveProjectDir } from "./project.js";
import { planBatches } from "../decompose/batching.js";
import { buildJobResponse, ingestDecomposeProject } from "../decompose/job.js";
import { pauseDecomposeJob, startDecomposeJob, type DecomposeRunnerDeps } from "../decompose/runner.js";
import { DECOMPOSE_LOG_CUSTOM_TYPE, decomposeSessionId } from "../decompose/llm.js";
import { splitNovelWithSlices, type SplitChapter } from "../decompose/split.js";

/** 上传体积上限（原始字节；超限 400 DECOMPOSE_FILE_TOO_LARGE）。analyze 与 start 共用——同文件。 */
export const DECOMPOSE_MAX_FILE_BYTES = 16 * 1024 * 1024;

/** 每 token 的汉字数（中文粗估；换 tokenizer 只调这一处——预估本就是量级参考） */
export const DECOMPOSE_CHARS_PER_TOKEN = 1.5;
/** 每批固定开销 token 粗估（系统提示 + 指令 + 滚动故事圣经）——批处理省的是这个，省不了正文与输出 */
export const DECOMPOSE_BATCH_OVERHEAD_TOKENS = 800;
/** 每章输出 token 粗估（一条摘要（受 `DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS` 约束）+ 若干实体线索） */
export const DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER = 400;

/** 费率口径：pi `Model.cost` 是**每百万 token** 单价（同 `calculateCost` 的除法口径） */
const TOKENS_PER_MILLION = 1_000_000;
/** 批处理之外的 LLM 调用数：归并 + 报告（docs/design/60-decompose.md §2「总调用数 = 批数 + 1 + 1」） */
const NON_BATCH_LLM_CALLS = 2;

/** 单模型费率（每百万 token）——只取输入/输出两档，缓存价与阶梯价不参与粗估 */
interface ModelCostRates {
  input: number;
  output: number;
}

/**
 * 拆解路由可注入依赖（测试注入内存运行时；缺省走真实 pi 单例）。
 * 与批执行器 `DecomposeRunnerDeps` 同源：路由把同一份依赖原样传给 S2 runner（注入点只有一处）。
 */
export type DecomposeRouteDeps = DecomposeRunnerDeps;

/**
 * 激活模型的费率——`resolveActiveSelection` 的口径与 chat / 设置页一致：
 * pi settings 的默认模型优先 → 首个有凭据的可用模型 → null（什么都没配）。
 * 任何失败（模型目录不可读、坏 models.json）只让金额缺席，不阻断预览。
 */
async function activeCostRates(deps: DecomposeRouteDeps): Promise<ModelCostRates | null> {
  try {
    const runtime = deps.runtime ?? (await getModelRuntime());
    const selection = await resolveActiveSelection(runtime, deps.settings ?? getSettingsManager());
    if (selection === null) return null;
    const model = runtime.getModel(selection.provider, selection.modelId);
    return model === undefined ? null : { input: model.cost.input, output: model.cost.output };
  } catch {
    return null;
  }
}

/** 默认书名 = 文件名去扩展名（去完为空 → 原名兜底；只做派生，用户可在客户端改） */
function defaultBookName(fileName: string): string {
  const base = basename(fileName);
  const extension = extname(base);
  const stripped = (extension === "" ? base : base.slice(0, -extension.length)).trim();
  return stripped === "" ? base : stripped;
}

/**
 * 范围 → 章区间：缺省全书；越界自然落空（章序 = 1-based 文件位置序，连续 ⇒ 过滤即夹取）。
 * analyze 的预估与 start 的批规划共用本函数（两处各写一份必然漂移）。
 */
function chaptersInScope(chapters: readonly SplitChapter[], scopeStart?: number, scopeEnd?: number): SplitChapter[] {
  const start = scopeStart ?? 1;
  const end = scopeEnd ?? chapters.length;
  return chapters.filter((chapter) => chapter.index >= start && chapter.index <= end);
}

/**
 * 范围预估（docs/design/60-decompose.md §4）：
 * 输入 ∝ 范围正文 + 每批固定开销（归并只看候选清单、报告只看章摘要，相对正文可忽略）；
 * 输出 ∝ 章数（成本杠杆是范围，不是批大小）。
 */
function buildEstimate(chapters: readonly SplitChapter[], rates: ModelCostRates | null): DecomposeAnalyzeRes["estimate"] {
  const batches = planBatches(chapters);
  const scopeChars = chapters.reduce((sum, chapter) => sum + chapter.charCount, 0);
  const inputTokensApprox =
    Math.ceil(scopeChars / DECOMPOSE_CHARS_PER_TOKEN) + batches.length * DECOMPOSE_BATCH_OVERHEAD_TOKENS;
  const outputTokensApprox = chapters.length * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER;
  return {
    batchCount: batches.length,
    llmCalls: batches.length + NON_BATCH_LLM_CALLS,
    inputTokensApprox,
    outputTokensApprox,
    costApprox:
      rates === null
        ? null
        : (inputTokensApprox * rates.input + outputTokensApprox * rates.output) / TOKENS_PER_MILLION,
  };
}

/**
 * job 记录的范围（§4「范围」）：起始取请求值、结束夹到末章（`scope_end` 超章数等同全量）。
 * 夹取后仍可能 `start > end`（范围落空）——与 analyze 的过滤口径一致：零批但不报 400。
 */
function jobScope(
  scopeStart: number | undefined,
  scopeEnd: number | undefined,
  chapterCount: number,
): { start: number; end: number } {
  return { start: scopeStart ?? 1, end: Math.min(scopeEnd ?? chapterCount, chapterCount) };
}

/**
 * 书名校验（服务端侧兜底，防目录逃逸）：trim 后非空、不含路径分隔符 / 控制字符、不为 `.` / `..`。
 * 客户端有同名纯函数（`client/src/lib/book-name.ts`，跨包不共享）——规则一致，此处是信任边界。
 */
function assertBookName(name: string): void {
  if (name === "" || /[\\/]|^\.+$|[\u0000-\u001f]/.test(name)) {
    throw new HttpError(400, "INVALID_PROJECT_PATH", `书名非法（不能为空、含 / \\ 或控制字符，也不能是 . / ..）: ${name}`);
  }
}

/**
 * 激活模型 + 凭据校验（与 chat 开流前预检同口径）：未配置模型或缺凭据 → 400 `LLM_API_KEY_MISSING`。
 * start 在建项目**之前**调用——缺凭据不留半成品项目（api/120-api-decompose.md §start）。
 * @returns 审计用的模型标识 `provider/modelId`
 */
async function requireActiveModel(deps: DecomposeRouteDeps): Promise<string> {
  const runtime = deps.runtime ?? (await getModelRuntime());
  const selection = await resolveActiveSelection(runtime, deps.settings ?? getSettingsManager());
  if (selection === null) {
    throw new HttpError(400, "LLM_API_KEY_MISSING", "未配置可用模型：请先在设置页选择模型");
  }
  if (!runtime.hasConfiguredAuth(selection.provider)) {
    throw new HttpError(
      400,
      "LLM_API_KEY_MISSING",
      `未配置 ${selection.provider} 的凭据：请在设置页填写 API key，或设置对应环境变量`,
    );
  }
  return `${selection.provider}/${selection.modelId}`;
}

/**
 * 读上传体（原始字节）+ 体积校验（analyze / start 共用；超限 400 `DECOMPOSE_FILE_TOO_LARGE`）。
 * 必须在任何落盘 / 建目录之前调用。
 */
async function readNovelBody(c: Context): Promise<Uint8Array> {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > DECOMPOSE_MAX_FILE_BYTES) {
    throw new HttpError(
      400,
      "DECOMPOSE_FILE_TOO_LARGE",
      `文件超过体积上限 ${DECOMPOSE_MAX_FILE_BYTES / 1024 / 1024}MB，请改用更小的文本文件`,
    );
  }
  return bytes;
}

/** 拆解路由工厂（测试经 deps 注入内存运行时；index.ts 用缺省依赖） */
export function createDecomposeRoutes(deps: DecomposeRouteDeps = {}): Hono {
  const routes = new Hono();

  // POST /api/v1/decompose/analyze?file_name=&scope_start=&scope_end= —— body = 文件原始字节
  routes.post("/analyze", async (c) => {
    const query = decomposeAnalyzeQuerySchema.parse(c.req.query()); // 缺 file_name / 范围非法 → 400 VALIDATION_ERROR
    const bytes = await readNovelBody(c);
    const preview = splitNovelWithSlices(bytes).result;
    // 解码永远成功（TextDecoder 非致命 + GB18030 回退 ⇒ 不抛错），故「解码失败」的可见形态只有一种：
    // 归一化后没有任何文本（空文件 / 只有空白 / 非文本内容）。契约的两条 400 语义在本实现里同码。
    if (preview.totalChars === 0) {
      throw new HttpError(400, "DECOMPOSE_FILE_INVALID", "文件没有可解析的文本（空文件或非文本内容）");
    }
    const scoped = chaptersInScope(preview.chapters, query.scope_start, query.scope_end);
    const estimate = buildEstimate(scoped, await activeCostRates(deps));
    return c.json(
      ok({
        ...preview, // encoding / totalChars / chapters（全量）/ volumes / stats / warnings
        estimate,
        defaultName: defaultBookName(query.file_name),
      } satisfies DecomposeAnalyzeRes),
    );
  });

  // POST /api/v1/decompose/start?file_name=&name=&scope_start=&scope_end= —— body = 文件原始字节
  routes.post("/start", async (c) => {
    const query = decomposeStartQuerySchema.parse(c.req.query()); // 缺 file_name / name / 范围非法 → 400 VALIDATION_ERROR
    const bytes = await readNovelBody(c);
    // 建项目之前的三道校验（缺一道就会留下半成品项目 / 越权目录）：凭据 → 切分文本 → 书名与目标路径
    const model = await requireActiveModel(deps);
    const split = splitNovelWithSlices(bytes);
    if (split.result.totalChars === 0) {
      throw new HttpError(400, "DECOMPOSE_FILE_INVALID", "文件没有可解析的文本（空文件或非文本内容）");
    }
    const root = getProjectRoot();
    if (root === null) {
      throw new HttpError(500, "INTERNAL_ERROR", "创作根未初始化（startServer 未调用 setProjectRoot）");
    }
    const name = query.name.trim();
    assertBookName(name);
    const target = join(root, BOOKS_DIR_NAME, name);
    // 书名冲突：目录已存在即拒（含非项目目录——不在用户已有目录上建档，api 错误码表「书名对应目录已存在」）
    if (existsSync(target)) {
      throw new HttpError(409, "PROJECT_ALREADY_EXISTS", `同名书籍已存在: ${target}`);
    }
    mkdirSync(target, { recursive: true }); // 目录需存在才能做 realpath 校验（与 /project/create 同序）
    const dir = resolveProjectDir(target); // 非绝对 / 链接跳转 → 400 INVALID_PROJECT_PATH

    // 建档 + 打开（等价 POST /project/open 的切换语义：新项目就绪后再关旧的，失败时当前项目保持原样；
    // open 的两条兜底——旧 prompt 迁移与软删一致性补标——对新项目无对象，故不调用）
    const project = initProject(dir, { name });
    const previous = getCurrentProject();
    if (previous !== null && previous.db !== project.db) closeProject(previous);
    setCurrentProject(project); // 释放旧项目运行时（disposeProjectRuntime 单点）
    writeLastProject(root, dir); // 创作根 lastProject：下次启动自动打开这本书

    const chapters = split.result.chapters;
    const scope = jobScope(query.scope_start, query.scope_end, chapters.length);
    const { jobId, batchCount } = ingestDecomposeProject({
      project,
      split,
      scopedChapters: chaptersInScope(chapters, query.scope_start, query.scope_end),
      scopeStart: scope.start,
      scopeEnd: scope.end,
      model,
      now: nowIso(),
    });
    // S2 批执行（**后台跑，不 await**）：S1 已同步完成，响应返回时批循环开跑（进度页轮询看状态）
    void startDecomposeJob(project, deps);
    return c.json(
      ok({
        projectId: project.config.id,
        projectPath: dir,
        name,
        jobId,
        status: "running" as const, // S1 已同步完成 ⇒ 返回时 job 已进入 running（批执行归 S2 runner）
        batchCount,
      } satisfies DecomposeStartRes),
    );
  });

  // GET /api/v1/decompose/job —— 当前项目的 job 状态（进度轮询；**不含批结果正文**）
  routes.get("/job", (c) => {
    const project = requireCurrentProject(); // 无已打开项目 → 409 NO_PROJECT_OPEN
    const job = getDecomposeJob(project.db); // 多 job 并存取最新（created_at desc → id desc，db helper 内）
    if (job === null) {
      throw new HttpError(404, "DECOMPOSE_JOB_NOT_FOUND", "当前项目没有拆解任务");
    }
    return c.json(ok(buildJobResponse(project, job)));
  });

  // GET /api/v1/decompose/job/batches/:seq —— 单批抽取结果（进度页展开行按需拉取）
  routes.get("/job/batches/:seq", (c) => {
    const project = requireCurrentProject();
    const rawSeq = c.req.param("seq");
    const seq = Number(rawSeq);
    if (!Number.isInteger(seq) || seq < 1) {
      throw new HttpError(404, "DECOMPOSE_BATCH_NOT_FOUND", `批序号非法: ${rawSeq}`);
    }
    const job = getDecomposeJob(project.db);
    if (job === null) {
      throw new HttpError(404, "DECOMPOSE_JOB_NOT_FOUND", "当前项目没有拆解任务");
    }
    const batch = getDecomposeBatch(project.db, job.id, seq);
    if (batch === null) {
      throw new HttpError(404, "DECOMPOSE_BATCH_NOT_FOUND", `批序号越界: ${seq}`);
    }
    // db 层只保证「坏 JSON 不抛错」（形状不校验，`[1,2]` 这类值会原样透出）⇒ 本层按契约 schema 守卫：
    // 不符形状按「未完成」处理（result = null），不把脏数据发给客户端。
    const parsed = batch.result === null ? null : decomposeBatchResultSchema.safeParse(batch.result);
    return c.json(
      ok({
        seq: batch.seq,
        status: batch.status,
        attempts: batch.attempts,
        error: batch.error,
        result: parsed !== null && parsed.success ? parsed.data : null,
      } satisfies DecomposeBatchRes),
    );
  });

  // GET /api/v1/decompose/job/log —— 拆解过程时间线（读拆解会话里的 custom 过程条目）
  routes.get("/job/log", async (c) => {
    const project = requireCurrentProject();
    const job = getDecomposeJob(project.db);
    if (job === null) {
      throw new HttpError(404, "DECOMPOSE_JOB_NOT_FOUND", "当前项目没有拆解任务");
    }
    // 会话定位按**会话 id**（经 pi 的磁盘发现 + id 命中）——pi 落盘文件名带时间戳前缀，不得按文件名 glob；
    // 会话文件被用户删掉 / 尚未落盘 ⇒ entries: []（契约：job 还在就回 200，不回 404）
    const sessionId = decomposeSessionId(job.id);
    const opened = await readProjectSession(project.root, sessionId);
    return jobLogResponse(c, {
      sessionId,
      entries: opened === null ? [] : projectLogEntries(opened.entries),
    });
  });

  // POST /api/v1/decompose/job/pause —— 中止当前 job（当前批跑完即停，结果不浪费）
  routes.post("/job/pause", (c) => {
    const project = requireCurrentProject();
    const job = getDecomposeJob(project.db);
    if (job === null) {
      throw new HttpError(404, "DECOMPOSE_JOB_NOT_FOUND", "当前项目没有拆解任务");
    }
    // 状态前置：`done` / `paused` / `failed` 都不允许再中止（api/120-api-decompose.md §pause）
    if (job.status !== "running" && job.status !== "pending") {
      throw new HttpError(409, "DECOMPOSE_JOB_STATE", `job 状态为 ${job.status}，不能中止（仅 running / pending 可暂停）`);
    }
    // 先置信号再写状态：进程内那一轮停在批间（已发出的模型调用不 abort），状态立刻可见（不等批收尾）
    pauseDecomposeJob(job.id);
    updateJobStatus(project.db, job.id, "paused", nowIso());
    return c.json(ok({ status: "paused" as const }));
  });

  // POST /api/v1/decompose/job/resume —— 从第一个未完成批续拆（跳过 done 的批）
  routes.post("/job/resume", async (c) => {
    const project = requireCurrentProject();
    const job = getDecomposeJob(project.db);
    if (job === null) {
      throw new HttpError(404, "DECOMPOSE_JOB_NOT_FOUND", "当前项目没有拆解任务");
    }
    if (job.status !== "paused") {
      throw new HttpError(409, "DECOMPOSE_JOB_STATE", `job 状态为 ${job.status}，不能续拆（仅 paused 可续拆）`);
    }
    // 续拆前预检模型/凭据（与 start 同口径）：缺凭据 → 400 且不改状态（否则 job 卡在「running 无 runner」）
    await requireActiveModel(deps);
    updateJobStatus(project.db, job.id, "running", nowIso());
    setJobError(project.db, job.id, null, nowIso()); // 开工清上一次的 job 级错误摘要
    void startDecomposeJob(project, deps);
    return c.json(ok({ status: "running" as const }));
  });

  // POST /api/v1/decompose/job/batches/:seq/rerun —— 单批重跑（done 与 failed 都可重跑 → job 回 running）
  routes.post("/job/batches/:seq/rerun", async (c) => {
    const project = requireCurrentProject();
    const job = getDecomposeJob(project.db);
    if (job === null) {
      throw new HttpError(404, "DECOMPOSE_JOB_NOT_FOUND", "当前项目没有拆解任务");
    }
    // 状态前置（api/120-api-decompose.md §rerun）：running / paused 不接（需先等收尾或续拆）
    if (job.status !== "done" && job.status !== "failed") {
      throw new HttpError(409, "DECOMPOSE_JOB_STATE", `job 状态为 ${job.status}，不能重跑（仅 done / failed 可重跑）`);
    }
    const rawSeq = c.req.param("seq");
    const seq = Number(rawSeq);
    if (!Number.isInteger(seq) || seq < 1) {
      throw new HttpError(404, "DECOMPOSE_BATCH_NOT_FOUND", `批序号非法: ${rawSeq}`);
    }
    if (getDecomposeBatch(project.db, job.id, seq) === null) {
      throw new HttpError(404, "DECOMPOSE_BATCH_NOT_FOUND", `批序号越界: ${seq}`);
    }
    // 模型/凭据前置（与 resume 同口径）：缺凭据时重跑会先把该批的抽取结果清掉（failBatch 置 NULL）
    // 再走到 job failed——一次凭据抖动就烧掉一批已付 token 的产物。故 400 且**不改状态、不动批结果**。
    await requireActiveModel(deps);
    updateJobStatus(project.db, job.id, "running", nowIso());
    setJobError(project.db, job.id, null, nowIso()); // 开工清上一次的 job 级错误摘要
    // S2 重跑该批 → 批全部收口后自动接 S3 归并 + S4 报告（runner 的收口路径）
    void startDecomposeJob(project, deps, { rerunSeq: seq });
    // 形状归 shared `decomposeRerunResSchema`（与 pause / resume 同款：响应类型不另开别名）
    return c.json(ok({ status: "running" as const, seq }));
  });

  return routes;
}

/**
 * 过程条目投影（§8 时间线）：**只**取 `customType = decompose` 的 custom 条目——同一文件里还有
 * message / model_change / session_info 以及别的扩展写的 custom 条目，一律不进响应（原文与模型产出
 * 因此不可能泄漏到时间线里）。形状不符的条目跳过（同 batches 路由的形状守卫口径：脏数据不发客户端），
 * `at` 缺 / 坏则回退条目自身的时间戳。顺序 = 文件顺序。
 */
function projectLogEntries(entries: readonly SessionEntry[]): DecomposeJobLogRes["entries"] {
  const projected: DecomposeJobLogRes["entries"] = [];
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== DECOMPOSE_LOG_CUSTOM_TYPE) continue;
    const data =
      typeof entry.data === "object" && entry.data !== null ? (entry.data as Record<string, unknown>) : {};
    const parsed = decomposeLogEntrySchema.safeParse({
      id: entry.id,
      at: typeof data.at === "string" ? data.at : entry.timestamp,
      kind: data.kind,
      text: data.text,
      batchSeq: data.batchSeq,
    });
    if (parsed.success) projected.push(parsed.data);
  }
  return projected;
}

/** 响应自检出口（参照 chat.ts sessionsResponse）：parse 失败 = 500 INTERNAL_ERROR（不让 ZodError 冒泡成 400） */
function jobLogResponse(c: Context, payload: DecomposeJobLogRes): Response {
  try {
    return c.json(ok(decomposeJobLogResSchema.parse(payload)));
  } catch (err) {
    throw new HttpError(
      500,
      "INTERNAL_ERROR",
      `拆解记录响应不符合契约: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** 拆解路由（挂载于 /api/v1/decompose，index.ts）；测试用 `createDecomposeRoutes(deps)` 注入运行时 */
export const decomposeRoutes = createDecomposeRoutes();
