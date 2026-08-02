// 关系路由测试（S3.4）：GET 查询（depth 1/2/3 + 过滤 + 可见性）/ POST 创建（判重/校验）/ DELETE 物理删
// 覆盖：camelCase 响应、错误映射（409 RELATION_EXISTS / 400 / 404）、depth 必填与非法值
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { nowIso } from "@ai-editor/db";
import { createEntity, softDeleteEntity, writeOutlineFile } from "@ai-editor/db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { relationRoutes } from "./relation.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "rel-"));
  tmpDirs.push(dir);
  return dir;
}

function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/relation", relationRoutes);
  return app;
}

/** open 项目 + 种子（两角色 + 大纲树 sc-1），返回 { app, charA, charB } */
async function seed(): Promise<{ app: Hono; charA: string; charB: string; sc1: string }> {
  const dir = makeTmpDir();
  setCurrentProject(initProject(dir));
  writeOutlineFile(dir, {
    id: "root",
    type: "root",
    schema_version: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: "2026-08-01T10:00:00Z",
        children: [
          {
            id: "ch-1",
            type: "chapter",
            title: "第一章",
            updated_at: "2026-08-01T10:00:00Z",
            children: [{ id: "sc-1", type: "scene", title: "场景一", updated_at: "2026-08-01T10:00:00Z" }],
          },
        ],
      },
    ],
  });
  const project = getCurrentProject()!;
  const charA = createEntity(project.db, { type: "character", name: "阿强" });
  const charB = createEntity(project.db, { type: "character", name: "阿珍" });
  return { app: buildApp(), charA: charA.id, charB: charB.id, sc1: "sc-1" };
}

/** POST 创建响应的 data 形状（测试断言用） */
interface RelCreateData {
  id?: string;
  relation?: {
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
    relationType: string;
  };
}

