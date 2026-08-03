// S6.7 执行类工具测试：伏笔生命周期复合写（advance_hook / resolve_hook / abandon_hook）
// 覆盖：
// - 复合写正确性：delta_records 记 status 变化（from=当前状态、description=args.description）
//   + relation_records 插 advances/resolves（大纲节点 → hook），一次提交
// - **幂等**：同 (node_id, hook_id, relation_type) 重复调用不重复写（delta/relation 均不重复，
//   返回已有 id + duplicated）；不同节点推进正常新增；abandon 按「已记 to=abandoned 的 delta」判重
// - **原子性**：delta 插入后 relation 插入抛错（mock createRelation）→ 整体回滚无半状态
//   （含 data.status 未被改写——状态同步随事务回滚）
// - 终态守卫：resolved/abandoned 伏笔不可再推进/回收/废弃；节点/伏笔不存在抛错
// - **状态同步（S6.7 修复轮必须改）**：复合写事务内 data.status 同步落地——生命周期链
//   advance → resolve → 再 advance 抛终态错误；同 hook 两次不同节点推进后 computeState
//   无 conflicts；幂等命中路径不更新
// - abandon 幂等**JSON 解析精确判定**：非 status 字段的 to=abandoned delta 不误命中
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// mock @ai-editor/db：包裹 createRelation 为 vi.fn（默认走真实实现）——原子性测试注入失败
vi.mock("@ai-editor/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-editor/db")>();
  return { ...actual, createRelation: vi.fn(actual.createRelation) };
});

import type { OutlineFileTree, RelationRecord } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import {
  closeDatabase,
  computeState,
  createEntity,
  createRelation,
  getEntity,
  insertDelta,
  listDeltasByTarget,
  listRelations,
  openDatabase,
  writeProjectFile,
  type Db,
} from "@ai-editor/db";
import { writeOutlineFile } from "@ai-editor/db";
import { buildProposal } from "../proposal/types.js";
import { executeAbandonHook, executeAdvanceHook, executeResolveHook } from "./hook.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-exec-hook-"));
  db = openDatabase(join(dir, "data.db"));
  vi.mocked(createRelation).mockClear(); // 清掉上一条用例的注入状态（默认走真实实现）
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

function makeHook(name: string, data: Record<string, unknown> = {}): string {
  return createEntity(db, { type: "hook", name, data }).id;
}

function hookRelations(hookId: string): RelationRecord[] {
  return listRelations(db, { targetType: "hook", targetId: hookId }, 3, dir).relations;
}

function hookDeltas(hookId: string) {
  return listDeltasByTarget(db, hookId, dir);
}

function advanceProposal(hookId: string, nodeId: string, description = "主角发现了玉佩的秘密") {
  return buildProposal(makeCtx(), "propose_advance_hook", { hook_id: hookId, node_id: nodeId, description }, [], "推进伏笔");
}

function resolveProposal(hookId: string, nodeId: string, description = "在第 45 章揭示主角是转世仙尊") {
  return buildProposal(makeCtx(), "propose_resolve_hook", { hook_id: hookId, node_id: nodeId, description }, [], "回收伏笔");
}

function abandonProposal(hookId: string, description = "设定变更，放弃这条线") {
  return buildProposal(makeCtx(), "propose_abandon_hook", { hook_id: hookId, description }, [], "废弃伏笔");
}

