// 拆解小说预览展示口径测试（卡 21.8）：书名派生 / 统计行 / 预估行 / 范围解析。
// 为什么单测这些：对话框三态与请求副作用在组件里（仓内无 jsdom），而「文案里出现哪个数」的口径是
// 会静默漂移的那类——统计行两项总数并排（误读成丢字）、费用算不出时显示 $0（误读成免费）都发生过。
import { describe, expect, it } from "vitest";
import type { DecomposeAnalyzeRes, DecomposeEstimate } from "@whispering233/ai-editor-shared";
import { validateBookName } from "./book-name";
import {
  defaultBookNameFromFileName,
  formatCharCount,
  formatEstimate,
  formatPreviewStats,
  parseScopeInput,
} from "./decompose";

/** 造预览：章字数之和（6,000）刻意不等于 totalChars（10,000）——统计行只许出现后者 */
const PREVIEW: DecomposeAnalyzeRes = {
  encoding: "gb18030",
  totalChars: 10000,
  chapters: [
    { index: 1, title: "雪夜出走", charCount: 1000, volumeIndex: 0 },
    { index: 2, title: "旧盟友", charCount: 2000, volumeIndex: 0 },
    { index: 3, title: "长夜", charCount: 3000, volumeIndex: 0 },
  ],
  volumes: [{ index: 0, title: "全书" }],
  stats: { min: 800, median: 1500.5, max: 4200 },
  warnings: [],
  estimate: {
    batchCount: 12,
    llmCalls: 14,
    inputTokensApprox: 8000,
    outputTokensApprox: 1200,
    costApprox: 1.234,
  },
  defaultName: "斗破苍穹",
};

const ESTIMATE = (costApprox: number | null): DecomposeEstimate => ({
  batchCount: 12,
  llmCalls: 14,
  inputTokensApprox: 8000,
  outputTokensApprox: 1200,
  costApprox,
});

describe("defaultBookNameFromFileName（书名派生）", () => {
  it("去目录 + 去最后一个扩展名（Windows / POSIX 路径、大写扩展名同口径）", () => {
    expect(defaultBookNameFromFileName("C:\\novels\\斗破苍穹.txt")).toBe("斗破苍穹");
    expect(defaultBookNameFromFileName("/tmp/upload/雪中悍刀行.TXT")).toBe("雪中悍刀行");
    expect(defaultBookNameFromFileName("第一卷.上.txt")).toBe("第一卷.上");
  });

  it("无扩展名 / 纯点段保持原名（服务端 defaultBookName 同口径）", () => {
    expect(defaultBookNameFromFileName("无名")).toBe("无名");
    expect(defaultBookNameFromFileName(".txt")).toBe(".txt");
    expect(defaultBookNameFromFileName("第 1 卷 .txt")).toBe("第 1 卷");
  });

  it("派生结果直接喂客户端书名校验（validateBookName 单一来源）恒合法", () => {
    for (const fileName of ["斗破苍穹.txt", "my novel.txt", "带/危险目录/书.txt", "a.b.c"]) {
      expect(validateBookName(defaultBookNameFromFileName(fileName))).toBeNull();
    }
    // 校验本身仍会拦下非法书名（对话框停止按钮的判据）
    expect(validateBookName("  ")).toBe("请输入书名");
    expect(validateBookName("a/b")).not.toBeNull();
  });
});

describe("formatPreviewStats（统计行）", () => {
  it("编码 / 总字数 / 章数 / 卷数 / 单章字数分布五项齐全", () => {
    const line = formatPreviewStats(PREVIEW);
    expect(line).toContain("编码 GB18030");
    expect(line).toContain("总字数 10,000");
    expect(line).toContain("章数 3");
    expect(line).toContain("卷数 1");
    expect(line).toContain("单章字数 最少 800 / 中位 1,500.5 / 最多 4,200");
  });

  it("不展示章字数和（6,000）——两个总数并排会被读成丢字", () => {
    expect(formatPreviewStats(PREVIEW)).not.toContain("6,000");
  });

  it("编码标签覆盖全部探测结果（探测在服务端，客户端只展示）", () => {
    const lineFor = (encoding: DecomposeAnalyzeRes["encoding"]) =>
      formatPreviewStats({ ...PREVIEW, encoding });
    expect(lineFor("utf-8")).toContain("编码 UTF-8 ·");
    expect(lineFor("utf-8-bom")).toContain("编码 UTF-8 (BOM)");
    expect(lineFor("utf-16le")).toContain("编码 UTF-16 LE");
    expect(lineFor("utf-16be")).toContain("编码 UTF-16 BE");
  });
});

describe("formatEstimate（预估行）", () => {
  it("批次数 / 调用次数 / 费用（费率取整到分）", () => {
    expect(formatEstimate(ESTIMATE(1.234))).toBe("预计 12 批 · 14 次调用 · 粗估费用 ≈ $1.23");
  });

  it("costApprox = null（未配模型/凭据）→ 明说未知，不显示 $0", () => {
    const line = formatEstimate(ESTIMATE(null));
    expect(line).toContain("粗估费用未知");
    expect(line).toContain("未配置模型或凭据");
    expect(line).not.toContain("$");
  });

  it("分以下费用不显示 $0.00（会被读成免费）", () => {
    const line = formatEstimate(ESTIMATE(0.004));
    expect(line).toContain("小于 $0.01");
    expect(line).not.toContain("0.00");
  });
});

describe("formatCharCount（千分位）", () => {
  it("整数与 x.5 中位数都按千分位分组", () => {
    expect(formatCharCount(0)).toBe("0");
    expect(formatCharCount(999)).toBe("999");
    expect(formatCharCount(1234567)).toBe("1,234,567");
    expect(formatCharCount(1500.5)).toBe("1,500.5");
  });
});

describe("parseScopeInput（范围输入 → query 参数）", () => {
  it("正整数解析；空串 / 非法 / 0 / 负数一律当未填（缺省 = 全书，越界由服务端夹取）", () => {
    expect(parseScopeInput("3", "9")).toEqual({ scopeStart: 3, scopeEnd: 9 });
    expect(parseScopeInput("", "")).toEqual({});
    expect(parseScopeInput("  ", "abc")).toEqual({});
    expect(parseScopeInput("0", "-2")).toEqual({});
    expect(parseScopeInput("7", "")).toEqual({ scopeStart: 7 });
  });
});
