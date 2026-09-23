// @whispering233/ai-editor-db 表结构声明
//
// **双份声明**：sqliteTable 定义（查询构建/行类型推断用）+ 同文件 CREATE_TABLES_SQL 常量
// （建表执行用，connection.openDatabase → schema.createTables 执行）——两处必须同步，
// 由 schema.test.ts「DDL 与定义对齐」断言锁住（列名/类型/notNull/主键机械比对）。
//
// 边界：
// - JSON 列（data/changes/metadata）一律 **text 模式**，
// 不用 drizzle `mode:'json'`——drizzle 的 json mode 对坏 JSON 直接 JSON.parse 抛错，
// 会打挂整表查询；防御在 queries 的行映射层（entity.ts parseDataColumn）。
// - 对话历史**不在库内**（项目目录 `sessions/*.jsonl`，见 sessions.ts / docs/db/schema.md）。
// - 标识符由 drizzle escapeName 双引号包裹输出（`"order"` 关键字列安全，无需特殊转义）。
// - CHECK 约束与部分索引两处都声明（drizzle 侧供对齐核对；真实建表以 DDL 常量为准）。

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** entities：实体表（人物/设定/地点/伏笔/时间轴事件/时间标签点/参考资料） */
export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    name: text("name").notNull(),
 // data 列保持 text 模式（坏 JSON 防御在行映射层，不用 drizzle json mode）
    data: text("data").notNull().default("{}"),
 // 时间轴线性序（G2 修订）：event 与 timepoint 各类型内线性（各自 0..n-1），其余类型恒为 NULL
    sort_order: integer("sort_order"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    check(
      "entities_type_check",
      sql`${t.type} IN ('character', 'setting', 'location', 'hook', 'event', 'timepoint', 'reference')`,
    ),
  ],
);

/** relation_records：通用关系表（含 plot_edge 剧情连线、occurs_in 事件锚定） */
export const relationRecords = sqliteTable(
  "relation_records",
  {
    id: text("id").primaryKey(),
    source_type: text("source_type").notNull(),
    source_id: text("source_id").notNull(),
    target_type: text("target_type").notNull(),
    target_id: text("target_id").notNull(),
    relation_type: text("relation_type").notNull(),
    metadata: text("metadata"), // JSON 扩展元数据（text 模式）
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
 // 3 个部分索引，仅覆盖未软删行
    index("idx_relation_source").on(t.source_id).where(sql`${t.deleted_at} IS NULL`),
    index("idx_relation_target").on(t.target_id).where(sql`${t.deleted_at} IS NULL`),
    index("idx_relation_type").on(t.relation_type).where(sql`${t.deleted_at} IS NULL`),
  ],
);

