// 写作面偏好 hook（卡 13.2 字体/字号/行高 + 卡 13.3 纸张/纹理/段首缩进）。
// 契约：docs/ui/DESIGN.md §Colors「写作面偏好（字体 / 纸张 / 缩进）」——本文件的档位常量是**唯一定义处**
// （DESIGN.md 表是契约，测试断言两者同值：改档位必须同步那张表）。
// - 唯一存储 = localStorage key `ai-editor:writing`（全站第三个 key，同哲学：纯展示偏好，
//   不进项目文件 / 备份 / 云同步）；全局一份，两处书写面（章正文 + 参考资料正文）共用。
// - 存一个扁平 JSON 对象（{ font, fontSize, lineHeight, paper, paperTexture, indent }）：解析是
//   **逐字段白名单**——缺键 / 坏类型 / 越界值各自回落默认，未知键忽略（13.3 加字段时旧值照旧可读）。
// - 下传只经 CSS 变量（`--writing-font` / `--writing-font-size` / `--writing-line-height` / `--paper-bg`）
//   与容器属性（`data-writing-paper` / `data-writing-indent`），blocknote.css 里是
//   `var(--writing-*, 库默认)` / 属性选择器的**间接引用**；调用点不得写 `--bn-*`（DESIGN.md 硬约束 ④）。
// - 纯函数（解析 / 序列化 / 档位 → CSS 值）从 hook 抽出供测试；hook 本体依赖 window（node 环境不渲染）。
import { useState, type CSSProperties } from "react";

/** localStorage key（全站第三个 key，见 DESIGN.md §Colors 写作面偏好） */
export const WRITING_PREFS_STORAGE_KEY = "ai-editor:writing";

export type WritingFont = "sans" | "song" | "kai" | "fang" | "mono";
export type WritingFontSize = 14 | 16 | 18 | 20;
export type WritingLineHeight = 1.5 | 1.8 | 2;
export type WritingPaper = "default" | "cream" | "warm";
export type WritingPaperTexture = "none" | "ruled" | "grid";

export interface WritingPrefs {
  font: WritingFont;
  fontSize: WritingFontSize;
  lineHeight: WritingLineHeight;
  paper: WritingPaper;
  paperTexture: WritingPaperTexture;
  /** 段首缩进（两字符）：只作用于段落块（heading / 列表 / 引用不动） */
  indent: boolean;
}

export interface WritingFontOption {
  value: WritingFont;
  /** 中文档位名（DESIGN.md 表） */
  label: string;
  /** `--writing-font` 的 CSS 值：全系统字体栈，不下载 web 字体（栈按 DESIGN.md 表） */
  css: string;
}

export const WRITING_FONT_OPTIONS: WritingFontOption[] = [
  { value: "sans", label: "无衬线", css: "var(--font-sans)" },
  { value: "song", label: "宋体", css: '"Songti SC", SimSun, serif' },
  { value: "kai", label: "楷体", css: '"Kaiti SC", KaiTi, serif' },
  { value: "fang", label: "仿宋", css: "FangSong, serif" },
  { value: "mono", label: "等宽", css: "ui-monospace, Consolas, monospace" },
];

export const WRITING_FONT_SIZE_OPTIONS: { value: WritingFontSize; label: string }[] = [
  { value: 14, label: "14" },
  { value: 16, label: "16" },
  { value: 18, label: "18" },
  { value: 20, label: "20" },
];

export const WRITING_LINE_HEIGHT_OPTIONS: { value: WritingLineHeight; label: string }[] = [
  { value: 1.5, label: "1.5" },
  { value: 1.8, label: "1.8" },
  { value: 2, label: "2.0" },
];

export interface WritingPaperOption {
  value: WritingPaper;
  /** 中文档位名（DESIGN.md 表） */
  label: string;
  /** `--paper-bg` 的 CSS 值 = 间接引用 index.css 的 `--paper-*`（色值唯一定义处）；默认档 = null（不给变量） */
  css: string | null;
}

export const WRITING_PAPER_OPTIONS: WritingPaperOption[] = [
  { value: "default", label: "默认", css: null },
  { value: "cream", label: "米黄", css: "var(--paper-cream)" },
  { value: "warm", label: "暖灰", css: "var(--paper-warm)" },
];

/** 纹理档名同时是容器属性值（`data-writing-paper="<none|ruled|grid>"`，blocknote.css 的属性选择器按此匹配） */
export const WRITING_PAPER_TEXTURE_OPTIONS: { value: WritingPaperTexture; label: string }[] = [
  { value: "none", label: "无" },
  { value: "ruled", label: "横线" },
  { value: "grid", label: "网格" },
];

export const WRITING_INDENT_OPTIONS: { value: boolean; label: string }[] = [
  { value: false, label: "关" },
  { value: true, label: "开" },
];

/** 默认档（DESIGN.md 表中加粗那一档）：无衬线 / 16px / 1.5 / 默认纸 / 无纹理 / 不缩进 */
export const DEFAULT_WRITING_PREFS: WritingPrefs = {
  font: "sans",
  fontSize: 16,
  lineHeight: 1.5,
  paper: "default",
  paperTexture: "none",
  indent: false,
};

/** 档位白名单匹配（未知值 / 坏类型 / 越界值 → false，由调用处回落默认） */
function isOptionValue<T>(options: readonly { value: T }[], candidate: unknown): candidate is T {
  return options.some((option) => option.value === candidate);
}

