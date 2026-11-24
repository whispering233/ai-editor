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
import { MAX_TEXT_PAGE_CHARS, MANUSCRIPT_SNIPPET_WINDOW_CHARS, MAX_MANUSCRIPT_SEARCH_HITS, runGetChapterText, runSearchManuscript } from "./manuscript.js";

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

  it("max_chars 缺省 6000；超上限按 MAX_TEXT_PAGE_CHARS clamp（压进外层 TOOL_RESULT_MAX_TOKENS 预算 + ≥10% 余量）", () => {
    // 数值与实测绑定：外层单条上限 = TOOL_RESULT_MAX_TOKENS（agent/src/runtime/tool-result.ts），
    // CJK 约 1 token/字；上限页 + JSON 信封 + 续读提示必须留在预算内并留白——超了就丢「可用 offset 续读」提示
    expect(MAX_TEXT_PAGE_CHARS).toBe(7000);
    const long = "甲".repeat(MAX_TEXT_PAGE_CHARS + 1000);
    seedChapterText("ch-1", long);
    const ctx = makeCtx();
    const clamped = runGetChapterText(ctx, { node_id: "ch-1", max_chars: 999999 });
    expect(clamped.returned_chars).toBe(MAX_TEXT_PAGE_CHARS);
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

describe("search_manuscript", () => {
  /** 章数 > 单页上限的书：ch-1..ch-n 全挂同一卷（章号 = 1..n） */
  function seedLongBook(chapterCount: number): void {
    writeOutlineFile(dir, {
      id: "root",
      type: "root",
      schema_version: 1,
      children: [
        {
          id: "vol-1",
          type: "volume",
          title: "第一卷",
          updated_at: T0,
          children: Array.from({ length: chapterCount }, (_, i) => ({
            id: `ch-${i + 1}`,
            type: "chapter" as const,
            title: `第${i + 1}章`,
            updated_at: T0,
            children: [],
          })),
        },
      ],
    });
  }

  it("命中章正文：章名 + 阅读序章号 + 片段齐备，total = 命中章数", () => {
    writeOutlineFile(dir, seedOutlineTree());
    seedChapterText("ch-2", "断刃峡的风停了。");
    seedChapterText("ch-1", "无关键词的正文。");
    expect(runSearchManuscript(makeCtx(), { query: "断刃峡" })).toEqual({
      items: [{ chapterId: "ch-2", chapterNumber: 2, title: "第二章", snippet: "断刃峡的风停了。" }],
      total: 1,
    });
  });

  it("空 query / 纯空白 → 抛错（不退化为「列出全部已写章」）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    seedChapterText("ch-1", "内容");
    expect(() => runSearchManuscript(makeCtx(), { query: "" })).toThrow(/query 不能为空/);
    expect(() => runSearchManuscript(makeCtx(), { query: "  \n\t" })).toThrow(/query 不能为空/);
  });

  it("snippet：命中前后各取窗宽、首尾被截的一侧补「…」，包含命中词且长度在上限内", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const text = "无关".repeat(50) + "断刃峡" + "也无关".repeat(50);
    seedChapterText("ch-1", text);
    const [hit] = runSearchManuscript(makeCtx(), { query: "断刃峡" }).items;
    expect(hit!.snippet).toContain("断刃峡");
    expect(hit!.snippet.startsWith("…")).toBe(true); // 命中在章中段 → 两侧都省略
    expect(hit!.snippet.endsWith("…")).toBe(true);
    // 窗宽单源：长度 = 两倍窗宽 + query 长度 + 两个省略号
    expect(hit!.snippet).toHaveLength(MANUSCRIPT_SNIPPET_WINDOW_CHARS * 2 + "断刃峡".length + 2);
  });

  it("多处命中只给第一处（不汇总全章命中）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    seedChapterText("ch-1", "第一处断刃峡……第二处断刃峡");
    const [hit] = runSearchManuscript(makeCtx(), { query: "断刃峡" }).items;
    expect(hit!.snippet.startsWith("第一处断刃峡")).toBe(true);
  });

  it("分页：连续两次取完不重不漏（第二页只剩尾部，不再附 truncated）", () => {
    const chapterCount = MAX_MANUSCRIPT_SEARCH_HITS + 3;
    seedLongBook(chapterCount);
    for (let i = 1; i <= chapterCount; i++) seedChapterText(`ch-${i}`, `第${i}章正文提到断刃峡`);
    const ctx = makeCtx();
    const first = runSearchManuscript(ctx, { query: "断刃峡" });
    expect(first.items).toHaveLength(MAX_MANUSCRIPT_SEARCH_HITS);
    expect(first.total).toBe(chapterCount);
    expect(first.truncated).toBe(true);
    expect(first.next_offset).toBe(MAX_MANUSCRIPT_SEARCH_HITS);
    const second = runSearchManuscript(ctx, { query: "断刃峡", offset: first.next_offset });
    expect(second.total).toBe(chapterCount); // total 与 offset 无关
    expect(second.items).toHaveLength(chapterCount - MAX_MANUSCRIPT_SEARCH_HITS);
    expect(second.truncated).toBeUndefined();
    // 不重不漏：两页拼起来 = 整本书的章序（1..n），无重复
    const ids = [...first.items, ...second.items].map((item) => item.chapterId);
    expect(ids).toEqual(Array.from({ length: chapterCount }, (_, i) => `ch-${i + 1}`));
  });

  it("阅读序：卷序 → 卷内章序，章号跨卷连续（不按命中先后 / 不按更新时）", () => {
    writeOutlineFile(dir, {
      id: "root",
      type: "root",
      schema_version: 1,
      children: [
        { id: "vol-1", type: "volume", title: "第一卷", updated_at: T0, children: [{ id: "ch-1", type: "chapter", title: "第一章", updated_at: T0, children: [] }] },
        { id: "vol-2", type: "volume", title: "第二卷", updated_at: T0, children: [{ id: "ch-2", type: "chapter", title: "第二章", updated_at: T0, children: [] }] },
      ],
    });
    seedChapterText("ch-2", "断刃峡在后卷");
    seedChapterText("ch-1", "断刃峡在前卷");
    expect(runSearchManuscript(makeCtx(), { query: "断刃峡" }).items.map((item) => [item.chapterId, item.chapterNumber])).toEqual([
      ["ch-1", 1],
      ["ch-2", 2],
    ]);
  });

  it("软删章不出现（含软删卷下的章），total 也不计它", () => {
    writeOutlineFile(dir, seedOutlineTree());
    seedChapterText("ch-1", "断刃峡其一");
    seedChapterText("ch-2", "断刃峡其二");
    softDeleteNode("ch-2");
    const result = runSearchManuscript(makeCtx(), { query: "断刃峡" });
    expect(result.items.map((item) => item.chapterId)).toEqual(["ch-1"]);
    expect(result.total).toBe(1);
    // 卷软删 → 其下全部章不可见（防手改 outline.json 的畸形树）
    softDeleteNode("vol-1");
    expect(runSearchManuscript(makeCtx(), { query: "断刃峡" })).toEqual({ items: [], total: 0 });
  });

  it("只搜正文：标题/摘要命中不算（检索面 = document_records.content_text）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    seedChapterText("ch-1", "正文里没有那个词");
    expect(runSearchManuscript(makeCtx(), { query: "第一章" })).toEqual({ items: [], total: 0 });
  });

  it("offset 越过末页 → 空 items 且不附续页（不报错）；负 offset 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    seedChapterText("ch-1", "断刃峡");
    const ctx = makeCtx();
    expect(runSearchManuscript(ctx, { query: "断刃峡", offset: 99 })).toEqual({ items: [], total: 1 });
    expect(() => runSearchManuscript(ctx, { query: "断刃峡", offset: -1 })).toThrow(/offset 必须为非负整数/);
  });
});
