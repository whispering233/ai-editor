// @whispering233/ai-editor-db queryDb 辅助：native 连接 → drizzle 实例（决策 49，批次十五 15.2）
//
// 查询模块函数签名保持 (db: Db)（native better-sqlite3 连接，调用方零改动），
// 模块内部经本辅助获取 drizzle 查询实例（builder/模板混合风格，4A）。
//
// - WeakMap 缓存：同一 native 连接只构造一次 drizzle 实例（构造本身轻量——仅包装
//   client/dialect/session，无 I/O；缓存省去每函数调用的重复分配）；测试并行多库互不干扰，
//   连接关闭后随 WeakMap 键自然 GC，无泄漏。
// - `$client` 可逆取回 native 连接：事务（withTransaction 保持 native db.transaction，
//   连接级共享——见 15.2 验证记录①）、PRAGMA、自建迁移管线（决策 13）走 native 路径。

import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";

const cache = new WeakMap<Database.Database, BetterSQLite3Database>();

/** 获取 db 的 drizzle 查询实例（同连接缓存；类型为 sync 模式 BetterSQLite3Database） */
export function queryDb(db: Database.Database): BetterSQLite3Database {
  let q = cache.get(db);
  if (q === undefined) {
    q = drizzle(db);
    cache.set(db, q);
  }
  return q;
}