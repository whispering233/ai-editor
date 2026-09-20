// 卡 21.4 拆解 analyze 路由测试：POST /api/v1/decompose/analyze（切分预览，无状态）
// 覆盖：正常预览（编码 / 章列表全量 / 统计 / 警告 / 默认书名）/ 超体积 400 / 空文本与空白文本 400 /
// query 校验 400 / **不要求项目已打开** / 范围只影响 estimate（章列表不变、越界落成零批）/
// estimate 公式（批数 + 每批固定开销 + 每章输出）/ costApprox 两态（未配置模型凭据 → null；
// 注入内存运行时 + faux 费率 → 按 pi 模型目录 `Model.cost` 算出）。
// fixture 全部自造，不读 test-project/（该目录整体不入库）。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { DecomposeAnalyzeRes } from "@whispering233/ai-editor-shared";
import { errorHandler } from "../middleware/error.js";
import { getCurrentProject, originCheckMiddleware, projectMiddleware, setCurrentProject } from "../middleware/project.js";
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

/** 造一份可切分样本：章数 ≥ 切分器下限、每章正文长于微段阈值（否则会落退化等分）；
 * 每章字数按序递增 ⇒ 字分布（min / median / max）有区分度 */
function novelText(chapterCount: number): string {
  return Array.from(
    { length: chapterCount },
    (_, position) => `第${position + 1}章 标题${position + 1}\n${"正文".repeat(150 + position * 20)}`,
  ).join("\n");
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
  setCurrentProject(null);
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
