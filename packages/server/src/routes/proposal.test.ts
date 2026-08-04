// 提案路由测试（S7.5）：POST /api/v1/proposal/:proposalId/confirm | reject
// 覆盖：confirm 成功（无引用 create / 实体引用 update / 关系 remove / Delta 引用）、
//       快照过期（实体 updated_at 变化 / 实体软删 / 关系物理删 / 大纲节点 updated_at 变化 /
//       大纲节点软删 / Delta 级联软删 → 409 PROPOSAL_STALE，且提案被一次性移除）、
//       404 PROPOSAL_NOT_FOUND（不存在）、409 PROPOSAL_PROJECT_MISMATCH（跨项目，提案保留）、
//       执行失败 → 500 INTERNAL_ERROR（幂等冲突，提案同样移除）、
//       reject 成功移除 / 404 / 409 MISMATCH（决策 14 修订：reject 同校验）
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  createEntity,
  createRelation,
  deleteRelation,
  findOutlineNode,
  getDeltaRow,
  getEntity,
  getRelation,
  readOutlineFile,
  SCHEMA_VERSION,
  softDeleteEntity,
  updateEntity,
  updateOutlineNodeInfo,
  writeOutlineFile,
} from "@whispering233/ai-editor-db";
import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import { defaultProposalStore } from "@whispering233/ai-editor-agent";
import { buildProposal, refEntity, refOutlineNode, refRelation } from "@whispering233/ai-editor-tools";
import type { Proposal } from "@whispering233/ai-editor-tools";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { proposalRoutes } from "./proposal.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "proposal-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（proposal 路由） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/proposal", proposalRoutes);
  return app;
}

/** POST 辅助（proposal 端点无请求体） */
function postRequest(): RequestInit {
  return { method: "POST", headers: HOST_HEADERS };
}

/** 标准大纲树：卷 vol-1 → 章 ch-1 → 场景 sc-1（节点级 updated_at，决策 19） */
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

/** 大纲树变体：sc-1 已软删（决策 12 软删语义；outline_node 引用快照应 409 STALE） */
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

/** open 项目 + 标准大纲树 + 角色实体 + 实体→场景 appears_in 关系，返回 { app, charId, relId } */
function seed(): { app: Hono; charId: string; relId: string } {
  const dir = makeTmpDir();
  setCurrentProject(initProject(dir));
  writeOutlineFile(dir, standardOutline());
  const project = getCurrentProject()!;
  const char = createEntity(project.db, { type: "character", name: "阿强", data: { status: "alive" } });
  const rel = createRelation(
    project.db,
    {
      sourceType: "character",
      sourceId: char.id,
      targetType: "outline_node",
      targetId: "sc-1",
      relationType: "appears_in",
    },
    project.root,
  );
  return { app: buildApp(), charId: char.id, relId: rel.id };
}

/** 当前项目工具上下文（buildProposal 绑定 project_id 用） */
function toolCtx() {
  const project = getCurrentProject()!;
  return { db: project.db, outlineDir: project.root, projectId: project.config.id };
}

/** sc-1 节点（findOutlineNode 查树取引用快照；避开 OutlineFileNode 联合类型的 children 索引） */
function sceneNode() {
  return findOutlineNode(readOutlineFile(getCurrentProject()!.root), "sc-1")!;
}

/** 等待 ≥1ms：nowIso 为毫秒精度（atomic.ts），连续操作同毫秒时间戳相等会让快照比对误判通过 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

/** POST confirm 辅助（返回 { status, body }） */
async function confirmProposal(
  app: Hono,
  proposalId: string,
): Promise<{
  status: number;
  body: {
    success: boolean;
    data?: { confirmed: true; result: Record<string, unknown> };
    error?: { code: string; message?: string };
  };
}> {
  const res = await app.request(`/api/v1/proposal/${proposalId}/confirm`, postRequest());
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: { confirmed: true; result: Record<string, unknown> }; error?: { code: string; message?: string } } };
}

/** POST reject 辅助（返回 { status, body }） */
async function rejectProposal(
  app: Hono,
  proposalId: string,
): Promise<{ status: number; body: { success: boolean; data?: { rejected: true }; error?: { code: string; message?: string } } }> {
  const res = await app.request(`/api/v1/proposal/${proposalId}/reject`, postRequest());
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: { rejected: true }; error?: { code: string; message?: string } } };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-proposal-"));
  setCurrentProject(null);
  defaultProposalStore.clear(); // 仓为模块级单例（与调度同仓，S7.4），测试间隔离
});

