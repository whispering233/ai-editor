// 工具参数 schema：网页抓取（fetch_content）
//
// 契约见 docs/api/tool-calling.md「外部检索（自动）」的 fetch_content 段：
// **只在摘要不够时打开原文**（先 web_search，再决定抓哪一条）；一次调用 = 一次上游请求，
// 无缓存、无续读工具——长页超出单条工具结果预算时由运行时截断并显式告知。
//
// URL 长度上限只在本文件定义：schema 与工具描述（`../index.ts`）都从这里插值，
// 散文与注释只引常量名、不复述数字（docs/…「数值单源」）。

import { Type, type Static } from "@earendil-works/pi-ai";

/** 抓取 URL 长度上限（字符）——真实网页 URL 远短于此，更长的一律按非法参数拒绝 */
export const MAX_FETCH_URL_CHARS = 8192;

/** fetch_content 入参：url（待打开的网页地址，非空且不超 `MAX_FETCH_URL_CHARS`） */
export const fetchContentArgsSchema = Type.Object(
  { url: Type.String({ minLength: 1, maxLength: MAX_FETCH_URL_CHARS }) },
  { additionalProperties: false },
);

export type FetchContentArgs = Static<typeof fetchContentArgsSchema>;

/**
 * 一次抓取的结果：`content` = 上游提取的 Markdown 正文（正文长度交给运行时截断，
 * 工具层不裁剪——裁剪会把「数据不完整」的告知权从运行时抢走）。
 */
export interface FetchedPage {
  title: string;
  url: string;
  content: string;
}

/**
 * 抓取通道：**由 server 注入**（`packages/server/src/fetch.ts` 实现 DeepSeek 调用）。
 * tools 包不做网络请求、不读凭据——工具层只负责参数校验与投影。
 */
export interface FetchPagePort {
  fetchPage(input: { url: string }, signal?: AbortSignal): Promise<FetchedPage>;
}
