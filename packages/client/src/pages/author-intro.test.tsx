// 作家介绍页（`#/author`）SSR 走查（卡 6）：仓内无 jsdom/@testing-library（既有纪律：不引新依赖），
// 用 `react-dom/server` 直渲染。契约依据 = `docs/ui/DESIGN.md` §作家文风练习区「作家介绍」
//（页头常驻模板 + `card` 面 markdown 只读）+ `docs/design/60-practice.md` §3（素材 = shared 常量，无端点）。
//
// 覆盖：卡片面渲染作家名与介绍 markdown；页头常驻模板；作家未解析 → 空态（不崩、不空白）。
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AUTHOR_CATALOG, AUTHOR_IDS, resolveAuthor } from "@whispering233/ai-editor-shared";
import { AUTHOR_MISSING_HINT } from "../lib/workspace";
import AuthorIntro, { AuthorIntroBody } from "./AuthorIntro";

// x-markdown 的 CJS lib 包内 require css，vitest node 直跑会 SyntaxError——
// mock 为纯文本渲染（同 `components/chat/chat-panel.test.tsx` 先例）
vi.mock("@ant-design/x-markdown", () => ({
  default: ({ children }: { children?: string }) => children ?? null,
}));

const AUTHOR = resolveAuthor(AUTHOR_IDS[0]);
if (AUTHOR === null) throw new Error("预置作家清单为空：介绍页无可渲染素材");

/** SSR 会在相邻文本节点之间插 `<!-- -->`——断言前归一掉（同 pages/practice.test.tsx 惯例） */
function renderHtml(node: ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

describe("作家介绍卡片（介绍 markdown 只读）", () => {
  it("渲染作家名与完整介绍文本（数据 = shared 常量，无端点）", () => {
    const html = renderHtml(<AuthorIntroBody author={AUTHOR} />);
    expect(html).toContain(AUTHOR.name);
    expect(html).toContain(AUTHOR.intro);
  });

  it("不给编辑入口（只读素材：无 `textarea` / 无任何按钮）", () => {
    const html = renderHtml(<AuthorIntroBody author={AUTHOR} />);
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<button");
  });

  it("作家未解析（存量工作区缺 author_id / 未知 id）→ 空态（不崩、不空白）", () => {
    const html = renderHtml(<AuthorIntroBody author={null} />);
    expect(html).toContain(AUTHOR_MISSING_HINT);
    expect(html).not.toContain(AUTHOR_CATALOG[AUTHOR_IDS[0]].intro);
  });
});

describe("页面骨架（容器）", () => {
  it("页头常驻模板：section 全高 + 内容进内层可滚容器 + 页头标题「作家介绍」", () => {
    const html = renderHtml(<AuthorIntro />);
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
    expect(html).toContain("作家介绍");
  });

  it("store 未打开练习工作区（SSR 初始态）→ 直接给空态，不渲染任何作家素材", () => {
    const html = renderHtml(<AuthorIntro />);
    expect(html).toContain(AUTHOR_MISSING_HINT);
  });
});
