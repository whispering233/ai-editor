// 联网来源卡片渲染走查（DESIGN.md `chat-source-cards`）：SSR `renderToString`（仓库无 jsdom，
// 同 chat-panel.test.tsx 口径）。覆盖：搜索多卡顺序 / 缺字段省略 / 抓取卡域名与字数 /
// 非法 JSON 与形状不符返回 null（回退普通工具行）。ToolCallRow 集成断言在 chat-panel.test.tsx
// （那边已 mock x-markdown 与 api，本文件不扯进 ChatPanel 的依赖）。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { parseSourceCards, SourceCards } from "./source-cards";

const searchResult = JSON.stringify([
  {
    title: "第一条命中",
    url: "https://www.example.com/a",
    summary: "第一条摘要",
    date: "2026-09-30",
    authority: "high",
  },
  { title: "第二条命中", url: "https://news.example.org/b", date: "2026-10-01" },
]);

describe("SourceCards 搜索卡", () => {
  it("多卡按工具返回顺序渲染，整卡新窗口外链，域名去 www.，日期只留 YYYY-MM-DD", () => {
    const html = renderToString(<SourceCards toolName="web_search" result={searchResult} />);
    // 顺序 = 命中顺序
    expect(html.indexOf("第一条命中")).toBeLessThan(html.indexOf("第二条命中"));
    expect(html).toContain('href="https://www.example.com/a"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    // 限行不能与 `block` 同用（`block` 会盖掉 line-clamp 的 display:-webkit-box，实测丢限行）
    expect(html).not.toContain("line-clamp-2 block");
    expect(html).not.toContain("line-clamp-1 block");
    // 域名去 www. + 日期截到日
    expect(html).toContain("example.com · 2026-09-30");
    expect(html).toContain("第一条摘要");
    // 不显示权威性分数
    expect(html).not.toContain("authority");
    expect(html).not.toContain("high");
  });

  it("缺字段省略：无摘要不渲染摘要行、无日期只留域名、无标题回落到域名", () => {
    const html = renderToString(<SourceCards toolName="web_search" result={searchResult} />);
    expect(html).not.toContain("undefined");
    expect(html).toContain("news.example.org · 2026-10-01");
    const noTitle = renderToString(
      <SourceCards toolName="web_search" result={JSON.stringify([{ url: "https://a.test/x" }])} />,
    );
    expect(noTitle).toContain("a.test");
    expect(noTitle).not.toContain(" · "); // 无日期 → meta 只有域名
  });

  it("无合法 url 的命中被丢弃；全部丢弃 → null（不渲染空壳）", () => {
    const html = renderToString(
      <SourceCards
        toolName="web_search"
        result={JSON.stringify([
          { title: "无链接", summary: "x" },
          { url: "javascript:alert(1)", title: "坏协议" },
        ])}
      />,
    );
    expect(html).toBe("");
  });
});

describe("SourceCards 抓取卡", () => {
  it("已读取：{标题} → 域名 · 字数（千分位）", () => {
    const content = "正".repeat(12345);
    const html = renderToString(
      <SourceCards
        toolName="fetch_content"
        result={JSON.stringify({ title: "长文标题", url: "https://www.blog.test/post", content })}
      />,
    );
    expect(html).toContain("已读取：长文标题");
    expect(html).toContain("blog.test · 12,345 字");
    expect(html).toContain('href="https://www.blog.test/post"');
  });
});

describe("SourceCards 回退（解析失败 / 形状不符）", () => {
  it("非法 JSON → null", () => {
    expect(parseSourceCards("web_search", '[{"title":"截断了')).toBeNull();
    expect(parseSourceCards("web_search", "")).toBeNull();
    expect(renderToString(<SourceCards toolName="web_search" result='{"title":"x"' />)).toBe("");
  });

  it("形状不符 / 空数组 → null", () => {
    expect(parseSourceCards("web_search", JSON.stringify({ hits: [] }))).toBeNull();
    expect(parseSourceCards("web_search", "[]")).toBeNull();
    expect(parseSourceCards("fetch_content", JSON.stringify([{ title: "数组" }]))).toBeNull();
    expect(parseSourceCards("fetch_content", JSON.stringify({ url: "https://a.test" }))).toBeNull();
    expect(parseSourceCards("fetch_content", "null")).toBeNull();
  });

  it("非来源工具 / 非文本结果 → null（其他工具行零影响）", () => {
    expect(parseSourceCards("get_entity", searchResult)).toBeNull();
    expect(parseSourceCards("web_search", undefined)).toBeNull();
    expect(parseSourceCards("web_search", { title: "对象" })).toBeNull();
  });
});
