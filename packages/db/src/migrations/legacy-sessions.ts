// 旧会话格式（v1 扁平 JSONL）导出辅助 —— **仅服务已发布的迁移 006**（对话历史出库）。
//
// 为什么留在这里而不是 db 的公开出口：新会话格式（pi session v3）的读写全部归 pi
// `SessionManager`（见 docs/db/schema.md「sessions/*.jsonl」），本仓生产链路**不再读写**
// 旧格式；只有迁移 006 需要把 `chat_messages` 表按旧格式落盘一次（已发布迁移不可改语义）。
//
// 因此：本模块不进 db 包入口导出、不提供读接口（读断言由测试自行用 node:fs 完成）。
// 旧格式行：header（`type/version/id/created_at`）+ 消息行（`type=message`）。

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeTextAtomic } from "../storage/atomic.js";

/** 会话目录名（项目目录内） */
const LEGACY_SESSIONS_DIR_NAME = "sessions";

/** 旧会话行格式版本（header.version 不为该值 → 老读侧整文件跳过） */
const LEGACY_SESSION_FILE_VERSION = 1;

/** 旧 session_id 硬约束（同时是文件名校验——客户端传入值不得含路径分隔符/`..`） */
const LEGACY_SESSION_ID_PATTERN = /^sess_[A-Za-z0-9_-]{1,64}$/;

/** 旧会话行（`chat_messages` 表行形态；tool_calls 已在调用方解析为数组） */
export interface LegacySessionRow {
  id: string;
  role: string;
  content: string | null;
  tool_calls: unknown[] | null;
  tool_call_id: string | null;
  created_at: string;
}

/** 旧 session_id 是否合法（迁移判定「可直接作文件名」） */
export function isValidLegacySessionId(id: string): boolean {
  return LEGACY_SESSION_ID_PATTERN.test(id);
}

/** 旧会话目录绝对路径（`<projectRoot>/sessions`） */
export function legacySessionsDirPath(projectRoot: string): string {
  return join(projectRoot, LEGACY_SESSIONS_DIR_NAME);
}

/** 旧会话文件绝对路径（路径只由已校验的 id 拼出） */
function legacySessionFilePath(projectRoot: string, sessionId: string): string {
  return join(legacySessionsDirPath(projectRoot), `${sessionId}.jsonl`);
}

/** 消息行序列化（可选字段仅非空时写入，与旧读写实现逐字节一致） */
function serializeMessageLine(row: LegacySessionRow): string {
  const line: Record<string, unknown> = {
    type: "message",
    id: row.id,
    role: row.role,
    content: row.content ?? null,
    created_at: row.created_at,
  };
  if (row.tool_calls != null) line.tool_calls = row.tool_calls;
  if (row.tool_call_id != null) line.tool_call_id = row.tool_call_id;
  return `${JSON.stringify(line)}\n`;
}

/**
 * 整文件重写一个旧会话文件（header + 全部消息行）——**迁移 006 专用**。
 *
 * 幂等：输出仅由入参决定（不生成时间/随机 id）⇒ 迁移事务回滚后重跑结果一致
 * （文件写不可回滚，靠「按表内容重写」收敛）。原子写（临时文件 + fsync + rename）。
 * 空 rows 也写出仅 header 的文件（created_at 为空串）。
 *
 * @throws Error session_id 非法（调用方必须先经 isValidLegacySessionId 判定/改名）
 */
export function writeLegacySessionFile(
  projectRoot: string,
  sessionId: string,
  rows: readonly LegacySessionRow[],
): void {
  if (!isValidLegacySessionId(sessionId)) {
    throw new Error(`旧会话 id 非法（应为 ^sess_[A-Za-z0-9_-]{1,64}$）：${sessionId}`);
  }
  const dir = legacySessionsDirPath(projectRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const header = `${JSON.stringify({
    type: "session",
    version: LEGACY_SESSION_FILE_VERSION,
    id: sessionId,
    created_at: rows[0]?.created_at ?? "",
  })}\n`;
  writeTextAtomic(legacySessionFilePath(projectRoot, sessionId), header + rows.map(serializeMessageLine).join(""));
}
