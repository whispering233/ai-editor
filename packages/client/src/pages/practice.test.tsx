// 文风练习列表页（`#/practice`，卡 4 改版）渲染走查：仓内无 jsdom/@testing-library（既有纪律：不引新依赖），
// 用 `react-dom/server` 直渲染。契约依据 = `docs/ui/DESIGN.md` §作家文风练习区「文风练习列表」
// + §Layout「中栏页头结构」（页头常驻模板）、`docs/api/120-api-practice.md`「范文样本」（列表项字段）。
//
// 覆盖（对应卡 4）：
// - 按作品分组：组标题 = 作品名 +「N 篇范文」；分组顺序 = 预置作品清单顺序 + 末尾「其他」；无样本的组不渲染
//   （顺序与兜底由 `lib/practice.test.ts` 的 `practiceSampleGroups` 钉住，这里钉 DOM 形态）
// - 组内 `[+ 新建样本]`（预选该组作品）+ 页头右端组 `[+ 新建样本]`（默认「其他」）
// - 样本行 = 片段说明（`truncate`；空着不占文本）+ 状态徽标 + 相对时间
// - 空态 = 「还没有范文——点「新建样本」导入或粘贴一段」（不再有「新建目标」入口与目标分组）
// - 页头常驻模板（`section` 全高 + 内容进内层可滚容器）
// - 用户侧文案口径：不出现「画像 / 维度 / scope」这类设计侧词（`60-practice.md` §文案口径）
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AUTHOR_CATALOG, PRACTICE_OTHER_WORK_LABEL } from "@whispering233/ai-editor-shared";
import type { PracticeSampleSummary } from "@whispering233/ai-editor-shared";
import Practice, { PracticeList, PracticeSampleRow } from "./Practice";
import { practiceSampleGroups, type PracticeSampleGroup } from "../lib/practice";

const JIANGNAN = AUTHOR_CATALOG.jiangnan;

/** 相对时间断言用（5 分钟前不会跨档：断言时距 < 6 分钟） */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * SSR 会在相邻文本节点之间插 `<!-- -->`（`2` 与 ` 篇范文` 是两个节点）——
 * 断言前归一掉，避免把「同一句被拆成两段」误判成缺失（同 chat-panel.test.tsx 惯例）。
 */
function renderHtml(node: ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

function makeSample(overrides: Partial<PracticeSampleSummary> = {}): PracticeSampleSummary {
  return {
    id: "ps-1",
    workId: JIANGNAN.works[0].id,
    excerptLabel: "开头一段",
    charCount: 120,
    hasDraft: false,
    hasFeedback: false,
    createdAt: minutesAgo(10),
    updatedAt: minutesAgo(5),
    ...overrides,
  };
}

/** 单组列表（组 = 预置首部作品 + 一条样本） */
function oneGroup(samples = [makeSample()]): PracticeSampleGroup[] {
  return practiceSampleGroups(JIANGNAN, samples);
}

const noop = (): void => {};

describe("练习列表页容器（#/practice）", () => {
  it("页头常驻模板：section 全高 + 内容进内层可滚容器", () => {
    const html = renderHtml(<Practice />);
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
  });

  it("页头 = 文风练习 + 右端组「新建样本」（页面级入口；组内入口在分组行）", () => {
    const html = renderHtml(<Practice />);
    expect(html).toContain("文风练习");
    expect(html).toContain("新建样本");
    expect(html).not.toContain("新建目标"); // 旧「新建目标」入口已删（卡 4）
  });

  it("首帧 = 骨架而非空态（空态只在真拿到空列表后出现，避免加载中误报「还没有」）", () => {
    const html = renderHtml(<Practice />);
    expect(html).not.toContain("还没有范文");
  });
});

describe("列表主体（加载 / 空态 / 作品分组）", () => {
  it("空态：一行引导文案（指向页头「新建样本」；不出现设计侧词与旧入口）", () => {
    const html = renderHtml(<PracticeList groups={[]} onCreateSample={noop} />);
    expect(html).toContain("还没有范文——点「新建样本」导入或粘贴一段");
    expect(html).toContain("border-dashed"); // empty-state 基座
    expect(html).not.toContain("新建目标");
    for (const word of ["画像", "维度", "scope"]) {
      expect(html, word).not.toContain(word);
    }
  });

  it("作品分组：section-title 作品名 + caption-text「N 篇范文」+ 组内「新建样本」入口", () => {
    const html = renderHtml(
      <PracticeList
        groups={oneGroup([makeSample(), makeSample({ id: "ps-2" })])}
        onCreateSample={noop}
      />,
    );
    expect(html).toContain(JIANGNAN.works[0].name);
    expect(html).toContain("2 篇范文");
    expect(html).toContain("新建样本");
    // 「其他」组此时无样本 ⇒ 不渲染（无样本的组不渲染）
    expect(html).not.toContain(`>${PRACTICE_OTHER_WORK_LABEL}<`);
  });

  it("「其他」组：`workId = null` 与未知 workId 都归它，组标题 = 兜底文案", () => {
    const html = renderHtml(
      <PracticeList
        groups={oneGroup([makeSample({ workId: null }), makeSample({ id: "ps-2", workId: "gone" })])}
        onCreateSample={noop}
      />,
    );
    expect(html).toContain(PRACTICE_OTHER_WORK_LABEL);
    expect(html).toContain("2 篇范文");
  });

  it("加载态：groups = null → 骨架（不渲染空态文案）", () => {
    const html = renderHtml(<PracticeList groups={null} onCreateSample={noop} />);
    expect(html).not.toContain("还没有范文");
  });
});

describe("样本行（data-row：片段说明 + 状态徽标 + 相对时间）", () => {
  it("三态映射：未写稿 / 待点评 / 已点评（已点评用 mock hasFeedback: true 锁定）", () => {
    const cases = [
      [{ hasDraft: false, hasFeedback: false }, "未写稿"],
      [{ hasDraft: true, hasFeedback: false }, "待点评"],
      [{ hasDraft: true, hasFeedback: true }, "已点评"],
    ] as const;
    for (const [flags, label] of cases) {
      const html = renderHtml(<PracticeSampleRow sample={makeSample(flags)} />);
      expect(html, label).toContain(label);
      // 同一行只挂一枚状态徽标（三态互斥，不并列）
      expect(html.match(/border-type-badge-border/g)).toHaveLength(1);
    }
  });

  it("行 = 片段说明（truncate）+ type-badge 徽标 + 相对时间（shared formatRelativeTime）", () => {
    const html = renderHtml(<PracticeSampleRow sample={makeSample()} />);
    expect(html).toContain("开头一段");
    expect(html).toContain("truncate");
    expect(html).toContain("border-type-badge-border"); // type-badge 形态（TypeChip）
    expect(html).toContain("5 分钟前");
  });

  it("片段说明留空 → 该段不占文本（徽标与时间照常在位）", () => {
    const html = renderHtml(<PracticeSampleRow sample={makeSample({ excerptLabel: "" })} />);
    expect(html).not.toContain("开头一段");
    expect(html).not.toContain("title="); // 空值时也不给 tooltip
    expect(html).toContain("未写稿");
    expect(html).toContain("5 分钟前");
  });

  it("整行 = 进练习页的链接（`#/practice/:sampleId`）", () => {
    const html = renderHtml(<PracticeSampleRow sample={makeSample({ id: "ps-7" })} />);
    expect(html).toContain('<a href="#/practice/ps-7"');
    expect(html).toContain("hover:bg-muted"); // data-row 行 hover（surface-soft）
  });
});