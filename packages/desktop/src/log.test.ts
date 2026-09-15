// 日志模块单测：格式化（Error / 对象 / 多参 / 截断）与「同时写 stdout 与文件」的拦截行为。
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatLogArgs, formatLogLine, logFilePath, redirectConsoleToFile } from "./log.js";

describe("formatLogArgs", () => {
  it("Error 取 stack（含 message）", () => {
    const text = formatLogArgs([new Error("boom")]);
    expect(text).toContain("boom");
    expect(text.split("\n").length).toBeGreaterThan(1);
  });

  it("对象走 JSON、原始值走 String，多参数空格分隔", () => {
    expect(formatLogArgs([{ a: 1 }, "x", 2, null])).toBe('{"a":1} x 2 null');
  });

  it("超长值截断并标注", () => {
    const text = formatLogArgs(["a".repeat(5000)]);
    expect(text.length).toBeLessThan(2100);
    expect(text.endsWith("…[truncated]")).toBe(true);
  });

  it("循环对象不抛（退回 String）", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => formatLogArgs([cyclic])).not.toThrow();
  });

  it("formatLogLine 带 ISO 时间与级别", () => {
    const line = formatLogLine("error", ["x"], new Date("2026-01-02T03:04:05.000Z"));
    expect(line).toBe("2026-01-02T03:04:05.000Z [error] x\n");
  });

  it("logFilePath 落在 userData 的 logs 子目录", () => {
    expect(logFilePath("/ud")).toBe("/ud/logs/ai-editor.log");
  });
});

/** 拦截 console 三方法并把 stdout 调用记入数组，返回还原函数 */
function stubConsole(): { stdout: unknown[][]; restore: () => void } {
  const stdout: unknown[][] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args: unknown[]) => void stdout.push(["log", ...args]);
  console.warn = (...args: unknown[]) => void stdout.push(["warn", ...args]);
  console.error = (...args: unknown[]) => void stdout.push(["error", ...args]);
  return {
    stdout,
    restore: () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

describe("redirectConsoleToFile", () => {
  it("stdout 行为不变（上游调用者仍收到参数），同一行落文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-editor-log-"));
    const file = logFilePath(dir);
    const capture = stubConsole();
    try {
      redirectConsoleToFile(file);
      console.log("hello", 42);
      console.warn("careful");
    } finally {
      capture.restore();
    }
    expect(capture.stdout).toEqual([
      ["log", "hello", 42],
      ["warn", "careful"],
    ]);
    const text = readFileSync(file, "utf-8");
    expect(text).toContain("[info] hello 42");
    expect(text).toContain("[warn] careful");
    rmSync(dir, { recursive: true, force: true });
  });

  it("多次安装是追加（保留历史日志），不截断既有内容", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-editor-log-"));
    const file = logFilePath(dir);
    const capture = stubConsole();
    try {
      redirectConsoleToFile(file);
      console.log("first");
      redirectConsoleToFile(file);
      console.log("second");
    } finally {
      capture.restore();
    }
    const text = readFileSync(file, "utf-8");
    expect(text).toContain("first");
    expect(text).toContain("second");
    rmSync(dir, { recursive: true, force: true });
  });
});
