// 快捷键清单契约测试：平台判定、组合键文案、清单键位与真实绑定同源。
import { describe, expect, it } from "vitest";
import { SAVE_SHORTCUT_KEY } from "./save-shortcut";
import { formatShortcutKey, isApplePlatform, SHORTCUTS } from "./shortcuts";

describe("isApplePlatform", () => {
  it("Mac / iPhone / iPad 命中；Windows / Linux / 空串不命中", () => {
    expect(isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isApplePlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
    expect(isApplePlatform("")).toBe(false);
  });
});

describe("formatShortcutKey", () => {
  it("Apple = ⌘，其余 = Ctrl；主键大写", () => {
    expect(formatShortcutKey("s", false)).toBe("Ctrl + S");
    expect(formatShortcutKey("s", true)).toBe("⌘ + S");
  });
});

describe("快捷键清单", () => {
  it("保存项的键位引用真实绑定常量（清单与绑定不允许各写一份字面量）", () => {
    const save = SHORTCUTS.find((item) => item.id === "save");
    expect(save).toBeDefined();
    expect(save?.key).toBe(SAVE_SHORTCUT_KEY);
    expect(save?.description).not.toBe("");
  });
});
