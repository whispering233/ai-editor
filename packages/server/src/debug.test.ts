// 服务端调试日志层测试（配置文件模式 + env 回退 + 细粒度类别）
//
// 覆盖：配置文件解析（enabled/categories 组合）、回退语义（文件不存在/非法 JSON/结构不符 →
//   env）、优先级（配置文件优先于 env）、缺省语义（enabled 缺失全关 / categories 缺失全部类别）、
//   未知名类别忽略、debugLog 类别门控、无 projectRoot 时 env 模式
// 状态重置：每个用例后 initDebugConfig(undefined) 回 env 模式（模块状态测试间隔离）
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEBUG_CATEGORIES, debugLog, initDebugConfig, isCategoryEnabled, isDebugEnabled } from "./debug.js";

let tmpRoot: string;
let originalDebug: string | undefined;

/** 写入调试配置文件（<root>/.ai-editor/config.json） */
function writeDebugConfig(projectRoot: string, content: unknown): void {
  const dir = join(projectRoot, ".ai-editor");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(content));
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-debug-"));
  originalDebug = process.env.AI_EDITOR_DEBUG;
  delete process.env.AI_EDITOR_DEBUG; // 默认关；env 相关用例显式设置
});

afterEach(() => {
  initDebugConfig(undefined); // 回 env 模式（模块状态重置，防用例间泄漏）
  if (originalDebug !== undefined) process.env.AI_EDITOR_DEBUG = originalDebug;
  else delete process.env.AI_EDITOR_DEBUG;
  vi.restoreAllMocks();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("initDebugConfig 配置文件解析", () => {
  it("文件存在（enabled+categories）→ 配置模式：指定类别开、未列类别关、总开关开", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["request", "usage"] } });
    initDebugConfig(tmpRoot);
    expect(isDebugEnabled()).toBe(true);
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
    expect(isDebugEnabled()).toBe(false);
    expect(isCategoryEnabled("request")).toBe(false);
  });

  it("enabled=false → 全关", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: false, categories: ["request"] } });
    initDebugConfig(tmpRoot);
    expect(isDebugEnabled()).toBe(false);
    expect(isCategoryEnabled("request")).toBe(false);
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
    expect(isCategoryEnabled("request")).toBe(false);
  });
});

describe("initDebugConfig 回退 env 模式", () => {
  it("文件不存在 → 回退 env：env=1 全类别开；env 未设全关", () => {
    process.env.AI_EDITOR_DEBUG = "1";
    initDebugConfig(tmpRoot); // 目录无 .ai-editor/config.json
    expect(isDebugEnabled()).toBe(true);
    for (const cat of DEBUG_CATEGORIES) expect(isCategoryEnabled(cat)).toBe(true);
    delete process.env.AI_EDITOR_DEBUG;
    initDebugConfig(tmpRoot);
    expect(isDebugEnabled()).toBe(false);
    expect(isCategoryEnabled("chat")).toBe(false);
  });

  it("非法 JSON → 回退 env（不阻断启动）", () => {
    writeDebugConfig(tmpRoot, "{ 不是合法 JSON !!!");
    process.env.AI_EDITOR_DEBUG = "1";
    initDebugConfig(tmpRoot);
    expect(isDebugEnabled()).toBe(true);
    expect(isCategoryEnabled("http")).toBe(true);
  });

  it("结构不符（debug 非对象 / categories 非数组）→ 回退 env", () => {
    writeDebugConfig(tmpRoot, { debug: "yes" });
    process.env.AI_EDITOR_DEBUG = "1";
    initDebugConfig(tmpRoot);
    expect(isDebugEnabled()).toBe(true);
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: "request" } });
    initDebugConfig(tmpRoot);
    expect(isDebugEnabled()).toBe(true); // env 回退（而非配置模式的 enabled）
  });

  it("无 projectRoot（initDebugConfig()）→ env 模式（测试重置语义）", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["request"] } });
    initDebugConfig(tmpRoot);
    expect(isCategoryEnabled("request")).toBe(true);
    // 重置：无 projectRoot → env 模式
    delete process.env.AI_EDITOR_DEBUG;
    initDebugConfig();
    expect(isCategoryEnabled("request")).toBe(false);
    process.env.AI_EDITOR_DEBUG = "1";
    expect(isCategoryEnabled("request")).toBe(true); // env 模式即时生效
  });
});

describe("配置文件优先于 env", () => {
  it("env=1 + 配置 enabled=false → 关（配置优先）", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: false } });
    process.env.AI_EDITOR_DEBUG = "1";
    initDebugConfig(tmpRoot);
    expect(isDebugEnabled()).toBe(false);
    expect(isCategoryEnabled("chat")).toBe(false);
  });

  it("配置开 + env 未设 → 开（配置文件独立生效）", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["usage"] } });
    initDebugConfig(tmpRoot);
    expect(isDebugEnabled()).toBe(true);
    expect(isCategoryEnabled("usage")).toBe(true);
    expect(isCategoryEnabled("chat")).toBe(false);
  });

  it("配置模式运行中改 env 不生效（env 被忽略）", () => {
    writeDebugConfig(tmpRoot, { debug: { enabled: true, categories: ["http"] } });
    initDebugConfig(tmpRoot);
    delete process.env.AI_EDITOR_DEBUG;
    expect(isCategoryEnabled("http")).toBe(true); // 配置模式与 env 无关
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
