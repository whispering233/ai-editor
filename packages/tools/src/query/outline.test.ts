// S6.3 查询工具测试：get_outline / get_outline_path
// 覆盖：完整树（camelCase API 形态 + 递归 children）/ 默认无 metadata（省 token）/
// 软删节点整棵剔除/ 路径含 root / 节点不存在 → null / 软删节点路径 → null
// + search_outline（C2）：三个命中面 / status+tags 组合 / volume_id / 全空抛错 /
//   阅读序与章号 / 软删不出现 / 分页连续两次取完不重不漏
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@whispering233/ai-editor-db";
import { MAX_OUTLINE_SEARCH_LIMIT, OUTLINE_SEARCH_SNIPPET_CHARS, runGetOutline, runGetOutlinePath, runSearchOutline } from "./outline.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-outline-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵 卷[章[场景一,场景二]] 的大纲树 */
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
            children: [
              { id: "sc-1", type: "scene", title: "场景一", updated_at: T0 },
              { id: "sc-2", type: "scene", title: "场景二", updated_at: T0 },
            ],
          },
        ],
      },
    ],
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

/** 直接改 outline.json 软删指定节点（db 无大纲软删 API，测试直写） */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  expect(node).toBeDefined();
  node!.deleted = true;
  node!.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

describe("get_outline", () => {
  it("返回完整树（API 形态 camelCase：schemaVersion/updatedAt；data 原样透传）", () => {
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
          children: [
            {
              id: "ch-1",
              type: "chapter",
              title: "第一章",
              updated_at: T0,
              data: { reversal: "反转" }, // 节点结构化信息原样透传
              children: [{ id: "sc-1", type: "scene", title: "场景一", updated_at: T0 }],
            },
          ],
        },
      ],
    });
    const tree = runGetOutline(makeCtx());
    expect(tree.id).toBe("root");
    expect(tree.schemaVersion).toBe(1);
    const volume = tree.children[0];
    expect(volume.type).toBe("volume");
    expect(volume.updatedAt).toBe(T0);
    const chapter = volume.children?.[0];
    expect(chapter).toMatchObject({
      id: "ch-1",
      title: "第一章",
      data: { reversal: "反转" },
    });
 // chapter 类型收窄后断言场景层（联合类型 children 可选）
    const scene = chapter !== undefined && "children" in chapter ? chapter.children?.[0] : undefined;
    expect(scene?.id).toBe("sc-1");
  });

  it("章节点 data.result_summary 原样透传（get_outline 直接可见本章实际摘要）", () => {
    const tree = seedOutlineTree();
    tree.children[0].children![0].data = { result_summary: "主角拿到断剑" };
    writeOutlineFile(dir, tree);
    expect(runGetOutline(makeCtx()).children[0].children?.[0].data?.result_summary).toBe("主角拿到断剑");
  });

  it("默认不含 metadata", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const tree = runGetOutline(makeCtx());
 // 任一节点（含递归层）均无 metadata 字段
    const node = tree.children[0].children?.[0];
    expect(node!.metadata).toBeUndefined();
    expect("metadata" in node!).toBe(false);
  });

  it("软删节点整棵剔除（不返回回收站对象）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    softDeleteNode("ch-1"); // 软删章 → 其下场景一并不可见
    const tree = runGetOutline(makeCtx());
    expect(tree.children[0].children).toEqual([]);
  });

  it("outline.json 缺失（项目刚初始化/空树）：返回空树不抛错（readOutlineFile 空树语义）", () => {
 // 不写 outline.json（临时目录中仅 data.db）
    const tree = runGetOutline(makeCtx());
    expect(tree.id).toBe("root");
    expect(tree.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(tree.children).toEqual([]);
  });
});

describe("get_outline_path", () => {
  it("返回根 → 目标节点路径 ID 列表（含 root）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(runGetOutlinePath(makeCtx(), { node_id: "sc-2" })).toEqual(["root", "vol-1", "ch-1", "sc-2"]);
    expect(runGetOutlinePath(makeCtx(), { node_id: "vol-1" })).toEqual(["root", "vol-1"]);
  });

  it("节点不存在 → null（查询无结果）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(runGetOutlinePath(makeCtx(), { node_id: "sc-999" })).toBeNull();
  });

  it("目标节点软删 → null（软删对象不可见）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    softDeleteNode("sc-1");
    expect(runGetOutlinePath(makeCtx(), { node_id: "sc-1" })).toBeNull();
 // 路径中间节点软删（手改树的不一致形态）→ 同样不可见
    writeOutlineFile(dir, seedOutlineTree());
    softDeleteNode("ch-1");
    expect(runGetOutlinePath(makeCtx(), { node_id: "sc-2" })).toBeNull();
  });
});

