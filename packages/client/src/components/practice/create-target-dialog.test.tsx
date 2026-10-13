// 新建文风目标弹窗内容体渲染走查（卡 9）：仓内无 jsdom（既有纪律：不引新依赖），
// 用 `react-dom/server` 直渲染**内容体**（弹窗外壳走 `createPortal`，SSR 不支持——同
// `components/character/create-character-dialog.test.tsx` 的边界）。
// 契约：`docs/ui/DESIGN.md` §文风练习区「新建目标 / 新建样本弹窗」（名字 +「我的观察」可选）、
// `docs/api/120-api-practice.md`（名字 trim 非空 + 上限常量）。
// 注意：antd `Button` 在两字中文之间插空格（「取 消」/「创 建」）⇒ 这些断言用正则。
import type React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MAX_PRACTICE_OBSERVATION_CHARS,
  MAX_PRACTICE_TARGET_NAME_CHARS,
} from "@whispering233/ai-editor-shared";
import { CreateTargetFormBody } from "./create-target-dialog";

/** SSR 在相邻文本节点间插 `<!-- -->`（`最多 ` / 数字 / ` 字` 是三段）—— 归一后再断言 */
function renderHtml(node: React.ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

function render(overrides: Partial<Parameters<typeof CreateTargetFormBody>[0]> = {}): string {
  return renderHtml(
    <CreateTargetFormBody
      name="汪曾祺的克制冷叙述"
      onNameChange={() => {}}
      observation=""
      onObservationChange={() => {}}
      nameError={null}
      submitting={false}
      submitError={null}
      onSubmit={() => {}}
      onCancel={() => {}}
      {...overrides}
    />,
  );
}

describe("CreateTargetFormBody（新建文风目标弹窗内容体）", () => {
  it("字段 = 目标名（必填）+「我的观察」（可选）+ 页脚 [取消][创建]", () => {
    const html = render();
    expect(html).toContain("文风目标名");
    expect(html).toContain("我的观察（可选）");
    expect(html).toMatch(/取\s*消/);
    expect(html).toMatch(/创\s*建/);
  });

  it("上限取自 shared 常量：maxLength 与提示数字同源（不复述数字）", () => {
    const html = render();
    expect(html).toContain(`maxLength="${MAX_PRACTICE_TARGET_NAME_CHARS}"`);
    expect(html).toContain(`maxLength="${MAX_PRACTICE_OBSERVATION_CHARS}"`);
    expect(html).toContain(`最多 ${MAX_PRACTICE_OBSERVATION_CHARS} 字`);
  });

  it("名字必填错误内联在字段下；提交失败提示不吞错（服务端 message 透传位）", () => {
    expect(render({ nameError: "请填文风目标名" })).toContain("请填文风目标名");
    expect(render({ submitError: "String must contain at most 100 character(s)" })).toContain(
      "String must contain at most 100 character(s)",
    );
  });

  it("提交中防连点（loading + 字段禁用）且不换成危险按钮", () => {
    const html = render({ submitting: true });
    expect(html).toContain("ant-btn-loading");
    expect(html).toContain("disabled");
    expect(html).not.toContain("ant-btn-dangerous");
  });
});
