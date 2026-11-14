// @whispering233/ai-editor-server 服务端本地日键（码字日统计口径，2026-11）
//
// `stat_date` / `writing-stats` 响应的 `today` 一律是**服务端本地日** `YYYY-MM-DD`
// （docs/api/130-api-writing-stats.md「日期」）。**禁止 `toISOString().slice(0, 10)`**：
// 那是 UTC 日期，本地时间跨午夜前后会落到错误的一天（非 UTC 时区下整段偏移）。
// **写侧与读侧共用本函数**——唯一一处日键生成。

/** 服务端本地日 `YYYY-MM-DD`（本地时区；月/日补零） */
export function localDateKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}