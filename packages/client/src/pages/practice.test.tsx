// 文风练习列表页（`#/practice`，卡 9）渲染走查：仓内无 jsdom/@testing-library（既有纪律：不引新依赖），
// 用 `react-dom/server` 直渲染。契约依据 = `docs/ui/DESIGN.md` §文风练习区「练习列表页」
// + §Layout「中栏页头结构」（页头常驻模板）、`docs/api/120-api-practice.md`（列表项字段）。
//
// 覆盖（对应卡 9 硬完成判据）：
// - 判据 1：空态文案可见 + 空态的「新建目标」主操作在位（真实点击走浏览器走查——ui-verifier）
// - 判据 2：目标分组出现；「我的观察」留空时**不渲染**观察行
// - 判据 3：样本行三态徽标映射（含 `hasFeedback: true` 的「已点评」——写点评只能经 AI 工具，
//   浏览器路径覆盖不到，故在此以 mock 数据锁定）+ 来源说明 + 相对时间
// - 判据 4：页头常驻模板（`section` 全高 + 内容进内层可滚容器）
// - 用户侧文案口径：不出现「画像 / 维度 / scope」这类设计侧词（`60-practice.md` §文案口径）
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PracticeSampleItem, PracticeTargetItem } from "@whispering233/ai-editor-shared";
import Practice, { PracticeList, PracticeSampleRow } from "./Practice";

/** 相对时间断言用（5 分钟前不会跨档：断言时距 < 6 分钟） */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * SSR 会在相邻文本节点之间插 `<!-- -->`（`2` 与 ` 篇范文`、`我的观察：` 与值都是两个节点）——
 * 断言前归一掉，避免把「同一句被拆成两段」误判成缺失（同 chat-panel.test.tsx 惯例）。
 */
function renderHtml(node: ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

function makeSample(overrides: Partial<PracticeSampleItem> = {}): PracticeSampleItem {
  return {
    id: "ps-1",
    sourceKind: "paste",
    sourceLabel: "汪曾祺《受戒》节选",
    charCount: 120,
    hasDraft: false,
    hasFeedback: false,
    createdAt: minutesAgo(10),
    updatedAt: minutesAgo(5),
    ...overrides,
  };
}

function makeTarget(overrides: Partial<PracticeTargetItem> = {}): PracticeTargetItem {
  return {
    id: "pt-1",
    name: "汪曾祺的克制冷叙述",
    observation: null,
    sampleCount: 1,
    createdAt: minutesAgo(30),
    updatedAt: minutesAgo(30),
    ...overrides,
  };
}

const noop = (): void => {};

describe("练习列表页容器（#/practice）", () => {
  it("页头常驻模板：section 全高 + 内容进内层可滚容器（判据 4）", () => {
    const html = renderHtml(<Practice />);
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
  });

  it("页头 = 文风练习 + 右端组「新建目标」（页面级入口；目标内「新建样本」在分组行）", () => {
    const html = renderHtml(<Practice />);
    expect(html).toContain("文风练习");
    expect(html).toContain("新建目标");
  });

  it("首帧 = 骨架而非空态（空态只在真拿到空列表后出现，避免加载中误报「还没有」）", () => {
    const html = renderHtml(<Practice />);
    expect(html).not.toContain("还没有文风目标");
  });
});

describe("列表主体（加载 / 空态 / 目标分组）", () => {
  it("空态：一行引导文案 + 主操作「新建目标」（判据 1；不出现设计侧词）", () => {
    const html = renderHtml(<PracticeList groups={[]} onCreateTarget={noop} onCreateSample={noop} />);
    expect(html).toContain("还没有文风目标");
    expect(html).toContain("新建目标");
    expect(html).toContain("border-dashed"); // empty-state 基座
    for (const word of ["画像", "维度", "scope"]) {
      expect(html, word).not.toContain(word);
    }
  });

  it("目标分组：section-title 目标名 + caption-text 计数 +「新建样本」入口", () => {
    const html = renderHtml(
      <PracticeList
        groups={[{ target: makeTarget({ sampleCount: 2 }), samples: [makeSample()] }]}
        onCreateTarget={noop}
        onCreateSample={noop}
      />,
    );
    expect(html).toContain("汪曾祺的克制冷叙述");
    expect(html).toContain("2 篇范文");
    expect(html).toContain("新建样本");
  });

  it("「我的观察」留空 → 不渲染观察行（判据 2）", () => {
    const blank = renderHtml(
      <PracticeList
        groups={[{ target: makeTarget({ observation: null }), samples: [] }]}
        onCreateTarget={noop}
        onCreateSample={noop}
      />,
    );
    expect(blank).not.toContain("我的观察");
    expect(blank).toContain("还没有范文"); // 空分组的引导行

    const filled = renderHtml(
      <PracticeList
        groups={[
          { target: makeTarget({ observation: "多用短句、少形容词" }), samples: [makeSample()] },
        ]}
        onCreateTarget={noop}
        onCreateSample={noop}
      />,
    );
    expect(filled).toContain("我的观察：多用短句、少形容词");
  });

  it("加载态：groups = null → 骨架（不渲染空态文案）", () => {
    const html = renderHtml(<PracticeList groups={null} onCreateTarget={noop} onCreateSample={noop} />);
    expect(html).not.toContain("还没有文风目标");
    expect(html).not.toContain("还没有范文");
  });
});

describe("样本行（data-row：来源说明 + 状态徽标 + 相对时间）", () => {
  it("三态映射：未写稿 / 待点评 / 已点评（判据 3；已点评用 mock hasFeedback: true 锁定）", () => {
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

  it("行 = 来源说明（truncate）+ type-badge 徽标 + 相对时间（shared formatRelativeTime）", () => {
    const html = renderHtml(<PracticeSampleRow sample={makeSample()} />);
    expect(html).toContain("汪曾祺《受戒》节选");
    expect(html).toContain("truncate");
    expect(html).toContain("border-type-badge-border"); // type-badge 形态（TypeChip）
    expect(html).toContain("5 分钟前");
  });
});
