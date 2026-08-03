// lib/api 端点函数测试（S1.4）：create/open/close project + settings/llm
// 用 mock fetch 验证请求路径/方法/body 形状与响应解析（含 open 的 rebuilt 透传）
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  closeProject,
  computeDeltaState,
  confirmProposal,
  createDelta,
  createRelation,
  deleteRelation,
  listRelations,
  createEntity,
  createOutlineNode,
  createProject,
  deleteEntity,
  deleteOutlineNode,
  getDeltasByNode,
  getEntityDetail,
  getOutlinePath,
  getSettingsLlm,
  getTrashList,
  listEntities,
  listProjects,
  moveOutlineNode,
  openProject,
  purgeOutlineNode,
  rejectProposal,
  restoreOutlineNode,
  updateEntity,
  updateOutlineNode,
  updateSettingsLlm,
} from "./api";

const originalFetch = globalThis.fetch;

/** mock fetch：记录请求参数，返回给定响应 */
function mockFetchOnce(response: { status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("createProject（POST /api/v1/project/create）", () => {
  it("请求方法/路径/body 形状（path + config，snake_case）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { id: "proj-1", path: "/tmp/p", created: true } } });
    const res = await createProject("/tmp/p", { name: "我的小说", language: "zh" });
    expect(res).toEqual({ id: "proj-1", path: "/tmp/p", created: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/v1/project/create");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      path: "/tmp/p",
      config: { name: "我的小说", language: "zh" },
    });
  });

  it("不传 config 时请求体不含 config 键", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { id: "proj-1", path: "/tmp/p", created: true } } });
    await createProject("/tmp/p");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ path: "/tmp/p" });
  });

  it("409 PROJECT_ALREADY_EXISTS → 抛 ApiError（code 透传）", async () => {
    mockFetchOnce({
      status: 409,
      body: { success: false, error: { code: "PROJECT_ALREADY_EXISTS", message: "目录已是项目" } },
    });
    await expect(createProject("/tmp/p")).rejects.toMatchObject({
      code: "PROJECT_ALREADY_EXISTS",
      message: "目录已是项目",
    });
  });
});

describe("openProject（POST /api/v1/project/open）", () => {
  it("请求 body { path }；响应透传 config 与 rebuilt/fromVersion", async () => {
    const config = {
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      prompt: "",
      schemaVersion: 1,
      currentPosition: null,
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:00:00Z",
    };
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: { id: "proj-1", name: "我的小说", language: "zh", config, rebuilt: true, fromVersion: 0 },
      },
    });
    const res = await openProject("/tmp/p");
    expect(res.rebuilt).toBe(true);
    expect(res.fromVersion).toBe(0);
    expect(res.config.name).toBe("我的小说");
    expect(calls[0].url).toBe("/api/v1/project/open");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ path: "/tmp/p" });
  });

  it("400 INVALID_PROJECT_PATH → 抛 ApiError", async () => {
    mockFetchOnce({
      status: 400,
      body: { success: false, error: { code: "INVALID_PROJECT_PATH", message: "路径不存在" } },
    });
    await expect(openProject("/nope")).rejects.toMatchObject({ code: "INVALID_PROJECT_PATH" });
  });
});

describe("closeProject（POST /api/v1/project/close）", () => {
  it("无 body；返回 { saved: true }", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { saved: true } } });
    await expect(closeProject()).resolves.toEqual({ saved: true });
    expect(calls[0].url).toBe("/api/v1/project/close");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeUndefined();
  });
});

describe("listProjects（GET /api/v1/project/list，S1.5 书架）", () => {
  it("请求路径与方法；响应解析 rootPath + books（name/path/updatedAt）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          rootPath: "/home/me/novels",
          books: [
            { name: "我的小说", path: "/home/me/novels/books/我的小说", updatedAt: "2026-08-01T22:30:00Z" },
            { name: "第二本", path: "/home/me/novels/books/第二本", updatedAt: "2026-07-30T10:12:00Z" },
          ],
        },
      },
    });
    const res = await listProjects();
    expect(res.rootPath).toBe("/home/me/novels");
    expect(res.books).toHaveLength(2);
    expect(res.books[0]).toEqual({
      name: "我的小说",
      path: "/home/me/novels/books/我的小说",
      updatedAt: "2026-08-01T22:30:00Z",
    });
    expect(calls[0].url).toBe("/api/v1/project/list");
    expect(calls[0].init?.method).toBe("GET");
  });

  it("空书架 → books 空数组（空态「还没有书」）", async () => {
    mockFetchOnce({ body: { success: true, data: { rootPath: "/home/me/novels", books: [] } } });
    const res = await listProjects();
    expect(res.books).toEqual([]);
  });
});

