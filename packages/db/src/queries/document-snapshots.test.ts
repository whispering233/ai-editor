// 章正文历史快照查询层测试（document_snapshots，2026-11）
// 覆盖：节流（不足间隔不压）/ 去重（最新一份同内容不压）/ force 绕过节流（去重仍生效）/
// 每章份数上限裁剪 / 全局字数预算裁剪（两者都从最旧删、只按 seq）/ 列表 seq 降序（同 created_at 也稳定）/
// 单份读取必须同时命中 owner（跨章不可读）/ purge 级联删快照。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHAPTER_SNAPSHOT_MIN_INTERVAL_MS,
  MAX_SNAPSHOTS_PER_DOCUMENT,
  SNAPSHOT_BUDGET_MULTIPLIER,
} from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { upsertDocument } from "./document.js";
import {
  deleteSnapshotsByOwner,
  getSnapshot,
  insertSnapshotIfDue,
  listSnapshots,
  trimSnapshots,
} from "./document-snapshots.js";

const T0 = "2026-11-01T10:00:00Z";
/** 同一秒的 `now`（同秒多次保存：排序只能靠 seq） */
const T1 = "2026-11-01T10:00:01Z";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-snapshots-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

/** 写一段章正文（只为给全局预算提供「该书正文总量」基数；charCount 与正文长度一致） */
function seedChapter(ch: string, chars: number): void {
  upsertDocument(db, {
    ownerKind: "chapter",
    ownerId: ch,
    content: "[]",
    contentText: "字".repeat(chars),
    now: T0,
  });
}

/** 压一份快照（content 必须互不相同，否则被去重） */
function push(ch: string, n: number, charCount: number, now = T1, force = true): boolean {
  return insertSnapshotIfDue(db, {
    ownerKind: "chapter",
    ownerId: ch,
    content: `[{"id":"b${n}"}]`,
    charCount,
    now,
    force,
  }).inserted;
}

/** 该章快照 seq 列表（升序 = 最旧→最新） */
function seqs(ch: string): number[] {
  return listSnapshots(db, "chapter", ch)
    .map((s) => s.seq)
    .sort((a, b) => a - b);
}

describe("insertSnapshotIfDue（节流 + 去重）", () => {
  it("首份无条件压入；同内容再压 → 去重跳过（列表里只有一份）", () => {
    seedChapter("ch-1", 10);
    expect(push("ch-1", 1, 10, T1)).toBe(true);
    // 同一份旧内容再次到期（时间早已过间隔）仍被去重拦住
    expect(push("ch-1", 1, 10, "2027-01-01T00:00:00Z")).toBe(false);
    expect(listSnapshots(db, "chapter", "ch-1")).toHaveLength(1);
  });

  it("节流：距最后一份不足 CHAPTER_SNAPSHOT_MIN_INTERVAL_MS 跳过，超过间隔后再压", () => {
    seedChapter("ch-1", 10);
    push("ch-1", 1, 10, T1); // 首份（无基准，不受节流）
    const justInside = new Date(Date.parse(T1) + CHAPTER_SNAPSHOT_MIN_INTERVAL_MS - 1).toISOString();
    expect(push("ch-1", 2, 10, justInside, false)).toBe(false);
    expect(listSnapshots(db, "chapter", "ch-1")).toHaveLength(1);

    const justOutside = new Date(Date.parse(T1) + CHAPTER_SNAPSHOT_MIN_INTERVAL_MS).toISOString();
    expect(push("ch-1", 2, 10, justOutside, false)).toBe(true);
    expect(listSnapshots(db, "chapter", "ch-1")).toHaveLength(2);
  });

  it("force（恢复前强压）绕过节流；去重仍生效", () => {
    seedChapter("ch-1", 10);
    push("ch-1", 1, 10, T1);
    // 节流窗口内：非 force 不压、force 压
    expect(push("ch-1", 2, 10, T1, false)).toBe(false);
    expect(push("ch-1", 2, 10, T1, true)).toBe(true);
    // force 也不重复压同一份内容
    expect(push("ch-1", 2, 10, T1, true)).toBe(false);
    expect(listSnapshots(db, "chapter", "ch-1")).toHaveLength(2);
  });

  it("按章隔离：A 章的节流/去重基准不拦 B 章", () => {
    seedChapter("ch-1", 10);
    seedChapter("ch-2", 10);
    push("ch-1", 1, 10, T1);
    expect(push("ch-2", 1, 10, T1, false)).toBe(true); // B 章无基准 → 不受 A 章节流影响
    expect(listSnapshots(db, "chapter", "ch-2")).toHaveLength(1);
  });
});

