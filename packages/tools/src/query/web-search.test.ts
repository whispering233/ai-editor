// 查询类工具测试：外部检索（web_search）工具层职责
// 覆盖：投影（空字段省略 / summary 回落 snippet / 顺序不变）、count 缺省填充与显式透传、
// 摘要异常上限（仅超 `MAX_SEARCH_SUMMARY_CHARS` 才截断且标 `truncated`，正常摘要原样）、
// query 传给 port 前 trim / 未注入 port 报错 / query 纯空白报错。**零网络**：port 是注入的 fake。
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../context.js";
import {
  DEFAULT_SEARCH_RESULT_COUNT,
  MAX_SEARCH_RESULT_COUNT,
  MAX_SEARCH_SUMMARY_CHARS,
  type WebSearchHit,
  type WebSearchPort,
} from "../schemas/index.js";
import { runWebSearch } from "./web-search.js";

/** 只带 webSearch 的上下文（本工具不碰 db/outlineDir/projectId） */
function contextWith(port?: WebSearchPort): ToolContext {
  return {
    db: {} as ToolContext["db"],
    outlineDir: "/tmp/nowhere",
    projectId: "proj-test",
    ...(port === undefined ? {} : { webSearch: port }),
  };
}

/** fake port：记录入参，返回固定命中 */
function fakePort(hits: WebSearchHit[]): WebSearchPort & { calls: { query: string; count: number }[] } {
  const calls: { query: string; count: number }[] = [];
  return {
    calls,
    async search(input) {
      calls.push(input);
      return hits;
    },
  };
}

describe("runWebSearch", () => {
  it("投影：空字段省略、summary 回落 snippet、保持上游顺序", async () => {
    const port = fakePort([
      { title: "A", url: "https://a.example", summary: "摘要 A", date: "2026-09-01", authority: "高" },
      { title: "B", url: "https://b.example", snippet: "片段 B", date: "  ", authority: "" },
      { title: "C", url: "https://c.example", summary: "", snippet: "" },
    ]);
    const hits = await runWebSearch(contextWith(port), { query: "红楼梦 版本" });

    expect(hits.map((hit) => hit.url)).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
    ]);
    expect(hits[0]).toEqual({ title: "A", url: "https://a.example", summary: "摘要 A", date: "2026-09-01", authority: "高" });
    // snippet 回落到 summary，且 snippet 自身不出现在结果里（只作回落源）
    expect(hits[1]).toEqual({ title: "B", url: "https://b.example", summary: "片段 B" });
    // summary/snippet 都为空 ⇒ 整键省略
    expect(hits[2]).toEqual({ title: "C", url: "https://c.example" });
    expect(Object.keys(hits[2])).toEqual(["title", "url"]);
  });

  it("count 缺省用 DEFAULT_SEARCH_RESULT_COUNT，显式传入则原样透传；query 先 trim", async () => {
    const port = fakePort([]);
    await runWebSearch(contextWith(port), { query: "  site:nature.com 气候  " });
    await runWebSearch(contextWith(port), { query: "气候", count: MAX_SEARCH_RESULT_COUNT });
    expect(port.calls).toEqual([
      { query: "site:nature.com 气候", count: DEFAULT_SEARCH_RESULT_COUNT },
      { query: "气候", count: MAX_SEARCH_RESULT_COUNT },
    ]);
  });

  it("正常长度摘要原样返回、不带 truncated（1,500 字符在异常上限以内）", async () => {
    const summary = "字".repeat(1500);
    const hits = await runWebSearch(contextWith(fakePort([{ title: "长文", url: "https://a.example", summary }])), {
      query: "任意",
    });
    expect(hits[0]!.summary).toBe(summary);
    expect(Object.keys(hits[0]!)).toEqual(["title", "url", "summary"]);
  });

  it("恰好等于上限的摘要原样返回、不带 truncated（边界）", async () => {
    const summary = "字".repeat(MAX_SEARCH_SUMMARY_CHARS);
    const hits = await runWebSearch(contextWith(fakePort([{ title: "边界", url: "https://a.example", summary }])), {
      query: "任意",
    });
    expect(hits[0]!.summary).toBe(summary);
    expect(hits[0]!.truncated).toBeUndefined();
  });

  it("阈值与实测上下文预算绑定（改值须重测）", () => {
    // 默认 5 条约 7,500 字符；10 条为硬上限；单条 2,000 仅异常保护。
    // 这些数字来自真实检索样本的上下文预算，不是随手值。
    expect([DEFAULT_SEARCH_RESULT_COUNT, MAX_SEARCH_RESULT_COUNT, MAX_SEARCH_SUMMARY_CHARS]).toEqual([5, 10, 2000]);
  });

  it("超长摘要（summary / snippet 回落 / content 回落）截断到上限并标 truncated", async () => {
    const tooLong = (n: number) => "字".repeat(n);
    const hits = await runWebSearch(
      contextWith(
        fakePort([
          { title: "A", url: "https://a.example", summary: tooLong(MAX_SEARCH_SUMMARY_CHARS + 1) },
          { title: "B", url: "https://b.example", snippet: tooLong(5000) },
          // content 回落由 server 的 toHit 完成（packages/server/src/web-search.ts）：上游超长 content
          // 进工具层时已经是 summary，这里用同样的超长 summary 形状验证
          { title: "C", url: "https://c.example", summary: tooLong(20_000), date: "2026-09-01" },
        ]),
      ),
      { query: "任意" },
    );
    for (const hit of hits) {
      expect(hit.summary!.length).toBeLessThanOrEqual(MAX_SEARCH_SUMMARY_CHARS);
      expect(hit.summary!.endsWith("…")).toBe(true);
      expect(hit.truncated).toBe(true);
    }
    // 截断不动其它字段与顺序
    expect(hits.map((hit) => hit.url)).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
    ]);
    expect(hits[2]!.date).toBe("2026-09-01");
  });

  it("未注入 port 抛可读错误（不静默返回空数组）", async () => {
    await expect(runWebSearch(contextWith(), { query: "任意" })).rejects.toThrow(/未启用/);
  });

  it("query 纯空白抛错且不调用 port", async () => {
    const port = fakePort([]);
    await expect(runWebSearch(contextWith(port), { query: "   " })).rejects.toThrow(/不能为空/);
    expect(port.calls).toEqual([]);
  });

  it("port 抛错原样上抛（错误文案由 server 映射）", async () => {
    const search = vi.fn(async () => {
      throw new Error("联网检索失败（HTTP 500）");
    });
    await expect(runWebSearch(contextWith({ search }), { query: "任意" })).rejects.toThrow(/HTTP 500/);
  });
});
