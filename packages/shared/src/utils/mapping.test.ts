// 文件 ↔ API 字段映射测试（T1.3）
// 核心断言：往返一致性、嵌套 data 原样透传（2026-08 修订）、outline 递归 children 与软删字段
import { describe, expect, it } from "vitest";
import type { DeltaRow, EntityRow, RelationRow } from "../types/entity.js";
import type { OutlineFileTree } from "../types/outline.js";
import type { ProjectFileConfig } from "../types/project.js";
import {
  camelToSnakeKey,
  mapConfigToProjectFile,
  mapEntityToRow,
  mapOutlineFileToTree,
  mapProjectFileToConfig,
  mapRowToDelta,
  mapRowToEntity,
  mapRowToRelation,
  mapTreeToOutlineFile,
  snakeToCamelKey,
} from "./mapping.js";

describe("单层键映射", () => {
  it("snakeToCamelKey / camelToSnakeKey 互逆", () => {
    expect(snakeToCamelKey("created_at")).toBe("createdAt");
    expect(snakeToCamelKey("schema_version")).toBe("schemaVersion");
    expect(camelToSnakeKey("createdAt")).toBe("created_at");
    expect(camelToSnakeKey("currentPosition")).toBe("current_position");
    expect(snakeToCamelKey(camelToSnakeKey("updatedAt"))).toBe("updatedAt");
  });
});

describe("实体映射", () => {
  const row: EntityRow = {
    id: "char-1",
    type: "character",
    name: "张三",
    data: {
      role: "主角",
      // 嵌套对象内部字段原样透传（2026-08 修订）：snake_case 不转换为 camelCase
      custom_fields: { expected_payoff: "揭示身世", half_life: 8 },
    },
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T11:00:00Z",
    deleted_at: null,
  };

  it("mapRowToEntity：顶层字段 camelCase，data 原样透传", () => {
    const entity = mapRowToEntity(row);
    expect(entity.createdAt).toBe("2026-08-01T10:00:00Z");
    expect(entity.updatedAt).toBe("2026-08-01T11:00:00Z");
    expect(entity.deletedAt).toBeNull();
    // 关键约束：嵌套 data 不做递归 camelCase（expected_payoff 保持 snake_case）
    expect(entity.data).toEqual(row.data);
    expect(entity.data.custom_fields).toEqual({ expected_payoff: "揭示身世", half_life: 8 });
    expect("expectedPayoff" in entity.data).toBe(false);
  });

  it("往返一致：mapRowToEntity → mapEntityToRow 字段不丢", () => {
    expect(mapEntityToRow(mapRowToEntity(row))).toEqual(row);
    // 软删非空路径
    const deletedRow = { ...row, deleted_at: "2026-08-02T00:00:00Z" };
    expect(mapEntityToRow(mapRowToEntity(deletedRow))).toEqual(deletedRow);
  });
});

describe("关系 / Delta 映射", () => {
  it("mapRowToRelation：字段映射，metadata NULL → undefined", () => {
    const row: RelationRow = {
      id: "rel-1",
      source_type: "character",
      source_id: "char-1",
      target_type: "outline_node",
      target_id: "sc-5",
      relation_type: "appears_in",
      metadata: null,
      created_at: "2026-08-01T10:00:00Z",
      updated_at: "2026-08-01T10:00:00Z",
      deleted_at: null,
    };
    const rel = mapRowToRelation(row);
    expect(rel.sourceType).toBe("character");
    expect(rel.targetId).toBe("sc-5");
    expect(rel.relationType).toBe("appears_in");
    expect(rel.metadata).toBeUndefined();
    // 有 metadata 时透传
    expect(mapRowToRelation({ ...row, metadata: { chapter: 5 } }).metadata).toEqual({ chapter: 5 });
  });

  it("mapRowToDelta：changes 原样透传", () => {
    const row: DeltaRow = {
      id: "delta-1",
      node_id: "sc-12",
      target_type: "hook",
      target_id: "hook-1",
      changes: [{ field: "status", op: "update", from: "planted", to: "progressing" }],
      description: "主角发现玉佩",
      order: 1,
      created_at: "2026-08-01T10:00:00Z",
      updated_at: "2026-08-01T10:00:00Z",
      deleted_at: null,
    };
    const delta = mapRowToDelta(row);
    expect(delta.nodeId).toBe("sc-12");
    expect(delta.changes).toEqual(row.changes);
    expect(delta.order).toBe(1);
  });
});

