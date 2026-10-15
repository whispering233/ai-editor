// 新建题目弹窗内容体渲染走查（卡 5）：仓内无 jsdom（既有纪律：不引新依赖），用 `react-dom/server`
// 直渲染**内容体**（弹窗外壳走 `createPortal`，SSR 不支持——同
// `components/practice/create-sample-dialog.test.tsx` 的边界）。
// 契约：`docs/ui/DESIGN.md` §作家文风练习区「新建题目弹窗」（题目必填 `input` + 写作要求可空 `Input.TextArea`）、
// `docs/api/120-api-practice.md`「自由练习」（`topic` trim 非空 + 上限常量；`brief` 可空 + 上限常量）。
// 注意：antd `Button` 在两字中文之间插空格（「取 消」/「创 建」）⇒ 这些断言用正则。
import type React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MAX_PRACTICE_BRIEF_CHARS,
  MAX_PRACTICE_TOPIC_CHARS,
} from "@whispering233/ai-editor-shared";
import { CreatePieceFormBody } from "./create-piece-dialog";

/** SSR 在相邻文本节点间插 `<!-- -->`（`最多 ` / 数字 / ` 字` 是三段）—— 归一后再断言 */
function renderHtml(node: React.ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

/** 含某文案（正则，antd 会在两字之间插空格）的按钮**开标签**（可用性开关 = 标签上的属性） */
function buttonTag(html: string, label: string): string {
  const match = new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*?${label}`).exec(html);
  expect(match, label).not.toBeNull();
  const tag = match?.[0] ?? "";
  return tag.slice(0, tag.indexOf(">"));
}

function render(overrides: Partial<Parameters<typeof CreatePieceFormBody>[0]> = {}): string {
  return renderHtml(
    <CreatePieceFormBody
      topic="写一段雨夜的告别"
      onTopicChange={() => {}}
      brief="三百字以内"
      onBriefChange={() => {}}
      topicError={null}
      submitting={false}
      submitError={null}
      onSubmit={() => {}}
      onCancel={() => {}}
      {...overrides}
    />,
  );
}

describe("CreatePieceFormBody（新建题目弹窗内容体）", () => {
  it("字段 = 题目（必填）+ 写作要求（可空）+ 页脚 [取消][创建]", () => {
    const html = render();
    expect(html).toContain("题目");
    expect(html).toContain("写作要求");
    expect(html).toMatch(/取\s*消/);
    expect(html).toMatch(/创\s*建/);
  });

  it("没有「让 AI 出题」按钮：空题行走列表页页头（本表单只服务用户自拟题）", () => {
    expect(render()).not.toContain("让 AI 出题");
  });

  it("上限取自 shared 常量：maxLength 与提示数字同源（不复述数字）", () => {
    const html = render();
    expect(html).toContain(`maxLength="${MAX_PRACTICE_TOPIC_CHARS}"`);
    expect(html).toContain(`maxLength="${MAX_PRACTICE_BRIEF_CHARS}"`);
    expect(html).toContain(`最多 ${MAX_PRACTICE_TOPIC_CHARS} 字`); // 题目输入框 placeholder
    expect(html).toContain(`最多 ${MAX_PRACTICE_BRIEF_CHARS} 字`); // 写作要求提示行
  });

  it("写作要求是 TextArea、题目是单行 input（形态差异对应「可空 / 必填」）", () => {
    const html = render();
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html.match(/<input/g)).toHaveLength(1);
  });

  it("题目为空的内联错误可见（提交前的必填校验落在框下）", () => {
    const html = render({ topic: "", topicError: "请填写题目" });
    expect(html).toContain("请填写题目");
  });

  it("服务端 / 网络失败留在框内可读（不静默）", () => {
    expect(render({ submitError: "用户自拟题目不能为空" })).toContain("用户自拟题目不能为空");
  });

  it("提交中：取消禁用 + 创建按钮进入 loading（两者都点不动，防重复提交）", () => {
    const html = render({ submitting: true });
    expect(buttonTag(html, "取\\s*消")).toContain("disabled");
    // antd 的 loading 态靠 `ant-btn-loading` 表达（不进 `disabled` 属性 —— 实测 SSR 输出如此）
    expect(buttonTag(html, "创\\s*建")).toContain("ant-btn-loading");
  });
});
