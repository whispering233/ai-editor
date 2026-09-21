// lib/api 端点函数测试（S1.4）：create/open/close project + settings/llm
// 用 mock fetch 验证请求路径/方法/body 形状与响应解析（含 open 的 rebuilt 透传）
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  analyzeDecompose,
  closeProject,
  computeDeltaState,
  confirmProposal,
  createDelta,
  createProjectBackup,
  createRelation,
  deleteRelation,
  listRelations,
  createEntity,
  createOutlineNode,
  createProject,
  deleteEntity,
  deleteOutlineNode,
  deleteProject,
  exportProjectZip,
  getCloudRemoteBooks,
  getDeltasByNode,
  getDecomposeBatch,
  getDecomposeJob,
  getDecomposeJobLog,
  getEntityDetail,
  getOutlinePath,
  getProjectBackups,
  getSessionMessages,
  getSessionThinking,
  getSettingsLlm,
  getTrashList,
  importCloudBook,
  importProjectZip,
  listEntities,
  listProjects,
  moveOutlineNode,
  getManuscript,
  getOutline,
  openProject,
  parseContentDispositionFilename,
  pauseDecomposeJob,
  purgeOutlineNode,
  rejectProposal,
  renameProject,
  renameProjectBackup,
  rerunDecomposeBatch,
  restoreOutlineNode,
  restoreProjectBackup,
  resumeDecomposeJob,
  saveManuscript,
  startDecompose,
  updateEntity,
  updateOutlineNode,
  updateRelationMeta,
  updateSettingsLlm,
} from "./api";

const originalFetch = globalThis.fetch;

/** 会话端点（GET 消息历史 / GET 思维链全文）：路径、查询参数与响应解析 */
describe("chat 会话端点（docs/api/80-api-chat.md）", () => {
  it("getSessionMessages：GET /chat/sessions/:id/messages（id 经 encodeURIComponent）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          sessionId: "0192-sess",
          messages: [
            {
              id: "e1",
              role: "assistant",
              content: "回答",
              thinking: [{ preview: "推理", deferred: true, blockIndex: 0, length: 2 }],
              createdAt: "2026-08-01T10:00:00Z",
            },
          ],
        },
      },
    });
    const res = await getSessionMessages("0192-sess");
    expect(calls[0].url).toBe("/api/v1/chat/sessions/0192-sess/messages");
    expect(res.messages[0].thinking?.[0]).toEqual({
      preview: "推理",
      deferred: true,
      blockIndex: 0,
      length: 2,
    });
  });

  it("getSessionThinking：GET .../messages/:messageId/thinking?blockIndex=N", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { thinking: "思维链全文" } } });
    const res = await getSessionThinking("sess-1", "entry-2", 1);
    expect(res.thinking).toBe("思维链全文");
    expect(calls[0].url).toBe(
      "/api/v1/chat/sessions/sess-1/messages/entry-2/thinking?blockIndex=1",
    );
    expect(calls[0].init?.method).toBe("GET");
  });
});

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

describe("章正文端点（卡 12.5；docs/api/110-api-manuscript.md）", () => {
  it("getManuscript：GET /manuscript/:chapterNodeId；内容/版本戳/字数透传", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: { chapterNodeId: "ch-1", content: '[{"type":"paragraph"}]', updatedAt: "t1", charCount: 8 },
      },
    });
    const res = await getManuscript("ch-1");
    expect(calls[0].url).toBe("/api/v1/manuscript/ch-1");
    expect(calls[0].init?.method).toBe("GET");
    expect(res).toEqual({
      chapterNodeId: "ch-1",
      content: '[{"type":"paragraph"}]',
      updatedAt: "t1",
      charCount: 8,
    });
  });

  it("getManuscript：404 OUTLINE_NODE_NOT_FOUND → ApiError code 透传（页面 404 态）", async () => {
    mockFetchOnce({
      status: 404,
      body: { success: false, error: { code: "OUTLINE_NODE_NOT_FOUND", message: "大纲节点不存在" } },
    });
    await expect(getManuscript("ch-x")).rejects.toMatchObject({ code: "OUTLINE_NODE_NOT_FOUND" });
  });

  it("saveManuscript：PUT /manuscript/:id；baseUpdatedAt → base_updated_at（snake_case）", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { updated: true, updatedAt: "t2", charCount: 3 } },
    });
    const res = await saveManuscript("ch-1", { content: "[{}]", baseUpdatedAt: "t1" });
    expect(calls[0].url).toBe("/api/v1/manuscript/ch-1");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      content: "[{}]",
      base_updated_at: "t1",
    });
    expect(res.updatedAt).toBe("t2");
  });

  it("saveManuscript：省略 baseUpdatedAt = 覆盖保存（body 不带 base_updated_at）", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { updated: true, updatedAt: "t3", charCount: 1 } },
    });
    await saveManuscript("ch-1", { content: "[{}]" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ content: "[{}]" });
  });

  it("saveManuscript：409 DOCUMENT_STALE → ApiError code 透传（冲突对话框分支）", async () => {
    mockFetchOnce({
      status: 409,
      body: { success: false, error: { code: "DOCUMENT_STALE", message: "正文已被其他窗口修改" } },
    });
    await expect(saveManuscript("ch-1", { content: "[{}]" })).rejects.toMatchObject({
      code: "DOCUMENT_STALE",
    });
  });
});

