// 服务端本地日键测试（local-date.ts，2026-11）
// 覆盖：本地 00:00 前后、跨月 / 跨年边界、单数字月日补零。
// **用本地 `new Date(y, m, d, h, min)` 构造**——不经字符串解析，不依赖运行机时区。
import { describe, expect, it } from "vitest";
import { localDateKey } from "./local-date.js";

describe("localDateKey", () => {
  it("本地 00:00 前后（同一自然日的两端）", () => {
    expect(localDateKey(new Date(2026, 0, 5, 0, 0, 0))).toBe("2026-01-05");
    expect(localDateKey(new Date(2026, 0, 4, 23, 59, 59))).toBe("2026-01-04");
  });

  it("跨月边界", () => {
    expect(localDateKey(new Date(2026, 0, 31, 23, 59, 59))).toBe("2026-01-31");
    expect(localDateKey(new Date(2026, 1, 1, 0, 0, 0))).toBe("2026-02-01");
  });

  it("跨年边界", () => {
    expect(localDateKey(new Date(2025, 11, 31, 23, 59, 59))).toBe("2025-12-31");
    expect(localDateKey(new Date(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01");
  });

  it("单数字月 / 日补零", () => {
    expect(localDateKey(new Date(2026, 8, 7, 12, 0, 0))).toBe("2026-09-07");
  });

  it("缺省参数 = 当前时刻的本地日（与本地 getter 同源，不是 UTC 日期）", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(localDateKey()).toBe(expected);
    expect(localDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});