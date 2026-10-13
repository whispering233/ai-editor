// 新建练习样本弹窗内容体渲染走查（卡 9）：仓内无 jsdom（既有纪律：不引新依赖），
// 用 `react-dom/server` 直渲染**内容体**（弹窗外壳走 `createPortal`，SSR 不支持——同
// `components/character/create-character-dialog.test.tsx` 的边界）。
// 契约：`docs/ui/DESIGN.md` §文风练习区「新建样本弹窗」（来源说明 + 范文 `TextArea` 粘贴）、
// `docs/api/120-api-practice.md`（两项均 trim 非空 + 上限常量）。
// 注意：antd `Button` 在两字中文之间插空格（「取 消」/「创 建」）⇒ 这些断言用正则。
import type React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MAX_PRACTICE_SAMPLE_CHARS,
  MAX_PRACTICE_SOURCE_LABEL_CHARS,
} from "@whispering233/ai-editor-shared";
import { CreateSampleFormBody } from "./create-sample-dialog";

/** SSR 在相邻文本节点间插 `<!-- -->`（`最多 ` / 数字 / ` 字` 是三段）—— 归一后再断言 */
function renderHtml(node: React.ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

function render(overrides: Partial<Parameters<typeof CreateSampleFormBody>[0]> = {}): string {
  return renderHtml(
    <CreateSampleFormBody
      sourceLabel="汪曾祺《受戒》节选"
      onSourceLabelChange={() => {}}
      text="明海出家已经四年了。"
      onTextChange={() => {}}
      sourceLabelError={null}
      textError={null}
      submitting={false}
      submitError={null}
      onSubmit={() => {}}
      onCancel={() => {}}
      {...overrides}
    />,
  );
}

describe("CreateSampleFormBody（新建练习样本弹窗内容体）", () => {
  it("字段 = 来源说明 + 范文（多行粘贴）+ 页脚 [取消][创建]", () => {
    const html = render();
    expect(html).toContain("来源说明");
    expect(html).toContain("范文");
    expect(html).toMatch(/取\s*消/);
    expect(html).toMatch(/创\s*建/);
  });

  it("上限取自 shared 常量：maxLength 与提示数字同源（不复述数字）", () => {
    const html = render();
    expect(html).toContain(`maxLength="${MAX_PRACTICE_SOURCE_LABEL_CHARS}"`);
    expect(html).toContain(`maxLength="${MAX_PRACTICE_SAMPLE_CHARS}"`);
    expect(html).toContain(`最多 ${MAX_PRACTICE_SAMPLE_CHARS} 字`);
  });

  it("两项都可内联报错（各自指出缺哪一项）", () => {
    const html = render({ sourceLabelError: "请填来源说明", textError: "请粘贴范文" });
    expect(html).toContain("请填来源说明");
    expect(html).toContain("请粘贴范文");
  });

  it("提交失败提示留在框内（服务端 message 透传，不吞错）", () => {
    expect(render({ submitError: "参数校验失败" })).toContain("参数校验失败");
  });
});
