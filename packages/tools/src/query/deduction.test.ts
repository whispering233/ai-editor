// 查询类工具测试：推演节点标记只读（get_deduction_marks，卡 D4）
// 覆盖：无标记 / 标记全部失效（不存在、场景、软删章、软删卷下的章）/ 单标记（role+章号+path）/
// 多标记（树序排序、role start·node·end、跨卷）/ 区间骨架（chapter_count / middle 清单 /
// written_chapters 只数中间章）/ path 含存量根级章 / summary 缺失不写键
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import {
  closeDatabase,
  findOutlineNode,
  openDatabase,
  readOutlineFile,
  upsertDocument,
  writeOutlineFile,
  writeProjectFile,
  type Db,
} from "@whispering233/ai-editor-db";
import { runGetDeductionMarks } from "./deduction.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-deduction-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-09-01T10:00:00Z";

/**
 * 卷一[血夜 ch-1, 晨曦 ch-2(场景 sc-1), 归途 ch-3] + 卷二[远行 ch-4, 尾声 ch-5]
 * + 存量直挂 root 的章 番外 ch-6。
 * 可见章先序（= 章号口径）：ch-1..ch-6。
 */
function seedOutlineTree(): OutlineFileTree {
  const chapter = (id: string, title: string, summary?: string) => ({
    id,
    type: "chapter" as const,
    title,
    updated_at: T0,
    ...(summary === undefined ? {} : { summary }),
    children: [],
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
        children: [
          chapter("ch-1", "血夜", "开篇：雪夜屠城"),
          {
            id: "ch-2",
            type: "chapter",
            title: "晨曦",
            updated_at: T0,
            children: [{ id: "sc-1", type: "scene", title: "场景一", updated_at: T0 }],
          },
          chapter("ch-3", "归途"),
        ],
      },
      {
        id: "vol-2",
        type: "volume",
        title: "第二卷",
        updated_at: T0,
        children: [chapter("ch-4", "远行"), chapter("ch-5", "尾声")],
      },
      chapter("ch-6", "番外"),
    ],
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

/** project.json（缺 deduction_nodes 字段 = 旧文件口径 → 读侧空数组） */
function seedProject(deductionNodes?: string[]): void {
  writeProjectFile(dir, {
    id: "proj-test",
    name: "测试书",
    language: "zh",
    schema_version: 1,
    created_at: T0,
    updated_at: T0,
    ...(deductionNodes === undefined ? {} : { deduction_nodes: deductionNodes }),
  });
}

/** 写某章正文投影（真相 = 块数组 JSON；投影由服务端派生，测试直接给期望文本——不自证） */
function seedChapterText(chapterId: string, text: string): void {
  upsertDocument(db, {
    ownerKind: "chapter",
    ownerId: chapterId,
    content: JSON.stringify([{ type: "paragraph", content: [{ type: "text", text }] }]),
    contentText: text,
    now: T0,
  });
}

/** 软删大纲节点（测试直写 outline.json） */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  expect(node).toBeDefined();
  node!.deleted = true;
  node!.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

describe("get_deduction_marks", () => {
  beforeEach(() => {
    writeOutlineFile(dir, seedOutlineTree());
  });

  it("无标记（project.json 缺字段）→ { marks: [], spans: [] }（不报错）", () => {
    seedProject();
    expect(runGetDeductionMarks(makeCtx())).toEqual({ marks: [], spans: [] });
  });

  it("标记全部失效（不存在 id / 场景 / 软删章 / 软删卷下的章）→ 空结果（读侧过滤，不报错）", () => {
    seedProject(["ch-999", "sc-1", "vol-1", "ch-3", "ch-4"]);
    softDeleteNode("ch-3"); // 直接软删章
    softDeleteNode("vol-2"); // 软删卷 ⇒ 其下 ch-4 / ch-5 不可见
    expect(runGetDeductionMarks(makeCtx())).toEqual({ marks: [], spans: [] });
  });

  it("单标记：role=single、章号来自可见章先序、path = 卷→章标题链、summary 存在则带上", () => {
    seedProject(["ch-1"]);
    expect(runGetDeductionMarks(makeCtx())).toEqual({
      marks: [
        {
          index: 1,
          role: "single",
          node_id: "ch-1",
          chapter_number: 1,
          path: ["第一卷", "血夜"],
          title: "血夜",
          summary: "开篇：雪夜屠城",
        },
      ],
      spans: [],
    });
  });

  it("path 拼接：存量直挂 root 的章只有自身标题（无卷段）", () => {
    seedProject(["ch-6"]);
    const result = runGetDeductionMarks(makeCtx());
    expect(result.marks[0].path).toEqual(["番外"]);
    expect(result.marks[0].chapter_number).toBe(6); // 根级章参与可见章先序编号
  });

  it("summary 缺失 → 不写该键（对象无 summary 属性）", () => {
    seedProject(["ch-3"]);
    const result = runGetDeductionMarks(makeCtx());
    expect(result.marks[0]).not.toHaveProperty("summary");
  });

  it("多标记：顺序 = 可见章先序（与标记先后无关），role = start/node/end", () => {
    seedProject(["ch-5", "ch-1", "ch-3"]); // 乱序写入
    const result = runGetDeductionMarks(makeCtx());
    expect(result.marks.map((m) => [m.node_id, m.index, m.role, m.chapter_number])).toEqual([
      ["ch-1", 1, "start", 1],
      ["ch-3", 2, "node", 3],
      ["ch-5", 3, "end", 5],
    ]);
    expect(result.marks[1].path).toEqual(["第一卷", "归途"]);
    expect(result.marks[2].path).toEqual(["第二卷", "尾声"]); // 跨卷：path 各自带所属卷标题
  });

  it("区间骨架：middle = 严格位于两端之间的可见章（不含两端标记），chapter_count = middle.length", () => {
    seedProject(["ch-1", "ch-4"]);
    const result = runGetDeductionMarks(makeCtx());
    expect(result.spans).toEqual([
      {
        from_index: 1,
        to_index: 2,
        chapter_count: 2,
        written_chapters: 0,
        middle: [
          { node_id: "ch-2", chapter_number: 2, title: "晨曦" },
          { node_id: "ch-3", chapter_number: 3, title: "归途" },
        ],
      },
    ]);
  });

  it("written_chapters：只数中间章中正文投影非空的章（两端标记写了正文也不算）", () => {
    seedChapterText("ch-1", "起点章正文"); // 两端标记 → 不计入
    seedChapterText("ch-2", "中间章正文");
    seedChapterText("ch-4", "终点章正文"); // 两端标记 → 不计入
    seedProject(["ch-1", "ch-4"]);
    const result = runGetDeductionMarks(makeCtx());
    expect(result.spans[0].chapter_count).toBe(2);
    expect(result.spans[0].written_chapters).toBe(1);
  });

  it("多区间（跨卷）：相邻标记两两成区间，中间章按可见章先序连续切片", () => {
    seedProject(["ch-1", "ch-3", "ch-6"]);
    const result = runGetDeductionMarks(makeCtx());
    expect(result.spans.map((s) => [s.from_index, s.to_index, s.chapter_count])).toEqual([
      [1, 2, 1],
      [2, 3, 2],
    ]);
    expect(result.spans[0].middle.map((m) => m.node_id)).toEqual(["ch-2"]);
    expect(result.spans[1].middle.map((m) => m.node_id)).toEqual(["ch-4", "ch-5"]); // 跨卷（ch-3 → ch-6）
    expect(result.spans[1].middle.map((m) => m.chapter_number)).toEqual([4, 5]);
  });

  it("软删章不出现在 marks，也不出现在其它区间的 middle（编号仍按可见章先序）", () => {
    softDeleteNode("ch-2");
    seedProject(["ch-1", "ch-3"]);
    const result = runGetDeductionMarks(makeCtx());
    expect(result.marks.map((m) => [m.node_id, m.chapter_number])).toEqual([
      ["ch-1", 1],
      ["ch-3", 2], // 软删 ch-2 后重排：可见章先序只计未软删章
    ]);
    expect(result.spans[0]).toMatchObject({ chapter_count: 0, written_chapters: 0, middle: [] });
  });
});
