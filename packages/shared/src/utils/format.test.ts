// 文本格式化测试（T1.3）：时间戳 / 截断 / key 掩码的边界行为
import { describe, expect, it } from "vitest";
import { formatRelativeTime, formatTimestamp, maskApiKey, truncate } from "./format.js";

describe("formatTimestamp", () => {
  it("合法 ISO 8601 → YYYY-MM-DD HH:mm 格式（本地时区）", () => {
    expect(formatTimestamp("2026-08-01T10:30:00Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatTimestamp("2026-01-05T08:05:00Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("补零：单数月/日/时/分", () => {
    expect(formatTimestamp("2026-01-05T08:05:00Z")).toMatch(/^2026-01-05 \d{2}:05$/);
  });

  it("非法输入与空串原样返回（防御性）", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
    expect(formatTimestamp("")).toBe("");
  });
});

describe("truncate", () => {
  it("未超长原样返回", () => {
    expect(truncate("短文本", 10)).toBe("短文本");
    expect(truncate("正好十个字", 5)).toBe("正好十个字");
  });

  it("超长截断为省略号结尾，总长不超过 maxLen", () => {
    const result = truncate("这是一个非常长的文本内容", 6);
    expect(result).toHaveLength(6);
    expect(result.endsWith("…")).toBe(true);
    expect(truncate("abcdef", 3)).toBe("ab…");
  });

  it("边界：maxLen=1 → 单个省略号；maxLen<=0 → 空串", () => {
    expect(truncate("abc", 1)).toBe("…");
    expect(truncate("abc", 0)).toBe("");
    expect(truncate("abc", -1)).toBe("");
  });
});

describe("maskApiKey", () => {
  it("长 key：保留前 3 后 4，中间掩码（endpoints.md 示例 sk-****1234）", () => {
    expect(maskApiKey("sk-abcdefgh1234")).toBe("sk-****1234");
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-****cdef");
  });

  it("边界：短 key（前后缀重叠）整体掩码；空串同", () => {
    expect(maskApiKey("abc123")).toBe("****");
    expect(maskApiKey("sk-1234")).toBe("****");
    expect(maskApiKey("")).toBe("****");
  });
});

describe("formatRelativeTime", () => {
  it("非法输入原样返回", () => {
    expect(formatRelativeTime("not-a-date")).toBe("not-a-date");
    expect(formatRelativeTime("")).toBe("");
  });
  it("刚刚 / 分钟 / 小时 / 天前", () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 30_000).toISOString())).toBe("刚刚");
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString())).toBe("5 分钟前");
    expect(formatRelativeTime(new Date(now - 3 * 3_600_000).toISOString())).toBe("3 小时前");
    expect(formatRelativeTime(new Date(now - 2 * 86_400_000).toISOString())).toBe("2 天前");
  });
  it("≥30 天回退绝对时间（formatTimestamp）", () => {
    expect(formatRelativeTime(new Date(Date.now() - 40 * 86_400_000).toISOString())).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
  });
});
