// 新建范文样本弹窗内容体渲染走查（卡 4 改版）：仓内无 jsdom（既有纪律：不引新依赖），
// 用 `react-dom/server` 直渲染**内容体**（弹窗外壳走 `createPortal`，SSR 不支持——同
// `components/character/create-character-dialog.test.tsx` 的边界）。
// 契约：`docs/ui/DESIGN.md` §作家文风练习区「新建样本弹窗」（关联作品下拉 + 片段说明 + 范文 + 导入按钮）、
// `docs/api/120-api-practice.md`「范文样本」（`text` trim 非空 + 上限常量；`excerpt_label` 可空 + 上限常量）。
// 注意：antd `Button` 在两字中文之间插空格（「取 消」/「创 建」）⇒ 这些断言用正则。
import type React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MAX_PRACTICE_EXCERPT_LABEL_CHARS,
  MAX_PRACTICE_SAMPLE_CHARS,
  PRACTICE_OTHER_WORK_LABEL,
} from "@whispering233/ai-editor-shared";
import {
  CreateSampleFormBody,
  planSampleImport,
  sampleExcerptLabelFromFileName,
} from "./create-sample-dialog";

/** SSR 在相邻文本节点间插 `<!-- -->`（`最多 ` / 数字 / ` 字` 是三段）—— 归一后再断言 */
function renderHtml(node: React.ReactElement): string {
  return renderToString(node).replace(/<!--[^>]*-->/g, "");
}

function render(overrides: Partial<Parameters<typeof CreateSampleFormBody>[0]> = {}): string {
  return renderHtml(
    <CreateSampleFormBody
      workOptions={[
        { value: "dragon-raja", label: "龙族" },
        { value: "", label: PRACTICE_OTHER_WORK_LABEL },
      ]}
      workId=""
      onWorkIdChange={() => {}}
      excerptLabel="迎着阳光盛大逃亡"
      onExcerptLabelChange={() => {}}
      text="路明非站在走廊尽头。"
      onTextChange={() => {}}
      excerptLabelError={null}
      textError={null}
      importError={null}
      onImportClick={() => {}}
      submitting={false}
      submitError={null}
      onSubmit={() => {}}
      onCancel={() => {}}
      {...overrides}
    />,
  );
}

describe("CreateSampleFormBody（新建范文样本弹窗内容体）", () => {
  it("字段 = 关联作品 + 片段说明 + 范文 + 导入按钮 + 页脚 [取消][创建]", () => {
    const html = render();
    expect(html).toContain("关联作品");
    expect(html).toContain("片段说明");
    expect(html).toContain("范文");
    expect(html).toContain("导入文本文件");
    expect(html).toMatch(/取\s*消/);
    expect(html).toMatch(/创\s*建/);
  });

  it("字段已去掉「来源说明」（归属由关联作品承载）", () => {
    expect(render()).not.toContain("来源说明");
  });

  it("上限取自 shared 常量：maxLength 与提示数字同源（不复述数字）", () => {
    const html = render();
    expect(html).toContain(`maxLength="${MAX_PRACTICE_EXCERPT_LABEL_CHARS}"`);
    expect(html).toContain(`maxLength="${MAX_PRACTICE_SAMPLE_CHARS}"`);
    expect(html).toContain(`最多 ${MAX_PRACTICE_SAMPLE_CHARS} 字`);
  });

  it("两项都可内联报错（各自指出缺哪一项）", () => {
    const html = render({ excerptLabelError: "片段说明太长", textError: "请粘贴或导入范文" });
    expect(html).toContain("片段说明太长");
    expect(html).toContain("请粘贴或导入范文");
  });

  it("导入失败文案与正文错误互斥（同一位置三态：正文错 > 导入错 > 上限提示）", () => {
    const importError = "文件太长（120000 字，最多 100000 字），请先裁剪再导入";
    expect(render({ importError })).toContain(importError);
    // 正文自身的错误优先展示（导入错错位不得掩掉用户需要先修的字段错误）
    expect(render({ importError, textError: "请粘贴或导入范文" })).not.toContain(importError);
  });

  it("提交失败提示留在框内（服务端 message 透传，不吞错）", () => {
    expect(render({ submitError: "参数校验失败" })).toContain("参数校验失败");
  });
});

describe("sampleExcerptLabelFromFileName（导入时预填片段说明）", () => {
  it("去掉最后一个扩展名；无扩展名原样", () => {
    expect(sampleExcerptLabelFromFileName("迎着阳光盛大逃亡.txt")).toBe("迎着阳光盛大逃亡");
    expect(sampleExcerptLabelFromFileName("龙族三.md")).toBe("龙族三");
    expect(sampleExcerptLabelFromFileName("龙族三")).toBe("龙族三");
    expect(sampleExcerptLabelFromFileName("weird.tar.gz")).toBe("weird.tar");
  });

  it("超上限按上限裁（与控件 maxLength 同一常量，不超出输入上限）", () => {
    const long = `${"字".repeat(MAX_PRACTICE_EXCERPT_LABEL_CHARS + 20)}.txt`;
    expect(sampleExcerptLabelFromFileName(long)).toHaveLength(MAX_PRACTICE_EXCERPT_LABEL_CHARS);
  });
});

describe("planSampleImport（导入落地判定：不静默截断）", () => {
  const ok = "路明非站在走廊尽头。";

  it("正常：正文原样 + 文件名预填片段说明", () => {
    expect(planSampleImport("迎着阳光盛大逃亡.txt", ok)).toEqual({
      action: "apply",
      excerptLabel: "迎着阳光盛大逃亡",
      text: ok,
    });
  });

  it("空文件 / 纯空白 → 报错（不落地空范文）", () => {
    for (const text of ["", "   ", "\n\t"]) {
      const plan = planSampleImport("空.txt", text);
      expect(plan.action).toBe("error");
    }
  });

  it("超上限 → 报错并**丢弃这次导入**（绝不截断后落地）", () => {
    const tooLong = "字".repeat(MAX_PRACTICE_SAMPLE_CHARS + 1);
    const plan = planSampleImport("长.txt", tooLong);
    expect(plan.action).toBe("error");
    if (plan.action === "error") {
      expect(plan.message).toContain(String(MAX_PRACTICE_SAMPLE_CHARS));
      expect(plan.message).toContain(String(tooLong.length));
    }
  });

  it("恰好上限 → 通过（边界不误伤）", () => {
    const atLimit = "字".repeat(MAX_PRACTICE_SAMPLE_CHARS);
    expect(planSampleImport("满.txt", atLimit)).toEqual({
      action: "apply",
      excerptLabel: "满",
      text: atLimit,
    });
  });
});
