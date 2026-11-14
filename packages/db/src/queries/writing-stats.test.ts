// 码字日统计读写测试（writing_stats_daily，2026-11）
// 覆盖：同日累加（upsert）/ 跨日分行 / 只接受正整数 / 表级 CHECK（chars > 0）/ 读取升序。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { addWritingChars, listWritingStats } from "./writing-stats.js";

const T1 = "2026-11-01T10:00:00Z";
const T2 = "2026-11-01T11:00:00Z";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-writing-stats-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("addWritingChars", () => {
  it("同日累加：一行、chars 求和、updated_at 推进到最近一次写入", () => {
    addWritingChars(db, "2026-11-01", 120, T1);
    addWritingChars(db, "2026-11-01", 80, T2);

    const rows = db
      .prepare("SELECT stat_date, chars, updated_at FROM writing_stats_daily")
      .all() as Array<{ stat_date: string; chars: number; updated_at: string }>;
    expect(rows).toEqual([{ stat_date: "2026-11-01", chars: 200, updated_at: T2 }]);
  });

  it("跨日分行：每天一行、互不累加", () => {
    addWritingChars(db, "2026-11-01", 10, T1);
    addWritingChars(db, "2026-11-03", 7, T1);

    expect(listWritingStats(db)).toEqual([
      { date: "2026-11-01", chars: 10 },
      { date: "2026-11-03", chars: 7 },
    ]);
  });

  it("只接受正整数：0 / 负数 / 非整数一律抛错且不落行", () => {
    for (const chars of [0, -1, 1.5, Number.NaN]) {
      expect(() => addWritingChars(db, "2026-11-01", chars, T1), `chars=${String(chars)}`).toThrow(/正整数/);
    }
    expect(listWritingStats(db)).toEqual([]);
  });

  it("表级 CHECK chars > 0：绕过 helper 直插 0 / 负数被 SQLite 拒绝", () => {
    for (const chars of [0, -5]) {
      try {
        db.prepare("INSERT INTO writing_stats_daily (stat_date, chars, updated_at) VALUES (?, ?, ?)").run(
          `d${chars}`,
          chars,
          T1,
        );
        expect.unreachable("CHECK 应拒绝 chars <= 0");
      } catch (err) {
        expect((err as { code?: string }).code).toBe("SQLITE_CONSTRAINT_CHECK");
      }
    }
  });
});

describe("listWritingStats", () => {
  it("按 stat_date 升序（与插入顺序无关）", () => {
    addWritingChars(db, "2026-11-10", 3, T1);
    addWritingChars(db, "2026-10-31", 5, T1);
    addWritingChars(db, "2026-11-02", 1, T1);

    expect(listWritingStats(db).map((d) => d.date)).toEqual(["2026-10-31", "2026-11-02", "2026-11-10"]);
  });

  it("空表 → 空数组", () => {
    expect(listWritingStats(db)).toEqual([]);
  });
});