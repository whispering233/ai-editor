// S6.4 分析工具测试：detect_conflicts
// 覆盖：R1 对称关系单向缺失（ally/family，error）/ R2 互斥关系并存（ally+rival，warning）/
//   R3 互杀（双向 kills，error）/ 双向对称正常无检出 / types 过滤 / relation_filter 过滤 /
//   软删实体不可见（决策 12）/ signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { createEntity, softDeleteEntity } from "@whispering233/ai-editor-db";
import { createRelation } from "@whispering233/ai-editor-db";
import { writeOutlineFile } from "@whispering233/ai-editor-db";
import { runDetectConflicts } from "./conflict.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-conflict-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 最小大纲树（本工具不依赖树结构，仅满足 relation 端点校验） */
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
        ],
      },
    ],
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

/** 种子：大纲树 + 四角色（阿强/阿珍/阿刚/阿灭），返回 id 映射 */
function seedBase(): { a: string; b: string; c: string; d: string } {
  writeOutlineFile(dir, seedOutlineTree());
  const a = createEntity(db, { type: "character", name: "阿强" }).id;
  const b = createEntity(db, { type: "character", name: "阿珍" }).id;
  const c = createEntity(db, { type: "character", name: "阿刚" }).id;
  const d = createEntity(db, { type: "character", name: "阿灭" }).id;
  return { a, b, c, d };
}

const rel = (source: string, target: string, relationType: string): void => {
  createRelation(db, { sourceType: "character", sourceId: source, targetType: "character", targetId: target, relationType }, dir);
};

describe("detect_conflicts 规则检出", () => {
  it("R1 对称关系单向缺失（ally/family）→ error；双向对称无检出", () => {
    const { a, b, c, d } = seedBase();
    rel(a, b, "ally"); // 单向 ally → 矛盾
    rel(c, d, "family");
    rel(d, c, "family"); // 双向 family → 正常

    const { conflicts } = runDetectConflicts(makeCtx(), {});
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ entity_a: a, entity_b: b, field: "relations" });
    expect(conflicts[0].description).toContain("单向 ally");
  });

  it("R2 互斥关系并存（ally + rival）→ warning（ally 双向时 R1 不触发，只报互斥）", () => {
    const { a, b } = seedBase();
    rel(a, b, "ally");
    rel(b, a, "ally"); // 对称完整 → R1 不报
    rel(b, a, "rival"); // 同对并存 ally 与 rival

    const { conflicts } = runDetectConflicts(makeCtx(), {});
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ field: "relations" });
    expect(conflicts[0].description).toContain("互斥");
    expect(conflicts[0].description).toContain("ally");
    expect(conflicts[0].description).toContain("rival");
  });

  it("R3 互相击杀（双向 kills）→ error；单向 kills 正常", () => {
    const { a, b, c, d } = seedBase();
    rel(a, b, "kills");
    rel(b, a, "kills"); // 互杀 → 矛盾
    rel(c, d, "kills"); // 单向击杀 → 正常

    const { conflicts } = runDetectConflicts(makeCtx(), {});
    expect(conflicts).toHaveLength(1);
    // pair 按 id 字典序归一，entity_a/entity_b 顺序不依赖创建顺序
    expect(new Set([conflicts[0].entity_a, conflicts[0].entity_b])).toEqual(new Set([a, b]));
    expect(conflicts[0].description).toContain("互相击杀");
  });
});

describe("detect_conflicts 过滤与边界", () => {
  it("types 过滤：只检测指定实体类型（hook 实体间关系不参与 character 检测）", () => {
    const { a, b } = seedBase();
    rel(a, b, "ally"); // 单向 ally 矛盾（character）
    const h1 = createEntity(db, { type: "hook", name: "伏笔一" }).id;
    const h2 = createEntity(db, { type: "hook", name: "伏笔二" }).id;
    // hook 间关系需显式标注端点类型（rel helper 硬编码 character）
    createRelation(db, { sourceType: "hook", sourceId: h1, targetType: "hook", targetId: h2, relationType: "ally" }, dir);

    // 只查 hook → 只检出 hook 对
    const hooks = runDetectConflicts(makeCtx(), { types: ["hook"] });
    expect(hooks.conflicts).toHaveLength(1);
    expect(new Set([hooks.conflicts[0].entity_a, hooks.conflicts[0].entity_b])).toEqual(new Set([h1, h2]));
    // 只查 character → 只检出角色对
    const chars = runDetectConflicts(makeCtx(), { types: ["character"] });
    expect(chars.conflicts).toHaveLength(1);
    expect(chars.conflicts[0].entity_a).toBe(a);
  });

  it("relation_filter 过滤：集合外的关系类型不参与任何规则", () => {
    const { a, b } = seedBase();
    rel(a, b, "ally"); // 单向 ally
    rel(b, a, "kills");
    rel(a, b, "kills"); // 互杀

    // 只检测 kills → ally 单向缺失不报；互杀仍报
    const killsOnly = runDetectConflicts(makeCtx(), { relation_filter: ["kills"] });
    expect(killsOnly.conflicts).toHaveLength(1);
    expect(killsOnly.conflicts[0].description).toContain("互相击杀");
    // 只检测 ally → 互杀不报；互斥对（ally+kills 非内置互斥对）不报
    const allyOnly = runDetectConflicts(makeCtx(), { relation_filter: ["ally"] });
    expect(allyOnly.conflicts).toHaveLength(1);
    expect(allyOnly.conflicts[0].description).toContain("单向 ally");
  });

  it("软删实体不可见：其关系不参与检测（决策 12）", () => {
    const { a, b } = seedBase();
    rel(a, b, "ally");
    softDeleteEntity(db, b, T0); // 端点软删 → 关系不可见 → 无检出
    const { conflicts } = runDetectConflicts(makeCtx(), {});
    expect(conflicts).toEqual([]);
  });

  it("无矛盾 → 空数组；signal 已中止 → 抛错", () => {
    const { a, b } = seedBase();
    rel(a, b, "ally");
    rel(b, a, "ally"); // 双向对称 → 无检出
    expect(runDetectConflicts(makeCtx(), {})).toEqual({ conflicts: [] });

    const controller = new AbortController();
    controller.abort();
    expect(() => runDetectConflicts(makeCtx(), {}, controller.signal)).toThrow(/中止/);
  });
});
