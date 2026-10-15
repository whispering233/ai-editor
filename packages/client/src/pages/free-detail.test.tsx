// 自由练习详情页（`#/free/:pieceId`，卡 5）SSR 走查：仓内无 jsdom/@testing-library（既有纪律：
// 不引新依赖），用 `react-dom/server` 直渲染纯展示层。
// 契约依据 = `docs/ui/DESIGN.md` §作家文风练习区「自由练习详情」（页头 title = 题目、空题写「待出题」；
// 三段 = 题目卡（空题态 `[让 AI 出题]` + 一行 `caption-text` 引导）→ 我的稿 → 点评卡；
// 点评卡依据侧标签 = 「风格特征」）+ §Layout「中栏页头结构」；
// `docs/api/120-api-practice.md`「自由练习」（详情字段 / 稿件上限 / 卡体形状）。
//
// 覆盖：
// - 页头：题目非空 → 用它（去首尾空白）+ `truncateTitle`；空题 → 「待出题」；未加载 → 「自由练习」
// - 三段纵向在渲染；题目卡只读（唯一 `textarea` 是我的稿）
// - 空题态 = 引导一行 + `[让 AI 出题]`；有题态不出现该按钮，`brief` 空则整块「写作要求」不渲染
// - 我的稿的字体 / 字号 / 行高来自 `--writing-*`（按非默认档断言），**不出现 `--paper-bg`**
// - 点评卡**复用仿写页卡面**：仅依据侧标签变「风格特征」（「你的写法 / 引用 / 建议」三行不动）
// 点评 / 出题触发与 saving 态由容器（真实请求）承担 ⇒ 这里只断言按下前的可点性（`disabled` 三态）。
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MAX_PRACTICE_DRAFT_CHARS,
  type PracticeFeedbackCard,
  type PracticePieceDetail,
} from "@whispering233/ai-editor-shared";
import FreeDetail, {
  FreeHeader,
  FreeLoadFailure,
  FreePieceMissing,
  FreePieceSections,
} from "./FreeDetail";
import { DEFAULT_WRITING_PREFS, type WritingPrefs } from "../hooks/use-writing-prefs";

