// pi 运行时：项目会话文件的读写与投影（server 只经本模块接触会话存储）
//
// 为什么收在这里：会话文件是 pi `SessionManager` 的所有物（v3 树状 JSONL，见 docs/db/schema.md），
// 读条目 / 开管理器 / 投影消息形态的实现细节都属「pi 集成」——server 包只拿投影后的结果，
// 不 import pi（依赖方向：server → agent，pi 只在 agent 里）。
//
// **路径只从磁盘发现来**：`listProjectSessions` 扫 `<项目根>/sessions` 得到 `{id, path}` 映射，
// 调用方按 id 命中；客户端传入值永不参与路径拼接（旧 `sess_` 白名单校验随格式一并退休）。

import { SessionManager, type SessionEntry, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { projectMessageForWire, type WireMessage } from "./message-projection.js";
import { projectSessionsDir } from "./paths.js";

export type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";

/** 会话消息投影（比线协议消息多一个 entry id：历史接口与思维链端点按它定位） */
export interface WireSessionMessage extends WireMessage {
  id: string;
}

/**
 * 项目会话列表（pi 发现）：
 * - 只认 `<项目根>/sessions` 下的 v3 会话文件（旧 v1 文件无 `cwd` 头字段 → 被 pi 的 cwd 过滤丢弃）
 * - 头部异常（时间不可解析）的候选跳过，避免后续 `toISOString()` 抛错
 */
export async function listProjectSessions(projectRoot: string): Promise<SessionInfo[]> {
  const infos = await SessionManager.list(projectRoot, projectSessionsDir(projectRoot));
  return infos.filter((info) => !Number.isNaN(info.created.getTime()) && !Number.isNaN(info.modified.getTime()));
}

/** 按 id 找会话（磁盘发现映射；未命中 → null） */
export async function findProjectSession(projectRoot: string, sessionId: string): Promise<SessionInfo | null> {
  const sessions = await listProjectSessions(projectRoot);
  return sessions.find((info) => info.id === sessionId) ?? null;
}

/** 打开会话读条目；会话不存在 / 文件在发现与打开之间损坏 → null（调用方转 404，不 500） */
export async function readProjectSession(
  projectRoot: string,
  sessionId: string,
): Promise<{ info: SessionInfo; entries: SessionEntry[] } | null> {
  const info = await findProjectSession(projectRoot, sessionId);
  if (info === null) return null;
  try {
    return { info, entries: SessionManager.open(info.path, projectSessionsDir(projectRoot)).getEntries() };
  } catch {
    return null;
  }
}

/**
 * 打开指定会话文件的 SessionManager（续聊装配用）。
 * 缺省（无 sessionFile）→ 在项目目录新建会话。
 */
export function openProjectSessionManager(projectRoot: string, sessionFile?: string): SessionManager {
  const sessionsDir = projectSessionsDir(projectRoot);
  return sessionFile === undefined
    ? SessionManager.create(projectRoot, sessionsDir)
    : SessionManager.open(sessionFile, sessionsDir);
}

/** 条目 → API 消息投影（只保留 user/assistant/tool 三类；未知角色不投影） */
export function projectSessionMessages(entries: readonly SessionEntry[]): WireSessionMessage[] {
  const messages: WireSessionMessage[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const projected = projectMessageForWire(entry.message);
    if (projected === null) continue;
    messages.push({ id: entry.id, ...projected });
  }
  return messages;
}

/** 末条可见文本（列表摘要用；全为空 → 空串） */
export function lastVisibleSessionText(entries: readonly SessionEntry[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.type !== "message") continue;
    const projected = projectMessageForWire(entry.message);
    if (projected !== null && projected.content.trim() !== "") return projected.content;
  }
  return "";
}

/**
 * 读取某条 assistant 消息指定下标块的思维链全文；不是 thinking 块 / 下标越界 → null
 * （调用方转 404 THINKING_NOT_FOUND——列表接口只回预览，全文按需拉取）。
 */
export function readSessionThinking(
  entries: readonly SessionEntry[],
  messageId: string,
  blockIndex: number,
): string | null {
  const entry = entries.find((candidate) => candidate.id === messageId);
  if (entry === undefined || entry.type !== "message") return null;
  const content = (entry.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  const block = content[blockIndex] as { type?: string; thinking?: unknown } | undefined;
  if (block === undefined || block.type !== "thinking" || typeof block.thinking !== "string") return null;
  return block.thinking;
}
