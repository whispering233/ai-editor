import { describe, expect, it } from "vitest";
import { parseSettingDescVisible } from "./use-setting-desc";

describe("parseSettingDescVisible", () => {
  it("默认显示，只有显式 false 才隐藏", () => {
    expect(parseSettingDescVisible(null)).toBe(true);
    expect(parseSettingDescVisible("true")).toBe(true);
    expect(parseSettingDescVisible("")).toBe(true);
    expect(parseSettingDescVisible("0")).toBe(true);
    expect(parseSettingDescVisible("false")).toBe(false);
  });
});
