// 名称解析路由测试（14.1，决策 47）：POST /api/v1/names/resolve
// 覆盖：实体 id（character/timepoint/reference 前缀分流 + 类型中文 label）、大纲节点 id（vol/ch/sc）、
//       软删实体 → null、未知 id / rel- → null、空数组 → 空对象、重复 id 去重、超过 50 个 → 400、
//       无项目 → 409 NO_PROJECT_OPEN
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.js";
import {
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { namesRoutes } from "./names.js";
import { entityRoutes } from "./entity.js";
import { outlineRoutes } from "./outline.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "names-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（names + entity + outline 路由） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/names", namesRoutes);
  app.route("/api/v1/entity", entityRoutes);
  app.route("/api/v1/outline", outlineRoutes);
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

/** POST /names/resolve 请求辅助（返回响应体 data） */
async function resolveIds(app: Hono, ids: string[]): Promise<{ names: Record<string, { label: string; name: string } | null> }> {
  const res = await app.request("/api/v1/names/resolve", jsonRequest("POST", "", { ids }));
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.data as { names: Record<string, { label: string; name: string } | null> };
}

/** 创建实体辅助（返回 id） */
async function createEntity(app: Hono, type: string, name: string, data?: Record<string, unknown>): Promise<string> {
  const res = await app.request(`/api/v1/entity/${type}`, jsonRequest("POST", "", { name, ...(data !== undefined ? { data } : {}) }));
  expect(res.status).toBe(201);
  return ((await res.json()).data as { id: string }).id;
}

/** 创建大纲节点辅助（返回 id；parentId 支持 "root"） */
async function createOutline(app: Hono, type: "volume" | "chapter" | "scene", title: string, parentId: string): Promise<string> {
  const res = await app.request("/api/v1/outline", jsonRequest("POST", "", { type, title, parent_id: parentId }));
  expect(res.status).toBe(201);
  return ((await res.json()).data as { id: string }).id;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-names-"));
  setCurrentProject(null); // 隔离单例（无项目用例依赖空单例）
});

afterEach(() => {
  setCurrentProject(null); // 清理单例，防用例间串扰（无项目用例依赖）
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  tmpDirs.length = 0;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/v1/names/resolve", () => {
  it("实体 id 前缀分流：character → label「人物」+ name；timepoint → 「时间点」；reference link → 「参考资料」", async () => {
    openProject();
    const app = buildApp();
    const charId = await createEntity(app, "character", "张三");
    const tpId = await createEntity(app, "timepoint", "三年后");
    const refId = await createEntity(app, "reference", "写作理论", { url: "https://example.com/theory" });
    const { names } = await resolveIds(app, [charId, tpId, refId]);
    expect(names[charId]).toEqual({ label: "人物", name: "张三" });
    expect(names[tpId]).toEqual({ label: "时间点", name: "三年后" });
    expect(names[refId]).toEqual({ label: "参考资料", name: "写作理论" });
  });

  it("大纲节点 id 前缀分流：场景 → label「场景」+ 标题（卷→章→场景创建后解析）", async () => {
    openProject();
    const app = buildApp();
    const volId = await createOutline(app, "volume", "第一卷", "root");
    const chId = await createOutline(app, "chapter", "第一章", volId);
    const scId = await createOutline(app, "scene", "场景一", chId);
    const { names } = await resolveIds(app, [volId, chId, scId]);
    expect(names[volId]).toEqual({ label: "卷", name: "第一卷" });
    expect(names[chId]).toEqual({ label: "章", name: "第一章" });
    expect(names[scId]).toEqual({ label: "场景", name: "场景一" });
  });

  it("软删实体 → null（getEntity 过滤 deleted_at IS NOT NULL）", async () => {
    openProject();
    const app = buildApp();
    const id = await createEntity(app, "character", "将被删除");
    const del = await app.request(`/api/v1/entity/character/${id}`, jsonRequest("DELETE", ""));
    expect(del.status).toBe(200);
    const { names } = await resolveIds(app, [id]);
    expect(names[id]).toBeNull();
  });

  it("软删大纲节点 → null（findOutlineNode 读侧不过滤，deleted: true 视为不存在）", async () => {
    openProject();
    const app = buildApp();
    const volId = await createOutline(app, "volume", "待删卷", "root");
    const del = await app.request(`/api/v1/outline/${volId}`, jsonRequest("DELETE", ""));
    expect(del.status).toBe(200);
    const { names } = await resolveIds(app, [volId]);
    expect(names[volId]).toBeNull();
  });

  it("未知 id / rel- 前缀 / 运行时对象前缀 → null（关系无名称语义，决策 47）", async () => {
    openProject();
    const app = buildApp();
    const { names } = await resolveIds(app, ["rel-abc123", "prop_abc", "sess_abc", "call_abc", "proj-abc", "xxx-nope", "char-不存在的id"]);
    expect(names["rel-abc123"]).toBeNull();
    expect(names["prop_abc"]).toBeNull();
    expect(names["sess_abc"]).toBeNull();
    expect(names["call_abc"]).toBeNull();
    expect(names["proj-abc"]).toBeNull();
    expect(names["xxx-nope"]).toBeNull();
    expect(names["char-不存在的id"]).toBeNull();
  });

  it("空数组 → 空对象", async () => {
    openProject();
    const app = buildApp();
    const { names } = await resolveIds(app, []);
    expect(names).toEqual({});
  });

  it("重复 id → 去重（响应键唯一，解析一次）", async () => {
    openProject();
    const app = buildApp();
    const charId = await createEntity(app, "character", "李四");
    const { names } = await resolveIds(app, [charId, charId, charId]);
    expect(Object.keys(names)).toHaveLength(1);
    expect(names[charId]).toEqual({ label: "人物", name: "李四" });
  });

  it("超过 50 个 id → 400 VALIDATION_ERROR；非法 body（非数组/多余字段）→ 400", async () => {
    openProject();
    const app = buildApp();
    const tooMany = Array.from({ length: 51 }, (_, i) => `char-x${i}`);
    const res = await app.request("/api/v1/names/resolve", jsonRequest("POST", "", { ids: tooMany }));
    expect(res.status).toBe(400);
    const badShape = await app.request("/api/v1/names/resolve", jsonRequest("POST", "", { ids: "not-array" }));
    expect(badShape.status).toBe(400);
    const extra = await app.request("/api/v1/names/resolve", jsonRequest("POST", "", { ids: [], extra: 1 }));
    expect(extra.status).toBe(400);
  });

  it("无项目打开 → 409 NO_PROJECT_OPEN", async () => {
    // 不 openProject：单例为空 → requireCurrentProject 兜底 409
    const app = buildApp();
    const res = await app.request("/api/v1/names/resolve", jsonRequest("POST", "", { ids: ["char-x"] }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error?.code).toBe("NO_PROJECT_OPEN");
  });
});
