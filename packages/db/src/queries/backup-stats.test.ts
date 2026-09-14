// 备份命名统计段测试（云端存档批次 1）：
// 覆盖 getBackupStats 的未软删口径（实体计数不含回收站；章 = outline 非软删 chapter，含直挂 root）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { writeOutlineFile } from "../storage/outline.js";
import { createEntity, softDeleteEntity } from "./entity.js";
import { getBackupStats } from "./backup-stats.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-stats-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

/** 造一棵三层大纲：卷下两章（第二章软删）+ 直挂 root 一章 + 章下场景（不计入） */
function seedOutline(): void {
  const tree = {
    id: "root",
    type: "root",
    schema_version: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: "2026-08-01T00:00:00Z",
        children: [
          { id: "ch-1", type: "chapter", title: "第一章", updated_at: "2026-08-01T00:00:00Z" },
          { id: "ch-2", type: "chapter", title: "第二章", updated_at: "2026-08-01T00:00:00Z", deleted: true },
        ],
      },
      { id: "ch-3", type: "chapter", title: "直挂章", updated_at: "2026-08-01T00:00:00Z" },
    ],
  } as unknown as OutlineFileTree;
  writeOutlineFile(dir, tree);
}

describe("getBackupStats（备份命名统计段：人物 / 设定 / 章，未软删口径）", () => {
  it("空项目：全 0（outline.json 缺失 → 空树）", () => {
    expect(getBackupStats(db, dir)).toEqual({ characters: 0, settings: 0, chapters: 0 });
  });

  it("实体计数只算未软删（人物/设定各计，其他类型不计）", () => {
    createEntity(db, { type: "character", name: "张三" });
    createEntity(db, { type: "character", name: "李四" });
    createEntity(db, { type: "setting", name: "灵气" });
    createEntity(db, { type: "location", name: "青云山" }); // 不计入统计段
    createEntity(db, { type: "hook", name: "玉佩" }); // 不计入统计段

    expect(getBackupStats(db, dir)).toEqual({ characters: 2, settings: 1, chapters: 0 });
  });

  it("软删实体不计入（回收站不算存量）", () => {
    const a = createEntity(db, { type: "character", name: "张三" });
    createEntity(db, { type: "setting", name: "灵气" });
    softDeleteEntity(db, a.id, "2026-08-13T10:00:00Z");

    expect(getBackupStats(db, dir)).toEqual({ characters: 0, settings: 1, chapters: 0 });
  });

  it("章计数只算未软删 chapter（卷/场景不计；直挂 root 的章计入）", () => {
    seedOutline();
    expect(getBackupStats(db, dir).chapters).toBe(2); // ch-1 + 直挂 ch-3（ch-2 软删）
  });

  it("实体与章同时统计（一次调用给出三项）", () => {
    seedOutline();
    createEntity(db, { type: "character", name: "张三" });
    createEntity(db, { type: "setting", name: "灵气" });
    expect(getBackupStats(db, dir)).toEqual({ characters: 1, settings: 1, chapters: 2 });
  });
});
