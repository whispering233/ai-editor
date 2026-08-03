// 服务端调试日志层测试（纯配置文件模式：<创作根>/.ai-editor/config.json）
//
// 覆盖：配置文件解析（enabled/categories 组合）、边界语义（无 root/文件不存在/非法 JSON/
//   结构不符 → 全关）、缺省语义（enabled 缺失全关 / categories 缺失全部类别）、
//   未知名类别忽略、initDebugConfig 可重复调用（快照重置）、debugLog 类别门控
// 状态重置：每个用例后 initDebugConfig(undefined) 回全关态（模块状态测试间隔离）
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEBUG_CATEGORIES, debugLog, initDebugConfig, isCategoryEnabled } from "./debug.js";

let tmpRoot: string;

/** 写入调试配置文件（<root>/.ai-editor/config.json） */
function writeDebugConfig(projectRoot: string, content: unknown): void {
  const dir = join(projectRoot, ".ai-editor");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(content));
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-debug-"));
});

afterEach(() => {
  initDebugConfig(undefined); // 回全关态（模块状态重置，防用例间泄漏）
  vi.restoreAllMocks();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("initDebugConfig 配置文件解析", () => {
  it("文件存在（enabled+categories）→ 指定类别开、未列类别关", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["request", "usage"] } });
    initDebugConfig(tmpRoot);
    expect(isCategoryEnabled("request")).toBe(true);
    expect(isCategoryEnabled("usage")).toBe(true);
    expect(isCategoryEnabled("chat")).toBe(false);
    expect(isCategoryEnabled("stream")).toBe(false);
    expect(isCategoryEnabled("http")).toBe(false);
  });

  it("categories 缺失 → 全部类别开启（enabled=true）", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true } });
    initDebugConfig(tmpRoot);
    for (const cat of DEBUG_CATEGORIES) expect(isCategoryEnabled(cat)).toBe(true);
  });

  it("enabled 缺失 → 全关（categories 无效）", () => {
    writeDebugConfig(tmpRoot, { debug: { categories: ["request"] } });
    initDebugConfig(tmpRoot);
    expect(isCategoryEnabled("request")).toBe(false);
    for (const cat of DEBUG_CATEGORIES) expect(isCategoryEnabled(cat)).toBe(false);
  });

  it("enabled=false → 全关", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: false, categories: ["request"] } });
    initDebugConfig(tmpRoot);
    for (const cat of DEBUG_CATEGORIES) expect(isCategoryEnabled(cat)).toBe(false);
  });

  it("categories 含未知名类别 → 忽略（只开已知），空数组 → 全关", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["request", "unknown_cat"] } });
    initDebugConfig(tmpRoot);
    expect(isCategoryEnabled("request")).toBe(true);
    for (const cat of DEBUG_CATEGORIES.filter((c) => c !== "request")) {
      expect(isCategoryEnabled(cat)).toBe(false);
    }
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: [] } });
    initDebugConfig(tmpRoot);
    for (const cat of DEBUG_CATEGORIES) expect(isCategoryEnabled(cat)).toBe(false);
  });
});

describe("initDebugConfig 边界语义（无配置/坏配置 → 全关）", () => {
  it("文件不存在 → 全关（不阻断启动）", () => {
    initDebugConfig(tmpRoot); // 目录无 .ai-editor/config.json
    for (const cat of DEBUG_CATEGORIES) expect(isCategoryEnabled(cat)).toBe(false);
  });

  it("非法 JSON → 全关", () => {
    writeDebugConfig(tmpRoot, "{ 不是合法 JSON !!!");
    initDebugConfig(tmpRoot);
    for (const cat of DEBUG_CATEGORIES) expect(isCategoryEnabled(cat)).toBe(false);
  });

  it("结构不符（debug 非对象 / categories 非数组 / 顶层非对象）→ 全关", () => {
    writeDebugConfig(tmpRoot, { debug: "yes" });
    initDebugConfig(tmpRoot);
    expect(isCategoryEnabled("chat")).toBe(false);
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: "request" } });
    initDebugConfig(tmpRoot);
    expect(isCategoryEnabled("chat")).toBe(false);
    writeDebugConfig(tmpRoot, [1, 2, 3]); // 顶层数组
    initDebugConfig(tmpRoot);
    expect(isCategoryEnabled("chat")).toBe(false);
  });

  it("无 projectRoot（initDebugConfig()）→ 全关（测试重置语义）", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["request"] } });
    initDebugConfig(tmpRoot);
    expect(isCategoryEnabled("request")).toBe(true);
    initDebugConfig(); // 重置：无 projectRoot → 全关
    for (const cat of DEBUG_CATEGORIES) expect(isCategoryEnabled(cat)).toBe(false);
  });
});

describe("initDebugConfig 可重复调用（快照重置）", () => {
  it("两次不同配置依次生效（后一次覆盖前一次）", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["request"] } });
    initDebugConfig(tmpRoot);
    expect(isCategoryEnabled("request")).toBe(true);
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["chat"] } });
    initDebugConfig(tmpRoot); // 重复调用：重置快照
    expect(isCategoryEnabled("chat")).toBe(true);
    expect(isCategoryEnabled("request")).toBe(false);
    writeDebugConfig(tmpRoot, { debug: { enabled: false } });
    initDebugConfig(tmpRoot);
    expect(isCategoryEnabled("chat")).toBe(false); // 再重置为全关
  });
});

describe("debugLog 类别门控", () => {
  it("类别未开 → console.debug 零调用（零开销早退）", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["request"] } });
    initDebugConfig(tmpRoot);
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    debugLog("chat", "chat", "turn_start round=1"); // chat 类别未开
    expect(spy).not.toHaveBeenCalled();
  });

  it("类别开启 → 按 前缀[内容] 输出；类别与前缀解耦（llm 前缀 + request 类别）", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["request"] } });
    initDebugConfig(tmpRoot);
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    debugLog("request", "llm", "request model=m");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].map(String).join(" ")).toBe("[llm] request model=m");
  });
});
