// 作品介绍页（`#/works`）SSR 走查（卡 6）：仓内无 jsdom/@testing-library，用 `react-dom/server` 直渲染。
// 契约依据 = `docs/ui/DESIGN.md` §作家文风练习区「作品介绍」（每部作品一个 `card`：作品名 `section-title`
// + 介绍 markdown；**无编辑入口、无「新建作品」**）+ `docs/design/60-practice.md` §3（作品清单是封闭集合）。
//
// 覆盖：每部预置作品各一张卡（名字 + 介绍齐备，顺序 = 清单顺序）；页头常驻模板；
// 无编辑 / 新建入口；作家未解析 → 空态。
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AUTHOR_IDS, resolveAuthor } from "@whispering233/ai-editor-shared";
import { AUTHOR_MISSING_HINT } from "../lib/workspace";
import Works, { WorksBody } from "./Works";

// x-markdown 的 CJS lib 包内 require css，vitest node 直跑会 SyntaxError——mock 为纯文本渲染
vi.mock("@ant-design/x-markdown", () => ({
  default: ({ children }: { children?: string }) => children ?? null,
}));

const AUTHOR = resolveAuthor(AUTHOR_IDS[0]);
if (AUTHOR === null) throw new Error("预置作家清单为空：作品介绍页无可渲染素材");

/** SSR 会在相邻文本节点之间插 `<!-- -->`——断言前归一掉 */
function renderHtml(node: ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

describe("作品卡列表（每部作品一张卡）", () => {
  it("每部预置作品的名字与介绍都在渲染结果里", () => {
    const html = renderHtml(<WorksBody author={AUTHOR} />);
    for (const work of AUTHOR.works) {
      expect(html, work.id).toContain(work.name);
      expect(html, work.id).toContain(work.intro);
    }
  });

  it("卡片顺序 = 预置清单顺序（不重排，不按名字排序）", () => {
    const html = renderHtml(<WorksBody author={AUTHOR} />);
    const positions = AUTHOR.works.map((work) => html.indexOf(work.name));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((index) => index > 0)).toBe(true);
  });

  it("无编辑入口、无「新建作品」（作品清单是封闭集合）", () => {
    const html = renderHtml(<WorksBody author={AUTHOR} />);
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<button");
  });

  it("作家未解析（存量工作区缺 author_id / 未知 id）→ 空态", () => {
    const html = renderHtml(<WorksBody author={null} />);
    expect(html).toContain(AUTHOR_MISSING_HINT);
    expect(html).not.toContain(AUTHOR.works[0].intro);
  });
});

describe("页面骨架（容器）", () => {
  it("页头常驻模板 + 页头标题「作品介绍」", () => {
    const html = renderHtml(<Works />);
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
    expect(html).toContain("作品介绍");
  });

  it("store 未打开练习工作区（SSR 初始态）→ 空态", () => {
    expect(renderHtml(<Works />)).toContain(AUTHOR_MISSING_HINT);
  });
});
