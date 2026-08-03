// S6.3 查询工具测试：query_relationships
// 覆盖：depth=1 直接关系（含联表 name）/ 端点过滤 / relation_type 过滤 /
//   端点软删不可见（决策 12 修订：实体端点软删 / 大纲节点软删均不可见）/
//   depth=3 全量路径结构
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@ai-editor/db";
import { createEntity, softDeleteEntity } from "@ai-editor/db";
import { createRelation } from "@ai-editor/db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@ai-editor/db";
import { runQueryRelationships } from "./relation.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-relation-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵 卷[章[场景一,场景二]] 的大纲树（sc-1/sc-2 可作关系端点） */
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

/** 种子：大纲树 + 角色阿强/阿珍 + 一条 ally 关系，返回 id */
function seedBase(): { charA: string; charB: string } {
  writeOutlineFile(dir, seedOutlineTree());
  const charA = createEntity(db, { type: "character", name: "阿强" }).id;
  const charB = createEntity(db, { type: "character", name: "阿珍" }).id;
  createRelation(
    db,
    { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" },
    dir,
  );
  return { charA, charB };
}

/** 直接改 outline.json 软删指定节点（db 无大纲软删 API，测试直写，compute-state.test.ts 同款） */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  expect(node).toBeDefined();
  node!.deleted = true;
  node!.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

describe("query_relationships depth=1", () => {
  it("直接关系返回 relations（含 sourceName/targetName 联表 + metadata）", () => {
    const { charA, charB } = seedBase();
    const result = runQueryRelationships(makeCtx(), { depth: 1 });
    expect(result.relations).toHaveLength(1);
    const rel = result.relations[0];
    expect(rel.sourceId).toBe(charA);
    expect(rel.sourceName).toBe("阿强");
    expect(rel.targetId).toBe(charB);
    expect(rel.targetName).toBe("阿珍");
    expect(rel.relationType).toBe("ally");
    expect(result.paths).toBeUndefined(); // depth=1 无路径
  });

  it("端点过滤（source_id/target_id）与 relation_type 过滤", () => {
    const { charA, charB } = seedBase();
    createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "outline_node", targetId: "sc-1", relationType: "appears_in" },
      dir,
    );
    expect(runQueryRelationships(makeCtx(), { depth: 1, source_id: charA }).relations).toHaveLength(2);
    expect(runQueryRelationships(makeCtx(), { depth: 1, source_id: charB }).relations).toHaveLength(0);
    expect(runQueryRelationships(makeCtx(), { depth: 1, relation_type: "ally" }).relations).toHaveLength(1);
    expect(runQueryRelationships(makeCtx(), { depth: 1, relation_type: "appears_in" }).relations).toHaveLength(1);
  });

  it("实体端点软删 → 关系不可见（决策 12 修订）", () => {
    const { charB } = seedBase();
    softDeleteEntity(db, charB, T0);
    const result = runQueryRelationships(makeCtx(), { depth: 1 });
    expect(result.relations).toEqual([]);
  });

  it("大纲节点端点软删 → 关系不可见（决策 12 修订：端点软删联动）", () => {
    const { charA } = seedBase();
    createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "outline_node", targetId: "sc-1", relationType: "appears_in" },
      dir,
    );
    softDeleteNode("sc-1");
    const result = runQueryRelationships(makeCtx(), { depth: 1 });
    // 只剩 charA → charB 的 ally；appears_in 因端点软删不可见
    expect(result.relations.map((r) => r.relationType)).toEqual(["ally"]);
  });
});

describe("query_relationships depth=2/3", () => {
  it("depth=3 全量路径：多跳链结构（nodes/edges）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "阿强" }).id;
    const b = createEntity(db, { type: "character", name: "阿珍" }).id;
    const c = createEntity(db, { type: "character", name: "阿刚" }).id;
    createRelation(db, { sourceType: "character", sourceId: a, targetType: "character", targetId: b, relationType: "ally" }, dir);
    createRelation(db, { sourceType: "character", sourceId: b, targetType: "character", targetId: c, relationType: "rival" }, dir);

    const result = runQueryRelationships(makeCtx(), { depth: 3, source_id: a });
    expect(result.relations).toHaveLength(1); // relations 按过滤条件返回
    expect(result.paths).toBeDefined();
    // 路径 a→b 与 a→b→c
    const paths = result.paths!;
    expect(paths.some((p) => p.nodes.map((n) => n.id).join(">") === `${a}>${b}`)).toBe(true);
    expect(paths.some((p) => p.nodes.map((n) => n.id).join(">") === `${a}>${b}>${c}`)).toBe(true);
    // 路径边携带关系类型与名称
    const twoHop = paths.find((p) => p.nodes.length === 3)!;
    expect(twoHop.edges).toEqual([
      { from: a, to: b, relationType: "ally" },
      { from: b, to: c, relationType: "rival" },
    ]);
    expect(twoHop.nodes.map((n) => n.name)).toEqual(["阿强", "阿珍", "阿刚"]);
  });

  it("k 跳路径同样过滤软删端点（BFS 图可见性，决策 12 修订）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "阿强" }).id;
    const b = createEntity(db, { type: "character", name: "阿珍" }).id;
    const c = createEntity(db, { type: "character", name: "阿刚" }).id;
    createRelation(db, { sourceType: "character", sourceId: a, targetType: "character", targetId: b, relationType: "ally" }, dir);
    createRelation(db, { sourceType: "character", sourceId: b, targetType: "character", targetId: c, relationType: "rival" }, dir);
    softDeleteEntity(db, b, T0); // 中间端点软删 → 全图不可达

    const result = runQueryRelationships(makeCtx(), { depth: 3 });
    expect(result.paths).toEqual([]);
    expect(result.relations).toEqual([]);
  });
});
