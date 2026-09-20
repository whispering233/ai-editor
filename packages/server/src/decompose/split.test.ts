// 章节切分测试（拆解 S0 第一层）。契约：docs/design/60-decompose.md §3。
// 覆盖：编码探测（GB18030 / UTF-8 BOM / UTF-16LE / UTF-16BE）→ 换行归一（CRLF + NEL + U+2028/2029）→
// 候选扫描（标点结尾保留 / 数字编号式排除 / 计数词歧义排除）→ 聚合修复（相邻重复合并 / 微段修复 /
// 超长块回扫补到与补不到 / 目录页丢弃 / 编号重启提示）→ 规则融合评分选优 → 卷分组与卷章同行 →
// 前置块「前言」章与标题清洗 → 无章节结构退化等分。
// fixture 全部自造，不读 test-project/（该目录整体不入库）。
import { describe, expect, it } from "vitest";
import {
  SPLIT_FALLBACK_TARGET_CHARS,
  SPLIT_MIN_SEGMENT_CHARS,
  decodeNovel,
  normalizeText,
  splitNovel,
} from "./split.js";

const PROSE_LINE = "这是一段用于测试的正文，长度可控且不含任何章节标记。";

/** 造正文（不含任何章节标记行），总字数 ≥ 请求值 */
function prose(chars: number): string {
  return Array.from({ length: Math.ceil(chars / PROSE_LINE.length) }, () => PROSE_LINE).join("\n");
}

/** 造一章：标题行 + 正文 */
function chapter(title: string, body = 400): string {
  return `${title}\n${prose(body)}`;
}

/** 造书：章之间用换行拼接 */
function book(chapters: string[]): string {
  return chapters.join("\n");
}

const CN = "一二三四五六七八九十";

/** 五章标准书（标题 = 第N章 标题N） */
function fiveChapters(): string {
  return book([1, 2, 3, 4, 5].map((index) => chapter(`第${CN[index - 1]}章 标题${index}`)));
}

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const split = (text: string) => splitNovel(bytesOf(text));

/** UTF-16 字节（含 BOM），BMP 足够用 */
function utf16Bytes(text: string, littleEndian: boolean): Uint8Array {
  const units = [...text].flatMap((char) => {
    const code = char.codePointAt(0) ?? 0;
    return littleEndian ? [code & 0xff, code >> 8] : [code >> 8, code & 0xff];
  });
  return Uint8Array.from(littleEndian ? [0xff, 0xfe, ...units] : [0xfe, 0xff, ...units]);
}

const titles = (text: string): string[] => split(text).chapters.map((chapterItem) => chapterItem.title);
const warningCodes = (text: string): string[] => split(text).warnings.map((warning) => warning.code);

describe("编码探测与归一化", () => {
  it("① GB18030 字节：无 BOM + 严格 UTF-8 失败 → 回退 GB18030", () => {
    // 「第一章 相遇」的 GB18030 字节（非合法 UTF-8 序列）
    const gb18030 = Uint8Array.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xcf, 0xe0, 0xd3, 0xf6]);
    expect(decodeNovel(gb18030)).toEqual({ encoding: "gb18030", text: "第一章 相遇" });
    expect(splitNovel(gb18030).encoding).toBe("gb18030");
  });

  it("② UTF-8 BOM：探测为 utf-8-bom 且 BOM 不进标题", () => {
    const result = split(`\uFEFF${fiveChapters()}`);
    expect(result.encoding).toBe("utf-8-bom");
    expect(result.chapters.map((item) => item.title)).toEqual(["标题1", "标题2", "标题3", "标题4", "标题5"]);
    expect(result.chapters.every((item) => !item.title.includes("\uFEFF"))).toBe(true);
  });

  it("③ UTF-16LE（顺带 UTF-16BE）：BOM 探测 + 解码后用同一套切分", () => {
    const text = fiveChapters();
    const littleEndian = splitNovel(utf16Bytes(text, true));
    expect(littleEndian.encoding).toBe("utf-16le");
    expect(littleEndian.chapters.map((item) => item.title)).toEqual(["标题1", "标题2", "标题3", "标题4", "标题5"]);
    expect(splitNovel(utf16Bytes(text, false)).encoding).toBe("utf-16be");
  });

  it("④ CRLF + NEL + U+2028/U+2029 混合换行：统一归一为 \\n，标题不带残留字符", () => {
    const text = [
      `第一章 甲\r\n${prose(400)}`,
      `\u0085第二章 乙\u0085${prose(400)}`,
      `\r第三章 丙\n${prose(400)}`,
      `\u2028第四章 丁\n${prose(400)}`,
      `\u2029第五章 戊\n${prose(400)}`,
    ].join("");

    expect(titles(text)).toEqual(["甲", "乙", "丙", "丁", "戊"]);
    expect(normalizeText("甲\r\n乙\u0085丙")).toBe("甲\n乙\n丙");
    expect(normalizeText("甲   \n乙\u3000\u3000")).toBe("甲\n乙");
  });
});