describe("search_outline", () => {
  /** 两卷 + 直挂 root 的章（存量形态）：ch-3 在第二卷，ch-4 直挂 root（无卷归属） */
  function seedSearchTree(): OutlineFileTree {
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
              title: "血夜",
              summary: "主角夺剑",
              updated_at: T0,
              data: { status: "revision", tags: ["主线", "复仇"], result_summary: "主角拿到断剑" },
            },
            { id: "ch-2", type: "chapter", title: "归途", summary: "回到城中", updated_at: T0 },
          ],
        },
        {
          id: "vol-2",
          type: "volume",
          title: "第二卷",
          updated_at: T0,
          children: [
            {
              id: "ch-3",
              type: "chapter",
              title: "断剑重铸",
              updated_at: T0,
              data: { tags: ["主线"], result_summary: "断剑被重铸，主角失去旧伤" },
            },
          ],
        },
        { id: "ch-4", type: "chapter", title: "尾声", updated_at: T0 },
      ],
    };
  }

  /** N 章同卷（每条标题都含「灵脉」），用于分页取完不重不漏 */
  function seedManyChapters(count: number): OutlineFileTree {
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
          children: Array.from({ length: count }, (_, i) => ({
            id: `ch-${i + 1}`,
            type: "chapter" as const,
            title: `第${i + 1}章 灵脉`,
            updated_at: T0,
          })),
        },
      ],
    };
  }

  it("query 三个命中面各一条：标题 / 计划摘要 / 实际摘要", () => {
    writeOutlineFile(dir, seedSearchTree());
    expect(runSearchOutline(makeCtx(), { query: "血夜" }).items.map((item) => item.id)).toEqual(["ch-1"]);
    expect(runSearchOutline(makeCtx(), { query: "夺剑" }).items.map((item) => item.id)).toEqual(["ch-1"]);
    expect(runSearchOutline(makeCtx(), { query: "旧伤" }).items.map((item) => item.id)).toEqual(["ch-3"]);
  });

  it("命中项含阅读序章号与所属卷；直挂 root 的章两项为空串；按阅读序（跨卷）", () => {
    writeOutlineFile(dir, seedSearchTree());
    const result = runSearchOutline(makeCtx(), { query: "剑" }); // 夺剑（ch-1 计划摘要）+ 断剑重铸（ch-3 标题）
    expect(result.items).toEqual([
      {
        id: "ch-1",
        title: "血夜",
        chapterNumber: 1,
        volumeId: "vol-1",
        volumeTitle: "第一卷",
        status: "revision",
        tags: ["主线", "复仇"],
        snippet: "主角夺剑",
      },
      {
        id: "ch-3",
        title: "断剑重铸",
        chapterNumber: 3,
        volumeId: "vol-2",
        volumeTitle: "第二卷",
        status: "draft", // 缺省即草稿
        tags: ["主线"],
        snippet: "断剑重铸",
      },
    ]);
    expect(result.total).toBe(2);
    expect(result.truncated).toBeUndefined();
    // 直挂 root 的章：无卷归属（与 shared numberVisibleOutline 同口径）
    const orphan = runSearchOutline(makeCtx(), { query: "尾声" }).items[0];
    expect(orphan).toMatchObject({ id: "ch-4", chapterNumber: 4, volumeId: "", volumeTitle: "" });
  });

  it("status 过滤：data.status 缺省算 draft；status + tags 组合（tags 全含）", () => {
    writeOutlineFile(dir, seedSearchTree());
    // ch-2 / ch-3 / ch-4 都没有 data.status → 草稿
    expect(runSearchOutline(makeCtx(), { status: "draft" }).items.map((item) => item.id)).toEqual([
      "ch-2",
      "ch-3",
      "ch-4",
    ]);
    expect(runSearchOutline(makeCtx(), { status: "revision" }).items.map((item) => item.id)).toEqual(["ch-1"]);
    // 全含：只要「主线」→ ch-1 / ch-3；再要「复仇」→ 只剩 ch-1
    expect(runSearchOutline(makeCtx(), { tags: ["主线"] }).items.map((item) => item.id)).toEqual(["ch-1", "ch-3"]);
    expect(runSearchOutline(makeCtx(), { tags: ["主线", "复仇"] }).items.map((item) => item.id)).toEqual(["ch-1"]);
    expect(
      runSearchOutline(makeCtx(), { status: "revision", tags: ["主线"] }).items.map((item) => item.id),
    ).toEqual(["ch-1"]);
  });

  it("volume_id 限定某一卷（不存在的卷 → 空结果，不报错）", () => {
    writeOutlineFile(dir, seedSearchTree());
    const result = runSearchOutline(makeCtx(), { query: "剑", volume_id: "vol-2" });
    expect(result.items.map((item) => [item.id, item.volumeTitle])).toEqual([["ch-3", "第二卷"]]);
    expect(runSearchOutline(makeCtx(), { query: "剑", volume_id: "vol-9" }).items).toEqual([]);
  });

  it("四个条件全空 → 抛错（query 空串 / 纯空白、tags 空数组同样算全空）", () => {
    writeOutlineFile(dir, seedSearchTree());
    expect(() => runSearchOutline(makeCtx(), {})).toThrow(/至少需要一个条件/);
    expect(() => runSearchOutline(makeCtx(), { query: "" })).toThrow(/至少需要一个条件/);
    expect(() => runSearchOutline(makeCtx(), { query: "   " })).toThrow(/至少需要一个条件/);
    expect(() => runSearchOutline(makeCtx(), { tags: [] })).toThrow(/至少需要一个条件/);
  });

  it("软删章不出现（章号仍按 deriveChapterOrder 的号位，不因软删重排）", () => {
    writeOutlineFile(dir, seedSearchTree());
    softDeleteNode("ch-2");
    expect(runSearchOutline(makeCtx(), { status: "draft" }).items.map((item) => item.id)).toEqual(["ch-3", "ch-4"]);
    // 删掉前一章后，ch-3 仍是第 3 章（章号单源 = 服务端 deriveChapterOrder，与 get_chapter_text 同口径）
    expect(runSearchOutline(makeCtx(), { query: "重铸" }).items[0].chapterNumber).toBe(3);
    // 卷软删 → 其章随级联不可见（不进可见章索引）
    writeOutlineFile(dir, seedSearchTree());
    softDeleteNode("vol-2");
    expect(runSearchOutline(makeCtx(), { tags: ["主线"] }).items.map((item) => item.id)).toEqual(["ch-1"]);
  });

  it("snippet：命中位置前后各取窗宽，超出部分补省略号", () => {
    const longSummary = `${"前".repeat(OUTLINE_SEARCH_SNIPPET_CHARS * 2)}灵脉${"后".repeat(OUTLINE_SEARCH_SNIPPET_CHARS * 2)}`;
    writeOutlineFile(dir, {
      id: "root",
      type: "root",
      schema_version: 1,
      children: [
        { id: "ch-1", type: "chapter", title: "长摘要章", summary: longSummary, updated_at: T0 },
      ],
    });
    const snippet = runSearchOutline(makeCtx(), { query: "灵脉" }).items[0].snippet;
    expect(snippet).toContain("灵脉");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    // 窗宽以外的正文不出现（防整段摘要灌进上下文）
    expect(snippet.length).toBeLessThanOrEqual(2 * OUTLINE_SEARCH_SNIPPET_CHARS + "灵脉".length + 2);
  });

  it("分页：next_offset 连续两次取完不重不漏（total = 命中总数）", () => {
    const count = MAX_OUTLINE_SEARCH_LIMIT + 10;
    writeOutlineFile(dir, seedManyChapters(count));
    const first = runSearchOutline(makeCtx(), { query: "灵脉" });
    expect(first.total).toBe(count);
    expect(first.items).toHaveLength(MAX_OUTLINE_SEARCH_LIMIT);
    expect(first.truncated).toBe(true);
    expect(first.next_offset).toBe(MAX_OUTLINE_SEARCH_LIMIT);
    const second = runSearchOutline(makeCtx(), { query: "灵脉", offset: first.next_offset });
    expect(second.items).toHaveLength(count - MAX_OUTLINE_SEARCH_LIMIT);
    expect(second.total).toBe(count);
    expect(second.truncated).toBeUndefined();
    expect(second.next_offset).toBeUndefined();
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(count); // 不重
    expect(ids).toEqual(Array.from({ length: count }, (_, i) => `ch-${i + 1}`)); // 不漏、且是阅读序
    expect(first.items.map((item) => item.chapterNumber)).toEqual(
      Array.from({ length: MAX_OUTLINE_SEARCH_LIMIT }, (_, i) => i + 1),
    );
  });
});
