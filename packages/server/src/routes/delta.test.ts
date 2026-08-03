// Delta 路由测试（S5.3）：POST 追加 / GET /node/:nodeId / POST /compute
// 覆盖：201 ok 包裹与 applied 全字段、order 全局单调递增、空 changes/非法 op/per-op 缺必填（400，
//       四 op 全表驱动）、触发节点前置校验（404 OUTLINE_NODE_NOT_FOUND，防死记录，含软删）、
//       GET 可见性（软删触发节点 → 空数组）与 order 升序、
//       compute 树路径累积（决策 9 双层排序）+ 回显（targetType/targetId/atNodeId）、
//       update 冲突（conflicts + 保持手动值）、compute 404 映射（OUTLINE_NODE_NOT_FOUND /
//       ENTITY_NOT_FOUND，含 at_node 软删）
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createEntity, SCHEMA_VERSION, updateEntity, writeOutlineFile } from "@ai-editor/db";
import type { OutlineFileTree } from "@ai-editor/shared";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { deltaRoutes } from "./delta.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "delta-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（delta 路由） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/delta", deltaRoutes);
  return app;
}

/** JSON 请求辅助（relation.test.ts createRel 同款简洁：path 由调用处 app.request 提供） */
function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { ...HOST_HEADERS, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

/** 标准大纲树：卷 vol-1 → 章 ch-1 → 场景 sc-1（compute 树路径测试用） */
function standardOutline(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: SCHEMA_VERSION,
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
  };
}

/** 大纲树变体：sc-1 已软删（决策 12 软删语义；路由前置校验应 404） */
function softDeletedSceneOutline(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: SCHEMA_VERSION,
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
            children: [
              {
                id: "sc-1",
                type: "scene",
                title: "场景一",
                updated_at: "2026-08-01T10:00:00Z",
                deleted: true,
                deleted_at: "2026-08-01T12:00:00Z",
              },
            ],
          },
        ],
      },
    ],
  };
}

/** open 项目 + 标准大纲树 + 角色实体（data 初始 combat_power=100、tags=["剑"]），返回 { app, charId } */
function seed(): { app: Hono; charId: string } {
  const dir = makeTmpDir();
  setCurrentProject(initProject(dir));
  writeOutlineFile(dir, standardOutline());
  const project = getCurrentProject()!;
  const char = createEntity(project.db, {
    type: "character",
    name: "阿强",
    data: { combat_power: 100, tags: ["剑"] },
  });
  return { app: buildApp(), charId: char.id };
}

/** POST /api/v1/delta 辅助（返回 { status, body }） */
async function postDelta(
  app: Hono,
  body: Record<string, unknown>,
): Promise<{ status: number; body: { success: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string; fields?: string[] } } }> {
  const res = await app.request("/api/v1/delta", jsonRequest("POST", body));
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string; fields?: string[] } } };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-delta-"));
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

// ============ POST /api/v1/delta ============