describe("候选扫描", () => {
  it("⑦ 标点结尾标题（！？（））保留：不加标点护栏", () => {
    const text = book([
      chapter("第一章 你是谁？！"),
      chapter("第二章 （上）"),
      chapter("第三章 终局。"),
      chapter("第四章 别走……"),
      chapter("第五章 后话"),
    ]);
    expect(titles(text)).toEqual(["你是谁？！", "（上）", "终局。", "别走……", "后话"]);
    expect(warningCodes(text)).not.toContain("FALLBACK_EQUAL_SPLIT");
  });

  it("⑧ 数字编号式（`1，同行者：…`）不作为候选：数字列表项不误判", () => {
    const text = book([
      chapter("第一章 甲"),
      `1，同行者：甲\n2，同行者：乙\n${prose(400)}`,
      chapter("第二章 乙"),
      `10，同行者：丙\n${prose(400)}`,
      chapter("第三章 丙"),
      chapter("第四章 丁"),
      chapter("第五章 戊"),
    ]);
    expect(titles(text)).toEqual(["甲", "乙", "丙", "丁", "戊"]);
    expect(titles(text).every((title) => !/\d[，.]/.test(title))).toBe(true);
  });

  it("⑨ 计数词歧义排除（第三部分/第三节课/第三部队/第三集合）命中即丢弃", () => {
    const text = book([
      chapter("第一章 甲", 700),
      "第三部分 综述",
      prose(700),
      chapter("第二章 乙", 700),
      "第三节课 我们说过了",
      prose(700),
      chapter("第三章 丙", 700),
      "第三部队 驻扎在此",
      prose(700),
      chapter("第四章 丁", 700),
      "第三集合 全体到齐",
      prose(700),
      chapter("第五章 戊", 700),
    ]);
    // 只认「第N章」：四个歧义行都不成章（若误命中会各成一段 ≥ 阈值，titles 会多出条目）
    expect(titles(text)).toEqual(["甲", "乙", "丙", "丁", "戊"]);
  });

  it("⑮ 标题清洗 + 前置块成「前言」章：去编号前缀与全角空格，剥离后为空则保留原文行", () => {
    const preamble = `作者自述：这本书写了很多年。\n${prose(200)}`;
    const text = book([
      `${preamble}\n${chapter("第一章 相遇")}`,
      chapter("　　第二章"),
      chapter("第三章　全角空格的标题"),
      chapter("第四章 终局"),
      chapter("第五章 后话"),
    ]);
    const result = split(text);

    expect(result.chapters[0].title).toBe("前言");
    expect(result.chapters[0].charCount).toBe(preamble.length);
    expect(result.chapters.map((item) => item.title)).toEqual([
      "前言",
      "相遇",
      "第二章", // 剥离编号后为空 → 保留原文行
      "全角空格的标题",
      "终局",
      "后话",
    ]);
    expect(result.chapters.map((item) => item.index)).toEqual([1, 2, 3, 4, 5, 6]);
    // 章序 = 文件位置序；章字数之和不超过全文
    expect(result.stats.min).toBeLessThanOrEqual(result.stats.median);
    expect(result.stats.median).toBeLessThanOrEqual(result.stats.max);
    const sum = result.chapters.reduce((total, item) => total + item.charCount, 0);
    expect(sum).toBeLessThanOrEqual(result.totalChars);
    expect(result.totalChars).toBe(normalizeText(text).length);
  });
});

