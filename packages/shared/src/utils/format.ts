// 文本格式化工具（纯函数，零 Node 依赖——client 浏览器打包安全）
// 契约来源：doc/api/endpoints.md（会话列表 lastMessage「截断」、settings apiKeyMasked 掩码示例）

/**
 * ISO 8601 时间戳 → 本地化 `YYYY-MM-DD HH:mm`（schema.md 时间约定：统一 ISO 8601 字符串）
 * 非法输入（含空串）原样返回，防御性处理
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 截断文本：返回总长（含省略号）不超过 maxLen 的字符串；未超长原样返回
 * 用途：会话列表 lastMessage、长文本展示（endpoints.md）
 * 边界：maxLen <= 0 返回空串；maxLen = 1 时返回单个省略号
 */
export function truncate(text: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

/**
 * API key 掩码展示（endpoints.md settings apiKeyMasked 示例 `sk-****1234`：保留前 3 后 4）
 * 过短 key（<= 7 字符，前后缀重叠）整体掩码为 "****"；空串返回 "****"
 */
export function maskApiKey(key: string): string {
  if (key.length <= 7) return "****";
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}