describe("POST /api/v1/delta 追加", () => {
  it("201 + ok 包裹 + applied 全字段（id 前缀 delta-、changes 原样、order 服务端生成）", async () => {
    const { app, charId } = await seed();
    const { status, body } = await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "combat_power", op: "set", to: 150 }],
      description: "张三获得断剑认可",
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(String(body.data?.id)).toMatch(/^delta-/);
    expect(body.data?.applied).toEqual({
      id: expect.stringMatching(/^delta-/),
      nodeId: "sc-1",
      targetType: "character",
      targetId: charId,
      changes: [{ field: "combat_power", op: "set", to: 150 }],
      description: "张三获得断剑认可",
      order: 1,
      createdAt: expect.any(String),
    });
  });

  it("两次 POST order 全局单调递增", async () => {
    const { app, charId } = await seed();
    const base = {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "a", op: "set", to: 1 }],
      description: "d1",
    };
    const first = await postDelta(app, base);
    const second = await postDelta(app, { ...base, description: "d2" });
    expect((first.body.data?.applied as { order?: number } | undefined)?.order).toBe(1);
    expect((second.body.data?.applied as { order?: number } | undefined)?.order).toBe(2);
  });

  it("空 changes → 400 VALIDATION_ERROR（含 fields）", async () => {
    const { app, charId } = await seed();
    const { status, body } = await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [],
      description: "x",
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(body.error?.fields).toContain("changes");
  });

  it("非法 op → 400 VALIDATION_ERROR（schema enum 拦截）", async () => {
    const { app, charId } = await seed();
    const { status, body } = await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "a", op: "replace", to: 1 }],
      description: "x",
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("per-op 必填：update 缺 from → 400；add 缺 value → 400", async () => {
    const { app, charId } = await seed();
    const updateMissingFrom = await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "combat_power", op: "update", to: 200 }],
      description: "x",
    });
    expect(updateMissingFrom.status).toBe(400);
    expect(updateMissingFrom.body.error?.code).toBe("VALIDATION_ERROR");
    expect(updateMissingFrom.body.error?.message).toContain("from");

    const addMissingValue = await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "tags", op: "add" }],
      description: "x",
    });
    expect(addMissingValue.status).toBe(400);
    expect(addMissingValue.body.error?.code).toBe("VALIDATION_ERROR");
    expect(addMissingValue.body.error?.message).toContain("value");
  });

  it("per-op 必填（表驱动补齐）：remove 缺 value → 400；set 缺 to → 400", async () => {
    const { app, charId } = await seed();
    const cases: Array<{ name: string; change: Record<string, unknown>; missing: string }> = [
      { name: "remove 缺 value", change: { field: "tags", op: "remove" }, missing: "value" },
      { name: "set 缺 to", change: { field: "combat_power", op: "set" }, missing: "to" },
    ];
    for (const c of cases) {
      const { status, body } = await postDelta(app, {
        node_id: "sc-1",
        target_type: "character",
        target_id: charId,
        changes: [c.change],
        description: "x",
      });
      expect(status).toBe(400);
      expect(body.error?.code).toBe("VALIDATION_ERROR");
      expect(body.error?.message).toContain(c.missing);
    }
  });

  it("node_id 不存在 → 404 OUTLINE_NODE_NOT_FOUND（防死记录）", async () => {
    const { app, charId } = await seed();
    const { status, body } = await postDelta(app, {
      node_id: "sc-999",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "a", op: "set", to: 1 }],
      description: "x",
    });
    expect(status).toBe(404);
    expect(body.error?.code).toBe("OUTLINE_NODE_NOT_FOUND");
  });

  it("node_id 指向软删节点 → 404 OUTLINE_NODE_NOT_FOUND（防死记录）", async () => {
    const { app, charId } = await seed();
    // 重写大纲树：sc-1 标 deleted（决策 12 软删语义）
    const project = getCurrentProject()!;
    writeOutlineFile(project.root, softDeletedSceneOutline());
    const { status, body } = await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "a", op: "set", to: 1 }],
      description: "x",
    });
    expect(status).toBe(404);
    expect(body.error?.code).toBe("OUTLINE_NODE_NOT_FOUND");
  });
});

// ============ GET /api/v1/delta/node/:nodeId ============

describe("GET /api/v1/delta/node/:nodeId", () => {
  it("有 Delta → 200 列表含 targetName + 按 order 升序", async () => {
    const { app, charId } = await seed();
    await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "a", op: "set", to: 1 }],
      description: "d1",
    });
    await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "b", op: "set", to: 2 }],
      description: "d2",
    });
    const res = await app.request("/api/v1/delta/node/sc-1", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { nodeId: string; deltas: Array<Record<string, unknown>> } };
    expect(body.success).toBe(true);
    expect(body.data.nodeId).toBe("sc-1");
    expect(body.data.deltas).toHaveLength(2);
    expect(body.data.deltas[0]).toMatchObject({ description: "d1", order: 1, targetName: "阿强", targetId: charId });
    expect(body.data.deltas[1]).toMatchObject({ description: "d2", order: 2, targetName: "阿强", targetId: charId });
  });

  it("无 Delta 节点 → 200 空数组", async () => {
    const { app } = await seed();
    const res = await app.request("/api/v1/delta/node/ch-1", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()) as { data: unknown }).toEqual({ success: true, data: { nodeId: "ch-1", deltas: [] } });
  });

  it("节点不存在 → 200 空数组（非 404——契约未定义该端点 404）", async () => {
    const { app } = await seed();
    const res = await app.request("/api/v1/delta/node/sc-999", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()) as { data: unknown }).toEqual({ success: true, data: { nodeId: "sc-999", deltas: [] } });
  });

  it("触发节点已软删 → 200 空数组（决策 12 可见性联动：先挂 Delta 再软删，记录被过滤）", async () => {
    const { app, charId } = await seed();
    // 先挂一条正常可见的 Delta（触发节点 sc-1 未删）
    await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "a", op: "set", to: 1 }],
      description: "d1",
    });
    // 软删触发节点：其全部 Delta 视同不可见（listDeltasByNode 三态过滤）
    const project = getCurrentProject()!;
    writeOutlineFile(project.root, softDeletedSceneOutline());
    const res = await app.request("/api/v1/delta/node/sc-1", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()) as { data: unknown }).toEqual({ success: true, data: { nodeId: "sc-1", deltas: [] } });
  });
});

// ============ POST /api/v1/delta/compute ============

