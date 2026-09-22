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
// - estimate：批数走 `decompose/batching.ts` 组批 + `decompose/budget.ts` 预算守卫（与落批同一份）、
//   每批固定开销取 runner 的提示词 framing 上界（`batchOverheadTokensUpperBound`，与执行期预检同源）、
//   `llmCalls = 批数 + 归并 + 报告`、token 按字数与章数粗估；费率读 pi 模型目录 `Model.cost`
//   （`getModelRuntime()` 唯一入口，**不自建定价表**），未配置模型/凭据（或模型目录不可读）→
//   `costApprox = null`（批预算同源缺席 → 退回结构组批），预览照常返回。
// - **续拆两端点（plan / continue）不吃文件字节**：章与正文已在库（S1 全量导入），范围缺省 = 未拆章最小
//   覆盖区间（`decompose/job.ts` 的 `readDecomposeProjectPlan`）；两端的范围解析与估算走同一实现
//   （预览说拆哪些，启动就必须拆哪些），continue 的 S1' **只落 job 与批规划**。

import { existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { Hono, type Context } from "hono";
import type {
  DecomposeAnalyzeRes,
  DecomposeBatchRes,
  DecomposeJobLogRes,
  DecomposePlanRes,
  DecomposeStartRes,
} from "@whispering233/ai-editor-shared";
import {
  decomposeAnalyzeQuerySchema,
  decomposeBatchResultSchema,
  decomposeContinueQuerySchema,
  decomposeJobLogResSchema,
  decomposeLogEntrySchema,
  decomposeStartQuerySchema,
} from "@whispering233/ai-editor-shared/schemas";
import { readProjectSession, listProjectSessions, type SessionEntry } from "@whispering233/ai-editor-agent";
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
import {
  DECOMPOSE_CHARS_PER_TOKEN,
  DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER,
  planBatchesWithinBudget,
  type DecomposeBatchBudget,
  type ModelTokenLimits,
} from "../decompose/budget.js";
import { readDecomposeConcurrency } from "../decompose/config.js";
import { buildJobResponse, ingestDecomposeContinue, ingestDecomposeProject, readDecomposeProjectPlan, type DecomposeProjectPlan } from "../decompose/job.js";
import {
  batchOverheadTokensUpperBound,
  pauseDecomposeJob,
  startDecomposeJob,
  type BatchChapterHeading,
  type DecomposeRunnerDeps,
} from "../decompose/runner.js";
import {
  DECOMPOSE_LOG_CUSTOM_TYPE,
  decomposeSessionId,
  decomposeWorkerSessionPrefix,
} from "../decompose/llm.js";
import { splitNovelWithSlices, statsOf, type SplitChapter } from "../decompose/split.js";

/** 上传体积上限（原始字节；超限 400 DECOMPOSE_FILE_TOO_LARGE）。analyze 与 start 共用——同文件。 */
export const DECOMPOSE_MAX_FILE_BYTES = 16 * 1024 * 1024;

/** 每 token 的汉字数（中文粗估）与每章输出预算：**单一定义已移至 `decompose/budget.ts`**
 * （落批守卫与预估共用同一份）；此处的 re-export 保持既有消费面（路由测试 / 预估推导）不变。 */
export { DECOMPOSE_CHARS_PER_TOKEN, DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER };
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

/** 模型两侧上限投影（结构类型，不引入 pi 的 `Model` 泛型；模型目录查不到 → null） */
function modelLimitsOf(model: { contextWindow: number; maxTokens: number } | undefined): ModelTokenLimits | null {
  return model === undefined ? null : { contextWindow: model.contextWindow, maxTokens: model.maxTokens };
}

/**
 * 批预算组装（单一来源）：模型两侧上限 + 每批固定开销。固定开销由 runner 的提示词 framing 上界派生
 * （`batchOverheadTokensUpperBound`：真实 system + 快照预算 + 框架 + 逐章标题行）——规划侧与执行期
 * 预检同源，不会出现「规划放行、预检判死」；上限缺失 → null（落批退回结构组批）。
 */
function batchBudgetOf(
  limits: ModelTokenLimits | null,
  chapters: readonly BatchChapterHeading[],
): DecomposeBatchBudget | null {
  return limits === null ? null : { limits, fixedOverheadTokens: batchOverheadTokensUpperBound(chapters) };
}

/**
 * 激活模型的预估输入（analyze / plan 的预估用）——`resolveActiveSelection` 的口径与 chat / 设置页一致：
 * pi settings 的默认模型优先 → 首个有凭据的可用模型 → 缺失（什么都没配）。
 * 任何失败（模型目录不可读、坏 models.json）只让金额与批预算缺席，不阻断预览。
 * 批预算与落批同源（`decompose/budget.ts`）：预览的批数/调用数套同一套守卫，不出现「预览 N 批、实际 M 批」。
 */
async function activeEstimateInputs(
  deps: DecomposeRouteDeps,
): Promise<{ rates: ModelCostRates | null; limits: ModelTokenLimits | null }> {
  try {
    const runtime = deps.runtime ?? (await getModelRuntime());
    const selection = await resolveActiveSelection(runtime, deps.settings ?? getSettingsManager());
    if (selection === null) return { rates: null, limits: null };
    const model = runtime.getModel(selection.provider, selection.modelId);
    if (model === undefined) return { rates: null, limits: null };
    return {
      rates: { input: model.cost.input, output: model.cost.output },
      limits: modelLimitsOf(model),
    };
  } catch {
    return { rates: null, limits: null };
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
 * 批规划与落批走**同一份预算守卫**（`limits` 缺失时才退回结构组批）——预览的批数/调用数是落批的镜像；
 * 固定开销取 runner 的提示词 framing 上界（与执行期预检同源，见 `batchOverheadTokensUpperBound`）。
 */
function buildEstimate(
  chapters: readonly SplitChapter[],
  rates: ModelCostRates | null,
  limits: ModelTokenLimits | null,
): DecomposeAnalyzeRes["estimate"] {
  const budget = batchBudgetOf(limits, chapters);
  const batches = budget === null ? planBatches(chapters) : planBatchesWithinBudget(chapters, budget);
  const scopeChars = chapters.reduce((sum, chapter) => sum + chapter.charCount, 0);
  const overheadTokens = budget?.fixedOverheadTokens ?? batchOverheadTokensUpperBound(chapters);
  const inputTokensApprox = Math.ceil(scopeChars / DECOMPOSE_CHARS_PER_TOKEN) + batches.length * overheadTokens;
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
 * 续拆范围解析（plan 与 continue **共用同一实现**）：逐项缺省 = 未拆章最小覆盖区间（无未拆章 → 0/0）；
 * 显式范围包含已拆章 = **有意重拆**（归并按跨轮口径复用已有实体，设计 §7.1）。
 * `start > end` → 400 `VALIDATION_ERROR`（缺省范围本身恒合法，故只可能来自显式参数）。
 */
function resolveContinueScope(
  plan: DecomposeProjectPlan,
  query: { scope_start?: number; scope_end?: number },
): { scopeStart: number; scopeEnd: number; defaulted: boolean } {
  const scopeStart = query.scope_start ?? plan.defaultScopeStart;
  const scopeEnd = query.scope_end ?? plan.defaultScopeEnd;
  if (scopeStart > scopeEnd) {
    throw new HttpError(400, "VALIDATION_ERROR", `范围非法：起始章 ${scopeStart} 大于结束章 ${scopeEnd}`);
  }
  return {
    scopeStart,
    scopeEnd,
    defaulted: query.scope_start === undefined || query.scope_end === undefined,
  };
}

/** 续拆范围里的章（章序 = 1-based 文件位置序，连续 ⇒ 过滤即夹取——与 `chaptersInScope` 同口径） */
function planChaptersInScope(plan: DecomposeProjectPlan, scopeStart: number, scopeEnd: number) {
  return plan.chapters.filter((chapter) => chapter.index >= scopeStart && chapter.index <= scopeEnd);
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
 * @returns 审计用的模型标识 `provider/modelId` + 模型两侧上限（落批预算由调用方按**本次范围的章集**
 * 组装：固定开销取提示词 framing 上界，见 `batchBudgetOf`；模型目录里查不到该模型 → `limits = null`，
 * 落批退回结构组批）
 */
async function requireActiveModel(
  deps: DecomposeRouteDeps,
): Promise<{ label: string; limits: ModelTokenLimits | null }> {
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
  const model = runtime.getModel(selection.provider, selection.modelId);
  return {
    label: `${selection.provider}/${selection.modelId}`,
    limits: modelLimitsOf(model),
  };
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
    const estimateInputs = await activeEstimateInputs(deps);
    const estimate = buildEstimate(scoped, estimateInputs.rates, estimateInputs.limits);
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
    const { label: model, limits } = await requireActiveModel(deps);
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
    const project = initProject(dir, { name, origin: "decompose" });
    const previous = getCurrentProject();
    if (previous !== null && previous.db !== project.db) closeProject(previous);
    setCurrentProject(project); // 释放旧项目运行时（disposeProjectRuntime 单点）
    writeLastProject(root, dir); // 创作根 lastProject：下次启动自动打开这本书

    const chapters = split.result.chapters;
    const scope = jobScope(query.scope_start, query.scope_end, chapters.length);
    const scoped = chaptersInScope(chapters, query.scope_start, query.scope_end);
    // 并发段数快照：**建 job 时读创作根配置一次**（§2.2；改配置只影响新 job，resume / 重跑读 job 行）
    const { jobId, batchCount } = ingestDecomposeProject({
      project,
      split,
      scopedChapters: scoped,
      scopeStart: scope.start,
      scopeEnd: scope.end,
      model,
      budget: batchBudgetOf(limits, scoped), // 批大小预算（§4 守卫）：按本模型两侧上限落批
      concurrency: readDecomposeConcurrency(getProjectRoot()),
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

  // GET /api/v1/decompose/plan?scope_start=&scope_end= —— 续拆预览（不落库、无状态；**不吃文件字节**）
  routes.get("/plan", async (c) => {
    const query = decomposeContinueQuerySchema.parse(c.req.query()); // 范围非整数 / < 1 → 400 VALIDATION_ERROR
    const project = requireCurrentProject(); // 无已打开项目 → 409 NO_PROJECT_OPEN
    const plan = readDecomposeProjectPlan(project);
    if (plan.chapters.length === 0) {
      throw new HttpError(404, "DECOMPOSE_NO_CHAPTERS", "当前项目没有章：没有可续拆的正文（先在本书导入正文或重新拆解）");
    }
    const scope = resolveContinueScope(plan, query);
    const scoped = planChaptersInScope(plan, scope.scopeStart, scope.scopeEnd);
    const estimateInputs = await activeEstimateInputs(deps);
    return c.json(
      ok({
        scopeStart: scope.scopeStart,
        scopeEnd: scope.scopeEnd,
        defaulted: scope.defaulted,
        remainingCount: plan.remainingCount,
        decomposedInScope: scoped.filter((chapter) => chapter.decomposed).length,
        chapters: plan.chapters, // 全书章列表（含已拆标注）——与 analyze 同为全量口径
        stats: statsOf(plan.chapters.map((chapter) => chapter.charCount)),
        // 估算与 analyze **同一实现**（`buildEstimate`）：只换输入章集（库内章而非切分结果）
        estimate: buildEstimate(scoped, estimateInputs.rates, estimateInputs.limits),
      } satisfies DecomposePlanRes),
    );
  });

  // POST /api/v1/decompose/continue?scope_start=&scope_end= —— 续拆：当前项目内开新 job（S1' 只落 job 与批规划）
  routes.post("/continue", async (c) => {
    const query = decomposeContinueQuerySchema.parse(c.req.query());
    const project = requireCurrentProject();
    // 顺序 = 模型/凭据 → 活跃 job 互斥 → 范围解析：缺凭据不先落 job 行（同 start 的「不留半成品」口径）；
    // 互斥拦在范围解析前——已有 running / paused job 时范围解析无意义（只有终态 done / failed 可开新 job，§7.1）
    const { label: model, limits } = await requireActiveModel(deps);
    const current = getDecomposeJob(project.db); // 一项目取最新 job（db helper 口径）
    if (current !== null && current.status !== "done" && current.status !== "failed") {
      throw new HttpError(
        409,
        "DECOMPOSE_JOB_STATE",
        `job ${current.id} 状态为 ${current.status}，不能开新 job（先等它收尾，或对它续拆 / 重跑）`,
      );
    }
    const plan = readDecomposeProjectPlan(project);
    const scope = resolveContinueScope(plan, query);
    const scoped = planChaptersInScope(plan, scope.scopeStart, scope.scopeEnd);
    if (scoped.length === 0) {
      throw new HttpError(400, "DECOMPOSE_NOTHING_TO_DO", "范围里没有可拆的章（缺省且无未拆章——可显式指定范围重拆）");
    }
    // S1'：只落新 job 行 + 批规划行（**不建大纲、不导正文**，正文是 S1 的全量一次性产物）
    const { jobId, batchCount } = ingestDecomposeContinue({
      project,
      scopedChapters: scoped,
      scopeStart: scope.scopeStart,
      scopeEnd: scope.scopeEnd,
      model,
      budget: batchBudgetOf(limits, scoped), // 批大小预算（§4 守卫）：与 start 同口径（按本模型两侧上限落批）
      concurrency: readDecomposeConcurrency(getProjectRoot()), // 建 job 时读创作根配置一次（同 start）
      now: nowIso(),
    });
    // S2 批执行（**后台跑，不 await**）：响应返回时 job 已 running（进度页轮询看状态，与 start 同款）
    void startDecomposeJob(project, deps);
    return c.json(
      ok({
        jobId,
        scopeStart: scope.scopeStart,
        scopeEnd: scope.scopeEnd,
        status: "running" as const,
        batchCount,
      }),
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
    // 分段并发下时间线 = 主会话（计划留档 + 汇总 + S3/S4）+ 各段 worker 会话（`decompose-<jobId>-w` 前缀）
    // 的**过程条目合并**（§2.2 / §8），按时间排序；会话文件被用户删掉 / 尚未落盘 ⇒ 该枚不参与（不回 404）
    const sessionId = decomposeSessionId(job.id);
    const workerPrefix = decomposeWorkerSessionPrefix(job.id);
    const workerIds = (await listProjectSessions(project.root))
      .map((info) => info.id)
      .filter((id) => id.startsWith(workerPrefix))
      .sort(); // 段号升序（同刻条目的稳定次序：主会话在前、段号小的在前）
    const entries: DecomposeJobLogRes["entries"] = [];
    for (const id of [sessionId, ...workerIds]) {
      const opened = await readProjectSession(project.root, id);
      if (opened !== null) entries.push(...projectLogEntries(opened.entries));
    }
    entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); // 合并后按时间排序（同刻保持来源顺序）
    return jobLogResponse(c, { sessionId, entries });
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
