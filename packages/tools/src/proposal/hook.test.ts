// S6.6 提案类工具测试：伏笔（propose_create/update/advance/resolve/abandon_hook）
// 覆盖：tool_result 仅 { proposal_id, summary } 无预览 / 完整提案结构（伏笔实体自身
//   updated_at + 节点级 updated_at 快照，决策 14/19）/ **不落盘**（实体/关系表零变化——
//   S6.7 复合写对比核心差异）/ 伏笔不存在/软删/类型不一致、节点不存在抛错 /
//   signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, createEntity, getEntity, listEntities, listRelations, openDatabase, softDeleteEntity, type Db } from "@ai-editor/db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@ai-editor/db";
import { AbortedError } from "../analysis/utils.js";
import {
  buildProposeAbandonHook,
  buildProposeAdvanceHook,
  buildProposeCreateHook,
  buildProposeResolveHook,
  buildProposeUpdateHook,
  runProposeAbandonHook,
  runProposeAdvanceHook,
  runProposeCreateHook,
  runProposeResolveHook,
  runProposeUpdateHook,
} from "./hook.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-prop-hook-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵 卷[章[场景一,场景二]] 的大纲树 */
function seedOutlineTree(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: T0,
        children: [
          {
            id: "ch-1",
            type: "chapter",
            title: "第一章",
            updated_at: T0,
            children: [
              { id: "sc-1", type: "scene", title: "场景一", updated_at: T0 },
            ],
          },
        ],
      },
    ],
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

/** 软删指定大纲节点（测试直写 outline.json） */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  expect(node).toBeDefined();
  node!.deleted = true;
  node!.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

/** 种一棵伏笔实体，返回其行 */
function seedHook(name = "身世之谜"): ReturnType<typeof createEntity> {
  return createEntity(db, { type: "hook", name, data: { status: "planted", payoff_timing: "mid_arc" } });
}

describe("propose_create_hook", () => {
  it("无埋设节点：无引用；tool_result 仅 { proposal_id, summary }", () => {
    const result = runProposeCreateHook(makeCtx(), { name: "玉佩来历", data: { payoff_timing: "near_term" } });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.summary).toBe("创建伏笔「玉佩来历」");
    const proposal = buildProposeCreateHook(makeCtx(), { name: "玉佩来历", data: { payoff_timing: "near_term" } });
    expect(proposal.args).toEqual({ name: "玉佩来历", data: { payoff_timing: "near_term" } });
    expect(proposal.references).toEqual([]);
    expect(proposal.project_id).toBe("proj-test");
  });

  it("指定埋设节点：引用为节点级 updated_at 快照（决策 19）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const proposal = buildProposeCreateHook(makeCtx(), { name: "玉佩来历", plant_at_node_id: "sc-1" });
    expect(proposal.references).toEqual([{ kind: "outline_node", id: "sc-1", updated_at: T0 }]);
  });

  it("不落盘：实体表零新增（S6.7 对比核心差异）；埋设节点不存在/软删 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    runProposeCreateHook(makeCtx(), { name: "玉佩来历", plant_at_node_id: "sc-1" });
    expect(listEntities(db, { type: "hook", limit: 200 }).items).toHaveLength(0);
    expect(() => runProposeCreateHook(makeCtx(), { name: "x", plant_at_node_id: "sc-999" })).toThrow(/大纲节点不存在或已软删/);
    softDeleteNode("sc-1");
    expect(() => runProposeCreateHook(makeCtx(), { name: "x", plant_at_node_id: "sc-1" })).toThrow(/大纲节点不存在或已软删/);
  });
});

describe("propose_update_hook", () => {
  it("完整提案结构：引用为伏笔实体自身 updated_at（决策 14）", () => {
    const hook = seedHook();
    const proposal = buildProposeUpdateHook(makeCtx(), { hook_id: hook.id, patches: { payoff_timing: "slow_burn" } });
    expect(proposal.args).toEqual({ hook_id: hook.id, patches: { payoff_timing: "slow_burn" } });
    expect(proposal.references).toEqual([{ kind: "entity", id: hook.id, updated_at: hook.updated_at }]);
    const result = runProposeUpdateHook(makeCtx(), { hook_id: hook.id, patches: { payoff_timing: "slow_burn" } });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.summary).toContain("更新伏笔「身世之谜」的 1 个字段");
  });

  it("不落盘：伏笔 data 不变；非 hook 实体 / 不存在 / 已软删 → 抛错", () => {
    const hook = seedHook();
    runProposeUpdateHook(makeCtx(), { hook_id: hook.id, patches: { payoff_timing: "slow_burn" } });
    expect(getEntity(db, hook.id)!.data).toEqual({ status: "planted", payoff_timing: "mid_arc" });
    const char = createEntity(db, { type: "character", name: "阿强" });
    expect(() => runProposeUpdateHook(makeCtx(), { hook_id: char.id, patches: { status: "x" } })).toThrow(/伏笔不存在或已软删/);
    expect(() => runProposeUpdateHook(makeCtx(), { hook_id: "hook-999", patches: { status: "x" } })).toThrow(/伏笔不存在或已软删/);
    softDeleteEntity(db, hook.id, T0);
    expect(() => runProposeUpdateHook(makeCtx(), { hook_id: hook.id, patches: { status: "x" } })).toThrow(/伏笔不存在或已软删/);
  });
});

