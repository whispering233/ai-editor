// 伏笔专属只读端点测试：GET /api/v1/hook/expected?node_id= / GET /api/v1/hook/written-unresolved
// /expected 覆盖：命中（字面相等）/ 已回收与已弃用不列 / 已软删不列 / 空命中 / 坏 JSON 行不打挂列表 / 缺 node_id 400。
// /written-unresolved 覆盖：已写正文的预计回收章 → 列出（章号 + 章标题）/ 未写正文不列 / 空命中。
// 走真实 sqlite（同 entity.test.ts 的装配方式），不经泛型列表端点——两个端点各自走 db 查询。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createEntity, softDeleteEntity, updateEntity, upsertDocument, writeOutlineFile } from "@whispering233/ai-editor-db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { hookRoutes } from "./hook.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "hook-expected-"));
  tmpDirs.push(dir);
  return dir;
}

function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/hook", hookRoutes);
  return app;
}

function openProject(): void {
  setCurrentProject(initProject(makeTmpDir()));
}

/** 预插一条 data 为非法 JSON 的 hook 行（手改库 / 异常写入） */
function seedBadJsonHook(): void {
  getCurrentProject()!
    .db.prepare("INSERT INTO entities (id, type, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("hook-bad", "hook", "坏行", "{", "2026-11-01T00:00:00Z", "2026-11-01T00:00:00Z");
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-hook-expected-"));
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

describe("GET /api/v1/hook/expected", () => {
  it("只列 expected_resolve_node_id 字面相等的未回收伏笔（id / name / status）", async () => {
    const app = buildApp();
    openProject();
    const db = getCurrentProject()!.db;
    const planted = createEntity(db, {
      type: "hook",
      name: "断剑来历",
      data: { status: "planted", expected_resolve_node_id: "ch-2" },
    });
    const progressing = createEntity(db, {
      type: "hook",
      name: "旧盟友背叛",
      data: { status: "progressing", expected_resolve_node_id: "ch-2" },
    });
    // 状态缺失 = 创建即埋设（按 planted 归一）
    const bare = createEntity(db, { type: "hook", name: "无名信", data: { expected_resolve_node_id: "ch-2" } });
    // 其他章 / 已回收 / 已弃用 / 已软删 → 都不列
    createEntity(db, { type: "hook", name: "别章的坑", data: { expected_resolve_node_id: "ch-3" } });
    createEntity(db, {
      type: "hook",
      name: "已回收",
      data: { status: "resolved", expected_resolve_node_id: "ch-2" },
    });
    createEntity(db, {
      type: "hook",
      name: "已弃用",
      data: { status: "abandoned", expected_resolve_node_id: "ch-2" },
    });
    const dropped = createEntity(db, {
      type: "hook",
      name: "进回收站",
      data: { status: "planted", expected_resolve_node_id: "ch-2" },
    });
    softDeleteEntity(db, dropped.id, "2026-11-01T00:00:00Z");

    const res = await app.request("/api/v1/hook/expected?node_id=ch-2", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body).toEqual({
      items: [
        { id: planted.id, name: "断剑来历", status: "planted" },
        { id: bare.id, name: "无名信", status: "planted" },
        { id: progressing.id, name: "旧盟友背叛", status: "progressing" },
      ],
    });
  });

  it("空命中 → items []（写作页据此不渲染整块）", async () => {
    const app = buildApp();
    openProject();
    createEntity(getCurrentProject()!.db, { type: "hook", name: "别章的坑", data: { expected_resolve_node_id: "ch-9" } });
    const res = await app.request("/api/v1/hook/expected?node_id=ch-1", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ items: [] });
  });

  it("data 非法 JSON 的坏行不打挂列表（json_valid 守卫 → 200，其余行照常返回）", async () => {
    const app = buildApp();
    openProject();
    const db = getCurrentProject()!.db;
    const hit = createEntity(db, {
      type: "hook",
      name: "断剑来历",
      data: { status: "planted", expected_resolve_node_id: "ch-2" },
    });
    seedBadJsonHook();
    const res = await app.request("/api/v1/hook/expected?node_id=ch-2", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.items).toEqual([{ id: hit.id, name: "断剑来历", status: "planted" }]);
  });

  it("缺 node_id → 400 VALIDATION_ERROR", async () => {
    const app = buildApp();
    openProject();
    const missing = await app.request("/api/v1/hook/expected", { headers: HOST_HEADERS });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("VALIDATION_ERROR");
    const empty = await app.request("/api/v1/hook/expected?node_id=", { headers: HOST_HEADERS });
    expect(empty.status).toBe(400);
  });

  it("回收后从列表消失（状态改为 resolved）", async () => {
    const app = buildApp();
    openProject();
    const db = getCurrentProject()!.db;
    const hook = createEntity(db, {
      type: "hook",
      name: "断剑来历",
      data: { status: "planted", expected_resolve_node_id: "ch-2" },
    });
    updateEntity(db, hook.id, { data: { status: "resolved" } });
    const res = await app.request("/api/v1/hook/expected?node_id=ch-2", { headers: HOST_HEADERS });
    expect((await res.json()).data).toEqual({ items: [] });
  });
});
describe("GET /api/v1/hook/written-unresolved", () => {
  /** 两章大纲（ch-1 = 第 1 章、ch-2 = 第 2 章） */
  function seedOutline(): void {
    writeOutlineFile(getCurrentProject()!.root, {
      id: "root",
      type: "root",
      schema_version: 1,
      children: [
        {
          id: "vol-1",
          type: "volume",
          title: "第一卷",
          updated_at: "2026-11-01T00:00:00Z",
          children: [
            { id: "ch-1", type: "chapter", title: "第一章", updated_at: "2026-11-01T00:00:00Z", children: [] },
            { id: "ch-2", type: "chapter", title: "第二章", updated_at: "2026-11-01T00:00:00Z", children: [] },
          ],
        },
      ],
    });
  }

  it("只列「预计回收章已写正文」的活跃伏笔（含章号与章标题）", async () => {
    const app = buildApp();
    openProject();
    seedOutline();
    const db = getCurrentProject()!.db;
    // ch-2 已写正文、ch-1 未写
    upsertDocument(db, {
      ownerKind: "chapter",
      ownerId: "ch-2",
      content: "[]",
      contentText: "第二章正文",
      now: "2026-11-01T00:00:00Z",
    });
    const hit = createEntity(db, {
      type: "hook",
      name: "断剑来历",
      data: { status: "progressing", expected_resolve_node_id: "ch-2" },
    });
    createEntity(db, { type: "hook", name: "章未写", data: { status: "planted", expected_resolve_node_id: "ch-1" } });
    createEntity(db, { type: "hook", name: "已回收", data: { status: "resolved", expected_resolve_node_id: "ch-2" } });
    createEntity(db, { type: "hook", name: "无预计章", data: { status: "planted" } });

    const res = await app.request("/api/v1/hook/written-unresolved", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      hooks: [
        {
          id: hit.id,
          name: "断剑来历",
          status: "progressing",
          expectedResolveNodeId: "ch-2",
          expectedResolveChapterNumber: 2,
          expectedResolveChapterTitle: "第二章",
        },
      ],
    });
  });

  it("空命中 → hooks: []", async () => {
    const app = buildApp();
    openProject();
    seedOutline();
    const res = await app.request("/api/v1/hook/written-unresolved", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ hooks: [] });
  });
});
