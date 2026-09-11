// @whispering233/ai-editor-db 会话 JSONL 文件存储（B1）
//
// 职责：对话历史的一等存储——一 session 一个 JSONL（`sessions/<session_id>.jsonl`）。
// **纯 fs、不经 drizzle**：AGENTS 硬约束「查询层统一经 queryDb」针对 SQL 查询；本模块不碰 SQL。
// 契约：docs/db/schema.md「sessions/*.jsonl」（行格式 + 读取容忍规则 + 列表口径）。
//
// 设计要点：
// - 追写：每行一条消息；崩溃可能留半行 → 读侧跳过（不猜、不修），读到的前缀即有效历史
// - 前向兼容：行内 `type` 判别位，未知类型跳过（将来加 session_info / 思维链字段均纯追加）
// - session_id 同时是文件名 → 硬校验 `^sess_[A-Za-z0-9_-]{1,64}$`，**绝不拼接清洗后的路径**
// （含路径分隔符/`..` 一律抛 InvalidSessionIdError，调用方转 400）
// - 时间不生成：created_at 由应用层传入（与 db 包其余模块同一约定）

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { truncate, type ChatMessageRow, type ChatRole, type ChatSessionSummary } from "@whispering233/ai-editor-shared";
import { writeTextAtomic } from "./storage/atomic.js";

/** 会话目录名（项目目录内） */
export const SESSIONS_DIR_NAME = "sessions";

/** 会话文件名后缀 */
export const SESSION_FILE_EXT = ".jsonl";

/** 当前会话行格式版本（header.version 大于该值 → 整个文件跳过，见 schema.md 容忍规则） */
export const SESSION_FILE_VERSION = 1;

/** session_id 硬约束（同时是文件名校验——客户端传入值不得含路径分隔符/`..`） */
export const SESSION_ID_PATTERN = /^sess_[A-Za-z0-9_-]{1,64}$/;

/** 会话列表 lastMessage 截断长度（与迁移前 queries/chat.ts 同口径；模块内部约定值，不对外导出） */
const SESSION_LAST_MESSAGE_MAX_LEN = 50;

/** session_id 非法（调用方转 400 VALIDATION_ERROR；绝不「清洗后拼接」路径） */
export class InvalidSessionIdError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`session_id 非法（应为 ^sess_[A-Za-z0-9_-]{1,64}$）：${sessionId}`);
    this.name = "InvalidSessionIdError";
    this.sessionId = sessionId;
  }
}

/** session_id 是否合法（文件名安全：不含路径分隔符/`..`/空白） */
export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

/** 会话目录绝对路径（`<projectRoot>/sessions`） */
export function sessionsDirPath(projectRoot: string): string {
  return join(projectRoot, SESSIONS_DIR_NAME);
}

/** 会话文件绝对路径（内部用；调用方必须先经 assertSessionId） */
function sessionFilePath(projectRoot: string, sessionId: string): string {
  return join(sessionsDirPath(projectRoot), `${sessionId}${SESSION_FILE_EXT}`);
}

/** 校验 session_id，非法即抛（写/读/删三个入口共用；路径只由合法 id 拼出） */
function assertSessionId(sessionId: string): void {
  if (!isValidSessionId(sessionId)) throw new InvalidSessionIdError(sessionId);
}

// ============ 行形态（写入侧） ============

/** 追加一行消息的入参（storage 形态；tool_calls 为「解析后的数组」，与旧 chat_messages 语义一致） */
export interface SessionAppendInput {
  /** 消息 id；缺省 nanoid（与旧 insertChatMessage 一致） */
  id?: string;
  role: ChatRole;
  content?: string | null;
  /** assistant 消息的工具调用数组 */
  tool_calls?: unknown[] | null;
  /** tool 消息关联的 assistant 工具调用 id */
  tool_call_id?: string | null;
  /** ISO 8601，应用层写入（本模块不生成时间） */
  created_at: string;
}

/** header 行（会话创建时写一次；`id` = session_id = 文件名） */
interface SessionHeaderLine {
  type: "session";
  version: number;
  id: string;
  created_at: string;
}

