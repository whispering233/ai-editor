// S3.2 关系管理测试：创建（判重/白名单/端点校验）/ 查询（depth 1/2/3 + 可见性过滤）/ 物理删除
// 覆盖：决策 12 修订（可见性联动端点状态：实体与大纲节点软删均不可见）、
//       k 跳路径组装与防环、plot_edge 同规则、手动删除 = 物理删
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { createEntity, softDeleteEntity } from "./entity.js";
import {
  createRelation,
  deleteRelation,
  getRelation,
  listDanglingRelations,
  listRelations,
  listSettingHierarchyEdges,
  RelationError,
  updateRelationMetadata,
  wouldCreateSettingCycle,
} from "./relation.js";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "../storage/outline.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-relation-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵含 卷[章[场景]] 的大纲树（场景 id 可测） */
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

/** 种子：两角色 + 大纲树（含场景 sc-1），返回 { charA, charB } */
function seedBase(): { charA: string; charB: string } {
  writeOutlineFile(dir, seedOutlineTree());
  const charA = createEntity(db, { type: "character", name: "阿强" });
  const charB = createEntity(db, { type: "character", name: "阿珍" });
  return { charA: charA.id, charB: charB.id };
}

function expectRelationError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`应抛出 RelationError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(RelationError);
    expect((err as RelationError).code).toBe(code);
  }
}

describe("createRelation", () => {
  it("合法创建：rel- 前缀 id、时间戳、metadata 存储", () => {
    const { charA, charB } = seedBase();
    const rel = createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" },
      dir,
    );
    expect(rel.id).toMatch(/^rel-/);
    expect(rel.source_id).toBe(charA);
    expect(rel.target_id).toBe(charB);
    expect(Number.isNaN(Date.parse(rel.created_at))).toBe(false);
    // 大纲端点 + plot_edge 同规则（决策 10）
    const edge = createRelation(
      db,
      { sourceType: "outline_node", sourceId: "sc-1", targetType: "outline_node", targetId: "vol-1", relationType: "plot_edge" },
      dir,
    );
    expect(edge.relation_type).toBe("plot_edge");
  });

  it("同三元组判重 → RELATION_EXISTS（409 语义）", () => {
    const { charA, charB } = seedBase();
    createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" },
      dir,
    );
    expectRelationError(
      () =>
        createRelation(
          db,
          { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" },
          dir,
        ),
      "RELATION_EXISTS",
    );
    // 不同关系类型不判重
    expect(() =>
      createRelation(
        db,
        { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "rival" },
        dir,
      ),
    ).not.toThrow();
  });

  it("relation_type 白名单拒绝（schema.md 16 类型外）→ INVALID_RELATION_TYPE", () => {
    const { charA, charB } = seedBase();
    expectRelationError(
      () =>
        createRelation(
          db,
          { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "friend" },
          dir,
        ),
      "INVALID_RELATION_TYPE",
    );
  });

  it("端点不存在/软删拒绝 → ENDPOINT_NOT_FOUND（实体与大纲节点两路径）", () => {
    const { charA } = seedBase();
    // 实体不存在
    expectRelationError(
      () =>
        createRelation(
          db,
          { sourceType: "character", sourceId: "char-999", targetType: "character", targetId: charA, relationType: "ally" },
          dir,
        ),
      "ENDPOINT_NOT_FOUND",
    );
    // 实体已软删
    const ghost = createEntity(db, { type: "character", name: "幽灵" });
    softDeleteEntity(db, ghost.id, T0);
    expectRelationError(
      () =>
        createRelation(
          db,
          { sourceType: "character", sourceId: ghost.id, targetType: "character", targetId: charA, relationType: "ally" },
          dir,
        ),
      "ENDPOINT_NOT_FOUND",
    );
    // 大纲节点不存在
    expectRelationError(
      () =>
        createRelation(
          db,
          { sourceType: "outline_node", sourceId: "sc-999", targetType: "character", targetId: charA, relationType: "appears_in" },
          dir,
        ),
      "ENDPOINT_NOT_FOUND",
    );
  });
});

describe("listRelations depth=1（紧邻 + 可见性）", () => {
  it("过滤条件组合 + sourceName/targetName 联表填充（实体与大节点两路径）", () => {
    const { charA, charB } = seedBase();
    createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" },
      dir,
    );
    createRelation(
      db,
      { sourceType: "outline_node", sourceId: "sc-1", targetType: "character", targetId: charA, relationType: "appears_in" },
      dir,
    );
    const res = listRelations(db, { sourceId: charA }, 1, dir);
    expect(res.relations).toHaveLength(1);
    expect(res.relations[0]).toMatchObject({
      sourceType: "character",
      sourceId: charA,
      sourceName: "阿强",
      targetType: "character",
      targetId: charB,
      targetName: "阿珍",
      relationType: "ally",
    });
    // 大纲端点 name = title
    const scRes = listRelations(db, { sourceId: "sc-1" }, 1, dir);
    expect(scRes.relations[0].sourceName).toBe("场景一");
    // 过滤组合（relation_type）
    expect(listRelations(db, { relationType: "rival" }, 1, dir).relations).toHaveLength(0);
  });

  it("可见性过滤（决策 12 修订）：source 实体软删后关系不可见", () => {
    const { charA, charB } = seedBase();
    createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" },
      dir,
    );
    softDeleteEntity(db, charA, T0);
    expect(listRelations(db, { sourceId: charA }, 1, dir).relations).toHaveLength(0);
    // target 软删同样不可见
    const { charA: a2, charB: b2 } = seedBase();
    createRelation(
      db,
      { sourceType: "character", sourceId: a2, targetType: "character", targetId: b2, relationType: "ally" },
      dir,
    );
    softDeleteEntity(db, b2, T0);
    expect(listRelations(db, {}, 1, dir).relations).toHaveLength(0);
  });

  it("大纲节点软删后指向它的关系不可见（读 outline.json 校验）", () => {
    const { charA } = seedBase();
    createRelation(
      db,
      { sourceType: "outline_node", sourceId: "sc-1", targetType: "character", targetId: charA, relationType: "appears_in" },
      dir,
    );
    // 软删大纲节点（直接改 outline.json——db 包无大纲软删 API 的读路径在本卡测试直接写）
    const tree = readOutlineFile(dir);
    const sc = tree.children[0].children![0].children![0];
    sc.deleted = true;
    sc.deleted_at = T0;
    writeOutlineFile(dir, tree);
    expect(listRelations(db, {}, 1, dir).relations).toHaveLength(0);
    // getRelation 同样不可见
    const relId = db.prepare("SELECT id FROM relation_records LIMIT 1").get() as { id: string };
    expect(getRelation(db, relId.id, dir)).toBeNull();
  });

  it("getRelation：正常返回；不存在 → null", () => {
    const { charA, charB } = seedBase();
    const rel = createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" },
      dir,
    );
    expect(getRelation(db, rel.id, dir)?.relation_type).toBe("ally");
    expect(getRelation(db, "rel-999", dir)).toBeNull();
  });
});

describe("listRelations depth=2/3（k 跳路径）", () => {
  /** 链式图：charA -ally-> charB -rival-> charC；charB -mentor-> sc-1（大纲节点） */
  function seedChain(): { charA: string; charB: string; charC: string } {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const c = createEntity(db, { type: "character", name: "丙" });
    createRelation(db, { sourceType: "character", sourceId: a.id, targetType: "character", targetId: b.id, relationType: "ally" }, dir);
    createRelation(db, { sourceType: "character", sourceId: b.id, targetType: "character", targetId: c.id, relationType: "rival" }, dir);
    createRelation(db, { sourceType: "character", sourceId: b.id, targetType: "outline_node", targetId: "sc-1", relationType: "mentor" }, dir);
    return { charA: a.id, charB: b.id, charC: c.id };
  }

  it("depth=2：从起点出发的 1 跳与 2 跳路径（nodes/edges 结构 + name 填充）", () => {
    const { charA, charB, charC } = seedChain();
    const res = listRelations(db, { sourceId: charA }, 2, dir);
    const paths = res.paths!;
    // A→B（1 跳）、A→B→C、A→B→sc-1（2 跳，seedChain 有 3 条出边链）
    expect(paths).toHaveLength(3);
    // 1 跳路径（BFS 第一层先产出）
    expect(paths[0]).toEqual({
      nodes: [
        { type: "character", id: charA, name: "甲" },
        { type: "character", id: charB, name: "乙" },
      ],
      edges: [{ from: charA, to: charB, relationType: "ally" }],
    });
    // 2 跳路径（A→B→C）
    const twoHop = paths.find((p) => p.edges[1]?.relationType === "rival")!;
    expect(twoHop.edges).toEqual([
      { from: charA, to: charB, relationType: "ally" },
      { from: charB, to: charC, relationType: "rival" },
    ]);
  });

  it("depth 边界：depth=1 无 paths；depth=3 扩展更远路径", () => {
    const { charA } = seedChain();
    const d1 = listRelations(db, { sourceId: charA }, 1, dir);
    expect(d1.paths).toBeUndefined();
    // depth=3：A→B→C 与 A→B→sc-1（2 跳内无更远——B 的出边到 C 和 sc-1，均 2 跳）
    const d3 = listRelations(db, { sourceId: charA }, 3, dir);
    const len2 = d3.paths!.filter((p) => p.nodes.length === 2).length;
    const len3 = d3.paths!.filter((p) => p.nodes.length === 3).length;
    expect(len2).toBe(1);
    expect(len3).toBe(2); // A→B→C、A→B→sc-1
  });

  it("防环：环状图不无限遍历（路径级 visited）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    createRelation(db, { sourceType: "character", sourceId: a.id, targetType: "character", targetId: b.id, relationType: "ally" }, dir);
    createRelation(db, { sourceType: "character", sourceId: b.id, targetType: "character", targetId: a.id, relationType: "rival" }, dir);
    const res = listRelations(db, { sourceId: a.id }, 3, dir);
    // A→B、A→B→A 被防环跳过（B→A 的路径中 A 已访问）——只有 A→B 一条路径
    expect(res.paths).toHaveLength(1);
    expect(res.paths![0].nodes.map((n) => n.id)).toEqual([a.id, b.id]);
  });

  it("缺省起点（无 sourceId）：多起点遍历图内全部节点路径", () => {
    const { charA, charB } = seedChain();
    const res = listRelations(db, {}, 2, dir);
    // 起点 = 图内全部节点：A→B、B→C、B→sc-1 产生路径；C/sc-1 无出边不产生路径（起点自身不输出）
    const startNodes = new Set(res.paths!.map((p) => p.nodes[0].id));
    expect(startNodes.has(charA)).toBe(true);
    expect(startNodes.has(charB)).toBe(true);
  });
});

describe("deleteRelation（物理删，决策 12 修订）", () => {
  it("物理删除：行消失；再次删除 → 0（404 语义）", () => {
    const { charA, charB } = seedBase();
    const rel = createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" },
      dir,
    );
    expect(deleteRelation(db, rel.id)).toBe(1);
    expect(db.prepare("SELECT id FROM relation_records WHERE id = ?").get(rel.id)).toBeUndefined();
    expect(deleteRelation(db, rel.id)).toBe(0);
  });

  it("物理删后不进入回收站（无 deleted_at 残留行）", () => {
    const { charA, charB } = seedBase();
    const rel = createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" },
      dir,
    );
    deleteRelation(db, rel.id);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM relation_records").get() as { c: number }).c,
    ).toBe(0);
  });
});

describe("updateRelationMetadata（整体替换 + 404 语义，endpoints.md「PUT /relation/:id」）", () => {
  it("更新：metadata 整体替换（旧键不残留）+ updated_at 刷新", () => {
    const { charA, charB } = seedBase();
    const rel = createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally", metadata: { label: "旧标签", note: "保留" } },
      dir,
    );
    const before = db.prepare("SELECT updated_at FROM relation_records WHERE id = ?").get(rel.id) as { updated_at: string };
    const res = updateRelationMetadata(db, rel.id, { label: "新标签", extra: 1 }, "2026-08-12T10:00:00Z");
    expect(res).toEqual({ id: rel.id });
    const row = getRelation(db, rel.id, dir)!;
    // 整体替换：旧 label/note 不残留，新键完整
    expect(row.metadata).toEqual({ label: "新标签", extra: 1 });
    expect(row.updated_at).toBe("2026-08-12T10:00:00Z");
    expect(row.updated_at).not.toBe(before.updated_at);
  });

  it("清空：{} → metadata 置空对象（label 消失；读侧仍返回 metadata:{}，客户端 label 取不到）", () => {
    const { charA, charB } = seedBase();
    const rel = createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally", metadata: { label: "x" } },
      dir,
    );
    expect(updateRelationMetadata(db, rel.id, {}, "2026-08-12T10:00:00Z")).toEqual({ id: rel.id });
    const row = getRelation(db, rel.id, dir)!;
    // 整体替换语义：空对象字面存储（parseMetadata("{}") → {}），label 键不残留
    expect(row.metadata).toEqual({});
    expect(row.metadata?.label).toBeUndefined();
    expect(listRelations(db, {}, 1, dir).relations[0].metadata).toEqual({});
  });

  it("不存在 → null（404 语义）", () => {
    expect(updateRelationMetadata(db, "rel-999", { label: "x" }, "2026-08-12T10:00:00Z")).toBeNull();
  });

  it("已软删 → null，且行未被触碰（软删关系不可编辑，决策 12）", () => {
    const { charA, charB } = seedBase();
    const rel = createRelation(
      db,
      { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally", metadata: { label: "旧" } },
      dir,
    );
    db.prepare("UPDATE relation_records SET deleted_at = ? WHERE id = ?").run(T0, rel.id);
    expect(updateRelationMetadata(db, rel.id, { label: "新" }, "2026-08-12T10:00:00Z")).toBeNull();
    const raw = db.prepare("SELECT metadata, updated_at, deleted_at FROM relation_records WHERE id = ?").get(rel.id) as {
      metadata: string;
      updated_at: string;
      deleted_at: string;
    };
    expect(raw.metadata).toBe(JSON.stringify({ label: "旧" }));
    expect(raw.updated_at).toBe(rel.updated_at);
    expect(raw.deleted_at).toBe(T0);
  });
});

describe("listDanglingRelations（S6.4 工具 find_orphan_elements 下沉）", () => {
  /** 实体物理删除（purge 语义：直接 DELETE） */
  function purgeEntity(id: string): void {
    db.prepare("DELETE FROM entities WHERE id = ?").run(id);
  }

  /**
   * 直接 SQL 插入关系行（绕过 createRelation 的端点存在性校验）——
   * 悬空关系无法经正常 API 构造，需模拟「端点已 purge 但关系残留」的脏数据形态
   */
  function insertRelationRaw(
    db: Db,
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

  it("正常关系（端点健在）不列入；端点物理删除 → source/target_missing", () => {
    const { charA, charB } = seedBase();
    createRelation(db, { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" }, dir);
    // 悬空关系无法经 createRelation 构造（端点存在性校验）——直接 INSERT 模拟 purge 后残留
    const missing = insertRelationRaw(db, { sourceType: "character", sourceId: charA, targetType: "character", targetId: "char-gone", relationType: "ally" });
    const outlineMissing = insertRelationRaw(db, { sourceType: "character", sourceId: charA, targetType: "outline_node", targetId: "sc-gone", relationType: "appears_in" });

    const dangling = listDanglingRelations(db, dir);
    const byId = new Map(dangling.map((d) => [d.id, d]));
    expect(byId.get(missing.id)).toMatchObject({ relationType: "ally", reason: "target_missing" });
    expect(byId.get(outlineMissing.id)).toMatchObject({ reason: "target_missing" });
    expect(byId.get(missing.id)).toBeDefined();
    expect(dangling.filter((d) => d.relationType === "ally" && d.id === missing.id)).toHaveLength(1);
    expect(dangling.filter((d) => d.id === missing.id && d.reason === "source_missing")).toEqual([]); // source 健在
  });

  it("端点软删但关系未级联 → *_deleted（inconsistent_soft_deletes 侧）；关系自身软删不列入", () => {
    const { charA, charB } = seedBase();
    const toDeleted = createRelation(db, { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" }, dir);
    const nodeDeleted = createRelation(db, { sourceType: "character", sourceId: charA, targetType: "outline_node", targetId: "sc-1", relationType: "appears_in" }, dir);
    const selfSoft = insertRelationRaw(db, { sourceType: "character", sourceId: charA, targetType: "outline_node", targetId: "sc-2", relationType: "appears_in" });

    // 直接 UPDATE 实体软删（绕过 softDeleteEntity 的级联软删——级联会把关系一并标删，
    // 无法构造「端点软删但关系未级联」的幽灵形态）
    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, charB);
    softDeleteNode("sc-1");
    db.prepare("UPDATE relation_records SET deleted_at = ? WHERE id = ?").run(T0, selfSoft.id);

    const dangling = listDanglingRelations(db, dir);
    const byId = new Map(dangling.map((d) => [d.id, d]));
    expect(byId.get(toDeleted.id)).toMatchObject({ reason: "target_deleted" });
    expect(byId.get(nodeDeleted.id)).toMatchObject({ reason: "target_deleted" });
    expect(byId.get(selfSoft.id)).toBeUndefined(); // 自身软删 = 回收站对象，非悬空
  });

  it("同一关系两端点异常时各出一条（每端点一条记录）", () => {
    const { charA } = seedBase();
    const rel = insertRelationRaw(db, { sourceType: "character", sourceId: charA, targetType: "character", targetId: "char-gone", relationType: "ally" });
    const rows = listDanglingRelations(db, dir);
    expect(rows.filter((r) => r.id === rel.id)).toHaveLength(1); // 仅 target 异常
    // 再 purge source → 两端点各一条
    purgeEntity(charA);
    const rows2 = listDanglingRelations(db, dir);
    const mine = rows2.filter((r) => r.id === rel.id);
    expect(mine).toHaveLength(2);
    expect(mine.map((r) => r.reason).sort()).toEqual(["source_missing", "target_missing"]);
  });

  it("无悬空 → 空数组", () => {
    const { charA, charB } = seedBase();
    createRelation(db, { sourceType: "character", sourceId: charA, targetType: "character", targetId: charB, relationType: "ally" }, dir);
    expect(listDanglingRelations(db, dir)).toEqual([]);
  });
});

describe("设定层级（决策 30：belongs_to setting→setting 边集 + 防环）", () => {
  function seedSetting(name: string) {
    const row = createEntity(db, { type: "setting", name });
    return row.id;
  }

  function link(childId: string, parentId: string) {
    createRelation(db, { sourceType: "setting", sourceId: childId, targetType: "setting", targetId: parentId, relationType: "belongs_to" }, dir);
  }

  it("listSettingHierarchyEdges：只收 belongs_to 且两端均为 setting 的未软删边（方向 child→parent）", () => {
    writeOutlineFile(dir, seedOutlineTree()); // outline_node 端点校验需要大纲文件（sc-1）
    const a = seedSetting("世界");
    const b = seedSetting("大陆");
    const c = seedSetting("门派");
    const person = createEntity(db, { type: "character", name: "张三" }).id;
    link(c, b);
    link(b, a);
    // 人物→设定 belongs_to 与大纲节点出现关系不计入层级
    createRelation(db, { sourceType: "character", sourceId: person, targetType: "setting", targetId: a, relationType: "belongs_to" }, dir);
    createRelation(db, { sourceType: "outline_node", sourceId: "sc-1", targetType: "setting", targetId: a, relationType: "appears_in" }, dir);
    const edges = listSettingHierarchyEdges(db);
    expect(edges).toEqual([
      { childId: c, parentId: b },
      { childId: b, parentId: a },
    ]);
  });

  it("软删端点不参与层级（决策 12 修订可见性联动）", () => {
    const a = seedSetting("世界");
    const b = seedSetting("大陆");
    const c = seedSetting("门派");
    link(c, b);
    link(b, a);
    softDeleteEntity(db, b, T0); // 中间节点软删 → 其边两侧均不可见
    const edges = listSettingHierarchyEdges(db);
    expect(edges).toEqual([]);
  });

  it("wouldCreateSettingCycle：自指/祖先链命中/新建子节点均正确判定", () => {
    const a = seedSetting("世界");
    const b = seedSetting("大陆");
    const c = seedSetting("门派");
    link(c, b);
    link(b, a);
    // 自指：设定作为自己的上级
    expect(wouldCreateSettingCycle(db, a, a)).toBe(true);
    // 环：把 a 挂到 c 下（a 的子孙 b 已经挂在 b'下……方向核对：a→? 即 a belongs_to c；
    // c 的祖先链 = c→b→a，含 a → 成环）
    expect(wouldCreateSettingCycle(db, a, c)).toBe(true);
    // 把 b 挂到 c 下：c 的祖先链 c→b→a 含 b → 成环
    expect(wouldCreateSettingCycle(db, b, c)).toBe(true);
    // 合法：新建叶子挂到 a 下 —— d 不在树中，a 的祖先链无 d
    const d = seedSetting("新势力");
    expect(wouldCreateSettingCycle(db, d, a)).toBe(false);
    // 合法：同级互挂（b 挂到另一个孤立根 e 下）——e 祖先链无 b
    const e = seedSetting("另一世界");
    expect(wouldCreateSettingCycle(db, b, e)).toBe(false);
    // 重复边不误判为环（同三元组判重由 createRelation 的 RELATION_EXISTS 负责）
    expect(wouldCreateSettingCycle(db, c, b)).toBe(false);
  });
});
