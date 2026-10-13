// 练习页三段（`PracticeSampleSections`）SSR 走查（卡 10）：仓内无 jsdom/@testing-library（既有纪律：不引新依赖），
// 用 `react-dom/server` 直渲染纯展示层。契约依据 = `docs/ui/DESIGN.md` §文风练习区「练习页」
// （范文只读 / 我的稿间接引用 `--writing-*` 且不引 `--paper-bg` / 点评卡渲染）
// + §Layout「中栏页头结构」；`docs/api/120-api-practice.md`（样本详情与卡体形状）。
//
// 覆盖（对应卡 10 硬完成判据）：
// - 判据 1：三段纵向在渲染（范文 / 我的稿 / 点评卡）+ 范文只读（唯一 `textarea` 是我的稿）
// - 判据 2：页内「保存」按钮在位、保存态与失败重试可见（真实点击与 Ctrl+S 注册栈走组件/store 测试 + 浏览器核对）
// - 判据 5：点评卡渲染 `dimensions` 的内层 snake_case 字段（`sample_trait` / `draft_trait` /
//   `sample_quotes` / `draft_quotes`），引用以 `「」` 列出、**不做**原文高亮；无卡 / `{}` → 一行空态
// - 判据 6：我的稿的字体 / 字号 / 行高来自 `--writing-*`（按非默认档断言：20px / 1.8），
//   **不出现 `--paper-bg`**（纸张档非默认也不给）
// 点评触发与 saving 态由容器（真实请求）承担 ⇒ 这里只断言按下前的可点性（`disabled` 三态）。
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MAX_PRACTICE_DRAFT_CHARS,
  type PracticeFeedbackCard,
  type PracticeSampleDetail,
} from "@whispering233/ai-editor-shared";
import PracticeDetail, { PracticeLoadFailure, PracticeSampleMissing, PracticeSampleSections } from "./PracticeDetail";
import { DEFAULT_WRITING_PREFS, type WritingPrefs } from "../hooks/use-writing-prefs";

