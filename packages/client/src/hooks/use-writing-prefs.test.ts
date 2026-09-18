// use-writing-prefs 纯函数测试（卡 13.2 / 13.3）：档位常量字面值（= DESIGN.md §Colors「写作面偏好」表的契约，
// 改档位不同步那张表就在这里报红）、防御解析（坏 JSON / 缺键 / 坏类型 / 越界 / 未知键）、
// 每个合法档位往返、偏好 → CSS 变量映射。
// hook 本体依赖 window/localStorage（含副作用），node 环境不渲染（仓库无 jsdom，同 use-panels.test.ts）。
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WRITING_PREFS,
  WRITING_FONT_OPTIONS,
  WRITING_FONT_SIZE_OPTIONS,
  WRITING_INDENT_OPTIONS,
  WRITING_LINE_HEIGHT_OPTIONS,
  WRITING_PAPER_OPTIONS,
  WRITING_PAPER_TEXTURE_OPTIONS,
  WRITING_PREFS_STORAGE_KEY,
  parseWritingPrefs,
  serializeWritingPrefs,
  toWritingCssVars,
  writingFontCss,
  writingPaperCss,
  type WritingPrefs,
} from "./use-writing-prefs";

describe("档位常量（DESIGN.md 表同值）", () => {
  it("字体五档：id / 中文 label / 字体栈", () => {
    expect(WRITING_FONT_OPTIONS.map((option) => option.value)).toEqual([
      "sans",
      "song",
      "kai",
      "fang",
      "mono",
    ]);
    expect(WRITING_FONT_OPTIONS.map((option) => option.label)).toEqual([
      "无衬线",
      "宋体",
      "楷体",
      "仿宋",
      "等宽",
    ]);
    // 默认档仍是全站无衬线栈；衬线档最终落 serif；等宽落 ui-monospace/Consolas/monospace
    expect(writingFontCss("sans")).toBe("var(--font-sans)");
    for (const [font, needle] of [
      ["song", "Songti SC"],
      ["kai", "Kaiti SC"],
      ["fang", "FangSong"],
      ["mono", "ui-monospace"],
    ] as const) {
      expect(writingFontCss(font)).toContain(needle);
    }
    expect(writingFontCss("song")).toContain("serif");
    expect(writingFontCss("mono")).toContain("monospace");
  });

  it("字号四档 / 行高三档 / 默认档 / 存储 key", () => {
    expect(WRITING_FONT_SIZE_OPTIONS.map((option) => option.value)).toEqual([14, 16, 18, 20]);
    expect(WRITING_LINE_HEIGHT_OPTIONS.map((option) => option.value)).toEqual([1.5, 1.8, 2]);
    expect(DEFAULT_WRITING_PREFS).toEqual({
      font: "sans",
      fontSize: 16,
      lineHeight: 1.5,
      paper: "default",
      paperTexture: "none",
      indent: false,
    });
    expect(WRITING_PREFS_STORAGE_KEY).toBe("ai-editor:writing");
  });

  it("纸张三档 / 纹理三档 / 缩进两档（档位字面值 = DESIGN.md 表）", () => {
    expect(WRITING_PAPER_OPTIONS.map((option) => option.value)).toEqual(["default", "cream", "warm"]);
    expect(WRITING_PAPER_OPTIONS.map((option) => option.label)).toEqual(["默认", "米黄", "暖灰"]);
    expect(WRITING_PAPER_TEXTURE_OPTIONS.map((option) => option.value)).toEqual([
      "none",
      "ruled",
      "grid",
    ]);
    expect(WRITING_PAPER_TEXTURE_OPTIONS.map((option) => option.label)).toEqual(["无", "横线", "网格"]);
    expect(WRITING_INDENT_OPTIONS.map((option) => option.value)).toEqual([false, true]);
    expect(WRITING_INDENT_OPTIONS.map((option) => option.label)).toEqual(["关", "开"]);
  });

  it("纸张档 → `--paper-bg` 值（默认档不给变量，非默认档间接引用 index.css 的 --paper-*）", () => {
    expect(writingPaperCss("default")).toBeNull();
    expect(writingPaperCss("cream")).toBe("var(--paper-cream)");
    expect(writingPaperCss("warm")).toBe("var(--paper-warm)");
  });
});

