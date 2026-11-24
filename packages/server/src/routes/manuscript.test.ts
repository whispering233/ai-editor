// 卡 12.4 章正文路由测试：GET/PUT /api/v1/manuscript/:chapterNodeId
// 覆盖：首写/读取（空文档语义）、覆盖写版本戳推进、非章 400、不存在/软删 404、坏 content 400、
// 409 DOCUMENT_STALE、省略 base 即覆盖、空块数组合法（charCount 0）、
// charCount 与派生投影一致（直查 SQLite）、保存无 Delta 副作用、purge 级联删正文行；
// 以及 stats-1 的码字日统计副作用（正差累加 / 缩短不扣 / best-effort 失败仍 200）；
// 章级历史（快照写入钩子 / 读端点 / 恢复端点 / purge 级联）：节流、去重、每章裁剪、
// 全局预算、恢复可逆、同秒排序、恢复后版本戳与码字统计。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { MAX_SNAPSHOTS_PER_DOCUMENT, SNAPSHOT_BUDGET_MULTIPLIER } from "@whispering233/ai-editor-shared";
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
import { localDateKey } from "../local-date.js";
import { outlineRoutes } from "./outline.js";
import { trashRoutes } from "./trash.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const JSON_HEADERS = { ...HOST_HEADERS, "content-type": "application/json" };

/**
 * 统计写入的探测开关（vi.hoisted：提升到 import 之前，供 vi.mock 工厂引用）：
 * 默认透传真实 `addWritingChars` 并记账；`fail` = 打开后模拟统计写入抛错（best-effort 用例）。
 */
const statsProbe = vi.hoisted(() => ({
  fail: false,
  calls: [] as Array<{ date: string; chars: number }>,
}));

vi.mock("@whispering233/ai-editor-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@whispering233/ai-editor-db")>();
  return {
    ...actual,
    addWritingChars: (
      db: Parameters<typeof actual.addWritingChars>[0],
      date: string,
      chars: number,
      now: string,
    ) => {
      if (statsProbe.fail) throw new Error("stats boom");
      statsProbe.calls.push({ date, chars });
      actual.addWritingChars(db, date, chars, now);
    },
  };
});

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

/** 单段正文的块数组 JSON（投影 = 文本本身，字面长度可直接比） */
function textBlocks(text: string): string {
  return JSON.stringify([{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }]);
}

