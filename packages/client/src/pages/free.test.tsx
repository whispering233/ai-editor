// 自由练习列表页（`#/free`，卡 5）渲染走查：仓内无 jsdom/@testing-library（既有纪律：不引新依赖），
// 用 `react-dom/server` 直渲染。契约依据 = `docs/ui/DESIGN.md` §作家文风练习区「自由练习列表」
// + §Layout「中栏页头结构」（页头常驻模板）、`docs/api/120-api-practice.md`「自由练习」（列表项字段）。
//
// 覆盖：
// - 页头常驻模板（`section` 全高 + 内容进内层可滚容器）+ 页头右端组 `[+ 新建题目]` `[让 AI 出题]`
// - 平铺 `data-row`：题目（`truncate`；空题 = 「（待出题）」灰字、不占 tooltip）+ 四态徽标 + 相对时间
// - 空态 = 「还没有练习篇——新建题目，或让 AI 出一题」；首帧 = 骨架（不误报「还没有」）
// - 用户侧文案口径：不出现接口侧词（`60-practice.md` §4）
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PracticePieceSummary } from "@whispering233/ai-editor-shared";
import Free, { FreeList, FreePieceRow } from "./Free";

/** 相对时间断言用（5 分钟前不会跨档：断言时距 < 6 分钟） */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * SSR 会在相邻文本节点之间插 `<!-- -->`——断言前归一掉，避免把「同一句被拆成两段」误判成缺失
 * （同 `pages/practice.test.tsx` 惯例）。
 */
function renderHtml(node: ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

function makePiece(overrides: Partial<PracticePieceSummary> = {}): PracticePieceSummary {
  return {
    id: "pf-1",
    topic: "写一段雨夜的告别",
    brief: "",
    topicSource: "user",
    charCount: 0,
    hasDraft: false,
    hasFeedback: false,
    createdAt: minutesAgo(10),
    updatedAt: minutesAgo(5),
    ...overrides,
  };
}

describe("自由练习列表页容器（#/free）", () => {
  it("页头常驻模板：section 全高 + 内容进内层可滚容器", () => {
    const html = renderHtml(<Free />);
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
  });

  it("页头右端组 = [+ 新建题目] [让 AI 出题]", () => {
    const html = renderHtml(<Free />);
    expect(html).toContain("自由练习");
    expect(html).toContain("新建题目");
    expect(html).toContain("让 AI 出题");
  });

  it("首帧 = 骨架而非空态（空态只在真拿到空列表后出现，避免加载中误报「还没有」）", () => {
    const html = renderHtml(<Free />);
    expect(html).not.toContain("还没有练习篇");
  });
});

describe("列表主体（加载 / 空态 / 平铺行）", () => {
  it("空态：一行引导文案（指向页头的两个入口）", () => {
    const html = renderHtml(<FreeList pieces={[]} />);
    expect(html).toContain("还没有练习篇——新建题目，或让 AI 出一题");
  });

  it("加载中（null）→ 骨架，不给空态文案", () => {
    const html = renderHtml(<FreeList pieces={null} />);
    expect(html).not.toContain("还没有练习篇");
  });

  it("平铺：每篇一行（不分组、无标题行）", () => {
    const html = renderHtml(<FreeList pieces={[makePiece(), makePiece({ id: "pf-2" })]} />);
    expect(html.match(/href="#\/free\//g)).toHaveLength(2);
  });
});

describe("题目行（data-row：题目 + 四态徽标 + 相对时间）", () => {
  it("四态映射：待出题 / 待写稿 / 待点评 / 已点评（同一行只挂一枚徽标）", () => {
    const cases = [
      [{ topic: "", hasDraft: false, hasFeedback: false }, "待出题"],
      [{ topic: "题目", hasDraft: false, hasFeedback: false }, "待写稿"],
      [{ topic: "题目", hasDraft: true, hasFeedback: false }, "待点评"],
      [{ topic: "题目", hasDraft: true, hasFeedback: true }, "已点评"],
    ] as const;
    for (const [flags, label] of cases) {
      const html = renderHtml(<FreePieceRow piece={makePiece(flags)} />);
      expect(html, label).toContain(label);
      // 同一行只挂一枚状态徽标（四态互斥，不并列）
      expect(html.match(/border-type-badge-border/g)).toHaveLength(1);
    }
  });

  it("行 = 题目（truncate）+ type-badge 徽标 + 相对时间（shared formatRelativeTime）", () => {
    const html = renderHtml(<FreePieceRow piece={makePiece()} />);
    expect(html).toContain("写一段雨夜的告别");
    expect(html).toContain("truncate");
    expect(html).toContain("border-type-badge-border"); // type-badge 形态（TypeChip）
    expect(html).toContain("5 分钟前");
    // 用户侧文案口径：行里不得泄出接口侧字段名（此处才真能渲染出行）
    expect(html).not.toContain("topic_source");
    expect(html).not.toContain("topicSource");
  });

  it("空题 → 「（待出题）」灰字、不给 tooltip；时间与徽标照常在位", () => {
    const html = renderHtml(<FreePieceRow piece={makePiece({ topic: "  " })} />);
    expect(html).toContain("（待出题）");
    expect(html).toContain("text-muted-foreground");
    expect(html).not.toContain("title=");
    expect(html).toContain("5 分钟前");
  });

  it("整行 = 进该篇详情的链接（`#/free/:pieceId`）", () => {
    const html = renderHtml(<FreePieceRow piece={makePiece({ id: "pf-7" })} />);
    expect(html).toContain('<a href="#/free/pf-7"');
    expect(html).toContain("hover:bg-muted"); // data-row 行 hover（surface-soft）
  });
});
