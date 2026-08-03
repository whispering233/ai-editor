// S5.1 Delta 增删查测试：insertDelta（order 全局单调 + 返回行完整）/ listDeltasByNode
// （按节点 + order 升序、targetName 联表两路径、目标缺失省略 name、
//   可见性三态（决策 12 修订）：自身软删 / 触发节点软删 / 目标实体或大纲节点软删）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DeltaChange, OutlineFileTree } from "@ai-editor/shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { createEntity } from "./entity.js";
import { insertDelta, listDanglingDeltas, listDeltasByNode, listDeltasByTarget } from "./delta.js";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "../storage/outline.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-delta-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵含 卷[章[场景一,场景二]] 的大纲树（sc-1/sc-2 id 可测） */
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

/** 种子：大纲树 + 角色「阿强」，返回 { charA } */
function seedBase(): { charA: string } {
  writeOutlineFile(dir, seedOutlineTree());
  const charA = createEntity(db, { type: "character", name: "阿强" });
  return { charA: charA.id };
}

/** 标准单条变更（op=update，from→to） */
function change(field: string, from: string, to: string): DeltaChange[] {
  return [{ field, op: "update", from, to }];
}

/** 直接改 outline.json 软删指定场景（db 包无大纲软删 API，测试直接写，relation.test.ts 同款） */
function softDeleteScene(sceneId: string): void {
  const tree = readOutlineFile(dir);
  const sc = findOutlineNode(tree, sceneId)!;
  sc.deleted = true;
  sc.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

describe("insertDelta", () => {
  it("order 全局单调递增：连续插入（不同 node/target）为 1、2；同节点内也递增", () => {
    const { charA } = seedBase();
    const d1 = insertDelta(db, {
      nodeId: "sc-1",
      targetType: "character",
      targetId: charA,
      changes: change("combat_power", "100", "150"),
      description: "第一次",
    });
    const d2 = insertDelta(db, {
      nodeId: "sc-2",
      targetType: "character",
      targetId: charA,
      changes: change("age", "20", "21"),
      description: "第二次",
    });
    const d3 = insertDelta(db, {
      nodeId: "sc-1",
      targetType: "outline_node",
      targetId: "sc-2",
      changes: change("summary", "旧", "新"),
      description: "第三次",
    });
    expect([d1.order, d2.order, d3.order]).toEqual([1, 2, 3]); // 全新库从 1 起，全局不回落
    // 库内实际持久化顺序一致
    const rows = db
      .prepare('SELECT id, "order" FROM delta_records ORDER BY "order" ASC')
      .all() as Array<{ id: string; order: number }>;
    expect(rows.map((r) => r.order)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.id)).toEqual([d1.id, d2.id, d3.id]);
  });

  it("返回行完整：delta- 前缀、changes 解析为数组、created_at/updated_at 为 ISO、deleted_at null", () => {
    const { charA } = seedBase();
    const changes: DeltaChange[] = [
      { field: "combat_power", op: "update", from: "100", to: "150" },
      { field: "tags", op: "add", value: "剑客" },
    ];
    const row = insertDelta(db, {
      nodeId: "sc-1",
      targetType: "character",
      targetId: charA,
      changes,
      description: "张三获得断剑认可",
    });
    expect(row.id).toMatch(/^delta-/);
    expect(row.node_id).toBe("sc-1");
    expect(row.target_type).toBe("character");
    expect(row.target_id).toBe(charA);
    expect(row.changes).toEqual(changes);
    expect(row.description).toBe("张三获得断剑认可");
    expect(row.order).toBe(1);
    expect(Number.isNaN(Date.parse(row.created_at))).toBe(false);
    expect(row.created_at).toBe(row.updated_at); // 创建时相同
    expect(row.deleted_at).toBeNull();
    // 落库形态：changes 存 JSON 字符串
    const stored = db
      .prepare("SELECT changes FROM delta_records WHERE id = ?")
      .get(row.id) as { changes: string };
    expect(JSON.parse(stored.changes)).toEqual(changes);
  });
});