/** SSR 在相邻文本节点之间插 `<!-- -->`（数字与「 字」是两段）——断言前归一掉 */
function renderHtml(node: ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

const DETAIL: PracticeSampleDetail = {
  id: "ps-1",
  targetId: "pt-1",
  targetName: "汪曾祺的克制冷叙述",
  observation: "多用短句、少形容词",
  sourceKind: "paste",
  sourceLabel: "汪曾祺《受戒》节选",
  text: "明海出家已经四年了。",
  draft: "他进城已经四年了。",
  feedback: null,
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T11:00:00Z",
};

/** 非默认写作面偏好：字号 20 / 行高 1.8 / 宋体 / 米黄纸——用来证明「参数真的被消费」且纸张不参与 */
const PREFS: WritingPrefs = {
  ...DEFAULT_WRITING_PREFS,
  font: "song",
  fontSize: 20,
  lineHeight: 1.8,
  paper: "cream",
};

function render(overrides: Partial<Parameters<typeof PracticeSampleSections>[0]> = {}): string {
  return renderHtml(
    <PracticeSampleSections
      detail={DETAIL}
      draft={DETAIL.draft}
      onDraftChange={() => {}}
      writingPrefs={PREFS}
      saving={false}
      savedAt={null}
      saveError={null}
      onSave={() => {}}
      canReview
      reviewing={false}
      onRequestReview={() => {}}
      {...overrides}
    />,
  );
}

/** 渲染出的 textarea（范文块不得有；「我的稿」恒有且只有一个） */
function textareas(html: string): string[] {
  return [...html.matchAll(/<textarea[\s\S]*?<\/textarea>/g)].map((match) => match[0]);
}

/** 含某文案的那个 button 元素（antd Button 的可用性开关 = 元素上的 `disabled`） */
function buttonHtml(html: string, label: string): string {
  const index = html.indexOf(label);
  expect(index, label).toBeGreaterThan(0);
  return html.slice(html.lastIndexOf("<button", index), html.indexOf("</button>", index));
}

describe("练习页三段（范文 → 我的稿 → 点评卡）", () => {
  it("三段纵向都在（判据 1）：范文 / 我的稿 / 点评卡三张卡依次出现", () => {
    const html = render();
    for (const title of ["范文", "我的稿", "点评卡"]) {
      expect(html, title).toContain(title);
    }
    const order = ["范文", "我的稿", "点评卡"].map((title) => html.indexOf(title));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("范文只读：文本在 `whitespace-pre-wrap` 的文本节点里，唯一 `textarea` 是我的稿（不给编辑入口）", () => {
    const html = render();
    expect(html).toContain("明海出家已经四年了。");
    expect(html).toContain("whitespace-pre-wrap");
    const areas = textareas(html);
    expect(areas).toHaveLength(1);
    expect(areas[0]).not.toContain("明海出家已经四年了。"); // 范文不进输入框
  });

  it("我的稿 = 纯文本 TextArea（列的是稿件）+ 上限取自 shared 常量（字数提示同源，不复述数字）", () => {
    const html = render();
    const area = textareas(html)[0];
    expect(area).toContain(`maxLength="${MAX_PRACTICE_DRAFT_CHARS}"`);
    expect(html).toContain("他进城已经四年了。");
    expect(html).toContain(`最多 ${MAX_PRACTICE_DRAFT_CHARS} 字`);
  });

  it("我的稿的字体 / 字号 / 行高来自 `--writing-*`（判据 6）：按非默认偏好断言，且不引 `--paper-bg`", () => {
    const html = render();
    // 容器给变量（值来自偏好档位表，不是页面写死的字号）
    expect(html).toContain("--writing-font-size:20px");
    expect(html).toContain("--writing-line-height:1.8");
    expect(html).toContain("--writing-font:");
    // textarea 侧只做间接引用（不写死 px / 字体栈）
    expect(html).toContain("font-size:var(--writing-font-size)");
    expect(html).toContain("font-family:var(--writing-font)");
    expect(html).toContain("line-height:var(--writing-line-height)");
    // 纸张是块编辑器写作面的语义：练习稿不着纸（偏好里选了米黄也不给）
    expect(html).not.toContain("--paper-bg");
    expect(html).not.toContain("paper-cream");
  });

  it("保存态：页内「保存」按钮恒在；saving → 保存中…；保存完成 → 已保存 · HH:MM", () => {
    const idle = render();
    expect(idle).toMatch(/保\s*存/);
    expect(idle).not.toContain("保存中…"); // 未在保存中
    expect(render({ saving: true })).toContain("保存中…");
    const saved = render({ savedAt: new Date(2026, 9, 1, 9, 5) });
    expect(saved).toContain("已保存 · 09:05");
  });

  it("保存失败可见（不静默）：错误条 + 重试", () => {
    const html = render({ saveError: "参数校验失败" });
    expect(html).toContain("参数校验失败");
    // antd 在两字中文之间插空格（「重 试」）⇒ 正则断言
    expect(html).toMatch(/重\s*试/);
  });
});

describe("点评卡渲染", () => {
  const DIMENSION = {
    name: "句长节奏",
    sample_trait: "短句为主",
    draft_trait: "句子偏长",
    sample_quotes: ["明海出家已经四年了。"],
    draft_quotes: ["他进城已经四年了。"],
    advice: "把长句拆开",
  };

  it("无卡 → 一行空态「还没点评」（判据 5）", () => {
    const html = render();
    expect(html).toContain("还没点评");
  });

  it("空对象卡（`{}` 也算合法响应）→ 仍是空态，不出现空白卡面", () => {
    const html = render({ detail: { ...DETAIL, feedback: {} as PracticeFeedbackCard } });
    expect(html).toContain("还没点评");
  });

  it("满卡：summary（caption）+ 维度名 + 四行标签（判据 5）", () => {
    const html = render({
      detail: {
        ...DETAIL,
        feedback: { dimensions: [DIMENSION], summary: "整体克制，稳" } as PracticeFeedbackCard,
      },
    });
    expect(html).toContain("整体克制，稳");
    expect(html).toContain("句长节奏");
    for (const label of ["范文特征", "你的写法", "引用", "建议"]) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain("短句为主");
    expect(html).toContain("句子偏长");
    expect(html).toContain("把长句拆开");
  });

  it("内层 snake_case 字段被消费：引用以 `「」` 列出，范文侧在前、我的稿侧在后（不做原文高亮）", () => {
    const html = render({
      detail: { ...DETAIL, feedback: { dimensions: [DIMENSION] } as PracticeFeedbackCard },
    });
    expect(html).toContain("范文「明海出家已经四年了。」");
    expect(html).toContain("我的稿「他进城已经四年了。」");
    expect(html.indexOf("范文「")).toBeLessThan(html.indexOf("我的稿「"));
    // 不做原文高亮定位：范文正文出现两次（范文块 + 引用行），但没有任何高亮容器
    expect(html).not.toContain("<mark");
  });

  it("引用缺失 / 字段为空 → 该行画 `—`（四行恒在，不因缺字段少一行）", () => {
    const html = render({
      detail: {
        ...DETAIL,
        feedback: { dimensions: [{ name: "叙述距离" }] } as PracticeFeedbackCard,
      },
    });
    // 维度名 + 四行；四个标签都在，值为 `—`
    for (const label of ["范文特征", "你的写法", "引用", "建议"]) {
      expect(html, label).toContain(label);
    }
    expect(html.match(/>—</g)).toHaveLength(4);
  });

  it("维度名为空（写入侧不约束非空）→ 退「维度 N」，不出现无标题的一组", () => {
    const html = render({
      detail: {
        ...DETAIL,
        feedback: { dimensions: [{ advice: "多读" }] } as PracticeFeedbackCard,
      },
    });
    expect(html).toContain("维度 1");
    expect(html).toContain("多读");
  });
});

describe("「让 AI 点评」的可点性（按下后由容器发消息，见 stores/chat.test.ts）", () => {
  it("有稿可点：按钮渲染为可用（无 disabled）", () => {
    expect(buttonHtml(render({ canReview: true }), "让 AI 点评")).not.toContain("disabled");
  });

  it("无稿 / 生成中禁点（拒绝静默无反应）", () => {
    for (const overrides of [{ canReview: false }, { canReview: true, reviewing: true }]) {
      expect(buttonHtml(render(overrides), "让 AI 点评"), JSON.stringify(overrides)).toContain(
        "disabled",
      );
    }
  });
});

describe("整页状态（页头常驻 + 404 / 加载失败）", () => {
  it("容器首帧 = 页头常驻模板 + 骨架（详情未到，不白屏）", () => {
    const html = renderHtml(<PracticeDetail sampleId="ps-1" />);
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
    expect(html).toContain("练习");
  });

  it("样本不存在 / 已删除 → 可读错误态 + 返回列表（不白屏）", () => {
    const html = renderHtml(<PracticeSampleMissing />);
    expect(html).toContain("该练习样本不存在或已被删除");
    expect(html).toMatch(/返回列\s*表/); // antd 两字中文间会插空格
  });

  it("加载失败 → 服务端文案 + 重试", () => {
    const html = renderHtml(<PracticeLoadFailure message="练习样本不存在" onRetry={() => {}} />);
    expect(html).toContain("练习样本加载失败");
    expect(html).toContain("练习样本不存在");
    expect(html).toMatch(/重\s*试/);
  });
});
