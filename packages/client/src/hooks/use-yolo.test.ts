import { describe, expect, it } from "vitest";
import { parseYoloPreference } from "./use-yolo";

describe("parseYoloPreference（YOLO 持久化值）", () => {
  it("只有字符串 \"true\" 为开；null / 空 / 坏值 / 其他值一律关", () => {
    expect(parseYoloPreference("true")).toBe(true);
    expect(parseYoloPreference("false")).toBe(false);
    expect(parseYoloPreference("1")).toBe(false);
    expect(parseYoloPreference("")).toBe(false);
    expect(parseYoloPreference(null)).toBe(false);
  });
});
