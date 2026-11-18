// 整栏快捷键契约测试：左/右栏判定、修饰键边界、可编辑区不抢键。
import { describe, expect, it } from "vitest";
import { isEditableShortcutTarget, PANEL_SHORTCUT_KEY, panelShortcutFor } from "./panel-shortcuts";

/** 普通（非可编辑）事件目标：closest 一律未命中 */
const plainTarget = { closest: () => null };
/** 可编辑区事件目标（输入框内命中自身） */
const editableTarget = { closest: (selector: string) => ({ selector }) };

const key = (over: Partial<Parameters<typeof panelShortcutFor>[0]> = {}) => ({
  key: PANEL_SHORTCUT_KEY,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: plainTarget,
  ...over,
});

describe("panelShortcutFor", () => {
  it("Ctrl+B = 左栏、Cmd+B = 左栏、大写 B 同样命中", () => {
    expect(panelShortcutFor(key({ ctrlKey: true }))).toBe("sidebar");
    expect(panelShortcutFor(key({ metaKey: true }))).toBe("sidebar");
    expect(panelShortcutFor(key({ ctrlKey: true, key: "B" }))).toBe("sidebar");
  });

  it("Ctrl+Shift+B / Cmd+Shift+B = 右栏", () => {
    expect(panelShortcutFor(key({ ctrlKey: true, shiftKey: true }))).toBe("chat");
    expect(panelShortcutFor(key({ metaKey: true, shiftKey: true }))).toBe("chat");
  });

  it("Alt 组合、无修饰键、非 b 键、非 ctrl/cmd 均不命中", () => {
    expect(panelShortcutFor(key({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(panelShortcutFor(key({ metaKey: true, altKey: true, shiftKey: true }))).toBeNull();
    expect(panelShortcutFor(key())).toBeNull();
    expect(panelShortcutFor(key({ ctrlKey: true, key: "n" }))).toBeNull();
  });

  it("可编辑区内不抢键（块编辑器 Mod+B 保持加粗）；普通目标照常命中", () => {
    expect(panelShortcutFor(key({ ctrlKey: true, target: editableTarget }))).toBeNull();
    expect(panelShortcutFor(key({ metaKey: true, target: null }))).toBe("sidebar");
  });

  it("isEditableShortcutTarget：命中返回真，未命中 / 无目标返回假", () => {
    expect(isEditableShortcutTarget(editableTarget)).toBe(true);
    expect(isEditableShortcutTarget(plainTarget)).toBe(false);
    expect(isEditableShortcutTarget(null)).toBe(false);
    expect(isEditableShortcutTarget(undefined)).toBe(false);
  });

  it("目标选择器覆盖 input / textarea / contenteditable", () => {
    let seen = "";
    isEditableShortcutTarget({ closest: (selector) => (seen = selector) });
    expect(seen).toContain("input");
    expect(seen).toContain("textarea");
    expect(seen).toContain("[contenteditable='true']");
  });
});