describe("createProject（POST /api/v1/project/create）", () => {
  it("请求方法/路径/body 形状（path + config，snake_case）", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { id: "proj-1", path: "/tmp/p", created: true } },
    });
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
    const calls = mockFetchOnce({
      body: { success: true, data: { id: "proj-1", path: "/tmp/p", created: true } },
    });
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
      schemaVersion: 1,
      currentPosition: null,
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:00:00Z",
    };
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          id: "proj-1",
          name: "我的小说",
          language: "zh",
          config,
          rebuilt: true,
          fromVersion: 0,
        },
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

  it("响应透传 migrated 附加字段（前向迁移自动升级提示，与 rebuilt 互斥）", async () => {
    const config = {
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      schemaVersion: 1,
      currentPosition: null,
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:00:00Z",
    };
    mockFetchOnce({
      body: {
        success: true,
        data: {
          id: "proj-1",
          name: "我的小说",
          language: "zh",
          config,
          migrated: true,
          fromVersion: 0,
        },
      },
    });
    const res = await openProject("/tmp/p");
    expect(res.migrated).toBe(true);
    expect(res.rebuilt).toBeUndefined();
    expect(res.fromVersion).toBe(0);
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
  it("请求路径与方法；响应解析 rootPath + books（id/name/path/origin/updatedAt）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          rootPath: "/home/me/novels",
          books: [
            {
              id: "proj-1",
              name: "我的小说",
              path: "/home/me/novels/books/我的小说",
              origin: "book",
              updatedAt: "2026-08-01T22:30:00Z",
            },
            {
              id: "proj-2",
              name: "第二本",
              path: "/home/me/novels/books/第二本",
              origin: "decompose",
              updatedAt: "2026-07-30T10:12:00Z",
            },
          ],
        },
      },
    });
    const res = await listProjects();
    expect(res.rootPath).toBe("/home/me/novels");
    expect(res.books).toHaveLength(2);
    expect(res.books[0]).toEqual({
      id: "proj-1",
      name: "我的小说",
      path: "/home/me/novels/books/我的小说",
      origin: "book",
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

describe("deleteProject（POST /api/v1/project/delete，卡 23.5）", () => {
  it("请求体 snake_case：path + force + delete_remote；响应解析 pushed / remoteError", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          deleted: true,
          path: "/home/me/novels/books/书1",
          pushed: { fileName: "2026-09-21-auto-本机-人物1-设定2-章3.zip" },
        },
      },
    });
    const res = await deleteProject({
      path: "/home/me/novels/books/书1",
      force: true,
      delete_remote: true,
    });
    expect(calls[0].url).toBe("/api/v1/project/delete");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      path: "/home/me/novels/books/书1",
      force: true,
      delete_remote: true,
    });
    expect(res.deleted).toBe(true);
    expect(res.pushed?.fileName).toBe("2026-09-21-auto-本机-人物1-设定2-章3.zip");
    expect(res.remoteError).toBeUndefined();
  });

  it("省略 force / delete_remote 时请求体不带这两个键（缺省语义由服务端决定）", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { deleted: true, path: "/home/me/novels/books/书1" } },
    });
    await deleteProject({ path: "/home/me/novels/books/书1" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ path: "/home/me/novels/books/书1" });
  });

  it("409 CLOUD_CONFLICT → 抛 ApiError（框内走 force 分支的依据）", async () => {
    mockFetchOnce({
      status: 409,
      body: {
        success: false,
        error: { code: "CLOUD_CONFLICT", message: "云端已有更新的备份（x.zip）" },
      },
    });
    await expect(deleteProject({ path: "/p/books/书1" })).rejects.toMatchObject({
      code: "CLOUD_CONFLICT",
    });
  });
});

describe("settings/llm（S1.3 端点）", () => {
  it("getSettingsLlm：GET /settings/llm 返回激活模型 + provider 认证状态", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          thinkingLevel: "medium",
          providers: [{ id: "deepseek", displayName: "DeepSeek", authConfigured: true, authSource: "environment", models: [] }],
        },
      },
    });
    const res = await getSettingsLlm();
    expect(res).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      thinkingLevel: "medium",
      providers: [{ id: "deepseek", displayName: "DeepSeek", authConfigured: true, authSource: "environment", models: [] }],
    });
    expect(calls[0].url).toBe("/api/v1/settings/llm");
    expect(calls[0].init?.method).toBe("GET");
  });

  it("updateSettingsLlm：PUT body snake_case + api_key 单家凭据（空串 = 清除语义）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { saved: true } } });
    await updateSettingsLlm({ api_key: { provider: "deepseek", key: "" } });
    expect(calls[0].url).toBe("/api/v1/settings/llm");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ api_key: { provider: "deepseek", key: "" } });
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

