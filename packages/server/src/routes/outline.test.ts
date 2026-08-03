// 大纲路由测试（S2.2）：整树/创建/更新/移动/软删/路径 + 回收站（大纲侧）
// 覆盖：严格三层（决策 19）、软删过滤与级联计数（决策 12）、restore 祖先链 409、
//       purge 回收站语义拦截、with_metadata 联查
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { SCHEMA_VERSION } from "@ai-editor/db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { outlineRoutes } from "./outline.js";
import { trashRoutes } from "./trash.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const T0 = "2026-08-01T10:00:00Z";

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "outline-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（outline + trash 路由） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/outline", outlineRoutes);
  app.route("/api/v1/trash", trashRoutes);
  return app;
}

/** 构造并打开一个正常项目（initProject：三文件 + user_version），注入 currentProject 单例 */
async function openProject(): Promise<string> {
  const dir = makeTmpDir();
  setCurrentProject(initProject(dir));
  return dir;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-outline-"));
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

// ============ POST /api/v1/outline ============

describe("POST /outline 创建（严格三层，决策 19）", () => {
  it("三层合法创建：volume 挂 root → chapter 挂 volume → scene 挂 chapter，201 + 字段正确", async () => {
    const app = buildApp();
    await openProject();

    const volRes = await app.request("/api/v1/outline", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ type: "volume", title: "第一卷", parent_id: "root" }),
    });
    expect(volRes.status).toBe(201);
    const vol = (await volRes.json()).data;
    expect(vol.id).toMatch(/^vol-/);
    expect(vol.parentId).toBe("root");

    const chRes = await app.request("/api/v1/outline", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ type: "chapter", title: "第一章", parent_id: vol.id }),
    });
    expect(chRes.status).toBe(201);
    const ch = (await chRes.json()).data;
    expect(ch.id).toMatch(/^ch-/);

    const scRes = await app.request("/api/v1/outline", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ type: "scene", title: "场景一", parent_id: ch.id, summary: "描述" }),
    });
    expect(scRes.status).toBe(201);
    expect((await scRes.json()).data.id).toMatch(/^sc-/);
  });

  it("scene 挂 volume → 400 VALIDATION_ERROR（严格三层）", async () => {
    const app = buildApp();
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ type: "volume", title: "卷", parent_id: "root" }),
    })).json()).data;

    const res = await app.request("/api/v1/outline", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ type: "scene", title: "x", parent_id: vol.id }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("父节点不存在 → 400 OUTLINE_NODE_NOT_FOUND；缺 parent_id → 400 VALIDATION_ERROR（schema 层）", async () => {
    const app = buildApp();
    await openProject();
    const res1 = await app.request("/api/v1/outline", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ type: "volume", title: "x", parent_id: "vol-999" }),
    });
    expect(res1.status).toBe(400);
    expect((await res1.json()).error.code).toBe("OUTLINE_NODE_NOT_FOUND");

    const res2 = await app.request("/api/v1/outline", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ type: "volume", title: "x" }),
    });
    expect(res2.status).toBe(400);
    expect((await res2.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

// ============ GET /api/v1/outline ============

describe("GET /outline 整树", () => {
  /** 建 卷[章[场景]] 结构，返回各节点 id */
  async function seedTree(app: Hono): Promise<{ vol: string; ch: string; sc: string }> {
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "第一卷", parent_id: "root" }),
    })).json()).data;
    const ch = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "chapter", title: "第一章", parent_id: vol.id }),
    })).json()).data;
    const sc = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "scene", title: "场景一", parent_id: ch.id }),
    })).json()).data;
    return { vol: vol.id, ch: ch.id, sc: sc.id };
  }

  it("返回 camelCase 树（schemaVersion/updatedAt），严格三层结构", async () => {
    const app = buildApp();
    await seedTree(app);
    const res = await app.request("/api/v1/outline", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe("root");
    expect(body.data.schemaVersion).toBe(SCHEMA_VERSION);
    const vol = body.data.children[0];
    expect(vol.type).toBe("volume");
    expect(vol.updatedAt).toBeTruthy();
    expect(vol.children[0].type).toBe("chapter");
    expect(vol.children[0].children[0].type).toBe("scene");
  });

  it("软删节点默认过滤（决策 12）：卷软删后整棵子树不出现在常规查询", async () => {
    const app = buildApp();
    const { vol } = await seedTree(app);
    const delRes = await app.request(`/api/v1/outline/${vol}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(delRes.status).toBe(200);

    const res = await app.request("/api/v1/outline", { headers: HOST_HEADERS });
    expect((await res.json()).data.children).toEqual([]);
  });

  it("chapter 直挂 root 时整树 type 正确（决策 19；server 侧映射规避 shared 硬编码，冒烟发现）", async () => {
    const app = buildApp();
    await openProject();
    const ch = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "chapter", title: "直挂章", parent_id: "root" }),
    })).json()).data;
    await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "scene", title: "场景", parent_id: ch.id }),
    });

    const res = await app.request("/api/v1/outline", { headers: HOST_HEADERS });
    const body = await res.json();
    const rootChild = body.data.children[0];
    expect(rootChild.type).toBe("chapter"); // 直挂章不被误映射为 volume
    expect(rootChild.title).toBe("直挂章");
    expect(rootChild.children[0].type).toBe("scene");
  });

  it("with_metadata=true 联查统计：hookCount/charCount/deltaCount 数值返回（空库为 0）", async () => {
    const app = buildApp();
    const { vol } = await seedTree(app);
    // 造一条 delta（该节点触发）+ 一条 appears_in 关系（char → 节点）
    const project = getCurrentProject()!;
    project.db.prepare(
      "INSERT INTO delta_records (id, node_id, target_type, target_id, changes, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("delta-1", vol, "character", "char-1", "[]", "测试", T0, T0);
    project.db.prepare(
      "INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("rel-1", "character", "char-1", "outline_node", vol, "appears_in", T0, T0);

    const res = await app.request("/api/v1/outline?with_metadata=true", { headers: HOST_HEADERS });
    const body = await res.json();
    const volNode = body.data.children[0];
    expect(volNode.metadata).toEqual({ hookCount: 0, charCount: 1, deltaCount: 1 });
    // 默认不带 metadata
    const res2 = await app.request("/api/v1/outline", { headers: HOST_HEADERS });
    expect((await res2.json()).data.children[0].metadata).toBeUndefined();
  });
});

// ============ PUT /:nodeId、PUT move、GET path ============

describe("更新/移动/路径", () => {
  it("PUT 更新 title/summary → updated:true，GET 树反映新值", async () => {
    const app = buildApp();
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "旧名", parent_id: "root" }),
    })).json()).data;

    const res = await app.request(`/api/v1/outline/${vol.id}`, {
      method: "PUT",
      headers: HOST_HEADERS,
      body: JSON.stringify({ title: "新名", summary: "描述" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ updated: true });

    const tree = (await (await app.request("/api/v1/outline", { headers: HOST_HEADERS })).json()).data;
    expect(tree.children[0].title).toBe("新名");
  });

  it("PUT 更新不存在的节点 → 404 OUTLINE_NODE_NOT_FOUND", async () => {
    const app = buildApp();
    await openProject();
    const res = await app.request("/api/v1/outline/sc-999", {
      method: "PUT", headers: HOST_HEADERS, body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("OUTLINE_NODE_NOT_FOUND");
  });

  it("PUT move 跨父移动 → moved/previousParentId/newParentId；scene 移 volume → 400", async () => {
    const app = buildApp();
    await openProject();
    const v1 = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷一", parent_id: "root" }),
    })).json()).data;
    const v2 = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷二", parent_id: "root" }),
    })).json()).data;
    const ch = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "chapter", title: "章", parent_id: v1.id }),
    })).json()).data;

    const res = await app.request(`/api/v1/outline/${ch.id}/move`, {
      method: "PUT", headers: HOST_HEADERS, body: JSON.stringify({ parent_id: v2.id, order: 0 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ moved: true, previousParentId: v1.id, newParentId: v2.id });

    // scene 移 volume → 400
    const sc = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "scene", title: "场景", parent_id: ch.id }),
    })).json()).data;
    const bad = await app.request(`/api/v1/outline/${sc.id}/move`, {
      method: "PUT", headers: HOST_HEADERS, body: JSON.stringify({ parent_id: v1.id, order: 0 }),
    });
    expect(bad.status).toBe(400);
  });

  it("GET path 返回根 → 节点路径；节点不存在 → 404", async () => {
    const app = buildApp();
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷", parent_id: "root" }),
    })).json()).data;
    const ch = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "chapter", title: "章", parent_id: vol.id }),
    })).json()).data;

    const res = await app.request(`/api/v1/outline/${ch.id}/path`, { headers: HOST_HEADERS });
    expect((await res.json()).data).toEqual({ nodeId: ch.id, path: ["root", vol.id, ch.id] });

    const notFound = await app.request("/api/v1/outline/sc-999/path", { headers: HOST_HEADERS });
    expect(notFound.status).toBe(404);
  });
});

// ============ DELETE 软删 + 回收站 ============

describe("软删与回收站（决策 12）", () => {
  it("DELETE 软删：cascaded.children 计数；节点本体保留（回收站列表可见）", async () => {
    const app = buildApp();
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷", parent_id: "root" }),
    })).json()).data;
    const ch = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "chapter", title: "章", parent_id: vol.id }),
    })).json()).data;
    const sc = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "scene", title: "场景", parent_id: ch.id }),
    })).json()).data;

    const res = await app.request(`/api/v1/outline/${vol.id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      deleted: true,
      cascaded: { children: 2, relations: 0, deltas: 0 },
    });

    // 回收站列表：卷+章+场景 3 条（deletedAt camelCase）
    const trash = await app.request("/api/v1/trash", { headers: HOST_HEADERS });
    const nodes = (await trash.json()).data.nodes;
    expect(nodes.map((n: { id: string }) => n.id).sort()).toEqual([vol.id, ch.id, sc.id].sort());
    expect(nodes[0].deletedAt).toBeTruthy();
  });

  it("级联软删 relation/delta：delete 后计数反映实际更新行数", async () => {
    const app = buildApp();
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷", parent_id: "root" }),
    })).json()).data;
    const project = getCurrentProject()!;
    // 该节点相关的 1 条关系 + 1 条 delta
    project.db.prepare(
      "INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("rel-node", "outline_node", vol.id, "character", "char-1", "appears_in", T0, T0);
    project.db.prepare(
      "INSERT INTO delta_records (id, node_id, target_type, target_id, changes, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("delta-node", vol.id, "character", "char-1", "[]", "测试", T0, T0);

    const res = await app.request(`/api/v1/outline/${vol.id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect((await res.json()).data.cascaded).toEqual({ children: 0, relations: 1, deltas: 1 });
    // DB 中已标软删
    const rel = project.db.prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get("rel-node") as { deleted_at: string | null };
    expect(rel.deleted_at).toBeTruthy();
  });

  it("restore：级联还原子树 + 关联关系与 Delta；祖先软删 → 409 OUTLINE_ANCESTOR_DELETED", async () => {
    const app = buildApp();
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷", parent_id: "root" }),
    })).json()).data;
    const ch = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "chapter", title: "章", parent_id: vol.id }),
    })).json()).data;
    await app.request(`/api/v1/outline/${vol.id}`, { method: "DELETE", headers: HOST_HEADERS });

    // 子孙先还原 → 409（祖先仍软删）
    const early = await app.request(`/api/v1/trash/outline/${ch.id}/restore`, { method: "POST", headers: HOST_HEADERS });
    expect(early.status).toBe(409);
    expect((await early.json()).error.code).toBe("OUTLINE_ANCESTOR_DELETED");

    // 祖先还原 → 级联还原（restoredChildren 计数）
    const restoreRes = await app.request(`/api/v1/trash/outline/${vol.id}/restore`, { method: "POST", headers: HOST_HEADERS });
    expect(restoreRes.status).toBe(200);
    expect((await restoreRes.json()).data).toEqual({
      restored: true, restoredChildren: 1, restoredRelations: 0, restoredDeltas: 0,
    });
    // 常规查询恢复可见
    const tree = (await (await app.request("/api/v1/outline", { headers: HOST_HEADERS })).json()).data;
    expect(tree.children).toHaveLength(1);
  });

  it("purge：未软删节点 → 400 拦截（回收站语义）；软删后 purge → 物理清除 + 回收站空", async () => {
    const app = buildApp();
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷", parent_id: "root" }),
    })).json()).data;

    // 未软删直接 purge → 400
    const bad = await app.request(`/api/v1/trash/outline/${vol.id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("VALIDATION_ERROR");

    // 软删后 purge → 物理清除
    await app.request(`/api/v1/outline/${vol.id}`, { method: "DELETE", headers: HOST_HEADERS });
    const purgeRes = await app.request(`/api/v1/trash/outline/${vol.id}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(purgeRes.status).toBe(200);
    expect((await purgeRes.json()).data).toEqual({ purged: true });

    const trash = await app.request("/api/v1/trash", { headers: HOST_HEADERS });
    expect((await trash.json()).data.nodes).toEqual([]);
    const tree = (await (await app.request("/api/v1/outline", { headers: HOST_HEADERS })).json()).data;
    expect(tree.children).toEqual([]);
  });

  it("purge 不存在的节点 → 404", async () => {
    const app = buildApp();
    await openProject();
    const res = await app.request("/api/v1/trash/outline/sc-999", { method: "DELETE", headers: HOST_HEADERS });
    expect(res.status).toBe(404);
  });
});

// ============ 节点 data（决策 23，麦基字段集） ============

describe("节点 data（决策 23）", () => {
  /** 建 卷[章[场景]] 结构并给 scene 挂全字段 data，返回各节点 id */
  async function seedWithSceneData(
    app: Hono,
  ): Promise<{ vol: string; ch: string; sc: string }> {
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS,
      body: JSON.stringify({ type: "volume", title: "第一卷", parent_id: "root", data: { climax_scene: "sc-12", inciting_scene: "sc-3" } }),
    })).json()).data;
    const ch = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS,
      body: JSON.stringify({ type: "chapter", title: "第一章", parent_id: vol.id, data: { reversal: "张三决定叛出师门", climax_scene: "sc-5" } }),
    })).json()).data;
    const sc = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS,
      body: JSON.stringify({
        type: "scene", title: "灵根测试失败", parent_id: ch.id,
        data: { goal: "确认灵根品质", conflict_levels: ["inner", "personal"], value_from: "希望", value_to: "绝望" },
      }),
    })).json()).data;
    return { vol: vol.id, ch: ch.id, sc: sc.id };
  }

  it("POST 带 data 成功 201；GET 整树原样返回 data（决策 23 透传）", async () => {
    const app = buildApp();
    const { vol, ch, sc } = await seedWithSceneData(app);
    expect(vol).toMatch(/^vol-/);
    expect(ch).toMatch(/^ch-/);
    expect(sc).toMatch(/^sc-/);

    const res = await app.request("/api/v1/outline", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    const tree = body.data;
    expect(tree.children[0].data).toEqual({ climax_scene: "sc-12", inciting_scene: "sc-3" });
    expect(tree.children[0].children[0].data).toEqual({ reversal: "张三决定叛出师门", climax_scene: "sc-5" });
    expect(tree.children[0].children[0].children[0].data).toEqual({
      goal: "确认灵根品质",
      conflict_levels: ["inner", "personal"],
      value_from: "希望",
      value_to: "绝望",
    });
  });

  it("POST data 非法 → 400 VALIDATION_ERROR（scene conflict_levels 非法枚举；volume 引用字段非字符串）", async () => {
    const app = buildApp();
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷", parent_id: "root" }),
    })).json()).data;

    const badScene = await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS,
      body: JSON.stringify({ type: "scene", title: "x", parent_id: vol.id, data: { conflict_levels: ["social"] } }),
    });
    expect(badScene.status).toBe(400);
    expect((await badScene.json()).error.code).toBe("VALIDATION_ERROR");

    const badVol = await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS,
      body: JSON.stringify({ type: "volume", title: "卷2", parent_id: "root", data: { inciting_scene: 42 } }),
    });
    expect(badVol.status).toBe(400);
    expect((await badVol.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("PUT data 部分合并成功：GET 验证未传字段保留；data 变更刷新 updatedAt", async () => {
    const app = buildApp();
    const { vol } = await seedWithSceneData(app);

    const res = await app.request(`/api/v1/outline/${vol}`, {
      method: "PUT", headers: HOST_HEADERS,
      body: JSON.stringify({ data: { climax_scene: "sc-99" } }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ updated: true });

    const tree = (await (await app.request("/api/v1/outline", { headers: HOST_HEADERS })).json()).data;
    // 浅合并：climax_scene 替换、inciting_scene 保留（未传字段）
    expect(tree.children[0].data).toEqual({ climax_scene: "sc-99", inciting_scene: "sc-3" });
    // 未传 data 的更新不改动既有 data
    await app.request(`/api/v1/outline/${vol}`, {
      method: "PUT", headers: HOST_HEADERS, body: JSON.stringify({ title: "新名" }),
    });
    const after = (await (await app.request("/api/v1/outline", { headers: HOST_HEADERS })).json()).data;
    expect(after.children[0].data).toEqual({ climax_scene: "sc-99", inciting_scene: "sc-3" });
    expect(after.children[0].title).toBe("新名");
  });

  it("PUT { data: {} } 空对象 → 200：有 data 节点原字段保留（no-op）；原无 data 节点 GET 返回 data: {}（与 updateEntity 浅合并语义一致，有意为之）", async () => {
    const app = buildApp();
    const { vol } = await seedWithSceneData(app);

    // 有 data 节点：空对象浅合并 no-op（字段全保留）
    const res = await app.request(`/api/v1/outline/${vol}`, {
      method: "PUT", headers: HOST_HEADERS, body: JSON.stringify({ data: {} }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ updated: true });

    // 原无 data 节点：浅合并展开落盘 data: {}，GET 显式返回空对象（决策 23 透传）
    const ch = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS,
      body: JSON.stringify({ type: "chapter", title: "新章", parent_id: vol }),
    })).json()).data;
    const res2 = await app.request(`/api/v1/outline/${ch.id}`, {
      method: "PUT", headers: HOST_HEADERS, body: JSON.stringify({ data: {} }),
    });
    expect(res2.status).toBe(200);

    const tree = (await (await app.request("/api/v1/outline", { headers: HOST_HEADERS })).json()).data;
    expect(tree.children[0].data).toEqual({ climax_scene: "sc-12", inciting_scene: "sc-3" }); // 有 data 节点 no-op
    expect(tree.children[0].children[1].data).toEqual({}); // 原无 data 节点 → 空对象落盘并透传
  });

  it("GET 无 data 节点响应不含 data 键（省略而非输出 null/undefined）", async () => {
    const app = buildApp();
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷", parent_id: "root" }),
    })).json()).data;

    const res = await app.request("/api/v1/outline", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 显式断言：无 data 节点不输出 data 键（不依赖 JSON.stringify 省略 undefined 的隐式行为）
    expect("data" in body.data.children[0]).toBe(false);
  });

  it("PUT data 非法 → 400 VALIDATION_ERROR（按节点实际层级校验）；节点不存在 + data → 404", async () => {
    const app = buildApp();
    await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷", parent_id: "root" }),
    })).json()).data;

    // volume 节点传非法 data（inciting_scene 非字符串）→ 400（按节点实际层级 schema 校验）
    const bad2 = await app.request(`/api/v1/outline/${vol.id}`, {
      method: "PUT", headers: HOST_HEADERS,
      body: JSON.stringify({ data: { inciting_scene: 42 } }),
    });
    expect(bad2.status).toBe(400);
    expect((await bad2.json()).error.code).toBe("VALIDATION_ERROR");

    // 节点不存在 + data → 404（data 精校验前先定位节点）
    const nf = await app.request("/api/v1/outline/sc-999", {
      method: "PUT", headers: HOST_HEADERS,
      body: JSON.stringify({ data: { goal: "x" } }),
    });
    expect(nf.status).toBe(404);
    expect((await nf.json()).error.code).toBe("OUTLINE_NODE_NOT_FOUND");
  });
});

// ============ 跨存储写序（决策 16：先 DB 后 JSON） ============
//
// 锁定方式：预建 .outline.json.tmp 为**目录**——writeJsonAtomic 写前清理残留临时文件时
// unlink 目录抛 EISDIR → outline.json 原子写必然失败（路由 500）；
// 若顺序正确（先 DB 级联后 JSON 写），JSON 失败时 DB 已先行变更——断言 DB 状态证明顺序；
// 反序（JSON 先行）时 JSON 失败则 DB 未动，断言失败即暴露顺序问题。

describe("跨存储写序（决策 16）", () => {
  /** 使 outline.json 原子写必然失败（预建临时文件路径为目录） */
  function blockOutlineWrite(dir: string): void {
    mkdirSync(join(dir, ".outline.json.tmp"));
  }

  /** 建卷 + 一条关联关系（appears_in），返回卷 id 与 db */
  async function seedVolWithRelation(app: Hono, relId: string): Promise<{ volId: string; dir: string }> {
    const dir = await openProject();
    const vol = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "volume", title: "卷", parent_id: "root" }),
    })).json()).data;
    const project = getCurrentProject()!;
    project.db.prepare(
      "INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(relId, "outline_node", vol.id, "character", "char-1", "appears_in", T0, T0);
    return { volId: vol.id, dir };
  }

  it("DELETE：JSON 写失败时 DB 级联已先行（不残留指向软删节点的幽灵关系）", async () => {
    const app = buildApp();
    const { volId, dir } = await seedVolWithRelation(app, "rel-w1");
    blockOutlineWrite(dir);

    const res = await app.request(`/api/v1/outline/${volId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(res.status).toBe(500); // outline.json 原子写失败（blockWrite）

    // 顺序正确（先 DB 后 JSON）：DB 已被级联软删
    const rel = getCurrentProject()!.db
      .prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get("rel-w1") as { deleted_at: string | null };
    expect(rel.deleted_at).toBeTruthy();
  });

  it("restore：JSON 写失败时 DB 已先行级联还原（且祖先校验 409 无副作用）", async () => {
    const app = buildApp();
    const { volId, dir } = await seedVolWithRelation(app, "rel-w2");
    // 正常软删（级联 rel）
    await app.request(`/api/v1/outline/${volId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(
      (getCurrentProject()!.db.prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get("rel-w2") as { deleted_at: string | null }).deleted_at,
    ).toBeTruthy();

    // 祖先软删 409 时 DB 无副作用（预校验在级联前）
    const ch = (await (await app.request("/api/v1/outline", {
      method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ type: "chapter", title: "章", parent_id: volId }),
    })).json()).data;
    await app.request(`/api/v1/outline/${volId}`, { method: "DELETE", headers: HOST_HEADERS }); // 重删卷（章也级联）
    const early = await app.request(`/api/v1/trash/outline/${ch.id}/restore`, { method: "POST", headers: HOST_HEADERS });
    expect(early.status).toBe(409);
    expect(
      (getCurrentProject()!.db.prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get("rel-w2") as { deleted_at: string | null }).deleted_at,
    ).toBeTruthy(); // 409 拒绝后 DB 未被还原（无副作用）

    blockOutlineWrite(dir);
    const res = await app.request(`/api/v1/trash/outline/${volId}/restore`, { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(500); // JSON 写失败
    // 顺序正确：DB 已先行级联还原
    const rel = getCurrentProject()!.db
      .prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get("rel-w2") as { deleted_at: string | null };
    expect(rel.deleted_at).toBeNull();
  });

  it("purge：JSON 写失败时 DB 已先行物理清除", async () => {
    const app = buildApp();
    const { volId, dir } = await seedVolWithRelation(app, "rel-w3");
    await app.request(`/api/v1/outline/${volId}`, { method: "DELETE", headers: HOST_HEADERS }); // 软删（级联）

    blockOutlineWrite(dir);
    const res = await app.request(`/api/v1/trash/outline/${volId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(res.status).toBe(500); // JSON 写失败
    // 顺序正确：DB 已先行物理清除
    const rel = getCurrentProject()!.db.prepare("SELECT id FROM relation_records WHERE id = ?").get("rel-w3");
    expect(rel).toBeUndefined();
  });
});