/** 便捷创建关系（HTTP） */
async function createRel(
  app: Hono,
  body: Record<string, unknown>,
): Promise<{ status: number; body: { success: boolean; data?: RelCreateData; error?: { code: string; message: string } } }> {
  const res = await app.request("/api/v1/relation", {
    method: "POST",
    headers: { ...HOST_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-rel-"));
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

// ============ POST /api/v1/relation ============

describe("POST /relation 创建", () => {
  it("合法创建 → 201，响应 { id, relation } 全字段（camelCase）", async () => {
    const { app, charA, charB } = await seed();
    const { status, body } = await createRel(app, {
      source_type: "character",
      source_id: charA,
      target_type: "character",
      target_id: charB,
      relation_type: "ally",
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toMatch(/^rel-/);
    expect(body.data.relation).toEqual({
      sourceType: "character",
      sourceId: charA,
      targetType: "character",
      targetId: charB,
      relationType: "ally",
    });
  });

  it("同三元组判重 → 409 RELATION_EXISTS", async () => {
    const { app, charA, charB } = await seed();
    const body = {
      source_type: "character",
      source_id: charA,
      target_type: "character",
      target_id: charB,
      relation_type: "ally",
    };
    await createRel(app, body);
    const dup = await createRel(app, body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("RELATION_EXISTS");
  });

  it("非法 relation_type → 400 VALIDATION_ERROR（schema enum 拦截）", async () => {
    const { app, charA, charB } = await seed();
    const { status, body } = await createRel(app, {
      source_type: "character",
      source_id: charA,
      target_type: "character",
      target_id: charB,
      relation_type: "friend",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("端点不存在/已软删 → 400 VALIDATION_ERROR（ENDPOINT_NOT_FOUND 映射）", async () => {
    const { app, charB } = await seed();
    const { status, body } = await createRel(app, {
      source_type: "character",
      source_id: "char-999",
      target_type: "character",
      target_id: charB,
      relation_type: "ally",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("char-999");

    // 软删端点
    const project = getCurrentProject()!;
    const ghost = createEntity(project.db, { type: "character", name: "幽灵" });
    softDeleteEntity(project.db, ghost.id, nowIso());
    const ghostRes = await createRel(app, {
      source_type: "character",
      source_id: ghost.id,
      target_type: "character",
      target_id: charB,
      relation_type: "ally",
    });
    expect(ghostRes.status).toBe(400);
  });

  it("大纲节点端点 + metadata → 201（plot_edge 同规则）", async () => {
    const { app, charA, sc1 } = await seed();
    const { status, body } = await createRel(app, {
      source_type: "outline_node",
      source_id: sc1,
      target_type: "character",
      target_id: charA,
      relation_type: "appears_in",
      metadata: { note: "出场" },
    });
    expect(status).toBe(201);
    expect(body.data.relation.sourceType).toBe("outline_node");
  });
});

// ============ GET /api/v1/relation ============

describe("GET /relation 查询", () => {
  it("depth=1：过滤组合 + camelCase 字段（sourceName/targetName 填充）", async () => {
    const { app, charA, charB } = await seed();
    await createRel(app, {
      source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally",
    });
    const res = await app.request(`/api/v1/relation?source_id=${charA}&depth=1`, { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.paths).toBeUndefined();
    expect(body.data.relations).toHaveLength(1);
    expect(body.data.relations[0]).toEqual({
      id: expect.stringMatching(/^rel-/),
      sourceType: "character",
      sourceId: charA,
      sourceName: "阿强",
      targetType: "character",
      targetId: charB,
      targetName: "阿珍",
      relationType: "ally",
      createdAt: expect.any(String),
    });
  });

  it("depth=2：paths 结构（nodes/edges camelCase）；depth=3 更远路径", async () => {
    const { app, charA, charB } = await seed();
    // 链：A→B→sc-1
    await createRel(app, { source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally" });
    await createRel(app, { source_type: "character", source_id: charB, target_type: "outline_node", target_id: "sc-1", relation_type: "mentor" });

    const res = await app.request(`/api/v1/relation?source_id=${charA}&depth=2`, { headers: HOST_HEADERS });
    const body = await res.json();
    expect(body.data.paths).toHaveLength(2); // A→B、A→B→sc-1
    const twoHop = body.data.paths.find((p: { edges: unknown[] }) => p.edges.length === 2)!;
    expect(twoHop.nodes).toEqual([
      { type: "character", id: charA, name: "阿强" },
      { type: "character", id: charB, name: "阿珍" },
      { type: "outline_node", id: "sc-1", name: "场景一" },
    ]);
    expect(twoHop.edges[1]).toEqual({ from: charB, to: "sc-1", relationType: "mentor" });
    // depth=3 等价（无更远路径）
    const d3 = await app.request(`/api/v1/relation?source_id=${charA}&depth=3`, { headers: HOST_HEADERS });
    expect((await d3.json()).data.paths).toHaveLength(2);
  });

  it("可见性（决策 12 修订）：source 软删后关系不可见", async () => {
    const { app, charA, charB } = await seed();
    await createRel(app, { source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally" });
    const project = getCurrentProject()!;
    softDeleteEntity(project.db, charA, nowIso());
    const res = await app.request("/api/v1/relation?depth=1", { headers: HOST_HEADERS });
    expect((await res.json()).data.relations).toHaveLength(0);
  });

  it("depth 缺失/非法 → 400 VALIDATION_ERROR", async () => {
    const { app } = await seed();
    const noDepth = await app.request("/api/v1/relation", { headers: HOST_HEADERS });
    expect(noDepth.status).toBe(400);
    expect((await noDepth.json()).error.code).toBe("VALIDATION_ERROR");
    const badDepth = await app.request("/api/v1/relation?depth=5", { headers: HOST_HEADERS });
    expect(badDepth.status).toBe(400);
    const strDepth = await app.request("/api/v1/relation?depth=abc", { headers: HOST_HEADERS });
    expect(strDepth.status).toBe(400);
  });
});

// ============ DELETE /api/v1/relation/:id ============

describe("DELETE /relation/:id 物理删", () => {
  it("物理删除 → 200 { deleted: true }；不存在 → 404 RELATION_NOT_FOUND", async () => {
    const { app, charA, charB } = await seed();
    const created = await createRel(app, {
      source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally",
    });
    const id = created.body.data.id;

    const res = await app.request(`/api/v1/relation/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ deleted: true });

    // 已删 → 404
    const again = await app.request(`/api/v1/relation/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(again.status).toBe(404);
    expect((await again.json()).error.code).toBe("RELATION_NOT_FOUND");
    // 不存在 id → 404
    const missing = await app.request("/api/v1/relation/rel-999", { method: "DELETE", headers: HOST_HEADERS });
    expect(missing.status).toBe(404);
  });

  it("删除后 GET 不再返回（物理删不进回收站）", async () => {
    const { app, charA, charB } = await seed();
    const created = await createRel(app, {
      source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally",
    });
    await app.request(`/api/v1/relation/${created.body.data.id}`, { method: "DELETE", headers: HOST_HEADERS });
    const res = await app.request("/api/v1/relation?depth=1", { headers: HOST_HEADERS });
    expect((await res.json()).data.relations).toHaveLength(0);
  });
});