describe("settings/llm（S1.3 端点）", () => {
  it("getSettingsLlm：GET /settings/llm 返回 model/apiKeySet/apiKeyMasked", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { model: "deepseek-v4-flash", apiKeySet: true, apiKeyMasked: "sk-****1234" } },
    });
    const res = await getSettingsLlm();
    expect(res).toEqual({ model: "deepseek-v4-flash", apiKeySet: true, apiKeyMasked: "sk-****1234" });
    expect(calls[0].url).toBe("/api/v1/settings/llm");
    expect(calls[0].init?.method).toBe("GET");
  });

  it("updateSettingsLlm：PUT body snake_case；api_key 空串透传（清除语义）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { saved: true } } });
    await updateSettingsLlm({ api_key: "" });
    expect(calls[0].url).toBe("/api/v1/settings/llm");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ api_key: "" });
  });

  it("网络失败 → 抛 CLIENT_NETWORK_ERROR", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(getSettingsLlm()).rejects.toMatchObject({ code: CLIENT_NETWORK_ERROR });
    // ApiError 类型断言（code 字段可访问）
    try {
      await getSettingsLlm();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
    }
  });
});

describe("大纲端点（S2.3，严格三层决策 19）", () => {
  it("createOutlineNode：POST /outline，body snake_case（type/title/parent_id/summary）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: { id: "vol-2", type: "volume", title: "第二卷", parentId: "root", updatedAt: "2026-08-02T00:00:00Z" },
      },
    });
    const res = await createOutlineNode({ type: "volume", title: "第二卷", parent_id: "root", summary: "主线" });
    expect(res).toMatchObject({ id: "vol-2", parentId: "root" });
    expect(calls[0].url).toBe("/api/v1/outline");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      type: "volume",
      title: "第二卷",
      parent_id: "root",
      summary: "主线",
    });
  });

  it("createOutlineNode：scene 挂 chapter（parent_id 必填透传）；400 VALIDATION_ERROR → ApiError", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { id: "sc-9", type: "scene", title: "新场景", parentId: "ch-1", updatedAt: "t" } },
    });
    await createOutlineNode({ type: "scene", title: "新场景", parent_id: "ch-1" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      type: "scene",
      title: "新场景",
      parent_id: "ch-1",
    });
    mockFetchOnce({
      status: 400,
      body: { success: false, error: { code: "VALIDATION_ERROR", message: "parent_id is required" } },
    });
    await expect(createOutlineNode({ type: "scene", title: "x", parent_id: "" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("updateOutlineNode：PUT /outline/:nodeId，body 部分更新（title/summary）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { updated: true } } });
    await expect(updateOutlineNode("ch-3", { title: "新标题" })).resolves.toEqual({ updated: true });
    expect(calls[0].url).toBe("/api/v1/outline/ch-3");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ title: "新标题" });
  });

  it("moveOutlineNode：PUT /outline/:nodeId/move，body { parent_id, order }；响应透传 newParentId", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: { moved: true, previousParentId: "vol-1", newParentId: "vol-2" },
      },
    });
    const res = await moveOutlineNode("ch-3", { parent_id: "vol-2", order: 0 });
    expect(res.newParentId).toBe("vol-2");
    expect(calls[0].url).toBe("/api/v1/outline/ch-3/move");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ parent_id: "vol-2", order: 0 });
  });

  it("deleteOutlineNode：DELETE；响应 cascaded 计数透传（软删级联提示用）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: { deleted: true, cascaded: { children: 3, relations: 2, deltas: 1 } },
      },
    });
    const res = await deleteOutlineNode("vol-1");
    expect(res.cascaded).toEqual({ children: 3, relations: 2, deltas: 1 });
    expect(calls[0].url).toBe("/api/v1/outline/vol-1");
    expect(calls[0].init?.method).toBe("DELETE");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("getOutlinePath：GET /outline/:nodeId/path；path 数组透传", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { nodeId: "sc-15", path: ["root", "vol-1", "ch-3", "sc-15"] } },
    });
    const res = await getOutlinePath("sc-15");
    expect(res.path).toEqual(["root", "vol-1", "ch-3", "sc-15"]);
    expect(calls[0].url).toBe("/api/v1/outline/sc-15/path");
  });
});

