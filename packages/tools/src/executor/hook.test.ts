// S6.7 执行类工具测试：伏笔生命周期复合写（advance_hook / resolve_hook / abandon_hook）
// 覆盖：
// - 复合写正确性：delta_records 记 status 变化（**op=set**，卡 1.9：物化事实字段不声明 from，
// description=args.description）+ relation_records 插 advances/resolves（大纲节点 → hook），一次提交
// - **幂等**：同 (node_id, hook_id, relation_type) 重复调用不重复写（delta/relation 均不重复，
// 返回已有 id + duplicated）；不同节点推进正常新增；abandon 按「已记 to=abandoned 的 delta」判重
// - **原子性**：delta 插入后 relation 插入抛错（mock createRelation）→ 整体回滚无半状态
// （含 data.status 未被改写——状态同步随事务回滚）
// - 终态守卫：resolved/abandoned 伏笔不可再推进/回收/废弃；节点/伏笔不存在抛错
// - **状态同步（S6.7 修复轮必须改）**：复合写事务内 data.status 同步落地——生命周期链
// advance → resolve → 再 advance 抛终态错误；同 hook 两次不同节点推进后 computeState
// 无 conflicts；幂等命中路径不更新
// - abandon 幂等**JSON 解析精确判定**：非 status 字段的 to=abandoned delta 不误命中
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// mock @whispering233/ai-editor-db：包裹 createRelation 为 vi.fn（默认走真实实现）——原子性测试注入失败
vi.mock("@whispering233/ai-editor-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@whispering233/ai-editor-db")>();
  return { ...actual, createRelation: vi.fn(actual.createRelation) };
});

import type { OutlineFileTree, RelationRecord } from "@whispering233/ai-editor-shared";
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
} from "@whispering233/ai-editor-db";
import { writeOutlineFile } from "@whispering233/ai-editor-db";
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

