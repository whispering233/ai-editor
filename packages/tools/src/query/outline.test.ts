// S6.3 查询工具测试：get_outline / get_outline_path
// 覆盖：完整树（camelCase API 形态 + 递归 children）/ 默认无 metadata（省 token）/
//   软删节点整棵剔除（决策 12 修订）/ 路径含 root / 节点不存在 → null / 软删节点路径 → null
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@ai-editor/db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@ai-editor/db";
import { runGetOutline, runGetOutlinePath } from "./outline.js";

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
              data: { reversal: "反转" }, // 决策 23 节点结构化信息原样透传
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

  it("默认不含 metadata（省 token，tools.md）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const tree = runGetOutline(makeCtx());
    // 任一节点（含递归层）均无 metadata 字段
    const node = tree.children[0].children?.[0];
    expect(node!.metadata).toBeUndefined();
    expect("metadata" in node!).toBe(false);
  });

  it("软删节点整棵剔除（决策 12 修订：不返回回收站对象）", () => {
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

  it("目标节点软删 → null（决策 12 修订：软删对象不可见）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    softDeleteNode("sc-1");
    expect(runGetOutlinePath(makeCtx(), { node_id: "sc-1" })).toBeNull();
    // 路径中间节点软删（手改树的不一致形态）→ 同样不可见
    writeOutlineFile(dir, seedOutlineTree());
    softDeleteNode("ch-1");
    expect(runGetOutlinePath(makeCtx(), { node_id: "sc-2" })).toBeNull();
  });
});
