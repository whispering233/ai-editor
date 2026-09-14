// 备份命名统计段（人物 / 设定 / 章）——未软删口径
//
// 用途：writeBackup 生成文件名时顺便算出「这份备份里有多少东西」，让用户在文件管理器 /
// 云盘网页里一眼看出备份内容的规模（契约见 `docs/api/20-api-backup.md`「设备与统计」）。
//
// 口径（与 `docs/db/schema.md`、`docs/api/20-api-backup.md` 逐字一致）：
// - 人物 / 设定 = entities 表 type 匹配且 `deleted_at IS NULL` 的行数（**不含回收站**）
// - 章 = outline.json 中 `type === "chapter"` 且未软删的节点数（严格三层：章挂卷下或直挂 root，场景不计数）
//
// 调用时机：备份打包之前（同一连接、同一时刻视角）；统计描述的是**备份内容**，
// 因此重命名备份时一律沿用原文件名里的统计段，不得用当前项目状态重算
// （见 server `renameBackup` 与 shared `formatBackupFileName` 注释）。

import type { BackupStats, OutlineFileTree } from "@whispering233/ai-editor-shared";
import { and, count, eq, isNull } from "drizzle-orm";
import type { Db } from "../connection.js";
import { queryDb } from "../query-db.js";
import { readOutlineFile } from "../storage/outline.js";
import { entities } from "../tables.js";

/** 非软删实体计数（单条 COUNT 查询；类型取值域与 entities CHECK 约束同域） */
function countEntities(db: Db, type: "character" | "setting"): number {
  const row = queryDb(db)
    .select({ n: count() })
    .from(entities)
    .where(and(eq(entities.type, type), isNull(entities.deleted_at)))
    .get();
  return row?.n ?? 0;
}

/** 未软删章节点计数（根下可挂卷或直挂章；卷内为章） */
function countChapters(children: OutlineFileTree["children"]): number {
  let n = 0;
  for (const node of children) {
    if (node.type === "chapter") {
      if (node.deleted !== true) n += 1;
      continue;
    }
    for (const chapter of node.children ?? []) {
      if (chapter.deleted !== true) n += 1;
    }
  }
  return n;
}

/**
 * 备份命名用的规模快照（未软删口径）：data.db 的实体计数 + 项目目录 outline.json 的章计数。
 * outline.json 损坏时 `readOutlineFile` 抛错（与备份管道一致：不静默产出半成品备份）。
 */
export function getBackupStats(db: Db, dir: string): BackupStats {
  return {
    characters: countEntities(db, "character"),
    settings: countEntities(db, "setting"),
    chapters: countChapters(readOutlineFile(dir).children),
  };
}
