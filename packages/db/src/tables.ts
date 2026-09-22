// @whispering233/ai-editor-db 表结构声明
//
// **双份声明**：sqliteTable 定义（查询构建/行类型推断用）+ 同文件 CREATE_TABLES_SQL 常量
// （建表执行用，connection.openDatabase → schema.createTables 执行）——两处必须同步，
// 由 schema.test.ts「DDL 与定义对齐」断言锁住（列名/类型/notNull/主键机械比对）。
//
// 边界：
// - JSON 列（data/changes/metadata 与拆解三列 chapter_ids/result/merge_written）一律 **text 模式**，
// 不用 drizzle `mode:'json'`——drizzle 的 json mode 对坏 JSON 直接 JSON.parse 抛错，
// 会打挂整表查询；防御在 queries 的行映射层（entity.ts parseDataColumn / decompose.ts parse*）。
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
 * decompose_jobs：拆解小说 job（导入式批量管线，设计见 docs/design/60-decompose.md）。
 * 一项目一 job（业务层保证，不设唯一约束）：状态机 pending → running → (paused | done | failed)，
 * 范围与组批口径是 S1 的快照（续拆/重跑按同一口径重算批次）；无 deleted_at——撤销 = 删书或恢复备份。
 */
export const decomposeJobs = sqliteTable("decompose_jobs", {
  id: text("id").primaryKey(), // 'job-*'
  status: text("status").notNull(), // pending | running | paused | done | failed（枚举值少且稳定，不加 CHECK）
  scope_start: integer("scope_start").notNull(), // 分析范围起始章序（1-based，文件位置序）
  scope_end: integer("scope_end").notNull(),
  batch_target_chars: integer("batch_target_chars").notNull(), // 组批目标字数快照
  concurrency: integer("concurrency").notNull(), // 并发段数快照（建 job 时读创作根配置；resume/重跑按它重算段，不读当前配置）
  model: text("model"), // 本次使用的模型（provider/id），审计用
  merge_written: text("merge_written"), // JSON: 上次归并写入清单（幂等/重跑三路比对；text 模式）
  error: text("error"), // job 级失败摘要
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

/**
 * decompose_batches：批规划与批结果暂存（S2 的中间产物，不是待确认草稿）。
 * 批结果只落 `result`（业务数据由 S3 写）；无外键——job 行删除时批行由 helper 连带删。
 */
export const decomposeBatches = sqliteTable(
  "decompose_batches",
  {
    job_id: text("job_id").notNull(), // → decompose_jobs.id
    seq: integer("seq").notNull(), // 1-based 批序号（文件位置序）
    chapter_ids: text("chapter_ids").notNull(), // JSON: 本批覆盖的章节点 id 列表（顺序 = 文件序；text 模式）
    status: text("status").notNull(), // pending | running | done | failed
    result: text("result"), // JSON: 该批抽取结果（逐章对齐；未完成 = NULL；text 模式）
    attempts: integer("attempts").notNull().default(0), // 已尝试次数（重试上限见设计文档）
    error: text("error"), // 该批失败摘要
    updated_at: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.job_id, t.seq] })],
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

-- decompose_jobs：拆解小说 job（一项目一 job，2026-09）
CREATE TABLE IF NOT EXISTS decompose_jobs (
  id                 TEXT PRIMARY KEY,   -- 'job-*'
  status             TEXT NOT NULL,      -- pending | running | paused | done | failed（枚举值少且稳定，不加 CHECK）
  scope_start        INTEGER NOT NULL,   -- 分析范围起始章序（1-based，文件位置序）
  scope_end          INTEGER NOT NULL,
  batch_target_chars INTEGER NOT NULL,   -- 组批目标字数快照（续拆/重跑按同一口径重算批次）
  concurrency        INTEGER NOT NULL,   -- 并发段数快照（建 job 时读取创作根配置；resume/重跑按它重算段，不读当前配置）
  model              TEXT,               -- 本次使用的模型（provider/id），审计用
  merge_written      TEXT,               -- JSON: 上次归并写入清单（幂等/重跑三路比对）
  error              TEXT,               -- job 级失败摘要
  created_at         TEXT NOT NULL,      -- ISO 8601，应用层写入
  updated_at         TEXT NOT NULL
);

-- decompose_batches：批规划与批结果暂存（S2 中间产物；无外键，批行由 helper 连带删）
CREATE TABLE IF NOT EXISTS decompose_batches (
  job_id      TEXT NOT NULL,             -- → decompose_jobs.id
  seq         INTEGER NOT NULL,          -- 1-based 批序号（文件位置序）
  chapter_ids TEXT NOT NULL,             -- JSON: 本批覆盖的章节点 id 列表（顺序 = 文件序）
  status      TEXT NOT NULL,             -- pending | running | done | failed
  result      TEXT,                      -- JSON: 该批抽取结果（逐章对齐；未完成 = NULL）
  attempts    INTEGER NOT NULL DEFAULT 0,-- 已尝试次数（重试上限见设计文档）
  error       TEXT,                      -- 该批失败摘要
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
);
`;