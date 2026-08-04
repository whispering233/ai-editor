// S6.7 executor 门面测试（executeProposal）
// 覆盖：
// - 14 个提案类型 → 12 个执行函数映射正确（proposal → 执行函数 → 结果落库；含 create_hook
//   → create_entity(type=hook) + plants 关系适配、update_hook → update_entity 适配）
// - 未知提案类型 → 抛错（防静默）
// - **执行类不注册 registry**：工具注册表（LLM 可见）不包含任何 EXECUTOR_TOOLS 名
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXECUTOR_TOOLS, type OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import {
  closeDatabase,
  createEntity,
  createRelation,
  getEntity,
  getRelation,
  listDeltasByTarget,
  listRelations,
  openDatabase,
  type Db,
} from "@whispering233/ai-editor-db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@whispering233/ai-editor-db";
import { buildProposal } from "../proposal/types.js";
import { executeProposal } from "./index.js";
import { listTools } from "../registry.js";
import * as toolsEntry from "../index.js"; // 副作用注册（32 个 LLM 可见工具）

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-exec-index-"));
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
              { id: "sc-2", type: "scene", title: "场景二", updated_at: T0 },
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

function makeProposal(type: string, args: Record<string, unknown>, summary = `摘要 ${type}`) {
  return buildProposal(makeCtx(), type, args, [], summary);
}

