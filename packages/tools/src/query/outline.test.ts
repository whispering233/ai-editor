// S6.3 查询工具测试：get_outline / get_outline_path
// 覆盖：分层视图（depth 1/2/3 节点数递增、volume_id 只过滤）/ 卷聚合四数（含软删不计）/
// 所有档位都不返回 updatedAt / 缺省 = depth 1 / volume_id 不存在抛错 /
// 软删节点整棵剔除 / 路径含 root / 节点不存在 → null / 软删节点路径 → null
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, upsertDocument, type Db } from "@whispering233/ai-editor-db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@whispering233/ai-editor-db";
import { runGetOutline, runGetOutlinePath, type OutlineViewNode, type OutlineViewTree } from "./outline.js";

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

/** 两卷树：vol-1[ch-1[sc-1,sc-2], ch-2] + vol-2[ch-3, ch-4]（章状态覆盖缺省 draft / final / revision） */
function seedTwoVolumes(): OutlineFileTree {
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
          { id: "ch-2", type: "chapter", title: "第二章", updated_at: T0, data: { status: "final" } },
        ],
      },
      {
        id: "vol-2",
        type: "volume",
        title: "第二卷",
        updated_at: T0,
        children: [
          { id: "ch-3", type: "chapter", title: "第三章", updated_at: T0, data: { status: "revision" } },
          { id: "ch-4", type: "chapter", title: "第四章", updated_at: T0 },
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

/** 结果树全部节点（先序） */
function allNodes(nodes: readonly OutlineViewNode[]): OutlineViewNode[] {
  return nodes.flatMap((node) => [node, ...allNodes(node.children ?? [])]);
}

/** 正文字数来源：写一段正文投影（charCount = JS 字符串长度，与 with_metadata 的 textLength 同义） */
function writeChapterText(chapterId: string, text: string): void {
  upsertDocument(db, { ownerKind: "chapter", ownerId: chapterId, content: "[]", contentText: text, now: T0 });
}

describe("get_outline", () => {
  it("缺省 = depth 1：只回卷（不带章），卷节点带聚合四数（缺省 status 计为草稿）", () => {
    writeOutlineFile(dir, seedTwoVolumes());
    writeChapterText("ch-1", "一二三");
    writeChapterText("ch-2", "一二");
    const view: OutlineViewTree = runGetOutline(makeCtx());
    expect(view.id).toBe("root");
    expect(view.schemaVersion).toBe(1);
    expect(view.children).toHaveLength(2); // 只到卷
    expect(view.children.every((node) => node.children === undefined)).toBe(true);
    // vol-1：2 章（ch-1 缺省 draft、ch-2 final），正文字数 3 + 2
    expect(view.children[0]!.stats).toEqual({ chapterCount: 2, charCount: 5, draftCount: 1, finalCount: 1 });
    // vol-2：ch-3 revision 既不计 draft 也不计 final；无正文
    expect(view.children[1]!.stats).toEqual({ chapterCount: 2, charCount: 0, draftCount: 1, finalCount: 0 });
  });

  it("三档节点数递增：depth 1 = 卷 / 2 = 卷 + 章 / 3 = 卷 + 章 + 场景", () => {
    writeOutlineFile(dir, seedTwoVolumes());
    const counts = ([1, 2, 3] as const).map((depth) => allNodes(runGetOutline(makeCtx(), { depth }).children).length);
    expect(counts).toEqual([2, 6, 8]); // 2 卷 → +4 章 → +2 场景
    const depth3 = runGetOutline(makeCtx(), { depth: 3 });
    expect(allNodes(depth3.children).map((node) => node.type)).toEqual([
      "volume", "chapter", "scene", "scene", "chapter", "volume", "chapter", "chapter",
    ]);
  });

  it("volume_id 只做过滤：volume_id + depth=2 只回该卷的章（depth 语义不变，聚合照旧）", () => {
    writeOutlineFile(dir, seedTwoVolumes());
    const view = runGetOutline(makeCtx(), { volume_id: "vol-2", depth: 2 });
    expect(view.children.map((node) => node.id)).toEqual(["vol-2"]);
    expect(view.children[0]!.children?.map((node) => node.title)).toEqual(["第三章", "第四章"]);
    // depth=1 + volume_id：单卷地图 + 聚合
    expect(runGetOutline(makeCtx(), { volume_id: "vol-1" }).children[0]!.stats).toEqual({
      chapterCount: 2,
      charCount: 0,
      draftCount: 1,
      finalCount: 1,
    });
  });

  it("volume_id 不存在（含写成章 id / 已软删）→ 抛错，不静默回空树", () => {
    writeOutlineFile(dir, seedTwoVolumes());
    expect(() => runGetOutline(makeCtx(), { volume_id: "vol-404" })).toThrow(/卷不存在/);
    expect(() => runGetOutline(makeCtx(), { volume_id: "ch-1" })).toThrow(/卷不存在/);
    softDeleteNode("vol-2");
    expect(() => runGetOutline(makeCtx(), { volume_id: "vol-2" })).toThrow(/卷不存在/);
  });

  it("聚合只计未软删节点（软删章不计章数 / 字数 / 状态）", () => {
    writeOutlineFile(dir, seedTwoVolumes());
    writeChapterText("ch-1", "一二三");
    writeChapterText("ch-2", "一二");
    softDeleteNode("ch-2");
    expect(runGetOutline(makeCtx()).children[0]!.stats).toEqual({
      chapterCount: 1,
      charCount: 3,
      draftCount: 1,
      finalCount: 0,
    });
  });

  it("所有档位都不返回 updatedAt（也不再返回 metadata）", () => {
    writeOutlineFile(dir, seedTwoVolumes());
    for (const depth of [1, 2, 3] as const) {
      for (const node of allNodes(runGetOutline(makeCtx(), { depth }).children)) {
        expect("updatedAt" in node).toBe(false);
        expect("metadata" in node).toBe(false);
      }
    }
  });

  it("章节点 data.result_summary 原样透传（get_outline 直接可见本章实际摘要）", () => {
    const tree = seedTwoVolumes();
    tree.children[0].children![0].data = { result_summary: "主角拿到断剑" };
    writeOutlineFile(dir, tree);
    const view = runGetOutline(makeCtx(), { depth: 2 });
    expect(view.children[0]!.children?.[0]!.data?.result_summary).toBe("主角拿到断剑");
  });

  it("软删节点整棵剔除（不返回回收站对象）", () => {
    writeOutlineFile(dir, seedTwoVolumes());
    softDeleteNode("ch-1"); // 软删章 → 其下场景一并不可见
    const view = runGetOutline(makeCtx(), { depth: 3 });
    expect(view.children[0]!.children?.map((node) => node.id)).toEqual(["ch-2"]);
  });

  it("outline.json 缺失（项目刚初始化/空树）：返回空树不抛错（readOutlineFile 空树语义）", () => {
    // 不写 outline.json（临时目录中仅 data.db）
    const view = runGetOutline(makeCtx());
    expect(view.id).toBe("root");
    expect(view.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(view.children).toEqual([]);
  });
});

describe("get_outline_path", () => {
  it("返回根 → 目标节点路径 ID 列表（含 root）", () => {
    writeOutlineFile(dir, seedTwoVolumes());
    expect(runGetOutlinePath(makeCtx(), { node_id: "sc-2" })).toEqual(["root", "vol-1", "ch-1", "sc-2"]);
    expect(runGetOutlinePath(makeCtx(), { node_id: "vol-1" })).toEqual(["root", "vol-1"]);
  });

  it("节点不存在 → null（查询无结果）", () => {
    writeOutlineFile(dir, seedTwoVolumes());
    expect(runGetOutlinePath(makeCtx(), { node_id: "sc-999" })).toBeNull();
  });

  it("目标节点软删 → null（软删对象不可见）", () => {
    writeOutlineFile(dir, seedTwoVolumes());
    softDeleteNode("sc-1");
    expect(runGetOutlinePath(makeCtx(), { node_id: "sc-1" })).toBeNull();
 // 路径中间节点软删（手改树的不一致形态）→ 同样不可见
    writeOutlineFile(dir, seedTwoVolumes());
    softDeleteNode("ch-1");
    expect(runGetOutlinePath(makeCtx(), { node_id: "sc-2" })).toBeNull();
  });
});
