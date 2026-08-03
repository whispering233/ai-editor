// S6.3 查询工具测试：compute_state / get_delta_history
// 覆盖：compute_state 透传 db 累积语义（conflicts 标注不抛 409）/ 目标实体缺失 → null /
//   at_node 不存在 → 抛错（工具失败语义）/ get_delta_history 按 order 排序 /
//   targetName 联表填充 / 可见性三态过滤（delta 自身 / 触发节点 / 目标端点软删，决策 12 修订）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DeltaChange, OutlineFileTree } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@ai-editor/db";
import { createEntity } from "@ai-editor/db";
import { insertDelta } from "@ai-editor/db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@ai-editor/db";
import { runComputeState, runGetDeltaHistory } from "./delta.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-delta-"));
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

/** 种子：大纲树 + 角色阿强（初始 data），返回 charA */
function seedBase(initialData: Record<string, unknown> = {}): { charA: string } {
  writeOutlineFile(dir, seedOutlineTree());
  const charA = createEntity(db, { type: "character", name: "阿强", data: initialData }).id;
  return { charA };
}

/** 便捷：在指定节点插入一条指向 charA 的 delta */
function addDelta(nodeId: string, targetId: string, changes: DeltaChange[], description: string): void {
  insertDelta(db, { nodeId, targetType: "character", targetId, changes, description });
}

/** 直接改 outline.json 软删指定节点（db 无大纲软删 API，测试直写） */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  expect(node).toBeDefined();
  node!.deleted = true;
  node!.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

describe("compute_state", () => {
  it("透传 db 累积语义：父链累积 + conflicts 标注（op=update from 不匹配跳过，不抛 409）", () => {
    const { charA } = seedBase({ power: "500" });
    const conflict = insertDelta(db, {
      nodeId: "sc-1",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "power", op: "update", from: "100", to: "200" }], // 冲突：当前 500 ≠ 100
      description: "冲突变更",
    });
    addDelta("sc-1", charA, [{ field: "power", op: "update", from: "500", to: "600" }], "正常变更");

    const result = runComputeState(makeCtx(), {
      target_type: "character",
      target_id: charA,
      at_node_id: "sc-1",
    });
    expect(result).not.toBeNull();
    expect(result!.state).toEqual({ power: "600" }); // 冲突 change 跳过，后续累积不打断
    expect(result!.conflicts).toEqual([
      { deltaId: conflict.id, field: "power", expected: "100", actual: "500" },
    ]);
    expect(result!.targetType).toBe("character");
    expect(result!.atNodeId).toBe("sc-1");
  });

  it("目标实体不存在/已软删 → null（决策 12 过滤）", () => {
    const { charA } = seedBase();
    expect(
      runComputeState(makeCtx(), { target_type: "character", target_id: "char-999", at_node_id: "sc-1" }),
    ).toBeNull();
    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, charA);
    expect(runComputeState(makeCtx(), { target_type: "character", target_id: charA, at_node_id: "sc-1" })).toBeNull();
  });

  it("at_node 不存在 → 抛错（db 调用方 bug 约定；executor 转结构化错误喂回 LLM 自纠）", () => {
    const { charA } = seedBase();
    expect(() =>
      runComputeState(makeCtx(), { target_type: "character", target_id: charA, at_node_id: "sc-999" }),
    ).toThrow();
  });
});

describe("get_delta_history", () => {
  it("返回目标实体的全部变更记录（按全局 order 升序 = 时间序），targetName 联表填充", () => {
    const { charA } = seedBase();
    addDelta("vol-1", charA, [{ field: "power", op: "set", to: "200" }], "卷级");
    addDelta("sc-1", charA, [{ field: "power", op: "set", to: "300" }], "场景级");
    addDelta("ch-1", charA, [{ field: "power", op: "set", to: "250" }], "章级");

    const records = runGetDeltaHistory(makeCtx(), { target_type: "character", target_id: charA });
    expect(records.map((r) => r.description)).toEqual(["卷级", "场景级", "章级"]); // order 单调 → 插入序
    for (const r of records) {
      expect(r.targetId).toBe(charA);
      expect(r.targetName).toBe("阿强"); // 实体联表名
      expect(r.changes).toBeInstanceOf(Array);
      expect(Number.isNaN(Date.parse(r.createdAt))).toBe(false);
    }
  });

  it("只返回目标实体的记录：同节点指向其他实体的 delta 不混入", () => {
    const { charA } = seedBase();
    const charB = createEntity(db, { type: "character", name: "阿珍" }).id;
    addDelta("sc-1", charA, [{ field: "power", op: "set", to: "200" }], "指向阿强");
    addDelta("sc-1", charB, [{ field: "power", op: "set", to: "999" }], "指向阿珍");

    const records = runGetDeltaHistory(makeCtx(), { target_type: "character", target_id: charA });
    expect(records).toHaveLength(1);
    expect(records[0].description).toBe("指向阿强");
  });

  it("可见性三态过滤（决策 12 修订）：delta 自身软删 / 触发节点软删均不可见", () => {
    const { charA } = seedBase();
    addDelta("vol-1", charA, [{ field: "power", op: "set", to: "200" }], "卷级");
    const scDelta = insertDelta(db, {
      nodeId: "sc-1",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "power", op: "set", to: "300" }],
      description: "场景级",
    });

    // a. delta 自身软删 → 过滤
    db.prepare("UPDATE delta_records SET deleted_at = ? WHERE id = ?").run(T0, scDelta.id);
    let records = runGetDeltaHistory(makeCtx(), { target_type: "character", target_id: charA });
    expect(records.map((r) => r.description)).toEqual(["卷级"]);

    // b. 触发节点软删 → 该节点全部 delta 不可见
    db.prepare("UPDATE delta_records SET deleted_at = NULL WHERE id = ?").run(scDelta.id);
    softDeleteNode("sc-1");
    records = runGetDeltaHistory(makeCtx(), { target_type: "character", target_id: charA });
    expect(records.map((r) => r.description)).toEqual(["卷级"]);
  });

  it("目标实体软删 → 全部不可见；大纲节点 target 的 delta 也支持（target_type=outline_node）", () => {
    const { charA } = seedBase();
    addDelta("sc-1", charA, [{ field: "power", op: "set", to: "300" }], "场景级");
    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, charA);
    expect(runGetDeltaHistory(makeCtx(), { target_type: "character", target_id: charA })).toEqual([]);

    // 大纲节点作为 delta 目标（如状态标记场景自身）
    insertDelta(db, {
      nodeId: "sc-1",
      targetType: "outline_node",
      targetId: "sc-2",
      changes: [{ field: "tone", op: "set", to: "暗" }],
      description: "场景基调",
    });
    const nodeRecords = runGetDeltaHistory(makeCtx(), { target_type: "outline_node", target_id: "sc-2" });
    expect(nodeRecords).toHaveLength(1);
    expect(nodeRecords[0].targetName).toBe("场景二"); // 大纲节点联表名（outline.json title）
    // 大纲目标软删 → 不可见
    softDeleteNode("sc-2");
    expect(runGetDeltaHistory(makeCtx(), { target_type: "outline_node", target_id: "sc-2" })).toEqual([]);
  });

  it("无记录 → 空数组", () => {
    const { charA } = seedBase();
    expect(runGetDeltaHistory(makeCtx(), { target_type: "character", target_id: charA })).toEqual([]);
    expect(runGetDeltaHistory(makeCtx(), { target_type: "character", target_id: "char-999" })).toEqual([]);
  });
});