/**
 * 解析持久化 JSON（localStorage 防御）：坏 JSON / 非对象 / 数组 → 整体回退默认；
 * 对象则**逐字段**白名单校验，每项独立回落默认（缺键、`fontSize: "big"`、`17`、未知键都不影响其他字段）。
 */
export function parseWritingPrefs(raw: string | null): WritingPrefs {
  if (!raw) return DEFAULT_WRITING_PREFS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_WRITING_PREFS;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return DEFAULT_WRITING_PREFS;
  const rec = data as Record<string, unknown>;
  return {
    font: isOptionValue(WRITING_FONT_OPTIONS, rec.font) ? rec.font : DEFAULT_WRITING_PREFS.font,
    fontSize: isOptionValue(WRITING_FONT_SIZE_OPTIONS, rec.fontSize)
      ? rec.fontSize
      : DEFAULT_WRITING_PREFS.fontSize,
    lineHeight: isOptionValue(WRITING_LINE_HEIGHT_OPTIONS, rec.lineHeight)
      ? rec.lineHeight
      : DEFAULT_WRITING_PREFS.lineHeight,
    paper: isOptionValue(WRITING_PAPER_OPTIONS, rec.paper) ? rec.paper : DEFAULT_WRITING_PREFS.paper,
    paperTexture: isOptionValue(WRITING_PAPER_TEXTURE_OPTIONS, rec.paperTexture)
      ? rec.paperTexture
      : DEFAULT_WRITING_PREFS.paperTexture,
    indent: isOptionValue(WRITING_INDENT_OPTIONS, rec.indent) ? rec.indent : DEFAULT_WRITING_PREFS.indent,
  };
}

/** 序列化（显式字段：未知键绝不落盘） */
export function serializeWritingPrefs(prefs: WritingPrefs): string {
  return JSON.stringify({
    font: prefs.font,
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    paper: prefs.paper,
    paperTexture: prefs.paperTexture,
    indent: prefs.indent,
  });
}

/** 字体档 → `--writing-font` 的 CSS 值（档位表是唯一定义处，这里只查表） */
export function writingFontCss(font: WritingFont): string {
  const option = WRITING_FONT_OPTIONS.find((entry) => entry.value === font) ?? WRITING_FONT_OPTIONS[0];
  return option.css;
}

/** 纸张档 → `--paper-bg` 的 CSS 值；默认档 = null（**不给变量**，blocknote.css 的 fallback 兜回现行为） */
export function writingPaperCss(paper: WritingPaper): string | null {
  const option = WRITING_PAPER_OPTIONS.find((entry) => entry.value === paper) ?? WRITING_PAPER_OPTIONS[0];
  return option.css;
}

/** 容器上要设的写作面变量（声明 = blocknote.css 间接引用的输入端） */
export interface WritingCssVars extends CSSProperties {
  "--writing-font": string;
  "--writing-font-size": string;
  "--writing-line-height": string;
  /** 纸张档**非默认**时才给值（默认档不给 ⇒ blocknote.css 里 `var(--paper-bg, …)` 兜到库默认） */
  "--paper-bg"?: string;
}

/**
 * 偏好 → 容器上的 CSS 变量（`DocumentEditor` 设在 `BlockNoteView` 的 `style` 上，
 * 落到 `.bn-root.bn-container`）：blocknote.css 里的间接引用据此生效。
 * 字号带 px 单位；行高是无单位倍数（库的 `line-height: 1.5` 同形态）；纸张值 = `var(--paper-*)`
 * （色值仍只在 index.css 定义，这里只给间接引用）。
 */
export function toWritingCssVars(prefs: WritingPrefs): WritingCssVars {
  const paperBg = writingPaperCss(prefs.paper);
  return {
    "--writing-font": writingFontCss(prefs.font),
    "--writing-font-size": `${prefs.fontSize}px`,
    "--writing-line-height": String(prefs.lineHeight),
    ...(paperBg === null ? {} : { "--paper-bg": paperBg }),
  };
}

/** 安全读取 localStorage（隐私模式 / SSR 等异常 → null 回退默认） */
function readStorage(): string | null {
  if (typeof window === "undefined") return null; // SSR / node 环境防御（同 use-panels）
  try {
    return window.localStorage.getItem(WRITING_PREFS_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 写入 localStorage（配额 / 隐私模式失败静默——偏好丢失不影响功能） */
function writeStorage(json: string): void {
  try {
    window.localStorage.setItem(WRITING_PREFS_STORAGE_KEY, json);
  } catch {
    // 忽略：纯展示层偏好，写失败不影响功能
  }
}

/**
 * 写作面偏好状态（全局一份，两处书写面共用）：
 * 改动立即生效（容器 CSS 变量随 state 重渲染）并同步落 localStorage；写失败静默。
 * `setPref` 按字段收窄（`setPref("fontSize", 18)`），写入的值由类型保证在档位白名单内。
 */
export function useWritingPrefs() {
  const [prefs, setPrefs] = useState<WritingPrefs>(() => parseWritingPrefs(readStorage()));

  function setPref<K extends keyof WritingPrefs>(key: K, value: WritingPrefs[K]) {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value } as WritingPrefs; // 计算键：K 由调用点收窄，写入字段与值同型
      writeStorage(serializeWritingPrefs(next));
      return next;
    });
  }

  return { prefs, setPref };
}
