// 回收站路由测试（S4.3）：实体侧 restore/purge + GET 列表 entities 填充
// 覆盖：列表 entities 字段（deletedAt camelCase 透传）、restore 计数与级联可见性恢复、
//       purge 未软删 400 拦截 + 物理清除、404 残留请求、非法 type 400。
// 大纲侧端点行为由 outline.test.ts 既有用例覆盖（同一 trashRoutes 实例，此处仅挂载确认不冲突）。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createRelation } from "@whispering233/ai-editor-db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { entityRoutes } from "./entity.js";
import { trashRoutes } from "./trash.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const T0 = "2026-08-01T10:00:00Z";

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "trash-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（entity + trash 路由） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/entity", entityRoutes);
  app.route("/api/v1/trash", trashRoutes);
  return app;
}

/** 构造并打开项目（initProject：三文件 + user_version），注入 currentProject 单例 */
function openProject(): void {
  setCurrentProject(initProject(makeTmpDir()));
}

/** 创建实体辅助（API，201） */
async function createCharacter(app: Hono, name: string): Promise<{ id: string }> {
  const res = await app.request("/api/v1/entity/character", {
    method: "POST",
    headers: { ...HOST_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string };
}

/** 预插一条 Delta（target 指向指定实体；触发节点固定 sc-1；"order" 是 SQLite 关键字需引号） */
function seedDelta(entityId: string): void {
  getCurrentProject()!.db
    .prepare(
      'INSERT INTO delta_records (id, node_id, target_type, target_id, changes, description, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(`delta-${entityId}`, "sc-1", "character", entityId, "[]", "测试", 1, T0, T0);
}

/** 预插一条关系（A → B，db 直插：关系创建属 S3.4 已覆盖，本卡聚焦回收站行为） */
function seedRelation(sourceId: string, targetId: string): void {
  const project = getCurrentProject()!;
  createRelation(
    project.db,
    { sourceType: "character", sourceId, targetType: "character", targetId, relationType: "ally" },
    project.root,
  );
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-trash-"));
  setCurrentProject(null);
});

afterEach(() => {
  const project = getCurrentProject();
  if (project) closeProject(project);
  setCurrentProject(null);
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/v1/trash 列表（S4.3 entities 填充）", () => {
  it("entities 含软删实体（deletedAt camelCase 透传），nodes 为空", async () => {
    const app = buildApp();
    openProject();
    const { id } = await createCharacter(app, "张三");
    await createCharacter(app, "李四"); // 未软删，不出现
    await app.request(`/api/v1/entity/character/${id}`, { method: "DELETE", headers: HOST_HEADERS }); // 软删张三

    const res = await app.request("/api/v1/trash", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { entities: Array<Record<string, unknown>>; nodes: unknown[] } };
    expect(body.data.entities).toHaveLength(1);
    expect(body.data.entities[0]).toEqual({ id, type: "character", name: "张三", deletedAt: expect.any(String) });
    expect(body.data.nodes).toEqual([]);
  });

  it("空回收站 → entities 与 nodes 均空数组", async () => {
    const app = buildApp();
    openProject();
    await createCharacter(app, "张三");
    const res = await app.request("/api/v1/trash", { headers: HOST_HEADERS });
    expect(await res.json()).toEqual({ success: true, data: { entities: [], nodes: [] } });
  });
});

describe("POST /api/v1/trash/entity/:type/:id/restore", () => {
  it("级联还原关系+Delta 计数正确；实体与级联行恢复可见（常规查询/详情）", async () => {
    const app = buildApp();
    openProject();
    const { id: a } = await createCharacter(app, "张三");
    const { id: b } = await createCharacter(app, "李四");
    seedRelation(a, b);
    seedDelta(a);
    await app.request(`/api/v1/entity/character/${a}`, { method: "DELETE", headers: HOST_HEADERS }); // 软删 + 级联
    // 软删后：常规查询不可见、回收站可见
    expect((await app.request(`/api/v1/entity/character/${a}`, { headers: HOST_HEADERS })).status).toBe(404);
    const trash = await app.request("/api/v1/trash", { headers: HOST_HEADERS });
    expect(((await trash.json()) as { data: { entities: unknown[] } }).data.entities).toHaveLength(1);

    const res = await app.request(`/api/v1/trash/entity/character/${a}/restore`, {
      method: "POST",
      headers: HOST_HEADERS,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { restored: true, restoredRelations: 1, restoredDeltas: 1 },
    });
    // 实体恢复可见（详情联查关系与 deltaCount）
    const detail = await app.request(`/api/v1/entity/character/${a}`, { headers: HOST_HEADERS });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { data: { relations: unknown[]; deltaCount: number } };
    expect(detailBody.data.relations).toHaveLength(1); // 级联关系恢复可见
    expect(detailBody.data.deltaCount).toBe(1); // 级联 Delta 恢复可见
    // 回收站清空（还原后移出）
    const after = await app.request("/api/v1/trash", { headers: HOST_HEADERS });
    expect(((await after.json()) as { data: { entities: unknown[] } }).data.entities).toEqual([]);
  });

  it("未软删实体/不存在 → 404 ENTITY_NOT_FOUND；非法 type → 400 VALIDATION_ERROR", async () => {
    const app = buildApp();
    openProject();
    const { id } = await createCharacter(app, "张三");
    const live = await app.request(`/api/v1/trash/entity/character/${id}/restore`, {
      method: "POST",
      headers: HOST_HEADERS,
    });
    expect(live.status).toBe(404);
    expect(((await live.json()) as { error: { code: string } }).error.code).toBe("ENTITY_NOT_FOUND");
    const missing = await app.request(`/api/v1/trash/entity/character/char-999/restore`, {
      method: "POST",
      headers: HOST_HEADERS,
    });
    expect(missing.status).toBe(404);
    const badType = await app.request(`/api/v1/trash/entity/dragon/char-1/restore`, {
      method: "POST",
      headers: HOST_HEADERS,
    });
    expect(badType.status).toBe(400);
    expect(((await badType.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("DELETE /api/v1/trash/entity/:type/:id（purge）", () => {
  it("未软删实体 → 400 VALIDATION_ERROR（purge 仅用于回收站清理），实体不受影响", async () => {
    const app = buildApp();
    openProject();
    const { id } = await createCharacter(app, "张三");
    const res = await app.request(`/api/v1/trash/entity/character/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    // 实体仍在（常规查询可见，未被误清）
    expect((await app.request(`/api/v1/entity/character/${id}`, { headers: HOST_HEADERS })).status).toBe(200);
  });

  it("purge：本体+关系+Delta 物理清除；残留 restore/purge 请求 → 404", async () => {
    const app = buildApp();
    openProject();
    const { id: a } = await createCharacter(app, "张三");
    const { id: b } = await createCharacter(app, "李四");
    seedRelation(a, b);
    seedDelta(a);
    await app.request(`/api/v1/entity/character/${a}`, { method: "DELETE", headers: HOST_HEADERS }); // 软删入回收站

    const res = await app.request(`/api/v1/trash/entity/character/${a}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { purged: true } });
    // 本体物理清除：常规查询 404
    expect((await app.request(`/api/v1/entity/character/${a}`, { headers: HOST_HEADERS })).status).toBe(404);
    // 关联关系物理清除：b 的详情不再有该关系
    const bDetail = await app.request(`/api/v1/entity/character/${b}`, { headers: HOST_HEADERS });
    expect(((await bDetail.json()) as { data: { relations: unknown[] } }).data.relations).toEqual([]);
    // 回收站清空
    const trash = await app.request("/api/v1/trash", { headers: HOST_HEADERS });
    expect(((await trash.json()) as { data: { entities: unknown[] } }).data.entities).toEqual([]);
    // 残留请求（对象已被 purge）：restore 与 purge 均 404
    const staleRestore = await app.request(`/api/v1/trash/entity/character/${a}/restore`, {
      method: "POST",
      headers: HOST_HEADERS,
    });
    expect(staleRestore.status).toBe(404);
    expect(((await staleRestore.json()) as { error: { code: string } }).error.code).toBe("ENTITY_NOT_FOUND");
    const stalePurge = await app.request(`/api/v1/trash/entity/character/${a}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(stalePurge.status).toBe(404);
  });
});