describe("parseWritingPrefs（防御解析）", () => {
  it("无存储值 / 坏 JSON / 非对象 → 整体默认", () => {
    for (const raw of [null, "", "not-json", "[]", "true", '"sans"', "null", "12"]) {
      expect(parseWritingPrefs(raw), String(raw)).toEqual(DEFAULT_WRITING_PREFS);
    }
  });

  it("缺键 → 该字段回落默认，其他字段保留", () => {
    expect(parseWritingPrefs('{"fontSize": 18}')).toEqual({
      font: "sans",
      fontSize: 18,
      lineHeight: 1.5,
      paper: "default",
      paperTexture: "none",
      indent: false,
    });
    expect(parseWritingPrefs('{"font": "kai"}')).toEqual({
      font: "kai",
      fontSize: 16,
      lineHeight: 1.5,
      paper: "default",
      paperTexture: "none",
      indent: false,
    });
    // 13.3 新字段单独缺 / 旧存量值（只有 13.2 三键）照旧可读，各自回落默认
    expect(parseWritingPrefs('{"paperTexture": "grid"}')).toEqual({
      ...DEFAULT_WRITING_PREFS,
      paperTexture: "grid",
    });
    expect(parseWritingPrefs('{"font": "song", "fontSize": 20, "lineHeight": 1.8}')).toEqual({
      ...DEFAULT_WRITING_PREFS,
      font: "song",
      fontSize: 20,
      lineHeight: 1.8,
    });
    expect(parseWritingPrefs("{}")).toEqual(DEFAULT_WRITING_PREFS);
  });

  it("类型错 / 越界值 → 该字段回落默认", () => {
    // 字符串数字不算（存储侧永远是数字）；17 / 1.7 / "comic" 不在档位白名单内
    expect(parseWritingPrefs('{"fontSize": "big", "lineHeight": "1.8", "font": 3}')).toEqual(
      DEFAULT_WRITING_PREFS,
    );
    expect(parseWritingPrefs('{"fontSize": "18"}').fontSize).toBe(16);
    expect(parseWritingPrefs('{"fontSize": 17, "lineHeight": 1.7, "font": "comic"}')).toEqual(
      DEFAULT_WRITING_PREFS,
    );
    // 逐字段独立回落：只有非法那一项回到默认
    expect(parseWritingPrefs('{"fontSize": 17, "lineHeight": 1.8}')).toEqual({
      ...DEFAULT_WRITING_PREFS,
      fontSize: 16,
      lineHeight: 1.8,
    });
    // 13.3：纸张 / 纹理 / 缩进坏值同样各自回落（1 / "true" / null 都不在白名单内）
    expect(parseWritingPrefs('{"paper": "sepia", "paperTexture": 1, "indent": "true"}')).toEqual(
      DEFAULT_WRITING_PREFS,
    );
    expect(parseWritingPrefs('{"indent": 0, "paper": "cream"}')).toEqual({
      ...DEFAULT_WRITING_PREFS,
      paper: "cream",
    });
  });

  it("未知键忽略（不在白名单的字段既不参与解析也不落盘）", () => {
    expect(parseWritingPrefs('{"fontWeight": 700, "indent": true, "fontSize": 20}')).toEqual({
      ...DEFAULT_WRITING_PREFS,
      fontSize: 20,
      indent: true,
    });
  });

  it("每个合法档位往返（serialize → parse 原值）", () => {
    for (const font of WRITING_FONT_OPTIONS) {
      for (const size of WRITING_FONT_SIZE_OPTIONS) {
        for (const lineHeight of WRITING_LINE_HEIGHT_OPTIONS) {
          for (const paper of WRITING_PAPER_OPTIONS) {
            for (const paperTexture of WRITING_PAPER_TEXTURE_OPTIONS) {
              for (const indent of WRITING_INDENT_OPTIONS) {
                const prefs: WritingPrefs = {
                  font: font.value,
                  fontSize: size.value,
                  lineHeight: lineHeight.value,
                  paper: paper.value,
                  paperTexture: paperTexture.value,
                  indent: indent.value,
                };
                expect(parseWritingPrefs(serializeWritingPrefs(prefs))).toEqual(prefs);
              }
            }
          }
        }
      }
    }
  });

  it("序列化只落六个已知字段（未知键不写盘）", () => {
    const dirty = { ...DEFAULT_WRITING_PREFS, fontWeight: 700 } as WritingPrefs;
    expect(JSON.parse(serializeWritingPrefs(dirty))).toEqual(DEFAULT_WRITING_PREFS);
  });
});

describe("toWritingCssVars", () => {
  it("默认档 → 与库默认同值（无偏好时不改变观感；默认纸**不给** `--paper-bg`）", () => {
    expect(toWritingCssVars(DEFAULT_WRITING_PREFS)).toEqual({
      "--writing-font": "var(--font-sans)",
      "--writing-font-size": "16px",
      "--writing-line-height": "1.5",
    });
    expect("--paper-bg" in toWritingCssVars(DEFAULT_WRITING_PREFS)).toBe(false);
  });

  it("字号带 px / 行高无单位 / 字体查表 / 非默认纸给 --paper-bg", () => {
    expect(
      toWritingCssVars({
        ...DEFAULT_WRITING_PREFS,
        font: "song",
        fontSize: 20,
        lineHeight: 1.8,
        paper: "cream",
      }),
    ).toEqual({
      "--writing-font": writingFontCss("song"),
      "--writing-font-size": "20px",
      "--writing-line-height": "1.8",
      "--paper-bg": "var(--paper-cream)",
    });
    expect(
      toWritingCssVars({ ...DEFAULT_WRITING_PREFS, paper: "warm" })["--paper-bg"],
    ).toBe("var(--paper-warm)");
    // 纹理 / 缩进**不经 CSS 变量**（走容器属性）⇒ 三个变量档位与它们无关
    expect(
      toWritingCssVars({ ...DEFAULT_WRITING_PREFS, paperTexture: "grid", indent: true }),
    ).toEqual({
      "--writing-font": "var(--font-sans)",
      "--writing-font-size": "16px",
      "--writing-line-height": "1.5",
    });
    expect(toWritingCssVars({ ...DEFAULT_WRITING_PREFS, lineHeight: 2 })["--writing-line-height"]).toBe(
      "2",
    );
  });
});