describe("POST /api/v1/delta/compute 状态计算", () => {
  it("树路径累积：ch-1 与 sc-1 的 Delta 按路径序应用（决策 9 双层排序）", async () => {
    const { app, charId } = await seed();
    // 章上的 Delta（先应用）：set status=alive
    await postDelta(app, {
      node_id: "ch-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "status", op: "set", to: "alive" }],
      description: "章内变更",
    });
    // 场景上的 Delta（后应用）：set combat_power=150 + add tags
    await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [
        { field: "combat_power", op: "set", to: 150 },
        { field: "tags", op: "add", value: "断剑" },
      ],
      description: "场景内变更",
    });
    const res = await app.request(
      "/api/v1/delta/compute",
      jsonRequest("POST", { target_type: "character", target_id: charId, at_node_id: "sc-1" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        targetType: string;
        targetId: string;
        atNodeId: string;
        state: Record<string, unknown>;
        appliedDeltas: Array<{ nodeId: string; description: string; changes: unknown[]; skipped?: unknown[] }>;
        conflicts: unknown[];
      };
    };
    expect(body.success).toBe(true);
    // 回显断言（oracle 建议补齐）：targetType/targetId/atNodeId 原样回显
    expect(body.data.targetType).toBe("character");
    expect(body.data.targetId).toBe(charId);
    expect(body.data.atNodeId).toBe("sc-1");
    expect(body.data.state).toEqual({ combat_power: 150, tags: ["剑", "断剑"], status: "alive" });
    expect(body.data.appliedDeltas).toHaveLength(2);
    expect(body.data.appliedDeltas[0].nodeId).toBe("ch-1");
    expect(body.data.appliedDeltas[1].nodeId).toBe("sc-1");
    expect(body.data.conflicts).toEqual([]);
  });

  it("update 冲突：手动改值后 from 断裂 → conflicts 非空 + state 保持手动值", async () => {
    const { app, charId } = await seed();
    // 手动编辑 data（不产生 Delta，决策 9 修订属正常用户行为）：combat_power 100 → 250
    const project = getCurrentProject()!;
    updateEntity(project.db, charId, { data: { combat_power: 250 } });
    // 挂 update Delta（from=100 已与当前值断裂）
    await postDelta(app, {
      node_id: "sc-1",
      target_type: "character",
      target_id: charId,
      changes: [{ field: "combat_power", op: "update", from: 100, to: 200 }],
      description: "过时变更",
    });
    const res = await app.request(
      "/api/v1/delta/compute",
      jsonRequest("POST", { target_type: "character", target_id: charId, at_node_id: "sc-1" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        state: Record<string, unknown>;
        appliedDeltas: Array<{ skipped?: Array<Record<string, unknown>> }>;
        conflicts: Array<Record<string, unknown>>;
      };
    };
    expect(body.data.state).toEqual({ combat_power: 250, tags: ["剑"] }); // 手动值保持，update 被跳过
    expect(body.data.conflicts).toHaveLength(1);
    expect(body.data.conflicts[0]).toMatchObject({
      deltaId: expect.stringMatching(/^delta-/),
      field: "combat_power",
      expected: 100,
      actual: 250,
    });
    expect(body.data.appliedDeltas[0].skipped).toEqual([{ index: 0, field: "combat_power", expected: 100, actual: 250 }]);
  });

  it("at_node_id 不存在 → 404 OUTLINE_NODE_NOT_FOUND", async () => {
    const { app, charId } = await seed();
    const res = await app.request(
      "/api/v1/delta/compute",
      jsonRequest("POST", { target_type: "character", target_id: charId, at_node_id: "sc-999" }),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("OUTLINE_NODE_NOT_FOUND");
  });

  it("at_node_id 指向软删节点 → 404 OUTLINE_NODE_NOT_FOUND（路由层前置校验）", async () => {
    const { app, charId } = await seed();
    // 重写大纲树：sc-1 标 deleted（决策 12 软删语义；assertOutlineNode 同 POST 前置校验）
    const project = getCurrentProject()!;
    writeOutlineFile(project.root, softDeletedSceneOutline());
    const res = await app.request(
      "/api/v1/delta/compute",
      jsonRequest("POST", { target_type: "character", target_id: charId, at_node_id: "sc-1" }),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("OUTLINE_NODE_NOT_FOUND");
  });

  it("目标实体不存在 → 404 ENTITY_NOT_FOUND", async () => {
    const { app } = await seed();
    const res = await app.request(
      "/api/v1/delta/compute",
      jsonRequest("POST", { target_type: "character", target_id: "char-999", at_node_id: "sc-1" }),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ENTITY_NOT_FOUND");
  });
});
