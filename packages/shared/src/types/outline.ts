// 大纲树数据类型：API 形态（camelCase）+ outline.json 存储形态（snake_case）两套
// 契约来源：doc/api/endpoints.md（OutlineNode/OutlineTree）、doc/database/schema.md（outline.json）
// 核心约束（决策 19）：严格三层 volume → chapter → scene，无游离节点；
//   节点携带 updated_at 版本戳（决策 19），顶层携带 schema_version（决策 13 修订）。

/** 大纲节点类型（含树根 "root"） */
export type OutlineNodeType = "root" | "volume" | "chapter" | "scene";

/** 节点 metadata 统计（仅 with_metadata=true 时返回，跨 outline.json × data.db 联查，endpoints.md） */
export interface OutlineNodeMetadata {
  /** 关联的伏笔数 */
  hookCount?: number;
  /** 关联角色数 */
  charCount?: number;
  /** 此节点触发的 Delta 数 */
  deltaCount?: number;
}

/** 大纲节点公共字段（API 形态 camelCase，endpoints.md） */
export interface OutlineNodeBase {
  id: string; // 如 "vol-1", "ch-3", "sc-15"（前缀 + nanoid）
  title: string;
  /** 可选描述 */
  summary?: string;
  /** 节点版本戳（决策 19，提案快照比对） */
  updatedAt: string;
  metadata?: OutlineNodeMetadata;
}

/** 卷节点：children 只能是章（严格三层，决策 19） */
export interface OutlineVolume extends OutlineNodeBase {
  type: "volume";
  children?: OutlineChapter[];
}

/** 章节点：children 只能是场景（严格三层，决策 19） */
export interface OutlineChapter extends OutlineNodeBase {
  type: "chapter";
  children?: OutlineScene[];
}

/** 场景节点：叶子，无 children（严格三层，决策 19） */
export interface OutlineScene extends OutlineNodeBase {
  type: "scene";
}

/** 大纲节点（判别联合：type 区分层级，类型层面强制严格三层） */
export type OutlineNode = OutlineVolume | OutlineChapter | OutlineScene;

/** 完整大纲树（GET /api/v1/outline 响应，endpoints.md） */
export interface OutlineTree {
  id: "root";
  type: "root";
  /** outline.json 顶层 schema_version（决策 13） */
  schemaVersion: number;
  /** 根下只能是卷（严格三层，决策 19） */
  children: OutlineVolume[];
}

// ============ outline.json 存储形态（snake_case，schema.md） ============

/** outline.json 节点公共字段（内部 snake_case；软删字段见决策 12） */
export interface OutlineFileNodeBase {
  id: string;
  title: string;
  summary?: string;
  /** 节点版本戳（决策 19），任何字段变更由服务端原子写时统一更新 */
  updated_at: string;
  /** 软删标记（决策 12）：默认 false，省略即未删 */
  deleted?: boolean;
  /** 软删时间（决策 12）：支撑回收站排序与定期清理 */
  deleted_at?: string;
}

/** outline.json 卷节点（存储形态） */
export interface OutlineFileVolume extends OutlineFileNodeBase {
  type: "volume";
  children?: OutlineFileChapter[];
}

/** outline.json 章节点（存储形态） */
export interface OutlineFileChapter extends OutlineFileNodeBase {
  type: "chapter";
  children?: OutlineFileScene[];
}

/** outline.json 场景节点（存储形态，叶子无 children） */
export interface OutlineFileScene extends OutlineFileNodeBase {
  type: "scene";
}

/** outline.json 节点（存储形态判别联合） */
export type OutlineFileNode = OutlineFileVolume | OutlineFileChapter | OutlineFileScene;

/** outline.json 顶层（schema.md 契约） */
export interface OutlineFileTree {
  id: "root";
  type: "root";
  /** 与 project.json 的 schema_version 同步写入（决策 13 修订） */
  schema_version: number;
  children: OutlineFileVolume[];
}