describe("回收站端点（S2.3，决策 12）", () => {
  it("getTrashList：GET /trash；nodes（大纲节点）解析", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          entities: [],
          nodes: [{ id: "ch-2", type: "chapter", title: "已删章", deletedAt: "2026-08-01T00:00:00Z" }],
        },
      },
    });
    const res = await getTrashList();
    expect(res.nodes).toHaveLength(1);
    expect(res.nodes[0]).toMatchObject({ id: "ch-2", title: "已删章" });
    expect(calls[0].url).toBe("/api/v1/trash");
  });

  it("restoreOutlineNode：POST /trash/outline/:nodeId/restore；restoredChildren 透传", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: { restored: true, restoredChildren: 2, restoredRelations: 1, restoredDeltas: 0 },
      },
    });
    const res = await restoreOutlineNode("vol-1");
    expect(res.restoredChildren).toBe(2);
    expect(calls[0].url).toBe("/api/v1/trash/outline/vol-1/restore");
    expect(calls[0].init?.method).toBe("POST");
  });

  it("restoreOutlineNode：409 OUTLINE_ANCESTOR_DELETED → ApiError（祖先软删提示）", async () => {
    mockFetchOnce({
      status: 409,
      body: { success: false, error: { code: "OUTLINE_ANCESTOR_DELETED", message: "存在软删祖先" } },
    });
    await expect(restoreOutlineNode("ch-3")).rejects.toMatchObject({ code: "OUTLINE_ANCESTOR_DELETED" });
  });

  it("purgeOutlineNode：DELETE /trash/outline/:nodeId；{ purged: true }", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { purged: true } } });
    await expect(purgeOutlineNode("sc-1")).resolves.toEqual({ purged: true });
    expect(calls[0].url).toBe("/api/v1/trash/outline/sc-1");
    expect(calls[0].init?.method).toBe("DELETE");
  });
});

describe("实体端点（S3.5，契约 endpoints.md「实体 CRUD」）", () => {
  it("listEntities：GET /entity/:type + snake_case query（q/offset/limit/sort/order）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          items: [
            { id: "char-1", type: "character", name: "张三", summary: { role: "主角", status: "活跃" }, createdAt: "t0", updatedAt: "t1" },
          ],
          total: 1,
          offset: 0,
          limit: 20,
        },
      },
    });
    const res = await listEntities("character", { q: "张", offset: 0, limit: 20, sort: "updated_at", order: "desc" });
    expect(res.items[0].name).toBe("张三");
    expect(res.total).toBe(1);
    expect(calls[0].url).toBe("/api/v1/entity/character?q=%E5%BC%A0&offset=0&limit=20&sort=updated_at&order=desc");
    expect(calls[0].init?.method).toBe("GET");
  });

  it("listEntities：空 query 不拼多余参数（undefined 跳过）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { items: [], total: 0, offset: 0, limit: 50 } } });
    await listEntities("hook");
    expect(calls[0].url).toBe("/api/v1/entity/hook");
  });

  it("getEntityDetail：GET /entity/:type/:id；解析 data/relations/deltaCount", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: { id: "char-1", type: "character", name: "张三", data: { role: "主角" }, relations: [], deltaCount: 2, createdAt: "t0", updatedAt: "t1" },
      },
    });
    const res = await getEntityDetail("character", "char-1");
    expect(res.data).toEqual({ role: "主角" });
    expect(res.deltaCount).toBe(2);
    expect(calls[0].url).toBe("/api/v1/entity/character/char-1");
  });

  it("createEntity：POST body { name, data }；201 响应透传 id", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { id: "char-9", type: "character", name: "李四", data: { role: "配角" }, createdAt: "t" } },
    });
    const res = await createEntity("character", { name: "李四", data: { role: "配角" } });
    expect(res.id).toBe("char-9");
    expect(calls[0].url).toBe("/api/v1/entity/character");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: "李四", data: { role: "配角" } });
  });

  it("updateEntity：PUT body partial（仅传修改字段）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { id: "char-1", updated: true } } });
    await expect(updateEntity("character", "char-1", { data: { status: "退场" } })).resolves.toEqual({ id: "char-1", updated: true });
    expect(calls[0].url).toBe("/api/v1/entity/character/char-1");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ data: { status: "退场" } });
  });

  it("deleteEntity：DELETE 软删；cascaded 计数透传；404 ENTITY_NOT_FOUND → ApiError", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { deleted: true, cascaded: { relations: 3, deltas: 1 } } },
    });
    const res = await deleteEntity("location", "loc-1");
    expect(res.cascaded).toEqual({ relations: 3, deltas: 1 });
    expect(calls[0].url).toBe("/api/v1/entity/location/loc-1");
    expect(calls[0].init?.method).toBe("DELETE");
    mockFetchOnce({ status: 404, body: { success: false, error: { code: "ENTITY_NOT_FOUND", message: "不存在" } } });
    await expect(deleteEntity("location", "loc-999")).rejects.toMatchObject({ code: "ENTITY_NOT_FOUND" });
  });
});

