// 工具参数 schema：外部检索（web_search）
//
// 契约见 docs/api/tool-calling.md「外部检索（自动）」：**只做检索，不做正文抓取、不落盘缓存**；
// 过滤语法直接写在 query 里（DeepSeek 支持 `site:` / `-site:` / `after:` / `lang:` / `"精确短语"`），
// 不自造 recency / domain 一类结构化字段——参数面越宽，模型越容易编出不存在的语义。
//
// 上限常量**只在本文件定义**：schema 与工具描述（`../index.ts`）都从这里插值，
// 散文与注释只引常量名、不复述数字（docs/…「数值单源」）。

import { Type, type Static } from "@earendil-works/pi-ai";

/** 检索语句长度上限（字符）——与 DeepSeek Search 接口的 query 上限同值，超出会被上游 400 */
export const MAX_SEARCH_QUERY_CHARS = 128;

/** 期望条数缺省值（模型不传 count 时用）——条数是检索上下文成本的主闸门 */
export const DEFAULT_SEARCH_RESULT_COUNT = 5;

/** 期望条数上限 */
export const MAX_SEARCH_RESULT_COUNT = 10;

/**
 * 单条摘要异常上限（字符，截断结果含省略号）：正常摘要原样保留，
 * 只兜住上游超长正文回落（server 把 `content` 折进 `summary`）造成的上下文膨胀。
 */
export const MAX_SEARCH_SUMMARY_CHARS = 2000;

/**
 * web_search 入参：query（检索语句，非空且不超 `MAX_SEARCH_QUERY_CHARS`）
 * + count（期望条数，可选，1..`MAX_SEARCH_RESULT_COUNT`，缺省 `DEFAULT_SEARCH_RESULT_COUNT`）。
 */
export const webSearchArgsSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: MAX_SEARCH_QUERY_CHARS }),
    count: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SEARCH_RESULT_COUNT })),
  },
  { additionalProperties: false },
);

export type WebSearchArgs = Static<typeof webSearchArgsSchema>;

/**
 * 一条检索命中（工具结果项，保持上游返回顺序）。
 * `summary` 为空时由 `runWebSearch` 回落到 `snippet`；`snippet` **只作回落源**，投影后不回传。
 * `truncated` 仅在摘要超过 `MAX_SEARCH_SUMMARY_CHARS` 被截断时出现（正常摘要不带）。
 * `date` / `authority` 缺省即省略（空字段不写进结果，省 token 且不诱导模型引用不存在的值）。
 */
export interface WebSearchHit {
  title: string;
  url: string;
  summary?: string;
  snippet?: string;
  truncated?: boolean;
  date?: string;
  authority?: string;
}

/** 一次检索的入参（`query` 已 trim、`count` 已填缺省——缺省填充在工具层完成） */
export interface WebSearchRequest {
  query: string;
  count: number;
}

/**
 * 检索通道：**由 server 注入**（`packages/server/src/web-search.ts` 实现 DeepSeek 调用）。
 * tools 包不做网络请求、不读凭据、不 import server——工具层只负责参数校验与结果投影。
 */
export interface WebSearchPort {
  search(input: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchHit[]>;
}
