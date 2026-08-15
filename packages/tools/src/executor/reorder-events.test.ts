// F9 执行类工具测试：时间轴事件重排（reorder_events）
// 覆盖：写路径正确性（按新序重写 sort_order 0..n-1 + 全部事件 updated_at 刷新——全量变化语义，
//   与 moveEvent 只刷被移单行区分）/ 返回 { reordered: n }（批量操作无单对象 id，ExecutorResult.id 可选）/
//   失败语义（集合不一致缺/多/重复抛错，零副作用）/ 参数防御（非数组/空数组/非字符串元素抛错）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolContext } from "../context.js";
import { closeDatabase, listAllEvents, openDatabase, softDeleteEntity, type Db } from "@whispering233/ai-editor-db";
import { buildProposal } from "../proposal/types.js";
import { executeReorderEvents } from "./reorder-events.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-exec-reorder-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T00:00:00Z";

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

function makeProposal(type: string, args: Record<string, unknown>): ReturnType<typeof buildProposal> {
  return buildProposal(makeCtx(), type, args, [], `测试摘要 ${type}`);
}

/** 造 n 个 event，sort_order 0..n-1；返回 id 数组（按序，db 测试同款 INSERT 模式） */
function seedEvents(names: string[]): string[] {
  const ids: string[] = [];
  names.forEach((name, i) => {
    const id = `ev-exec-reorder-${i}`;
    ids.push(id);
    db.prepare(
      `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at)
       VALUES (?, 'event', ?, ?, ?, ?)`,
    ).run(id, name, i, T0, T0);
  });
  return ids;
}

describe("reorder_events", () => {
  it("正常重排：按新序重写 sort_order 0..n-1，全部事件 updated_at 刷新（全量变化语义），返回 { reordered: n }", () => {
    const ids = seedEvents(["事件A", "事件B", "事件C", "事件D"]);
    const newOrder = [ids[3], ids[1], ids[0], ids[2]];
    const result = executeReorderEvents(makeCtx(), makeProposal("propose_reorder_events", { event_ids: newOrder }));
    expect(result).toEqual({ reordered: 4 });
    expect(listAllEvents(db).map((r) => r.id)).toEqual(newOrder);
    // 全部事件 updated_at 刷新（与 moveEvent 只刷被移单行区分——批量重排全量变化）
    const rows = db
      .prepare("SELECT updated_at FROM entities WHERE type = 'event'")
      .all() as Array<{ updated_at: string }>;
    const fresh = rows[0].updated_at;
    expect(fresh).not.toBe(T0); // nowIso() 生成的新时间戳
    expect(rows.every((r) => r.updated_at === fresh)).toBe(true);
    // sort_order 列已重写为连续 0..n-1
    const orders = db
      .prepare("SELECT sort_order FROM entities WHERE type = 'event' ORDER BY sort_order")
      .all() as Array<{ sort_order: number }>;
    expect(orders.map((o) => o.sort_order)).toEqual([0, 1, 2, 3]);
  });

  it("集合与当前时间轴不一致 → 抛错且零副作用（缺/多/重复均拒绝）", () => {
    const ids = seedEvents(["事件A", "事件B", "事件C"]);
    // 缺一个事件
    expect(() => executeReorderEvents(makeCtx(), makeProposal("propose_reorder_events", { event_ids: [ids[2], ids[0]] }))).toThrow(
      /事件集合与当前时间轴不一致.*缺失 1 个/,
    );
    // 多一个不存在的 id
    expect(() =>
      executeReorderEvents(makeCtx(), makeProposal("propose_reorder_events", { event_ids: [ids[2], ids[1], ids[0], "ev-999"] })),
    ).toThrow(/事件集合与当前时间轴不一致.*多余 1 个/);
    // 重复 id
    expect(() => executeReorderEvents(makeCtx(), makeProposal("propose_reorder_events", { event_ids: [ids[0], ids[1], ids[0]] }))).toThrow(
      /事件集合与当前时间轴不一致.*含重复/,
    );
    // 零副作用：原序未被改动、updated_at 未刷新
    expect(listAllEvents(db).map((r) => r.id)).toEqual(ids);
    const raw = db.prepare("SELECT updated_at FROM entities WHERE type = 'event' ORDER BY id").all() as Array<{
      updated_at: string;
    }>;
    expect(raw.every((r) => r.updated_at === T0)).toBe(true);
  });

  it("软删事件不参与集合（决策 12 过滤）：新序含软删事件 → 抛错；剔除后正常", () => {
    const ids = seedEvents(["事件A", "事件B", "事件C"]);
    softDeleteEntity(db, ids[1], T0);
    expect(() => executeReorderEvents(makeCtx(), makeProposal("propose_reorder_events", { event_ids: ids }))).toThrow(
      /事件集合与当前时间轴不一致/,
    );
    const result = executeReorderEvents(makeCtx(), makeProposal("propose_reorder_events", { event_ids: [ids[2], ids[0]] }));
    expect(result).toEqual({ reordered: 2 });
    expect(listAllEvents(db).map((r) => r.id)).toEqual([ids[2], ids[0]]);
    // 软删行保留且未被重写（可回收站还原）
    const raw = db.prepare("SELECT sort_order, deleted_at FROM entities WHERE id = ?").get(ids[1]) as {
      sort_order: number;
      deleted_at: string;
    };
    expect(raw.deleted_at).toBe(T0);
    expect(raw.sort_order).toBe(1);
  });

  it("参数防御：非数组 / 空数组 / 非字符串元素 → 抛错（防脏调用写脏数据）", () => {
    const ids = seedEvents(["事件A", "事件B"]);
    expect(() => executeReorderEvents(makeCtx(), makeProposal("propose_reorder_events", { event_ids: "ev-x" }))).toThrow(
      /执行参数缺失或非法: event_ids/,
    );
    expect(() => executeReorderEvents(makeCtx(), makeProposal("propose_reorder_events", { event_ids: [] }))).toThrow(
      /执行参数缺失或非法: event_ids/,
    );
    expect(() => executeReorderEvents(makeCtx(), makeProposal("propose_reorder_events", { event_ids: [ids[0], 42] }))).toThrow(
      /执行参数缺失或非法: event_ids/,
    );
    expect(listAllEvents(db).map((r) => r.id)).toEqual(ids); // 零副作用
  });
});
