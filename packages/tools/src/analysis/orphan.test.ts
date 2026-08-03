// S6.4 分析工具测试：find_orphan_elements
// 覆盖：unused_characters（从未出场 / 最后活跃章 < 最新章）/ unresolved_deltas（目标不可见）/
//   dangling_relations（端点 purge）/ inconsistent_soft_deletes（节点软删未级联 relation/delta）/
//   软删对象不出现（决策 12）/ signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@ai-editor/db";
import { createEntity, softDeleteEntity } from "@ai-editor/db";
import { createRelation, insertDelta } from "@ai-editor/db";
import { findOutlineNode, readOutlineFile, writeOutlineFile, writeProjectFile } from "@ai-editor/db";
import { runFindOrphanElements } from "./orphan.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-orphan-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 两章结构：ch-1[sc-1,sc-2]（第 1 章）+ ch-2[sc-3,sc-4]（第 2 章）——章节序现推（决策 21） */
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
          {
            id: "ch-2",
            type: "chapter",
            title: "第二章",
            updated_at: T0,
            children: [
              { id: "sc-3", type: "scene", title: "场景三", updated_at: T0 },
              { id: "sc-4", type: "scene", title: "场景四", updated_at: T0 },
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

/** 角色出场（appears_in 关系：角色 → 大纲节点） */
function appearsIn(characterId: string, nodeId: string): void {
  createRelation(
    db,
    { sourceType: "character", sourceId: characterId, targetType: "outline_node", targetId: nodeId, relationType: "appears_in" },
    dir,
  );
}

/** 直接 SQL 插入关系行（悬空关系无法经 createRelation 构造——端点存在性校验） */
function insertRelationRaw(
  input: { sourceType: string; sourceId: string; targetType: string; targetId: string; relationType: string },
): { id: string } {
  const id = `rel-test-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(id, input.sourceType, input.sourceId, input.targetType, input.targetId, input.relationType, T0, T0);
  return { id };
}

/** 直接改 outline.json 软删指定节点 */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId)!;
  node.deleted = true;
  node.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

/** 大纲节点物理删除（purge 语义：从树中移除） */
function purgeNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const ch1 = findOutlineNode(tree, "ch-1")!;
  if (ch1.type !== "chapter") throw new Error("fixture 缺失 ch-1");
  ch1.children = ch1.children!.filter((c) => c.id !== nodeId);
  writeOutlineFile(dir, tree);
}

describe("find_orphan_elements unused_characters", () => {
  it("从未出场 / 最后活跃章早于最新章 → 检出；当前章活跃与软删角色不列", () => {
    writeOutlineFile(dir, seedOutlineTree());
    createEntity(db, { type: "character", name: "隐形人" }); // 无任何记录
    const stale = createEntity(db, { type: "character", name: "掉线者" }).id; // 第 1 章出场
    const active = createEntity(db, { type: "character", name: "活跃者" }).id; // 第 2 章出场
    const viaDelta = createEntity(db, { type: "character", name: "变更活跃" }).id; // delta 在第 2 章
    const deleted = createEntity(db, { type: "character", name: "幽灵角色" }).id; // 软删 → 不参与

    appearsIn(stale, "sc-1"); // ch-1（第 1 章）
    appearsIn(active, "sc-3"); // ch-2（第 2 章）
    insertDelta(db, { nodeId: "sc-4", targetType: "character", targetId: viaDelta, changes: [{ field: "power", op: "set", to: "1" }], description: "第2章变更" });
    softDeleteEntity(db, deleted, T0);

    const { unused_characters } = runFindOrphanElements(makeCtx(), {});
    const byName = new Map(unused_characters.map((u) => [u.name, u]));
    expect(byName.get("隐形人")).toMatchObject({ lastActiveChapter: null });
    expect(byName.get("隐形人")!.description).toContain("从未出场");
    expect(byName.get("掉线者")).toMatchObject({ lastActiveChapter: 1 });
    expect(byName.get("掉线者")!.description).toContain("第 1 章");
    expect(byName.get("掉线者")!.description).toContain("第 2 章"); // 当前最新章
    expect(byName.has("活跃者")).toBe(false); // 最新章出场
    expect(byName.has("变更活跃")).toBe(false); // delta 活跃于最新章
    expect(byName.has("幽灵角色")).toBe(false); // 软删不参与
  });

  it("「当前最新章」口径 = current_position（决策 21）：规划未写章节的活跃角色不误报", () => {
    // 三章树：ch-1[sc-1]（第 1 章）/ ch-2[sc-2]（第 2 章）/ ch-3[sc-3]（第 3 章）
    writeOutlineFile(dir, {
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
            {
              id: "ch-2",
              type: "chapter",
              title: "第二章",
              updated_at: T0,
              children: [{ id: "sc-2", type: "scene", title: "场景二", updated_at: T0 }],
            },
            {
              id: "ch-3",
              type: "chapter",
              title: "第三章",
              updated_at: T0,
              children: [{ id: "sc-3", type: "scene", title: "场景三", updated_at: T0 }],
            },
          ],
        },
      ],
    });
    // 写到第 1 章（current_position = sc-1）；树规划 3 章
    writeProjectFile(dir, {
      id: "proj-test",
      name: "测试书",
      language: "zh",
      prompt: "",
      schema_version: 1,
      current_position: "sc-1",
      created_at: T0,
      updated_at: T0,
    });
    const future = createEntity(db, { type: "character", name: "预写角色" }).id; // 活跃于第 2 章（规划未写）
    const current = createEntity(db, { type: "character", name: "当前角色" }).id; // 活跃于第 1 章
    appearsIn(future, "sc-2"); // 第 2 章——旧口径（树末章 3）会误报「已 1 章未出场」
    appearsIn(current, "sc-1"); // 第 1 章 = current_position

    const result = runFindOrphanElements(makeCtx(), {});
    const byName = new Map(result.unused_characters.map((u) => [u.name, u]));
    expect(byName.has("预写角色")).toBe(false); // 活跃于未写章节不算闲置（新口径）
    expect(byName.has("当前角色")).toBe(false);

    // 推进 current_position 到第 3 章后：预写角色第 2 章 < 当前第 3 章 → 闲置
    writeProjectFile(dir, {
      id: "proj-test",
      name: "测试书",
      language: "zh",
      prompt: "",
      schema_version: 1,
      current_position: "sc-3",
      created_at: T0,
      updated_at: T0,
    });
    const advanced = runFindOrphanElements(makeCtx(), {});
    const byName2 = new Map(advanced.unused_characters.map((u) => [u.name, u]));
    expect(byName2.get("预写角色")).toMatchObject({ lastActiveChapter: 2 });
    expect(byName2.get("预写角色")!.description).toContain("当前最新第 3 章");
    // 「当前角色」最后活跃第 1 章，写到第 3 章后同样闲置（口径一致性：以 current_position 为基准）
    expect(byName2.get("当前角色")).toMatchObject({ lastActiveChapter: 1 });
  });
});

describe("find_orphan_elements 悬空与不一致", () => {
  it("unresolved_deltas：目标端点软删/缺失的 delta；trigger_missing 也列入", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const target = createEntity(db, { type: "character", name: "目标" }).id;
    insertDelta(db, { nodeId: "sc-2", targetType: "character", targetId: target, changes: [{ field: "a", op: "set", to: "1" }], description: "目标将软删" });
    insertDelta(db, { nodeId: "sc-2", targetType: "character", targetId: "char-ghost", changes: [{ field: "b", op: "set", to: "2" }], description: "目标已缺失" });
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: target, changes: [{ field: "c", op: "set", to: "3" }], description: "触发节点已缺失" });

    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, target); // 目标软删（delta 未级联）
    purgeNode("sc-1"); // 触发节点物理删除 → trigger_missing

    const { unresolved_deltas } = runFindOrphanElements(makeCtx(), {});
    const byDesc = new Map(unresolved_deltas.map((d) => [d.description, d]));
    expect(byDesc.get("目标将软删")).toMatchObject({ reason: "target_deleted" });
    expect(byDesc.get("目标已缺失")).toMatchObject({ reason: "target_missing" });
    expect(byDesc.get("触发节点已缺失")).toMatchObject({ reason: "trigger_missing" });
    expect(unresolved_deltas).toHaveLength(3);
  });

  it("dangling_relations：端点物理删除的关系（purge 残留）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "阿强" }).id;
    const rel = insertRelationRaw({ sourceType: "character", sourceId: a, targetType: "outline_node", targetId: "sc-gone", relationType: "appears_in" });
    insertRelationRaw({ sourceType: "character", sourceId: a, targetType: "outline_node", targetId: "sc-1", relationType: "appears_in" }); // 正常

    const { dangling_relations, inconsistent_soft_deletes } = runFindOrphanElements(makeCtx(), {});
    expect(dangling_relations).toHaveLength(1);
    expect(dangling_relations[0]).toMatchObject({ id: rel.id, relationType: "appears_in", reason: "target_missing" });
    expect(inconsistent_soft_deletes).toEqual([]);
  });

  it("inconsistent_soft_deletes：大纲节点软删但 relation/delta 未级联（幽灵形态，决策 16 修订诊断）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "阿强" }).id;
    // 软删节点 sc-2：关系 + delta 均指向它但未级联（绕过级联直接构造）
    insertRelationRaw({ sourceType: "character", sourceId: a, targetType: "outline_node", targetId: "sc-2", relationType: "appears_in" });
    insertDelta(db, { nodeId: "sc-2", targetType: "character", targetId: a, changes: [{ field: "a", op: "set", to: "1" }], description: "软删节点的变更" });
    softDeleteNode("sc-2");

    const { inconsistent_soft_deletes } = runFindOrphanElements(makeCtx(), {});
    expect(inconsistent_soft_deletes).toHaveLength(2);
    const kinds = inconsistent_soft_deletes.map((i) => i.kind).sort();
    expect(kinds).toEqual(["delta", "relation"]);
    const relEntry = inconsistent_soft_deletes.find((i) => i.kind === "relation")!;
    expect(relEntry.endpointId).toBe("sc-2");
    expect(relEntry.description).toContain("appears_in");
    const deltaEntry = inconsistent_soft_deletes.find((i) => i.kind === "delta")!;
    expect(deltaEntry.nodeId).toBe("sc-2");
    expect(deltaEntry.description).toContain("软删节点的变更");
  });

  it("干净项目 → 四维全空；signal 已中止 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "阿强" }).id;
    appearsIn(a, "sc-3"); // 活跃于第 2 章（最新章）→ 不闲置
    const result = runFindOrphanElements(makeCtx(), {});
    expect(result.unused_characters).toEqual([]);
    expect(result.unresolved_deltas).toEqual([]);
    expect(result.dangling_relations).toEqual([]);
    expect(result.inconsistent_soft_deletes).toEqual([]);

    const controller = new AbortController();
    controller.abort();
    expect(() => runFindOrphanElements(makeCtx(), {}, controller.signal)).toThrow(/中止/);
  });
});