describe("聚合校验与修复", () => {
  it("⑤ 相邻重复标题（裸行 + 全角缩进同名行）合并：取后者为起点", () => {
    const text = book([
      chapter("第一章 出山"),
      "第二章 入城\n　　第二章 入城",
      prose(400),
      chapter("第三章 夜行"),
      chapter("第四章 归途"),
      chapter("第五章 终局"),
    ]);
    const result = split(text);

    expect(result.chapters.map((item) => item.title)).toEqual(["出山", "入城", "夜行", "归途", "终局"]);
    expect(result.warnings.map((warning) => warning.code)).toContain("DUPLICATE_MERGED");
    expect(result.warnings.find((warning) => warning.code === "DUPLICATE_MERGED")?.message).toContain("1");
  });

  it("微段修复：段尾过短的候选并入前一段（候选判误命中丢弃，文本不丢）", () => {
    const fifth = chapter("第五章 戊", 500);
    const text = book([
      chapter("第一章 甲"),
      chapter("第二章 乙"),
      chapter("第三章 丙"),
      chapter("第四章 丁"),
      `${fifth}\n第六章 己的预告\n${prose(60)}`,
    ]);
    const result = split(text);

    expect(prose(60).length).toBeLessThan(SPLIT_MIN_SEGMENT_CHARS); // 末节短于阈值 ⇒ 触发微段修复
    expect(result.chapters.map((item) => item.title)).toEqual(["甲", "乙", "丙", "丁", "戊"]);
    // 丢弃的只是切点：末章吸收了后续文本
    expect(result.chapters[4].charCount).toBeGreaterThan(fifth.length);
  });

  it("⑥ 编号重启（多部各自编号）不误判：章序 = 文件位置序，编号只产提示", () => {
    const part = (partIndex: number) =>
      [1, 2, 3].map((index) => chapter(`第${CN[index - 1]}章 第${partIndex}部第${index}章`));
    const text = book([...part(1), ...part(2)]);
    const result = split(text);

    expect(result.chapters.map((item) => item.title)).toEqual([
      "第1部第1章",
      "第1部第2章",
      "第1部第3章",
      "第2部第1章",
      "第2部第2章",
      "第2部第3章",
    ]);
    expect(result.warnings.map((warning) => warning.code)).toContain("NUMBERING_RESTART");
  });

  it("⑫ 超长块回扫（补到）：块内行内标记被回扫补漏，不报疑似合并章", () => {
    const text = book([
      ...[1, 2, 3, 4, 5, 6].map((index) => chapter(`第${CN[index - 1]}章 标题${index}`, 600)),
      `${chapter("第七章 长章", 1500)}\n他推开门；第八章 归途 她抬起头。\n${prose(1200)}`,
    ]);
    const result = split(text);

    expect(result.chapters.map((item) => item.title)).toEqual([
      "标题1",
      "标题2",
      "标题3",
      "标题4",
      "标题5",
      "标题6",
      "长章",
      "归途 她抬起头。",
    ]);
    expect(result.warnings.map((warning) => warning.code)).not.toContain("LONG_BLOCK");
  });

  it("⑫ 超长块回扫（补不到）：降级为「疑似合并章」提示，不静默处理", () => {
    const text = book([
      ...[1, 2, 3, 4, 5, 6].map((index) => chapter(`第${CN[index - 1]}章 标题${index}`, 600)),
      chapter("第七章 长章", 3000),
    ]);
    const result = split(text);

    expect(result.chapters.map((item) => item.title)).toEqual([
      "标题1",
      "标题2",
      "标题3",
      "标题4",
      "标题5",
      "标题6",
      "长章",
    ]);
    const longBlock = result.warnings.find((warning) => warning.code === "LONG_BLOCK");
    expect(longBlock?.message).toContain("长章");
  });

  it("⑬ 卷首目录页丢弃：连续短节命中 → 丢段并记 TOC_DROPPED", () => {
    const toc = [1, 2, 3, 4, 5, 6, 7, 8]
      .map((index) => `第${CN[index - 1]}章 标题${index} …… ${index * 7}`)
      .join("\n");
    const content = book([1, 2, 3, 4, 5, 6, 7, 8].map((index) => chapter(`第${CN[index - 1]}章 标题${index}`)));
    const result = split(`${toc}\n${content}`);

    expect(result.warnings.map((warning) => warning.code)).toContain("TOC_DROPPED");
    expect(result.chapters[0].title).toBe("前言"); // 目录页文本仍在，只是不成章
    expect(result.chapters.length).toBe(9);
    expect(result.chapters.every((item) => !item.title.includes("……"))).toBe(true);
  });

  it("⑭ 规则融合评分选优：两套规则（回 / 章）同场时选结构更好的一套", () => {
    const hui = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => chapter(`第${CN[index - 1]}回 回目${index}`));
    // 正文里混入两个「第N章」行：单看章规则命中断续、覆盖差，评分应选回规则
    const text = book([hui[0], hui[1], hui[2], "第三章 参考资料", hui[3], hui[4], hui[5], hui[6], "第七章 参考资料", hui[7]]);
    const result = split(text);

    expect(result.chapters.map((item) => item.title)).toEqual([
      "回目1",
      "回目2",
      "回目3",
      "回目4",
      "回目5",
      "回目6",
      "回目7",
      "回目8",
    ]);
  });
});

