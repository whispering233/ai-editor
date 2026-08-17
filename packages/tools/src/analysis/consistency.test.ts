// S6.4 分析工具测试：analyze_consistency
// 覆盖：性格反义词对（warning）/ 负年龄（error）/ 伏笔已兑现未标注节点（warning）/
//   兑现节点不存在与软删（error）/ parent_id 悬空（warning）/ 正常档案无 issues /
//   软删实体 → null / signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { createEntity } from "@whispering233/ai-editor-db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@whispering233/ai-editor-db";
import { AbortedError } from "./utils.js";
import { runAnalyzeConsistency } from "./consistency.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-consistency-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵 卷[章[场景一,场景二]] 的大纲树（R4 兑现节点引用校验用） */
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

/** 直接改 outline.json 软删指定节点 */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId)!;
  node.deleted = true;
  node.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

describe("analyze_consistency character 规则", () => {
  it("R2 性格反义词对并存 → warning（逐对检出）；正常性格无 issues", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const contradictory = createEntity(db, {
      type: "character",
      name: "矛盾者",
      data: { personality: ["勇敢", "怯懦", "诚实", "狡诈"] },
    });
    const normal = createEntity(db, { type: "character", name: "正常人", data: { personality: ["勇敢", "善良"] } });

    const bad = runAnalyzeConsistency(makeCtx(), { entity_id: contradictory.id })!;
    expect(bad.issues).toHaveLength(2);
    expect(bad.issues[0]).toMatchObject({ severity: "warning", field: "personality" });
    expect(bad.issues[0].description).toContain("勇敢");
    expect(bad.issues[0].description).toContain("怯懦");
    expect(bad.issues[1].field).toBe("personality");

    const good = runAnalyzeConsistency(makeCtx(), { entity_id: normal.id })!;
    expect(good.issues).toEqual([]);
  });

  it("R1 负年龄 → error；personality 非数组不报错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const negative = createEntity(db, { type: "character", name: "负龄者", data: { age: -5 } });
    const weird = createEntity(db, { type: "character", name: "怪人", data: { personality: "勇敢" } });

    const issues = runAnalyzeConsistency(makeCtx(), { entity_id: negative.id })!.issues;
    expect(issues).toEqual([
      { severity: "error", field: "age", description: expect.stringContaining("负数") as unknown as string },
    ]);
    expect(runAnalyzeConsistency(makeCtx(), { entity_id: weird.id })!.issues).toEqual([]);
  });
});

describe("analyze_consistency hook 规则", () => {
  it("R3 已兑现未标注兑现节点 → warning；R4 兑现节点不存在/软删 → error", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const resolved = createEntity(db, { type: "hook", name: "密信", data: { status: "resolved" } });
    const dangling = createEntity(db, {
      type: "hook",
      name: "遗物",
      data: { status: "planted", expected_resolve_node_id: "sc-999" },
    });
    const soft = createEntity(db, {
      type: "hook",
      name: "软删引用",
      data: { status: "planted", expected_resolve_node_id: "sc-1" },
    });

    const r3 = runAnalyzeConsistency(makeCtx(), { entity_id: resolved.id })!.issues;
    expect(r3).toHaveLength(1);
    expect(r3[0]).toMatchObject({ severity: "warning", field: "expected_resolve_node_id" });

    const r4 = runAnalyzeConsistency(makeCtx(), { entity_id: dangling.id })!.issues;
    expect(r4).toHaveLength(1);
    expect(r4[0]).toMatchObject({ severity: "error", field: "expected_resolve_node_id" });
    expect(r4[0].description).toContain("sc-999");

    softDeleteNode("sc-1");
    const r4soft = runAnalyzeConsistency(makeCtx(), { entity_id: soft.id })!.issues;
    expect(r4soft).toHaveLength(1);
    expect(r4soft[0].severity).toBe("error");
    expect(r4soft[0].description).toContain("软删");
  });

  it("正常伏笔（planted + 有效引用）无 issues", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const hook = createEntity(db, {
      type: "hook",
      name: "正常伏笔",
      data: { status: "planted", expected_resolve_node_id: "sc-1" },
    });
    expect(runAnalyzeConsistency(makeCtx(), { entity_id: hook.id })!.issues).toEqual([]);
  });
});

describe("analyze_consistency 边界", () => {
  it("R5（决策 30 修订）location 的 parent_id 悬空引用 → warning；setting 的 parent_id 已废弃不再检查", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const parent = createEntity(db, { type: "location", name: "山门" });
    const okLocation = createEntity(db, { type: "location", name: "前殿", data: { parent_id: parent.id } });
    const dangling = createEntity(db, { type: "location", name: "藏经阁", data: { parent_id: "set-999" } });
    // setting：data.parent_id 废弃（决策 30）——遗留字段不再产生 issues
    const settingWithParent = createEntity(db, { type: "setting", name: "门派", data: { parent_id: parent.id } });

    expect(runAnalyzeConsistency(makeCtx(), { entity_id: okLocation.id })!.issues).toEqual([]);
    const issues = runAnalyzeConsistency(makeCtx(), { entity_id: dangling.id })!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", field: "parent_id" });
    expect(runAnalyzeConsistency(makeCtx(), { entity_id: settingWithParent.id })!.issues).toEqual([]);
  });

  it("实体不存在/已软删 → null；signal 已中止 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const row = createEntity(db, { type: "character", name: "幽灵" });
    expect(runAnalyzeConsistency(makeCtx(), { entity_id: "char-999" })).toBeNull();
    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, row.id);
    expect(runAnalyzeConsistency(makeCtx(), { entity_id: row.id })).toBeNull();

    const controller = new AbortController();
    controller.abort();
    // 专用 AbortedError（name="AbortError"）——S7.4 executor 判别「取消」与「工具失败」
    expect(() => runAnalyzeConsistency(makeCtx(), { entity_id: "char-x" }, controller.signal)).toThrowError(AbortedError);
    try {
      runAnalyzeConsistency(makeCtx(), { entity_id: "char-x" }, controller.signal);
      expect.unreachable("应抛 AbortedError");
    } catch (err) {
      expect(err).toBeInstanceOf(AbortedError);
      expect((err as Error).name).toBe("AbortError");
    }
  });
});
