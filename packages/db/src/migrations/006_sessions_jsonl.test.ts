// 迁移 006 测试（B2）：chat_messages 全量导出为 sessions/<id>.jsonl 后 DROP 表
// 覆盖：内容/顺序保真（含 tool_calls / tool_call_id）· 表消失 + 版本推进 · 非法 session_id 确定性改名导出 ·
// 无旧表时 no-op · 幂等（重跑不重复导出）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { readSessionRows, sessionsDirPath } from "../sessions.js";
import { DATA_DB_FILE_NAME, ensureSchemaCompatible } from "../queries/migration.js";

let dir: string;
let dbPath: string;
let db: Db;

/** v5 时期的 chat_messages DDL（迁移读取的旧表；新库建表已不含） */
const LEGACY_CHAT_DDL = `
CREATE TABLE chat_messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
  content       TEXT,
  tool_calls    TEXT,
  tool_call_id  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_chat_session ON chat_messages(session_id, created_at);
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-migration-006-"));
  dbPath = join(dir, DATA_DB_FILE_NAME);
  db = openDatabase(dbPath);
});

afterEach(() => {
  if (db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** 构造 v5 库：旧 chat_messages 表 + 若干行 + user_version = 5 */
function seedLegacyV5(
  rows: Array<{
    id: string;
    session_id: string;
    role: string;
    content?: string | null;
    tool_calls?: string | null;
    tool_call_id?: string | null;
    created_at: string;
  }>,
): void {
  db.exec(LEGACY_CHAT_DDL);
  const insert = db.prepare(
    `INSERT INTO chat_messages (id, session_id, project_id, role, content, tool_calls, tool_call_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    insert.run(
      r.id,
      r.session_id,
      "proj-legacy",
      r.role,
      r.content ?? null,
      r.tool_calls ?? null,
      r.tool_call_id ?? null,
      r.created_at,
    );
  }
  setUserVersion(db, 5);
}

/** 表是否存在 */
function tableExists(d: Db, name: string): boolean {
  return d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) !== undefined;
}

describe("迁移 006：对话历史出库", () => {
  it("导出内容/顺序保真（含 tool_calls / tool_call_id）、表消失、版本推进到 SCHEMA_VERSION", () => {
    seedLegacyV5([
      {
        id: "m1",
        session_id: "sess_a",
        role: "user",
        content: "问题一",
        created_at: "2026-08-01T10:00:00Z",
      },
      {
        id: "m2",
        session_id: "sess_a",
        role: "assistant",
        content: "查询中",
        tool_calls: JSON.stringify([{ id: "call_1", type: "function", function: { name: "get_entity", arguments: "{}" } }]),
        created_at: "2026-08-01T10:01:00Z",
      },
      {
        id: "m3",
        session_id: "sess_a",
        role: "tool",
        content: "结果",
        tool_call_id: "call_1",
        created_at: "2026-08-01T10:02:00Z",
      },
      { id: "m4", session_id: "sess_b", role: "user", content: "另一个会话", created_at: "2026-08-02T09:00:00Z" },
    ]);

    const { db: active } = ensureSchemaCompatible(db, dir, dbPath);

 // 表已 DROP、版本推进
    expect(tableExists(active, "chat_messages")).toBe(false);
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);

 // 会话文件导出（内容与顺序保真）
    const a = readSessionRows(dir, "sess_a");
    expect(a.map((r) => r.id)).toEqual(["m1", "m2", "m3"]);
    expect(a.map((r) => r.role)).toEqual(["user", "assistant", "tool"]);
    expect(a[1]?.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "get_entity", arguments: "{}" } },
    ]);
    expect(a[2]?.tool_call_id).toBe("call_1");
    expect(a[0]?.content).toBe("问题一");
    expect(readSessionRows(dir, "sess_b").map((r) => r.id)).toEqual(["m4"]);
  });

  it("非法 session_id 的旧会话不丢：以 sess_legacy_<hash> 文件名导出（确定性、无穿越产物）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedLegacyV5([
      { id: "m1", session_id: "sess_ok", role: "user", content: "正常", created_at: "2026-08-01T10:00:00Z" },
 // 无法直接作文件名（含路径分隔符 / 不匹配 sess_ 白名单）
      { id: "m2", session_id: "../../evil", role: "user", content: "穿越企图", created_at: "2026-08-01T10:01:00Z" },
      { id: "m3", session_id: "sess-无前缀", role: "user", content: "旧命名", created_at: "2026-08-01T10:02:00Z" },
    ]);

    ensureSchemaCompatible(db, dir, dbPath);

    expect(readSessionRows(dir, "sess_ok").map((r) => r.id)).toEqual(["m1"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2 个 session_id 非法的旧会话"));
 // 数据未丢：两个非法 id 会话都落盘（内容保真），文件名 = 确定性映射
    const files = readdirSync(sessionsDirPath(dir)).sort();
    expect(files).toHaveLength(3);
    const legacyFiles = files.filter((f) => f.startsWith("sess_legacy_"));
    expect(legacyFiles).toHaveLength(2);
    const contents = legacyFiles.map((f) => readSessionRows(dir, f.replace(/\.jsonl$/, ""))[0]?.content);
    expect(contents.sort()).toEqual(["旧命名", "穿越企图"].sort());
 // 无目录穿越产物（未在项目目录外/上级写文件）
    expect(existsSync(join(dir, "evil.jsonl"))).toBe(false);
    expect(existsSync(join(dirname(dir), "evil.jsonl"))).toBe(false);
  });

  it("库内无 chat_messages（新库/已迁移）→ no-op 不报错，版本照常推进", () => {
    setUserVersion(db, 5); // 无旧表的 v5 库（新建库形态）
    const { db: active } = ensureSchemaCompatible(db, dir, dbPath);
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
    expect(existsSync(sessionsDirPath(dir))).toBe(false); // 无导出即不建目录
  });

  it("幂等：迁移后重跑无 pending，已导出文件不被改写", () => {
    seedLegacyV5([{ id: "m1", session_id: "sess_a", role: "user", content: "内容", created_at: "T1" }]);
    const first = ensureSchemaCompatible(db, dir, dbPath);
    const before = readSessionRows(dir, "sess_a");

    // 重跑（版本已到 6 → 无 pending；重建分支不触发）
    const second = ensureSchemaCompatible(first.db, dir, dbPath);
    expect(second.result.rebuilt).toBe(false);
    expect(second.result.migrated).toBeUndefined();
    expect(readSessionRows(dir, "sess_a")).toEqual(before);
  });

  it("空表（0 行）也推进版本并 DROP 表", () => {
    seedLegacyV5([]);
    const { db: active } = ensureSchemaCompatible(db, dir, dbPath);
    expect(tableExists(active, "chat_messages")).toBe(false);
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
  });
});
