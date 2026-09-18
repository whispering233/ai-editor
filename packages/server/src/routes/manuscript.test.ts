// 卡 12.4 章正文路由测试：GET/PUT /api/v1/manuscript/:chapterNodeId
// 覆盖：首写/读取（空文档语义）、覆盖写版本戳推进、非章 400、不存在/软删 404、坏 content 400、
// 409 DOCUMENT_STALE、省略 base 即覆盖、空块数组合法（charCount 0）、
// charCount 与派生投影一致（直查 SQLite）、保存无 Delta 副作用、purge 级联删正文行。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { readProjectFile } from "@whispering233/ai-editor-db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { manuscriptRoutes } from "./manuscript.js";
import { outlineRoutes } from "./outline.js";
import { trashRoutes } from "./trash.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const JSON_HEADERS = { ...HOST_HEADERS, "content-type": "application/json" };

/** 测试块数组（真相载荷）+ 其投影（literal 期望值——不调 blocksToPlainMd，避免自证） */
const BLOCKS = [
  { id: "b1", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "第一章" }] },
  { id: "b2", type: "paragraph", content: [{ type: "text", text: "正文内容" }] },
];
const BLOCKS_JSON = JSON.stringify(BLOCKS);
const PLAIN_MD = "# 第一章\n\n正文内容";

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "manuscript-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（manuscript + outline + trash：建树与 purge 级联用） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/manuscript", manuscriptRoutes);
  app.route("/api/v1/outline", outlineRoutes);
  app.route("/api/v1/trash", trashRoutes);
  return app;
}

/** 构造并打开项目（initProject：三文件 + user_version），注入 currentProject 单例 */
function openProject(): string {
  const dir = makeTmpDir();
  setCurrentProject(initProject(dir));
  return dir;
}

/** 建 卷[章]（经大纲 API），返回 id */
async function seedChapter(app: Hono, title = "第一章"): Promise<{ vol: string; ch: string }> {
  const vol = (await (await app.request("/api/v1/outline", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ type: "volume", title: "第一卷", parent_id: "root" }),
  })).json()).data;
  const ch = (await (await app.request("/api/v1/outline", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ type: "chapter", title, parent_id: vol.id }),
  })).json()).data;
  return { vol: vol.id, ch: ch.id };
}

