// 迁移 006：对话历史出库——`chat_messages` 表导出为 `sessions/<session_id>.jsonl` 后 DROP
//
// 背景：对话历史从 data.db 迁到项目目录（一 session 一 JSONL，契约见 docs/db/schema.md）。
// 好处：会话随书目录走（备份/导入/改名/移动天然携带）、追加写可读可 diff、思维链等扩展纯追加。
//
// 安全性/幂等性：
// - 导出是「按表内容整文件重写」（writeSessionFile 原子写，输出仅由入参决定）——文件写不可回滚，
//   靠完整性收敛：崩溃在提交前 ⇒ 下次重跑按同一张表重写同内容；提交后 ⇒ 表已消失不再重跑
// - 事务由 runMigrations 保证（up + setUserVersion 原子提交，抛错整体回滚）
// - session_id 不合法（不匹配 `^sess_[A-Za-z0-9_-]{1,64}$`，无法直接作文件名）的旧会话
//   以 `sess_legacy_<sha256 前 16 位>` 为文件名落盘（**保数据不丢，会话 id 变更**）——
//   确定性映射 ⇒ 重跑产出同一文件名，幂等性不受影响
//
// 本迁移需要项目目录（写文件）——经 MigrationContext.projectRoot 取得（迁移框架透传）。

import { createHash } from "node:crypto";
import type { ChatMessageRow, ChatRole } from "@whispering233/ai-editor-shared";
import type { Db } from "../connection.js";
import { isValidSessionId, writeSessionFile } from "../sessions.js";
import type { Migration } from "./index.js";

/** chat_messages 旧表行（迁移读取用；tool_calls 为 TEXT 列，需防御解析） */
interface LegacyChatRow {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: string;
}

/** tool_calls TEXT 列 → 数组；NULL / 非法 JSON / 非数组 → null（与旧 parseToolCalls 同口径） */
function parseToolCallsColumn(json: string | null): unknown[] | null {
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 读全表并按 session_id 分组（组内保持查询序：created_at 升序、同时间戳按 rowid 插入序）。
 * 直接 `prepare` 属迁移管线（AGENTS 硬约束「查询层统一经 queryDb」的明确例外）。
 */
function readLegacyRowsBySession(db: Db): Map<string, ChatMessageRow[]> {
  const rows = db
    .prepare(
      `SELECT id, session_id, role, content, tool_calls, tool_call_id, created_at
       FROM chat_messages
       ORDER BY session_id ASC, created_at ASC, rowid ASC`,
    )
    .all() as LegacyChatRow[];
  const bySession = new Map<string, ChatMessageRow[]>();
  for (const r of rows) {
    const list = bySession.get(r.session_id);
    const row: ChatMessageRow = {
      id: r.id,
      session_id: r.session_id,
      // project_id 已无存储意义（归属由项目目录表达）；写文件时由 writeSessionFile 忽略该字段
      project_id: "",
      role: r.role,
      content: r.content,
      tool_calls: parseToolCallsColumn(r.tool_calls),
      tool_call_id: r.tool_call_id,
      created_at: r.created_at,
    };
    if (list === undefined) bySession.set(r.session_id, [row]);
    else list.push(row);
  }
  return bySession;
}

const migration006: Migration = {
  version: 6,
  up(db: Db, ctx) {
 // 旧库无 chat_messages（新库从未建过该表 / 已迁移过）→ 无事可做（不因缺表中断迁移链）
    if (!tableExists(db, "chat_messages")) return;
    const bySession = readLegacyRowsBySession(db);
    const exportable = [...bySession.keys()].filter((id) => isValidSessionId(id));
    if (exportable.length > 0 && ctx.projectRoot === "") {
      // 防御：有会话要导出却无项目目录（ensureSchemaCompatible 恒传 dir；纯逻辑调用才缺失）
      throw new Error("迁移 006 需要项目目录（projectRoot）才能导出会话文件");
    }
    let remapped = 0;
    for (const [sessionId, rows] of bySession) {
      const targetId = isValidSessionId(sessionId) ? sessionId : legacySessionId(sessionId);
      if (targetId !== sessionId) remapped += 1;
      writeSessionFile(ctx.projectRoot, targetId, rows);
    }
    if (remapped > 0) {
      console.warn(
        `[db] 迁移 006：${remapped} 个 session_id 非法的旧会话已以 sess_legacy_<hash> 文件名导出（数据未丢，id 已变更）`,
      );
    }
    db.exec("DROP TABLE chat_messages");
  },
};

/**
 * 非法旧 id → 稳定的合法文件名 id：`sess_legacy_` + sha256 前 16 位十六进制。
 * 同一输入恒同输出（迁移重跑幂等）；碰撞概率可忽略；原始 id 不再保留（旧 id 仅作文件名，无对外语义）。
 */
function legacySessionId(originalId: string): string {
  return `sess_legacy_${createHash("sha256").update(originalId).digest("hex").slice(0, 16)}`;
}

/** 表是否存在（sqlite_master 查询；迁移内的存在性判定） */
function tableExists(db: Db, name: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return row !== undefined;
}

export default migration006;
