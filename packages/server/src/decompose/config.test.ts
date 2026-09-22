// 拆解并发配置读取测试（创作根 `<创作根>/.ai-editor/config.json` 的 `decompose.concurrency`）。
// 契约：docs/design/config.md「创作根 `.ai-editor/config.json`」的 `decompose` 段 +
// docs/design/60-decompose.md §2.2（建 job 时读一次并快照）。容错口径与 `src/debug.ts` 同款：
// 文件不存在 / 读取失败 / 非法 JSON / 结构不符 / 值非法 → 缺省；超上限 → 钳制。
// 数值断言一律由常量派生（散文与测试都不复述数字）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DECOMPOSE_CONCURRENCY,
  MAX_DECOMPOSE_CONCURRENCY,
  clampDecomposeConcurrency,
  readDecomposeConcurrency,
} from "./config.js";

let root: string;

/** 写创作根配置文件（`content` = 原文，便于塞非法 JSON） */
function writeConfig(content: string): void {
  mkdirSync(join(root, ".ai-editor"), { recursive: true });
  writeFileSync(join(root, ".ai-editor", "config.json"), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-editor-decompose-config-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readDecomposeConcurrency（创作根 decompose.concurrency）", () => {
  it("正常读取：合法整数原样返回（其它键不受影响）", () => {
    writeConfig(JSON.stringify({ debug: { enabled: true }, decompose: { concurrency: 4 } }));
    expect(readDecomposeConcurrency(root)).toBe(4);
  });

  it("缺省：文件不存在 / 创作根未初始化", () => {
    expect(readDecomposeConcurrency(root)).toBe(DEFAULT_DECOMPOSE_CONCURRENCY);
    expect(readDecomposeConcurrency(null)).toBe(DEFAULT_DECOMPOSE_CONCURRENCY);
    expect(readDecomposeConcurrency(undefined)).toBe(DEFAULT_DECOMPOSE_CONCURRENCY);
  });

  it("容错：非法 JSON / 顶层非对象 / decompose 非对象 / 键缺失 → 缺省", () => {
    writeConfig("{ 坏 JSON");
    expect(readDecomposeConcurrency(root)).toBe(DEFAULT_DECOMPOSE_CONCURRENCY);
    writeConfig("[]");
    expect(readDecomposeConcurrency(root)).toBe(DEFAULT_DECOMPOSE_CONCURRENCY);
    writeConfig(JSON.stringify({ decompose: 4 }));
    expect(readDecomposeConcurrency(root)).toBe(DEFAULT_DECOMPOSE_CONCURRENCY);
    writeConfig(JSON.stringify({ decompose: {} }));
    expect(readDecomposeConcurrency(root)).toBe(DEFAULT_DECOMPOSE_CONCURRENCY);
    writeConfig(JSON.stringify({ debug: { enabled: true } }));
    expect(readDecomposeConcurrency(root)).toBe(DEFAULT_DECOMPOSE_CONCURRENCY);
  });

  it("值非法（字符串 / 小数 / 0 / 负数 / null）→ 缺省，不当钳制处理", () => {
    for (const value of ["4", 2.5, 0, -1, null, Number.NaN]) {
      writeConfig(JSON.stringify({ decompose: { concurrency: value } }));
      expect(readDecomposeConcurrency(root), `concurrency=${String(value)}`).toBe(DEFAULT_DECOMPOSE_CONCURRENCY);
    }
  });

  it("超上限 → 钳制（配置表达吞吐意图，不判非法）", () => {
    writeConfig(JSON.stringify({ decompose: { concurrency: MAX_DECOMPOSE_CONCURRENCY + 1 } }));
    expect(readDecomposeConcurrency(root)).toBe(MAX_DECOMPOSE_CONCURRENCY);
    writeConfig(JSON.stringify({ decompose: { concurrency: Number.MAX_SAFE_INTEGER } }));
    expect(readDecomposeConcurrency(root)).toBe(MAX_DECOMPOSE_CONCURRENCY);
  });

  it("clampDecomposeConcurrency：下界缺省值、上界上限（纯函数）", () => {
    expect(clampDecomposeConcurrency(1)).toBe(1);
    expect(clampDecomposeConcurrency(DEFAULT_DECOMPOSE_CONCURRENCY)).toBe(DEFAULT_DECOMPOSE_CONCURRENCY);
    expect(clampDecomposeConcurrency(MAX_DECOMPOSE_CONCURRENCY + 100)).toBe(MAX_DECOMPOSE_CONCURRENCY);
  });
});