describe("advance_hook（复合写：delta + advances 一次提交）", () => {
  it("写路径：delta 记 status → progressing（from=当前状态）+ advances 关系，description 取 args.description", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜", { status: "planted" });
    const result = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1", "第 12 章发现玉佩"));
    expect(result.id).toMatch(/^rel-/);
    // delta：from=planted → to=progressing（hooks.md 示例形态），description = args.description
    const deltas = hookDeltas(hookId);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      nodeId: "sc-1",
      targetType: "hook",
      targetId: hookId,
      changes: [{ field: "status", op: "update", from: "planted", to: "progressing" }],
      description: "第 12 章发现玉佩",
    });
    // relation：大纲节点 → hook，advances
    const relations = hookRelations(hookId);
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ sourceType: "outline_node", sourceId: "sc-1", targetId: hookId, relationType: "advances" });
    // 状态同步（S6.7 修复轮）：复合写事务内 data.status 同步为 progressing（终态守卫/delta from 读它）
    expect(getEntity(db, hookId)!.data.status).toBe("progressing");
  });

  it("data.status 缺失 → from 取 planted（决策 21 口径：创建即埋设）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("无状态伏笔"); // data 无 status
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1"));
    expect(hookDeltas(hookId)[0].changes).toEqual([{ field: "status", op: "update", from: "planted", to: "progressing" }]);
  });

  it("幂等：同 (node_id, hook_id, advances) 重复调用 → 返回已有 id + duplicated，delta/relation 均不重复写", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    const first = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1"));
    const second = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1")); // 重复确认/重复提案
    expect(second).toEqual({ id: first.id, duplicated: true });
    expect(hookDeltas(hookId)).toHaveLength(1);
    expect(hookRelations(hookId)).toHaveLength(1);
  });

  it("不同节点推进 → 正常新增（每次推进各记一条 delta + advances）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1"));
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-2"));
    expect(hookDeltas(hookId)).toHaveLength(2);
    expect(hookRelations(hookId).map((r) => r.sourceId)).toEqual(["sc-1", "sc-2"]);
  });

  it("同 hook 两次不同节点推进 → 第二次 delta from=同步后的实际状态，computeState 无 conflicts（S6.7 修复轮）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1"));
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-2")); // 兄弟节点
    // 第二次推进的 from 必须取 data.status 同步后的 progressing（修复前停留 planted →
    // 与实际累积脱节，与终态守卫 / S6.5 hookStatuses 同源缺陷）
    expect(hookDeltas(hookId)[1].changes).toEqual([{ field: "status", op: "update", from: "progressing", to: "progressing" }]);
    // computeState（atNodeId=sc-2 只累积挂在其树路径上的 delta）：from 与实际累积一致 → 无冲突
    const result = computeState(db, dir, { targetType: "hook", targetId: hookId, atNodeId: "sc-2" });
    expect(result!.conflicts).toEqual([]);
    expect(result!.appliedDeltas.map((d) => d.nodeId)).toEqual(["sc-2"]);
    expect(result!.state.status).toBe("progressing");
  });

  it("终态守卫：resolved/abandoned 伏笔不可再推进", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const resolved = makeHook("已回收", { status: "resolved" });
    const abandoned = makeHook("已废弃", { status: "abandoned" });
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(resolved, "sc-1"))).toThrow(/已处于终态 resolved/);
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(abandoned, "sc-1"))).toThrow(/已处于终态 abandoned/);
  });

  it("生命周期链：advance → resolve 后 data.status 已同步为 resolved → 再 advance 抛终态错误（S6.7 修复轮必须改）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1"));
    expect(getEntity(db, hookId)!.data.status).toBe("progressing"); // 首次执行已同步
    executeResolveHook(makeCtx(), resolveProposal(hookId, "sc-2"));
    expect(getEntity(db, hookId)!.data.status).toBe("resolved");
    // 修复前：data.status 停留在 planted/progressing → 守卫放行，resolved 后仍可推进
    // （第三次推进换节点避开幂等命中路径，验证守卫本体）
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"))).toThrow(/已处于终态 resolved/);
    // 幂等命中路径不更新：同节点重复确认返回 duplicated，状态不被改写
    const again = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1"));
    expect(again.duplicated).toBe(true);
    expect(getEntity(db, hookId)!.data.status).toBe("resolved");
  });

  it("伏笔不存在/非 hook/节点不存在 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal("hook-999", "sc-1"))).toThrow(/伏笔不存在或已软删/);
    const char = makeHook("我是人物", { role: "主角" });
    db.prepare("UPDATE entities SET type = 'character' WHERE id = ?").run(char);
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(char, "sc-1"))).toThrow(/伏笔不存在或已软删/);
    const hookId = makeHook("正常伏笔");
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-999"))).toThrow(/大纲节点不存在或已软删/);
  });
});

describe("resolve_hook（复合写：delta + resolves 一次提交）", () => {
  it("写路径：delta 记 status → resolved + resolves 关系", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜", { status: "progressing" });
    const result = executeResolveHook(makeCtx(), resolveProposal(hookId, "sc-2", "揭示主角是转世仙尊"));
    expect(result.id).toMatch(/^rel-/);
    expect(hookDeltas(hookId)[0]).toMatchObject({
      nodeId: "sc-2",
      changes: [{ field: "status", op: "update", from: "progressing", to: "resolved" }],
      description: "揭示主角是转世仙尊",
    });
    expect(hookRelations(hookId)[0]).toMatchObject({ sourceId: "sc-2", relationType: "resolves" });
    expect(getEntity(db, hookId)!.data.status).toBe("resolved"); // 状态同步：data.status 落地为 resolved
  });

  it("幂等：同 (node_id, hook_id, resolves) 重复调用 → 返回已有 id，不重复写", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    const first = executeResolveHook(makeCtx(), resolveProposal(hookId, "sc-2"));
    const second = executeResolveHook(makeCtx(), resolveProposal(hookId, "sc-2"));
    expect(second).toEqual({ id: first.id, duplicated: true });
    expect(hookDeltas(hookId)).toHaveLength(1);
    expect(hookRelations(hookId)).toHaveLength(1);
  });

  it("终态守卫：abandoned 伏笔不可回收", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("已废弃", { status: "abandoned" });
    expect(() => executeResolveHook(makeCtx(), resolveProposal(hookId, "sc-2"))).toThrow(/已处于终态 abandoned/);
  });
});