describe("大纲映射（递归 children + 软删字段）", () => {
  const fileTree: OutlineFileTree = {
    id: "root",
    type: "root",
    schema_version: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: "2026-08-01T10:00:00Z",
        children: [
          {
            id: "ch-1",
            type: "chapter",
            title: "第一章",
            updated_at: "2026-08-01T10:00:00Z",
            children: [
              {
                id: "sc-1",
                type: "scene",
                title: "灵根测试",
                updated_at: "2026-08-01T10:00:00Z",
                deleted: true,
                deleted_at: "2026-08-02T00:00:00Z",
              },
            ],
          },
        ],
      },
    ],
  };

  it("mapOutlineFileToTree：递归映射 + 软删字段 deleted_at ↔ deletedAt", () => {
    const tree = mapOutlineFileToTree(fileTree);
    expect(tree.schemaVersion).toBe(1);
    expect(tree.children[0].type).toBe("volume");
    expect(tree.children[0].children?.[0].type).toBe("chapter");
    const scene = tree.children[0].children?.[0].children?.[0];
    expect(scene?.type).toBe("scene");
    expect(scene?.updatedAt).toBe("2026-08-01T10:00:00Z");
    expect(scene?.deleted).toBe(true);
    expect(scene?.deletedAt).toBe("2026-08-02T00:00:00Z");
  });

  it("往返一致：mapOutlineFileToTree → mapTreeToOutlineFile 结构不丢", () => {
    expect(mapTreeToOutlineFile(mapOutlineFileToTree(fileTree))).toEqual(fileTree);
  });

  it("直挂 root 的 chapter 映射正确（决策 19：chapter → volume 或 root；oracle 回修）", () => {
    const file: OutlineFileTree = {
      id: "root",
      type: "root",
      schema_version: 1,
      children: [
        { id: "vol-1", type: "volume", title: "第一卷", updated_at: "2026-08-01T10:00:00Z", children: [] },
        {
          id: "ch-root",
          type: "chapter",
          title: "直挂章",
          updated_at: "2026-08-01T10:00:00Z",
          children: [{ id: "sc-9", type: "scene", title: "场景", updated_at: "2026-08-01T10:00:00Z" }],
        },
      ],
    };
    // 正向：直挂章不被误映射为 volume，递归 children 正确
    const tree = mapOutlineFileToTree(file);
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].type).toBe("volume");
    expect(tree.children[1].type).toBe("chapter");
    expect(tree.children[1].title).toBe("直挂章");
    expect(tree.children[1].children?.[0].type).toBe("scene");
    // 反向：往返一致
    expect(mapTreeToOutlineFile(tree)).toEqual(file);
  });
});

describe("项目映射", () => {
  const file: ProjectFileConfig = {
    id: "proj-1",
    name: "我的小说",
    language: "zh",
    prompt: "力量体系：练气→筑基",
    schema_version: 1,
    current_position: "sc-42",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  };

  it("mapProjectFileToConfig：schema_version/current_position → camelCase", () => {
    const config = mapProjectFileToConfig(file);
    expect(config.schemaVersion).toBe(1);
    expect(config.currentPosition).toBe("sc-42");
    expect(config.language).toBe("zh");
  });

  it("往返一致（含 current_position 为 null 的情形）", () => {
    expect(mapConfigToProjectFile(mapProjectFileToConfig(file))).toEqual(file);
    const noPosition = { ...file, current_position: null };
    expect(mapConfigToProjectFile(mapProjectFileToConfig(noPosition))).toEqual(noPosition);
  });
});
