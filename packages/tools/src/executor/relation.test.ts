// S6.7 执行类工具测试：关系（add_relation / remove_relation）
// 覆盖：写路径正确性（端点类型透传 / metadata 透传 / 判重 RELATION_EXISTS 抛错 /
//   端点不存在抛错）、remove_relation **物理删**（决策 12 修订：不置 deleted_at、不进回收站）、
//   0 行影响抛错（fail-fast）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, createEntity, getRelation, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { writeOutlineFile } from "@whispering233/ai-editor-db";
import { buildProposal } from "../proposal/types.js";
import { executeAddRelation, executeRemoveRelation } from "./relation.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-exec-relation-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵 卷[章[场景一]] 的大纲树 */
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

function makeProposal(type: string, args: Record<string, unknown>): ReturnType<typeof buildProposal> {
  return buildProposal(makeCtx(), type, args, [], `测试摘要 ${type}`);
}

describe("add_relation", () => {
  it("写路径：端点类型透传（S6.6 已派生 source_type/target_type），返回新 id（rel- 前缀）", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const result = executeAddRelation(
      makeCtx(),
      makeProposal("propose_add_relation", {
        source_type: "character",
        source_id: a.id,
        target_type: "character",
        target_id: b.id,
        relation_type: "ally",
      }),
    );
    expect(result.id).toMatch(/^rel-/);
    const rel = getRelation(db, result.id as string, dir)!;
    expect(rel).toMatchObject({ source_type: "character", source_id: a.id, relation_type: "ally", target_id: b.id });
  });

  it("大纲节点端点 + metadata 透传", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "甲" });
    const result = executeAddRelation(
      makeCtx(),
      makeProposal("propose_add_relation", {
        source_type: "character",
        source_id: a.id,
        target_type: "outline_node",
        target_id: "sc-1",
        relation_type: "appears_in",
        metadata: { chapter: 1 },
      }),
    );
    expect(getRelation(db, result.id as string, dir)!.metadata).toEqual({ chapter: 1 });
  });

  it("重复三元组 → 抛错（RELATION_EXISTS，db 层判重；幂等只保证 hook 复合写）", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const args = {
      source_type: "character",
      source_id: a.id,
      target_type: "character",
      target_id: b.id,
      relation_type: "ally",
    };
    executeAddRelation(makeCtx(), makeProposal("propose_add_relation", args));
    expect(() => executeAddRelation(makeCtx(), makeProposal("propose_add_relation", args))).toThrow(/关系已存在/);
  });

  it("端点不存在 → 抛错（db 层端点存在性校验，决策 12）", () => {
    expect(() =>
      executeAddRelation(
        makeCtx(),
        makeProposal("propose_add_relation", {
          source_type: "character",
          source_id: "char-999",
          target_type: "character",
          target_id: "char-998",
          relation_type: "ally",
        }),
      ),
    ).toThrow(/端点不存在或已软删/);
  });
});

describe("remove_relation", () => {
  it("写路径：物理删除（决策 12 修订——行真删、不置 deleted_at、不进回收站）", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const rel = executeAddRelation(
      makeCtx(),
      makeProposal("propose_add_relation", {
        source_type: "character",
        source_id: a.id,
        target_type: "character",
        target_id: b.id,
        relation_type: "ally",
      }),
    );
    const result = executeRemoveRelation(makeCtx(), makeProposal("propose_remove_relation", { relation_id: rel.id }));
    expect(result).toEqual({ id: rel.id, deleted: true });
    expect(getRelation(db, rel.id as string, dir)).toBeNull();
    // 物理删：回收站（deleted_at）无该关系
    expect(db.prepare("SELECT id FROM relation_records WHERE id = ?").get(rel.id)).toBeUndefined();
  });

  it("关系不存在 → 抛错（fail-fast）", () => {
    expect(() => executeRemoveRelation(makeCtx(), makeProposal("propose_remove_relation", { relation_id: "rel-999" }))).toThrow(/关系不存在/);
  });
});
