// 查询类工具：外部检索（web_search，DeepSeek 单供应商）
//
// 口径（docs/api/tool-calling.md「外部检索（自动）」）：
// - **只做检索**：`need_content` 恒 false（只回摘要，正文是否打开由用户决定），不落盘缓存
// - 工具层职责只有三件：注入检查（port 未注入即抛错，不静默返回空）、query 空白校验、
//   结果投影（**空字段省略** + `summary` 为空回落 `snippet`，**不改顺序**——顺序是上游相关性序）
// - 网络与凭据**都不在这里**：`WebSearchPort` 由 server 注入（`packages/server/src/web-search.ts`）
// - 每次成功请求按次计费，但这笔费用**不进会话 token 账目**（那里只有模型用量）

import type { ToolContext } from "../context.js";
import {
  DEFAULT_SEARCH_RESULT_COUNT,
  type WebSearchArgs,
  type WebSearchHit,
} from "../schemas/index.js";

/** 非空字符串（纯空白按空处理：空串落进结果只会让模型引用不存在的值） */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

/** 单条命中投影：title/url 必留；summary 回落 snippet；其余字段为空即省略 */
function projectHit(hit: WebSearchHit): WebSearchHit {
  const projected: WebSearchHit = { title: hit.title, url: hit.url };
  const summary = nonEmpty(hit.summary) ?? nonEmpty(hit.snippet);
  if (summary !== undefined) projected.summary = summary;
  const date = nonEmpty(hit.date);
  if (date !== undefined) projected.date = date;
  const authority = nonEmpty(hit.authority);
  if (authority !== undefined) projected.authority = authority;
  return projected;
}

/**
 * 检索外部网页，返回可引用的摘要列表（保持上游顺序）。
 * @throws Error 未注入检索通道 / query 为空白 / 上游失败（server 侧映射为可读文案）
 */
export async function runWebSearch(
  ctx: ToolContext,
  args: WebSearchArgs,
  signal?: AbortSignal,
): Promise<WebSearchHit[]> {
  const port = ctx.webSearch;
  if (port === undefined) {
    throw new Error("联网检索未启用：服务端未注入 web_search 通道（工具层不做网络与凭据）");
  }
  const query = args.query.trim();
  if (query === "") {
    throw new Error("检索语句不能为空：query 全为空白");
  }
  const hits = await port.search({ query, count: args.count ?? DEFAULT_SEARCH_RESULT_COUNT }, signal);
  return hits.map(projectHit);
}
