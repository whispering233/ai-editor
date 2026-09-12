// 创作根偏好（last-project.ts）单测：lastProject 读写 + 合并语义 + 容错
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LAST_PROJECT_KEY, readLastProject, writeLastProject } from "./last-project.js";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-editor-lastproject-"));
  tmpDirs.push(dir);
  return dir;
}

function configFile(root: string): string {
  return join(root, ".ai-editor", "config.json");
}

function writeRootConfig(root: string, content: string): void {
  mkdirSync(join(root, ".ai-editor"), { recursive: true });
  writeFileSync(configFile(root), content, "utf8");
}

function readRootConfig(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configFile(root), "utf8")) as Record<string, unknown>;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("lastProject 读写", () => {
  it("无配置文件 / 无该键 / 键非字符串 → null（待命语义）", () => {
    const root = makeTmpDir();
    expect(readLastProject(root)).toBeNull(); // 文件不存在
    writeRootConfig(root, JSON.stringify({ debug: { enabled: true } }));
    expect(readLastProject(root)).toBeNull(); // 只有 debug 段
    writeRootConfig(root, JSON.stringify({ [LAST_PROJECT_KEY]: 42 }));
    expect(readLastProject(root)).toBeNull(); // 类型不符
    writeRootConfig(root, "not json");
    expect(readLastProject(root)).toBeNull(); // 非法 JSON
  });

  it("写入后读回同一路径，且不碰同文件其他键（debug 段）", () => {
    const root = makeTmpDir();
    writeRootConfig(root, JSON.stringify({ debug: { enabled: true, categories: ["chat"] } }));
    writeLastProject(root, "/books/第一本");
    expect(readLastProject(root)).toBe("/books/第一本");
    expect(readRootConfig(root).debug).toEqual({ enabled: true, categories: ["chat"] });
  });

  it("覆盖既有 lastProject；目录不存在时自建 .ai-editor/", () => {
    const root = makeTmpDir();
    writeLastProject(root, "/books/旧");
    writeLastProject(root, "/books/新");
    expect(readLastProject(root)).toBe("/books/新");
  });

  it("非法 JSON 的既有文件被本次写入替换（该文件本就被 debug 层忽略）", () => {
    const root = makeTmpDir();
    writeRootConfig(root, "{ 坏文件");
    writeLastProject(root, "/books/新");
    expect(readLastProject(root)).toBe("/books/新");
  });

  it("写入失败静默（创作根不可写：只读父目录）", () => {
    const root = makeTmpDir();
    // .ai-editor 是文件（非目录）→ mkdir 失败 → 静默；调用方（open 流程）不受影响
    writeFileSync(join(root, ".ai-editor"), "占位", "utf8");
    expect(() => writeLastProject(root, "/books/新")).not.toThrow();
  });
});
