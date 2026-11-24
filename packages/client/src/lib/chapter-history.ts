// 章级历史抽屉（C2）的可测逻辑：列表行文案（相对时间 + 绝对时间 + 字数 + 与当前字数之差）、
// 空态文案、列表 / 恢复两类失败的可见文案。纯函数、无 DOM（node 环境可测）。
// 契约：docs/api/110-api-manuscript.md「章级历史（快照 + 恢复）」。
import { ApiError, type ChapterSnapshotSummary } from "./api";
import { formatTextLength } from "./manuscript";

/**
 * 空历史文案：本卡选「抽屉空态」而不是「入口禁用」——禁用态要在每次开章时先预取列表
 * （多一次请求 + 按钮可用性抖动），且点不动的按钮解释不了「历史从哪来」；
 * 空态顺带说明来源，入口常显、行为可预测。
 */
export const HISTORY_EMPTY_TEXT = "还没有历史版本：每次保存会自动留存改动前的正文";

/** 列表行的展示文案（时间与字数都在这一层算好，组件只摆样式） */
export interface ChapterHistoryRow {
  seq: number;
  /** 相对时间（`3 分钟前`；一小时内按分钟，一天内按小时，一个月内按天） */
  relative: string;
  /** 绝对时间（本地 `YYYY-MM-DD HH:mm`） */
  absolute: string;
  /** 该版本字数（`1.2 千字` / `340 字`；0 → `0 字`） */
  charCountText: string;
  /** 与当前正文的字数差（`比当前少 120 字` / `比当前多 8 字` / `与当前字数相同`） */
  deltaText: string;
}

/** 可解析的时间戳（ISO 字符串）→ ms；坏值 → null（调用方给兜底文案，不抛） */
function parsedAt(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** 相对时间：`刚刚` / `N 分钟前` / `N 小时前` / `N 天前` / `N 个月前`（坏时间戳 → `时间未知`） */
export function formatSnapshotRelative(createdAt: string, now: number): string {
  const at = parsedAt(createdAt);
  if (at === null) return "时间未知";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

/** 绝对时间（本地时区）：`YYYY-MM-DD HH:mm`；坏时间戳 → `时间未知` */
export function formatSnapshotAbsolute(createdAt: string): string {
  const at = parsedAt(createdAt);
  if (at === null) return "时间未知";
  const date = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 与当前正文的字数差（正 = 该版本更多；0 = 相同） */
export function describeCharDelta(snapshotCharCount: number, currentCharCount: number): string {
  const diff = snapshotCharCount - currentCharCount;
  if (diff === 0) return "与当前字数相同";
  return diff > 0 ? `比当前多 ${diff} 字` : `比当前少 ${-diff} 字`;
}

/** 快照列表 → 列表行（顺序沿用服务端给的 seq 降序 = 新→旧） */
export function chapterHistoryRows(
  snapshots: ChapterSnapshotSummary[],
  currentCharCount: number,
  now: number,
): ChapterHistoryRow[] {
  return snapshots.map((snapshot) => ({
    seq: snapshot.seq,
    relative: formatSnapshotRelative(snapshot.createdAt, now),
    absolute: formatSnapshotAbsolute(snapshot.createdAt),
    charCountText: formatTextLength(snapshot.charCount) ?? "0 字",
    deltaText: describeCharDelta(snapshot.charCount, currentCharCount),
  }));
}

/** 列表 / 预览读取失败：服务端 message 原样透出，网络层失败给中文兜底（不静默） */
export function historyErrorText(err: unknown): string {
  return err instanceof ApiError ? err.message : "网络请求失败，无法读取历史版本";
}

/** 恢复失败：快照在打开抽屉期间被裁剪（404）要说明并提示刷新，其余透出服务端 message */
export function restoreErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "SNAPSHOT_NOT_FOUND") return "该版本已不存在（可能已被清理），已刷新列表";
    return err.message;
  }
  return "网络请求失败，请重试";
}