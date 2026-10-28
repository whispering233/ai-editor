// 查询类工具：网页抓取（fetch_content，DeepSeek 单供应商）
//
// 口径（docs/api/tool-calling.md「外部检索（自动）」的 fetch_content 段）：
// - **只在摘要不够时打开原文**：一次调用 = 一次上游请求（按次计费），**无缓存、无续读工具**
// - 工具层职责：注入检查（port 未注入即抛错，不静默返回空）、URL 校验、结果原样返回
//   （正文长度交给运行时按单条预算截断——工具层不裁剪，否则「数据不完整」的告知会失效）
// - 网络与凭据**都不在这里**：`FetchPagePort` 由 server 注入（`packages/server/src/fetch.ts`）
// - 只读：不写库、不落盘、与正文 / 参考资料没有任何写入关系

import type { ToolContext } from "../context.js";
import { MAX_FETCH_URL_CHARS, type FetchContentArgs, type FetchedPage } from "../schemas/index.js";

/**
 * 打开一个网页，返回上游提取的正文。
 * @throws Error 未注入抓取通道 / URL 非法（无法解析、非 http(s)、含账号密码、过长）/ 上游失败
 */
export async function runFetchContent(
  ctx: ToolContext,
  args: FetchContentArgs,
  signal?: AbortSignal,
): Promise<FetchedPage> {
  const port = ctx.fetchPage;
  if (port === undefined) {
    throw new Error("网页抓取未启用：服务端未注入 fetch_content 通道（工具层不做网络与凭据）");
  }
  const url = args.url.trim();
  if (url === "") {
    throw new Error("URL 不能为空");
  }
  if (url.length > MAX_FETCH_URL_CHARS) {
    throw new Error(`URL 过长：上限 ${MAX_FETCH_URL_CHARS} 字符`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL 无法解析（需要完整地址，如 https://example.com/a）：${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`仅支持 http/https 链接（当前协议 ${parsed.protocol.replace(":", "")}）：${url}`);
  }
  // 账号密码会随请求发往上游并可能进日志——直接拒绝，不尝试剥离后继续
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("URL 不得包含账号密码：请去掉 user:pass@ 部分后重试");
  }
  return port.fetchPage({ url }, signal);
}