afterEach(() => {
  const cur = getCurrentProject();
  if (cur !== null) {
    closeProject(cur);
    setCurrentProject(null);
  }
  defaultProposalStore.clear();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ============ confirm 成功路径 ============

describe("POST /api/v1/proposal/:proposalId/confirm 成功", () => {
  it("无引用提案（propose_create_entity）→ 200 confirmed + 实体落库 + 仓内移除（一次性消费）", async () => {
    const { app } = await seed();
    const proposal = buildProposal(
      toolCtx(),
      "propose_create_entity",
      { type: "character", name: "李四" },
      [],
      "创建实体「李四」（character）",
    );
    defaultProposalStore.set(proposal);

    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.confirmed).toBe(true);
    const newId = body.data?.result?.id;
    expect(String(newId)).toMatch(/^char-/);
    expect(getEntity(getCurrentProject()!.db, String(newId))).toMatchObject({ name: "李四", type: "character" });
    expect(defaultProposalStore.peek(proposal.proposal_id)).toBeNull(); // 确认后提案作废
  });

  it("实体引用提案（propose_update_entity）→ 200 + patches 生效 + updated_at 刷新", async () => {
    const { app, charId } = await seed();
    const before = getEntity(getCurrentProject()!.db, charId)!;
    const proposal = buildProposal(
      toolCtx(),
      "propose_update_entity",
      { entity_id: charId, patches: { status: "dead" } },
      [refEntity(before)],
      "更新实体「阿强」的 1 个字段",
    );
    defaultProposalStore.set(proposal);

    await tick(); // 确认执行时间戳严格晚于快照（毫秒精度，updated_at 变化断言防同毫秒相等）
    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(200);
    expect(body.data?.result?.id).toBe(charId);
    const after = getEntity(getCurrentProject()!.db, charId)!;
    expect(after.data).toMatchObject({ status: "dead" });
    expect(after.updated_at).not.toBe(before.updated_at);
  });

  it("关系引用提案（propose_remove_relation）→ 200 + 关系物理删除（决策 12）", async () => {
    const { app, relId } = await seed();
    const rel = getRelation(getCurrentProject()!.db, relId, getCurrentProject()!.root)!;
    const proposal = buildProposal(
      toolCtx(),
      "propose_remove_relation",
      { relation_id: relId },
      [refRelation(rel)],
      "移除关系",
    );
    defaultProposalStore.set(proposal);

    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(200);
    expect(body.data?.result?.id).toBe(relId);
    expect(getRelation(getCurrentProject()!.db, relId, getCurrentProject()!.root)).toBeNull();
  });

  it("outline_node 引用提案（propose_add_delta）→ 200 + Delta 落库", async () => {
    const { app, charId } = await seed();
    const project = getCurrentProject()!;
    const proposal = buildProposal(
      toolCtx(),
      "propose_add_delta",
      { node_id: "sc-1", target_type: "character", target_id: charId, changes: [{ field: "status", op: "set", to: "dead" }] },
      [refOutlineNode(sceneNode()), refEntity(getEntity(project.db, charId)!)],
      "为节点「场景一」追加 1 项属性变更",
    );
    defaultProposalStore.set(proposal);

    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(200);
    expect(String(body.data?.result?.id)).toMatch(/^delta-/);
    expect(defaultProposalStore.peek(proposal.proposal_id)).toBeNull();
  });
});

// ============ 快照过期（决策 14：存在性 + updated_at 任一失败 → 409 PROPOSAL_STALE） ============

describe("confirm 快照重校验 → 409 PROPOSAL_STALE", () => {
  it("实体 updated_at 变化（确认前被手动编辑）→ 409 + 提案移除", async () => {
    const { app, charId } = await seed();
    const before = getEntity(getCurrentProject()!.db, charId)!;
    const proposal = buildProposal(
      toolCtx(),
      "propose_update_entity",
      { entity_id: charId, patches: { status: "dead" } },
      [refEntity(before)],
      "更新实体",
    );
    defaultProposalStore.set(proposal);
    // 入仓后手动编辑实体：updated_at 刷新（决策 12 修订），快照断裂
    await tick(); // 确保编辑时间戳严格晚于快照（毫秒精度，防同毫秒相等误判）
    updateEntity(getCurrentProject()!.db, charId, { data: { status: "wounded" } });

    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(409);
    expect(body.error?.code).toBe("PROPOSAL_STALE");
    expect(defaultProposalStore.peek(proposal.proposal_id)).toBeNull(); // 终态即消费
  });

  it("引用实体被软删 → 409 PROPOSAL_STALE", async () => {
    const { app, charId } = await seed();
    const before = getEntity(getCurrentProject()!.db, charId)!;
    const proposal = buildProposal(
      toolCtx(),
      "propose_delete_entity",
      { entity_id: charId },
      [refEntity(before)],
      "删除实体",
    );
    defaultProposalStore.set(proposal);
    // 入仓后实体被软删（getEntity 过滤软删 → 不存在）
    softDeleteEntity(getCurrentProject()!.db, charId, "2026-08-02T10:00:00Z");

    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(409);
    expect(body.error?.code).toBe("PROPOSAL_STALE");
  });

  it("引用关系被物理删除 → 409 PROPOSAL_STALE", async () => {
    const { app, relId } = await seed();
    const rel = getRelation(getCurrentProject()!.db, relId, getCurrentProject()!.root)!;
    const proposal = buildProposal(
      toolCtx(),
      "propose_remove_relation",
      { relation_id: relId },
      [refRelation(rel)],
      "移除关系",
    );
    defaultProposalStore.set(proposal);
    deleteRelation(getCurrentProject()!.db, relId);

    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(409);
    expect(body.error?.code).toBe("PROPOSAL_STALE");
  });

  it("大纲节点 updated_at 变化（节点级快照，决策 19）→ 409 PROPOSAL_STALE", async () => {
    const { app, charId } = await seed();
    const proposal = buildProposal(
      toolCtx(),
      "propose_add_delta",
      { node_id: "sc-1", target_type: "character", target_id: charId, changes: [{ field: "status", op: "set", to: "dead" }] },
      [refOutlineNode(sceneNode()), refEntity(getEntity(getCurrentProject()!.db, charId)!)],
      "为节点追加变更",
    );
    defaultProposalStore.set(proposal);
    // 入仓后节点信息被编辑：节点级 updated_at 刷新（决策 19）
    updateOutlineNodeInfo(getCurrentProject()!.root, "sc-1", { title: "场景一（改）" }, "2026-08-02T10:00:00Z");

    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(409);
    expect(body.error?.code).toBe("PROPOSAL_STALE");
  });

  it("大纲节点被软删 → 409 PROPOSAL_STALE", async () => {
    const { app, charId } = await seed();
    const proposal = buildProposal(
      toolCtx(),
      "propose_add_delta",
      { node_id: "sc-1", target_type: "character", target_id: charId, changes: [{ field: "status", op: "set", to: "dead" }] },
      [refOutlineNode(sceneNode()), refEntity(getEntity(getCurrentProject()!.db, charId)!)],
      "为节点追加变更",
    );
    defaultProposalStore.set(proposal);
    writeOutlineFile(getCurrentProject()!.root, softDeletedSceneOutline()); // sc-1 标 deleted

    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(409);
    expect(body.error?.code).toBe("PROPOSAL_STALE");
  });

  it("引用 Delta 被级联软删（目标实体软删联动）→ 409 PROPOSAL_STALE", async () => {
    const { app, charId } = await seed();
    const project = getCurrentProject()!;
    // 先造一条 Delta 记录作为引用对象（delta_records 自身 updated_at 快照）
    const refsProposal = buildProposal(
      toolCtx(),
      "propose_add_delta",
      { node_id: "sc-1", target_type: "character", target_id: charId, changes: [{ field: "status", op: "set", to: "dead" }] },
      [refOutlineNode(sceneNode()), refEntity(getEntity(project.db, charId)!)],
      "先执行一次",
    );
    defaultProposalStore.set(refsProposal);
    const { body } = await confirmProposal(app, refsProposal.proposal_id);
    const deltaId = String(body.data?.result?.id);
    expect(deltaId).toMatch(/^delta-/);
    // 手构造带 kind=delta 引用的提案（S6.6 现无工具产出该 kind，契约仍须支持——决策 14 四类引用）；
    // updated_at 取刚插入行的真实值（confirm 结果不含 updated_at，读库取准）
    const deltaProposal: Proposal = {
      ...buildProposal(
        toolCtx(),
        "propose_add_delta",
        { node_id: "sc-1", target_type: "character", target_id: charId, changes: [{ field: "status", op: "set", to: "dead" }] },
        [],
        "带 delta 引用",
      ),
      references: [{ kind: "delta", id: deltaId, updated_at: getDeltaRow(project.db, deltaId)!.updated_at }],
    };
    defaultProposalStore.set(deltaProposal);
    // 入仓后目标实体软删 → 级联软删其 Delta（决策 12）→ 引用记录消失
    softDeleteEntity(project.db, charId, "2026-08-02T10:00:00Z");

    const { status, body: staleBody } = await confirmProposal(app, deltaProposal.proposal_id);
    expect(status).toBe(409);
    expect(staleBody.error?.code).toBe("PROPOSAL_STALE");
  });
});

// ============ 404 / 409 MISMATCH ============

describe("confirm 不存在 / 跨项目", () => {
  it("proposal_id 不存在 → 404 PROPOSAL_NOT_FOUND", async () => {
    const { app } = await seed();
    const { status, body } = await confirmProposal(app, "prop-nonexistent");
    expect(status).toBe(404);
    expect(body.error?.code).toBe("PROPOSAL_NOT_FOUND");
  });

  it("提案属于其他项目 → 409 PROPOSAL_PROJECT_MISMATCH（防御性，且不误删他项目提案）", async () => {
    const { app } = await seed();
    const proposal = buildProposal(
      toolCtx(),
      "propose_create_entity",
      { type: "character", name: "外人" },
      [],
      "他项目提案",
    );
    proposal.project_id = "proj-other"; // 篡改项目绑定模拟跨项目
    defaultProposalStore.set(proposal);

    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(409);
    expect(body.error?.code).toBe("PROPOSAL_PROJECT_MISMATCH");
    expect(defaultProposalStore.peek(proposal.proposal_id)).not.toBeNull(); // 跨项目不消费
  });
});

// ============ 执行失败（快照通过但落库冲突） ============

describe("confirm 执行失败", () => {
  it("关系已存在（幂等冲突）→ 500 INTERNAL_ERROR + 提案移除", async () => {
    const { app, charId } = await seed();
    const project = getCurrentProject()!;
    // 引用端点快照仍新鲜（char 未变、sc-1 未变），但同三元组关系已存在
    const char = getEntity(project.db, charId)!;
    const proposal = buildProposal(
      toolCtx(),
      "propose_add_relation",
      {
        source_type: "character",
        source_id: charId,
        target_type: "outline_node",
        target_id: "sc-1",
        relation_type: "appears_in",
      },
      [refEntity(char), refOutlineNode(sceneNode())],
      "新增关系（重复）",
    );
    defaultProposalStore.set(proposal);

    const { status, body } = await confirmProposal(app, proposal.proposal_id);
    expect(status).toBe(500);
    expect(body.error?.code).toBe("INTERNAL_ERROR");
    expect(defaultProposalStore.peek(proposal.proposal_id)).toBeNull(); // 终态即消费（文件头注释）
  });
});

// ============ reject ============

describe("POST /api/v1/proposal/:proposalId/reject", () => {
  it("存在且同项目 → 200 { rejected: true } + 仓内移除", async () => {
    const { app } = await seed();
    const proposal = buildProposal(
      toolCtx(),
      "propose_create_entity",
      { type: "character", name: "不要了" },
      [],
      "待拒绝提案",
    );
    defaultProposalStore.set(proposal);

    const res = await app.request(`/api/v1/proposal/${proposal.proposal_id}/reject`, postRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { rejected: true } };
    expect(body).toEqual({ success: true, data: { rejected: true } });
    expect(defaultProposalStore.peek(proposal.proposal_id)).toBeNull();
  });

  it("proposal_id 不存在 → 404 PROPOSAL_NOT_FOUND", async () => {
    const { app } = await seed();
    const { status, body } = await rejectProposal(app, "prop-nonexistent");
    expect(status).toBe(404);
    expect(body.error?.code).toBe("PROPOSAL_NOT_FOUND");
  });

  it("提案属于其他项目 → 409 PROPOSAL_PROJECT_MISMATCH（决策 14 修订：reject 同 confirm 校验）", async () => {
    const { app } = await seed();
    const proposal = buildProposal(
      toolCtx(),
      "propose_create_entity",
      { type: "character", name: "外人" },
      [],
      "他项目提案",
    );
    proposal.project_id = "proj-other";
    defaultProposalStore.set(proposal);

    const { status, body } = await rejectProposal(app, proposal.proposal_id);
    expect(status).toBe(409);
    expect(body.error?.code).toBe("PROPOSAL_PROJECT_MISMATCH");
    expect(defaultProposalStore.peek(proposal.proposal_id)).not.toBeNull(); // 跨项目不消费
  });
});
