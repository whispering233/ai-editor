// 文件字段 ↔ API 字段映射（endpoints.md 通用约定指定位置：@whispering233/ai-editor-shared/utils）
// 约定（endpoints.md 第 10 行）：请求体/查询参数 snake_case，响应体 camelCase，
//   outline.json / project.json / data.db 行内部 snake_case；
//   **嵌套 data 对象内部字段原样透传**（如 expected_payoff 保持 snake_case，2026-08 修订），
//   camelCase 映射仅应用于 API 顶层契约字段。
// 两侧锚点：T1.1 定义的双套类型（*Row / OutlineFile* / ProjectFileConfig ↔ API 形态）

import type { DeltaRecord, DeltaRow, Entity, EntityRow, RelationRecord, RelationRow } from "../types/entity.js";
import type {
  OutlineChapter,
  OutlineFileChapter,
  OutlineFileNode,
  OutlineFileScene,
  OutlineFileTree,
  OutlineFileVolume,
  OutlineNode,
  OutlineScene,
  OutlineTree,
  OutlineVolume,
} from "../types/outline.js";
import type { ProjectConfig, ProjectFileConfig } from "../types/project.js";

/** 单层键映射：snake_case → camelCase（仅用于顶层契约字段，不递归 data） */
export function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/** 单层键映射：camelCase → snake_case */
export function camelToSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// ============ 实体（entities 表 ↔ API） ============

/** EntityRow → Entity（created_at → createdAt、deleted_at → deletedAt；data 原样透传） */
export function mapRowToEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    data: row.data, // 嵌套对象原样透传（2026-08 修订），不做递归 camelCase
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** Entity → EntityRow（API → 存储；deletedAt 缺失时置 null） */
export function mapEntityToRow(entity: Entity): EntityRow {
  return {
    id: entity.id,
    type: entity.type,
    name: entity.name,
    data: entity.data,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    deleted_at: entity.deletedAt ?? null,
  };
}

// ============ 关系（relation_records 表 ↔ API） ============

/**
 * RelationRow → RelationRecord（字段映射；metadata NULL → undefined）
 * 注意：存储的 updated_at / deleted_at 在 API 形态中不暴露（endpoints.md RelationRecord 仅 createdAt）；
 * sourceName/targetName 为服务端联表填充，Row 本身不含
 */
export function mapRowToRelation(row: RelationRow): RelationRecord {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    targetType: row.target_type,
    targetId: row.target_id,
    relationType: row.relation_type,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
  };
}

// ============ Delta（delta_records 表 ↔ API） ============

/** DeltaRow → DeltaRecord（字段映射；changes 原样透传） */
export function mapRowToDelta(row: DeltaRow): DeltaRecord {
  return {
    id: row.id,
    nodeId: row.node_id,
    targetType: row.target_type,
    targetId: row.target_id,
    changes: row.changes,
    description: row.description,
    order: row.order,
    createdAt: row.created_at,
  };
}

// ============ 大纲（outline.json ↔ API，children 递归映射） ============

/** OutlineFileVolume → OutlineVolume（递归映射 children） */
function mapFileVolumeToVolume(file: OutlineFileVolume): OutlineVolume {
  return {
    id: file.id,
    type: "volume",
    title: file.title,
    summary: file.summary,
    data: file.data, // 嵌套 data 原样透传（决策 23，不做递归 camelCase）
    updatedAt: file.updated_at,
    deleted: file.deleted,
    deletedAt: file.deleted_at,
    children: file.children?.map(mapFileChapterToChapter),
  };
}

/** OutlineFileChapter → OutlineChapter（递归映射 children） */
function mapFileChapterToChapter(file: OutlineFileChapter): OutlineChapter {
  return {
    id: file.id,
    type: "chapter",
    title: file.title,
    summary: file.summary,
    data: file.data, // 嵌套 data 原样透传（决策 23）
    updatedAt: file.updated_at,
    deleted: file.deleted,
    deletedAt: file.deleted_at,
    children: file.children?.map(mapFileSceneToScene),
  };
}