describe("卷与退化路径", () => {
  it("⑪ 卷标记分卷 + 卷章同行时卷优先", () => {
    const text = book([
      "第一卷 少年游",
      chapter("第一章 出山", 600),
      chapter("第二章 入城", 600),
      chapter("第三章 夜行", 600),
      "第二卷 风云录 第一章 重逢",
      chapter("第二章 旧识", 600),
      chapter("第三章 终局", 600),
    ]);
    const result = split(text);

    expect(result.volumes).toEqual([
      { index: 0, title: "少年游" },
      { index: 1, title: "风云录 第一章 重逢" }, // 卷章同行 → 按卷处理（卷优先），整行余下部分成为卷标题
    ]);
    // 卷标记行（未成章的结构行）落在首个章标记之前 → 随「前言」章保留，不下沉成新章
    expect(result.chapters.map((item) => item.title)).toEqual(["前言", "出山", "入城", "夜行", "旧识", "终局"]);
    expect(result.chapters.map((item) => item.volumeIndex)).toEqual([0, 0, 0, 0, 1, 1]);
  });

  it("卷标记只有一处 → 单卷「全书」兜底", () => {
    const text = book(["第一卷 少年游", ...[1, 2, 3, 4, 5].map((index) => chapter(`第${CN[index - 1]}章 标题${index}`))]);
    const result = split(text);

    expect(result.volumes).toEqual([{ index: 0, title: "全书" }]);
    expect(result.chapters).toHaveLength(6); // 卷标记行 + 五章（前者进「前言」）
    expect(result.chapters.every((item) => item.volumeIndex === 0)).toBe(true);
  });

  it("⑩ 无章节结构 → 按段落边界等分 + FALLBACK_EQUAL_SPLIT 警告", () => {
    const text = Array.from({ length: 4 }, () => prose(4020)).join("\n\n");
    const result = split(text);

    expect(result.warnings.map((warning) => warning.code)).toEqual(["FALLBACK_EQUAL_SPLIT"]);
    expect(result.warnings[0].message).toContain(String(SPLIT_FALLBACK_TARGET_CHARS));
    expect(result.chapters.length).toBeGreaterThan(1);
    expect(result.chapters.map((item) => item.title)).toEqual(
      result.chapters.map((_, position) => `第${position + 1}部分`),
    );
    // 除最后一份外都达到目标字数（边界落在空行上）
    expect(result.chapters.slice(0, -1).every((item) => item.charCount >= SPLIT_FALLBACK_TARGET_CHARS)).toBe(true);
    expect(result.chapters.every((item) => item.charCount > 0)).toBe(true);
    expect(result.volumes).toEqual([{ index: 0, title: "全书" }]);
  });

  it("无字段文本（空文件）：零章、单卷兜底、无警告", () => {
    expect(split("   \n\n  ")).toEqual({
      encoding: "utf-8",
      totalChars: 0,
      chapters: [],
      volumes: [{ index: 0, title: "全书" }],
      stats: { min: 0, median: 0, max: 0 },
      warnings: [],
    });
  });
});
