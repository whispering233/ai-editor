// 关系路由测试（S3.4）：GET 查询（depth 1/2/3 + 过滤 + 可见性）/ POST 创建（判重/校验）/ DELETE 物理删
// 覆盖：camelCase 响应、错误映射（409 RELATION_EXISTS / 400 / 404）、depth 必填与非法值
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { nowIso } from "@whispering233/ai-editor-db";
import { createEntity, softDeleteEntity, writeOutlineFile } from "@whispering233/ai-editor-db";
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
import { trashRoutes } from "./trash.js";

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
  // trash 路由（G2 occurs_at 测试：还原事件验证级联还原挂载，决策 12）
  app.route("/api/v1/trash", trashRoutes);
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

  it("occurs_at 1:n（G2，决策 26 修订）：重复挂载 → 409 EVENT_ALREADY_MOUNTED；换时间点挂载需先删旧关系", async () => {
    const { app } = await seed();
    const project = getCurrentProject()!;
    // 造两个 timepoint + 一个 event（直接 db 层建，快）
    const tpA = createEntity(project.db, { type: "timepoint", name: "第二天黄昏" });
    const tpB = createEntity(project.db, { type: "timepoint", name: "少年时" });
    const ev = createEntity(project.db, { type: "event", name: "玉佩事件" });
    // 首次挂载 → 201
    const first = await createRel(app, {
      source_type: "timepoint",
      source_id: tpA.id,
      target_type: "event",
      target_id: ev.id,
      relation_type: "occurs_at",
    });
    expect(first.status).toBe(201);
    // 重复挂载（同一时间点）→ 409 RELATION_EXISTS（判重先行语义：同三元组重复与泛型创建一致）
    const dupSame = await createRel(app, {
      source_type: "timepoint",
      source_id: tpA.id,
      target_type: "event",
      target_id: ev.id,
      relation_type: "occurs_at",
    });
    expect(dupSame.status).toBe(409);
    expect(dupSame.body.error.code).toBe("RELATION_EXISTS");
    // 换时间点挂载（事件已挂载 tpA）→ 409 EVENT_ALREADY_MOUNTED（occurs_at 1:n 约束，
    // assertEventSingleOccursAt 在 createRelation 前拦截——跨组拖拽走 move_to 复合端点）
    const dupOther = await createRel(app, {
      source_type: "timepoint",
      source_id: tpB.id,
      target_type: "event",
      target_id: ev.id,
      relation_type: "occurs_at",
    });
    expect(dupOther.status).toBe(409);
    expect(dupOther.body.error.code).toBe("EVENT_ALREADY_MOUNTED");
    expect(dupOther.body.error.message).toContain("重复挂载拒绝");
    // 其他事件不受影响：未挂载事件可正常挂载
    const ev2 = createEntity(project.db, { type: "event", name: "第二次交手" });
    const ok = await createRel(app, {
      source_type: "timepoint",
      source_id: tpB.id,
      target_type: "event",
      target_id: ev2.id,
      relation_type: "occurs_at",
    });
    expect(ok.status).toBe(201);
  });

  it("设定层级 belongs_to（决策 30）：自指/成环 → 400 VALIDATION_ERROR；正常与级联挂载 201", async () => {
    const { app } = await seed();
    const project = getCurrentProject()!;
    const world = createEntity(project.db, { type: "setting", name: "世界" });
    const continent = createEntity(project.db, { type: "setting", name: "大陆" });
    const sect = createEntity(project.db, { type: "setting", name: "门派" });
    const person = createEntity(project.db, { type: "character", name: "张三" });

    const rel = (source_id: string, target_id: string) => ({
      source_type: "setting",
      source_id,
      target_type: "setting",
      target_id,
      relation_type: "belongs_to",
    });

    // 正常：门派 → 大陆 → 世界（子 belongs_to 父，201）
    expect((await createRel(app, rel(sect.id, continent.id))).status).toBe(201);
    expect((await createRel(app, rel(continent.id, world.id))).status).toBe(201);

    // 自指：设定作为自己的上级 → 400
    const self = await createRel(app, rel(world.id, world.id));
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe("VALIDATION_ERROR");
    expect(self.body.error.message).toContain("自己的上级");

    // 成环：世界 → 门派（世界挂到门派下，而门派属于大陆属于世界）→ 400
    const cycle = await createRel(app, rel(world.id, sect.id));
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.code).toBe("VALIDATION_ERROR");
    expect(cycle.body.error.message).toContain("成环");

    // 成环：大陆 → 门派（把大陆挂到门派下，门派祖先链 = 门派→大陆→世界 含大陆）→ 400
    const cycle2 = await createRel(app, rel(continent.id, sect.id));
    expect(cycle2.status).toBe(400);

    // 非层级 belongs_to（人物→设定）不受影响 → 201
    const charRel = await createRel(app, {
      source_type: "character",
      source_id: person.id,
      target_type: "setting",
      target_id: world.id,
      relation_type: "belongs_to",
    });
    expect(charRel.status).toBe(201);

    // 孤儿级联挂载：新设定挂到世界下（祖先链无新设定）→ 201
    const sect2 = createEntity(project.db, { type: "setting", name: "新势力" });
    expect((await createRel(app, rel(sect2.id, world.id))).status).toBe(201);
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

// ============ PUT /api/v1/relation/:id ============

describe("PUT /relation/:id 更新元数据", () => {
  /** PUT 请求 helper（返回 status + body） */
  async function putRel(
    app: Hono,
    id: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: { success: boolean; data?: { updated: boolean }; error?: { code: string; message: string } } }> {
    const res = await app.request(`/api/v1/relation/${id}`, {
      method: "PUT",
      headers: { ...HOST_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it("正常更新 → 200 { updated: true }；metadata 整体替换（GET 验证旧键不残留）", async () => {
    const { app, charA, charB } = await seed();
    const created = await createRel(app, {
      source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally",
      metadata: { label: "旧标签", note: "保留" },
    });
    const id = created.body.data.id!;
    const res = await putRel(app, id, { metadata: { label: "新标签" } });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: true });
    const list = await app.request("/api/v1/relation?depth=1", { headers: HOST_HEADERS });
    expect((await list.json()).data.relations[0].metadata).toEqual({ label: "新标签" });
  });

  it("清空：metadata {} → 200；GET 返回 metadata {}（label 键消失，客户端取不到 label）", async () => {
    const { app, charA, charB } = await seed();
    const created = await createRel(app, {
      source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally",
      metadata: { label: "x" },
    });
    const res = await putRel(app, created.body.data.id!, { metadata: {} });
    expect(res.status).toBe(200);
    const list = await app.request("/api/v1/relation?depth=1", { headers: HOST_HEADERS });
    const meta = (await list.json()).data.relations[0].metadata as Record<string, unknown> | undefined;
    expect(meta).toEqual({});
    expect(meta?.label).toBeUndefined();
  });

  it("label 首尾 trim（与 POST 创建侧对称）", async () => {
    const { app, charA, charB } = await seed();
    const created = await createRel(app, {
      source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally",
    });
    const res = await putRel(app, created.body.data.id!, { metadata: { label: "  新标签  " } });
    expect(res.status).toBe(200);
    const list = await app.request("/api/v1/relation?depth=1", { headers: HOST_HEADERS });
    expect((await list.json()).data.relations[0].metadata).toEqual({ label: "新标签" });
  });

  it("label trim 后为空串 → 仅移除 label 键（请求内其余键保留）", async () => {
    const { app, charA, charB } = await seed();
    const created = await createRel(app, {
      source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally",
      metadata: { label: "x", note: "保留" },
    });
    const res = await putRel(app, created.body.data.id!, { metadata: { label: "   ", note: "保留" } });
    expect(res.status).toBe(200);
    const list = await app.request("/api/v1/relation?depth=1", { headers: HOST_HEADERS });
    expect((await list.json()).data.relations[0].metadata).toEqual({ note: "保留" }); // 仅 label 键移除
  });

  it("不存在 → 404 RELATION_NOT_FOUND", async () => {
    const { app } = await seed();
    const res = await putRel(app, "rel-999", { metadata: { label: "x" } });
    expect(res.status).toBe(404);
    expect(res.body.error!.code).toBe("RELATION_NOT_FOUND");
  });

  it("缺 metadata → 400 VALIDATION_ERROR", async () => {
    const { app, charA, charB } = await seed();
    const created = await createRel(app, {
      source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally",
    });
    const res = await putRel(app, created.body.data.id!, {});
    expect(res.status).toBe(400);
    expect(res.body.error!.code).toBe("VALIDATION_ERROR");
  });

  it("未知键 → 400 VALIDATION_ERROR（strict）", async () => {
    const { app, charA, charB } = await seed();
    const created = await createRel(app, {
      source_type: "character", source_id: charA, target_type: "character", target_id: charB, relation_type: "ally",
    });
    const res = await putRel(app, created.body.data.id!, { metadata: { label: "x" }, source_id: "sc-1" });
    expect(res.status).toBe(400);
    expect(res.body.error!.code).toBe("VALIDATION_ERROR");
  });
});

// ============ occurs_at 挂载（G2，决策 26 修订）：timepoint → event 1:n ============

describe("occurs_at 1:n 挂载（G2，决策 26 修订）", () => {
  /** 种子：open 项目 + timepoint ×2 + event ×1（db 层直插，复用 createEntity），返回 { app, tp0, tp1, ev } */
  function seedTimepointEvent(): { app: Hono; tp0: string; tp1: string; ev: string } {
    setCurrentProject(initProject(makeTmpDir()));
    const project = getCurrentProject()!;
    const tp0 = createEntity(project.db, { type: "timepoint", name: "拂晓" });
    const tp1 = createEntity(project.db, { type: "timepoint", name: "黄昏" });
    const ev = createEntity(project.db, { type: "event", name: "玉佩事件" });
    return { app: buildApp(), tp0: tp0.id, tp1: tp1.id, ev: ev.id };
  }

  it("合法挂载 → 201（timepoint → event 方向，occurs_at 1:n 语义）", async () => {
    const { app, tp0, ev } = seedTimepointEvent();
    const { status, body } = await createRel(app, {
      source_type: "timepoint",
      source_id: tp0,
      target_type: "event",
      target_id: ev,
      relation_type: "occurs_at",
    });
    expect(status).toBe(201);
    expect(body.data.relation).toEqual({
      sourceType: "timepoint",
      sourceId: tp0,
      targetType: "event",
      targetId: ev,
      relationType: "occurs_at",
    });
  });

  it("重复挂载（事件已挂另一时间点）→ 409 EVENT_ALREADY_MOUNTED，且不产生第二条关系", async () => {
    const { app, tp0, tp1, ev } = seedTimepointEvent();
    const first = await createRel(app, {
      source_type: "timepoint", source_id: tp0, target_type: "event", target_id: ev, relation_type: "occurs_at",
    });
    expect(first.status).toBe(201);
    // 同一事件挂到另一时间点 → 409（occurs_at 1:n 约束，assertEventSingleOccursAt）
    const dup = await createRel(app, {
      source_type: "timepoint", source_id: tp1, target_type: "event", target_id: ev, relation_type: "occurs_at",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error!.code).toBe("EVENT_ALREADY_MOUNTED");
    // 关系表只保留第一条（无半挂载残留）
    const list = await app.request(`/api/v1/relation?target_id=${ev}&relation_type=occurs_at&depth=1`, {
      headers: HOST_HEADERS,
    });
    const rels = (await list.json()).data.relations as Array<{ sourceId: string }>;
    expect(rels).toHaveLength(1);
    expect(rels[0].sourceId).toBe(tp0);
  });

  it("同三元组重复（同时间点再挂一次）→ 409 RELATION_EXISTS（判重先行语义：事件已挂载同一时间点 = 同三元组已存在，与泛型创建语义一致）", async () => {
    const { app, tp0, ev } = seedTimepointEvent();
    const body = {
      source_type: "timepoint", source_id: tp0, target_type: "event", target_id: ev, relation_type: "occurs_at",
    };
    await createRel(app, body);
    const dup = await createRel(app, body);
    expect(dup.status).toBe(409);
    expect(dup.body.error!.code).toBe("RELATION_EXISTS"); // 1:n 校验只拦「换时间点」场景（见 POST /relation 创建测试）
  });

  it("事件软删后其 occurs_at 级联软删（决策 12）→ 挂载不可见，且不参与 1:n 校验（新建关系被端点软删拦截，400 而非 409）", async () => {
    const { app, tp0, tp1, ev } = seedTimepointEvent();
    await createRel(app, {
      source_type: "timepoint", source_id: tp0, target_type: "event", target_id: ev, relation_type: "occurs_at",
    });
    // 软删事件 → occurs_at 级联软删（决策 12）——挂载不可见
    const project = getCurrentProject()!;
    softDeleteEntity(project.db, ev, nowIso());
    const list = await app.request(`/api/v1/relation?target_id=${ev}&relation_type=occurs_at&depth=1`, {
      headers: HOST_HEADERS,
    });
    expect((await list.json()).data.relations).toEqual([]);
    // 软删挂载不再参与 1:n 校验（否则会 409 EVENT_ALREADY_MOUNTED）——
    // 但事件本身已软删不可建新关系（决策 12 修订：软删端点拒绝）→ 400 VALIDATION_ERROR
    const remount = await createRel(app, {
      source_type: "timepoint", source_id: tp1, target_type: "event", target_id: ev, relation_type: "occurs_at",
    });
    expect(remount.status).toBe(400);
    expect(remount.body.error!.code).toBe("VALIDATION_ERROR"); // ENDPOINT_NOT_FOUND（事件软删），非 409
  });
});