/** 消息行（可选字段缺省不写，保持文件干净；读侧缺省回落 null） */
interface SessionMessageLine {
  type: "message";
  id: string;
  role: ChatRole;
  content: string | null;
  created_at: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

/** 消息行序列化（单行 JSON + `\n`；可选字段仅非空时写入） */
function serializeMessageLine(row: SessionAppendInput, id: string): string {
  const line: SessionMessageLine = {
    type: "message",
    id,
    role: row.role,
    content: row.content ?? null,
    created_at: row.created_at,
  };
  if (row.tool_calls != null) line.tool_calls = row.tool_calls;
  if (row.tool_call_id != null) line.tool_call_id = row.tool_call_id;
  return `${JSON.stringify(line)}\n`;
}

/** header 行序列化 */
function serializeHeaderLine(sessionId: string, createdAt: string): string {
  const line: SessionHeaderLine = {
    type: "session",
    version: SESSION_FILE_VERSION,
    id: sessionId,
    created_at: createdAt,
  };
  return `${JSON.stringify(line)}\n`;
}

// ============ 写入 ============

/**
 * 追加一条消息（`POST /chat` 落库路径）。
 *
 * 文件不存在 → 同一 chunk 内先写 header 行再写消息行（首写单次 append，避免半截 header）；
 * 目录不存在 → 递归创建。追加为单次 `appendFileSync`，不做 fsync（本地单用户工具，
 * 崩溃容忍语义已在读侧体现：半行被跳过）。
 *
 * @throws InvalidSessionIdError session_id 非法（调用方转 400）
 */
export function appendSessionMessage(
  projectRoot: string,
  sessionId: string,
  row: SessionAppendInput,
): void {
  assertSessionId(sessionId);
  const file = sessionFilePath(projectRoot, sessionId);
  const messageLine = serializeMessageLine(row, row.id ?? nanoid());
  if (existsSync(file)) {
    appendFileSync(file, messageLine);
    return;
  }
  mkdirSync(sessionsDirPath(projectRoot), { recursive: true });
 // header.created_at = 首条消息时间（会话创建时间即首条消息时间）
  appendFileSync(file, serializeHeaderLine(sessionId, row.created_at) + messageLine);
}

/**
 * 整文件重写（header + 全部消息行）——**迁移专用**（006 导出 chat_messages）。
 *
 * 幂等：输出仅由入参决定（不生成时间/随机 id），同一入参重复调用结果一致 ⇒
 * 迁移事务回滚后重跑安全（写文件不可回滚，靠「按表内容重写」收敛）。
 * 原子写（临时文件 + fsync + rename）：崩溃不会留下半截文件。
 * 空 rows 也写出仅 header 的文件（created_at 为空串——该文件在列表聚合中被视为无消息会话而跳过）。
 *
 * @throws InvalidSessionIdError session_id 非法
 */
export function writeSessionFile(
  projectRoot: string,
  sessionId: string,
  rows: readonly ChatMessageRow[],
): void {
  assertSessionId(sessionId);
  mkdirSync(sessionsDirPath(projectRoot), { recursive: true });
  const header = serializeHeaderLine(sessionId, rows[0]?.created_at ?? "");
  const body = rows
    .map((r) =>
      serializeMessageLine(
        {
          id: r.id,
          role: r.role,
          content: r.content,
          tool_calls: r.tool_calls,
          tool_call_id: r.tool_call_id,
          created_at: r.created_at,
        },
        r.id,
      ),
    )
    .join("");
  writeTextAtomic(sessionFilePath(projectRoot, sessionId), header + body);
}

/**
 * 删除会话文件（`DELETE /chat/sessions/:id`；无回收站、不可恢复）。
 * @returns true = 已删除；false = 文件本就不存在（调用方转 404）
 * @throws InvalidSessionIdError session_id 非法
 */
export function deleteSessionFile(projectRoot: string, sessionId: string): boolean {
  assertSessionId(sessionId);
  const file = sessionFilePath(projectRoot, sessionId);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

// ============ 读取 ============

/** 文件解析结果（内部：行 + header 创建时间） */
interface ParsedSessionFile {
  rows: ChatMessageRow[];
  /** header.created_at；header 缺该字段时回落首条消息时间（不因单个字段弃整个文件） */
  createdAt: string;
}

/** 非法行计数告警（每文件一次，不逐行刷屏；容忍规则要求「跳过 + 记日志」） */
function warnSkippedLines(file: string, count: number): void {
  console.warn(`[db] 会话文件存在 ${count} 行非法/不可用条目（已跳过）：${file}`);
}

const CHAT_ROLES: readonly string[] = ["user", "assistant", "tool"];

/**
 * 解析单个会话文件（容忍规则见 schema.md）：
 * - header 缺失 / `type !== "session"` / `version` 非 1 → 整个文件跳过（返回空）
 * - 未知 `type` 行 → **静默**跳过（合法前向兼容形态，不计告警）；非法 JSON / 形态不合法的消息行 → 跳过 + 告警
 * - 输出顺序 = 文件行序（写入即时间序）
 */
function parseSessionFile(file: string, sessionId: string): ParsedSessionFile {
  const empty: ParsedSessionFile = { rows: [], createdAt: "" };
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw err;
  }
  const lines = raw.split("\n");
  const header = parseHeader(lines[0] ?? "");
  if (header === null) return empty; // header 缺失/版本超前：不猜

  const rows: ChatMessageRow[] = [];
  let malformed = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue; // 尾部空行/尾随换行
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformed += 1; // 崩溃残留的半行
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      malformed += 1;
      continue;
    }
    const entry = parsed as Record<string, unknown>;
 // 未知条目类型（session_info / model_change / compaction…）：前向兼容**静默**跳过，不算异常
    if (typeof entry.type === "string" && entry.type !== "message") continue;
    const row = toMessageRow(entry, sessionId);
    if (row === null) {
      malformed += 1; // 形态不合法的消息行
      continue;
    }
    rows.push(row);
  }
  if (malformed > 0) warnSkippedLines(file, malformed);
  return {
    rows,
    createdAt: header.created_at !== "" ? header.created_at : (rows[0]?.created_at ?? ""),
  };
}