/** 直查统计行（按日升序；验证副作用落在 writing_stats_daily） */
function statsRows(): Array<{ date: string; chars: number }> {
  return getCurrentProject()!
    .db.prepare("SELECT stat_date AS date, chars FROM writing_stats_daily ORDER BY stat_date")
    .all() as Array<{ date: string; chars: number }>;
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
  statsProbe.fail = false;
  statsProbe.calls.length = 0;
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

// ============ 码字日统计副作用（stats-1） ============

describe("PUT /manuscript 的码字日统计（正差累加，best-effort）", () => {
  it("首次保存：正文字数计入今天一行（日键 = 服务端本地日）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    const res = await putBody(app, ch, { content: textBlocks("码字统计") });
    expect(res.status).toBe(200);
    expect(statsRows()).toEqual([{ date: localDateKey(), chars: 4 }]);
    expect(statsProbe.calls).toEqual([{ date: localDateKey(), chars: 4 }]);
  });

  it("按差值累加：同章增长计差额、不同章同日合并一行（不按整篇重复计）", async () => {
    const app = buildApp();
    openProject();
    const { vol, ch } = await seedChapter(app);
    const ch2 = (await (await app.request("/api/v1/outline", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: "chapter", title: "第二章", parent_id: vol }),
    })).json()).data;

    await putBody(app, ch, { content: textBlocks("一二三") });
    await putBody(app, ch, { content: textBlocks("一二三四五六") }); // 差值 3
    await putBody(app, ch2.id, { content: textBlocks("四五") }); // 另一章 +2

    expect(statsRows()).toEqual([{ date: localDateKey(), chars: 8 }]);
    expect(statsProbe.calls.map((c) => c.chars)).toEqual([3, 3, 2]);
  });

  it("缩短 / 清空不扣减（只累加正差）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    await putBody(app, ch, { content: textBlocks("一二三四五") });
    await putBody(app, ch, { content: textBlocks("一二") }); // 缩短
    await putBody(app, ch, { content: "[]" }); // 清空

    expect(statsRows()).toEqual([{ date: localDateKey(), chars: 5 }]);
    expect(statsProbe.calls).toEqual([{ date: localDateKey(), chars: 5 }]);
  });

  it("覆盖保存（省略 base_updated_at）按净正差计入", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    await putBody(app, ch, { content: textBlocks("初始") });
    await putBody(app, ch, { content: textBlocks("初始扩张内容") }); // 覆盖保存，净正差 4

    expect(statsRows()).toEqual([{ date: localDateKey(), chars: 6 }]);
    expect(statsProbe.calls.map((c) => c.chars)).toEqual([2, 4]);
  });

  it("统计写入抛错：PUT 仍 200、正文已保存、错误只记日志（不回滚）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = buildApp();
      openProject();
      const { ch } = await seedChapter(app);
      statsProbe.fail = true;

      const res = await putBody(app, ch, { content: textBlocks("仍然保存") });
      expect(res.status).toBe(200);
      expect((await res.json()).data.charCount).toBe(4);
      expect(docRow(ch)!.content_text).toBe("仍然保存"); // 正文主数据不受影响
      expect(statsRows()).toEqual([]); // 统计未写入（最坏少记一次）
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[stats]"), expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
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
// ============ 章级历史（快照写入钩子 + 恢复/读端点） ============

/** 把该章的快照 created_at 全部推到过去：节流窗口之外（同秒排序用例也因此拿到相同时间） */
function ageSnapshots(ch: string): void {
  getCurrentProject()!
    .db.prepare("UPDATE document_snapshots SET created_at = ? WHERE owner_kind = 'chapter' AND owner_id = ?")
    .run("2020-01-01T00:00:00Z", ch);
}

/** 直查该章快照（升序 = 最旧→最新；绕过端点自说自话） */
function snapshotRows(ch: string): Array<{ seq: number; content: string; char_count: number; created_at: string }> {
  return getCurrentProject()!
    .db.prepare(
      "SELECT seq, content, char_count, created_at FROM document_snapshots WHERE owner_kind = 'chapter' AND owner_id = ? ORDER BY seq",
    )
    .all(ch) as Array<{ seq: number; content: string; char_count: number; created_at: string }>;
}

/** 快照列表端点（seq 降序 = 新→旧） */
async function listSnapshotsApi(
  app: Hono,
  ch: string,
): Promise<Array<{ seq: number; createdAt: string; charCount: number }>> {
  return (await (await app.request(`/api/v1/manuscript/${ch}/snapshots`, { headers: HOST_HEADERS })).json()).data
    .snapshots;
}

/** 单份快照端点 */
function getSnapshotApi(app: Hono, ch: string, seq: number): Promise<Response> {
  return app.request(`/api/v1/manuscript/${ch}/snapshots/${seq}`, { headers: HOST_HEADERS });
}

/** 恢复端点 */
function restoreApi(app: Hono, ch: string, body: Record<string, unknown>): Promise<Response> {
  return app.request(`/api/v1/manuscript/${ch}/restore`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** 当前正文（GET 端点） */
async function currentContent(app: Hono, ch: string): Promise<{ content: string; updatedAt: string | null }> {
  return (await (await app.request(`/api/v1/manuscript/${ch}`, { headers: HOST_HEADERS })).json()).data;
}

/** 反复保存同一章（每轮前把快照时间推旧 = 模拟「过了节流窗口」），产出份份不同的历史 */
async function saveMany(app: Hono, ch: string, times: number, text = "正文"): Promise<void> {
  for (let i = 0; i < times; i++) {
    ageSnapshots(ch);
    await putBody(app, ch, { content: textBlocks(`${text}${i}`) });
  }
}

describe("章级历史：快照写入钩子（节流 / 去重）", () => {
  it("首写不压快照；内容有变时压「被覆盖的旧内容」", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    await putBody(app, ch, { content: textBlocks("第一版") });
    expect(snapshotRows(ch)).toEqual([]); // 首写没有旧内容可压

    await putBody(app, ch, { content: textBlocks("第二版") });
    const rows = snapshotRows(ch);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe(textBlocks("第一版")); // 压的是旧内容，当前内容不进历史
    expect(rows[0]!.char_count).toBe("第一版".length);
  });

  it("① 节流：距该章最后一份不足 CHAPTER_SNAPSHOT_MIN_INTERVAL_MS 的保存不产第二份快照", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    await putBody(app, ch, { content: textBlocks("一") });
    await putBody(app, ch, { content: textBlocks("二") }); // 压「一」
    await putBody(app, ch, { content: textBlocks("三") }); // 节流窗口内 → 不压
    expect(snapshotRows(ch)).toHaveLength(1);

    ageSnapshots(ch); // 时间推过节流窗口
    await putBody(app, ch, { content: textBlocks("四") });
    const rows = snapshotRows(ch);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.content).toBe(textBlocks("三")); // 过窗口后压的是最近一次被覆盖的内容
    expect(rows[1]!.char_count).toBe("三".length);
  });

  it("② 去重：内容未变不产快照（同一内容反复保存、跨节流窗口也一样）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    await putBody(app, ch, { content: textBlocks("定稿") });
    expect(snapshotRows(ch)).toHaveLength(0);

    // 同内容重复保存（超过节流窗口也一样）：旧内容 == 新内容 → 没有「被覆盖的旧内容」
    ageSnapshots(ch);
    await putBody(app, ch, { content: textBlocks("定稿") });
    expect(snapshotRows(ch)).toHaveLength(0);

    // 改一版再改回来：只在真正变化的那一刻压一份，不会把同一份历史堆两遍
    await putBody(app, ch, { content: textBlocks("修订") }); // 压「定稿」
    ageSnapshots(ch);
    await putBody(app, ch, { content: textBlocks("定稿") }); // 压「修订」
    ageSnapshots(ch);
    await putBody(app, ch, { content: textBlocks("定稿") }); // 内容未变 → 不压
    expect(snapshotRows(ch).map((r) => r.content)).toEqual([textBlocks("定稿"), textBlocks("修订")]);
  });

  it("③ 每章裁剪：超过 MAX_SNAPSHOTS_PER_DOCUMENT 份时从最旧删", async () => {
    const app = buildApp();
    openProject();
    const { vol, ch } = await seedChapter(app);
    // 全书正文总量放大（10 章 × 8 字）：本用例只让「每章份数」先触发，全局预算不参与
    for (let i = 1; i <= 10; i++) {
      const created = await app.request("/api/v1/outline", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: "chapter", title: `补${i}`, parent_id: vol }),
      });
      await putBody(app, (await created.json()).data.id, { content: textBlocks("占位正文八个字") });
    }

    await saveMany(app, ch, MAX_SNAPSHOTS_PER_DOCUMENT + 5);

    const rows = snapshotRows(ch);
    expect(rows).toHaveLength(MAX_SNAPSHOTS_PER_DOCUMENT);
    // 删掉的是最旧的 5 份：留下的第一份是第 5 次保存前的内容
    expect(rows[0]!.content).toBe(textBlocks("正文4"));
    expect(rows[rows.length - 1]!.content).toBe(textBlocks(`正文${MAX_SNAPSHOTS_PER_DOCUMENT + 3}`));
  });

  it("④ 全局预算：全书快照字数超 SNAPSHOT_BUDGET_MULTIPLIER × 正文总量时从最旧删", async () => {
    const app = buildApp();
    const dir = openProject();
    const { ch } = await seedChapter(app);
    const text = "十个字的正"; // 单章 = 全书正文总量
    const pad = (i: number): string => String(i).padStart(2, "0"); // 固定宽度：每份快照字数恒定
    const charsPerSnapshot = text.length + pad(0).length;
    // 预算 = 正文总量 × 倍数 字，每份快照也正好这么多字 → 装得下的份数 = 倍数
    const fitsInBudget = SNAPSHOT_BUDGET_MULTIPLIER;

    for (let i = 0; i < fitsInBudget + 5; i++) {
      ageSnapshots(ch);
      await putBody(app, ch, { content: textBlocks(`${text}${pad(i)}`) });
    }

    const rows = snapshotRows(ch);
    expect(rows).toHaveLength(fitsInBudget);
    expect(rows.reduce((sum, r) => sum + r.char_count, 0)).toBeLessThanOrEqual(
      charsPerSnapshot * SNAPSHOT_BUDGET_MULTIPLIER,
    );
    expect(rows[0]!.content).toBe(textBlocks(`${text}${pad(4)}`)); // 最旧的 4 份被删（首写没有旧内容可压）
    expect(readProjectFile(dir)!.current_position).toBeNull(); // 裁剪不动正文状态
  });
});

