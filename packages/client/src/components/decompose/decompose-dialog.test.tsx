// 拆解对话框 presenter 渲染走查（卡 21.8）：仓内无 jsdom，用 react-dom/server 直渲染 presenter
// （状态机与 analyze/start 请求副作用在容器 `DecomposeDialog` 里 → 交互走浏览器走查）。
// 覆盖：三态入口形状（选文件 accept=".txt" / 解析中 / 预览）、统计行只出现 totalChars、
// 警告行、章列表列、范围输入、预估行、书名默认值与校验复用、错误文案落框内。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DecomposeAnalyzeRes } from "@whispering233/ai-editor-shared";
import { DecomposeDialogView, type DecomposeViewProps } from "./decompose-dialog";

/** 章字数之和（6,000）刻意不等于 totalChars（10,000）：统计行只许出现后者 */
const PREVIEW: DecomposeAnalyzeRes = {
  encoding: "utf-8",
  totalChars: 10000,
  chapters: [
    { index: 1, title: "雪夜出走", charCount: 1000, volumeIndex: 0 },
    { index: 2, title: "旧盟友", charCount: 2000, volumeIndex: 0 },
    { index: 3, title: "长夜", charCount: 3000, volumeIndex: 0 },
  ],
  volumes: [{ index: 0, title: "全书" }],
  stats: { min: 1000, median: 2000, max: 3000 },
  warnings: [{ code: "TOC_DROPPED", message: "已丢弃卷首目录页 2 段" }],
  estimate: {
    batchCount: 3,
    llmCalls: 5,
    inputTokensApprox: 8000,
    outputTokensApprox: 1200,
    costApprox: 0.5,
  },
  defaultName: "斗破苍穹",
};

const NOOP_HANDLERS: DecomposeViewProps["handlers"] = {
  onPickFile: () => {},
  onScopeStartChange: () => {},
  onScopeEndChange: () => {},
  onScopeCommit: () => {},
  onNameChange: () => {},
  onStart: () => {},
  onClose: () => {},
};

function render(overrides: Partial<DecomposeViewProps> = {}): string {
  return renderToString(
    <DecomposeDialogView
      preview={null}
      analyzing={false}
      scopeStart=""
      scopeEnd=""
      name=""
      nameError={null}
      error={null}
      starting={false}
      handlers={NOOP_HANDLERS}
      {...overrides}
    />,
  );
}

describe("拆解对话框 presenter：选文件态（preview = null）", () => {
  it("文件框只收 .txt（浏览器/桌面同一路径，无 preload 能力）", () => {
    const html = render();
    expect(html).toContain('accept=".txt"');
    expect(html).toContain('type="file"');
  });

  it("未出预览时不渲染预览字段与主操作（「开始拆解」只属预览态）", () => {
    const html = render();
    expect(html).not.toContain("总字数");
    expect(html).not.toContain("拆解范围");
    expect(html).not.toContain("ant-btn-primary"); // 主色确认钮不在选文件态
    expect(html).toMatch(/取\s?消/); // antd 会给两字中文按钮插空格，故不成文匹配
  });

  it("解析中 → 框内「正在解析文件…」（不另开提示）", () => {
    expect(render({ analyzing: true })).toContain("正在解析文件…");
  });
});

describe("拆解对话框 presenter：预览 + 填名开始态", () => {
  const html = render({ preview: PREVIEW, name: "斗破苍穹" });

  it("统计行：编码 / 总字数 / 章数 / 卷数 / 单章字数分布，且不出现章字数和", () => {
    expect(html).toContain("编码 UTF-8");
    expect(html).toContain("总字数 10,000");
    expect(html).toContain("章数 3");
    expect(html).toContain("卷数 1");
    expect(html).toContain("单章字数 最少 1,000 / 中位 2,000 / 最多 3,000");
    expect(html).not.toContain("6,000");
  });

  it("警告行用服务端 message（客户端不映射 warning code）", () => {
    expect(html).toContain("已丢弃卷首目录页 2 段");
  });

  it("章列表：序号 / 标题 / 字数三列全量渲染", () => {
    expect(html).toContain("雪夜出走");
    expect(html).toContain("旧盟友");
    expect(html).toContain("长夜");
    expect(html).toContain("2,000");
    expect(html).toContain('title="雪夜出走"');
  });

  it("范围输入：起始 / 结束两个数字框 + 留空 = 全书说明", () => {
    expect(html).toContain('aria-label="起始章"');
    expect(html).toContain('aria-label="结束章"');
    expect(html).toContain("留空 = 全书");
  });

  it("预估行：批次数 / 调用次数 / 粗估费用", () => {
    expect(html).toContain("预计 3 批 · 5 次调用 · 粗估费用 ≈ $0.50");
  });

  it("书名输入默认填好，主操作 =「开始拆解」（主色确认钮）", () => {
    expect(html).toContain('aria-label="书名"');
    expect(html).toContain("斗破苍穹");
    expect(html).toContain("ant-btn-primary");
    expect(html).toContain("开始拆解");
  });

  it("书名非法时显示 validateBookName 文案（校验复用，不手抄规则）", () => {
    const invalid = render({ preview: PREVIEW, name: "", nameError: "请输入书名" });
    expect(invalid).toContain("请输入书名");
  });

  it("错误文案落框内（analyze / start 失败同一位置）", () => {
    const failed = render({
      preview: PREVIEW,
      name: "斗破苍穹",
      error: "同名书籍已存在，请换一个书名",
    });
    expect(failed).toContain("同名书籍已存在，请换一个书名");
  });
});
