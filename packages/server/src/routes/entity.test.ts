// 实体路由测试（S3.3）：列表/创建/详情/更新/软删 + 契约校验
// 覆盖：type 过滤与摘要（camelCase）、分页/排序、软删过滤（决策 12）、创建 201 与按类型 data 校验、
//       部分更新（浅合并）、404 映射、级联计数、详情 relations 紧邻（S3.2 接入）
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createRelation } from "@whispering233/ai-editor-db";
import { errorHandler } from "../middleware/error.js";
import {
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { entityRoutes } from "./entity.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "entity-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（entity 路由） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/entity", entityRoutes);
  return app;
}

/** 构造并打开项目（initProject：三文件 + user_version），注入 currentProject 单例 */
function openProject(): void {
  setCurrentProject(initProject(makeTmpDir()));
}

/** JSON 请求辅助 */
function jsonRequest(method: string, path: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { ...HOST_HEADERS, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

/** 创建实体辅助（返回响应体 data） */
async function createCharacter(app: Hono, name: string, data?: Record<string, unknown>): Promise<{ id: string }> {
  const res = await app.request(`/api/v1/entity/character`, jsonRequest("POST", "", { name, ...(data ? { data } : {}) }));
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-entity-"));
  setCurrentProject(null);
});

afterEach(() => {
  setCurrentProject(null);
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET /api/v1/entity/:type 列表", () => {
  it("空列表 → items 空 + total 0 + 分页缺省", async () => {
    openProject();
    const res = await buildApp().request("/api/v1/entity/character", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { items: [], total: 0, offset: 0, limit: 50 } });
  });

  it("列表返回 EntitySummary（camelCase + 摘要字段）", async () => {
    openProject();
    const app = buildApp();
    await createCharacter(app, "张三", { role: "主角", status: "alive", custom_fields: { x: 1 } });
    const res = await app.request("/api/v1/entity/character", { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { items: Array<Record<string, unknown>>; total: number } };
    expect(body.data.total).toBe(1);
    const item = body.data.items[0];
    expect(item).toMatchObject({ type: "character", name: "张三", createdAt: expect.any(String), updatedAt: expect.any(String) });
    expect((item.summary as Record<string, unknown>).role).toBe("主角"); // character → role/status 摘要
    expect((item.summary as Record<string, unknown>).status).toBe("alive");
  });

  it("type 过滤：不同 type 互不串扰", async () => {
    openProject();
    const app = buildApp();
    await createCharacter(app, "张三");
    await app.request("/api/v1/entity/setting", jsonRequest("POST", "", { name: "修仙世界" }));
    const res = await app.request("/api/v1/entity/setting", { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { items: Array<{ name: string }>; total: number } };
    expect(body.data.total).toBe(1);
    expect(body.data.items[0].name).toBe("修仙世界");
  });

  it("非法 type → 400 VALIDATION_ERROR", async () => {
    openProject();
    const res = await buildApp().request("/api/v1/entity/dragon", { headers: HOST_HEADERS });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("q 模糊搜索 + limit 分页", async () => {
    openProject();
    const app = buildApp();
    await createCharacter(app, "张三");
    await createCharacter(app, "李四");
    const q = await app.request("/api/v1/entity/character?q=张三", { headers: HOST_HEADERS });
    const qBody = (await q.json()) as { data: { items: Array<{ name: string }>; total: number } };
    expect(qBody.data.total).toBe(1);
    expect(qBody.data.items[0].name).toBe("张三");
    const limited = await app.request("/api/v1/entity/character?limit=1", { headers: HOST_HEADERS });
    const lBody = (await limited.json()) as { data: { items: unknown[]; total: number; limit: number } };
    expect(lBody.data.items).toHaveLength(1);
    expect(lBody.data.total).toBe(2);
    expect(lBody.data.limit).toBe(1);
  });

  it("软删对象默认过滤（决策 12）", async () => {
    openProject();
    const app = buildApp();
    const { id } = await createCharacter(app, "将删");
    await app.request(`/api/v1/entity/character/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    const res = await app.request("/api/v1/entity/character", { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { items: unknown[]; total: number } };
    expect(body.data.total).toBe(0);
  });
});

describe("GET /api/v1/entity/:type/:id 详情", () => {
  it("返回 data 完整 + deltaCount + relations 空（无关系时）", async () => {
    openProject();
    const app = buildApp();
    const { id } = await createCharacter(app, "张三", { role: "主角" });
    const res = await app.request(`/api/v1/entity/character/${id}`, { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ id, type: "character", name: "张三", deltaCount: 0 });
    expect((body.data.data as Record<string, unknown>).role).toBe("主角");
    expect(body.data.relations).toEqual([]);
  });

  it("relations 紧邻：建立关系后详情返回（S3.2 接入，camelCase + name 填充）", async () => {
    openProject();
    const app = buildApp();
    const { id: a } = await createCharacter(app, "张三");
    const { id: b } = await createCharacter(app, "李四");
    const project = getCurrentProject()!;
    createRelation(
      project.db,
      { sourceType: "character", sourceId: a, targetType: "character", targetId: b, relationType: "ally" },
      project.root,
    );
    const res = await app.request(`/api/v1/entity/character/${a}`, { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { relations: Array<Record<string, unknown>> } };
    expect(body.data.relations).toHaveLength(1);
    expect(body.data.relations[0]).toMatchObject({
      sourceId: a,
      targetId: b,
      relationType: "ally",
      targetName: "李四",
      createdAt: expect.any(String),
    });
  });

  it("relations 双向邻接：A→B 关系在 B 的详情同样可见（target 方向，sourceName 填充）", async () => {
    openProject();
    const app = buildApp();
    const { id: a } = await createCharacter(app, "张三");
    const { id: b } = await createCharacter(app, "李四");
    const project = getCurrentProject()!;
    createRelation(
      project.db,
      { sourceType: "character", sourceId: a, targetType: "character", targetId: b, relationType: "ally" },
      project.root,
    );
    const res = await app.request(`/api/v1/entity/character/${b}`, { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { relations: Array<Record<string, unknown>> } };
    expect(body.data.relations).toHaveLength(1);
    expect(body.data.relations[0]).toMatchObject({
      sourceId: a,
      targetId: b,
      relationType: "ally",
      sourceName: "张三", // target 方向查询：source 是 a，name 联表填充
    });
  });

  it("relations 双向去重：自环 A→A 只出现一次", async () => {
    openProject();
    const app = buildApp();
    const { id: a } = await createCharacter(app, "张三");
    const project = getCurrentProject()!;
    createRelation(
      project.db,
      { sourceType: "character", sourceId: a, targetType: "character", targetId: a, relationType: "ally" },
      project.root,
    );
    const res = await app.request(`/api/v1/entity/character/${a}`, { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { relations: unknown[] } };
    expect(body.data.relations).toHaveLength(1);
  });

  it("不存在 → 404 ENTITY_NOT_FOUND", async () => {
    openProject();
    const res = await buildApp().request("/api/v1/entity/character/char-nope", { headers: HOST_HEADERS });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "ENTITY_NOT_FOUND" } });
  });

  it("已软删实体 → 404（常规查询过滤）", async () => {
    openProject();
    const app = buildApp();
    const { id } = await createCharacter(app, "张三");
    await app.request(`/api/v1/entity/character/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    const res = await app.request(`/api/v1/entity/character/${id}`, { headers: HOST_HEADERS });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/entity/:type 创建", () => {
  it("201 + id 前缀 + createdAt；data 原样透传", async () => {
    openProject();
    const res = await buildApp().request(
      "/api/v1/entity/character",
      jsonRequest("POST", "", { name: "张三", data: { role: "主角" } }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(String(body.data.id)).toMatch(/^char-/);
    expect(body.data.createdAt).toEqual(expect.any(String));
    expect((body.data.data as Record<string, unknown>).role).toBe("主角");
  });

  it("name 缺失 → 400 VALIDATION_ERROR（含 fields）", async () => {
    openProject();
    const res = await buildApp().request("/api/v1/entity/character", jsonRequest("POST", "", { data: {} }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; fields?: string[] } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields).toContain("name");
  });

  it("name 超 100 字符 → 400", async () => {
    openProject();
    const res = await buildApp().request("/api/v1/entity/character", jsonRequest("POST", "", { name: "a".repeat(101) }));
    expect(res.status).toBe(400);
  });

  it("data 按类型精确校验：hook 非法 status → 400；合法通过", async () => {
    openProject();
    const app = buildApp();
    const bad = await app.request(
      "/api/v1/entity/hook",
      jsonRequest("POST", "", { name: "伏笔", data: { status: "sprouted" } }),
    );
    expect(bad.status).toBe(400);
    const ok = await app.request(
      "/api/v1/entity/hook",
      jsonRequest("POST", "", { name: "伏笔", data: { status: "planted", payoff_timing: "slow_burn" } }),
    );
    expect(ok.status).toBe(201);
  });
});

describe("PUT /api/v1/entity/:type/:id 部分更新", () => {
  it("更新 name；data 浅合并（未传字段保留）", async () => {
    openProject();
    const app = buildApp();
    const { id } = await createCharacter(app, "张三", { role: "主角", status: "alive" });
    const res = await app.request(
      `/api/v1/entity/character/${id}`,
      jsonRequest("PUT", "", { name: "张三丰", data: { role: "宗师" } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { data: { updated: boolean } }).toMatchObject({ data: { updated: true } });
    const detail = await app.request(`/api/v1/entity/character/${id}`, { headers: HOST_HEADERS });
    const body = (await detail.json()) as { data: { name: string; data: Record<string, unknown> } };
    expect(body.data.name).toBe("张三丰");
    expect(body.data.data).toEqual({ role: "宗师", status: "alive" }); // 浅合并：status 保留
  });

  it("空 body 的 PUT（部分更新无字段）→ 200 无变化", async () => {
    openProject();
    const app = buildApp();
    const { id } = await createCharacter(app, "张三");
    const res = await app.request(`/api/v1/entity/character/${id}`, jsonRequest("PUT", "", {}));
    expect(res.status).toBe(200);
  });

  it("不存在 → 404 ENTITY_NOT_FOUND", async () => {
    openProject();
    const res = await buildApp().request(
      "/api/v1/entity/character/char-nope",
      jsonRequest("PUT", "", { name: "x" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/entity/:type/:id 软删", () => {
  it("删除成功 → cascaded 计数（0 关系 0 delta）", async () => {
    openProject();
    const app = buildApp();
    const { id } = await createCharacter(app, "张三");
    const res = await app.request(`/api/v1/entity/character/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { deleted: true, cascaded: { relations: 0, deltas: 0 } },
    });
  });

  it("不存在 → 404；重复删除（已软删）→ 404（幂等语义：无副作用）", async () => {
    openProject();
    const app = buildApp();
    const { id } = await createCharacter(app, "张三");
    await app.request(`/api/v1/entity/character/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    const again = await app.request(`/api/v1/entity/character/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(again.status).toBe(404);
  });
});