describe("listDeltasByNode", () => {
  it("基础：只返回该节点 Delta、按 order 升序；无记录 → 空数组", () => {
    const { charA } = seedBase();
    const d1 = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "一" });
    const d2 = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("b", "1", "2"), description: "二" });
    insertDelta(db, { nodeId: "sc-2", targetType: "character", targetId: charA, changes: change("c", "1", "2"), description: "三" });

    const records = listDeltasByNode(db, "sc-1", dir);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id)).toEqual([d1.id, d2.id]);
    expect(records.map((r) => r.order)).toEqual([1, 2]);
    expect(records[0].description).toBe("一");
    // 存在的节点但无记录 → 空数组
    expect(listDeltasByNode(db, "ch-1", dir)).toEqual([]);
  });

  it("targetName 联表：实体 target → entities.name；大纲节点 target → outline.json title；目标不存在 → 省略", () => {
    const { charA } = seedBase();
    const toEntity = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "实体目标" });
    const toOutline = insertDelta(db, { nodeId: "sc-1", targetType: "outline_node", targetId: "sc-2", changes: change("b", "1", "2"), description: "大纲目标" });
    const toMissingOutline = insertDelta(db, { nodeId: "sc-1", targetType: "outline_node", targetId: "sc-999", changes: change("c", "1", "2"), description: "缺失大纲目标" });
    const toMissingEntity = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: "char-999", changes: change("d", "1", "2"), description: "缺失实体目标" });

    const records = listDeltasByNode(db, "sc-1", dir);
    expect(records).toHaveLength(4);
    const byId = new Map(records.map((r) => [r.id, r]));
    expect(byId.get(toEntity.id)!.targetName).toBe("阿强"); // entities.name
    expect(byId.get(toOutline.id)!.targetName).toBe("场景二"); // outline.json title
    // 目标不存在 → 记录仍返回但 targetName 省略（relation.ts 端点缺失语义）
    expect(byId.get(toMissingOutline.id)!.targetName).toBeUndefined();
    expect(byId.get(toMissingEntity.id)!.targetName).toBeUndefined();
  });

  it("changes 坏行防御：列非 JSON 字符串 → 该条仍返回且 changes 为 []（单条坏行不打挂整表）", () => {
    const { charA } = seedBase();
    const d1 = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "一" });
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("b", "1", "2"), description: "二" });
    // 直写脏数据（绕过应用层，模拟外部写入/损坏）：changes 列非法 JSON
    db.prepare("UPDATE delta_records SET changes = 'not-json' WHERE id = ?").run(d1.id);

    const records = listDeltasByNode(db, "sc-1", dir);
    expect(records).toHaveLength(2); // 坏行不丢失、不打挂整表
    const byId = new Map(records.map((r) => [r.id, r]));
    expect(byId.get(d1.id)!.changes).toEqual([]); // 解析失败防御为 []
    expect(records.find((r) => r.id !== d1.id)!.changes).toEqual(change("b", "1", "2"));
  });
});

describe("listDeltasByNode 可见性三态（决策 12 修订：任一命中即过滤）", () => {
  it("a. delta 自身软删 → 过滤", () => {
    const { charA } = seedBase();
    const d1 = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "一" });
    const d2 = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("b", "1", "2"), description: "二" });
    db.prepare("UPDATE delta_records SET deleted_at = ? WHERE id = ?").run(T0, d1.id);

    const records = listDeltasByNode(db, "sc-1", dir);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(d2.id);
  });

  it("b. 触发节点软删（outline.json deleted=true）→ 该节点全部 Delta 过滤；其他节点不受影响", () => {
    const { charA } = seedBase();
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "一" });
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("b", "1", "2"), description: "二" });
    const other = insertDelta(db, { nodeId: "sc-2", targetType: "character", targetId: charA, changes: change("c", "1", "2"), description: "三" });
    softDeleteScene("sc-1");

    expect(listDeltasByNode(db, "sc-1", dir)).toEqual([]);
    expect(listDeltasByNode(db, "sc-2", dir).map((r) => r.id)).toEqual([other.id]);
  });

  it("c. 目标实体软删 → 该条过滤（直接 UPDATE entities 验证 JS 层集合，不触发级联标删）", () => {
    const { charA } = seedBase();
    const charB = createEntity(db, { type: "character", name: "阿珍" });
    const toA = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "指向阿强" });
    const toB = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charB.id, changes: change("b", "1", "2"), description: "指向阿珍" });
    // 只软删实体、不级联标 delta——隔离验证「目标实体软删」过滤层
    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, charA);

    const records = listDeltasByNode(db, "sc-1", dir);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(toB.id);
    // delta 自身未被级联标删（过滤来自目标实体层）
    const deltaDeletedAt = db
      .prepare("SELECT deleted_at FROM delta_records WHERE id = ?")
      .get(toA.id) as { deleted_at: string | null };
    expect(deltaDeletedAt.deleted_at).toBeNull();
  });

  it("c2. 目标为大纲节点且节点软删 → 过滤；还原后可见性恢复（targetName 恢复）", () => {
    seedBase(); // 仅构造 fixtures（大纲树 + 角色），本用例只用到大纲节点 target
    insertDelta(db, { nodeId: "sc-1", targetType: "outline_node", targetId: "sc-2", changes: change("a", "1", "2"), description: "指向场景二" });
    softDeleteScene("sc-2");
    expect(listDeltasByNode(db, "sc-1", dir)).toEqual([]);

    // 还原：清软删标记（deleted=false 即可恢复可见——判断仅看 deleted === true）
    const tree = readOutlineFile(dir);
    const sc2 = findOutlineNode(tree, "sc-2")!;
    sc2.deleted = false;
    delete (sc2 as { deleted_at?: string }).deleted_at;
    writeOutlineFile(dir, tree);

    const records = listDeltasByNode(db, "sc-1", dir);
    expect(records).toHaveLength(1);
    expect(records[0].targetName).toBe("场景二");
  });

  it("d. 触发节点缺失（脏引用：节点已物理删除但 delta 残留）→ 该节点全部 Delta 不可见", () => {
    const { charA } = seedBase();
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "一" });
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("b", "1", "2"), description: "二" });
    const other = insertDelta(db, { nodeId: "sc-2", targetType: "character", targetId: charA, changes: change("c", "1", "2"), description: "三" });
    // 物理删除 sc-1（构造不含该节点的树；purge 后 delta 残留的脏引用场景）
    const tree = readOutlineFile(dir);
    const chapter = findOutlineNode(tree, "ch-1");
    if (chapter?.type !== "chapter") throw new Error("fixture 缺失 ch-1");
    chapter.children = chapter.children!.filter((c) => c.id !== "sc-1");
    writeOutlineFile(dir, tree);

    expect(listDeltasByNode(db, "sc-1", dir)).toEqual([]); // 触发节点缺失视同不可见（决策 12 修订兜底）
    expect(listDeltasByNode(db, "sc-2", dir).map((r) => r.id)).toEqual([other.id]); // 其他节点不受影响
  });
});