/** delta_records：属性变更表（"order" 关键字列由 drizzle 双引号转义，标识符安全） */
export const deltaRecords = sqliteTable(
  "delta_records",
  {
    id: text("id").primaryKey(),
    node_id: text("node_id").notNull(), // 触发变更的大纲节点
    target_type: text("target_type").notNull(),
    target_id: text("target_id").notNull(),
    changes: text("changes").notNull(), // JSON: [{field, op, from?, to?, value?}]（text 模式）
    description: text("description").notNull(),
    order: integer("order").notNull().default(0), // 同一节点内多个 Delta 的排序（全局单调递增，服务端生成）
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
);

/** chat_messages：已删除（迁移 006：对话历史出库为 `sessions/*.jsonl`，表已 DROP） */

/**
 * document_records：块文档表（章正文 / 参考资料正文，2026-09）——块数组 JSON 为真相 +
 * 服务端派生的纯文本投影；owner 无外键（章在 outline.json、参考资料在 entities，存在性由写入侧守卫），
 * 无 deleted_at（生命周期跟随 owner：软删即不可见、purge 时调用方删行）。
 */
export const documentRecords = sqliteTable(
  "document_records",
  {
    owner_kind: text("owner_kind").notNull(), // 'chapter' | 'reference'（枚举值少且稳定，不加 CHECK）
    owner_id: text("owner_id").notNull(), // 'ch-*'（章节点 id）| 'ref-*'（参考资料实体 id）
    content: text("content").notNull(), // 块数组 JSON 字符串（真相；服务端读路径不解析）
    content_text: text("content_text").notNull(), // 服务端派生的轻量 md 投影（AI 读取/摘要/字数）
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(), // 版本戳：多标签页防覆盖（base_updated_at 比对）
  },
  (t) => [primaryKey({ columns: [t.owner_kind, t.owner_id] })],
);

/**
 * 全部业务表 + 索引的建表 SQL（幂等：CREATE TABLE/INDEX IF NOT EXISTS）——建表执行的事实来源。
 * 与上方 sqliteTable 定义必须同步（schema.test.ts 对齐断言覆盖）。
 */
export const CREATE_TABLES_SQL = `
-- entities：实体表（人物/设定/地点/伏笔/时间轴事件/时间标签点）
CREATE TABLE IF NOT EXISTS entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook', 'event', 'timepoint', 'reference')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',  -- JSON: 各类型的专属字段
  sort_order  INTEGER,         -- 时间轴线性序（G2 修订）：event 与 timepoint 各类型内线性（各自 0..n-1），其余类型恒为 NULL
  created_at  TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at  TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对）
  deleted_at  TEXT             -- 软删标记，NULL 表示未删除；非 NULL 时该实体进入回收站，本体保留可还原
);

-- relation_records：通用关系表
CREATE TABLE IF NOT EXISTS relation_records (
  id            TEXT PRIMARY KEY,
  source_type   TEXT NOT NULL,             -- 端点类型：实体 'character'|'setting'|'location'|'hook'|'event'，大纲节点 'outline_node'
  source_id     TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata      TEXT,             -- JSON 扩展元数据
  created_at    TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at    TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对；软删/还原亦更新）
  deleted_at    TEXT              -- 级联软删标记：仅实体/节点级联删除时写入；
                                  -- 手动删除关系 = 物理删（不置 deleted_at，不进入回收站）
);

-- 索引（补）：k 跳遍历与高频关系查询（部分索引，仅覆盖未软删行）
CREATE INDEX IF NOT EXISTS idx_relation_source ON relation_records(source_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relation_target ON relation_records(target_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relation_type   ON relation_records(relation_type) WHERE deleted_at IS NULL;

-- delta_records：属性变更表
CREATE TABLE IF NOT EXISTS delta_records (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL,       -- 触发变更的大纲节点
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  changes     TEXT NOT NULL,       -- JSON: [{field, op, from?, to?, value?}]
  description TEXT NOT NULL,       -- 人类可读描述
  "order"     INTEGER NOT NULL DEFAULT 0,  -- 同一节点内多个 Delta 的排序（全局单调递增，服务端生成）
  created_at  TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at  TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对）
  deleted_at  TEXT              -- 级联软删标记：仅实体/节点级联删除时写入。
                                -- 可见性联动触发节点与目标实体：任一端软删即不可见
);

-- document_records：块文档表（章正文 / 参考资料正文，2026-09）
CREATE TABLE IF NOT EXISTS document_records (
  owner_kind   TEXT NOT NULL,   -- 'chapter' | 'reference'（枚举值少且稳定，不加 CHECK）
  owner_id     TEXT NOT NULL,   -- 'ch-*'（章节点 id）| 'ref-*'（参考资料实体 id）
  content      TEXT NOT NULL,   -- 块数组 JSON 字符串（真相；服务端读路径不解析）
  content_text TEXT NOT NULL,   -- 服务端派生的轻量 md 投影（AI 读取/列表摘要/搜索/字数）
  created_at   TEXT NOT NULL,   -- ISO 8601，应用层写入
  updated_at   TEXT NOT NULL,   -- ISO 8601，应用层写入（版本戳：多标签页防覆盖）
  PRIMARY KEY (owner_kind, owner_id)   -- 一 owner 一行（upsert 覆盖，行随 owner 生命周期）
);

`;