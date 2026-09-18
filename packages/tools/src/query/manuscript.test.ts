// 查询类工具测试：章正文只读（get_chapter_text，卡 12.9）
// 覆盖：正常读取（投影 + 章号 + 字数）/ 分页续读拼回原文 / 截断标记含续读 offset /
// max_chars 缺省与上限 clamp / 非章报错 / 不存在与软删报错 / 空正文（未写过 = 不报错）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, findOutlineNode, openDatabase, readOutlineFile, upsertDocument, writeOutlineFile, type Db } from "@whispering233/ai-editor-db";
import { MAX_CHAPTER_TEXT_CHARS, runGetChapterText } from "./manuscript.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-manuscript-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 卷[第一章[场景一], 第二章]（章序：ch-1 = 1、ch-2 = 2） */
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
            children: [{ id: "sc-1", type: "scene", title: "场景一", updated_at: T0 }],
          },
          { id: "ch-2", type: "chapter", title: "第二章", updated_at: T0, children: [] },
        ],
      },
    ],
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

/** 写某章正文（真相 = 块数组 JSON；投影 = 服务端派生，测试直接给期望文本——不自证） */
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

describe("get_chapter_text", () => {
  beforeEach(() => {
    writeOutlineFile(dir, seedOutlineTree());
  });

  it("正常读取：text = content_text 投影、char_count = 全长、章号与标题齐备（默认 max_chars 不截断）", () => {
    const text = "第一段。\n\n第二段。";
    seedChapterText("ch-1", text);
    const result = runGetChapterText(makeCtx(), { node_id: "ch-1" });
    expect(result).toEqual({
      chapter_id: "ch-1",
      title: "第一章",
      chapter_number: 1,
      char_count: text.length,
      offset: 0,
      returned_chars: text.length,
      text,
      truncated: false,
    });
  });

  it("章号 = 全局章序（跨卷连续口径，第二章 → 2）", () => {
    seedChapterText("ch-2", "开场白");
    expect(runGetChapterText(makeCtx(), { node_id: "ch-2" }).chapter_number).toBe(2);
  });

  it("分页续读：截断页附续读提示，按 returned_chars 推移 offset 拼回原文", () => {
    const text = "第一段正文；第二段正文；第三段正文——分页续读拼回原文的测试文本。";
    seedChapterText("ch-1", text);
    const ctx = makeCtx();
    const pages: string[] = [];
    let offset = 0;
    let result = runGetChapterText(ctx, { node_id: "ch-1", offset, max_chars: 8 });
    for (;;) {
      // 截断页的正文 = text 前缀（提示文案不在 returned_chars 内）
      pages.push(result.text.slice(0, result.returned_chars));
      if (!result.truncated) break;
      expect(result.text).toContain(`已截断，可用 offset=${offset + result.returned_chars} 继续读取`);
      offset += result.returned_chars;
      result = runGetChapterText(ctx, { node_id: "ch-1", offset, max_chars: 8 });
    }
    expect(pages.join("")).toBe(text);
    expect(offset).toBe(text.length - result.returned_chars); // 末页起点 = 全长 − 末页长度
    expect(result.char_count).toBe(text.length); // 全长与 offset 无关
  });

  it("max_chars 缺省 6000；超上限按 20000 clamp", () => {
    const long = "甲".repeat(MAX_CHAPTER_TEXT_CHARS + 1000);
    seedChapterText("ch-1", long);
    const ctx = makeCtx();
    const clamped = runGetChapterText(ctx, { node_id: "ch-1", max_chars: 999999 });
    expect(clamped.returned_chars).toBe(MAX_CHAPTER_TEXT_CHARS);
    expect(clamped.truncated).toBe(true);
    // 缺省值一次读完 6000 字符以内文本（超长文本才有截断，此处用中等长度验缺省不报错）
    seedChapterText("ch-2", "乙".repeat(6000));
    expect(runGetChapterText(ctx, { node_id: "ch-2" }).truncated).toBe(false);
  });

  it("非章节点报错（卷/场景——与 propose_add_delta 章级口径同源）", () => {
    expect(() => runGetChapterText(makeCtx(), { node_id: "vol-1" })).toThrow(/须为章/);
    expect(() => runGetChapterText(makeCtx(), { node_id: "sc-1" })).toThrow(/须为章/);
  });

  it("节点不存在 / 已软删 → 抛错（章软删后正文不可读）", () => {
    expect(() => runGetChapterText(makeCtx(), { node_id: "ch-999" })).toThrow(/不存在或已软删/);
    seedChapterText("ch-2", "有正文但章已软删");
    softDeleteNode("ch-2");
    expect(() => runGetChapterText(makeCtx(), { node_id: "ch-2" })).toThrow(/不存在或已软删/);
  });

  it("未写过正文：char_count=0、text=\"\"、不报错（章号仍返回）", () => {
    expect(runGetChapterText(makeCtx(), { node_id: "ch-1" })).toEqual({
      chapter_id: "ch-1",
      title: "第一章",
      chapter_number: 1,
      char_count: 0,
      offset: 0,
      returned_chars: 0,
      text: "",
      truncated: false,
    });
  });

  it("offset 越界 → 空片段（无截断标记）；负 offset 抛错（schema 之外防御）", () => {
    seedChapterText("ch-1", "短文本");
    const beyond = runGetChapterText(makeCtx(), { node_id: "ch-1", offset: 100 });
    expect(beyond).toMatchObject({ offset: 100, returned_chars: 0, text: "", truncated: false });
    expect(() => runGetChapterText(makeCtx(), { node_id: "ch-1", offset: -1 })).toThrow(/offset 必须为非负整数/);
  });
});
