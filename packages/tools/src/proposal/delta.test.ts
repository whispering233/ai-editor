// S6.6 提案类工具测试：Delta（propose_add_delta）
// 覆盖：tool_result 仅 { proposal_id, summary } 无预览 / 完整提案结构（args 规范化执行形态 +
// 触发节点/目标两端点引用快照）/ **不落盘**（Delta 表零新增——S6.7 对比核心差异）/
// 触发节点非章拒绝（卡片 1.2：锚点仅章）/ 节点不存在/软删、目标不存在抛错 / signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DeltaChange, OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, createEntity, listDeltasByNode, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@whispering233/ai-editor-db";
import { AbortedError } from "../analysis/utils.js";
import { buildProposeAddDelta, runProposeAddDelta } from "./delta.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-prop-delta-"));
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

describe("propose_add_delta", () => {
  it("tool_result 仅 { proposal_id, summary }，无预览细节（2026-08 修订）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强", data: { status: "alive" } });
    const result = runProposeAddDelta(makeCtx(), {
      node_id: "ch-1",
      target: char.id,
      changes: [{ field: "status", op: "update", from: "alive", to: "dead" }],
    });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.proposal_id.startsWith("prop_")).toBe(true);
    expect(result.summary).toContain("追加 1 项属性变更");
  });

  it("完整提案结构：args 规范化执行形态 + 触发节点/目标两端点引用快照", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    const changes: DeltaChange[] = [
      { field: "status", op: "update", from: "alive", to: "dead" },
      { field: "titles", op: "add", value: "剑圣" },
    ];
    const proposal = buildProposeAddDelta(makeCtx(), { node_id: "ch-1", target: char.id, changes });
    expect(proposal.type).toBe("propose_add_delta");
    expect(proposal.args).toEqual({ node_id: "ch-1", target_type: "character", target_id: char.id, changes });
    expect(proposal.references).toEqual([
      { kind: "outline_node", id: "ch-1", updated_at: T0 }, // 节点级 updated_at
      { kind: "entity", id: char.id, updated_at: char.updated_at }, // 实体自身 updated_at
    ]);
    expect(proposal.project_id).toBe("proj-test");
  });

  it("目标可为大纲节点（target 自动识别为 outline_node）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const proposal = buildProposeAddDelta(makeCtx(), {
      node_id: "ch-1",
      target: "sc-1",
      changes: [{ field: "note", op: "set", to: "x" }],
    });
    expect(proposal.args.target_type).toBe("outline_node");
    expect(proposal.references[1]).toEqual({ kind: "outline_node", id: "sc-1", updated_at: T0 });
  });

  it("不落盘：调用后 Delta 表零新增（S6.7 对比核心差异）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    runProposeAddDelta(makeCtx(), {
      node_id: "ch-1",
      target: char.id,
      changes: [{ field: "status", op: "update", from: "alive", to: "dead" }],
    });
    expect(listDeltasByNode(db, "ch-1", dir)).toHaveLength(0);
  });

  it("触发节点非章（场景/卷）→ 抛错（卡片 1.2：锚点仅章）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    expect(() =>
      runProposeAddDelta(makeCtx(), { node_id: "sc-1", target: char.id, changes: [{ field: "status", op: "set", to: "dead" }] }),
    ).toThrow(/须为章/);
    expect(() =>
      runProposeAddDelta(makeCtx(), { node_id: "vol-1", target: char.id, changes: [{ field: "status", op: "set", to: "dead" }] }),
    ).toThrow(/须为章/);
  });

  it("character 不可变字段白名单（卡片 5.2）：role/description 拒绝；可变字段与面板叶子、hook.status 不受影响", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, {
      type: "character",
      name: "阿强",
      data: { role: "主角", alias: "影", ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }] }] },
    });
 // 不可变字段 → 拒绝（与前端字段下拉白名单同源：二者是列表摘要/AI 检索依据）
    for (const field of ["role", "description"] as const) {
      expect(() =>
        runProposeAddDelta(makeCtx(), { node_id: "ch-1", target: char.id, changes: [{ field, op: "set", to: "x" }] }),
      ).toThrow(/不可变字段不参与变更记录/);
    }
 // 可变字段（假名）与面板叶子路径不受影响
    expect(
      runProposeAddDelta(makeCtx(), { node_id: "ch-1", target: char.id, changes: [{ field: "alias", op: "set", to: "影武者" }] })
        .proposal_id,
    ).toMatch(/^prop_/);
    expect(
      runProposeAddDelta(makeCtx(), {
        node_id: "ch-1",
        target: char.id,
        changes: [{ field: "ability_panel.火系.等级", op: "set", to: 5 }],
      }).proposal_id,
    ).toMatch(/^prop_/);
 // 非 character 目标不受影响（hook 的 status 仍可记——它是可变的事实字段）
    const hook = createEntity(db, { type: "hook", name: "身世之谜", data: { status: "planted" } });
    expect(
      runProposeAddDelta(makeCtx(), {
        node_id: "ch-1",
        target: hook.id,
        changes: [{ field: "status", op: "set", to: "progressing" }],
      }).proposal_id,
    ).toMatch(/^prop_/);
  });

  it("hook 的事实字段 status（卡片 5.3）：非 set 的 op 拒绝；set 与其他字段的 update 不受影响", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hook = createEntity(db, { type: "hook", name: "身世之谜", data: { status: "planted" } });
 // status 是写路径同步的事实字段 → 只能用 set（update/add/remove 均拒绝，update 会重放出假冲突）
    expect(() =>
      runProposeAddDelta(makeCtx(), {
        node_id: "ch-1",
        target: hook.id,
        changes: [{ field: "status", op: "update", from: "planted", to: "progressing" }],
      }),
    ).toThrow(/事实字段.*只能用 op=set/);
    expect(() =>
      runProposeAddDelta(makeCtx(), {
        node_id: "ch-1",
        target: hook.id,
        changes: [{ field: "status", op: "add", value: "x" }],
      }),
    ).toThrow(/只能用 op=set/);
 // set → 通过
    expect(
      runProposeAddDelta(makeCtx(), {
        node_id: "ch-1",
        target: hook.id,
        changes: [{ field: "status", op: "set", to: "progressing" }],
      }).proposal_id,
    ).toMatch(/^prop_/);
 // hook 其他字段的 update 不受影响（只有 status 是事实字段）
    expect(
      runProposeAddDelta(makeCtx(), {
        node_id: "ch-1",
        target: hook.id,
        changes: [{ field: "category", op: "update", from: "旧", to: "新" }],
      }).proposal_id,
    ).toMatch(/^prop_/);
 // 其他实体类型的 update 不受影响（尤其不能误伤 update 的正常用法）
    for (const seeded of [
      createEntity(db, { type: "character", name: "阿强", data: { alias: "影" } }),
      createEntity(db, { type: "setting", name: "灵脉", data: { description: "旧" } }),
      createEntity(db, { type: "location", name: "青城", data: { description: "旧" } }),
    ]) {
      expect(
        runProposeAddDelta(makeCtx(), {
          node_id: "ch-1",
          target: seeded.id,
          changes: [{ field: seeded.type === "character" ? "alias" : "description", op: "update", from: "旧", to: "新" }],
        }).proposal_id,
      ).toMatch(/^prop_/);
    }
  });

  it("触发节点不存在 / 已软删 / 目标不存在 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    expect(() =>
      runProposeAddDelta(makeCtx(), { node_id: "sc-999", target: char.id, changes: [{ field: "status", op: "set", to: "dead" }] }),
    ).toThrow(/大纲节点不存在或已软删: sc-999/);
    expect(() =>
      runProposeAddDelta(makeCtx(), { node_id: "ch-1", target: "char-999", changes: [{ field: "status", op: "set", to: "dead" }] }),
    ).toThrow(/端点不存在或已软删/);
    softDeleteNode("ch-1");
    expect(() =>
      runProposeAddDelta(makeCtx(), { node_id: "ch-1", target: char.id, changes: [{ field: "status", op: "set", to: "dead" }] }),
    ).toThrow(/大纲节点不存在或已软删/);
  });
});

describe("signal aborted", () => {
  it("signal 已中止 → 抛 AbortedError", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      runProposeAddDelta(makeCtx(), { node_id: "sc-1", target: "char-1", changes: [{ field: "status", op: "set", to: "dead" }] }, controller.signal),
    ).toThrow(AbortedError);
  });
});