/** 一棵 卷[章一[场景一,场景二], 章二, 章三] 的大纲树（伏笔锚点仅章：节点参数一律用 ch-*） */
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
          { id: "ch-2", type: "chapter", title: "第二章", updated_at: T0 },
          { id: "ch-3", type: "chapter", title: "第三章", updated_at: T0 },
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
  it("写路径：delta 记 status（op=set，to=progressing）+ advances 关系，description 取 args.description", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜", { status: "planted" });
    const result = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1", "第 12 章发现玉佩"));
    expect(result.id).toMatch(/^rel-/);
 // delta：op=set 单点状态（卡 1.9：物化事实字段不声明 from），description = args.description
    const deltas = hookDeltas(hookId);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      nodeId: "ch-1",
      targetType: "hook",
      targetId: hookId,
      changes: [{ field: "status", op: "set", to: "progressing" }],
      description: "第 12 章发现玉佩",
    });
 // relation：大纲节点 → hook，advances
    const relations = hookRelations(hookId);
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ sourceType: "outline_node", sourceId: "ch-1", targetId: hookId, relationType: "advances" });
 // 状态同步（S6.7 修复轮）：复合写事务内 data.status 同步为 progressing（终态守卫/列表分组读它）
    expect(getEntity(db, hookId)!.data.status).toBe("progressing");
  });

  it("data.status 缺失 → 推进正常且 delta 为 op=set（创建即埋设，终态守卫不拦截）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("无状态伏笔"); // data 无 status
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"));
    expect(hookDeltas(hookId)[0].changes).toEqual([{ field: "status", op: "set", to: "progressing" }]);
    expect(getEntity(db, hookId)!.data.status).toBe("progressing");
  });

  it("幂等：同 (node_id, hook_id, advances) 重复调用 → 返回已有 id + duplicated，delta/relation 均不重复写", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    const first = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"));
    const second = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1")); // 重复确认/重复提案
    expect(second).toEqual({ id: first.id, duplicated: true });
    expect(hookDeltas(hookId)).toHaveLength(1);
    expect(hookRelations(hookId)).toHaveLength(1);
  });

  it("不同节点推进 → 正常新增（每次推进各记一条 delta + advances）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"));
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-2"));
    expect(hookDeltas(hookId)).toHaveLength(2);
    expect(hookRelations(hookId).map((r) => r.sourceId)).toEqual(["ch-1", "ch-2"]);
  });

  it("同 hook 两次不同节点推进 → 两条 delta 均 op=set，重放无 conflicts（卡 1.9 验收）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"));
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-2")); // 兄弟章（两者均在章序前缀内）
 // 每条 delta 都是 set 单点状态（不声明 from）——重放无需与基座比对
    expect(hookDeltas(hookId).map((d) => d.changes)).toEqual([
      [{ field: "status", op: "set", to: "progressing" }],
      [{ field: "status", op: "set", to: "progressing" }],
    ]);
 // computeState（atNodeId=ch-2：章序前缀 = [ch-1, ch-2]）：data.status 是物化事实（基座即最新值），
 // set 重放不再产生假 conflicts（卡 1.9 修订前：首条 delta 的 update-from 必然对不上）
    const result = computeState(db, dir, { targetType: "hook", targetId: hookId, atNodeId: "ch-2" });
    expect(result!.state.status).toBe("progressing");
    expect(result!.appliedDeltas.map((d) => d.nodeId)).toEqual(["ch-1", "ch-2"]);
    expect(result!.appliedDeltas.every((d) => d.skipped === undefined)).toBe(true);
    expect(result!.conflicts).toEqual([]);
  });

  it("多次转移（推进 → 回收）后重放无 conflicts，且中间章回看为当时状态（卡 1.9 验收）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"));
    executeResolveHook(makeCtx(), resolveProposal(hookId, "ch-2"));
 // 到达末章：两条 delta 均重放 → 终态 resolved，无冲突
    const atEnd = computeState(db, dir, { targetType: "hook", targetId: hookId, atNodeId: "ch-3" });
    expect(atEnd!.state.status).toBe("resolved");
    expect(atEnd!.appliedDeltas.map((d) => d.nodeId)).toEqual(["ch-1", "ch-2"]);
    expect(atEnd!.conflicts).toEqual([]);
 // 中间章回看：章序前缀只含 ch-1 → set 重放覆写基座为当时状态（≠ 最新值）
    const midway = computeState(db, dir, { targetType: "hook", targetId: hookId, atNodeId: "ch-1" });
    expect(midway!.state.status).toBe("progressing");
    expect(midway!.conflicts).toEqual([]);
  });

  it("已知边界：at_node 落在首次转移之前 → 返回最新值（基座即 data，卡 1.9 登记的近似）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-2")); // 首次转移在 ch-2
 // ch-1 早于首次转移：章序前缀不含任何 status delta → 基座（最新值）原样返回
    const before = computeState(db, dir, { targetType: "hook", targetId: hookId, atNodeId: "ch-1" });
    expect(before!.state.status).toBe("progressing"); // 严格历史应为 planted——已登记并接受该近似
    expect(before!.appliedDeltas).toEqual([]);
    expect(before!.conflicts).toEqual([]);
  });

  it("终态守卫：resolved/abandoned 伏笔不可再推进", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const resolved = makeHook("已回收", { status: "resolved" });
    const abandoned = makeHook("已废弃", { status: "abandoned" });
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(resolved, "ch-1"))).toThrow(/已处于终态 resolved/);
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(abandoned, "ch-1"))).toThrow(/已处于终态 abandoned/);
  });

  it("生命周期链：advance → resolve 后 data.status 已同步为 resolved → 再 advance 抛终态错误（S6.7 修复轮必须改）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"));
    expect(getEntity(db, hookId)!.data.status).toBe("progressing"); // 首次执行已同步
    executeResolveHook(makeCtx(), resolveProposal(hookId, "ch-2"));
    expect(getEntity(db, hookId)!.data.status).toBe("resolved");
 // 修复前：data.status 停留在 planted/progressing → 守卫放行，resolved 后仍可推进
 // （第三次推进换节点避开幂等命中路径，验证守卫本体）
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-3"))).toThrow(/已处于终态 resolved/);
 // 幂等命中路径不更新：同节点重复确认返回 duplicated，状态不被改写
    const again = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"));
    expect(again.duplicated).toBe(true);
    expect(getEntity(db, hookId)!.data.status).toBe("resolved");
  });

  it("伏笔不存在/非 hook/节点不存在/节点非章 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal("hook-999", "ch-1"))).toThrow(/伏笔不存在或已软删/);
    const char = makeHook("我是人物", { role: "主角" });
    db.prepare("UPDATE entities SET type = 'character' WHERE id = ?").run(char);
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(char, "ch-1"))).toThrow(/伏笔不存在或已软删/);
    const hookId = makeHook("正常伏笔");
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-999"))).toThrow(/大纲节点不存在或已软删/);
 // 锚点仅章（卡片 1.3）：executor 直写 db 绕过 REST，必须在执行层拒绝卷/场景
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(hookId, "sc-1"))).toThrow(/伏笔锚点须为章/);
    expect(() => executeResolveHook(makeCtx(), resolveProposal(hookId, "vol-1"))).toThrow(/伏笔锚点须为章/);
  });
});

describe("resolve_hook（复合写：delta + resolves 一次提交）", () => {
  it("写路径：delta 记 status → resolved + resolves 关系", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜", { status: "progressing" });
    const result = executeResolveHook(makeCtx(), resolveProposal(hookId, "ch-2", "揭示主角是转世仙尊"));
    expect(result.id).toMatch(/^rel-/);
    expect(hookDeltas(hookId)[0]).toMatchObject({
      nodeId: "ch-2",
      changes: [{ field: "status", op: "set", to: "resolved" }],
      description: "揭示主角是转世仙尊",
    });
    expect(hookRelations(hookId)[0]).toMatchObject({ sourceId: "ch-2", relationType: "resolves" });
    expect(getEntity(db, hookId)!.data.status).toBe("resolved"); // 状态同步：data.status 落地为 resolved
  });

  it("幂等：同 (node_id, hook_id, resolves) 重复调用 → 返回已有 id，不重复写", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    const first = executeResolveHook(makeCtx(), resolveProposal(hookId, "ch-2"));
    const second = executeResolveHook(makeCtx(), resolveProposal(hookId, "ch-2"));
    expect(second).toEqual({ id: first.id, duplicated: true });
    expect(hookDeltas(hookId)).toHaveLength(1);
    expect(hookRelations(hookId)).toHaveLength(1);
  });

  it("终态守卫：abandoned 伏笔不可回收", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("已废弃", { status: "abandoned" });
    expect(() => executeResolveHook(makeCtx(), resolveProposal(hookId, "ch-2"))).toThrow(/已处于终态 abandoned/);
  });
});

