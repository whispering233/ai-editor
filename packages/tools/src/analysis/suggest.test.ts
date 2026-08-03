// S6.4 分析工具测试：suggest_connections
// 覆盖：共享场景信号（S1 优先）/ 共同邻居信号（S2）/ 已有直接关系跳过 / 无信号无建议 /
//   软删对象不出现（决策 12）/ 实体不存在 → null / 信号强度排序与 top 上限 / signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@ai-editor/db";
import { createEntity, softDeleteEntity } from "@ai-editor/db";
import { createRelation } from "@ai-editor/db";
import { writeOutlineFile } from "@ai-editor/db";
import { runSuggestConnections } from "./suggest.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-suggest-"));
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

/** 角色出场（appears_in：角色 → 大纲节点） */
function appearsIn(characterId: string, nodeId: string): void {
  createRelation(
    db,
    { sourceType: "character", sourceId: characterId, targetType: "outline_node", targetId: nodeId, relationType: "appears_in" },
    dir,
  );
}

/** 角色间关系（实体-实体边） */
function link(a: string, b: string, relationType: string): void {
  createRelation(db, { sourceType: "character", sourceId: a, targetType: "character", targetId: b, relationType }, dir);
}

describe("suggest_connections 信号", () => {
  it("S1 共享场景（同场戏）→ 建议 ally（含场景名与次数）；无共享场景的候选不列", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "阿强" }).id;
    const b = createEntity(db, { type: "character", name: "阿珍" }).id;
    const c = createEntity(db, { type: "character", name: "阿刚" }).id;

    appearsIn(a, "sc-1");
    appearsIn(a, "sc-2");
    appearsIn(b, "sc-1"); // 与阿强共享 sc-1
    appearsIn(b, "sc-2"); // 共享 2 个场景
    appearsIn(c, "sc-2"); // 与阿强共享 sc-2（1 个）

    const { suggestions } = runSuggestConnections(makeCtx(), { entity_id: a })!;
    expect(suggestions).toHaveLength(2);
    const byTarget = new Map(suggestions.map((s) => [s.target_id, s]));
    expect(byTarget.get(b)).toMatchObject({ relation_type: "ally" });
    expect(byTarget.get(b)!.reason).toContain("2 个场景");
    expect(byTarget.get(b)!.reason).toContain("场景一");
    expect(byTarget.get(c)!.reason).toContain("1 个场景");
  });

  it("S2 共同邻居（朋友的朋友）→ 建议 ally；信号强度排序（场景 > 邻居）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "阿强" }).id;
    const x = createEntity(db, { type: "character", name: "中间人" }).id;
    const neighbor = createEntity(db, { type: "character", name: "邻居者" }).id;
    const sceneBuddy = createEntity(db, { type: "character", name: "同场者" }).id;

    link(a, x, "ally");
    link(neighbor, x, "ally"); // 阿强 与 邻居者 共享邻居 x
    appearsIn(a, "sc-1");
    appearsIn(sceneBuddy, "sc-1"); // 同场者 与 阿强 共享场景（信号更强）

    const { suggestions } = runSuggestConnections(makeCtx(), { entity_id: a })!;
    const byTarget = new Map(suggestions.map((s) => [s.target_id, s]));
    expect(byTarget.has(neighbor)).toBe(true);
    expect(byTarget.get(neighbor)!.reason).toContain("中间人");
    // 场景信号排在前（场景 > 邻居）
    expect(suggestions[0].target_id).toBe(sceneBuddy);
    expect(suggestions[0].reason).toContain("共同出现");
  });

  it("已有直接关系的候选跳过；软删角色不出现", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "阿强" }).id;
    const linked = createEntity(db, { type: "character", name: "已有关系" }).id;
    const shared = createEntity(db, { type: "character", name: "同场者" }).id;
    const deleted = createEntity(db, { type: "character", name: "幽灵" }).id;

    link(a, linked, "ally"); // 已有直接关系 → 跳过
    appearsIn(a, "sc-1");
    appearsIn(shared, "sc-1");
    appearsIn(deleted, "sc-1"); // 共享场景
    softDeleteEntity(db, deleted, T0); // 软删 → 不在候选中

    const { suggestions } = runSuggestConnections(makeCtx(), { entity_id: a })!;
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].target_id).toBe(shared);
  });
});

describe("suggest_connections 边界", () => {
  it("无信号/无候选 → 空建议；实体不存在或软删 → null", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "独行侠" }).id;
    const b = createEntity(db, { type: "character", name: "另一个人" }).id;
    // 无 appears_in、无共同邻居
    expect(runSuggestConnections(makeCtx(), { entity_id: a })).toEqual({ suggestions: [] });
    expect(runSuggestConnections(makeCtx(), { entity_id: "char-999" })).toBeNull();
    softDeleteEntity(db, b, T0);
    expect(runSuggestConnections(makeCtx(), { entity_id: b })).toBeNull();
  });

  it("signal 已中止 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "阿强" }).id;
    const controller = new AbortController();
    controller.abort();
    expect(() => runSuggestConnections(makeCtx(), { entity_id: a }, controller.signal)).toThrow(/中止/);
  });
});
