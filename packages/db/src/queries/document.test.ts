// 卡 12.2 块文档读写测试：首写 / 覆盖写（版本戳推进 + created_at 不动）/ 复合主键 / 删除 / 未知 owner
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { deleteDocumentsByOwner, getDocument, upsertDocument } from "./document.js";

const T1 = "2026-10-01T10:00:00Z";
const T2 = "2026-10-01T10:05:00Z";

/** 块数组 JSON 字符串（真相载荷——本包不解析内容，原样存取） */
const doc = (text: string): string => JSON.stringify([{ id: "b1", type: "paragraph", content: text }]);

let dir: string;
let db: Db;

/** 直查行数（绕过 helper，验证落库形态而非 helper 自说自话） */
function countRows(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM document_records").get() as { c: number }).c;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-document-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("upsertDocument / getDocument", () => {
  it("首写：行落库（content/content_text 原样、created_at = updated_at = now）", () => {
    const result = upsertDocument(db, {
      ownerKind: "chapter",
      ownerId: "ch-1",
      content: doc("第一章正文"),
      contentText: "第一章正文",
      now: T1,
    });

    expect(result).toEqual({ updatedAt: T1 });
    expect(countRows()).toBe(1);
    expect(getDocument(db, "chapter", "ch-1")).toEqual({
      owner_kind: "chapter",
      owner_id: "ch-1",
      content: doc("第一章正文"),
      content_text: "第一章正文",
      created_at: T1,
      updated_at: T1,
    });
  });

  it("覆盖写：content/content_text 替换、created_at 不动、updated_at 推进（版本戳）", () => {
    upsertDocument(db, { ownerKind: "chapter", ownerId: "ch-1", content: doc("初稿"), contentText: "初稿", now: T1 });
    const second = upsertDocument(db, {
      ownerKind: "chapter",
      ownerId: "ch-1",
      content: doc("改稿"),
      contentText: "改稿",
      now: T2,
    });

    expect(second).toEqual({ updatedAt: T2 });
    expect(countRows()).toBe(1); // upsert 不产生第二行
    const row = getDocument(db, "chapter", "ch-1")!;
    expect(row.content).toBe(doc("改稿"));
    expect(row.content_text).toBe("改稿");
    expect(row.created_at).toBe(T1); // 首写时间保留
    expect(row.updated_at).toBe(T2);
  });

  it("owner 隔离：同 id 不同 kind / 同 kind 不同 id 各存一行（复合主键）", () => {
    upsertDocument(db, { ownerKind: "chapter", ownerId: "x-1", content: doc("章"), contentText: "章", now: T1 });
    upsertDocument(db, { ownerKind: "reference", ownerId: "x-1", content: doc("资料"), contentText: "资料", now: T1 });
    upsertDocument(db, { ownerKind: "chapter", ownerId: "x-2", content: doc("另一章"), contentText: "另一章", now: T1 });

    expect(countRows()).toBe(3);
    expect(getDocument(db, "chapter", "x-1")!.content_text).toBe("章");
    expect(getDocument(db, "reference", "x-1")!.content_text).toBe("资料");
    expect(getDocument(db, "chapter", "x-2")!.content_text).toBe("另一章");
  });

  it("复合主键 (owner_kind, owner_id) 生效：绕过 helper 直插同 owner 重复行被拒", () => {
    const insert = db.prepare(
      "INSERT INTO document_records (owner_kind, owner_id, content, content_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run("chapter", "ch-1", "[]", "", T1, T1);
    expect(() => insert.run("chapter", "ch-1", "[]", "", T1, T1)).toThrow(/UNIQUE|PRIMARY/);
  });
});

describe("deleteDocumentsByOwner / 未知 owner", () => {
  it("未知 owner → null（无行不报错）", () => {
    expect(getDocument(db, "chapter", "ch-404")).toBeNull();
    expect(getDocument(db, "reference", "ref-404")).toBeNull();
  });

  it("删除按 owner 精确命中：返回删除行数，只删该 owner 的行，删除后再取为 null", () => {
    upsertDocument(db, { ownerKind: "chapter", ownerId: "ch-1", content: doc("章"), contentText: "章", now: T1 });
    upsertDocument(db, { ownerKind: "chapter", ownerId: "ch-2", content: doc("另一章"), contentText: "另一章", now: T1 });

    expect(deleteDocumentsByOwner(db, "chapter", "ch-1")).toBe(1);
    expect(getDocument(db, "chapter", "ch-1")).toBeNull();
    expect(getDocument(db, "chapter", "ch-2")).not.toBeNull(); // 其余 owner 不动
 // 幂等：再删一次为 0
    expect(deleteDocumentsByOwner(db, "chapter", "ch-1")).toBe(0);
    expect(countRows()).toBe(1);
  });
});