describe("大纲端点（S2.3，严格三层）", () => {
  it("createOutlineNode：POST /outline，body snake_case（type/title/parent_id/summary）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          id: "vol-2",
          type: "volume",
          title: "第二卷",
          parentId: "root",
          updatedAt: "2026-08-02T00:00:00Z",
        },
      },
    });
    const res = await createOutlineNode({
      type: "volume",
      title: "第二卷",
      parent_id: "root",
      summary: "主线",
    });
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
      body: {
        success: true,
        data: { id: "sc-9", type: "scene", title: "新场景", parentId: "ch-1", updatedAt: "t" },
      },
    });
    await createOutlineNode({ type: "scene", title: "新场景", parent_id: "ch-1" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      type: "scene",
      title: "新场景",
      parent_id: "ch-1",
    });
    mockFetchOnce({
      status: 400,
      body: {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "parent_id is required" },
      },
    });
    await expect(
      createOutlineNode({ type: "scene", title: "x", parent_id: "" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("updateOutlineNode：PUT /outline/:nodeId，body 部分更新（title/summary）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { updated: true } } });
    await expect(updateOutlineNode("ch-3", { title: "新标题" })).resolves.toEqual({
      updated: true,
    });
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

  it("getOutline：默认不带统计；withMetadata:true → ?with_metadata=true（字数按页开启）", async () => {
    const empty = { id: "root", type: "root", schemaVersion: 1, children: [] };
    const plain = mockFetchOnce({ body: { success: true, data: empty } });
    await getOutline();
    expect(plain[0].url).toBe("/api/v1/outline");
    const stats = mockFetchOnce({ body: { success: true, data: empty } });
    await getOutline({ withMetadata: true });
    expect(stats[0].url).toBe("/api/v1/outline?with_metadata=true");
  });
});

describe("回收站端点（S2.3）", () => {
  it("getTrashList：GET /trash；nodes（大纲节点）解析", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          entities: [],
          nodes: [
            { id: "ch-2", type: "chapter", title: "已删章", deletedAt: "2026-08-01T00:00:00Z" },
          ],
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
      body: {
        success: false,
        error: { code: "OUTLINE_ANCESTOR_DELETED", message: "存在软删祖先" },
      },
    });
    await expect(restoreOutlineNode("ch-3")).rejects.toMatchObject({
      code: "OUTLINE_ANCESTOR_DELETED",
    });
  });

  it("purgeOutlineNode：DELETE /trash/outline/:nodeId；{ purged: true }", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { purged: true } } });
    await expect(purgeOutlineNode("sc-1")).resolves.toEqual({ purged: true });
    expect(calls[0].url).toBe("/api/v1/trash/outline/sc-1");
    expect(calls[0].init?.method).toBe("DELETE");
  });
});

describe("实体端点", () => {
  it("listEntities：GET /entity/:type + snake_case query（q/offset/limit/sort/order）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          items: [
            {
              id: "char-1",
              type: "character",
              name: "张三",
              summary: { role: "主角", status: "活跃" },
              createdAt: "t0",
              updatedAt: "t1",
            },
          ],
          total: 1,
          offset: 0,
          limit: 20,
        },
      },
    });
    const res = await listEntities("character", {
      q: "张",
      offset: 0,
      limit: 20,
      sort: "updated_at",
      order: "desc",
    });
    expect(res.items[0].name).toBe("张三");
    expect(res.total).toBe(1);
    expect(calls[0].url).toBe(
      "/api/v1/entity/character?q=%E5%BC%A0&offset=0&limit=20&sort=updated_at&order=desc",
    );
    expect(calls[0].init?.method).toBe("GET");
  });

  it("listEntities：空 query 不拼多余参数（undefined 跳过）", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { items: [], total: 0, offset: 0, limit: 50 } },
    });
    await listEntities("hook");
    expect(calls[0].url).toBe("/api/v1/entity/hook");
  });

  it("getEntityDetail：GET /entity/:type/:id；解析 data/relations/deltaCount", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          id: "char-1",
          type: "character",
          name: "张三",
          data: { role: "主角" },
          relations: [],
          deltaCount: 2,
          createdAt: "t0",
          updatedAt: "t1",
        },
      },
    });
    const res = await getEntityDetail("character", "char-1");
    expect(res.data).toEqual({ role: "主角" });
    expect(res.deltaCount).toBe(2);
    expect(calls[0].url).toBe("/api/v1/entity/character/char-1");
  });

  it("createEntity：POST body { name, data }；201 响应透传 id", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          id: "char-9",
          type: "character",
          name: "李四",
          data: { role: "配角" },
          createdAt: "t",
        },
      },
    });
    const res = await createEntity("character", { name: "李四", data: { role: "配角" } });
    expect(res.id).toBe("char-9");
    expect(calls[0].url).toBe("/api/v1/entity/character");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      name: "李四",
      data: { role: "配角" },
    });
  });

  it("updateEntity：PUT body partial（仅传修改字段）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { id: "char-1", updated: true } } });
    await expect(
      updateEntity("character", "char-1", { data: { status: "退场" } }),
    ).resolves.toEqual({ id: "char-1", updated: true });
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
    mockFetchOnce({
      status: 404,
      body: { success: false, error: { code: "ENTITY_NOT_FOUND", message: "不存在" } },
    });
    await expect(deleteEntity("location", "loc-999")).rejects.toMatchObject({
      code: "ENTITY_NOT_FOUND",
    });
  });
});

describe("关系端点", () => {
  it("listRelations：GET /relation，query snake_case（depth 必填 + 端点过滤）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          relations: [
            {
              id: "rel-1",
              sourceType: "character",
              sourceId: "char-1",
              sourceName: "张三",
              targetType: "outline_node",
              targetId: "sc-1",
              targetName: "灵根测试",
              relationType: "appears_in",
              createdAt: "t",
            },
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
        data: {
          id: "rel-9",
          relation: {
            sourceType: "character",
            sourceId: "char-1",
            targetType: "hook",
            targetId: "hook-1",
            relationType: "plants",
          },
        },
      },
    });
    const res = await createRelation({
      source_type: "character",
      source_id: "char-1",
      target_type: "hook",
      target_id: "hook-1",
      relation_type: "plants",
    });
    expect(res.id).toBe("rel-9");
    expect(calls[0].url).toBe("/api/v1/relation");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      source_type: "character",
      source_id: "char-1",
      target_type: "hook",
      target_id: "hook-1",
      relation_type: "plants",
    });
    mockFetchOnce({
      status: 409,
      body: { success: false, error: { code: "RELATION_EXISTS", message: "已存在" } },
    });
    await expect(
      createRelation({
        source_type: "character",
        source_id: "char-1",
        target_type: "hook",
        target_id: "hook-1",
        relation_type: "plants",
      }),
    ).rejects.toMatchObject({ code: "RELATION_EXISTS" });
  });

  it("deleteRelation：DELETE /relation/:id（物理删）；404 → ApiError", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { deleted: true } } });
    await expect(deleteRelation("rel-1")).resolves.toEqual({ deleted: true });
    expect(calls[0].url).toBe("/api/v1/relation/rel-1");
    expect(calls[0].init?.method).toBe("DELETE");
    mockFetchOnce({
      status: 404,
      body: { success: false, error: { code: "RELATION_NOT_FOUND", message: "不存在" } },
    });
    await expect(deleteRelation("rel-999")).rejects.toMatchObject({ code: "RELATION_NOT_FOUND" });
  });

  it("updateRelationMeta：PUT /relation/:id body { metadata } 整体替换；200 透传；404 → ApiError", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { updated: true } } });
    await expect(updateRelationMeta("rel-1", { label: "新标签" })).resolves.toEqual({
      updated: true,
    });
    expect(calls[0].url).toBe("/api/v1/relation/rel-1");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ metadata: { label: "新标签" } });
 // 清空标签 → 传 {}
    const empty = mockFetchOnce({ body: { success: true, data: { updated: true } } });
    await updateRelationMeta("rel-1", {});
    expect(JSON.parse(String(empty[0].init?.body))).toEqual({ metadata: {} });
    mockFetchOnce({
      status: 404,
      body: { success: false, error: { code: "RELATION_NOT_FOUND", message: "不存在" } },
    });
    await expect(updateRelationMeta("rel-999", {})).rejects.toMatchObject({
      code: "RELATION_NOT_FOUND",
    });
  });
});

