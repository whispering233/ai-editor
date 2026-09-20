// 拆解小说路由（卡 21.4）：POST /api/v1/decompose/analyze —— 切分预览，**无状态**
//
// 契约单一来源：docs/api/120-api-decompose.md §analyze + 请求侧原始字节例外段（docs/api/api-public.md）；
// 语义见 docs/design/60-decompose.md §3（切分）/ §4（范围与预估）。
// 口径：
// - **不要求项目已打开**：预览不落库、不建项目、无状态（改范围 = 客户端重传原始字节，服务端不留临时文件）；
// - 请求体是**小说文件原始字节**（`application/octet-stream`），`file_name` / 范围走 query；
// - 切分唯一实现 = `decompose/split.ts` 的 `splitNovel`（与后续 start 的 S1 同一份，确定性）；
// - **章列表全量返回**，范围**只影响 estimate**（正文始终全量导入，见 §4「范围」）；
// - estimate：批数走 `decompose/batching.ts` 的组批实现（与落批同一份）、`llmCalls = 批数 + 归并 + 报告`、
//   token 按字数与章数粗估；费率读 pi 模型目录 `Model.cost`（`getModelRuntime()` 唯一入口，**不自建定价表**），
//   未配置模型/凭据（或模型目录不可读）→ `costApprox = null`，预览照常返回。

import { basename, extname } from "node:path";
import { Hono } from "hono";
import type { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { DecomposeAnalyzeRes } from "@whispering233/ai-editor-shared";
import { decomposeAnalyzeQuerySchema } from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { getModelRuntime, getSettingsManager, resolveActiveSelection } from "../model-runtime.js";
import { planBatches } from "../decompose/batching.js";
import { splitNovel, type SplitChapter } from "../decompose/split.js";

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

/** 拆解路由可注入依赖（测试注入内存运行时；缺省走真实 pi 单例） */
export interface DecomposeRouteDeps {
  /** 模型/凭据运行时（缺省 = `getModelRuntime()` 单例） */
  runtime?: ModelRuntime;
  /** 全局 settings（缺省 = `getSettingsManager()` 单例） */
  settings?: SettingsManager;
}

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

/** 范围 → 章区间：缺省全书；越界自然落空（章序 = 1-based 文件位置序，连续 ⇒ 过滤即夹取） */
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

/** 拆解路由工厂（测试经 deps 注入内存运行时；index.ts 用缺省依赖） */
export function createDecomposeRoutes(deps: DecomposeRouteDeps = {}): Hono {
  const routes = new Hono();

  // POST /api/v1/decompose/analyze?file_name=&scope_start=&scope_end= —— body = 文件原始字节
  routes.post("/analyze", async (c) => {
    const query = decomposeAnalyzeQuerySchema.parse(c.req.query()); // 缺 file_name / 范围非法 → 400 VALIDATION_ERROR
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > DECOMPOSE_MAX_FILE_BYTES) {
      throw new HttpError(
        400,
        "DECOMPOSE_FILE_TOO_LARGE",
        `文件超过体积上限 ${DECOMPOSE_MAX_FILE_BYTES / 1024 / 1024}MB，请改用更小的文本文件`,
      );
    }
    const preview = splitNovel(bytes);
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

  return routes;
}

/** 拆解路由（挂载于 /api/v1/decompose，index.ts）；测试用 `createDecomposeRoutes(deps)` 注入运行时 */
export const decomposeRoutes = createDecomposeRoutes();
