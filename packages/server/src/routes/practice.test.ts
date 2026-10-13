// 卡 5 文风仿写练习 REST 端点测试：/api/v1/practice/*（九个端点）
//
// **形态：经 `startServer` 装配真实 app**（不是手搭 Hono）——反向守卫 `requireKind("practice")`
// 的挂载点只在 `index.ts` 一处，手搭 app 会漏掉「index.ts 少挂一组 / 顺序挂错（守卫写在
// app.route 之后）」这类缺陷（同 kind-guard.test.ts 口径）。断言全部落在真 HTTP 响应上：
// 状态码 + **与 `docs/api/120-api-practice.md` 逐字对齐的字段名键集**。
//
// 判据覆盖：① 九端点端到端（逐端点 200）② 小说工作区反向守卫 400 KIND_MISMATCH（组根 + 子路径）
// ③ 四个长度上限（含边界）/ `source_kind` 收窄 / camelCase 字段名 ④ 404 PRACTICE_NOT_FOUND
// ⑤ 删目标级联删样本并计数 + 样本列表不含正文与稿/卡 ⑥ strict 单字段改稿 + observation 清空语义。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  OutlineFileTree,
  PracticeSampleDetail,
  PracticeSampleDraftPutRes,
  PracticeSamplesRes,
  PracticeTargetCreated,
  PracticeTargetDeleted,
  PracticeTargetItem,
  PracticeTargetsRes,
  WorkspaceKind,
} from "@whispering233/ai-editor-shared";
import {
  MAX_PRACTICE_DRAFT_CHARS,
  MAX_PRACTICE_OBSERVATION_CHARS,
  MAX_PRACTICE_SAMPLE_CHARS,
  MAX_PRACTICE_SOURCE_LABEL_CHARS,
} from "@whispering233/ai-editor-shared";
import {
  SCHEMA_VERSION,
  closeDatabase,
  openDatabase,
  setUserVersion,
  writeOutlineFile,
  writeProjectFile,
} from "@whispering233/ai-editor-db";
import { startServer, type ServerHandle } from "../index.js";
import { setCurrentProject } from "../middleware/project.js";
import { resetModelRuntime } from "../model-runtime.js";

const HOST_HEADERS = { host: "127.0.0.1" };
const JSON_HEADERS = { ...HOST_HEADERS, "content-type": "application/json" };
const T0 = "2026-10-01T10:00:00Z";
/** 小说工作区访问练习端点时的固定文案（`docs/api/error-code.md`，key = 被要求的 kind） */
const PRACTICE_ONLY_MESSAGE = "该端点仅适用于练习工作区";

/** 文档逐字给定的字段名键集（升序比较用；判据 = 响应字段名与文档一字不差） */
const TARGET_ITEM_KEYS = ["createdAt", "id", "name", "observation", "sampleCount", "updatedAt"]; // 列表项 = PUT 单项目形态
const TARGET_CREATED_KEYS = ["createdAt", "id", "name", "observation", "updatedAt"]; // POST 响应（文档未列 sampleCount）
const SAMPLE_SUMMARY_KEYS = [
  "charCount",
  "createdAt",
  "hasDraft",
  "hasFeedback",
  "id",
  "sourceKind",
  "sourceLabel",
  "updatedAt",
]; // 样本列表项（**不含 text / draft / feedback**）
const SAMPLE_DETAIL_KEYS = [
  "createdAt",
  "draft",
  "feedback",
  "id",
  "observation",
  "sourceKind",
  "sourceLabel",
  "targetId",
  "targetName",
  "text",
  "updatedAt",
]; // 样本详情 = 新建样本的响应

/** 九个练习端点（组根 `/targets` + 各子路径；守卫与小说侧对照同一清单） */
const PRACTICE_ENDPOINTS: { method: string; path: string; body?: unknown }[] = [
  { method: "GET", path: "/api/v1/practice/targets" },
  { method: "POST", path: "/api/v1/practice/targets", body: { name: "越权目标" } },
  { method: "PUT", path: "/api/v1/practice/targets/pt-1", body: { name: "越权改名" } },
  { method: "DELETE", path: "/api/v1/practice/targets/pt-1" },
  { method: "GET", path: "/api/v1/practice/targets/pt-1/samples" },
  { method: "POST", path: "/api/v1/practice/targets/pt-1/samples", body: { source_label: "越权来源", text: "越权范文" } },
  { method: "GET", path: "/api/v1/practice/samples/ps-1" },
  { method: "PUT", path: "/api/v1/practice/samples/ps-1", body: { draft: "越权稿件" } },
  { method: "DELETE", path: "/api/v1/practice/samples/ps-1" },
];