describe("delta 端点", () => {
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
    mockFetchOnce({
      status: 404,
      body: { success: false, error: { code: "OUTLINE_NODE_NOT_FOUND", message: "节点不存在" } },
    });
    await expect(getDeltasByNode("sc-999")).rejects.toMatchObject({
      code: "OUTLINE_NODE_NOT_FOUND",
    });
  });

  it("computeDeltaState：POST /delta/compute body snake_case；响应透传（state/appliedDeltas/conflicts）", async () => {
    const body = {
      targetType: "character",
      targetId: "char-3",
      atNodeId: "sc-37",
      state: { combat_power: 150 },
      appliedDeltas: [
        {
          nodeId: "sc-37",
          description: "张三获得断剑认可",
          changes: [],
          skipped: [{ index: 0, field: "combat_power", expected: "100", actual: "999" }],
        },
      ],
      conflicts: [{ deltaId: "delta-1", field: "combat_power", expected: "100", actual: "999" }],
    };
    const calls = mockFetchOnce({ body: { success: true, data: body } });
    const res = await computeDeltaState({
      target_type: "character",
      target_id: "char-3",
      at_node_id: "sc-37",
    });
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
    mockFetchOnce({
      status: 404,
      body: { success: false, error: { code: "OUTLINE_NODE_NOT_FOUND", message: "节点不存在" } },
    });
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
    mockFetchOnce({
      status: 404,
      body: { success: false, error: { code: "OUTLINE_NODE_NOT_FOUND", message: "节点不存在" } },
    });
    await expect(
      createDelta({
        node_id: "sc-999",
        target_type: "character",
        target_id: "char-3",
        changes: [{ field: "status", op: "set", to: "x" }],
        description: "d",
      }),
    ).rejects.toMatchObject({ code: "OUTLINE_NODE_NOT_FOUND" });
  });
});

describe("提案确认/拒绝", () => {
  it("confirmProposal：POST /proposal/:id/confirm，无 body；响应透传 confirmed + result", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { confirmed: true, result: "char-9" } },
    });
    const res = await confirmProposal("prop-1");
    expect(res).toEqual({ confirmed: true, result: "char-9" });
    expect(calls[0].url).toBe("/api/v1/proposal/prop-1/confirm");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("confirmProposal：409 PROPOSAL_STALE → ApiError 透传（前端标 stale 引导重新生成）", async () => {
    mockFetchOnce({
      status: 409,
      body: {
        success: false,
        error: { code: "PROPOSAL_STALE", message: "提案引用对象已变化: entity char-9" },
      },
    });
    await expect(confirmProposal("prop-1")).rejects.toMatchObject({ code: "PROPOSAL_STALE" });
  });

  it("confirmProposal：404 PROPOSAL_NOT_FOUND / 409 PROPOSAL_PROJECT_MISMATCH → ApiError 透传", async () => {
    mockFetchOnce({
      status: 404,
      body: { success: false, error: { code: "PROPOSAL_NOT_FOUND", message: "不存在" } },
    });
    await expect(confirmProposal("prop-1")).rejects.toMatchObject({ code: "PROPOSAL_NOT_FOUND" });
    mockFetchOnce({
      status: 409,
      body: { success: false, error: { code: "PROPOSAL_PROJECT_MISMATCH", message: "项目不一致" } },
    });
    await expect(confirmProposal("prop-1")).rejects.toMatchObject({
      code: "PROPOSAL_PROJECT_MISMATCH",
    });
  });

  it("rejectProposal：POST /proposal/:id/reject，无 body；响应 { rejected: true }", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { rejected: true } } });
    await expect(rejectProposal("prop-1")).resolves.toEqual({ rejected: true });
    expect(calls[0].url).toBe("/api/v1/proposal/prop-1/reject");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeUndefined();
  });
});
// ============ 导出/导入（二进制 zip 分流 + FormData 上传） ============

/** mock fetch 返回二进制/任意响应（export 走 apiFetch 之外的裸 fetch） */
function mockRawResponse(body: BodyInit | null, status: number, headers: Record<string, string>) {
  globalThis.fetch = vi.fn(
    async () => new Response(body, { status, headers }),
  ) as unknown as typeof fetch;
}