describe("章级历史：读端点", () => {
  it("列表返回 seq / createdAt / charCount（seq 降序），单份返回 content；空历史返回空数组", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);
    expect(await listSnapshotsApi(app, ch)).toEqual([]); // 从未保存过 = 空历史

    await putBody(app, ch, { content: textBlocks("旧一") });
    await putBody(app, ch, { content: textBlocks("旧二") });
    ageSnapshots(ch);
    await putBody(app, ch, { content: textBlocks("新三") });

    const list = await listSnapshotsApi(app, ch);
    expect(list).toHaveLength(2);
    expect(list[0]!.seq).toBeGreaterThan(list[1]!.seq); // 降序（新→旧）
    expect(list[0]!.charCount).toBe("旧二".length); // 最新一份 = 最后一次被覆盖的「旧二」
    expect(list[1]!.createdAt).toBe("2020-01-01T00:00:00Z"); // 时间已被推旧（节流窗口外）

    const single = (await (await getSnapshotApi(app, ch, list[1]!.seq)).json()).data;
    expect(single).toMatchObject({ seq: list[1]!.seq, charCount: "旧一".length, content: textBlocks("旧一") });
  });

  it("非章 → 400；快照不存在 / 属于别的章 → 404 SNAPSHOT_NOT_FOUND；seq 非正整数 → 400", async () => {
    const app = buildApp();
    openProject();
    const { vol, ch } = await seedChapter(app);
    await putBody(app, ch, { content: textBlocks("一") });
    await putBody(app, ch, { content: textBlocks("二") });
    const [snapshot] = snapshotRows(ch);

    // 非章：列表 / 单份 / 恢复同宽
    expect((await app.request(`/api/v1/manuscript/${vol}/snapshots`, { headers: HOST_HEADERS })).status).toBe(400);
    expect((await getSnapshotApi(app, vol, snapshot!.seq)).status).toBe(400);
    expect((await restoreApi(app, vol, { snapshot_id: snapshot!.seq })).status).toBe(400);

    // 未命中
    const missing = await getSnapshotApi(app, ch, snapshot!.seq + 999);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("SNAPSHOT_NOT_FOUND");
    const missingRestore = await restoreApi(app, ch, { snapshot_id: snapshot!.seq + 999 });
    expect(missingRestore.status).toBe(404);
    expect((await missingRestore.json()).error.code).toBe("SNAPSHOT_NOT_FOUND");

    // 别的章的 seq 读不到（seq 全局自增，必须同时命中 owner）
    const other = await seedChapter(app, "另一章");
    expect((await getSnapshotApi(app, other.ch, snapshot!.seq)).status).toBe(404);

    // body / seq 校验
    expect((await restoreApi(app, ch, {})).status).toBe(400);
    expect((await restoreApi(app, ch, { snapshot_id: "1" })).status).toBe(400);
    expect((await restoreApi(app, ch, { snapshot_id: 1, extra: true })).status).toBe(400);
    expect((await app.request(`/api/v1/manuscript/${ch}/snapshots/abc`, { headers: HOST_HEADERS })).status).toBe(400);
  });
});