describe("listDeltasByTarget（S6.3 工具 get_delta_history 下沉）", () => {
  it("按目标实体返回全部记录：跨节点聚合 + 全局 order ASC（时间序）+ targetName 联表", () => {
    const { charA } = seedBase();
    insertDelta(db, { nodeId: "vol-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "卷级" });
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("b", "1", "2"), description: "场景级" });
    insertDelta(db, { nodeId: "ch-1", targetType: "character", targetId: charA, changes: change("c", "1", "2"), description: "章级" });

    const records = listDeltasByTarget(db, charA, dir);
    expect(records.map((r) => r.description)).toEqual(["卷级", "场景级", "章级"]); // order 单调 → 插入序
    for (const r of records) {
      expect(r.targetId).toBe(charA);
      expect(r.targetName).toBe("阿强"); // 实体联表名
    }
  });

  it("只返回目标匹配的记录：同节点指向其他实体的 delta 不混入", () => {
    const { charA } = seedBase();
    const charB = createEntity(db, { type: "character", name: "阿珍" }).id;
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "指向阿强" });
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charB, changes: change("b", "1", "2"), description: "指向阿珍" });

    const records = listDeltasByTarget(db, charA, dir);
    expect(records).toHaveLength(1);
    expect(records[0].description).toBe("指向阿强");
  });

  it("可见性三态（决策 12 修订）：delta 自身软删 / 触发节点软删均过滤（与 listDeltasByNode 同语义）", () => {
    const { charA } = seedBase();
    insertDelta(db, { nodeId: "vol-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "卷级" });
    const scDelta = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("b", "1", "2"), description: "场景级" });

    // a. delta 自身软删 → 过滤
    db.prepare("UPDATE delta_records SET deleted_at = ? WHERE id = ?").run(T0, scDelta.id);
    let records = listDeltasByTarget(db, charA, dir);
    expect(records.map((r) => r.description)).toEqual(["卷级"]);

    // b. 触发节点软删 → 该节点全部 delta 不可见
    db.prepare("UPDATE delta_records SET deleted_at = NULL WHERE id = ?").run(scDelta.id);
    softDeleteScene("sc-1");
    records = listDeltasByTarget(db, charA, dir);
    expect(records.map((r) => r.description)).toEqual(["卷级"]);
  });

  it("目标端点软删（实体 / 大纲节点）→ 过滤；大纲 target 联表名（outline.json title）", () => {
    const { charA } = seedBase();
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "指向阿强" });
    // 目标实体软删 → 全部不可见
    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, charA);
    expect(listDeltasByTarget(db, charA, dir)).toEqual([]);
    db.prepare("UPDATE entities SET deleted_at = NULL WHERE id = ?").run(charA);

    // 大纲节点目标（targetType=outline_node）→ 联表名 + 软删过滤
    insertDelta(db, { nodeId: "sc-1", targetType: "outline_node", targetId: "sc-2", changes: change("c", "1", "2"), description: "指向场景二" });
    const nodeRecords = listDeltasByTarget(db, "sc-2", dir);
    expect(nodeRecords).toHaveLength(1);
    expect(nodeRecords[0].targetName).toBe("场景二");
    softDeleteScene("sc-2");
    expect(listDeltasByTarget(db, "sc-2", dir)).toEqual([]);
  });

  it("触发节点缺失（脏引用）→ 该条不可见；无记录 → 空数组", () => {
    const { charA } = seedBase();
    expect(listDeltasByTarget(db, charA, dir)).toEqual([]); // 无记录
    expect(listDeltasByTarget(db, "char-999", dir)).toEqual([]); // 目标不存在

    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "一" });
    // 物理删除 sc-1（构造不含该节点的树——purge 后 delta 残留的脏引用）
    const tree = readOutlineFile(dir);
    const chapter = findOutlineNode(tree, "ch-1");
    if (chapter?.type !== "chapter") throw new Error("fixture 缺失 ch-1");
    chapter.children = chapter.children!.filter((c) => c.id !== "sc-1");
    writeOutlineFile(dir, tree);
    expect(listDeltasByTarget(db, charA, dir)).toEqual([]);
  });
});

