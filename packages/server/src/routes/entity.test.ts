// 实体路由测试（S3.3）：列表/创建/详情/更新/软删 + 契约校验 + event 时间轴（C2，决策 26）
// 覆盖：type 过滤与摘要（camelCase）、分页/排序、软删过滤（决策 12）、创建 201 与按类型 data 校验、
//       部分更新（浅合并）、404 映射、级联计数、详情 relations 紧邻（S3.2 接入）、
//       event 泛型 CRUD（C2）+ move 端点 + occurs_in 关系链路（决策 26）
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
import { outlineRoutes } from "./outline.js";
import { relationRoutes } from "./relation.js";
import { trashRoutes } from "./trash.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "entity-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（entity + outline + relation + trash 路由，C2 关系链路与回收站还原用） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/entity", entityRoutes);
  app.route("/api/v1/outline", outlineRoutes);
  app.route("/api/v1/relation", relationRoutes);
  app.route("/api/v1/trash", trashRoutes);
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

  it("标签筛选 tag（决策 31 K2）：统一 data.tags 包含匹配（setting 与 event 同语义）；无匹配 → 空", async () => {
    openProject();
    const app = buildApp();
    // setting：rules 标签
    await app.request(
      "/api/v1/entity/setting",
      jsonRequest("POST", "", { name: "青云门", data: { tags: ["势力", "宗门"] } }),
    );
    await app.request(
      "/api/v1/entity/setting",
      jsonRequest("POST", "", { name: "藏剑阁", data: { tags: ["势力"] } }),
    );
    await app.request(
      "/api/v1/entity/setting",
      jsonRequest("POST", "", { name: "天地法则", data: { tags: ["法则"] } }),
    );
    const hit = await app.request("/api/v1/entity/setting?tag=宗门", { headers: HOST_HEADERS });
    const hitBody = (await hit.json()) as { data: { items: Array<{ name: string }>; total: number } };
    expect(hitBody.data.total).toBe(1);
    expect(hitBody.data.items[0].name).toBe("青云门");
    const multi = await app.request("/api/v1/entity/setting?tag=势力", { headers: HOST_HEADERS });
    const multiBody = (await multi.json()) as { data: { total: number } };
    expect(multiBody.data.total).toBe(2);
    const none = await app.request("/api/v1/entity/setting?tag=不存在", { headers: HOST_HEADERS });
    expect(((await none.json()) as { data: { total: number } }).data.total).toBe(0);
    // 无 tags 字段的类型：tag 筛选不命中（防御——非数组视为不匹配）
    await createCharacter(app, "张三");
    const charNone = await app.request("/api/v1/entity/character?tag=势力", { headers: HOST_HEADERS });
    expect(((await charNone.json()) as { data: { total: number } }).data.total).toBe(0);
    // 摘要：setting 暴露 tags（决策 31：rules 前 3 个）
    const all = await app.request("/api/v1/entity/setting", { headers: HOST_HEADERS });
    const allBody = (await all.json()) as { data: { items: Array<{ summary: Record<string, unknown> }> } };
    const qingyun = allBody.data.items.find((i) => (i.summary.tags as string[]).includes("宗门"))!;
    expect(qingyun.summary.tags).toEqual(["势力", "宗门"]);
  });

  it("M2（批次六）：setting 列表附加上级设定（parentId/parentName，belongs_to 映射）与描述摘要（截断 100 字符）", async () => {
    openProject();
    const app = buildApp();
    const parentRes = await app.request(
      "/api/v1/entity/setting",
      jsonRequest("POST", "", { name: "修真界", data: { description: "修仙世界总纲，包含灵气、境界、宗门三大体系。" } }),
    );
    const parentId = ((await parentRes.json()) as { data: { id: string } }).data.id;
    const childRes = await app.request(
      "/api/v1/entity/setting",
      jsonRequest("POST", "", { name: "青云门", data: { description: "青云门是修真界第一宗门。" } }),
    );
    const childId = ((await childRes.json()) as { data: { id: string } }).data.id;
    // 建 belongs_to 层级边（child → parent）
    const project = getCurrentProject()!;
    createRelation(
      project.db,
      { sourceType: "setting", sourceId: childId, targetType: "setting", targetId: parentId, relationType: "belongs_to" },
      project.root,
    );
    const res = await app.request("/api/v1/entity/setting", { headers: HOST_HEADERS });
    const body = (await res.json()) as {
      data: {
        items: Array<{
          id: string;
          name: string;
          parentId?: string;
          parentName?: string;
          summary: Record<string, unknown>;
        }>;
      };
    };
    // 子设定：parent 字段填充 + 描述摘要
    const childItem = body.data.items.find((i) => i.id === childId)!;
    expect(childItem.parentId).toBe(parentId);
    expect(childItem.parentName).toBe("修真界");
    expect(childItem.summary.description).toBe("青云门是修真界第一宗门。");
    // 无父的设定：parent 字段不出现（稀疏语义）
    const parentItem = body.data.items.find((i) => i.id === parentId)!;
    expect(parentItem.parentId).toBeUndefined();
    expect(parentItem.parentName).toBeUndefined();
    // 超长描述截断 100 字符（防 AI 工具上下文膨胀）
    await app.request(
      "/api/v1/entity/setting",
      jsonRequest("POST", "", { name: "藏剑阁", data: { description: "玄".repeat(150) } }),
    );
    const res2 = await app.request("/api/v1/entity/setting", { headers: HOST_HEADERS });
    const body2 = (await res2.json()) as {
      data: { items: Array<{ name: string; summary: Record<string, unknown> }> };
    };
    const longItem = body2.data.items.find((i) => i.name === "藏剑阁")!;
    expect(longItem.summary.description).toBe("玄".repeat(100));
    // 非 setting 类型不带 parent 字段（契约：仅 setting）
    await createCharacter(app, "张三");
    const charRes = await app.request("/api/v1/entity/character", { headers: HOST_HEADERS });
    const charBody = (await charRes.json()) as { data: { items: Array<{ parentId?: string }> } };
    expect(charBody.data.items[0].parentId).toBeUndefined();
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

// ============ 时间轴事件（C2，决策 26）：泛型 CRUD + move 端点 + occurs_in 关系链路 ============

describe("event 时间轴（C2，决策 26）", () => {
  /** 创建事件辅助（201 断言，ev- 前缀由 db 层生成） */
  async function createEvent(app: Hono, name: string, data?: Record<string, unknown>): Promise<{ id: string }> {
    const res = await app.request(`/api/v1/entity/event`, jsonRequest("POST", "", { name, ...(data ? { data } : {}) }));
    expect(res.status).toBe(201);
    return (await res.json()).data as { id: string };
  }

  /** 事件列表 id 序（恒按 sort_order 升序——服务端契约） */
  async function eventIds(app: Hono): Promise<string[]> {
    const res = await app.request("/api/v1/entity/event", { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { items: Array<{ id: string }> } };
    return body.data.items.map((i) => i.id);
  }

  it("泛型 CRUD：创建（data 精校验）→ 列表（summary 三字段）→ 详情 → 更新 → 软删 → 回收站还原", async () => {
    openProject();
    const app = buildApp();
    // 创建：合法 data 通过（eventDataSchema：description/tags + passthrough）
    const { id } = await createEvent(app, "藏经阁发现玉佩", {
      description: "张三在藏经阁发现玉佩",
      tags: ["主线", "伏笔"],
    });
    expect(id).toMatch(/^ev-/);
    // 非法 data → 400（tags 非数组，eventDataSchema 拒绝）
    const bad = await app.request(
      "/api/v1/entity/event",
      jsonRequest("POST", "", { name: "坏事件", data: { tags: "主线" } }),
    );
    expect(bad.status).toBe(400);
    // 列表：summary 含两字段（C1 契约，endpoints.md L269）
    const listRes = await app.request("/api/v1/entity/event", { headers: HOST_HEADERS });
    const listBody = (await listRes.json()) as { data: { items: Array<Record<string, unknown>>; total: number } };
    expect(listBody.data.total).toBe(1);
    expect(listBody.data.items[0].summary).toEqual({
      description: "张三在藏经阁发现玉佩",
      tags: ["主线", "伏笔"],
    });
    // 详情：data 完整 + deltaCount 0 + relations 空
    const detailRes = await app.request(`/api/v1/entity/event/${id}`, { headers: HOST_HEADERS });
    const detailBody = (await detailRes.json()) as { data: Record<string, unknown> };
    expect(detailBody.data).toMatchObject({ id, type: "event", name: "藏经阁发现玉佩", deltaCount: 0 });
    expect((detailBody.data.data as Record<string, unknown>).description).toBe("张三在藏经阁发现玉佩");
    expect(detailBody.data.relations).toEqual([]);
    // 更新：data 浅合并（未传字段保留）
    const upd = await app.request(
      `/api/v1/entity/event/${id}`,
      jsonRequest("PUT", "", { data: { description: "玉佩被夺" } }),
    );
    expect(upd.status).toBe(200);
    const detail2 = await app.request(`/api/v1/entity/event/${id}`, { headers: HOST_HEADERS });
    const body2 = (await detail2.json()) as { data: { data: Record<string, unknown> } };
    expect(body2.data.data).toEqual({ description: "玉佩被夺", tags: ["主线", "伏笔"] });
    // 软删 → 列表不可见（决策 12）
    const del = await app.request(`/api/v1/entity/event/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(del.status).toBe(200);
    expect(await eventIds(app)).toEqual([]);
    // 回收站列表含 event → 还原 → 列表恢复
    const trash = await app.request("/api/v1/trash", { headers: HOST_HEADERS });
    const trashBody = (await trash.json()) as { data: { entities: Array<{ id: string; type: string }> } };
    expect(trashBody.data.entities.some((e) => e.id === id && e.type === "event")).toBe(true);
    const restore = await app.request(`/api/v1/trash/entity/event/${id}/restore`, { method: "POST", headers: HOST_HEADERS });
    expect(restore.status).toBe(200);
    expect(await eventIds(app)).toEqual([id]);
  });

  it("move：正常重排（全局线性序）——移动后列表按新序，sort/order 参数不参与事件排序", async () => {
    openProject();
    const app = buildApp();
    const e0 = (await createEvent(app, "事件0")).id;
    const e2 = (await createEvent(app, "事件2")).id;
    // 初始：全部 sort_order NULL → 沉底按 id 序（创建序不可控，先取当前序）
    const initial = await eventIds(app);
    expect(initial).toHaveLength(2);
    // 把 e2 移到 0 → 列表首位 e2，其余相对序保持（db 层 splice 语义）
    const mv = await app.request(`/api/v1/entity/event/${e2}/move`, jsonRequest("PUT", "", { order: 0 }));
    expect(mv.status).toBe(200);
    expect((await mv.json()) as { data: { moved: boolean } }).toMatchObject({ data: { moved: true } });
    expect(await eventIds(app)).toEqual([e2, ...initial.filter((i) => i !== e2)]);
    // 显式传 sort=created_at&order=desc → 仍按 sort_order 升序（endpoints.md 契约）
    const desc = await app.request("/api/v1/entity/event?sort=created_at&order=desc", { headers: HOST_HEADERS });
    const descBody = (await desc.json()) as { data: { items: Array<{ id: string }> } };
    expect(descBody.data.items.map((i) => i.id)).toEqual([e2, ...initial.filter((i) => i !== e2)]);
    // 再把 e0 移到末尾（order 2）→ 末尾 e0
    await app.request(`/api/v1/entity/event/${e0}/move`, jsonRequest("PUT", "", { order: 2 }));
    const after = await eventIds(app);
    expect(after[after.length - 1]).toBe(e0);
  });

  it("move：clamp 超大→末尾；负数被 schema 拒绝（z.min(0)，db 层 clamp 负数由 C1 测试覆盖）", async () => {
    openProject();
    const app = buildApp();
    const e0 = (await createEvent(app, "事件0")).id;
    const e2 = (await createEvent(app, "事件2")).id;
    // 超大 → clamp 末尾（endpoints.md 契约）
    await app.request(`/api/v1/entity/event/${e2}/move`, jsonRequest("PUT", "", { order: 999 }));
    const ids = await eventIds(app);
    expect(ids[ids.length - 1]).toBe(e2);
    // 负数 → 400（entityMoveReqSchema z.number().int().min(0)；「负数→0」为 db 层 moveEvent 防御语义）
    const neg = await app.request(`/api/v1/entity/event/${e0}/move`, jsonRequest("PUT", "", { order: -1 }));
    expect(neg.status).toBe(400);
    expect(((await neg.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    // body 校验：缺 order → 400；未知键 → 400（.strict()）
    expect((await app.request(`/api/v1/entity/event/${e0}/move`, jsonRequest("PUT", "", {}))).status).toBe(400);
    expect((await app.request(`/api/v1/entity/event/${e0}/move`, jsonRequest("PUT", "", { order: 0, extra: 1 }))).status).toBe(400);
  });

  it("move：404（不存在 id / 已软删 id）；端点仅 event——非 event 类型路径 404", async () => {
    openProject();
    const app = buildApp();
    expect(
      (await app.request("/api/v1/entity/event/ev-nope/move", jsonRequest("PUT", "", { order: 0 }))).status,
    ).toBe(404);
    // 已软删事件不可 move（moveEvent 过滤软删 → null → 404）
    const { id } = await createEvent(app, "将删事件");
    await app.request(`/api/v1/entity/event/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(
      (await app.request(`/api/v1/entity/event/${id}/move`, jsonRequest("PUT", "", { order: 0 }))).status,
    ).toBe(404);
    // 专端点仅 event：character 无 move 路径（其余实体类型无 sort_order 语义，endpoints.md L393）
    const { id: charId } = await createCharacter(app, "张三");
    expect(
      (await app.request(`/api/v1/entity/character/${charId}/move`, jsonRequest("PUT", "", { order: 0 }))).status,
    ).toBe(404);
  });

  it("occurs_in 关系链路：event → outline_node 建立 → 软删 event 后不可见 → 还原恢复（决策 12 修订）", async () => {
    openProject();
    const app = buildApp();
    const { id: evId } = await createEvent(app, "玉佩事件");
    // 建大纲节点（chapter 直挂 root，决策 19）
    const nodeRes = await app.request(
      "/api/v1/outline",
      jsonRequest("POST", "", { type: "chapter", title: "第一章", parent_id: "root" }),
    );
    expect(nodeRes.status).toBe(201);
    const nodeId = ((await nodeRes.json()) as { data: { id: string } }).data.id;
    // 建立 occurs_in（event → 大纲节点，决策 26；relation 白名单 C1 已含 event）
    const relRes = await app.request("/api/v1/relation", jsonRequest("POST", "", {
      source_type: "event",
      source_id: evId,
      target_type: "outline_node",
      target_id: nodeId,
      relation_type: "occurs_in",
    }));
    expect(relRes.status).toBe(201);
    // 关系可见（source 方向查询，name 联表）
    const q1 = await app.request(`/api/v1/relation?source_id=${evId}&depth=1`, { headers: HOST_HEADERS });
    const q1Body = (await q1.json()) as { data: { relations: Array<Record<string, unknown>> } };
    expect(q1Body.data.relations).toHaveLength(1);
    expect(q1Body.data.relations[0]).toMatchObject({
      sourceId: evId,
      targetId: nodeId,
      relationType: "occurs_in",
      sourceName: "玉佩事件",
    });
    // 软删 event → 关系不可见（任一端点软删即不可见）
    await app.request(`/api/v1/entity/event/${evId}`, { method: "DELETE", headers: HOST_HEADERS });
    const q2 = await app.request(`/api/v1/relation?source_id=${evId}&depth=1`, { headers: HOST_HEADERS });
    expect(((await q2.json()) as { data: { relations: unknown[] } }).data.relations).toEqual([]);
    // 还原 event → 关系恢复可见（级联还原）
    await app.request(`/api/v1/trash/entity/event/${evId}/restore`, { method: "POST", headers: HOST_HEADERS });
    const q3 = await app.request(`/api/v1/relation?source_id=${evId}&depth=1`, { headers: HOST_HEADERS });
    expect(((await q3.json()) as { data: { relations: unknown[] } }).data.relations).toHaveLength(1);
  });
});

// ============ 时间轴时间点（G2，决策 26 修订）：move 端点 + move_to 复合端点 ============

describe("timepoint 时间轴（G2，决策 26 修订）", () => {
  /** 创建事件辅助（201 断言，ev- 前缀由 db 层生成；本 describe 独立定义——G2.3 前事件与时间点并列测试） */
  async function createEvent(app: Hono, name: string): Promise<{ id: string }> {
    const res = await app.request(`/api/v1/entity/event`, jsonRequest("POST", "", { name }));
    expect(res.status).toBe(201);
    return (await res.json()).data as { id: string };
  }

  /** 创建时间点辅助（201 断言，tp- 前缀由 db 层生成） */
  async function createTimepoint(app: Hono, name: string): Promise<{ id: string }> {
    const res = await app.request(`/api/v1/entity/timepoint`, jsonRequest("POST", "", { name }));
    expect(res.status).toBe(201);
    return (await res.json()).data as { id: string };
  }

  /** 时间点列表 id 序（恒按 sort_order 升序——服务端契约，endpoints.md L427-428） */
  async function timepointIds(app: Hono): Promise<string[]> {
    const res = await app.request("/api/v1/entity/timepoint", { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { items: Array<{ id: string }> } };
    return body.data.items.map((i) => i.id);
  }

  /** 事件当前 occurs_at 挂载（target 方向查询，返回挂载关系数组；空 = 未挂载） */
  async function occursAtOf(app: Hono, eventId: string): Promise<Array<Record<string, unknown>>> {
    const res = await app.request(`/api/v1/relation?target_id=${eventId}&relation_type=occurs_at&depth=1`, {
      headers: HOST_HEADERS,
    });
    const body = (await res.json()) as { data: { relations: Array<Record<string, unknown>> } };
    return body.data.relations;
  }

  it("timepoint move：正常重排（全局线性序）——移动后列表按新序，拖拽时间点不改其下事件序（双独立线性序）", async () => {
    openProject();
    const app = buildApp();
    const tp0 = (await createTimepoint(app, "拂晓")).id;
    const tp2 = (await createTimepoint(app, "黄昏")).id;
    const initial = await timepointIds(app);
    expect(initial).toHaveLength(2);
    // 把 tp2 移到 0 → 列表首位 tp2，其余相对序保持（db 层 splice 语义）
    const mv = await app.request(`/api/v1/entity/timepoint/${tp2}/move`, jsonRequest("PUT", "", { order: 0 }));
    expect(mv.status).toBe(200);
    expect((await mv.json()) as { data: { moved: boolean } }).toMatchObject({ data: { moved: true } });
    expect(await timepointIds(app)).toEqual([tp2, tp0]);
    // 显式传 sort=created_at&order=desc → 仍按 sort_order 升序（endpoints.md 契约）
    const desc = await app.request("/api/v1/entity/timepoint?sort=created_at&order=desc", { headers: HOST_HEADERS });
    const descBody = (await desc.json()) as { data: { items: Array<{ id: string }> } };
    expect(descBody.data.items.map((i) => i.id)).toEqual([tp2, tp0]);
  });

  it("timepoint move：clamp 超大→末尾；负数/缺 order/未知键 → 400；404（不存在/已软删）；专端点仅 timepoint", async () => {
    openProject();
    const app = buildApp();
    const tp0 = (await createTimepoint(app, "拂晓")).id;
    const tp2 = (await createTimepoint(app, "黄昏")).id;
    // 超大 → clamp 末尾（endpoints.md 契约）
    await app.request(`/api/v1/entity/timepoint/${tp2}/move`, jsonRequest("PUT", "", { order: 999 }));
    const ids = await timepointIds(app);
    expect(ids[ids.length - 1]).toBe(tp2);
    // 负数 → 400（entityMoveReqSchema z.number().int().min(0)；「负数→0」为 db 层 moveTimepoint 防御语义）
    const neg = await app.request(`/api/v1/entity/timepoint/${tp0}/move`, jsonRequest("PUT", "", { order: -1 }));
    expect(neg.status).toBe(400);
    expect(((await neg.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    // body 校验：缺 order → 400；未知键 → 400（.strict()）
    expect((await app.request(`/api/v1/entity/timepoint/${tp0}/move`, jsonRequest("PUT", "", {}))).status).toBe(400);
    expect(
      (await app.request(`/api/v1/entity/timepoint/${tp0}/move`, jsonRequest("PUT", "", { order: 0, extra: 1 }))).status,
    ).toBe(400);
    // 404：不存在 id / 已软删 id（moveTimepoint 过滤软删 → null → 404）
    expect((await app.request("/api/v1/entity/timepoint/tp-nope/move", jsonRequest("PUT", "", { order: 0 }))).status).toBe(404);
    const { id } = await createTimepoint(app, "将删时间点");
    await app.request(`/api/v1/entity/timepoint/${id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect((await app.request(`/api/v1/entity/timepoint/${id}/move`, jsonRequest("PUT", "", { order: 0 }))).status).toBe(404);
    // 专端点仅 timepoint：character 无 move 路径（其余实体类型无 sort_order 语义）
    const { id: charId } = await createCharacter(app, "张三");
    expect(
      (await app.request(`/api/v1/entity/character/${charId}/move`, jsonRequest("PUT", "", { order: 0 }))).status,
    ).toBe(404);
  });

  it("move_to：跨组挂载 + 重排一次提交——旧挂载移除、新挂载建立、事件全局序重排", async () => {
    openProject();
    const app = buildApp();
    const tp0 = (await createTimepoint(app, "拂晓")).id;
    const tp1 = (await createTimepoint(app, "黄昏")).id;
    const e0 = (await createEvent(app, "事件0")).id;
    const e1 = (await createEvent(app, "事件1")).id;
    // 先挂载 e0 → tp0（occurs_at 建关系，201）
    const mount = await app.request("/api/v1/relation", jsonRequest("POST", "", {
      source_type: "timepoint",
      source_id: tp0,
      target_type: "event",
      target_id: e0,
      relation_type: "occurs_at",
    }));
    expect(mount.status).toBe(201);
    const oldRelId = ((await mount.json()) as { data: { id: string } }).data.id;
    // move_to：e0 改挂 tp1 + 移到全局序第 1 位（拖到另一时间点区块，G2 跨组拖拽语义）
    const mv = await app.request(`/api/v1/entity/event/${e0}/move_to`, jsonRequest("POST", "", { timepoint_id: tp1, order: 1 }));
    expect(mv.status).toBe(200);
    expect((await mv.json()) as { data: { moved: boolean } }).toMatchObject({ data: { moved: true } });
    // 挂载已改：occurs_at 只剩一条、指向 tp1、新关系 id（旧关系物理删）
    const rels = await occursAtOf(app, e0);
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ sourceId: tp1, relationType: "occurs_at" });
    expect(rels[0].id).not.toBe(oldRelId);
    // 事件全局序已重排：e0 在第 1 位（事件排序语义经列表端点验证）
    const evRes = await app.request("/api/v1/entity/event", { headers: HOST_HEADERS });
    const evBody = (await evRes.json()) as { data: { items: Array<{ id: string }> } };
    expect(evBody.data.items.map((i) => i.id)).toEqual([e1, e0]);
  });

  it("move_to：同 timepoint 幂等——挂载关系保留（id 不变），仅重排", async () => {
    openProject();
    const app = buildApp();
    const tp0 = (await createTimepoint(app, "拂晓")).id;
    const e0 = (await createEvent(app, "事件0")).id;
    const mount = await app.request("/api/v1/relation", jsonRequest("POST", "", {
      source_type: "timepoint",
      source_id: tp0,
      target_type: "event",
      target_id: e0,
      relation_type: "occurs_at",
    }));
    const relId = ((await mount.json()) as { data: { id: string } }).data.id;
    // move_to 目标 = 当前挂载 → 幂等跳过重建挂载（只重排，关系 id 不变）
    const mv = await app.request(`/api/v1/entity/event/${e0}/move_to`, jsonRequest("POST", "", { timepoint_id: tp0, order: 0 }));
    expect(mv.status).toBe(200);
    const rels = await occursAtOf(app, e0);
    expect(rels).toHaveLength(1);
    expect(rels[0].id).toBe(relId); // 关系未被删除重建
    expect(rels[0].sourceId).toBe(tp0);
  });

  it("move_to：timepoint_id=null 移到未挂载区——旧挂载移除、仅重排（入未挂载兜底区，endpoints.md 关系节）", async () => {
    openProject();
    const app = buildApp();
    const tp0 = (await createTimepoint(app, "拂晓")).id;
    const e0 = (await createEvent(app, "事件0")).id;
    await app.request("/api/v1/relation", jsonRequest("POST", "", {
      source_type: "timepoint",
      source_id: tp0,
      target_type: "event",
      target_id: e0,
      relation_type: "occurs_at",
    }));
    expect(await occursAtOf(app, e0)).toHaveLength(1);
    // null → 移出挂载（occurs_at 物理删），事件仍重排
    const mv = await app.request(`/api/v1/entity/event/${e0}/move_to`, jsonRequest("POST", "", { timepoint_id: null, order: 0 }));
    expect(mv.status).toBe(200);
    expect(await occursAtOf(app, e0)).toEqual([]); // 未挂载
    const evRes = await app.request("/api/v1/entity/event", { headers: HOST_HEADERS });
    const evBody = (await evRes.json()) as { data: { items: Array<{ id: string }> } };
    expect(evBody.data.items[0].id).toBe(e0);
  });

  it("move_to：404（事件不存在/已软删）；400（timepoint 不存在/已软删，事务回滚旧挂载不丢）", async () => {
    openProject();
    const app = buildApp();
    const tp0 = (await createTimepoint(app, "拂晓")).id;
    const e0 = (await createEvent(app, "事件0")).id;
    await app.request("/api/v1/relation", jsonRequest("POST", "", {
      source_type: "timepoint",
      source_id: tp0,
      target_type: "event",
      target_id: e0,
      relation_type: "occurs_at",
    }));
    // 404：事件不存在
    expect(
      (await app.request("/api/v1/entity/event/ev-nope/move_to", jsonRequest("POST", "", { timepoint_id: tp0, order: 0 }))).status,
    ).toBe(404);
    // 404：事件已软删
    await app.request(`/api/v1/entity/event/${e0}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(
      (await app.request(`/api/v1/entity/event/${e0}/move_to`, jsonRequest("POST", "", { timepoint_id: tp0, order: 0 }))).status,
    ).toBe(404);
    // 还原事件后继续测 400
    await app.request(`/api/v1/trash/entity/event/${e0}/restore`, { method: "POST", headers: HOST_HEADERS });
    // 400：timepoint 不存在（ENDPOINT_NOT_FOUND → VALIDATION_ERROR）——事务回滚，旧挂载不丢
    const bad = await app.request(`/api/v1/entity/event/${e0}/move_to`, jsonRequest("POST", "", { timepoint_id: "tp-999", order: 0 }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    // 事务回滚验证：旧挂载 tp0 仍保留（未因「先删后建失败」丢半状态）
    const rels = await occursAtOf(app, e0);
    expect(rels).toHaveLength(1);
    expect(rels[0].sourceId).toBe(tp0);
    // 400：timepoint 已软删（getEntity 过滤 → ENDPOINT_NOT_FOUND）
    const tp1 = (await createTimepoint(app, "黄昏")).id;
    await app.request(`/api/v1/entity/timepoint/${tp1}`, { method: "DELETE", headers: HOST_HEADERS });
    const soft = await app.request(`/api/v1/entity/event/${e0}/move_to`, jsonRequest("POST", "", { timepoint_id: tp1, order: 0 }));
    expect(soft.status).toBe(400);
    expect(await occursAtOf(app, e0)).toHaveLength(1); // 旧挂载仍保留
    // body 校验：缺 timepoint_id → 400；负数 order → 400（.strict()/z.min(0)）
    expect(
      (await app.request(`/api/v1/entity/event/${e0}/move_to`, jsonRequest("POST", "", { order: 0 }))).status,
    ).toBe(400);
    expect(
      (await app.request(`/api/v1/entity/event/${e0}/move_to`, jsonRequest("POST", "", { timepoint_id: tp0, order: -1 }))).status,
    ).toBe(400);
  });
});