describe("关系端点（S3.6，契约 endpoints.md「关系」）", () => {
  it("listRelations：GET /relation，query snake_case（depth 必填 + 端点过滤）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          relations: [
            { id: "rel-1", sourceType: "character", sourceId: "char-1", sourceName: "张三", targetType: "outline_node", targetId: "sc-1", targetName: "灵根测试", relationType: "appears_in", createdAt: "t" },
          ],
        },
      },
    });
    const res = await listRelations({ source_type: "character", source_id: "char-1", depth: 1 });
    expect(res.relations[0]).toMatchObject({ relationType: "appears_in", sourceName: "张三" });
    expect(calls[0].url).toBe("/api/v1/relation?source_type=character&source_id=char-1&depth=1");
  });

  it("createRelation：POST body snake_case；201 响应透传；409 RELATION_EXISTS → ApiError", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: { id: "rel-9", relation: { sourceType: "character", sourceId: "char-1", targetType: "hook", targetId: "hook-1", relationType: "plants" } },
      },
    });
    const res = await createRelation({ source_type: "character", source_id: "char-1", target_type: "hook", target_id: "hook-1", relation_type: "plants" });
    expect(res.id).toBe("rel-9");
    expect(calls[0].url).toBe("/api/v1/relation");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      source_type: "character", source_id: "char-1", target_type: "hook", target_id: "hook-1", relation_type: "plants",
    });
    mockFetchOnce({ status: 409, body: { success: false, error: { code: "RELATION_EXISTS", message: "已存在" } } });
    await expect(createRelation({ source_type: "character", source_id: "char-1", target_type: "hook", target_id: "hook-1", relation_type: "plants" })).rejects.toMatchObject({ code: "RELATION_EXISTS" });
  });

  it("deleteRelation：DELETE /relation/:id（物理删）；404 → ApiError", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { deleted: true } } });
    await expect(deleteRelation("rel-1")).resolves.toEqual({ deleted: true });
    expect(calls[0].url).toBe("/api/v1/relation/rel-1");
    expect(calls[0].init?.method).toBe("DELETE");
    mockFetchOnce({ status: 404, body: { success: false, error: { code: "RELATION_NOT_FOUND", message: "不存在" } } });
    await expect(deleteRelation("rel-999")).rejects.toMatchObject({ code: "RELATION_NOT_FOUND" });
  });
});

