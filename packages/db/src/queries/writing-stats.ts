// @whispering233/ai-editor-db 码字日统计读写（writing_stats_daily，2026-11）
//
// 口径与不变式见 `docs/db/schema.md`「writing_stats_daily」，端点见 `docs/api/130-api-writing-stats.md`：
// - 按作品、按天累计**正增量**（只加不扣）；日键 = 服务端本地日（server 侧 `localDateKey` 生成）
// - **库写入唯一入口 = addWritingChars**（不提供改 / 删 / 重算入口）
// - 读取按 `stat_date` 升序；列表形状 = `{ date, chars }`（与 API 响应 `days` 同形）
// - 写入是 best-effort：调用方（`PUT /manuscript`）自行 try/catch，本层抛错即失败
//
// 时间约定：ISO 8601 由调用方传入（`now`），模块内不生成时间。

import { asc, sql } from "drizzle-orm";
import type { Db } from "../connection.js";
import { queryDb } from "../query-db.js";
import { writingStatsDaily } from "../tables.js";

/** 一天的统计（`date` = 服务端本地日 YYYY-MM-DD；`chars` 恒 > 0） */
export interface WritingStatsDay {
  date: string;
  chars: number;
}

/**
 * 累加某本地日的正文字数（首日插入 / 已有日 upsert 累加）。
 * `chars` 必须是正整数——0 / 负数 / 非整数直接抛错（空日不建行，表级 CHECK 是同一条不变式）。
 */
export function addWritingChars(db: Db, date: string, chars: number, now: string): void {
  if (!Number.isInteger(chars) || chars <= 0) {
    throw new Error(`addWritingChars: chars 必须是正整数，收到 ${String(chars)}`);
  }
  queryDb(db)
    .insert(writingStatsDaily)
    .values({ stat_date: date, chars, updated_at: now })
    .onConflictDoUpdate({
      target: writingStatsDaily.stat_date,
      set: {
        chars: sql`${writingStatsDaily.chars} + excluded.chars`,
        updated_at: now,
      },
    })
    .run();
}

/** 全量统计行（按 `stat_date` 升序；只含有正增量的日期） */
export function listWritingStats(db: Db): WritingStatsDay[] {
  return queryDb(db)
    .select({ date: writingStatsDaily.stat_date, chars: writingStatsDaily.chars })
    .from(writingStatsDaily)
    .orderBy(asc(writingStatsDaily.stat_date))
    .all();
}