describe("propose_advance_hook / propose_resolve_hook", () => {
  it("完整提案结构：伏笔实体 + 推进/回收节点双引用快照（决策 14/19）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hook = seedHook();
    const advance = buildProposeAdvanceHook(makeCtx(), { hook_id: hook.id, node_id: "sc-1", description: "玉佩现身" });
    expect(advance.type).toBe("propose_advance_hook");
    expect(advance.args).toEqual({ hook_id: hook.id, node_id: "sc-1", description: "玉佩现身" });
    expect(advance.references).toEqual([
      { kind: "entity", id: hook.id, updated_at: hook.updated_at },
      { kind: "outline_node", id: "sc-1", updated_at: T0 },
    ]);
    const resolve = buildProposeResolveHook(makeCtx(), { hook_id: hook.id, node_id: "sc-1", description: "身世揭晓" });
    expect(resolve.type).toBe("propose_resolve_hook");
    expect(resolve.references).toEqual(advance.references);
  });

  it("不落盘：实体与关系表零变化（确认后的复合写 delta+relations 属 S6.7）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hook = seedHook();
    runProposeAdvanceHook(makeCtx(), { hook_id: hook.id, node_id: "sc-1", description: "玉佩现身" });
    expect(listRelations(db, { relationType: "advances" }, 3, dir).relations).toHaveLength(0); // 无 advances 关系
    expect(getEntity(db, hook.id)!.data.status).toBe("planted"); // status 未变
    runProposeResolveHook(makeCtx(), { hook_id: hook.id, node_id: "sc-1", description: "身世揭晓" });
    expect(listRelations(db, { relationType: "resolves" }, 3, dir).relations).toHaveLength(0);
  });

  it("伏笔不存在/已软删、节点不存在/已软删 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hook = seedHook();
    expect(() => runProposeAdvanceHook(makeCtx(), { hook_id: "hook-999", node_id: "sc-1", description: "x" })).toThrow(/伏笔不存在或已软删/);
    expect(() => runProposeAdvanceHook(makeCtx(), { hook_id: hook.id, node_id: "sc-999", description: "x" })).toThrow(/大纲节点不存在或已软删/);
    softDeleteNode("sc-1");
    expect(() => runProposeResolveHook(makeCtx(), { hook_id: hook.id, node_id: "sc-1", description: "x" })).toThrow(/大纲节点不存在或已软删/);
  });
});

describe("propose_abandon_hook", () => {
  it("完整提案结构：仅伏笔实体引用；tool_result 无预览", () => {
    const hook = seedHook();
    const proposal = buildProposeAbandonHook(makeCtx(), { hook_id: hook.id, description: "线索废弃" });
    expect(proposal.references).toEqual([{ kind: "entity", id: hook.id, updated_at: hook.updated_at }]);
    const result = runProposeAbandonHook(makeCtx(), { hook_id: hook.id, description: "线索废弃" });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.summary).toBe("废弃伏笔「身世之谜」");
  });

  it("不落盘：伏笔 data 不变；不存在 → 抛错", () => {
    const hook = seedHook();
    runProposeAbandonHook(makeCtx(), { hook_id: hook.id, description: "线索废弃" });
    expect(getEntity(db, hook.id)!.data.status).toBe("planted"); // 未标 abandoned
    expect(() => runProposeAbandonHook(makeCtx(), { hook_id: "hook-999", description: "x" })).toThrow(/伏笔不存在或已软删/);
  });
});

describe("signal aborted（决策 16 ③）", () => {
  it("五个伏笔提案工具在 signal 已中止时抛 AbortedError", () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx();
    expect(() => runProposeCreateHook(ctx, { name: "x" }, controller.signal)).toThrow(AbortedError);
    expect(() => runProposeUpdateHook(ctx, { hook_id: "hook-1", patches: { status: "x" } }, controller.signal)).toThrow(AbortedError);
    expect(() => runProposeAdvanceHook(ctx, { hook_id: "hook-1", node_id: "sc-1", description: "x" }, controller.signal)).toThrow(AbortedError);
    expect(() => runProposeResolveHook(ctx, { hook_id: "hook-1", node_id: "sc-1", description: "x" }, controller.signal)).toThrow(AbortedError);
    expect(() => runProposeAbandonHook(ctx, { hook_id: "hook-1", description: "x" }, controller.signal)).toThrow(AbortedError);
  });
});
