// lib/backup 纯函数测试（B2.4）：备份时间/大小格式化 + 频率选项常量
import { describe, expect, it } from "vitest";
import { BACKUP_FREQUENCIES } from "@whispering233/ai-editor-shared";
import { BACKUP_FREQUENCY_OPTIONS, formatBackupTime, formatBytes } from "./backup";

describe("formatBackupTime（当年 MM-DD HH:mm / 跨年 YY-MM-DD HH:mm，settings.md 线框）", () => {
  // 固定基准时间：2026-08-13 12:00（本地时区构造，与实现同用本地时间）
  const now = new Date(2026, 7, 13, 12, 0, 0);

  it("当年：MM-DD HH:mm（08-13 10:15）", () => {
    expect(formatBackupTime("2026-08-13T10:15:00", now)).toBe("08-13 10:15");
  });

  it("跨年：YY-MM-DD HH:mm（25-12-31 22:30）", () => {
    expect(formatBackupTime("2025-12-31T22:30:00", now)).toBe("25-12-31 22:30");
  });

  it("当年 1 月 1 日凌晨补零（01-01 00:05）", () => {
    expect(formatBackupTime("2026-01-01T00:05:00", now)).toBe("01-01 00:05");
  });

  it("非法输入原样返回（防御：服务端 createdAt 恒有效，仅兜底）", () => {
    expect(formatBackupTime("not-a-date", now)).toBe("not-a-date");
    expect(formatBackupTime("", now)).toBe("");
  });
});

describe("formatBytes（settings.md 线框「1.2 MB」「986 KB」）", () => {
  it("B：小于 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("KB：整数（四舍五入）", () => {
    expect(formatBytes(986 * 1024)).toBe("986 KB");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1023)).toBe("1023 B"); // < 1 KB 仍走 B 分支
  });

  it("MB：一位小数", () => {
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });

  it("防御：非法/负数输入 → 0 B", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});

describe("BACKUP_FREQUENCY_OPTIONS（决策 27：关闭 + 5/10/15/30/60，与 shared 对齐）", () => {
  it("选项集与 shared BACKUP_FREQUENCIES 对齐，且「关闭」在首位", () => {
    expect(BACKUP_FREQUENCY_OPTIONS[0]).toEqual({ value: null, label: "关闭" });
    expect(BACKUP_FREQUENCY_OPTIONS.slice(1).map((o) => o.value)).toEqual([...BACKUP_FREQUENCIES]);
  });

  it("label 格式：每 N 分钟", () => {
    expect(BACKUP_FREQUENCY_OPTIONS[1]).toEqual({ value: 5, label: "每 5 分钟" });
    expect(BACKUP_FREQUENCY_OPTIONS[5]).toEqual({ value: 60, label: "每 60 分钟" });
  });

  it("option value 字符串化：null → \"null\"、数字 → \"N\"（select 受控 value 契约）", () => {
    expect(String(BACKUP_FREQUENCY_OPTIONS[0].value)).toBe("null");
    expect(String(BACKUP_FREQUENCY_OPTIONS[2].value)).toBe("10");
  });
});