describe("trimSnapshots（每章上限 + 全局预算，均删最旧）", () => {
  it(`每章最多留最新 ${MAX_SNAPSHOTS_PER_DOCUMENT} 份（预算此时远未超），删的是最旧的 seq`, () => {
    for (let i = 1; i <= 10; i++) seedChapter(`ch-${i}`, 100); // 全书 1000 字 → 预算 1000×倍数
    for (let n = 0; n < MAX_SNAPSHOTS_PER_DOCUMENT + 5; n++) push("ch-1", n, 100);

    trimSnapshots(db, "chapter", "ch-1");

    const kept = seqs("ch-1");
    const all = listSnapshots(db, "chapter", "ch-1");
    expect(all).toHaveLength(MAX_SNAPSHOTS_PER_DOCUMENT);
    expect(all[0]!.charCount).toBe(100); // 列表 const 是快照内容元信息
 // 留下的必须是**最新的** N 份（最旧的 5 份被删）
    expect(kept).toEqual(Array.from({ length: MAX_SNAPSHOTS_PER_DOCUMENT }, (_, i) => kept[0]! + i));
    expect(getSnapshot(db, "chapter", "ch-1", kept[0]! - 1)).toBeNull(); // 最旧的已删
    expect(getSnapshot(db, "chapter", "ch-1", kept[0]!)).not.toBeNull();
  });

  it("全局预算：全书快照字数超 SNAPSHOT_BUDGET_MULTIPLIER × 正文总量时删最旧，保留最新的一段", () => {
    const chapterChars = 10;
    seedChapter("ch-1", chapterChars); // 全书正文总量 = 10 字 → 预算 = 10 × 倍数
    const budgetChars = chapterChars * SNAPSHOT_BUDGET_MULTIPLIER;
    const total = budgetChars / chapterChars + 5; // 每份 char_count 10（5 份超额）
    for (let n = 0; n < total; n++) push("ch-1", n, chapterChars);

    trimSnapshots(db, "chapter", "ch-1");

    const all = listSnapshots(db, "chapter", "ch-1");
 // 留下来的总字数 ≤ 预算（同一套常量算的，不手抄数字）
    const keptChars = all.reduce((sum, s) => sum + s.charCount, 0);
    expect(keptChars).toBeLessThanOrEqual(budgetChars);
    expect(all).toHaveLength(budgetChars / chapterChars); // 恰好留到预算上限
 // 删的是最旧的：留下的 seq 是连续的最新一段
    const kept = all.map((s) => s.seq).sort((a, b) => a - b);
    expect(kept[kept.length - 1]! - kept[0]! + 1).toBe(kept.length);
    expect(getSnapshot(db, "chapter", "ch-1", kept[0]! - 1)).toBeNull();
  });

  it("无快照 / 未超限时裁剪是空操作（不误删）", () => {
    seedChapter("ch-1", 10);
    expect(trimSnapshots(db, "chapter", "ch-1")).toBe(0); // 无行
    push("ch-1", 1, 10);
    expect(trimSnapshots(db, "chapter", "ch-1")).toBe(0);
    expect(listSnapshots(db, "chapter", "ch-1")).toHaveLength(1);
  });
});

describe("listSnapshots / getSnapshot", () => {
  it("同一 created_at 的多份按 seq 降序稳定返回（排序键是 seq，不是时间）", () => {
    seedChapter("ch-1", 10);
    const pushed = [push("ch-1", 1, 10), push("ch-1", 2, 10), push("ch-1", 3, 10)];
    expect(pushed).toEqual([true, true, true]);

    const list = listSnapshots(db, "chapter", "ch-1");
    expect(list.map((s) => s.createdAt)).toEqual([T1, T1, T1]); // 前置：时间完全相同
    expect(list.map((s) => s.seq)).toEqual([...list.map((s) => s.seq)].sort((a, b) => b - a));
 // 新→旧与压入顺序一致：最新的那份是最后压入的内容
    expect(getSnapshot(db, "chapter", "ch-1", list[0]!.seq)!.content).toBe('[{"id":"b3"}]');
    expect(getSnapshot(db, "chapter", "ch-1", list[2]!.seq)!.content).toBe('[{"id":"b1"}]');
  });

  it("单份读取必须同时命中 owner：别的章的 seq 读不到（seq 全局自增）", () => {
    seedChapter("ch-1", 10);
    seedChapter("ch-2", 10);
    push("ch-1", 1, 10);
    const [seq] = seqs("ch-1");
    expect(getSnapshot(db, "chapter", "ch-1", seq!)).not.toBeNull();
    expect(getSnapshot(db, "chapter", "ch-2", seq!)).toBeNull();
    expect(getSnapshot(db, "chapter", "ch-1", seq! + 999)).toBeNull();
  });

  it("deleteSnapshotsByOwner：只删该章的（purge 级联），幂等", () => {
    seedChapter("ch-1", 10);
    seedChapter("ch-2", 10);
    push("ch-1", 1, 10);
    push("ch-2", 2, 10);

    expect(deleteSnapshotsByOwner(db, "chapter", "ch-1")).toBe(1);
    expect(listSnapshots(db, "chapter", "ch-1")).toEqual([]);
    expect(listSnapshots(db, "chapter", "ch-2")).toHaveLength(1);
    expect(deleteSnapshotsByOwner(db, "chapter", "ch-1")).toBe(0);
  });
});