const tmpDirs: string[] = [];
const handles: ServerHandle[] = [];
let homeDir: string;
let originalHome: string | undefined;

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function emptyOutline(): OutlineFileTree {
  return { id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] };
}

/**
 * 建一个工作区（三文件落盘 + `kind` 显式写入）并**以该目录为创作根启动真实服务**
 * （`detectProject` 打开它 → 当前工作区即该 kind）。
 */
async function startWorkspace(kind: WorkspaceKind): Promise<ServerHandle> {
  const dir = makeTmpDir(`ai-editor-practice-${kind}-`);
  tmpDirs.push(dir);
  writeProjectFile(dir, {
    id: `proj-${kind}-1`,
    name: kind === "practice" ? "练习工作区" : "小说工作区",
    language: "zh",
    schema_version: SCHEMA_VERSION,
    current_position: null,
    created_at: T0,
    updated_at: T0,
    kind,
  });
  writeOutlineFile(dir, emptyOutline());
  const db = openDatabase(join(dir, "data.db"));
  try {
    setUserVersion(db, SCHEMA_VERSION);
  } finally {
    closeDatabase(db);
  }
  const handle = await startServer(dir, { port: 0, openBrowser: false });
  handles.push(handle);
  expect(handle.project?.config.kind, "前置：服务已打开该工作区").toBe(kind);
  return handle;
}

interface ApiResult<T> {
  status: number;
  data: T;
  error?: { code: string; message: string; fields?: string[] };
}