/** 解析 header 行；非 header / 未来版本 → null（整个文件跳过） */
function parseHeader(line: string): { created_at: string } | null {
  if (line.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const h = parsed as Record<string, unknown>;
  if (h.type !== "session") return null;
  const version = h.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version !== SESSION_FILE_VERSION) {
    return null; // 版本超前（未来格式）与版本缺失一视同仁：不猜
  }
  return { created_at: typeof h.created_at === "string" ? h.created_at : "" };
}

/** 解析后的条目 → 存储形态行；形态不合法（缺 id/role/created_at）→ null（调用方计入告警） */
function toMessageRow(m: Record<string, unknown>, sessionId: string): ChatMessageRow | null {
  if (typeof m.id !== "string" || m.id === "") return null;
  if (typeof m.role !== "string" || !CHAT_ROLES.includes(m.role)) return null;
  if (typeof m.created_at !== "string" || m.created_at === "") return null; // 排序依赖它
  return {
    id: m.id,
    // project_id 已无存储意义（归属由项目目录表达）；保留字段形状供旧消费方过渡
    session_id: sessionId,
    project_id: "",
    role: m.role as ChatRole,
    content: typeof m.content === "string" ? m.content : null,
    tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls : null,
    tool_call_id: typeof m.tool_call_id === "string" ? m.tool_call_id : null,
    created_at: m.created_at,
  };
}

/**
 * 读取会话消息（存储形态，供 agent 续聊重建 / API 历史）。
 * 文件不存在 / header 不可用 → 空数组（不抛错，与「会话不存在即空历史」一致）。
 *
 * @throws InvalidSessionIdError session_id 非法
 */
export function readSessionRows(projectRoot: string, sessionId: string): ChatMessageRow[] {
  assertSessionId(sessionId);
  return parseSessionFile(sessionFilePath(projectRoot, sessionId), sessionId).rows;
}

/**
 * 会话列表（`GET /api/v1/chat/sessions`）：扫目录 + 逐文件解析聚合（不建索引文件）。
 * - 仅含消息的会话（无消息的文件不出现）
 * - `lastMessage` = 末条消息 content 截断；`messageCount` = 消息行数
 * - `createdAt` = header 创建时间；`updatedAt` = 末条消息时间
 * - 排序：`updatedAt` 倒序、同值按 id 升序（稳定序；与迁移前 listSessions 口径一致）
 * - 目录不存在 → 空数组；坏文件跳过（不因单个文件阻断列表）
 */
export function listSessionSummaries(projectRoot: string): ChatSessionSummary[] {
  const dir = sessionsDirPath(projectRoot);
  if (!existsSync(dir)) return [];
  const summaries: ChatSessionSummary[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(SESSION_FILE_EXT)) continue;
    const id = entry.name.slice(0, -SESSION_FILE_EXT.length);
    if (!isValidSessionId(id)) continue; // 目录内的陌生文件不参与
    const parsed = parseSessionFile(join(dir, entry.name), id);
    const last = parsed.rows[parsed.rows.length - 1];
    if (last === undefined) continue; // 仅 header / 全坏行：无消息会话
    summaries.push({
      id,
      lastMessage: truncate(last.content ?? "", SESSION_LAST_MESSAGE_MAX_LEN),
      messageCount: parsed.rows.length,
      createdAt: parsed.createdAt !== "" ? parsed.createdAt : last.created_at,
      updatedAt: last.created_at,
    });
  }
  return summaries.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
}