/** PUT 正文辅助 */
function putBody(app: Hono, ch: string, body: Record<string, unknown>): Promise<Response> {
  return app.request(`/api/v1/manuscript/${ch}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** 直查正文行（绕过端点自说自话） */
function docRow(ch: string): { content: string; content_text: string; created_at: string; updated_at: string } | undefined {
  return getCurrentProject()!
    .db.prepare("SELECT content, content_text, created_at, updated_at FROM document_records WHERE owner_kind = 'chapter' AND owner_id = ?")
    .get(ch) as { content: string; content_text: string; created_at: string; updated_at: string } | undefined;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-manuscript-"));
  setCurrentProject(null);
});

afterEach(() => {
  const cur = getCurrentProject();
  if (cur !== null) {
    closeProject(cur);
    setCurrentProject(null);
  }
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ============ GET ============

describe("GET /manuscript/:chapterNodeId", () => {
  it("从未写过 → 空文档语义：content \"\" / updatedAt null / charCount 0", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    const res = await app.request(`/api/v1/manuscript/${ch}`, { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ chapterNodeId: ch, content: "", updatedAt: null, charCount: 0 });
  });

  it("写入后读回：content 与提交串逐字一致、updatedAt 为版本戳、charCount = 投影长度", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);
    const put = (await (await putBody(app, ch, { content: BLOCKS_JSON })).json()).data;

    const body = (await (await app.request(`/api/v1/manuscript/${ch}`, { headers: HOST_HEADERS })).json()).data;
    expect(body.content).toBe(BLOCKS_JSON);
    expect(body.updatedAt).toBe(put.updatedAt);
    expect(body.charCount).toBe(PLAIN_MD.length);
    expect(docRow(ch)!.content_text).toBe(PLAIN_MD); // 直查：投影落库
  });
});

// ============ PUT ============

describe("PUT /manuscript/:chapterNodeId", () => {
  it("首写：200 updated/updatedAt/charCount，content 原样落库（不重新序列化）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    const res = await putBody(app, ch, { content: BLOCKS_JSON });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.updated).toBe(true);
    expect(body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.charCount).toBe(PLAIN_MD.length);

    const row = docRow(ch)!;
    expect(row.content).toBe(BLOCKS_JSON);
    expect(row.content_text).toBe(PLAIN_MD);
    expect(row.created_at).toBe(body.updatedAt); // 首写：创建时间 = 版本戳
  });

  it("覆盖写：版本戳推进、created_at 保留、投影替换", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);
    const first = (await (await putBody(app, ch, { content: BLOCKS_JSON })).json()).data;
    await new Promise((r) => setTimeout(r, 5)); // nowIso 毫秒精度：确保版本戳可区分

    const next = JSON.stringify([{ id: "b9", type: "paragraph", content: [{ type: "text", text: "改稿" }] }]);
    const second = (await (await putBody(app, ch, { content: next })).json()).data;
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(second.charCount).toBe("改稿".length);

    const row = docRow(ch)!;
    expect(row.content).toBe(next);
    expect(row.content_text).toBe("改稿");
    expect(row.created_at).toBe(first.updatedAt); // 覆盖写不动创建时间
    expect(row.updated_at).toBe(second.updatedAt);
  });

  it("空块数组 \"[]\" 合法：200 + charCount 0（空文档可保存，非 400）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    const res = await putBody(app, ch, { content: "[]" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.charCount).toBe(0);
    expect(docRow(ch)!.content_text).toBe("");
  });

  it("非章（卷 / 场景）→ 400 VALIDATION_ERROR，GET 与 PUT 同口径", async () => {
    const app = buildApp();
    openProject();
    const { vol, ch } = await seedChapter(app);
    const sc = (await (await app.request("/api/v1/outline", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: "scene", title: "场景一", parent_id: ch }),
    })).json()).data;

    for (const nodeId of [vol, sc.id]) {
      const getRes = await app.request(`/api/v1/manuscript/${nodeId}`, { headers: HOST_HEADERS });
      expect(getRes.status).toBe(400);
      expect((await getRes.json()).error.code).toBe("VALIDATION_ERROR");

      const putRes = await putBody(app, nodeId, { content: "[]" });
      expect(putRes.status).toBe(400);
      expect((await putRes.json()).error.code).toBe("VALIDATION_ERROR");
    }
    expect(docRow(sc.id)).toBeUndefined(); // 非章不落行
  });

  it("节点不存在 → 404 OUTLINE_NODE_NOT_FOUND（GET/PUT）", async () => {
    const app = buildApp();
    openProject();
    await seedChapter(app);

    const getRes = await app.request("/api/v1/manuscript/ch-404", { headers: HOST_HEADERS });
    expect(getRes.status).toBe(404);
    expect((await getRes.json()).error.code).toBe("OUTLINE_NODE_NOT_FOUND");

    const putRes = await putBody(app, "ch-404", { content: "[]" });
    expect(putRes.status).toBe(404);
    expect((await putRes.json()).error.code).toBe("OUTLINE_NODE_NOT_FOUND");
  });

  it("软删章 → 404（正文行保留，purge 才物理删）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);
    await putBody(app, ch, { content: BLOCKS_JSON });
    await app.request(`/api/v1/outline/${ch}`, { method: "DELETE", headers: HOST_HEADERS });

    const getRes = await app.request(`/api/v1/manuscript/${ch}`, { headers: HOST_HEADERS });
    expect(getRes.status).toBe(404);
    expect((await getRes.json()).error.code).toBe("OUTLINE_NODE_NOT_FOUND");
    expect((await putBody(app, ch, { content: "[]" })).status).toBe(404);
    expect(docRow(ch)).not.toBeUndefined(); // 软删期间行保留
  });

  it("坏 content → 400 VALIDATION_ERROR 且不落行（非 JSON / JSON 非数组 / 非字符串 / 缺失）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    const badBodies: unknown[] = [
      { content: "not json" }, // JSON.parse 失败
      { content: "{}" }, // 解析为对象，非数组
      { content: "[1]" }, // 数组但元素非对象
      { content: [{ id: "b1", type: "paragraph" }] }, // 数组而非字符串（类型即 400）
      {}, // content 缺失
    ];
    for (const bad of badBodies) {
      const res = await putBody(app, ch, bad as Record<string, unknown>);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
    expect(docRow(ch)).toBeUndefined();
  });

  it("409 DOCUMENT_STALE：携带过期 base_updated_at；库内无行但传非空 base 亦 409", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);
    const staleBase = "2026-10-01T00:00:00Z";

    // 库内无行 + 传非空 base → 不一致
    const noRow = await putBody(app, ch, { content: "[]", base_updated_at: staleBase });
    expect(noRow.status).toBe(409);
    expect((await noRow.json()).error.code).toBe("DOCUMENT_STALE");
    expect(docRow(ch)).toBeUndefined();

    // 正常写入后用过时 base 覆盖 → 409
    const first = (await (await putBody(app, ch, { content: BLOCKS_JSON })).json()).data;
    const conflict = await putBody(app, ch, { content: "[]", base_updated_at: staleBase });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("DOCUMENT_STALE");
    expect(docRow(ch)!.content).toBe(BLOCKS_JSON); // 冲突请求零副作用

    // 携带正确 base → 200（版本戳推进）
    await new Promise((r) => setTimeout(r, 5));
    const okRes = await putBody(app, ch, { content: "[]", base_updated_at: first.updatedAt });
    expect(okRes.status).toBe(200);
    expect((await okRes.json()).data.updatedAt).not.toBe(first.updatedAt);
  });

  it("省略 base_updated_at = 覆盖保存（不做冲突检查，第二次仍 200）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);
    await putBody(app, ch, { content: BLOCKS_JSON });
    const res = await putBody(app, ch, { content: "[]" });

    expect(res.status).toBe(200);
    expect(docRow(ch)!.content).toBe("[]");
  });

  it("副作用边界：保存正文不产生 Delta、不推进 current_position", async () => {
    const app = buildApp();
    const dir = openProject();
    const { ch } = await seedChapter(app);
    await putBody(app, ch, { content: BLOCKS_JSON });

    const deltas = getCurrentProject()!.db.prepare("SELECT COUNT(*) AS c FROM delta_records").get() as { c: number };
    expect(deltas.c).toBe(0);
    expect(readProjectFile(dir)!.current_position).toBeNull();
  });
});

// ============ purge 级联 ============

describe("purge 级联删正文行", () => {
  it("软删后 purge 单章 → document_records 行物理删（purge 前行仍在）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);
    await putBody(app, ch, { content: BLOCKS_JSON });

    // 未软删 purge → 400 拦截，行不动
    expect((await app.request(`/api/v1/trash/outline/${ch}`, { method: "DELETE", headers: HOST_HEADERS })).status).toBe(400);
    expect(docRow(ch)).not.toBeUndefined();

    await app.request(`/api/v1/outline/${ch}`, { method: "DELETE", headers: HOST_HEADERS });
    const purge = await app.request(`/api/v1/trash/outline/${ch}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(purge.status).toBe(200);
    expect(docRow(ch)).toBeUndefined();
  });

  it("卷 purge → 级联子树内各章正文行一并删（卷/场景 id 无行，幂等）", async () => {
    const app = buildApp();
    openProject();
    const { vol, ch } = await seedChapter(app);
    const ch2 = (await (await app.request("/api/v1/outline", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: "chapter", title: "第二章", parent_id: vol }),
    })).json()).data;
    await putBody(app, ch, { content: BLOCKS_JSON });
    await putBody(app, ch2.id, { content: "[]" });
    expect((getCurrentProject()!.db.prepare("SELECT COUNT(*) AS c FROM document_records").get() as { c: number }).c).toBe(2);

    await app.request(`/api/v1/outline/${vol}`, { method: "DELETE", headers: HOST_HEADERS });
    expect((await app.request(`/api/v1/trash/outline/${vol}`, { method: "DELETE", headers: HOST_HEADERS })).status).toBe(200);
    expect((getCurrentProject()!.db.prepare("SELECT COUNT(*) AS c FROM document_records").get() as { c: number }).c).toBe(0);
  });
});
