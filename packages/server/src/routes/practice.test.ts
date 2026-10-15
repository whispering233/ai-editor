// 卡 3 作家文风练习 REST 端点测试：/api/v1/practice/*（13 个端点，2026-10 改版）
//
// **形态：经 `startServer` 装配真实 app**（不是手搭 Hono）——前置守卫 `requireKind("practice")`
// 的挂载点只在 `index.ts` 一处，手搭 app 会漏掉「index.ts 少挂一组 / 顺序挂错（守卫写在
// app.route 之后）」这类缺陷（同 kind-guard.test.ts 口径）。断言全部落在真 HTTP 响应上：
// 状态码 + **与 `docs/api/120-api-practice.md` 逐字对齐的字段名键集**。
//
// 判据覆盖：① 13 端点端到端（逐端点 200）② 小说工作区反向守卫 400 KIND_MISMATCH（固定文案）
// ③ `author_id` 缺失 / 未知 → 400 VALIDATION_ERROR「练习工作区未关联预置作家」④ 无当前工作区 409
// ⑤ 六个长度上限 / `work_id` 成员校验 / `topic_source` 两分支 / trim 非空 / strict 单字段
// ⑥ 404 文案按资源（样本「练习样本不存在」/ 自由练习「自由练习不存在」）
// ⑦ 素材包三态（预置 → 覆盖 → 幂等恢复预置）⑧ 列表投影不含正文/稿件/卡体 + updatedAt 倒序、
// 同值按 id 升序 ⑨ 点评卡内层 snake_case 原样透传（含 `{}`）。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  OutlineFileTree,
  PracticeDeleted,
  PracticeDraftPutRes,
  PracticePieceDetail,
  PracticePiecesRes,
  PracticeSampleDetail,
  PracticeSamplesRes,
  PracticeStylePack,
  WorkspaceKind,
} from "@whispering233/ai-editor-shared";
import {
  AUTHOR_IDS,
  MAX_PRACTICE_BRIEF_CHARS,
  MAX_PRACTICE_DRAFT_CHARS,
  MAX_PRACTICE_EXCERPT_LABEL_CHARS,
  MAX_PRACTICE_SAMPLE_CHARS,
  MAX_PRACTICE_STYLE_PACK_CHARS,
  MAX_PRACTICE_TOPIC_CHARS,
  PRACTICE_OTHER_WORK_LABEL,
  resolveAuthor,
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
/** 预置作家（本组端点要求 `author_id` 命中 shared 清单；内容不硬编码，全部经 resolveAuthor 取） */
const AUTHOR = resolveAuthor(AUTHOR_IDS[0])!;
const WORK = AUTHOR.works[0]!;
/** 小说工作区访问练习端点时的固定文案（`docs/api/error-code.md`，key = 被要求的 kind） */
const PRACTICE_ONLY_MESSAGE = "该端点仅适用于练习工作区";
/** `author_id` 解析不到预置作家时的固定文案（docs/api/120-api-practice.md 前置条件） */
const NO_AUTHOR_MESSAGE = "练习工作区未关联预置作家";

/** 文档逐字给定的字段名键集（升序比较用；判据 = 响应字段名与文档一字不差） */
const SAMPLE_SUMMARY_KEYS = [
  "charCount",
  "createdAt",
  "excerptLabel",
  "hasDraft",
  "hasFeedback",
  "id",
  "updatedAt",
  "workId",
]; // 样本列表项（**不含 text / draft / feedback**）
const PIECE_SUMMARY_KEYS = [
  "brief",
  "charCount",
  "createdAt",
  "hasDraft",
  "hasFeedback",
  "id",
  "topic",
  "topicSource",
  "updatedAt",
]; // 自由练习列表项（**不含 draft / feedback**）
const SAMPLE_DETAIL_KEYS = [
  "createdAt",
  "draft",
  "excerptLabel",
  "feedback",
  "id",
  "text",
  "updatedAt",
  "workId",
]; // 样本详情 = 新建样本的响应
const PIECE_DETAIL_KEYS = [
  "brief",
  "createdAt",
  "draft",
  "feedback",
  "id",
  "topic",
  "topicSource",
  "updatedAt",
]; // 自由练习详情 = 新建的响应
const STYLE_PACK_KEYS = ["authorId", "content", "customized", "updatedAt"];

/** 13 个练习端点（守卫与小说侧对照同一清单；body 只是为了让 POST/PUT 走到校验层） */
const PRACTICE_ENDPOINTS: { method: string; path: string; body?: unknown }[] = [
  { method: "GET", path: "/api/v1/practice/samples" },
  { method: "POST", path: "/api/v1/practice/samples", body: { text: "越权范文" } },
  { method: "GET", path: "/api/v1/practice/samples/ps-1" },
  { method: "PUT", path: "/api/v1/practice/samples/ps-1", body: { draft: "越权稿件" } },
  { method: "DELETE", path: "/api/v1/practice/samples/ps-1" },
  { method: "GET", path: "/api/v1/practice/style-pack" },
  { method: "PUT", path: "/api/v1/practice/style-pack", body: { content: "越权风格说明" } },
  { method: "DELETE", path: "/api/v1/practice/style-pack" },
  { method: "GET", path: "/api/v1/practice/free" },
  { method: "POST", path: "/api/v1/practice/free", body: { topic_source: "user", topic: "越权题目" } },
  { method: "GET", path: "/api/v1/practice/free/pf-1" },
  { method: "PUT", path: "/api/v1/practice/free/pf-1", body: { draft: "越权稿件" } },
  { method: "DELETE", path: "/api/v1/practice/free/pf-1" },
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
 * 建一个工作区（三文件落盘 + `kind` 显式写入、练习区另写 `author_id`）并**以该目录为创作根启动真实服务**
 * （`detectProject` 打开它 → 当前工作区即该 kind）。
 * `authorId` 传 `null` = 练习工作区**不写** `author_id`（存量 / 坏值工作区的守卫用例）。
 */
async function startWorkspace(
  kind: WorkspaceKind,
  options: { authorId?: string | null } = {},
): Promise<ServerHandle> {
  const dir = makeTmpDir(`ai-editor-practice-${kind}-`);
  tmpDirs.push(dir);
  const authorId = options.authorId === undefined ? AUTHOR.id : options.authorId;
  writeProjectFile(dir, {
    id: `proj-${kind}-1`,
    name: kind === "practice" ? "练习工作区" : "小说工作区",
    language: "zh",
    schema_version: SCHEMA_VERSION,
    current_position: null,
    created_at: T0,
    updated_at: T0,
    kind,
    ...(kind === "practice" && authorId !== null ? { author_id: authorId } : {}),
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

/** 建样本（多数用例的前置）；返回新建响应（= 详情形态）data */
async function createSample(
  handle: ServerHandle,
  input: { work_id?: string | null; excerpt_label?: string; text: string },
): Promise<PracticeSampleDetail> {
  const res = await api<PracticeSampleDetail>(handle, "POST", "/api/v1/practice/samples", input);
  expect(res.status, "前置：建样本 200").toBe(200);
  return res.data;
}

/** 建自由练习篇（多数用例的前置） */
async function createPiece(
  handle: ServerHandle,
  input: { topic_source: "user" | "ai"; topic?: string; brief?: string },
): Promise<PracticePieceDetail> {
  const res = await api<PracticePieceDetail>(handle, "POST", "/api/v1/practice/free", input);
  expect(res.status, "前置：建自由练习篇 200").toBe(200);
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
  it("13 个端点逐个跑通：状态码均 200，响应字段名与文档逐字一致", async () => {
    const h = await startWorkspace("practice");
    const TEXT = "明海出家已经四年了。";

    // 1. GET /practice/samples —— 空列表
    const list0 = await api<PracticeSamplesRes>(h, "GET", "/api/v1/practice/samples");
    expect(list0.status).toBe(200);
    expect(list0.data).toEqual({ samples: [] });

    // 2. POST /practice/samples —— 新建样本（响应 = 详情形态）
    const created = await api<PracticeSampleDetail>(h, "POST", "/api/v1/practice/samples", {
      work_id: WORK.id,
      excerpt_label: " 节选 ",
      text: ` ${TEXT} `,
    });
    expect(created.status).toBe(200);
    expectKeys(created.data, SAMPLE_DETAIL_KEYS, "POST 样本响应 = 详情形态");
    expect(created.data.id.startsWith("ps-")).toBe(true);
    expect(created.data.workId).toBe(WORK.id);
    expect(created.data.excerptLabel).toBe("节选"); // 片段说明 trim 后落库（可空字段同样去首尾空白）
    expect(created.data.text).toBe(TEXT); // 范文 trim 后落库
    expect(created.data.draft).toBe("");
    expect(created.data.feedback).toBeNull();
    expect(created.data.createdAt).toBe(created.data.updatedAt);
    const sampleId = created.data.id;

    // 3. GET /practice/samples/:id —— 详情（唯一返回范文全文与点评卡的读端点）
    const sampleDetail = await api<PracticeSampleDetail>(h, "GET", `/api/v1/practice/samples/${sampleId}`);
    expect(sampleDetail.status).toBe(200);
    expectKeys(sampleDetail.data, SAMPLE_DETAIL_KEYS);
    expect(sampleDetail.data.text).toBe(TEXT);

    // 4. GET /practice/samples —— 列表（只出投影）
    const samples = await api<PracticeSamplesRes>(h, "GET", "/api/v1/practice/samples");
    expect(samples.data.samples).toHaveLength(1);
    expectKeys(samples.data.samples[0], SAMPLE_SUMMARY_KEYS, "样本列表项");
    expect(samples.data.samples[0]).toMatchObject({
      id: sampleId,
      workId: WORK.id,
      excerptLabel: "节选",
      charCount: TEXT.length,
      hasDraft: false,
      hasFeedback: false,
    });

    // 5. PUT /practice/samples/:id —— 保存仿写稿（返回版本戳）
    const saved = await api<PracticeDraftPutRes>(h, "PUT", `/api/v1/practice/samples/${sampleId}`, {
      draft: "明海出家四年了。",
    });
    expect(saved.status).toBe(200);
    expectKeys(saved.data, ["updatedAt"]);
    const afterSave = await api<PracticeSamplesRes>(h, "GET", "/api/v1/practice/samples");
    expect(afterSave.data.samples[0].hasDraft).toBe(true);
    expect(afterSave.data.samples[0].charCount).toBe(TEXT.length); // charCount 恒为范文长度（列表为「N 字范文」）
    expect(afterSave.data.samples[0].updatedAt).toBe(saved.data.updatedAt);

    // 6. DELETE /practice/samples/:id —— 物理删
    const deletedSample = await api<PracticeDeleted>(h, "DELETE", `/api/v1/practice/samples/${sampleId}`);
    expect(deletedSample.status).toBe(200);
    expect(deletedSample.data).toEqual({ deleted: true });
    expect((await api(h, "GET", `/api/v1/practice/samples/${sampleId}`)).status).toBe(404);

    // 7. GET /practice/style-pack —— 无覆盖 = 预置文本
    const pack0 = await api<PracticeStylePack>(h, "GET", "/api/v1/practice/style-pack");
    expect(pack0.status).toBe(200);
    expectKeys(pack0.data, STYLE_PACK_KEYS);
    expect(pack0.data).toEqual({
      authorId: AUTHOR.id,
      content: AUTHOR.styleNotes,
      customized: false,
      updatedAt: null,
    });

    // 8. PUT /practice/style-pack —— 写入用户覆盖
    const pack1 = await api<PracticeStylePack>(h, "PUT", "/api/v1/practice/style-pack", {
      content: "  自定义风格说明  ",
    });
    expect(pack1.status).toBe(200);
    expectKeys(pack1.data, STYLE_PACK_KEYS);
    expect(pack1.data).toMatchObject({ authorId: AUTHOR.id, content: "自定义风格说明", customized: true });
    expect(pack1.data.updatedAt).not.toBeNull();

    // 9. GET /practice/style-pack —— 覆盖生效
    const pack2 = await api<PracticeStylePack>(h, "GET", "/api/v1/practice/style-pack");
    expect(pack2.data).toMatchObject({ content: "自定义风格说明", customized: true });

    // 10. DELETE /practice/style-pack —— 恢复预置（幂等：再删一次仍 200）
    const pack3 = await api<PracticeStylePack>(h, "DELETE", "/api/v1/practice/style-pack");
    expect(pack3.status).toBe(200);
    expect(pack3.data).toEqual({ authorId: AUTHOR.id, content: AUTHOR.styleNotes, customized: false, updatedAt: null });
    const pack4 = await api<PracticeStylePack>(h, "DELETE", "/api/v1/practice/style-pack");
    expect(pack4.status).toBe(200);
    expect(pack4.data.customized).toBe(false);

    // 11. GET /practice/free —— 空列表
    const free0 = await api<PracticePiecesRes>(h, "GET", "/api/v1/practice/free");
    expect(free0.status).toBe(200);
    expect(free0.data).toEqual({ pieces: [] });

    // 12. POST /practice/free —— 新建自由练习篇（响应 = 详情形态）
    const piece = await api<PracticePieceDetail>(h, "POST", "/api/v1/practice/free", {
      topic_source: "user",
      topic: "  雨夜  ",
      brief: "写 500 字，只写动作。",
    });
    expect(piece.status).toBe(200);
    expectKeys(piece.data, PIECE_DETAIL_KEYS, "POST 自由练习响应 = 详情形态");
    expect(piece.data.id.startsWith("pf-")).toBe(true);
    expect(piece.data).toMatchObject({
      topic: "雨夜",
      brief: "写 500 字，只写动作。",
      topicSource: "user",
      draft: "",
      feedback: null,
    });

    // 13. GET /practice/free/:id —— 详情
    const pieceDetail = await api<PracticePieceDetail>(h, "GET", `/api/v1/practice/free/${piece.data.id}`);
    expect(pieceDetail.status).toBe(200);
    expectKeys(pieceDetail.data, PIECE_DETAIL_KEYS);

    // 14. GET /practice/free —— 列表（只出投影）
    const free1 = await api<PracticePiecesRes>(h, "GET", "/api/v1/practice/free");
    expect(free1.data.pieces).toHaveLength(1);
    expectKeys(free1.data.pieces[0], PIECE_SUMMARY_KEYS, "自由练习列表项");
    expect(free1.data.pieces[0]).toMatchObject({ topic: "雨夜", charCount: 0, hasDraft: false, hasFeedback: false });

    // 15. PUT /practice/free/:id —— 保存自由练习稿
    const pieceSaved = await api<PracticeDraftPutRes>(h, "PUT", `/api/v1/practice/free/${piece.data.id}`, {
      draft: "雨滴落在青石板上。",
    });
    expect(pieceSaved.status).toBe(200);
    expectKeys(pieceSaved.data, ["updatedAt"]);
    const free2 = await api<PracticePiecesRes>(h, "GET", "/api/v1/practice/free");
    expect(free2.data.pieces[0].charCount).toBe("雨滴落在青石板上。".length); // 自由练习 charCount = 稿件长度

    // 16. DELETE /practice/free/:id —— 物理删
    const pieceDeleted = await api<PracticeDeleted>(h, "DELETE", `/api/v1/practice/free/${piece.data.id}`);
    expect(pieceDeleted.status).toBe(200);
    expect(pieceDeleted.data).toEqual({ deleted: true });
    expect((await api(h, "GET", "/api/v1/practice/free")).data.pieces).toEqual([]);
  });

  it("列表投影不含正文 / 稿件 / 卡体；同值按 id 升序（稳定次序）", async () => {
    const h = await startWorkspace("practice");
    const first = await createSample(h, { text: "范文一" });
    const second = await createSample(h, { text: "范文二" });
    const listed = await api<PracticeSamplesRes>(h, "GET", "/api/v1/practice/samples");
    for (const item of listed.data.samples) {
      expectKeys(item, SAMPLE_SUMMARY_KEYS, "样本列表项");
      expect("text" in item).toBe(false);
      expect("draft" in item).toBe(false);
      expect("feedback" in item).toBe(false);
    }
    // 排序 = updatedAt 倒序（同值按 id 升序）；不断言墙钟毫秒（两次写入可能同毫秒）——直接比对文档口径
    const ids = listed.data.samples.map((s) => s.id);
    expect(new Set(ids)).toEqual(new Set([first.id, second.id]));
    expect(ids).toEqual(
      [...listed.data.samples]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
        .map((s) => s.id),
    );
  });
});

describe("前置守卫（kind / author_id）", () => {
  it("13 个端点在小说工作区上均 400 KIND_MISMATCH（固定文案）", async () => {
    const novel = await startWorkspace("novel");
    for (const ep of PRACTICE_ENDPOINTS) {
      const res = await api(novel, ep.method, ep.path, ep.body);
      expect(res.status, `${ep.method} ${ep.path}`).toBe(400);
      expect(res.error?.code, `${ep.method} ${ep.path}`).toBe("KIND_MISMATCH");
      expect(res.error?.message, `${ep.method} ${ep.path}`).toBe(PRACTICE_ONLY_MESSAGE);
    }
  });

  it("练习工作区不写 author_id（存量 / 坏值）→ 13 个端点均 400 VALIDATION_ERROR（固定文案）", async () => {
    const h = await startWorkspace("practice", { authorId: null });
    for (const ep of PRACTICE_ENDPOINTS) {
      const res = await api(h, ep.method, ep.path, ep.body);
      expect(res.status, `${ep.method} ${ep.path}`).toBe(400);
      expect(res.error?.code, `${ep.method} ${ep.path}`).toBe("VALIDATION_ERROR");
      expect(res.error?.message, `${ep.method} ${ep.path}`).toBe(NO_AUTHOR_MESSAGE);
    }
  });

  it("author_id 不在预置清单（作家被移除）→ 同样 400 VALIDATION_ERROR（不做名字认领）", async () => {
    const h = await startWorkspace("practice", { authorId: "汪曾祺" });
    const res = await api(h, "GET", "/api/v1/practice/samples");
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe("VALIDATION_ERROR");
    expect(res.error?.message).toBe(NO_AUTHOR_MESSAGE);
  });

  it("13 个端点在练习工作区上不被守卫拦（集合端 200 / 带 id 端 404，绝不 400 / 409 / 5xx）", async () => {
    const h = await startWorkspace("practice");
    for (const ep of PRACTICE_ENDPOINTS) {
      const res = await api(h, ep.method, ep.path, ep.body);
      // 带 id 的端点指向不存在的行 ⇒ 404；集合 / 单例端点（samples 集合、style-pack）⇒ 200
      const expected = ep.path.includes(":id") || /\/(ps|pf)-1$/.test(ep.path) ? 404 : 200;
      expect(res.status, `${ep.method} ${ep.path}`).toBe(expected);
    }
  });

  it("无当前工作区 → 守卫放行，练习端点给既有 409 NO_PROJECT_OPEN（不改错误语义）", async () => {
    const h = await startWorkspace("practice");
    setCurrentProject(null); // 待命态
    const res = await api(h, "GET", "/api/v1/practice/samples");
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("NO_PROJECT_OPEN");
  });
});

describe("请求校验（长度上限 / 成员 / 分支 / 字段名）", () => {
  it("六个长度上限各超 1 字符 → 400 VALIDATION_ERROR（fields 指出出错字段）", async () => {
    const h = await startWorkspace("practice");
    const sample = await createSample(h, { text: "范文" });
    const piece = await createPiece(h, { topic_source: "user", topic: "题目" });

    const cases: { field: string; note: string; run: () => Promise<ApiResult<unknown>> }[] = [
      {
        field: "text",
        note: "POST /samples 的 text",
        run: () => api(h, "POST", "/api/v1/practice/samples", { text: "d".repeat(MAX_PRACTICE_SAMPLE_CHARS + 1) }),
      },
      {
        field: "excerpt_label",
        note: "POST /samples 的 excerpt_label",
        run: () =>
          api(h, "POST", "/api/v1/practice/samples", {
            text: "范文二",
            excerpt_label: "d".repeat(MAX_PRACTICE_EXCERPT_LABEL_CHARS + 1),
          }),
      },
      {
        field: "draft",
        note: "PUT /samples/:id 的 draft",
        run: () =>
          api(h, "PUT", `/api/v1/practice/samples/${sample.id}`, { draft: "d".repeat(MAX_PRACTICE_DRAFT_CHARS + 1) }),
      },
      {
        field: "draft",
        note: "PUT /free/:id 的 draft",
        run: () => api(h, "PUT", `/api/v1/practice/free/${piece.id}`, { draft: "d".repeat(MAX_PRACTICE_DRAFT_CHARS + 1) }),
      },
      {
        field: "topic",
        note: "POST /free 的 topic",
        run: () =>
          api(h, "POST", "/api/v1/practice/free", {
            topic_source: "user",
            topic: "d".repeat(MAX_PRACTICE_TOPIC_CHARS + 1),
          }),
      },
      {
        field: "brief",
        note: "POST /free 的 brief",
        run: () =>
          api(h, "POST", "/api/v1/practice/free", {
            topic_source: "user",
            topic: "题目二",
            brief: "d".repeat(MAX_PRACTICE_BRIEF_CHARS + 1),
          }),
      },
      {
        field: "content",
        note: "PUT /style-pack 的 content",
        run: () => api(h, "PUT", "/api/v1/practice/style-pack", { content: "d".repeat(MAX_PRACTICE_STYLE_PACK_CHARS + 1) }),
      },
    ];
    for (const item of cases) {
      const res = await item.run();
      expect(res.status, item.note).toBe(400);
      expect(res.error?.code, item.note).toBe("VALIDATION_ERROR");
      expect(res.error?.fields, item.note).toContain(item.field);
    }
  });

  it("truncation 反向：恰好上限通过（POST /samples / PUT /style-pack）", async () => {
    const h = await startWorkspace("practice");
    const maxText = await api<PracticeSampleDetail>(h, "POST", "/api/v1/practice/samples", {
      text: "d".repeat(MAX_PRACTICE_SAMPLE_CHARS),
    });
    expect(maxText.status).toBe(200);
    const maxPack = await api<PracticeStylePack>(h, "PUT", "/api/v1/practice/style-pack", {
      content: "d".repeat(MAX_PRACTICE_STYLE_PACK_CHARS),
    });
    expect(maxPack.status).toBe(200);
  });

  it("work_id：省略 / null = 「其他」；预置清单内的 id 原样落库；未知 id → 400（不静默当「其他」）", async () => {
    const h = await startWorkspace("practice");
    expect((await createSample(h, { text: "范文一" })).workId).toBeNull();
    expect((await createSample(h, { text: "范文二", work_id: null })).workId).toBeNull();
    expect((await createSample(h, { text: "范文三", work_id: WORK.id })).workId).toBe(WORK.id);

    const unknown = await api(h, "POST", "/api/v1/practice/samples", { text: "范文四", work_id: "not-a-work" });
    expect(unknown.status).toBe(400);
    expect(unknown.error?.code).toBe("VALIDATION_ERROR");
    expect(unknown.error?.message).toContain("not-a-work");
    expect((await api<PracticeSamplesRes>(h, "GET", "/api/v1/practice/samples")).data.samples).toHaveLength(3);
  });

  it('topic_source 两分支："user" 题目 trim 非空；"ai" 建空题行（题目给了 → 400）', async () => {
    const h = await startWorkspace("practice");
    const missing = await api(h, "POST", "/api/v1/practice/free", { topic_source: "user" });
    expect(missing.status).toBe(400);
    expect(missing.error?.fields).toContain("topic");
    const blank = await api(h, "POST", "/api/v1/practice/free", { topic_source: "user", topic: "   " });
    expect(blank.status).toBe(400);

    const aiPiece = await createPiece(h, { topic_source: "ai" });
    expect(aiPiece).toMatchObject({ topic: "", brief: "", topicSource: "ai", draft: "", feedback: null });
    expect((await createPiece(h, { topic_source: "ai", topic: "" })).topic).toBe("");

    const contradiction = await api(h, "POST", "/api/v1/practice/free", { topic_source: "ai", topic: "AI 出的题" });
    expect(contradiction.status).toBe(400);
    expect(contradiction.error?.fields).toContain("topic");
    const badSource = await api(h, "POST", "/api/v1/practice/free", { topic_source: "bogus" });
    expect(badSource.status).toBe(400);
  });

  it("文本字段 trim 非空：纯空白范文 / 风格说明 → 400；strict 拒绝未知字段与 camelCase", async () => {
    const h = await startWorkspace("practice");
    expect((await api(h, "POST", "/api/v1/practice/samples", { text: "   " })).status).toBe(400);
    expect((await api(h, "PUT", "/api/v1/practice/style-pack", { content: "  " })).status).toBe(400);
    // strict：未知字段 / camelCase / 旧模型字段一律 400
    expect((await api(h, "POST", "/api/v1/practice/samples", { text: "范文", source_kind: "paste" })).status).toBe(400);
    expect((await api(h, "POST", "/api/v1/practice/samples", { text: "范文", workId: WORK.id })).status).toBe(400);
    expect((await api(h, "DELETE", "/api/v1/practice/samples/ps-x", { extra: 1 })).status).toBe(404); // DELETE 不看 body
  });

  it("保存稿件（两类共用）：strict 单字段；空串合法（清空稿件，hasDraft 回落）；不碰范文与卡体", async () => {
    const h = await startWorkspace("practice");
    const sample = await createSample(h, { text: "范文原样" });
    const extra = await api(h, "PUT", `/api/v1/practice/samples/${sample.id}`, { draft: "稿", base_updated_at: T0 });
    expect(extra.status).toBe(400); // strict：不接受版本戳字段（并发口径 = 后写覆盖）

    const cleared = await api<PracticeDraftPutRes>(h, "PUT", `/api/v1/practice/samples/${sample.id}`, { draft: "" });
    expect(cleared.status).toBe(200);
    const detail = await api<PracticeSampleDetail>(h, "GET", `/api/v1/practice/samples/${sample.id}`);
    expect(detail.data.draft).toBe("");
    expect(detail.data.text).toBe("范文原样"); // 范文不可变
    expect(detail.data.feedback).toBeNull(); // 保存稿件不碰点评卡
    expect((await api<PracticeSamplesRes>(h, "GET", "/api/v1/practice/samples")).data.samples[0].hasDraft).toBe(false);
  });
});

describe("404（文案按资源）", () => {
  it("样本端点 → 「练习样本不存在」；自由练习端点 → 「自由练习不存在」（码同为 PRACTICE_NOT_FOUND）", async () => {
    const h = await startWorkspace("practice");
    const sampleMsg = "练习样本不存在";
    const pieceMsg = "自由练习不存在";
    const cases: { note: string; message: string; run: () => Promise<ApiResult<unknown>> }[] = [
      { note: "GET /samples/:id", message: sampleMsg, run: () => api(h, "GET", "/api/v1/practice/samples/ps-missing") },
      {
        note: "PUT /samples/:id",
        message: sampleMsg,
        run: () => api(h, "PUT", "/api/v1/practice/samples/ps-missing", { draft: "稿件" }),
      },
      { note: "DELETE /samples/:id", message: sampleMsg, run: () => api(h, "DELETE", "/api/v1/practice/samples/ps-missing") },
      { note: "GET /free/:id", message: pieceMsg, run: () => api(h, "GET", "/api/v1/practice/free/pf-missing") },
      {
        note: "PUT /free/:id",
        message: pieceMsg,
        run: () => api(h, "PUT", "/api/v1/practice/free/pf-missing", { draft: "稿件" }),
      },
      { note: "DELETE /free/:id", message: pieceMsg, run: () => api(h, "DELETE", "/api/v1/practice/free/pf-missing") },
    ];
    for (const item of cases) {
      const res = await item.run();
      expect(res.status, item.note).toBe(404);
      expect(res.error?.code, item.note).toBe("PRACTICE_NOT_FOUND");
      expect(res.error?.message, item.note).toBe(item.message);
    }
  });

  it("重复删除（第二次）同样 404，不静默成功；幂等的是素材包 DELETE，不是资源 DELETE", async () => {
    const h = await startWorkspace("practice");
    const sample = await createSample(h, { text: "范文" });
    expect((await api(h, "DELETE", `/api/v1/practice/samples/${sample.id}`)).status).toBe(200);
    const again = await api(h, "DELETE", `/api/v1/practice/samples/${sample.id}`);
    expect(again.status).toBe(404);
    expect(again.error?.message).toBe("练习样本不存在");
  });
});

describe("点评卡读取（feedback 透传 / 防御解析）", () => {
  /** 直写 feedback 列（本卡无写入端点；生产唯一写入方 = 提交点评工具） */
  function writeSampleFeedback(handle: ServerHandle, sampleId: string, raw: string | null): void {
    handle.project!.db.prepare("UPDATE practice_samples SET feedback = ? WHERE id = ?").run(raw, sampleId);
  }

  it("合法 JSON 对象原样透传：卡内层键名 snake_case 不转换（`{}` 也照原样返回且 hasFeedback = true）", async () => {
    const h = await startWorkspace("practice");
    const sample = await createSample(h, { text: "范文" });
    const card = {
      dimensions: [
        {
          name: "句长节奏",
          sample_trait: "短句",
          draft_trait: "长句",
          sample_quotes: ["范文"],
          draft_quotes: ["稿"],
          advice: "切短",
        },
      ],
      summary: "总评",
    };
    writeSampleFeedback(h, sample.id, JSON.stringify(card));

    const detail = await api<PracticeSampleDetail>(h, "GET", `/api/v1/practice/samples/${sample.id}`);
    expect(detail.data.feedback).toEqual(card);
    expect(Object.keys(detail.data.feedback!.dimensions[0]!).sort()).toEqual([
      "advice",
      "draft_quotes",
      "draft_trait",
      "name",
      "sample_quotes",
      "sample_trait",
    ]);
    const listed = await api<PracticeSamplesRes>(h, "GET", "/api/v1/practice/samples");
    expect(listed.data.samples[0].hasFeedback).toBe(true);

    // 空对象不做特判（形状校验在写入侧）：照原样返回，且仍算「已点评」
    writeSampleFeedback(h, sample.id, "{}");
    expect((await api<PracticeSampleDetail>(h, "GET", `/api/v1/practice/samples/${sample.id}`)).data.feedback).toEqual({});
    expect(
      (await api<PracticeSamplesRes>(h, "GET", "/api/v1/practice/samples")).data.samples[0].hasFeedback,
    ).toBe(true);
  });

  it("非对象（非法 JSON / 数组 / 字符串 / JSON null）→ null：详情与列表同口径（hasFeedback = false）", async () => {
    const h = await startWorkspace("practice");
    const sample = await createSample(h, { text: "范文" });
    for (const raw of ["{ 这不是 JSON", "[1,2,3]", '"就一段字符串"', "null"]) {
      writeSampleFeedback(h, sample.id, raw);
      const detail = await api<PracticeSampleDetail>(h, "GET", `/api/v1/practice/samples/${sample.id}`);
      expect(detail.data.feedback, raw).toBeNull();
      const listed = await api<PracticeSamplesRes>(h, "GET", "/api/v1/practice/samples");
      expect(listed.data.samples[0].hasFeedback, raw).toBe(false);
    }
  });
});

describe("素材包三态（预置 → 覆盖 → 恢复预置）", () => {
  it("写入覆盖后 GET 生效内容 = 覆盖；DELETE 后回落预置；覆盖行随工作区存续（data.db 单行）", async () => {
    const h = await startWorkspace("practice");
    await api(h, "PUT", "/api/v1/practice/style-pack", { content: "覆盖一" });
    expect((await api<PracticeStylePack>(h, "GET", "/api/v1/practice/style-pack")).data).toMatchObject({
      content: "覆盖一",
      customized: true,
    });
    // 再写 = 覆盖（一作家一行，不是追加）
    await api(h, "PUT", "/api/v1/practice/style-pack", { content: "覆盖二" });
    expect((await api<PracticeStylePack>(h, "GET", "/api/v1/practice/style-pack")).data.content).toBe("覆盖二");
    expect((await api<PracticeStylePack>(h, "DELETE", "/api/v1/practice/style-pack")).data).toEqual({
      authorId: AUTHOR.id,
      content: AUTHOR.styleNotes,
      customized: false,
      updatedAt: null,
    });
  });

  it("其他作家的覆盖不影响本工作区（素材包按作者 id 隔离）", async () => {
    const h = await startWorkspace("practice");
    h.project!.db
      .prepare("INSERT INTO practice_style_packs (author_id, content, updated_at) VALUES (?, ?, ?)")
      .run("other-author", "别家的风格说明", T0);
    expect((await api<PracticeStylePack>(h, "GET", "/api/v1/practice/style-pack")).data).toMatchObject({
      content: AUTHOR.styleNotes,
      customized: false,
    });
  });
});

describe("作家 / 作品事实源", () => {
  it("「其他」兜底文案来自 shared（响应只回 workId，不复制作品名——作品名由客户端查清单）", async () => {
    const h = await startWorkspace("practice");
    const other = await createSample(h, { text: "范文" });
    expect(other.workId).toBeNull();
    expect(PRACTICE_OTHER_WORK_LABEL).toBe("其他"); // 客户端按这个 shared 常量渲染兜底组
  });
});