describe("exportProjectZip（GET /project/export：二进制 zip 与 JSON 错误分流）", () => {
  it("application/zip 响应 → blob + Content-Disposition RFC 5987 文件名（中文解码）", async () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    mockRawResponse(new Blob([zipBytes]), 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="book.zip"; filename*=UTF-8''${encodeURIComponent("我的书.zip")}`,
    });
    const res = await exportProjectZip();
    expect(res.filename).toBe("我的书.zip");
    expect(new Uint8Array(await res.blob.arrayBuffer())).toEqual(zipBytes);
 // 请求：GET /api/v1/project/export（裸 fetch，无 options——GET 无 body/header）
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/v1/project/export");
  });

  it("无 filename* → 回退 ASCII filename", async () => {
    mockRawResponse(new Blob(["zip"]), 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="book.zip"',
    });
    await expect(exportProjectZip().then((r) => r.filename)).resolves.toBe("book.zip");
  });

  it("无 Content-Disposition → 回退 project.zip", async () => {
    mockRawResponse(new Blob(["zip"]), 200, { "Content-Type": "application/zip" });
    await expect(exportProjectZip().then((r) => r.filename)).resolves.toBe("project.zip");
  });

  it("2xx 非 zip（200 text/html，中间层兜底页）→ 抛 CLIENT_NETWORK_ERROR，不把 HTML 当 zip 下载", async () => {
    mockRawResponse("<html>not found</html>", 200, { "Content-Type": "text/html" });
    await expect(exportProjectZip()).rejects.toMatchObject({ code: CLIENT_NETWORK_ERROR });
  });

  it("2xx application/octet-stream → 正常返回 blob（中间层改写 Content-Type 的兼容分支）", async () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    mockRawResponse(new Blob([zipBytes]), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="book.zip"',
    });
    const res = await exportProjectZip();
    expect(res.filename).toBe("book.zip");
    expect(new Uint8Array(await res.blob.arrayBuffer())).toEqual(zipBytes);
  });

  it("409 NO_PROJECT_OPEN（JSON 错误包裹）→ 抛 ApiError code 透传", async () => {
    mockRawResponse(
      JSON.stringify({ success: false, error: { code: "NO_PROJECT_OPEN", message: "未打开项目" } }),
      409,
      { "Content-Type": "application/json" },
    );
    await expect(exportProjectZip()).rejects.toMatchObject({
      code: "NO_PROJECT_OPEN",
      message: "未打开项目",
    });
  });

  it("500 INTERNAL_ERROR（JSON 错误包裹）→ 抛 ApiError code 透传", async () => {
    mockRawResponse(
      JSON.stringify({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "项目数据文件缺失" },
      }),
      500,
      { "Content-Type": "application/json" },
    );
    await expect(exportProjectZip()).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("网络失败 → CLIENT_NETWORK_ERROR", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(exportProjectZip()).rejects.toMatchObject({ code: CLIENT_NETWORK_ERROR });
  });
});

describe("parseContentDispositionFilename（RFC 5987 文件名解析）", () => {
  it("filename* UTF-8 中文解码优先于 ASCII filename", () => {
    const header = `attachment; filename="book.zip"; filename*=UTF-8''${encodeURIComponent("血与火.zip")}`;
    expect(parseContentDispositionFilename(header)).toBe("血与火.zip");
  });

  it("仅 ASCII filename（带引号）→ 取引号内值", () => {
    expect(parseContentDispositionFilename('attachment; filename="book.zip"')).toBe("book.zip");
  });

  it("filename* 为非法 percent 序列 → 回退 ASCII filename", () => {
    expect(
      parseContentDispositionFilename("attachment; filename=\"book.zip\"; filename*=UTF-8''%zz%zz"),
    ).toBe("book.zip");
  });

  it("无 header → project.zip（兜底）", () => {
    expect(parseContentDispositionFilename(null)).toBe("project.zip");
  });
});

describe("importProjectZip（POST /project/import：FormData multipart 上传）", () => {
  it("请求：FormData body 含 file + name 字段，不手动设 Content-Type（浏览器自动带 boundary）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: { imported: true, id: "proj-9", path: "/books/新书", name: "新书", mode: "new" },
      },
    });
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "backup.zip", {
      type: "application/zip",
    });
    const res = await importProjectZip(file, "新书");
    expect(res).toEqual({
      imported: true,
      id: "proj-9",
      path: "/books/新书",
      name: "新书",
      mode: "new",
    });
    expect(calls[0].url).toBe("/api/v1/project/import");
    expect(calls[0].init?.method).toBe("POST");
 // FormData 原样透传（apiFetch 扩展：不 JSON.stringify、不设 Content-Type）
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    const form = calls[0].init?.body as FormData;
    expect(form.get("name")).toBe("新书");
    expect(form.get("file")).toBeInstanceOf(File);
    expect(calls[0].init?.headers).toBeUndefined();
  });

  it('mode: "restored"（id 匹配覆盖恢复）→ 字段透传', async () => {
    mockFetchOnce({
      body: {
        success: true,
        data: {
          imported: true,
          id: "proj-9",
          path: "/books/我的小说",
          name: "我的小说",
          mode: "restored",
        },
      },
    });
    const res = await importProjectZip(new File(["x"], "b.zip"), "我的小说");
    expect(res).toMatchObject({ name: "我的小说", mode: "restored" });
  });

  it("409 PROJECT_ALREADY_EXISTS → ApiError code 透传", async () => {
    mockFetchOnce({
      status: 409,
      body: {
        success: false,
        error: { code: "PROJECT_ALREADY_EXISTS", message: "书架已存在同名书: 新书" },
      },
    });
    await expect(importProjectZip(new File(["x"], "b.zip"), "新书")).rejects.toMatchObject({
      code: "PROJECT_ALREADY_EXISTS",
    });
  });

  it("409 SCHEMA_VERSION_MISMATCH → ApiError code 透传（版本分流文案在 message）", async () => {
    mockFetchOnce({
      status: 409,
      body: {
        success: false,
        error: {
          code: "SCHEMA_VERSION_MISMATCH",
          message: "备份包 data.db 版本 (2) 备份来自更高版本程序",
        },
      },
    });
    await expect(importProjectZip(new File(["x"], "b.zip"), "新书")).rejects.toMatchObject({
      code: "SCHEMA_VERSION_MISMATCH",
      message: expect.stringContaining("更高版本程序"),
    });
  });

  it("400 VALIDATION_ERROR（坏包）→ ApiError code 透传", async () => {
    mockFetchOnce({
      status: 400,
      body: {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "不是有效的项目备份包" },
      },
    });
    await expect(importProjectZip(new File(["x"], "b.zip"), "新书")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("备份管理", () => {
  it("getProjectBackups：GET /project/backups，响应 backups[] 透传（含 kind 字段）", async () => {
    mockFetchOnce({
      body: {
        success: true,
        data: {
          backups: [
            {
              fileName: "20260813-101500000.zip",
              size: 1258291,
              createdAt: "2026-08-13T10:15:00",
              kind: "auto",
            },
            {
              fileName: "20260813-094500123-定稿.zip",
              size: 1009664,
              createdAt: "2026-08-13T09:45:00.123",
              kind: "manual",
              name: "定稿",
            },
          ],
        },
      },
    });
    const res = await getProjectBackups();
    expect(res.backups).toHaveLength(2);
    expect(res.backups[0]).toEqual({
      fileName: "20260813-101500000.zip",
      size: 1258291,
      createdAt: "2026-08-13T10:15:00",
      kind: "auto",
    });
    expect(res.backups[1]).toMatchObject({ kind: "manual", name: "定稿" });
  });

  it("createProjectBackup：POST /project/backup（无 body），响应 backup 透传（立即备份 → kind manual）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          backup: {
            fileName: "20260813-110000000-m.zip",
            size: 1024,
            createdAt: "2026-08-13T11:00:00",
            kind: "manual",
          },
        },
      },
    });
    const res = await createProjectBackup();
    expect(calls[0].url).toBe("/api/v1/project/backup");
    expect(calls[0].init?.method).toBe("POST");
    expect(res.backup.fileName).toBe("20260813-110000000-m.zip");
    expect(res.backup.kind).toBe("manual");
  });

  it("createProjectBackup(name)：带自定义名称 → 请求体含 { name }；响应 kind manual", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          backup: {
            fileName: "20260813-110000123-定稿.zip",
            size: 1024,
            createdAt: "2026-08-13T11:00:00.123",
            kind: "manual",
            name: "定稿",
          },
        },
      },
    });
    const res = await createProjectBackup("定稿");
    expect(calls[0].url).toBe("/api/v1/project/backup");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: "定稿" });
    expect(res.backup.name).toBe("定稿");
    expect(res.backup.kind).toBe("manual");
  });

  it("createProjectBackup()：不传名称 → 无请求体（undefined body，缺省纯时间戳）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          backup: {
            fileName: "20260813-110000000.zip",
            size: 1024,
            createdAt: "2026-08-13T11:00:00",
            kind: "auto",
          },
        },
      },
    });
    await createProjectBackup();
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("renameProjectBackup：POST /project/backup/rename，带名称（trim 后）→ body { fileName, name }；响应 backup 透传", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          backup: {
            fileName: "20260813-110000123-终稿.zip",
            size: 1024,
            createdAt: "2026-08-13T11:00:00.123",
            kind: "manual",
            name: "终稿",
          },
        },
      },
    });
    const res = await renameProjectBackup("20260813-110000123.zip", "  终稿  ");
    expect(calls[0].url).toBe("/api/v1/project/backup/rename");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      fileName: "20260813-110000123.zip",
      name: "终稿",
    });
    expect(res.backup).toEqual({
      fileName: "20260813-110000123-终稿.zip",
      size: 1024,
      createdAt: "2026-08-13T11:00:00.123",
      kind: "manual",
      name: "终稿",
    });
  });

  it('renameProjectBackup：空名称（纯空格 / undefined）→ body 均含 name: ""（明确清除意图，防 JSON.stringify 丢字段）', async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          backup: {
            fileName: "20260813-110000000.zip",
            size: 1024,
            createdAt: "2026-08-13T11:00:00",
            kind: "auto",
          },
        },
      },
    });
    await renameProjectBackup("20260813-110000000.zip", "   ");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      fileName: "20260813-110000000.zip",
      name: "",
    });
    await renameProjectBackup("20260813-110000000.zip");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      fileName: "20260813-110000000.zip",
      name: "",
    });
  });

  it("renameProjectBackup：404（备份不存在）/ 400（名称非法）→ ApiError code + message 透传（与 restore 一致，404 也返回 VALIDATION_ERROR）", async () => {
    mockFetchOnce({
      status: 404,
      body: { success: false, error: { code: "VALIDATION_ERROR", message: "备份不存在" } },
    });
    await expect(renameProjectBackup("nope.zip", "x")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "备份不存在",
    });
    mockFetchOnce({
      status: 400,
      body: { success: false, error: { code: "VALIDATION_ERROR", message: "备份名称含非法字符" } },
    });
    await expect(renameProjectBackup("20260813-110000000.zip", "a/b")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "备份名称含非法字符",
    });
  });

  it("restoreProjectBackup：POST /project/backup/restore，body 含 fileName，响应 snapshot 透传", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          restored: true,
          snapshot: { fileName: "20260813-105000.zip", createdAt: "2026-08-13T10:50:00" },
        },
      },
    });
    const res = await restoreProjectBackup("20260813-101500.zip");
    expect(calls[0].url).toBe("/api/v1/project/backup/restore");
    expect(calls[0].init?.body).toEqual(JSON.stringify({ fileName: "20260813-101500.zip" }));
    expect(res).toEqual({
      restored: true,
      snapshot: { fileName: "20260813-105000.zip", createdAt: "2026-08-13T10:50:00" },
    });
  });

  it("restoreProjectBackup：409 SCHEMA_VERSION_MISMATCH → ApiError code 透传（前端阻断提示）", async () => {
    mockFetchOnce({
      status: 409,
      body: {
        success: false,
        error: { code: "SCHEMA_VERSION_MISMATCH", message: "备份来自更高版本程序，请升级后打开" },
      },
    });
    await expect(restoreProjectBackup("20260813-101500.zip")).rejects.toMatchObject({
      code: "SCHEMA_VERSION_MISMATCH",
    });
  });

  it("renameProject：POST /project/rename，body 含 name，响应透传", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { renamed: true, path: "/books/新名", name: "新名" } },
    });
    const res = await renameProject("新名");
    expect(calls[0].url).toBe("/api/v1/project/rename");
    expect(calls[0].init?.body).toEqual(JSON.stringify({ name: "新名" }));
    expect(res).toEqual({ renamed: true, path: "/books/新名", name: "新名" });
  });

  it("renameProject：409 PROJECT_ALREADY_EXISTS → ApiError code 透传（行内错误不关闭输入态）", async () => {
    mockFetchOnce({
      status: 409,
      body: {
        success: false,
        error: { code: "PROJECT_ALREADY_EXISTS", message: "书架已存在同名书: 新名" },
      },
    });
    await expect(renameProject("新名")).rejects.toMatchObject({ code: "PROJECT_ALREADY_EXISTS" });
  });
});

// ============ 拆解小说端点（原始字节上传；docs/api/120-api-decompose.md §analyze / §start） ============
//
// 请求侧原始字节是通用「JSON 请求 / {success,data} 响应」约定的显式例外（docs/api/api-public.md）：
// body = 文件原始字节 + `application/octet-stream`，文件名 / 书名 / 范围走 query。
describe("拆解小说端点（上传原始字节）", () => {
  const FILE = new File(["第一章 雪夜\n正文"], "斗破苍穹.txt", { type: "text/plain" });

  it("analyzeDecompose：POST /decompose/analyze，body 原样传 File、Content-Type = application/octet-stream", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { encoding: "utf-8" } } });
    await analyzeDecompose(FILE);
    expect(calls[0].url).toBe("/api/v1/decompose/analyze?file_name=%E6%96%97%E7%A0%B4%E8%8B%8D%E7%A9%B9.txt");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe(FILE); // 不 base64 / 不 multipart：原样字节
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/octet-stream",
    );
  });

  it("analyzeDecompose：范围走 query（缺省不落参数）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: {} } });
    await analyzeDecompose(FILE, { scopeStart: 3, scopeEnd: 9 });
    expect(calls[0].url).toBe(
      "/api/v1/decompose/analyze?file_name=%E6%96%97%E7%A0%B4%E8%8B%8D%E7%A9%B9.txt&scope_start=3&scope_end=9",
    );
  });

  it("startDecompose：POST /decompose/start，书名 + 范围走 query、body 仍是原始字节", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          projectId: "p1",
          projectPath: "/root/books/斗破",
          name: "斗破",
          jobId: "j1",
          status: "running",
          batchCount: 12,
        },
      },
    });
    const res = await startDecompose(FILE, { name: "斗破", scopeStart: 1, scopeEnd: 5 });
    expect(calls[0].url).toBe(
      "/api/v1/decompose/start?file_name=%E6%96%97%E7%A0%B4%E8%8B%8D%E7%A9%B9.txt&name=%E6%96%97%E7%A0%B4&scope_start=1&scope_end=5",
    );
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/octet-stream",
    );
    expect(res.jobId).toBe("j1");
  });

  it("startDecompose：409 PROJECT_ALREADY_EXISTS → ApiError code 透传（对话框内换书名）", async () => {
    mockFetchOnce({
      status: 409,
      body: { success: false, error: { code: "PROJECT_ALREADY_EXISTS", message: "同名书籍已存在" } },
    });
    const err = await startDecompose(FILE, { name: "斗破" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("PROJECT_ALREADY_EXISTS");
  });

  it("analyzeDecompose：400 DECOMPOSE_FILE_TOO_LARGE → ApiError code 透传", async () => {
    mockFetchOnce({
      status: 400,
      body: {
        success: false,
        error: { code: "DECOMPOSE_FILE_TOO_LARGE", message: "文件超过体积上限 16MB" },
      },
    });
    const err = await analyzeDecompose(FILE).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("DECOMPOSE_FILE_TOO_LARGE");
  });
});

// 拆解进度面（卡 21.9；docs/api/120-api-decompose.md §job … §rerun）——轮询 / 展开 / 中止续拆 / 重跑的 URL 形状。
describe("拆解进度面端点", () => {
  it("getDecomposeJob：GET /decompose/job；signal 透传（离开页面时中止在途轮询）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { status: "running" } } });
    const controller = new AbortController();
    const res = await getDecomposeJob(controller.signal);
    expect(calls[0].url).toBe("/api/v1/decompose/job");
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.signal).toBe(controller.signal);
    expect(res).toEqual({ status: "running" });
  });

  it("getDecomposeJob：404 DECOMPOSE_JOB_NOT_FOUND → ApiError code 透传（调用方据此停止轮询）", async () => {
    mockFetchOnce({
      status: 404,
      body: {
        success: false,
        error: { code: "DECOMPOSE_JOB_NOT_FOUND", message: "当前项目没有拆解任务" },
      },
    });
    const err = await getDecomposeJob().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("DECOMPOSE_JOB_NOT_FOUND");
  });

  it("getDecomposeBatch：GET /decompose/job/batches/:seq（未完成 → result: null）", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { seq: 3, status: "pending", attempts: 0, error: null, result: null } },
    });
    const res = await getDecomposeBatch(3);
    expect(calls[0].url).toBe("/api/v1/decompose/job/batches/3");
    expect(res.result).toBeNull();
  });

  it("getDecomposeJobLog：GET /decompose/job/log；signal 透传（条目空数组 = 会话记录已删）", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { sessionId: "decompose-job-1", entries: [] } },
    });
    const controller = new AbortController();
    const res = await getDecomposeJobLog(controller.signal);
    expect(calls[0].url).toBe("/api/v1/decompose/job/log");
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.signal).toBe(controller.signal);
    expect(res.entries).toEqual([]);
  });

  it("pause / resume / rerun：POST 到各自路径，无请求体", async () => {
    const pauseCalls = mockFetchOnce({ body: { success: true, data: { status: "paused" } } });
    await pauseDecomposeJob();
    expect(pauseCalls[0].url).toBe("/api/v1/decompose/job/pause");
    expect(pauseCalls[0].init?.method).toBe("POST");
    expect(pauseCalls[0].init?.body).toBeUndefined();

    const resumeCalls = mockFetchOnce({ body: { success: true, data: { status: "running" } } });
    await resumeDecomposeJob();
    expect(resumeCalls[0].url).toBe("/api/v1/decompose/job/resume");

    const rerunCalls = mockFetchOnce({ body: { success: true, data: { status: "running", seq: 2 } } });
    const res = await rerunDecomposeBatch(2);
    expect(rerunCalls[0].url).toBe("/api/v1/decompose/job/batches/2/rerun");
    expect(res.seq).toBe(2);
  });

  it("resume：400 LLM_API_KEY_MISSING → ApiError code 透传（缺凭据不动状态）", async () => {
    mockFetchOnce({
      status: 400,
      body: { success: false, error: { code: "LLM_API_KEY_MISSING", message: "未配置 API key" } },
    });
    const err = await resumeDecomposeJob().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("LLM_API_KEY_MISSING");
  });
});

// 云端远程书架（卡 23.7）：GET /cloud/remote-books（无请求体）+ POST /cloud/import-book
//（**请求体 snake_case**：dir_name / file_name；省略 file_name 时该键不得出现在 body）
describe("云端远程书架端点（docs/api/100-api-cloud.md）", () => {
  it("getCloudRemoteBooks：GET /cloud/remote-books，响应原样解析（books 内字段 camelCase）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          books: [
            {
              dirName: "云端书-abc123",
              name: "云端书",
              projectId: "abc123",
              localExists: false,
              backups: [
                {
                  fileName: "2026-09-20-auto-苹果本-人物3-设定5-章12.zip",
                  createdAt: "2026-09-20T10:15:30.000Z",
                  kind: "auto",
                  device: "苹果本",
                  stats: { characters: 3, settings: 5, chapters: 12 },
                  size: 2048,
                },
              ],
            },
          ],
        },
      },
    });

    const res = await getCloudRemoteBooks();

    expect(calls[0].url).toBe("/api/v1/cloud/remote-books");
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.body).toBeUndefined();
    expect(res.books[0]?.dirName).toBe("云端书-abc123");
    expect(res.books[0]?.backups[0]?.fileName).toBe(
      "2026-09-20-auto-苹果本-人物3-设定5-章12.zip",
    );
  });

  it("importCloudBook：POST /cloud/import-book，body 键 snake_case（dir_name + file_name）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          imported: true,
          id: "abc123",
          path: "/root/books/云端书",
          name: "云端书",
          fileName: "2026-09-20-auto-苹果本-人物3-设定5-章12.zip",
          size: 2048,
        },
      },
    });

    const res = await importCloudBook({
      dirName: "云端书-abc123",
      fileName: "2026-09-20-auto-苹果本-人物3-设定5-章12.zip",
    });

    expect(calls[0].url).toBe("/api/v1/cloud/import-book");
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      dir_name: "云端书-abc123",
      file_name: "2026-09-20-auto-苹果本-人物3-设定5-章12.zip",
    });
    expect(body).not.toHaveProperty("dirName"); // 线上字段名 = snake_case，不得漏成 camelCase
    expect(res.name).toBe("云端书");
  });

  it("importCloudBook：省略 file_name → body 只剩 dir_name（缺省 = 该目录 head）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          imported: true,
          id: "abc123",
          path: "/root/books/云端书",
          name: "云端书",
          fileName: "2026-09-20-auto-苹果本-人物3-设定5-章12.zip",
          size: 2048,
        },
      },
    });

    await importCloudBook({ dirName: "云端书-abc123" });

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ dir_name: "云端书-abc123" });
  });

  it("importCloudBook：409 PROJECT_ALREADY_EXISTS → ApiError code 与中文 message 透传（框内文案据此分支）", async () => {
    mockFetchOnce({
      status: 409,
      body: {
        success: false,
        error: { code: "PROJECT_ALREADY_EXISTS", message: "本机书架已有这本书（id: abc123）" },
      },
    });

    const err = await importCloudBook({ dirName: "云端书-abc123" }).catch((e: unknown) => e);

    expect((err as ApiError).code).toBe("PROJECT_ALREADY_EXISTS");
    expect((err as ApiError).message).toContain("本机书架已有这本书");
  });
});