/** SSR 在相邻文本节点之间插 `<!-- -->`（数字与「 字」是两段）——断言前归一掉 */
function renderHtml(node: ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

const DETAIL: PracticePieceDetail = {
  id: "pf-1",
  topic: "写一段雨夜的告别",
  brief: "三百字以内，第一人称。",
  topicSource: "user",
  draft: "雨下了一夜，我们没有说再见。",
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

function render(overrides: Partial<Parameters<typeof FreePieceSections>[0]> = {}): string {
  return renderHtml(
    <FreePieceSections
      detail={DETAIL}
      draft={DETAIL.draft}
      onDraftChange={() => {}}
      writingPrefs={PREFS}
      saving={false}
      savedAt={null}
      saveError={null}
      onSave={() => {}}
      canReview
      streaming={false}
      onRequestReview={() => {}}
      onRequestTopic={() => {}}
      {...overrides}
    />,
  );
}

/** 渲染出的 textarea（题目卡不得有；「我的稿」恒有且只有一个） */
function textareas(html: string): string[] {
  return [...html.matchAll(/<textarea[\s\S]*?<\/textarea>/g)].map((match) => match[0]);
}

/** 含某文案的那个 button 元素（antd Button 的可用性开关 = 元素上的 `disabled`） */
function buttonHtml(html: string, label: string): string {
  const index = html.indexOf(label);
  expect(index, label).toBeGreaterThan(0);
  return html.slice(html.lastIndexOf("<button", index), html.indexOf("</button>", index));
}

describe("页头（题目 → 标题；空题 → 「待出题」）", () => {
  it("题目非空 → 标题 = 题目（去首尾空白）+ `truncateTitle`", () => {
    const html = renderHtml(<FreeHeader detail={{ ...DETAIL, topic: "  写一段雨夜的告别  " }} />);
    expect(html).toContain("写一段雨夜的告别");
    expect(html).not.toContain("写一段雨夜的告别  "); // 尾随空白不落到标题
    expect(html).toContain("truncate");
  });

  it("空题 → 标题 = 「待出题」（不带括号，同 DESIGN.md §自由练习详情）", () => {
    const html = renderHtml(<FreeHeader detail={{ ...DETAIL, topic: "   " }} />);
    expect(html).toContain("待出题");
    expect(html).not.toContain("（待出题）");
  });

  it("详情未到（首帧）→ 只挂「自由练习」标题", () => {
    const html = renderHtml(<FreeHeader detail={null} />);
    expect(html).toContain("自由练习");
    expect(html).not.toContain("待出题");
  });
});

describe("详情三段（题目卡 → 我的稿 → 点评卡）", () => {
  it("三段纵向都在：题目 / 我的稿 / 点评卡三张卡依次出现", () => {
    const html = render();
    const order = ["题目", "我的稿", "点评卡"].map((title) => html.indexOf(title));
    for (const [index, title] of ["题目", "我的稿", "点评卡"].entries()) {
      expect(order[index], title).toBeGreaterThan(-1);
    }
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("题目卡只读：题目与写作要求在文本节点里，唯一 `textarea` 是我的稿", () => {
    const html = render();
    expect(html).toContain("写一段雨夜的告别");
    expect(html).toContain("写作要求");
    expect(html).toContain("三百字以内，第一人称。");
    expect(html).toContain("whitespace-pre-wrap");
    const areas = textareas(html);
    expect(areas).toHaveLength(1);
    expect(areas[0]).not.toContain("写一段雨夜的告别");
  });

  it("写作要求为空 = 无 → 整块不渲染（不出空标题）", () => {
    const html = render({ detail: { ...DETAIL, brief: "  " } });
    expect(html).not.toContain("写作要求");
  });

  it("我的稿 = 纯文本 TextArea（列的是稿件）+ 上限取自 shared 常量（字数提示同源，不复述数字）", () => {
    const html = render();
    const area = textareas(html)[0];
    expect(area).toContain(`maxLength="${MAX_PRACTICE_DRAFT_CHARS}"`);
    expect(area).toContain("雨下了一夜，我们没有说再见。");
    expect(html).toContain(`最多 ${MAX_PRACTICE_DRAFT_CHARS} 字`);
  });

  it("我的稿的字体 / 字号 / 行高来自 `--writing-*`：按非默认偏好断言，且不引 `--paper-bg`", () => {
    const html = render();
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
    expect(idle).not.toContain("保存中…");
    expect(render({ saving: true })).toContain("保存中…");
    expect(render({ savedAt: new Date(2026, 9, 1, 9, 5) })).toContain("已保存 · 09:05");
  });

  it("保存失败可见（不静默）：错误条 + 重试", () => {
    const html = render({ saveError: "参数校验失败" });
    expect(html).toContain("参数校验失败");
    // antd 在两字中文之间插空格（「重 试」）⇒ 正则断言
    expect(html).toMatch(/重\s*试/);
  });
});

describe("空题态（引导一行 + [让 AI 出题]）", () => {
  it("空题 → 一行 `caption-text` 引导 + `[让 AI 出题]` 按钮", () => {
    const html = render({ detail: { ...DETAIL, topic: "", brief: "" } });
    expect(html).toContain("这一篇还没有题目——让 AI 出一题，题目写好会显示在这里");
    expect(html).toContain("text-muted-foreground"); // caption 档
    expect(html).toContain("让 AI 出题");
  });

  it("生成在途（streaming）→ 出题按钮禁点（发不出去，点了没反应）", () => {
    const html = render({ detail: { ...DETAIL, topic: "" }, streaming: true });
    expect(buttonHtml(html, "让 AI 出题")).toContain("disabled");
  });

  it("有题 → 不给「让 AI 出题」（空题态专属；换题口径 = 删该篇重建，不做覆盖式换题）", () => {
    expect(render()).not.toContain("让 AI 出题");
  });
});

describe("「让 AI 点评」可点性（有已保存且非空的稿件才可点）", () => {
  it("有稿且与输入一致 → 可点", () => {
    expect(buttonHtml(render(), "让 AI 点评")).not.toContain("disabled");
  });

  it("库里无稿（canReview=false）→ 禁点", () => {
    const html = render({ canReview: false });
    expect(buttonHtml(html, "让 AI 点评")).toContain("disabled");
  });

  it("输入框有未保存改动（canReview=false）→ 禁点，且不给生成中的重复点击", () => {
    expect(buttonHtml(render({ canReview: false }), "让 AI 点评")).toContain("disabled");
    expect(buttonHtml(render({ streaming: true }), "让 AI 点评")).toContain("disabled");
  });
});

describe("点评卡渲染（复用仿写页卡面，仅依据侧标签变「风格特征」）", () => {
  const DIMENSION = {
    name: "句长节奏",
    sample_trait: "短句为主",
    draft_trait: "句子偏长",
    sample_quotes: ["少用修饰"],
    draft_quotes: ["雨下了一夜，我们没有说再见。"],
    advice: "把长句拆开",
  };

  it("无卡 → 一行空态「还没点评」", () => {
    expect(render()).toContain("还没点评");
  });

  it("满卡：summary + 维度名 + 四行标签 = 「风格特征 / 你的写法 / 引用 / 建议」", () => {
    const html = render({
      detail: {
        ...DETAIL,
        feedback: { dimensions: [DIMENSION], summary: "节奏偏松" } as PracticeFeedbackCard,
      },
    });
    expect(html).toContain("节奏偏松");
    expect(html).toContain("句长节奏");
    for (const label of ["风格特征", "你的写法", "引用", "建议"]) {
      expect(html, label).toContain(label);
    }
    // 依据侧 = 风格说明（不是范文）⇒ 该行标签不得回落到仿写口径
    expect(html).not.toContain("范文特征");
    expect(html).toContain("短句为主");
    expect(html).toContain("把长句拆开");
  });

  it("引用以 `「」` 列出：稿件侧引用带「我的稿」来源词，依据侧引用同行走同一份卡面（不做原文高亮）", () => {
    const html = render({
      detail: { ...DETAIL, feedback: { dimensions: [DIMENSION] } as PracticeFeedbackCard },
    });
    expect(html).toContain("我的稿「雨下了一夜，我们没有说再见。」");
    expect(html).toContain("「少用修饰」");
    expect(html).toContain("我的稿「");
    expect(html).not.toContain("<mark");
  });
});

describe("整页态（篇不存在 / 加载失败）", () => {
  it("篇已删除 → 空态 + 返回列表（`#/free`）", () => {
    const html = renderHtml(<FreePieceMissing />);
    expect(html).toContain("该练习篇不存在或已被删除");
    expect(html).toMatch(/返回列表/);
  });

  it("加载失败 → 服务端文案 + 重试", () => {
    const html = renderHtml(<FreeLoadFailure message="网络异常" onRetry={() => {}} />);
    expect(html).toContain("练习篇加载失败");
    expect(html).toContain("网络异常");
    expect(html).toMatch(/重\s*试/);
  });

  it("容器首帧 = 页头常驻模板 + 骨架（未加载不给三段）", () => {
    const html = renderHtml(<FreeDetail pieceId="pf-1" />);
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
    expect(html).toContain("自由练习"); // 详情未到时的页头标题
  });
});
