// @ai-editor/db 连接与事务管理（T2.1）
//
// better-sqlite3 为同步 API（架构选型：内嵌零配置、同步简单可靠，见 doc/design/architecture.md 第 11 行）。
// 持久化语义（doc/api/data-flow.md 第 51 行）：WAL 模式 + synchronous=FULL，写入即时落盘。

import Database from "better-sqlite3";
import { createTables } from "./schema.js";

/** better-sqlite3 连接实例类型 */
export type Db = Database.Database;

/**
 * 打开（或创建）data.db 并初始化：
 * 1. better-sqlite3 打开指定路径（文件不存在则创建）
 * 2. WAL 模式（journal_mode 为数据库持久属性，重复设置幂等）
 * 3. synchronous = FULL：每个事务提交后 WAL 落盘（fsync），写入即时持久化
 * 4. 自动建表（CREATE TABLE IF NOT EXISTS，表不存在时创建）
 */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  createTables(db);
  return db;
}

/** 关闭数据库连接（同步 API，close 后该连接不可再用；幂等：已关闭则直接返回） */
export function closeDatabase(db: Db): void {
  if (db.open) {
    db.close();
  }
}

/**
 * 事务辅助：fn 正常返回则提交并返回其结果；fn 内任一语句抛错则整体回滚、异常向上传播。
 *
 * 基于 better-sqlite3 的 db.transaction（内部自动处理 BEGIN/COMMIT/ROLLBACK，
 * 嵌套调用自动升级为 SAVEPOINT）。
 *
 * 注意：better-sqlite3 事务是同步语义——fn 必须是同步函数；若在异步回调内抛错，
 * 事务已在同步流程结束后提交，错误无法触发回滚。
 */
export function withTransaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}