describe("abandon_hook（复合写：仅 delta 记 status=abandoned；无 node_id → 锚定 current_position/树末章）", () => {
  it("写路径：delta 锚定 current_position 章节点，无 relation 插入", () => {
    writeOutlineFile(dir, seedOutlineTree());
    writeProjectFile(dir, { id: "proj-test", name: "测试", language: "zh", prompt: "", schema_version: 1, current_position: "ch-1", created_at: T0, updated_at: T0 });
    const hookId = makeHook("身世之谜", { status: "progressing" });
    const result = executeAbandonHook(makeCtx(), abandonProposal(hookId, "设定变更，放弃"));
    expect(result.id).toMatch(/^delta-/);
    expect(hookDeltas(hookId)[0]).toMatchObject({
      nodeId: "ch-1", // current_position 锚点
      changes: [{ field: "status", op: "set", to: "abandoned" }],
      description: "设定变更，放弃",
    });
    expect(hookRelations(hookId)).toHaveLength(0); // 无关系写入
    expect(getEntity(db, hookId)!.data.status).toBe("abandoned"); // 状态同步：data.status 落地为 abandoned
  });

  it("current_position 未设置 → 退化锚定树末章", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    executeAbandonHook(makeCtx(), abandonProposal(hookId));
    expect(hookDeltas(hookId)[0].nodeId).toBe("ch-3"); // 先序最后章
  });

  it("current_position 为存量场景值（锚点仅章前数据）→ 不采用，退化锚定树末章", () => {
    writeOutlineFile(dir, seedOutlineTree());
    writeProjectFile(dir, { id: "proj-test", name: "测试", language: "zh", prompt: "", schema_version: 1, current_position: "sc-2", created_at: T0, updated_at: T0 });
    const hookId = makeHook("身世之谜");
    executeAbandonHook(makeCtx(), abandonProposal(hookId));
    expect(hookDeltas(hookId)[0].nodeId).toBe("ch-3");
  });

  it("大纲无章 → 抛错（无锚点不可记录）", () => {
    writeOutlineFile(dir, {
      id: "root",
      type: "root",
      schema_version: 1,
      children: [{ id: "vol-1", type: "volume", title: "空卷", updated_at: T0 }],
    });
    const hookId = makeHook("身世之谜");
    expect(() => executeAbandonHook(makeCtx(), abandonProposal(hookId))).toThrow(/大纲无可用章节/);
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
      nodeId: "ch-1",
      targetType: "hook",
      targetId: hookId,
      changes: [{ field: "category", op: "update", from: "main", to: "abandoned" }],
      description: "分类调整",
    });
    const result = executeAbandonHook(makeCtx(), abandonProposal(hookId));
    expect(result.id).toMatch(/^delta-/);
    expect(result.duplicated).toBeUndefined(); // 未判重 → 正常执行废弃
    expect(hookDeltas(hookId)).toHaveLength(2);
    expect(hookDeltas(hookId)[1].changes).toEqual([{ field: "status", op: "set", to: "abandoned" }]);
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

describe("复合写原子性", () => {
  it("delta 插入后 relation 插入抛错 → 整体回滚：delta 与 relation 均不落库", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
 // 注入：relation 插入抛错（模拟第二次写失败——如磁盘/SQL 异常）
    vi.mocked(createRelation).mockImplementationOnce(() => {
      throw new Error("模拟 relation 写入失败");
    });
    expect(() => executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"))).toThrow(/模拟 relation 写入失败/);
 // 回滚断言：无半状态——delta 未插入、relation 未插入、data.status 未被改写（状态同步随事务回滚）
    expect(hookDeltas(hookId)).toHaveLength(0);
    expect(hookRelations(hookId)).toHaveLength(0);
    expect(getEntity(db, hookId)!.data.status).toBeUndefined();
 // 实体本身不受影响（仍可正常推进——mock 已消费，后续走真实实现）
    const result = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"));
    expect(hookDeltas(hookId)).toHaveLength(1);
    expect(result.id).toMatch(/^rel-/);
  });
});

describe("signal", () => {
  it("执行类是短同步事务，无 signal 参数（中止检查由 S7.5 确认路由承担——见 executor/hook.ts 注释）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hookId = makeHook("身世之谜");
    const result = executeAdvanceHook(makeCtx(), advanceProposal(hookId, "ch-1"));
    expect(hookDeltas(hookId)).toHaveLength(1);
    expect(result.id).toBeDefined();
  });
});
