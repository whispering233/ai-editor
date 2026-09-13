// S6.7 执行类工具测试：Delta（add_delta）
// 覆盖：写路径正确性（order 服务端全局单调生成、changes 原样落库）、
// description 取 **proposal.summary**（S6.6 delta.ts 执行器取 summary 作人类可读描述）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DeltaChange, OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, createEntity, listDeltasByTarget, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { writeOutlineFile } from "@whispering233/ai-editor-db";
import { buildProposal } from "../proposal/types.js";
import { executeAddDelta } from "./delta.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-exec-delta-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵 卷[章[场景一]] 的大纲树 */
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

describe("add_delta", () => {
  it("写路径：changes 原样落库，description 取 proposal.summary，返回新 id（delta- 前缀）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    const proposal = buildProposal(
      makeCtx(),
      "propose_add_delta",
      { node_id: "ch-1", target_type: "character", target_id: char.id, changes: [{ field: "hp", op: "update", from: 100, to: 80 }] },
      [],
      "为节点「第一章」追加 1 项属性变更",
    );
    const result = executeAddDelta(makeCtx(), proposal);
    expect(result.id).toMatch(/^delta-/);
    const deltas = listDeltasByTarget(db, char.id, dir);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      nodeId: "ch-1",
      targetType: "character",
      targetId: char.id,
      changes: [{ field: "hp", op: "update", from: 100, to: 80 }],
      description: "为节点「第一章」追加 1 项属性变更", // proposal.summary
    });
  });

  it("章级兜底：非章锚点（卷/场景）→ 抛错，不落库（卡片 1.5）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    const changes = [{ field: "hp", op: "set", to: 1 }];
 // 场景锚点：executor 直写 db 绕过 REST，本层必须自行拒绝（否则产生静默不参与累积的死数据）
    expect(() =>
      executeAddDelta(makeCtx(), buildProposal(makeCtx(), "propose_add_delta", { node_id: "sc-1", target_type: "character", target_id: char.id, changes }, [], "s")),
    ).toThrow(/变更记录锚点须为章/);
 // 卷锚点同样拒绝
    expect(() =>
      executeAddDelta(makeCtx(), buildProposal(makeCtx(), "propose_add_delta", { node_id: "vol-1", target_type: "character", target_id: char.id, changes }, [], "s")),
    ).toThrow(/变更记录锚点须为章/);
 // 节点不存在也拒绝（requireOutlineNode 前置）
    expect(() =>
      executeAddDelta(makeCtx(), buildProposal(makeCtx(), "propose_add_delta", { node_id: "ch-404", target_type: "character", target_id: char.id, changes }, [], "s")),
    ).toThrow(/大纲节点不存在或已软删/);
    expect(listDeltasByTarget(db, char.id, dir)).toHaveLength(0);
  });

  it("事实字段兜底：hook + status 非 set → 抛错且不落库（卡片 5.4）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hook = createEntity(db, { type: "hook", name: "身世之谜", data: { status: "planted" } });
 // hook.status 是写路径同步的事实字段（重放基座即最新值 → update+from 必然假冲突）：
 // executor 直写 db 绕过提案层守卫，本层必须自行拒绍（与卡片 1.5 的锚点兜底同模式）
    const rejected: DeltaChange[] = [
      { field: "status", op: "update", from: "planted", to: "progressing" },
      { field: "status", op: "add", value: "x" },
      { field: "status", op: "remove", value: "x" },
    ];
    for (const change of rejected) {
      expect(() =>
        executeAddDelta(
          makeCtx(),
          buildProposal(
            makeCtx(),
            "propose_add_delta",
            { node_id: "ch-1", target_type: "hook", target_id: hook.id, changes: [change] },
            [],
            "s",
          ),
        ),
      ).toThrow(/只能用 op=set/);
    }
    expect(listDeltasByTarget(db, hook.id, dir)).toHaveLength(0); // 抛错路径不落库
 // set → 正常落库；hook 其他字段（非事实字段）的 update 不受影响
    executeAddDelta(
      makeCtx(),
      buildProposal(makeCtx(), "propose_add_delta", { node_id: "ch-1", target_type: "hook", target_id: hook.id, changes: [{ field: "status", op: "set", to: "progressing" }] }, [], "s1"),
    );
    executeAddDelta(
      makeCtx(),
      buildProposal(makeCtx(), "propose_add_delta", { node_id: "ch-1", target_type: "hook", target_id: hook.id, changes: [{ field: "category", op: "update", from: "旧", to: "新" }] }, [], "s2"),
    );
    expect(listDeltasByTarget(db, hook.id, dir)).toHaveLength(2);
  });

  it("character 已移除字段兜底：status/abilities → 抛错且不落库；自定义字段与面板叶子不受影响（卡片 5.5）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强", data: { alias: "影" } });
 // status（无展示面）/ abilities（经 007 迁为 ability_panel）已从 schema 移除——
 // executor 直写 db 绕过提案层，本层必须自行拒绍（与提案层同源守卫：assertRemovedCharacterFields）
    for (const field of ["status", "abilities"] as const) {
      expect(() =>
        executeAddDelta(
          makeCtx(),
          buildProposal(
            makeCtx(),
            "propose_add_delta",
            { node_id: "ch-1", target_type: "character", target_id: char.id, changes: [{ field, op: "set", to: "x" }] },
            [],
            "s",
          ),
        ),
      ).toThrow(/已移除/);
    }
    expect(listDeltasByTarget(db, char.id, dir)).toHaveLength(0); // 抛错路径不落库
 // 自定义字段（schema 外，如战力）与可变字段、面板叶子仍可写入——不得收窄成整字段白名单
    executeAddDelta(
      makeCtx(),
      buildProposal(makeCtx(), "propose_add_delta", { node_id: "ch-1", target_type: "character", target_id: char.id, changes: [{ field: "combat_power", op: "update", from: 100, to: 150 }] }, [], "s1"),
    );
    executeAddDelta(
      makeCtx(),
      buildProposal(makeCtx(), "propose_add_delta", { node_id: "ch-1", target_type: "character", target_id: char.id, changes: [{ field: "alias", op: "set", to: "影武者" }] }, [], "s2"),
    );
    executeAddDelta(
      makeCtx(),
      buildProposal(makeCtx(), "propose_add_delta", { node_id: "ch-1", target_type: "character", target_id: char.id, changes: [{ field: "ability_panel.能力.等级", op: "set", to: 3 }] }, [], "s3"),
    );
    expect(listDeltasByTarget(db, char.id, dir)).toHaveLength(3);
  });

  it("order 服务端全局单调生成（两次插入 order 递增）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    executeAddDelta(makeCtx(), buildProposal(makeCtx(), "propose_add_delta", { node_id: "ch-1", target_type: "character", target_id: char.id, changes: [{ field: "a", op: "set", to: 1 }] }, [], "第一条"));
    executeAddDelta(makeCtx(), buildProposal(makeCtx(), "propose_add_delta", { node_id: "ch-1", target_type: "character", target_id: char.id, changes: [{ field: "b", op: "set", to: 2 }] }, [], "第二条"));
    const orders = listDeltasByTarget(db, char.id, dir).map((d) => d.order);
    expect(orders).toEqual([1, 2]);
  });

  it("缺 changes → 抛错（参数防御）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    expect(() =>
      executeAddDelta(makeCtx(), buildProposal(makeCtx(), "propose_add_delta", { node_id: "ch-1", target_type: "character", target_id: char.id }, [], "s")),
    ).toThrow(/执行参数缺失或非法: changes/);
  });
});
