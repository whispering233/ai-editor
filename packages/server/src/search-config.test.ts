// server 搜索凭据单测（readSearchApiKey / resolveSearchAuth）
// 覆盖：唯一来源 search.json 的读取口径（缺失 / 坏 JSON / 非对象 / apiKey 非字符串 / 空串 → null）、
// 有 key 的 AuthResult 形状（source = "search.json"）、**无任何回退**（环境变量 DEEPSEEK_API_KEY 不顶用）。
// 路径一律注入 mkdtemp 临时文件——绝不碰真实家目录。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSearchApiKey, resolveSearchAuth } from "./search-config.js";

let dir: string;
/** 本用例的 search.json 路径（不存在的文件也直接传它） */
let path: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-search-"));
  path = join(dir, "search.json");
  for (const name of ["DEEPSEEK_API_KEY", "HOME", "USERPROFILE"]) savedEnv[name] = process.env[name];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function write(content: string): void {
  writeFileSync(path, content, "utf8");
}

describe("readSearchApiKey", () => {
  it("文件不存在 → null（未配置，不抛错）", () => {
    expect(readSearchApiKey(path)).toBeNull();
  });

  it.each([
    ["坏 JSON", "{ apiKey: 'sk-x' }"],
    ["空文件", ""],
    ["顶层是数组", '[{"apiKey":"sk-x"}]'],
    ["顶层是字符串", '"sk-x"'],
    ["顶层是 null", "null"],
  ])("%s → null（整份忽略）", (_label, content) => {
    write(content);
    expect(readSearchApiKey(path)).toBeNull();
  });

  it.each([
    ["数字", '{"apiKey":123}'],
    ["null", '{"apiKey":null}'],
    ["对象", '{"apiKey":{"key":"sk-x"}}'],
    ["数组", '{"apiKey":["sk-x"]}'],
    ["没有 apiKey 键", '{"apiKeyName":"sk-x"}'],
  ])("apiKey 是%s → null", (_label, content) => {
    write(content);
    expect(readSearchApiKey(path)).toBeNull();
  });

  it.each([
    ["空串", '{"apiKey":""}'],
    ["纯空白", '{"apiKey":"   "}'],
  ])("apiKey 是%s → null（按未配置处理）", (_label, content) => {
    write(content);
    expect(readSearchApiKey(path)).toBeNull();
  });

  it("有 key → 原样返回（不做 trim 之外的加工）", () => {
    write(JSON.stringify({ apiKey: "sk-search" }));
    expect(readSearchApiKey(path)).toBe("sk-search");
  });

  it("多余键不影响读取（strict 校验属写侧，读侧只认 apiKey）", () => {
    write(JSON.stringify({ apiKey: "sk-search", note: "本地备注" }));
    expect(readSearchApiKey(path)).toBe("sk-search");
  });
});

describe("resolveSearchAuth", () => {
  it("有 key → { auth: { apiKey }, source: \"search.json\" }", async () => {
    write(JSON.stringify({ apiKey: "sk-search" }));
    expect(await resolveSearchAuth(path)).toEqual({
      auth: { apiKey: "sk-search" },
      source: "search.json",
    });
  });

  it("无配置 → undefined", async () => {
    expect(await resolveSearchAuth(path)).toBeUndefined();
  });

  it("无回退：进程里设了 DEEPSEEK_API_KEY 仍按未配置处理", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-env-should-not-be-read";
    expect(await resolveSearchAuth(path)).toBeUndefined();
  });
});