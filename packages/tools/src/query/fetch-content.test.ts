// 查询类工具测试：网页抓取（fetch_content）工具层职责
// 覆盖：URL 校验各分支（无法解析 / 非 http(s) / 含账号密码 / 过长 / 空白）、未注入 port 报错、
// 结果原样返回（不裁剪正文）、port 抛错原样上抛。**零网络**：port 是注入的 fake。
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../context.js";
import { MAX_FETCH_URL_CHARS, type FetchedPage, type FetchPagePort } from "../schemas/index.js";
import { runFetchContent } from "./fetch-content.js";

/** 只带 fetchPage 的上下文（本工具不碰 db/outlineDir/projectId） */
function contextWith(port?: FetchPagePort): ToolContext {
  return {
    db: {} as ToolContext["db"],
    outlineDir: "/tmp/nowhere",
    projectId: "proj-test",
    ...(port === undefined ? {} : { fetchPage: port }),
  };
}

/** fake port：记录入参，返回固定页面 */
function fakePort(page: FetchedPage): FetchPagePort & { calls: { url: string }[] } {
  const calls: { url: string }[] = [];
  return {
    calls,
    async fetchPage(input) {
      calls.push(input);
      return page;
    },
  };
}

const PAGE: FetchedPage = { title: "示例页", url: "https://example.com/a", content: "# 标题\n\n正文" };

describe("runFetchContent", () => {
  it("结果原样返回（正文不裁剪：截断权归运行时，工具层不改写）", async () => {
    const port = fakePort(PAGE);
    expect(await runFetchContent(contextWith(port), { url: "https://example.com/a" })).toEqual(PAGE);
    expect(port.calls).toEqual([{ url: "https://example.com/a" }]);
  });

  it("URL 先 trim 再交给 port", async () => {
    const port = fakePort(PAGE);
    await runFetchContent(contextWith(port), { url: "  https://example.com/a  " });
    expect(port.calls).toEqual([{ url: "https://example.com/a" }]);
  });

  it("未注入 port 抛可读错误（不静默返回空正文）", async () => {
    await expect(runFetchContent(contextWith(), { url: "https://example.com/a" })).rejects.toThrow(/未启用/);
  });

  it.each([
    ["", /URL 不能为空/],
    ["   ", /URL 不能为空/],
    ["example.com/a", /URL 无法解析/], // 无协议：不做猜测补全
    ["ftp://example.com/a", /仅支持 http\/https/],
    ["file:///etc/passwd", /仅支持 http\/https/],
    ["https://user:pass@example.com/a", /不得包含账号密码/],
    ["https://user@example.com/a", /不得包含账号密码/],
  ])("非法 URL %j → 报错且不调用 port", async (url, expected) => {
    const port = fakePort(PAGE);
    await expect(runFetchContent(contextWith(port), { url })).rejects.toThrow(expected);
    expect(port.calls).toEqual([]);
  });

  it("超长 URL 报错且不调用 port（schema 之外的第二道，直接调用 run 时同样拦）", async () => {
    const port = fakePort(PAGE);
    const url = `https://example.com/${"a".repeat(MAX_FETCH_URL_CHARS)}`;
    await expect(runFetchContent(contextWith(port), { url })).rejects.toThrow(/URL 过长/);
    expect(port.calls).toEqual([]);
  });

  it("port 抛错原样上抛（错误文案由 server 映射）", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error("网页抓取被拒（HTTP 403）");
    });
    await expect(runFetchContent(contextWith({ fetchPage }), { url: "https://example.com/a" })).rejects.toThrow(
      /HTTP 403/,
    );
  });
});