describe("abandon_hook（复合写：仅 delta 记 status=abandoned；无 node_id → 锚定 current_position）", () => {
  it("写路径：delta 锚定 current_position 节点（决策 21），无 relation 插入", () => {
    writeOutlineFile(dir, seedOutlineTree());
    writeProjectFile(dir, { id: "proj-test", name: "测试", language: "zh", prompt: "", schema_version: 1, current_position: "sc-1", created_at: T0, updated_at: T0 });
    const hookId = makeHook("身世之谜", { status: "progressing" });
    const result = executeAbandonHook(makeCtx(), abandonProposal(hookId, "设定变更，放弃"));
    expect(result.id).toMatch(/^delta-/);
    expect(hookDeltas(hookId)[0]).toMatchObject({
      nodeId: "sc-1", // current_position 锚点
      changes: [{ field: "status", op: "update", from: "progressing", to: "abandoned" }],
      description: "设定变更，放弃",
    });
    expect(hookRelations(hookId)).toHaveLength(0); // 无关系写入
    expect(getEntity(db, hookId)!.data.status).toBe("abandoned"); // 状态同步：data.status 落地为 abandoned
  });

  it("current_position 未设置 → 退化锚定树末节点", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    executeAbandonHook(makeCtx(), abandonProposal(hookId));
    expect(hookDeltas(hookId)[0].nodeId).toBe("sc-2"); // 树末场景
  });

  it("幂等：已存在 to=abandoned 的 delta → 返回已有 id，不重复写", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    const first = executeAbandonHook(makeCtx(), abandonProposal(hookId));
    const second = executeAbandonHook(makeCtx(), abandonProposal(hookId)); // 重复确认
    expect(second).toEqual({ id: first.id, duplicated: true });
    expect(hookDeltas(hookId)).toHaveLength(1);
  });

  it("幂等判定精确（S6.7 修复轮）：非 status 字段的 to=abandoned delta 不误命中", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    // 先写入一条 {field:"category", to:"abandoned"} 的 delta——修复前 LIKE 形态会误判为已废弃
    insertDelta(db, {
      nodeId: "sc-1",
      targetType: "hook",
      targetId: hookId,
      changes: [{ field: "category", op: "update", from: "main", to: "abandoned" }],
      description: "分类调整",
    });
    const result = executeAbandonHook(makeCtx(), abandonProposal(hookId));
    expect(result.id).toMatch(/^delta-/);
    expect(result.duplicated).toBeUndefined(); // 未判重 → 正常执行废弃
    expect(hookDeltas(hookId)).toHaveLength(2);
    expect(hookDeltas(hookId)[1].changes).toEqual([{ field: "status", op: "update", from: "planted", to: "abandoned" }]);
    // 再次执行 → 命中真正的 status=abandoned delta，判重
    const again = executeAbandonHook(makeCtx(), abandonProposal(hookId));
    expect(again.duplicated).toBe(true);
    expect(hookDeltas(hookId)).toHaveLength(2);
  });

  it("终态守卫：resolved 伏笔不可废弃", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("已回收", { status: "resolved" });
    expect(() => executeAbandonHook(makeCtx(), abandonProposal(hookId))).toThrow(/已处于终态 resolved/);
  });
});

describe("复合写原子性（tools.md：失败不产生半状态）", () => {
  it("delta 插入后 relation 插入抛错 → 整体回滚：delta 与 relation 均不落库", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    // 注入：relation 插入抛错（模拟第二次写失败——如磁盘/SQL 异常）
    vi.mocked(createRelation).mockImplementationOnce(() => {
      throw new Error("模拟 relation 写入失败");
    });
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1"))).toThrow(/模拟 relation 写入失败/);
    // 回滚断言：无半状态——delta 未插入、relation 未插入、data.status 未被改写（状态同步随事务回滚）
    expect(hookDeltas(hookId)).toHaveLength(0);
    expect(hookRelations(hookId)).toHaveLength(0);
    expect(getEntity(db, hookId)!.data.status).toBeUndefined();
    // 实体本身不受影响（仍可正常推进——mock 已消费，后续走真实实现）
    const result = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1"));
    expect(hookDeltas(hookId)).toHaveLength(1);
    expect(result.id).toMatch(/^rel-/);
  });
});

describe("signal（决策 16 ③）", () => {
  it("执行类是短同步事务，无 signal 参数（中止检查由 S7.5 确认路由承担——见 executor/hook.ts 注释）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    const result = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1"));
    expect(hookDeltas(hookId)).toHaveLength(1);
    expect(result.id).toBeDefined();
  });
});