describe("executeProposal（proposal.type → 执行函数映射）", () => {
  it("propose_create_entity → create_entity：实体落库，返回新 id", () => {
    const result = executeProposal(makeCtx(), makeProposal("propose_create_entity", { type: "character", name: "阿强" }));
    expect(result.id).toMatch(/^char-/);
    expect(getEntity(db, result.id as string)!.name).toBe("阿强");
  });

  it("propose_update_entity → update_entity：patches 浅合并落库", () => {
    const row = createEntity(db, { type: "character", name: "阿强", data: { status: "alive" } });
    const result = executeProposal(makeCtx(), makeProposal("propose_update_entity", { entity_id: row.id, patches: { status: "dead" } }));
    expect(result).toMatchObject({ id: row.id, updated: true });
    expect(getEntity(db, row.id)!.data).toEqual({ status: "dead" });
  });

  it("propose_delete_entity → delete_entity：软删 + 级联", () => {
    const row = createEntity(db, { type: "character", name: "阿强" });
    const result = executeProposal(makeCtx(), makeProposal("propose_delete_entity", { entity_id: row.id }));
    expect(result).toMatchObject({ id: row.id, deleted: true });
    expect(getEntity(db, row.id)).toBeNull();
  });

  it("propose_add_relation → add_relation：关系落库", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const result = executeProposal(
      makeCtx(),
      makeProposal("propose_add_relation", { source_type: "character", source_id: a.id, target_type: "character", target_id: b.id, relation_type: "ally" }),
    );
    expect(result.id).toMatch(/^rel-/);
    expect(getRelation(db, result.id as string, dir)).not.toBeNull();
  });

  it("propose_remove_relation → remove_relation：物理删", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const rel = createRelation(db, { sourceType: "character", sourceId: a.id, targetType: "character", targetId: b.id, relationType: "ally" }, dir);
    const result = executeProposal(makeCtx(), makeProposal("propose_remove_relation", { relation_id: rel.id }));
    expect(result).toEqual({ id: rel.id, deleted: true });
    expect(getRelation(db, rel.id, dir)).toBeNull();
  });

  it("propose_add_delta → add_delta：description 取 proposal.summary", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    const proposal = makeProposal("propose_add_delta", { node_id: "sc-1", target_type: "character", target_id: char.id, changes: [{ field: "hp", op: "set", to: 50 }] }, "张三获得断剑认可");
    const result = executeProposal(makeCtx(), proposal);
    expect(result.id).toMatch(/^delta-/);
    expect(listDeltasByTarget(db, char.id, dir)[0].description).toBe("张三获得断剑认可");
  });

  it("propose_outline_node → create_outline_node：缺省挂根", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = executeProposal(makeCtx(), makeProposal("propose_outline_node", { type: "volume", title: "第二卷" }));
    expect(result.id).toMatch(/^vol-/);
    expect(readOutlineFile(dir).children.map((c) => c.id)).toContain(result.id);
  });

  it("propose_move_node → move_node：跨父移动", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = executeProposal(makeCtx(), makeProposal("propose_move_node", { node_id: "ch-1", parent_id: "root", order: 0 }));
    expect(result).toMatchObject({ id: "ch-1", previousParentId: "vol-1", newParentId: "root" });
  });

  it("propose_delete_node → delete_node：软删子树", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = executeProposal(makeCtx(), makeProposal("propose_delete_node", { node_id: "ch-1" }));
    expect(result).toMatchObject({ id: "ch-1", deleted: true, cascadedChildren: 2 });
    expect(findOutlineNode(readOutlineFile(dir), "ch-1")!.deleted).toBe(true);
  });

  it("propose_create_hook → 适配器：create_entity(type=hook) + plant_at_node_id 同事务补插 plants 关系", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = executeProposal(makeCtx(), makeProposal("propose_create_hook", { name: "身世之谜", plant_at_node_id: "sc-1", data: { payoff_timing: "near_term" } }));
    expect(result.id).toMatch(/^hook-/);
    const hook = getEntity(db, result.id as string)!;
    expect(hook.type).toBe("hook");
    expect(hook.data).toEqual({ payoff_timing: "near_term" });
    // plants 关系（大纲节点 → hook）
    const relations = listRelations(db, { sourceId: "sc-1" }, 1, dir).relations;
    expect(relations).toEqual([
      expect.objectContaining({ sourceType: "outline_node", sourceId: "sc-1", targetId: result.id, relationType: "plants" }),
    ]);
  });

  it("propose_create_hook 无 plant_at_node_id → 仅建实体", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = executeProposal(makeCtx(), makeProposal("propose_create_hook", { name: "无埋设" }));
    expect(getEntity(db, result.id as string)!.type).toBe("hook");
    expect(listRelations(db, {}, 3, dir).relations).toHaveLength(0);
  });

  it("propose_update_hook → update_entity 适配：hook_id 即 entity_id，patches 落库", () => {
    const hook = createEntity(db, { type: "hook", name: "身世之谜", data: { status: "planted" } });
    const result = executeProposal(makeCtx(), makeProposal("propose_update_hook", { hook_id: hook.id, patches: { payoff_timing: "endgame" } }));
    expect(result).toMatchObject({ id: hook.id, updated: true });
    expect(getEntity(db, hook.id)!.data).toEqual({ status: "planted", payoff_timing: "endgame" }); // 浅合并
  });

  it("propose_update_hook 适配器复核实体类型（S6.7 修复轮建议 4）：目标非 hook → 抛错", () => {
    const char = createEntity(db, { type: "character", name: "阿强" });
    expect(() =>
      executeProposal(makeCtx(), makeProposal("propose_update_hook", { hook_id: char.id, patches: { status: "resolved" } })),
    ).toThrow(/伏笔不存在或已软删/);
  });

  it("propose_advance_hook → advance_hook：复合写（delta + advances）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hook = createEntity(db, { type: "hook", name: "身世之谜" });
    const proposal = makeProposal("propose_advance_hook", { hook_id: hook.id, node_id: "sc-1", description: "第 12 章发现玉佩" });
    const result = executeProposal(makeCtx(), proposal);
    expect(result.id).toMatch(/^rel-/);
    expect(listDeltasByTarget(db, hook.id, dir)[0].description).toBe("第 12 章发现玉佩");
    expect(listRelations(db, { targetId: hook.id, relationType: "advances" }, 1, dir).relations).toHaveLength(1);
  });

  it("propose_resolve_hook → resolve_hook：复合写（delta + resolves）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hook = createEntity(db, { type: "hook", name: "身世之谜" });
    const result = executeProposal(makeCtx(), makeProposal("propose_resolve_hook", { hook_id: hook.id, node_id: "sc-2", description: "揭示真相" }));
    expect(result.id).toMatch(/^rel-/);
    expect(listRelations(db, { targetId: hook.id, relationType: "resolves" }, 1, dir).relations).toHaveLength(1);
  });

  it("propose_abandon_hook → abandon_hook：delta 记 status=abandoned", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hook = createEntity(db, { type: "hook", name: "身世之谜" });
    const result = executeProposal(makeCtx(), makeProposal("propose_abandon_hook", { hook_id: hook.id, description: "放弃这条线" }));
    expect(result.id).toMatch(/^delta-/);
    expect(listDeltasByTarget(db, hook.id, dir)[0].changes).toEqual([{ field: "status", op: "update", from: "planted", to: "abandoned" }]);
  });

  it("未知提案类型 → 抛错（防静默）", () => {
    expect(() => executeProposal(makeCtx(), makeProposal("propose_frobnicate", { a: 1 }))).toThrow(/未知提案类型 propose_frobnicate/);
  });
});

describe("执行类不注册 registry（tools.md「核心设计原则」：AI 不可以调用执行类工具）", () => {
  it("LLM 可见工具表（listTools）不包含任何 EXECUTOR_TOOLS 名；入口冒烟 32 个注册数不变", () => {
    const names = new Set(listTools().map((t) => t.name));
    for (const name of EXECUTOR_TOOLS) {
      expect(names.has(name)).toBe(false);
    }
    expect(toolsEntry.toolCount()).toBe(32); // 查询 8 + 分析 5 + 伏笔 5 + 提案 14（S6.7 执行 12 不注册）
  });

  it("executeProposal 导出存在（S7.5 确认路由的消费入口）", () => {
    expect(typeof toolsEntry.executeProposal).toBe("function");
  });
});
