// 联网搜索凭据（`~/.ai-editor/search.json`）的单字段文本口径（纯函数，可测）
//
// 服务端对这份文件 strict 校验（shared `searchConfigFileSchema`：只认 `{ apiKey?: string }`），
// 客户端只做两件事：把文件读成表单里的一个值、把表单一值写回整份文本。
// 未知键在读取时不影响（拷出 apiKey 而已）；表单保存只写回 `apiKey`（`composeSearchConfigText`）——
// 文件里若另有未知键会被丢弃（strict 契约本就不接受未知键）；需要保留手写内容请用下方 JSON 编辑器。
// 契约见 docs/ui/DESIGN.md `tab-advanced` → `search-key`。
export type SearchKeyParseResult = { ok: true; apiKey: string } | { ok: false; reason: string };

/** 文件文本 → 当前 key。空文本 / 缺 `apiKey` 都算「未配置」（空串） */
export function parseSearchKey(text: string): SearchKeyParseResult {
  if (text.trim() === "") return { ok: true, apiKey: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `不是合法 JSON（${err instanceof Error ? err.message : "解析失败"}）` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "顶层必须是 JSON 对象" };
  }
  const apiKey = (parsed as { apiKey?: unknown }).apiKey;
  if (apiKey === undefined) return { ok: true, apiKey: "" };
  if (typeof apiKey !== "string") return { ok: false, reason: "apiKey 必须是字符串" };
  return { ok: true, apiKey };
}

/** 表单值 → 整份文件文本（`apiKey` 去首尾空白；空串 = 未配置 / 清空） */
export function composeSearchConfigText(apiKey: string): string {
  return JSON.stringify({ apiKey: apiKey.trim() }, null, 2);
}