describe("delta 端点（S5.4；契约 endpoints.md「Delta 变更追踪」）", () => {
  it("getDeltasByNode：GET /delta/node/:nodeId；响应透传；404 → ApiError", async () => {
    const body = {
      nodeId: "sc-37",
      deltas: [
        {
          id: "delta-1",
          nodeId: "sc-37",
          targetType: "character",
          targetId: "char-3",
          targetName: "张三",
          changes: [{ field: "combat_power", op: "update", from: "100", to: "150" }],
          description: "张三获得断剑认可",
          order: 1,
          createdAt: "2026-08-01T10:00:00Z",
        },
      ],
    };
    const calls = mockFetchOnce({ body: { success: true, data: body } });
    const res = await getDeltasByNode("sc-37");
    expect(res).toEqual(body);
    expect(calls[0].url).toBe("/api/v1/delta/node/sc-37");
    expect(calls[0].init?.method).toBe("GET");
    mockFetchOnce({ status: 404, body: { success: false, error: { code: "OUTLINE_NODE_NOT_FOUND", message: "节点不存在" } } });
    await expect(getDeltasByNode("sc-999")).rejects.toMatchObject({ code: "OUTLINE_NODE_NOT_FOUND" });
  });

  it("computeDeltaState：POST /delta/compute body snake_case；响应透传（state/appliedDeltas/conflicts）", async () => {
    const body = {
      targetType: "character",
      targetId: "char-3",
      atNodeId: "sc-37",
      state: { combat_power: 150 },
      appliedDeltas: [
        { nodeId: "sc-37", description: "张三获得断剑认可", changes: [], skipped: [{ index: 0, field: "combat_power", expected: "100", actual: "999" }] },
      ],
      conflicts: [{ deltaId: "delta-1", field: "combat_power", expected: "100", actual: "999" }],
    };
    const calls = mockFetchOnce({ body: { success: true, data: body } });
    const res = await computeDeltaState({ target_type: "character", target_id: "char-3", at_node_id: "sc-37" });
    expect(res).toEqual(body);
    expect(calls[0].url).toBe("/api/v1/delta/compute");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      target_type: "character",
      target_id: "char-3",
      at_node_id: "sc-37",
    });
  });

  it("computeDeltaState：404 OUTLINE_NODE_NOT_FOUND（at_node 已 purge）→ ApiError", async () => {
    mockFetchOnce({ status: 404, body: { success: false, error: { code: "OUTLINE_NODE_NOT_FOUND", message: "节点不存在" } } });
    await expect(
      computeDeltaState({ target_type: "character", target_id: "char-3", at_node_id: "sc-999" }),
    ).rejects.toMatchObject({ code: "OUTLINE_NODE_NOT_FOUND" });
  });

  it("createDelta：POST /delta body snake_case（node_id/target_type/target_id/changes/description）；201 响应透传；404 → ApiError", async () => {
    const body = {
      id: "delta-9",
      applied: {
        id: "delta-9",
        nodeId: "sc-37",
        targetType: "character",
        targetId: "char-3",
        targetName: "张三",
        changes: [{ field: "status", op: "update", from: "活跃", to: "中立" }],
        description: "张三获得断剑认可",
        order: 1,
        createdAt: "2026-08-01T10:00:00Z",
      },
    };
    const calls = mockFetchOnce({ status: 201, body: { success: true, data: body } });
    const res = await createDelta({
      node_id: "sc-37",
      target_type: "character",
      target_id: "char-3",
      changes: [{ field: "status", op: "update", from: "活跃", to: "中立" }],
      description: "张三获得断剑认可",
    });
    expect(res).toEqual(body);
    expect(calls[0].url).toBe("/api/v1/delta");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      node_id: "sc-37",
      target_type: "character",
      target_id: "char-3",
      changes: [{ field: "status", op: "update", from: "活跃", to: "中立" }],
      description: "张三获得断剑认可",
    });
    mockFetchOnce({ status: 404, body: { success: false, error: { code: "OUTLINE_NODE_NOT_FOUND", message: "节点不存在" } } });
    await expect(
      createDelta({ node_id: "sc-999", target_type: "character", target_id: "char-3", changes: [{ field: "status", op: "set", to: "x" }], description: "d" }),
    ).rejects.toMatchObject({ code: "OUTLINE_NODE_NOT_FOUND" });
  });
});

describe("提案确认/拒绝（S8.2，契约 endpoints.md「提案确认」L848-888 + shared proposal*ResSchema）", () => {
  it("confirmProposal：POST /proposal/:id/confirm，无 body；响应透传 confirmed + result", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { confirmed: true, result: "char-9" } } });
    const res = await confirmProposal("prop-1");
    expect(res).toEqual({ confirmed: true, result: "char-9" });
    expect(calls[0].url).toBe("/api/v1/proposal/prop-1/confirm");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("confirmProposal：409 PROPOSAL_STALE → ApiError 透传（前端标 stale 引导重新生成）", async () => {
    mockFetchOnce({
      status: 409,
      body: { success: false, error: { code: "PROPOSAL_STALE", message: "提案引用对象已变化: entity char-9" } },
    });
    await expect(confirmProposal("prop-1")).rejects.toMatchObject({ code: "PROPOSAL_STALE" });
  });

  it("confirmProposal：404 PROPOSAL_NOT_FOUND / 409 PROPOSAL_PROJECT_MISMATCH → ApiError 透传", async () => {
    mockFetchOnce({ status: 404, body: { success: false, error: { code: "PROPOSAL_NOT_FOUND", message: "不存在" } } });
    await expect(confirmProposal("prop-1")).rejects.toMatchObject({ code: "PROPOSAL_NOT_FOUND" });
    mockFetchOnce({
      status: 409,
      body: { success: false, error: { code: "PROPOSAL_PROJECT_MISMATCH", message: "项目不一致" } },
    });
    await expect(confirmProposal("prop-1")).rejects.toMatchObject({ code: "PROPOSAL_PROJECT_MISMATCH" });
  });

  it("rejectProposal：POST /proposal/:id/reject，无 body；响应 { rejected: true }", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { rejected: true } } });
    await expect(rejectProposal("prop-1")).resolves.toEqual({ rejected: true });
    expect(calls[0].url).toBe("/api/v1/proposal/prop-1/reject");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeUndefined();
  });
});