/** OutlineFileScene → OutlineScene（叶子，无 children） */
function mapFileSceneToScene(file: OutlineFileScene): OutlineScene {
  return {
    id: file.id,
    type: "scene",
    title: file.title,
    summary: file.summary,
    data: file.data, // 嵌套 data 原样透传（决策 23）
    updatedAt: file.updated_at,
    deleted: file.deleted,
    deletedAt: file.deleted_at,
  };
}

/** OutlineFileNode → OutlineNode（按 type 分派递归映射；支持决策 19「chapter 直挂 root」） */
function mapFileNodeToNode(file: OutlineFileNode): OutlineNode {
  switch (file.type) {
    case "volume":
      return mapFileVolumeToVolume(file);
    case "chapter":
      return mapFileChapterToChapter(file);
    case "scene":
      return mapFileSceneToScene(file);
  }
}

/** OutlineFileTree → OutlineTree（schema_version → schemaVersion；软删字段 deleted_at ↔ deletedAt 一并映射） */
export function mapOutlineFileToTree(file: OutlineFileTree): OutlineTree {
  return {
    id: file.id,
    type: "root",
    schemaVersion: file.schema_version,
    // root.children 为 (volume|chapter) 联合（决策 19 允许直挂章），按 type 分派映射
    children: file.children.map(mapFileNodeToNode) as OutlineTree["children"],
  };
}

/** OutlineVolume → OutlineFileVolume */
function mapVolumeToFileVolume(node: OutlineVolume): OutlineFileVolume {
  return {
    id: node.id,
    type: "volume",
    title: node.title,
    summary: node.summary,
    data: node.data, // 嵌套 data 原样透传（决策 23）
    updated_at: node.updatedAt,
    deleted: node.deleted,
    deleted_at: node.deletedAt,
    children: node.children?.map(mapChapterToFileChapter),
  };
}

/** OutlineChapter → OutlineFileChapter */
function mapChapterToFileChapter(node: OutlineChapter): OutlineFileChapter {
  return {
    id: node.id,
    type: "chapter",
    title: node.title,
    summary: node.summary,
    data: node.data, // 嵌套 data 原样透传（决策 23）
    updated_at: node.updatedAt,
    deleted: node.deleted,
    deleted_at: node.deletedAt,
    children: node.children?.map(mapSceneToFileScene),
  };
}

/** OutlineScene → OutlineFileScene */
function mapSceneToFileScene(node: OutlineScene): OutlineFileScene {
  return {
    id: node.id,
    type: "scene",
    title: node.title,
    summary: node.summary,
    data: node.data, // 嵌套 data 原样透传（决策 23）
    updated_at: node.updatedAt,
    deleted: node.deleted,
    deleted_at: node.deletedAt,
  };
}

/** OutlineNode → OutlineFileNode（按 type 分派递归映射；支持决策 19「chapter 直挂 root」） */
function mapNodeToFileNode(node: OutlineNode): OutlineFileNode {
  switch (node.type) {
    case "volume":
      return mapVolumeToFileVolume(node);
    case "chapter":
      return mapChapterToFileChapter(node);
    case "scene":
      return mapSceneToFileScene(node);
  }
}

/** OutlineTree → OutlineFileTree（updatedAt ↔ updated_at、schemaVersion ↔ schema_version） */
export function mapTreeToOutlineFile(tree: OutlineTree): OutlineFileTree {
  return {
    id: tree.id,
    type: "root",
    schema_version: tree.schemaVersion,
    children: tree.children.map(mapNodeToFileNode) as OutlineFileTree["children"],
  };
}

// ============ 项目（project.json ↔ API） ============

/** ProjectFileConfig → ProjectConfig（schema_version → schemaVersion、current_position → currentPosition） */
export function mapProjectFileToConfig(file: ProjectFileConfig): ProjectConfig {
  return {
    id: file.id,
    name: file.name,
    language: file.language,
    prompt: file.prompt,
    schemaVersion: file.schema_version,
    currentPosition: file.current_position,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
  };
}

/** ProjectConfig → ProjectFileConfig */
export function mapConfigToProjectFile(config: ProjectConfig): ProjectFileConfig {
  return {
    id: config.id,
    name: config.name,
    language: config.language,
    prompt: config.prompt,
    schema_version: config.schemaVersion,
    current_position: config.currentPosition,
    created_at: config.createdAt,
    updated_at: config.updatedAt,
  };
}
