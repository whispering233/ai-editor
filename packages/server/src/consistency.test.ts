// 启动一致性校验测试（S4.2，决策 16 修订）：
//   (a) 不一致 fixture：outline.json 节点已软删、DB 关系/Delta 未软删 → 补标并返回计数
//   (b) 一致：节点与关联记录均已软删 → 零补标
//   (c) 幂等：二次运行零补标
//   (d) 无软删节点 → 零补标（常规启动）；无关关系不受影响
// fixture 风格与 routes/outline.test.ts seedVolWithRelation 一致（直接 INSERT，绕过端点校验）；
// 项目装配沿用 middleware/project.test.ts（initProject + 临时目录）。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlineNode, deleteOutlineNode, nowIso, type Db } from "@whispering233/ai-editor-db";
import { closeProject, initProject, type ProjectContext } from "./middleware/project.js";
import { reconcileSoftDelete } from "./consistency.js";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-editor-consistency-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 建项目 + 一个已软删卷节点（JSON 侧已标 deleted），返回上下文与节点 id */
function makeProjectWithDeletedNode(): { project: ProjectContext; nodeId: string } {
  const project = initProject(makeTmpDir());
  const node = createOutlineNode(project.root, { type: "volume", title: "卷", parentId: "root", updatedAt: nowIso() });
  deleteOutlineNode(project.root, node.id, nowIso());
  return { project, nodeId: node.id };
}