/** 发一条 JSON 请求并拆出 { status, data, error }（body 省略 = 不带请求体） */
async function api<T = unknown>(
  handle: ServerHandle,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const res = await handle.app.request(path, {
    method,
    headers: body === undefined ? HOST_HEADERS : JSON_HEADERS,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { success: boolean; data: T; error?: ApiResult<T>["error"] };
  return { status: res.status, data: json.data, error: json.error };
}

/** 键集断言（与文档字段名逐字对齐；顺序无关） */
function expectKeys(actual: object, expected: string[], note?: string): void {
  expect(Object.keys(actual).sort(), note).toEqual(expected);
}

/** 建目标（多数用例的前置）；返回 POST 响应 data */
async function createTarget(handle: ServerHandle, name: string, observation?: string): Promise<PracticeTargetCreated> {
  const res = await api<PracticeTargetCreated>(handle, "POST", "/api/v1/practice/targets", {
    name,
    ...(observation === undefined ? {} : { observation }),
  });
  expect(res.status, "前置：建目标 200").toBe(200);
  return res.data;
}

/** 建样本（多数用例的前置）；返回新建响应（= 详情形态）data */
async function createSample(
  handle: ServerHandle,
  targetId: string,
  input: { source_label: string; text: string },
): Promise<PracticeSampleDetail> {
  const res = await api<PracticeSampleDetail>(handle, "POST", `/api/v1/practice/targets/${targetId}/samples`, input);
  expect(res.status, "前置：建样本 200").toBe(200);
  return res.data;
}

beforeEach(() => {
  originalHome = process.env.HOME;
  homeDir = makeTmpDir("ai-editor-practice-home-");
  process.env.HOME = homeDir;
  resetModelRuntime(); // pi 运行时单例持有 agent dir 路径：HOME 变了必须重建
});

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.close(); // 关监听 + 释放 data.db；再清单例（避免留下已关闭的连接）
  }
  setCurrentProject(null);
  resetModelRuntime();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(homeDir, { recursive: true, force: true });
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("practice 端点（练习工作区，端到端）", () => {
  it("九个端点逐个跑通：状态码均 200，响应字段名与文档逐字一致", async () => {
    const h = await startWorkspace("practice");
    const TEXT = "明海出家已经四年了。";

    // 1. GET /api/v1/practice/targets —— 空列表
    const list0 = await api<PracticeTargetsRes>(h, "GET", "/api/v1/practice/targets");
    expect(list0.status).toBe(200);
    expect(list0.data).toEqual({ targets: [] });

    // 2. POST /api/v1/practice/targets —— 新建目标（name trim）
    const created = await api<PracticeTargetCreated>(h, "POST", "/api/v1/practice/targets", {
      name: " 汪曾祺 ",
      observation: "短句、白描",
    });
    expect(created.status).toBe(200);
    expectKeys(created.data, TARGET_CREATED_KEYS);
    expect(created.data.name).toBe("汪曾祺");
    expect(created.data.observation).toBe("短句、白描");
    expect(created.data.id.startsWith("pt-")).toBe(true);
    expect(created.data.createdAt).toBe(created.data.updatedAt);
    const targetId = created.data.id;

    // 3. GET /api/v1/practice/targets —— 列表项含 sampleCount
    const list1 = await api<PracticeTargetsRes>(h, "GET", "/api/v1/practice/targets");
    expect(list1.status).toBe(200);
    expect(list1.data.targets).toHaveLength(1);
    expectKeys(list1.data.targets[0], TARGET_ITEM_KEYS);
    expect(list1.data.targets[0].id).toBe(targetId);
    expect(list1.data.targets[0].sampleCount).toBe(0);

    // 4. PUT /api/v1/practice/targets/:id —— 单项目形态（含 sampleCount）
    const renamed = await api<PracticeTargetItem>(h, "PUT", `/api/v1/practice/targets/${targetId}`, {
      name: "汪曾祺《受戒》",
    });
    expect(renamed.status).toBe(200);
    expectKeys(renamed.data, TARGET_ITEM_KEYS);
    expect(renamed.data.name).toBe("汪曾祺《受戒》");
    expect(renamed.data.observation).toBe("短句、白描"); // 省略 = 不动
    expect(renamed.data.sampleCount).toBe(0);

    // 5. POST /api/v1/practice/targets/:id/samples —— 新建样本（响应 = 详情形态）
    const newSample = await api<PracticeSampleDetail>(h, "POST", `/api/v1/practice/targets/${targetId}/samples`, {
      source_label: "《受戒》节选",
      text: TEXT,
    });
    expect(newSample.status).toBe(200);
    expectKeys(newSample.data, SAMPLE_DETAIL_KEYS);
    expect(newSample.data.id.startsWith("ps-")).toBe(true);
    expect(newSample.data.targetId).toBe(targetId);
    expect(newSample.data.targetName).toBe("汪曾祺《受戒》"); // 详情拼目标名（承接事实②）
    expect(newSample.data.observation).toBe("短句、白描"); // 详情拼观察
    expect(newSample.data.sourceKind).toBe("paste"); // 省略 = paste
    expect(newSample.data.sourceLabel).toBe("《受戒》节选");
    expect(newSample.data.text).toBe(TEXT);
    expect(newSample.data.draft).toBe(""); // 未写稿 = 空串
    expect(newSample.data.feedback).toBeNull(); // 未点评 = null
    const sampleId = newSample.data.id;

    // 6. GET /api/v1/practice/targets/:id/samples —— 样本列表（只出投影）
    const samples = await api<PracticeSamplesRes>(h, "GET", `/api/v1/practice/targets/${targetId}/samples`);
    expect(samples.status).toBe(200);
    expect(samples.data.samples).toHaveLength(1);
    expectKeys(samples.data.samples[0], SAMPLE_SUMMARY_KEYS);
    expect(samples.data.samples[0].id).toBe(sampleId);
    expect(samples.data.samples[0].charCount).toBe(TEXT.length);
    expect(samples.data.samples[0].hasDraft).toBe(false);
    expect(samples.data.samples[0].hasFeedback).toBe(false);

    // 7. GET /api/v1/practice/samples/:id —— 详情（唯一返回范文全文与点评卡的读端点）
    const detail = await api<PracticeSampleDetail>(h, "GET", `/api/v1/practice/samples/${sampleId}`);
    expect(detail.status).toBe(200);
    expectKeys(detail.data, SAMPLE_DETAIL_KEYS);
    expect(detail.data.text).toBe(TEXT);
    expect(detail.data.targetName).toBe("汪曾祺《受戒》");

    // 8. PUT /api/v1/practice/samples/:id —— 保存仿写稿（返回版本戳）
    const saved = await api<PracticeSampleDraftPutRes>(h, "PUT", `/api/v1/practice/samples/${sampleId}`, {
      draft: "明海出家四年了。",
    });
    expect(saved.status).toBe(200);
    expectKeys(saved.data, ["updatedAt"]);
    expect(new Date(saved.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(detail.data.updatedAt).getTime(),
    );

    // 9. DELETE /api/v1/practice/samples/:id —— 物理删
    const deletedSample = await api<{ deleted: true }>(h, "DELETE", `/api/v1/practice/samples/${sampleId}`);
    expect(deletedSample.status).toBe(200);
    expect(deletedSample.data).toEqual({ deleted: true });

    // 10. DELETE /api/v1/practice/targets/:id —— 物理删（此时目标下已无样本）
    const deletedTarget = await api<PracticeTargetDeleted>(h, "DELETE", `/api/v1/practice/targets/${targetId}`);
    expect(deletedTarget.status).toBe(200);
    expect(deletedTarget.data).toEqual({ deleted: true, deletedSamples: 0 });
    const listEnd = await api<PracticeTargetsRes>(h, "GET", "/api/v1/practice/targets");
    expect(listEnd.data.targets).toEqual([]);
  });

  it("PUT 目标响应的 sampleCount 反映该目标下样本数（建 2 个样本后 = 2）", async () => {
    const h = await startWorkspace("practice");
    const target = await createTarget(h, "目标");
    await createSample(h, target.id, { source_label: "来源一", text: "范文一" });
    await createSample(h, target.id, { source_label: "来源二", text: "范文二" });

    const renamed = await api<PracticeTargetItem>(h, "PUT", `/api/v1/practice/targets/${target.id}`, { name: "改名" });
    expect(renamed.status).toBe(200);
    expect(renamed.data.sampleCount).toBe(2);

    const list = await api<PracticeTargetsRes>(h, "GET", "/api/v1/practice/targets");
    expect(list.data.targets[0].sampleCount).toBe(2);
  });

  it("无当前工作区 → 守卫放行，练习端点给既有 409 NO_PROJECT_OPEN（不改错误语义）", async () => {
    const h = await startWorkspace("practice");
    setCurrentProject(null); // 待命态
    const res = await api(h, "GET", "/api/v1/practice/targets");
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("NO_PROJECT_OPEN");
  });
});

describe("反向守卫（小说工作区访问练习端点）", () => {
  it("九个端点（组根 /targets 与各子路径）在小说工作区上均 400 KIND_MISMATCH（固定文案）", async () => {
    const novel = await startWorkspace("novel");
    for (const ep of PRACTICE_ENDPOINTS) {
      const res = await api(novel, ep.method, ep.path, ep.body);
      expect(res.status, `${ep.method} ${ep.path}`).toBe(400);
      expect(res.error?.code, `${ep.method} ${ep.path}`).toBe("KIND_MISMATCH");
      expect(res.error?.message, `${ep.method} ${ep.path}`).toBe(PRACTICE_ONLY_MESSAGE);
    }
  });

  it("同一批端点在练习工作区上不被守卫拦（404 / 200，绝不 KIND_MISMATCH）", async () => {
    const practice = await startWorkspace("practice");
    for (const ep of PRACTICE_ENDPOINTS) {
      const res = await api(practice, ep.method, ep.path, ep.body);
      expect(res.error?.code, `${ep.method} ${ep.path}`).not.toBe("KIND_MISMATCH");
    }
  });
});

describe("请求校验（长度上限 / 枚举 / 字段名）", () => {
  it("四个长度上限各超 1 字符 → 400 VALIDATION_ERROR（fields 指出出错字段）", async () => {
    const h = await startWorkspace("practice");
    const target = await createTarget(h, "目标");
    const sample = await createSample(h, target.id, { source_label: "来源", text: "范文" });

    const cases: { field: string; note: string; run: () => Promise<ApiResult<unknown>> }[] = [
      {
        field: "observation",
        note: "POST /targets 的 observation",
        run: () =>
          api(h, "POST", "/api/v1/practice/targets", {
            name: "目标2",
            observation: "d".repeat(MAX_PRACTICE_OBSERVATION_CHARS + 1),
          }),
      },
      {
        field: "observation",
        note: "PUT /targets/:id 的 observation",
        run: () =>
          api(h, "PUT", `/api/v1/practice/targets/${target.id}`, {
            observation: "d".repeat(MAX_PRACTICE_OBSERVATION_CHARS + 1),
          }),
      },
      {
        field: "source_label",
        note: "POST /targets/:id/samples 的 source_label",
        run: () =>
          api(h, "POST", `/api/v1/practice/targets/${target.id}/samples`, {
            source_label: "d".repeat(MAX_PRACTICE_SOURCE_LABEL_CHARS + 1),
            text: "范文2",
          }),
      },
      {
        field: "text",
        note: "POST /targets/:id/samples 的 text",
        run: () =>
          api(h, "POST", `/api/v1/practice/targets/${target.id}/samples`, {
            source_label: "来源2",
            text: "d".repeat(MAX_PRACTICE_SAMPLE_CHARS + 1),
          }),
      },
      {
        field: "draft",
        note: "PUT /samples/:id 的 draft",
        run: () =>
          api(h, "PUT", `/api/v1/practice/samples/${sample.id}`, { draft: "d".repeat(MAX_PRACTICE_DRAFT_CHARS + 1) }),
      },
    ];
    for (const item of cases) {
      const res = await item.run();
      expect(res.status, item.note).toBe(400);
      expect(res.error?.code, item.note).toBe("VALIDATION_ERROR");
      expect(res.error?.fields, item.note).toContain(item.field);
    }
  });

  it("长度上限是含端（恰好等于上限 → 200；范文不被截断，charCount 同值）", async () => {
    const h = await startWorkspace("practice");
    const target = await api<PracticeTargetCreated>(h, "POST", "/api/v1/practice/targets", {
      name: "目标",
      observation: "d".repeat(MAX_PRACTICE_OBSERVATION_CHARS),
    });
    expect(target.status).toBe(200);

    const sample = await api<PracticeSampleDetail>(h, "POST", `/api/v1/practice/targets/${target.data.id}/samples`, {
      source_label: "d".repeat(MAX_PRACTICE_SOURCE_LABEL_CHARS),
      text: "d".repeat(MAX_PRACTICE_SAMPLE_CHARS),
    });
    expect(sample.status).toBe(200);

    const saved = await api<PracticeSampleDraftPutRes>(h, "PUT", `/api/v1/practice/samples/${sample.data.id}`, {
      draft: "d".repeat(MAX_PRACTICE_DRAFT_CHARS),
    });
    expect(saved.status).toBe(200);

    const list = await api<PracticeSamplesRes>(h, "GET", `/api/v1/practice/targets/${target.data.id}/samples`);
    expect(list.data.samples[0].charCount).toBe(MAX_PRACTICE_SAMPLE_CHARS);
  });

  it('source_kind 收窄为 "paste"：传 "file" → 400；省略 / 显式 "paste" → 200 且落库 "paste"', async () => {
    const h = await startWorkspace("practice");
    const target = await createTarget(h, "目标");

    const bad = await api(h, "POST", `/api/v1/practice/targets/${target.id}/samples`, {
      source_kind: "file",
      source_label: "来源",
      text: "范文",
    });
    expect(bad.status).toBe(400);
    expect(bad.error?.code).toBe("VALIDATION_ERROR");
    expect(bad.error?.fields).toContain("source_kind");

    const omitted = await createSample(h, target.id, { source_label: "来源一", text: "范文一" });
    expect(omitted.sourceKind).toBe("paste");
    const explicit = await api<PracticeSampleDetail>(h, "POST", `/api/v1/practice/targets/${target.id}/samples`, {
      source_kind: "paste",
      source_label: "来源二",
      text: "范文二",
    });
    expect(explicit.status).toBe(200);
    expect(explicit.data.sourceKind).toBe("paste");
  });

  it("请求字段名 snake_case：camelCase 字段与多余字段一律 400 VALIDATION_ERROR（strict）", async () => {
    const h = await startWorkspace("practice");
    const target = await createTarget(h, "目标");
    const sample = await createSample(h, target.id, { source_label: "来源", text: "范文" });

    const cases: { note: string; run: () => Promise<ApiResult<unknown>> }[] = [
      {
        note: "POST /targets：camelCase sampleCount",
        run: () => api(h, "POST", "/api/v1/practice/targets", { name: "目标2", sampleCount: 1 }),
      },
      {
        note: "POST /targets/:id/samples：camelCase sourceLabel / sourceKind",
        run: () =>
          api(h, "POST", `/api/v1/practice/targets/${target.id}/samples`, {
            sourceKind: "paste",
            sourceLabel: "来源2",
            text: "范文2",
          }),
      },
      {
        note: "PUT /targets/:id：camelCase sampleCount",
        run: () => api(h, "PUT", `/api/v1/practice/targets/${target.id}`, { sampleCount: 1 }),
      },
      {
        note: "PUT /samples/:id：多字段（strict 单字段）",
        run: () => api(h, "PUT", `/api/v1/practice/samples/${sample.id}`, { draft: "新稿", extra: 1 }),
      },
      {
        note: "PUT /samples/:id：camelCase baseUpdatedAt",
        run: () => api(h, "PUT", `/api/v1/practice/samples/${sample.id}`, { draft: "新稿", baseUpdatedAt: T0 }),
      },
    ];
    for (const item of cases) {
      const res = await item.run();
      expect(res.status, item.note).toBe(400);
      expect(res.error?.code, item.note).toBe("VALIDATION_ERROR");
    }

    // 反证：草稿未被这些被拒请求改动
    const detail = await api<PracticeSampleDetail>(h, "GET", `/api/v1/practice/samples/${sample.id}`);
    expect(detail.data.draft).toBe("");
  });

  it("PUT /targets/:id 要求至少给一项（空 body → 400）；name trim 后空串 → 400", async () => {
    const h = await startWorkspace("practice");
    const target = await createTarget(h, "目标");

    const empty = await api(h, "PUT", `/api/v1/practice/targets/${target.id}`, {});
    expect(empty.status).toBe(400);
    expect(empty.error?.code).toBe("VALIDATION_ERROR");
    expect(empty.error?.fields).toEqual(["name"]); // 「至少给一项」的错误提示挂在 name 上（非空串路径）

    const blank = await api(h, "PUT", `/api/v1/practice/targets/${target.id}`, { name: "   " });
    expect(blank.status).toBe(400);
    expect(blank.error?.code).toBe("VALIDATION_ERROR");

    const createdBlank = await api(h, "POST", "/api/v1/practice/targets", { name: "   " });
    expect(createdBlank.status).toBe(400);
    expect(createdBlank.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("不存在 → 404 PRACTICE_NOT_FOUND", () => {
  it("改目标 / 删目标 / 不存在目标下建样本 / 列样本 / 查样本详情 / 保存稿件 / 删样本", async () => {
    const h = await startWorkspace("practice");
    const cases: { note: string; run: () => Promise<ApiResult<unknown>> }[] = [
      {
        note: "PUT /targets/:id（目标不存在）",
        run: () => api(h, "PUT", "/api/v1/practice/targets/pt-missing", { name: "改名" }),
      },
      { note: "DELETE /targets/:id", run: () => api(h, "DELETE", "/api/v1/practice/targets/pt-missing") },
      {
        note: "POST /targets/:id/samples（目标不存在）",
        run: () =>
          api(h, "POST", "/api/v1/practice/targets/pt-missing/samples", { source_label: "来源", text: "范文" }),
      },
      { note: "GET /targets/:id/samples", run: () => api(h, "GET", "/api/v1/practice/targets/pt-missing/samples") },
      { note: "GET /samples/:id", run: () => api(h, "GET", "/api/v1/practice/samples/ps-missing") },
      { note: "PUT /samples/:id", run: () => api(h, "PUT", "/api/v1/practice/samples/ps-missing", { draft: "稿件" }) },
      { note: "DELETE /samples/:id", run: () => api(h, "DELETE", "/api/v1/practice/samples/ps-missing") },
    ];
    for (const item of cases) {
      const res = await item.run();
      expect(res.status, item.note).toBe(404);
      expect(res.error?.code, item.note).toBe("PRACTICE_NOT_FOUND");
    }
  });
});

describe("删除与清空语义", () => {
  it("删目标 → {deleted:true, deletedSamples:N} 且样本真删；样本列表键集不含 text / draft / feedback", async () => {
    const h = await startWorkspace("practice");
    const target = await createTarget(h, "目标");
    const first = await createSample(h, target.id, { source_label: "来源一", text: "范文一" });
    await createSample(h, target.id, { source_label: "来源二", text: "范文二" });

    const listed = await api<PracticeSamplesRes>(h, "GET", `/api/v1/practice/targets/${target.id}/samples`);
    expect(listed.data.samples).toHaveLength(2);
    for (const item of listed.data.samples) {
      expectKeys(item, SAMPLE_SUMMARY_KEYS, "样本列表项");
      expect("text" in item).toBe(false);
      expect("draft" in item).toBe(false);
      expect("feedback" in item).toBe(false);
    }

    const deleted = await api<PracticeTargetDeleted>(h, "DELETE", `/api/v1/practice/targets/${target.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.data).toEqual({ deleted: true, deletedSamples: 2 });

    // 样本行**真删**（不是留孤儿行）：详情 404
    const gone = await api(h, "GET", `/api/v1/practice/samples/${first.id}`);
    expect(gone.status).toBe(404);
    expect(gone.error?.code).toBe("PRACTICE_NOT_FOUND");
    // 目标列表回到空（级联后书架无残留）
    const targets = await api<PracticeTargetsRes>(h, "GET", "/api/v1/practice/targets");
    expect(targets.data.targets).toEqual([]);
  });

  it("PUT /targets/:id 的 observation：省略 = 不动、空串 = 清空（写 null，详情同屏字段同步）", async () => {
    const h = await startWorkspace("practice");
    const created = await createTarget(h, "目标", "短句、白描");

    const renamed = await api<PracticeTargetItem>(h, "PUT", `/api/v1/practice/targets/${created.id}`, { name: "改名" });
    expect(renamed.status).toBe(200);
    expect(renamed.data.name).toBe("改名");
    expect(renamed.data.observation).toBe("短句、白描"); // 省略 = 不动

    const cleared = await api<PracticeTargetItem>(h, "PUT", `/api/v1/practice/targets/${created.id}`, {
      observation: "",
    });
    expect(cleared.status).toBe(200);
    expect(cleared.data.observation).toBeNull(); // 空串 = 清空
    expect(cleared.data.name).toBe("改名"); // 未给的字段不动

    const sample = await createSample(h, created.id, { source_label: "来源", text: "范文" });
    const detail = await api<PracticeSampleDetail>(h, "GET", `/api/v1/practice/samples/${sample.id}`);
    expect(detail.data.observation).toBeNull();
  });

  it("PUT /samples/:id：空串合法（清空稿件，hasDraft 回落）；范文与点评卡不动", async () => {
    const h = await startWorkspace("practice");
    const target = await createTarget(h, "目标");
    const sample = await createSample(h, target.id, { source_label: "来源", text: "范文原样" });

    const saved = await api<PracticeSampleDraftPutRes>(h, "PUT", `/api/v1/practice/samples/${sample.id}`, {
      draft: "初稿",
    });
    expect(saved.status).toBe(200);
    const afterSave = await api<PracticeSamplesRes>(h, "GET", `/api/v1/practice/targets/${target.id}/samples`);
    expect(afterSave.data.samples[0].hasDraft).toBe(true);

    const cleared = await api<PracticeSampleDraftPutRes>(h, "PUT", `/api/v1/practice/samples/${sample.id}`, {
      draft: "",
    });
    expect(cleared.status).toBe(200);
    const detail = await api<PracticeSampleDetail>(h, "GET", `/api/v1/practice/samples/${sample.id}`);
    expect(detail.data.draft).toBe("");
    expect(detail.data.text).toBe("范文原样"); // 范文不可变
    expect(detail.data.feedback).toBeNull(); // 保存稿件不碰点评卡
    const afterClear = await api<PracticeSamplesRes>(h, "GET", `/api/v1/practice/targets/${target.id}/samples`);
    expect(afterClear.data.samples[0].hasDraft).toBe(false); // 空串 = 未写稿
  });
});