describe("listDanglingDeltas（S6.4 工具 find_orphan_elements 下沉）", () => {
  /** 移除大纲中指定节点（模拟 purge：物理删除） */
  function purgeNode(nodeId: string): void {
    const tree = readOutlineFile(dir);
    const chapter = findOutlineNode(tree, "ch-1");
    if (chapter?.type !== "chapter") throw new Error("fixture 缺失 ch-1");
    chapter.children = chapter.children!.filter((c) => c.id !== nodeId);
    writeOutlineFile(dir, tree);
  }

  it("正常 delta（触发/目标均健在）不列入；触发节点软删 / 缺失分别标注 trigger_deleted / trigger_missing", () => {
    const { charA } = seedBase();
    insertDelta(db, { nodeId: "vol-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "正常" });
    const soft = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("b", "1", "2"), description: "触发已软删" });
    insertDelta(db, { nodeId: "sc-2", targetType: "character", targetId: charA, changes: change("c", "1", "2"), description: "触发已缺失" });

    softDeleteScene("sc-1"); // 触发节点软删，delta 未级联 → trigger_deleted
    purgeNode("sc-2"); // 触发节点物理删除 → trigger_missing

    const dangling = listDanglingDeltas(db, dir);
    expect(dangling).toHaveLength(2);
    const byDesc = new Map(dangling.map((d) => [d.description, d]));
    expect(byDesc.get("触发已软删")).toMatchObject({ id: soft.id, reason: "trigger_deleted" });
    expect(byDesc.get("触发已缺失")).toMatchObject({ reason: "trigger_missing" });
  });

  it("目标端点软删/缺失分别标注 target_deleted / target_missing；delta 自身软删不列入", () => {
    const { charA } = seedBase();
    const charB = createEntity(db, { type: "character", name: "阿珍" }).id;
    const targetSoft = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "目标已软删" });
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charB, changes: change("b", "1", "2"), description: "目标已缺失" });
    const selfSoft = insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("c", "1", "2"), description: "自身软删" });

    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, charA); // 目标实体软删
    db.prepare("UPDATE entities SET deleted_at = NULL WHERE id = ?").run(charB); // charB 存在
    db.prepare("DELETE FROM entities WHERE id = ?").run(charB); // 物理删除 → 目标缺失
    db.prepare("UPDATE delta_records SET deleted_at = ? WHERE id = ?").run(T0, selfSoft.id); // 自身软删 → 不列入

    const dangling = listDanglingDeltas(db, dir);
    const byDesc = new Map(dangling.map((d) => [d.description, d]));
    expect(dangling).toHaveLength(2);
    expect(byDesc.get("目标已软删")).toMatchObject({ id: targetSoft.id, reason: "target_deleted" });
    expect(byDesc.get("目标已缺失")).toMatchObject({ reason: "target_missing" });
    expect(byDesc.get("自身软删")).toBeUndefined(); // 回收站对象非悬空
  });

  it("大纲节点目标：节点软删 → target_deleted（未级联）", () => {
    seedBase();
    insertDelta(db, { nodeId: "sc-1", targetType: "outline_node", targetId: "sc-2", changes: change("a", "1", "2"), description: "指向场景二" });
    softDeleteScene("sc-2");
    const dangling = listDanglingDeltas(db, dir);
    expect(dangling).toHaveLength(1);
    expect(dangling[0]).toMatchObject({ targetId: "sc-2", reason: "target_deleted" });
  });

  it("无悬空 → 空数组", () => {
    const { charA } = seedBase();
    insertDelta(db, { nodeId: "sc-1", targetType: "character", targetId: charA, changes: change("a", "1", "2"), description: "正常" });
    expect(listDanglingDeltas(db, dir)).toEqual([]);
  });
});