/** 直接插一条关系（fixture 用；deletedAt 传值模拟「DB 已级联」的干净状态） */
function insertRelation(
  db: Db,
  id: string,
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
  relationType = "appears_in",
  deletedAt: string | null = null,
): void {
  db.prepare(
    `INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sourceType, sourceId, targetType, targetId, relationType, T0, T0, deletedAt);
}

/** 直接插一条 Delta（fixture 用；node_id = 触发节点，target_id = 目标实体） */
function insertDelta(db: Db, id: string, nodeId: string, targetId: string, deletedAt: string | null = null): void {
  db.prepare(
    `INSERT INTO delta_records (id, node_id, target_type, target_id, changes, description, "order", created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    nodeId,
    "character",
    targetId,
    JSON.stringify([{ field: "x", op: "set", value: 1 }]),
    "测试 Delta",
    0,
    T0,
    T0,
    deletedAt,
  );
}

const T0 = "2026-01-01T00:00:00.000Z";

/** 读单行 deleted_at 的辅助（断言补标结果用） */
function deletedAtOf(db: Db, table: "relation_records" | "delta_records", id: string): string | null {
  return (db.prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`).get(id) as { deleted_at: string | null }).deleted_at;
}

describe("reconcileSoftDelete（S4.2，决策 16 修订）", () => {
  it("不一致：节点已软删、DB 关系/Delta 未软删 → 补标并返回计数", () => {
    const { project, nodeId } = makeProjectWithDeletedNode();
    try {
      insertRelation(project.db, "rel-1", "outline_node", nodeId, "character", "char-1");
      insertDelta(project.db, "delta-1", nodeId, "char-1");

      const result = reconcileSoftDelete(project);
      expect(result).toEqual({ deletedNodes: 1, relations: 1, deltas: 1 });

      // 补标值符合应用层 ISO 8601 约定（schema.md 第 16 行）
      expect(deletedAtOf(project.db, "relation_records", "rel-1")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(deletedAtOf(project.db, "delta_records", "delta-1")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      closeProject(project);
    }
  });

  it("一致：节点与关联记录均已软删 → 零补标", () => {
    const { project, nodeId } = makeProjectWithDeletedNode();
    try {
      // 已软删的 relation/delta（deleted_at 非空）——模拟「DB 已级联」的干净状态
      insertRelation(project.db, "rel-2", "outline_node", nodeId, "character", "char-2", "appears_in", T0);
      insertDelta(project.db, "delta-2", nodeId, "char-2", T0);

      expect(reconcileSoftDelete(project)).toEqual({ deletedNodes: 1, relations: 0, deltas: 0 });
      // 原有 deleted_at 不被改写（保持 T0 原值）
      expect(deletedAtOf(project.db, "relation_records", "rel-2")).toBe(T0);
      expect(deletedAtOf(project.db, "delta_records", "delta-2")).toBe(T0);
    } finally {
      closeProject(project);
    }
  });

  it("幂等：二次运行零补标", () => {
    const { project, nodeId } = makeProjectWithDeletedNode();
    try {
      insertRelation(project.db, "rel-3", "outline_node", nodeId, "character", "char-3");

      expect(reconcileSoftDelete(project)).toEqual({ deletedNodes: 1, relations: 1, deltas: 0 });
      // 第二次：全部已补标 → 零补标（无副作用）
      expect(reconcileSoftDelete(project)).toEqual({ deletedNodes: 1, relations: 0, deltas: 0 });
    } finally {
      closeProject(project);
    }
  });

  it("无软删节点 → 零补标（常规启动；存活节点与纯实体关系不受影响）", () => {
    const project = initProject(makeTmpDir());
    try {
      const node = createOutlineNode(project.root, {
        type: "volume",
        title: "卷",
        parentId: "root",
        updatedAt: nowIso(),
      });
      insertRelation(project.db, "rel-4", "character", "char-1", "character", "char-2", "ally");
      // 存活节点上的关系同样不补标（驱动集合为空，不执行任何 UPDATE）
      insertRelation(project.db, "rel-5", "outline_node", node.id, "character", "char-1");

      expect(reconcileSoftDelete(project)).toEqual({ deletedNodes: 0, relations: 0, deltas: 0 });
      expect(deletedAtOf(project.db, "relation_records", "rel-5")).toBeNull();
    } finally {
      closeProject(project);
    }
  });

  it("子树软删：source/target 两侧关系与子节点 Delta 一并补标；无关关系不受影响", () => {
    const project = initProject(makeTmpDir());
    try {
      const t0 = nowIso();
      const vol = createOutlineNode(project.root, { type: "volume", title: "卷", parentId: "root", updatedAt: t0 });
      const ch = createOutlineNode(project.root, { type: "chapter", title: "章", parentId: vol.id, updatedAt: t0 });
      deleteOutlineNode(project.root, vol.id, nowIso()); // 递归软删 vol + ch（JSON 侧）

      insertRelation(project.db, "rel-src", "outline_node", vol.id, "character", "char-1"); // source 命中
      insertRelation(project.db, "rel-tgt", "character", "char-2", "outline_node", ch.id); // target 命中
      insertRelation(project.db, "rel-other", "character", "char-1", "character", "char-3", "ally"); // 无关
      insertDelta(project.db, "delta-ch", ch.id, "char-2"); // 子节点触发

      expect(reconcileSoftDelete(project)).toEqual({ deletedNodes: 2, relations: 2, deltas: 1 });
      expect(deletedAtOf(project.db, "relation_records", "rel-src")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(deletedAtOf(project.db, "relation_records", "rel-tgt")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(deletedAtOf(project.db, "delta_records", "delta-ch")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(deletedAtOf(project.db, "relation_records", "rel-other")).toBeNull(); // 不在节点集内，保持原状
    } finally {
      closeProject(project);
    }
  });

  it("outline.json 损坏 → 跳过校验零返回，不阻塞打开（兜底语义）", () => {
    const project = initProject(makeTmpDir());
    try {
      writeFileSync(join(project.root, "outline.json"), "{ 非法 JSON", "utf8");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(reconcileSoftDelete(project)).toEqual({ deletedNodes: 0, relations: 0, deltas: 0 });
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[consistency]"));
      } finally {
        errorSpy.mockRestore();
      }
    } finally {
      closeProject(project);
    }
  });
});
