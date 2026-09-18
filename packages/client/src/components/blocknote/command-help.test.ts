// 「命令帮助」弹窗的内容走查（卡 13.5）。仓内无 jsdom，故只测**纯数据层** `commandHelpSections()`
// （弹窗渲染与像素核对由浏览器走查承担，同 document-editor.tsx 的口径）。
// 断什么：① 三组齐全且条目名不空 / 组内不重名；② 快捷键一律经库字典插值（**不得漏出 `Mod-` 原文**，
// 否则「手抄库文案」这类回归会静默通过）；③ 组名与字典里的按钮文案同值（换字典即随动）。
import { describe, expect, it } from "vitest";
import { isAppleOS } from "@blocknote/core";
import { zh } from "@blocknote/core/locales";
import { commandHelpSections } from "./command-help";

/** 平台化前缀：与库的 `formatKeyboardShortcut` 同口径（Mac = ⌘，其余 = Ctrl） */
const MOD = isAppleOS() ? "⌘" : "Ctrl";

const sections = commandHelpSections();
const section = (title: string) => {
  const found = sections.find((entry) => entry.title === title);
  if (found === undefined) throw new Error(`缺少分组：${title}`);
  return found;
};
const shortcutOf = (title: string, name: string) =>
  section(title).entries.find((entry) => entry.name === name)?.shortcut;

describe("commandHelpSections（帮助内容）", () => {
  it("三组齐全：写作工具条 / 编辑器内 / 快捷键", () => {
    expect(sections.map((entry) => entry.title)).toEqual(["写作工具条", "编辑器内", "快捷键"]);
  });

  it("条目名非空、组内不重名（重名会让 React key 撞车）", () => {
    for (const group of sections) {
      const names = group.entries.map((entry) => entry.name);
      expect(names.every((name) => name.trim().length > 0), group.title).toBe(true);
      expect(new Set(names).size, group.title).toBe(names.length);
    }
  });

  it("快捷键条目全部来自库字典并已平台化（不得漏出 Mod- 原文）", () => {
    const shortcuts = section("快捷键").entries.map((entry) => entry.shortcut ?? "");
    expect(shortcuts.every((value) => value.length > 0)).toBe(true);
    expect(shortcuts.filter((value) => value.includes("Mod"))).toEqual([]);
    // 字典值 → 平台化文案（值本身不在本仓复述）
    expect(shortcutOf("快捷键", zh.formatting_toolbar.bold.tooltip)).toBe(`${MOD}+B`);
    expect(shortcutOf("快捷键", zh.formatting_toolbar.strike.tooltip)).toBe(`${MOD}+Shift+X`);
    expect(shortcutOf("快捷键", zh.formatting_toolbar.nest.tooltip)).toBe("Tab");
    expect(shortcutOf("快捷键", zh.formatting_toolbar.unnest.tooltip)).toBe("Shift+Tab");
    // 字典里没有撤销 / 重做 ⇒ 条目取库 keymap 字面量（Mod-z / Mod-y），仍要过平台化
    expect(shortcutOf("快捷键", "撤销")).toBe(`${MOD}+Z`);
    expect(shortcutOf("快捷键", "重做")).toBe(`${MOD}+Y`);
  });

  it("工具条条目名取自库字典 tooltip（不手抄库文案）", () => {
    const toolbar = zh.formatting_toolbar;
    const names = section("写作工具条").entries.map((entry) => entry.name);
    for (const label of [
      toolbar.bold.tooltip,
      toolbar.italic.tooltip,
      toolbar.underline.tooltip,
      toolbar.strike.tooltip,
      toolbar.colors.tooltip,
      toolbar.link.tooltip,
    ]) {
      expect(names).toContain(label);
    }
  });

  it("编辑器内条目名取自库字典（添加块按钮）且斜杠菜单提示即库 placeholder", () => {
    const names = section("编辑器内").entries.map((entry) => entry.name);
    expect(names).toContain(zh.side_menu.add_block_label);
    const slashMenu = section("编辑器内").entries.find((entry) => entry.name === "斜杠菜单");
    expect(slashMenu?.note).toContain(zh.placeholders.default);
  });
});
