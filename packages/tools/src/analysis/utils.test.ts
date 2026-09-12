// 章节序索引（ChapterIndex）软删可见性测试（卡片 2.7）
// 契约（docs/design/10-data-model.md §4「章序前缀累积」·章序的定义）：
// 章号 = 先序文件位置序（含软删章，不因删除重排）；可见性由消费方处理——
// chapterOf 对软删节点返回 null；「当前章」的退化分支必须取**最后一个未软删章**。
// 覆盖：末章软删（不再虚报进度一章）/ 中间章软删（编号保留空洞不重排）/ 全删 / 无章 /
// current_position 优先 / current_position 指向软删章 → 退化。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, writeOutlineFile, writeProjectFile, type Db } from "@whispering233/ai-editor-db";
import { buildChapterIndex } from "./utils.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-chapter-index-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 三章树：ch-1[sc-1,sc-2] / ch-2[sc-3,sc-4] / ch-3[sc-5,sc-6]（章号 1/2/3） */
function seedOutlineTree(options: { deletedChapterIds?: readonly string[] } = {}): OutlineFileTree {
  const deleted = new Set(options.deletedChapterIds ?? []);
  const chapter = (id: string, title: string, scenes: readonly string[]) => ({
    id,
    type: "chapter" as const,
    title,
    updated_at: T0,
    ...(deleted.has(id) ? { deleted: true } : {}),
    // 级联软删：章软删时其场景一并软删（服务端软删语义；本索引只看 deleted 标记）
    children: scenes.map((sceneId) => ({
      id: sceneId,
      type: "scene" as const,
      title: `场景${sceneId}`,
      updated_at: T0,
      ...(deleted.has(id) ? { deleted: true } : {}),
    })),
  });
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
        children: [chapter("ch-1", "第一章", ["sc-1", "sc-2"]), chapter("ch-2", "第二章", ["sc-3", "sc-4"]), chapter("ch-3", "第三章", ["sc-5", "sc-6"])],
      },
    ],
  };
}

/** 种子：大纲树 + project.json（current_position 可配，默认不设） */
function seedBase(currentPosition: string | null = null, deletedChapterIds: readonly string[] = []): void {
  writeOutlineFile(dir, seedOutlineTree({ deletedChapterIds }));
  writeProjectFile(dir, {
    id: "proj-test",
    name: "测试书",
    language: "zh",
    prompt: "",
    schema_version: 1,
    current_position: currentPosition,
    created_at: T0,
    updated_at: T0,
  });
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

describe("ChapterIndex 软删可见性（卡片 2.7）", () => {
  it("末章软删 → currentChapter 取最后一个**可见**章的章号（不再虚报进度一章）", () => {
    seedBase(null, ["ch-3"]);
    const index = buildChapterIndex(makeCtx());
    // 章号是位置序（ch-3 = 3），可见章只有 ch-1(1)/ch-2(2) → 当前章 = 2
    expect(index.currentChapter).toBe(2);
    // 软删章自身无章号（可见性既有语义不变）
    expect(index.chapterOf("ch-3")).toBeNull();
    expect(index.chapterOf("sc-5")).toBeNull();
    expect(index.chapterOf("ch-2")).toBe(2);
  });

  it("中间章软删 → 编号保留空洞不重排（ch-2 软删后 ch-3 仍是第 3 章）", () => {
    seedBase(null, ["ch-2"]);
    const index = buildChapterIndex(makeCtx());
    expect(index.chapterOf("ch-2")).toBeNull(); // 软删不可见
    expect(index.chapterOf("ch-3")).toBe(3); // 位置序不因删除重排
    expect(index.currentChapter).toBe(3); // 最后一个可见章 = ch-3
  });

  it("最后可见章在中间、尾部多章软删 → 取最末可见章", () => {
    seedBase(null, ["ch-2", "ch-3"]);
    const index = buildChapterIndex(makeCtx());
    expect(index.currentChapter).toBe(1);
  });

  it("全部章软删 → currentChapter = null", () => {
    seedBase(null, ["ch-1", "ch-2", "ch-3"]);
    const index = buildChapterIndex(makeCtx());
    expect(index.currentChapter).toBeNull();
  });

  it("大纲无章（只有卷）→ currentChapter = null", () => {
    writeOutlineFile(dir, {
      id: "root",
      type: "root",
      schema_version: 1,
      children: [{ id: "vol-1", type: "volume", title: "空卷", updated_at: T0, children: [] }],
    });
    writeProjectFile(dir, {
      id: "proj-test",
      name: "测试书",
      language: "zh",
      prompt: "",
      schema_version: 1,
      current_position: null,
      created_at: T0,
      updated_at: T0,
    });
    const index = buildChapterIndex(makeCtx());
    expect(index.currentChapter).toBeNull();
  });

  it("current_position 指向可见章 → 优先取该章（不被末章覆盖）", () => {
    seedBase("ch-1");
    expect(buildChapterIndex(makeCtx()).currentChapter).toBe(1);
  });

  it("current_position 指向场景 → 取所属章（既有语义不变）", () => {
    seedBase("sc-3");
    expect(buildChapterIndex(makeCtx()).currentChapter).toBe(2);
  });

  it("current_position 指向软删章 → 退化到最后一个可见章", () => {
    seedBase("ch-3", ["ch-3"]);
    expect(buildChapterIndex(makeCtx()).currentChapter).toBe(2);
  });

  it("current_position 指向不存在节点 → 退化到最后一个可见章", () => {
    seedBase("ch-99");
    expect(buildChapterIndex(makeCtx()).currentChapter).toBe(3);
  });
});
