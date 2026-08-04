// S6.7 执行类工具测试：实体（create_entity / update_entity / delete_entity）
// 覆盖：写路径正确性（创建 id 前缀 + data 落库 / 更新浅合并 + updated_at 刷新 /
//   软删级联 relations+deltas 且本体保留）、失败语义（实体不存在/已软删抛错）、
//   参数防御（缺字段抛错）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import {
  closeDatabase,
  createEntity,
  createRelation,
  getEntity,
  insertDelta,
  listRelations,
  openDatabase,
  type Db,
} from "@whispering233/ai-editor-db";
import { writeOutlineFile } from "@whispering233/ai-editor-db";
import { buildProposal } from "../proposal/types.js";
import { executeCreateEntity, executeDeleteEntity, executeUpdateEntity } from "./entity.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-exec-entity-"));
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
            children: [{ id: "sc-1", type: "scene", title: "场景一", updated_at: T0 }],
          },
        ],
      },
    ],
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

function makeProposal(type: string, args: Record<string, unknown>): ReturnType<typeof buildProposal> {
  return buildProposal(makeCtx(), type, args, [], `测试摘要 ${type}`);
}

describe("create_entity", () => {
  it("写路径：type/name/data 落库，返回新 id（前缀 + 类型一致）", () => {
    const result = executeCreateEntity(makeCtx(), makeProposal("propose_create_entity", { type: "character", name: "阿强", data: { role: "主角" } }));
    expect(result.id).toMatch(/^char-/);
    const row = getEntity(db, result.id as string)!;
    expect(row).toMatchObject({ type: "character", name: "阿强", data: { role: "主角" } });
  });

  it("data 缺省 {}：不传 data 也可创建", () => {
    const result = executeCreateEntity(makeCtx(), makeProposal("propose_create_entity", { type: "location", name: "客栈" }));
    expect(getEntity(db, result.id as string)!.data).toEqual({});
  });

  it("缺 type/name → 抛错（参数防御，防脏调用）", () => {
    expect(() => executeCreateEntity(makeCtx(), makeProposal("propose_create_entity", { type: "character" }))).toThrow(/执行参数缺失或非法: name/);
    expect(() => executeCreateEntity(makeCtx(), makeProposal("propose_create_entity", { name: "x" }))).toThrow(/执行参数缺失或非法: type/);
  });
});

describe("update_entity", () => {
  it("写路径：patches 浅合并进 data（未传字段保留），updated_at 刷新，返回 id + updated", () => {
    const row = createEntity(db, { type: "character", name: "阿强", data: { role: "主角", status: "alive" } });
    const result = executeUpdateEntity(makeCtx(), makeProposal("propose_update_entity", { entity_id: row.id, patches: { status: "dead" } }));
    expect(result).toMatchObject({ id: row.id, updated: true });
    const updated = getEntity(db, row.id)!;
    expect(updated.data).toEqual({ role: "主角", status: "dead" }); // role 保留（浅合并）
    expect(updated.updated_at >= row.updated_at).toBe(true); // updated_at 应用层刷新（决策 14 快照比对）
  });

  it("实体不存在 → 抛错（fail-fast）", () => {
    expect(() => executeUpdateEntity(makeCtx(), makeProposal("propose_update_entity", { entity_id: "char-999", patches: { a: 1 } }))).toThrow(/实体不存在或已软删/);
  });

  it("软删实体不可更新 → 抛错（决策 12：getEntity 过滤）", () => {
    const row = createEntity(db, { type: "character", name: "阿强" });
    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, row.id);
    expect(() => executeUpdateEntity(makeCtx(), makeProposal("propose_update_entity", { entity_id: row.id, patches: { a: 1 } }))).toThrow(/实体不存在或已软删/);
  });
});

describe("delete_entity", () => {
  it("写路径：软删 + 级联关系与 Delta（决策 12），本体保留可还原", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    createRelation(db, { sourceType: "character", sourceId: a.id, targetType: "character", targetId: b.id, relationType: "ally" }, dir);
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: a.id, changes: [{ field: "hp", op: "set", to: 1 }], description: "d" });
    const result = executeDeleteEntity(makeCtx(), makeProposal("propose_delete_entity", { entity_id: a.id }));
    expect(result).toMatchObject({ id: a.id, deleted: true, cascaded: { relations: 1, deltas: 1 } });
    // 本体保留（回收站可还原），常规查询不可见
    expect(getEntity(db, a.id)).toBeNull();
    expect(db.prepare("SELECT id FROM entities WHERE id = ? AND deleted_at IS NOT NULL").get(a.id)).toBeDefined();
    expect(listRelations(db, {}, 3, dir).relations).toHaveLength(0); // 关系级联软删
  });

  it("实体不存在/已软删 → 抛错（fail-fast）", () => {
    expect(() => executeDeleteEntity(makeCtx(), makeProposal("propose_delete_entity", { entity_id: "char-999" }))).toThrow(/实体不存在或已软删/);
    const row = createEntity(db, { type: "character", name: "阿强" });
    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, row.id);
    expect(() => executeDeleteEntity(makeCtx(), makeProposal("propose_delete_entity", { entity_id: row.id }))).toThrow(/实体不存在或已软删/);
  });
});

describe("signal（决策 16 ③）", () => {
  it("执行类是短同步事务，无 signal 参数（中止检查由 S7.5 确认路由承担——见 executor/types.ts 注释）", () => {
    const result = executeCreateEntity(makeCtx(), makeProposal("propose_create_entity", { type: "setting", name: "宗门" }));
    expect(getEntity(db, result.id as string)!.name).toBe("宗门");
  });
});