describe("章级历史：恢复端点", () => {
  it("⑤ 恢复可逆：恢复前的正文被强制压成快照（绕过节流），恢复后还能退回恢复前那一版", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    await putBody(app, ch, { content: textBlocks("第一版") });
    ageSnapshots(ch);
    await putBody(app, ch, { content: textBlocks("第二版") });
    ageSnapshots(ch);
    await putBody(app, ch, { content: textBlocks("第三版") });
    // 历史 = [第一版, 第二版]，当前 = 第三版
    const before = snapshotRows(ch);
    expect(before.map((r) => r.content)).toEqual([textBlocks("第一版"), textBlocks("第二版")]);

    // 恢复到「第一版」：节流窗口内（刚压过）也必须先把当前（第三版）压进历史
    const restored = await restoreApi(app, ch, { snapshot_id: before[0]!.seq });
    expect(restored.status).toBe(200);
    expect((await currentContent(app, ch)).content).toBe(textBlocks("第一版"));

    const afterRestore = snapshotRows(ch);
    expect(afterRestore).toHaveLength(3);
    expect(afterRestore[2]!.content).toBe(textBlocks("第三版")); // 恢复前的版本已进历史（强压，绕过节流）

    // 退回恢复前那一版：恢复完的内容再次被压进历史，正文回到第三版
    const back = await restoreApi(app, ch, { snapshot_id: afterRestore[2]!.seq });
    expect(back.status).toBe(200);
    expect((await currentContent(app, ch)).content).toBe(textBlocks("第三版"));
    expect(snapshotRows(ch).map((r) => r.content)).toEqual([
      textBlocks("第一版"),
      textBlocks("第二版"),
      textBlocks("第三版"),
      textBlocks("第一版"), // 第二次恢复前的当前内容
    ]);
  });

  it("当前内容已是目标版本 → 幂等返回（不写库、不产无意义快照、updated_at 不动）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);
    await putBody(app, ch, { content: textBlocks("一") });
    await putBody(app, ch, { content: textBlocks("二") });
    const [snap] = snapshotRows(ch);

    // 先回到「一」，再对同一份快照恢复第二次：正文已是目标版本
    await restoreApi(app, ch, { snapshot_id: snap!.seq });
    const afterFirst = await currentContent(app, ch);
    const snapshotsAfterFirst = snapshotRows(ch);

    const again = await restoreApi(app, ch, { snapshot_id: snap!.seq });
    expect(again.status).toBe(200);
    const body = (await again.json()).data;
    expect(body.updatedAt).toBe(afterFirst.updatedAt); // 幂等：版本戳不推进
    expect(body.charCount).toBe("一".length);
    expect(snapshotRows(ch)).toEqual(snapshotsAfterFirst); // 无新快照
  });

  it("⑥ 同秒多次保存：排序与读取都按 seq（created_at 完全相同也不乱）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);
    await saveMany(app, ch, 5); // 每轮 created_at 都被推到同一个过去时刻（N 次保存压 N-1 份）
    ageSnapshots(ch); // 最后一轮压入的那份也是同一时刻
    const rows = snapshotRows(ch);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.created_at)).size).toBe(1); // 前置：时间戳全部相同

    const list = await listSnapshotsApi(app, ch);
    expect(list.map((s) => s.seq)).toEqual([...list.map((s) => s.seq)].sort((a, b) => b - a));
    // 新→旧与保存顺序严格对应（只可能由 seq 决定）
    expect(list.map((s) => s.seq)).toEqual(rows.map((r) => r.seq).reverse());
    for (const [i, item] of list.entries()) {
      const single = (await (await getSnapshotApi(app, ch, item.seq)).json()).data;
      expect(single.content).toBe(rows[rows.length - 1 - i]!.content);
    }
  });

  it("⑦ 恢复后 updated_at 推进、码字统计照既有口径（只累加正差、缩短不扣）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);

    await putBody(app, ch, { content: textBlocks("短") }); // 统计 +1
    ageSnapshots(ch);
    await putBody(app, ch, { content: textBlocks("加长后的正文字数") }); // 统计 +7（共 8）
    const longVersion = (await currentContent(app, ch)).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const [shortSnapshot] = snapshotRows(ch); // 恢复到「短」那一版

    const res = await restoreApi(app, ch, { snapshot_id: shortSnapshot!.seq });
    const body = (await res.json()).data;
    expect(body.charCount).toBe("短".length);
    expect(Date.parse(body.updatedAt)).toBeGreaterThan(Date.parse(longVersion!)); // 版本戳推进
    expect((await currentContent(app, ch)).updatedAt).toBe(body.updatedAt); // 落库与响应一致
    expect(statsRows()).toEqual([{ date: localDateKey(), chars: 8 }]); // 缩短不扣：仍是 1+7

    // 再从历史恢复回长版本：正差照旧计入（+7）
    ageSnapshots(ch);
    const beforeRestoreBack = (await currentContent(app, ch)).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const back = (await (await restoreApi(app, ch, { snapshot_id: snapshotRows(ch).at(-1)!.seq })).json()).data;
    expect(back.charCount).toBe("加长后的正文字数".length);
    expect(Date.parse(back.updatedAt)).toBeGreaterThan(Date.parse(beforeRestoreBack!));
    expect(statsRows()).toEqual([{ date: localDateKey(), chars: 15 }]); // 8 + 7
  });
});

describe("章级历史：purge 级联", () => {
  it("章 purge → 该章快照一并物理删（软删期间保留）", async () => {
    const app = buildApp();
    openProject();
    const { ch } = await seedChapter(app);
    await putBody(app, ch, { content: textBlocks("一") });
    await putBody(app, ch, { content: textBlocks("二") });
    expect(snapshotRows(ch)).toHaveLength(1);

    await app.request(`/api/v1/outline/${ch}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(snapshotRows(ch)).toHaveLength(1); // 软删期间保留（还原后原样回来）

    expect((await app.request(`/api/v1/trash/outline/${ch}`, { method: "DELETE", headers: HOST_HEADERS })).status).toBe(200);
    expect(snapshotRows(ch)).toEqual([]);
  });
});