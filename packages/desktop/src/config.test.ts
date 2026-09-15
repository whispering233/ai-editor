// 桌面版配置层单测：解析防御、建议路径、原子写往返。
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  desktopConfigPath,
  parseDesktopConfig,
  readDesktopConfig,
  suggestedLibraryDir,
  writeDesktopConfig,
} from "./config.js";

/** 建一个临时目录（每个用例独立，避免互相污染） */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ai-editor-desktop-"));
}

describe("parseDesktopConfig", () => {
  it("接受绝对路径的 projectRoot", () => {
    expect(parseDesktopConfig('{"projectRoot":"/home/me/AI Editor"}')).toEqual({
      projectRoot: "/home/me/AI Editor",
    });
  });

  it("忽略未知键", () => {
    expect(parseDesktopConfig('{"projectRoot":"/x","future":1}')).toEqual({ projectRoot: "/x" });
  });

  it("非法 JSON / 非对象 / 缺键 / 空串 / 相对路径 一律 null", () => {
    expect(parseDesktopConfig("{not json")).toBeNull();
    expect(parseDesktopConfig("null")).toBeNull();
    expect(parseDesktopConfig('"str"')).toBeNull();
    expect(parseDesktopConfig("{}")).toBeNull();
    expect(parseDesktopConfig('{"projectRoot":""}')).toBeNull();
    expect(parseDesktopConfig('{"projectRoot":"   "}')).toBeNull();
    expect(parseDesktopConfig('{"projectRoot":"relative/path"}')).toBeNull();
    expect(parseDesktopConfig('{"projectRoot":123}')).toBeNull();
  });
});

describe("readDesktopConfig / writeDesktopConfig", () => {
  it("写后读回同一值，且不留临时文件", () => {
    const dir = tempDir();
    const file = desktopConfigPath(dir);
    writeDesktopConfig(file, { projectRoot: "/books/mine" });
    expect(readDesktopConfig(file)).toEqual({ projectRoot: "/books/mine" });
    const raw = readFileSync(file, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(() => readFileSync(`${file}.tmp`, "utf-8")).toThrow();
  });

  it("文件不存在 / 内容损坏 → null（不抛）", () => {
    const dir = tempDir();
    expect(readDesktopConfig(desktopConfigPath(dir))).toBeNull();
    const file = desktopConfigPath(dir);
    writeFileSync(file, "{broken", "utf-8");
    expect(readDesktopConfig(file)).toBeNull();
  });

  it("父目录不存在时自动创建（userData 首次可能尚未落盘）", () => {
    const dir = tempDir();
    const file = join(dir, "nested", "deeper", "desktop.json");
    writeDesktopConfig(file, { projectRoot: "/books/x" });
    expect(readDesktopConfig(file)).toEqual({ projectRoot: "/books/x" });
  });
});

describe("路径助手", () => {
  it("desktopConfigPath 落在 userData 下", () => {
    expect(desktopConfigPath("/ud")).toBe("/ud/desktop.json");
  });

  it("建议书库位置 = 文档目录下的 AI Editor", () => {
    expect(suggestedLibraryDir("/home/me/Documents")).toBe("/home/me/Documents/AI Editor");
  });
});
