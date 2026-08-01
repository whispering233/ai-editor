// T2.2 原子写核心测试（决策 11：临时文件 + fsync + rename，禁止直接覆盖）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nowIso, writeJsonAtomic } from "./atomic";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-atomic-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 目标文件路径 + 对应临时文件路径（模块级 join(dir) 会在 dir 赋值前求值，故用函数） */
const filePath = (): string => join(dir, "outline.json");
const tmpPath = (): string => join(dir, ".outline.json.tmp");

describe("writeJsonAtomic 原子写", () => {
  it("写后读回内容一致（JSON 深比较），临时文件不残留", () => {
    const data = { id: "root", schema_version: 1, children: [{ id: "sc-1", title: "场景" }] };
    writeJsonAtomic(filePath(), data);

    expect(JSON.parse(readFileSync(filePath(), "utf8"))).toEqual(data);
    // rename 已移动临时文件，目录中不应残留
    expect(existsSync(tmpPath())).toBe(false);
    // 目录中仅目标文件，无任何 .tmp 残留
    expect(readdirSync(dir)).toEqual(["outline.json"]);
  });

  it("模拟写中断：目标目录不存在时写失败，原文件内容完好、未产生新文件", () => {
    writeJsonAtomic(filePath(), { version: "old" });
    const original = readFileSync(filePath(), "utf8");

    // 失败写：目标目录不存在（openSync 临时文件必然 ENOENT）
    const badPath = join(dir, "nope", "outline.json");
    expect(() => writeJsonAtomic(badPath, { version: "new" })).toThrow();

    // 原文件未被破坏，内容逐字节一致
    expect(readFileSync(filePath(), "utf8")).toBe(original);
    // 失败写没有在别处留下半成品
    expect(existsSync(tmpPath())).toBe(false);
  });

  it("临时文件残留（上次崩溃现场）时再次写成功，且残留被清理", () => {
    // 模拟崩溃残留：预写一个残留临时文件（内容可能是旧的半成品）
    writeFileSync(tmpPath(), '{"partial":true}');
    expect(existsSync(tmpPath())).toBe(true);

    const data = { ok: true };
    writeJsonAtomic(filePath(), data);

    expect(JSON.parse(readFileSync(filePath(), "utf8"))).toEqual(data);
    expect(existsSync(tmpPath())).toBe(false);
  });

  it("覆盖写：旧文件被新内容原子替换，读回为新内容", () => {
    writeJsonAtomic(filePath(), { n: 1 });
    writeJsonAtomic(filePath(), { n: 2 });
    expect(JSON.parse(readFileSync(filePath(), "utf8"))).toEqual({ n: 2 });
  });

  it("序列化格式为 2 空格缩进 + 尾部换行", () => {
    writeJsonAtomic(filePath(), { a: 1 });
    const raw = readFileSync(filePath(), "utf8");
    expect(raw).toBe('{\n  "a": 1\n}\n');
  });
});

describe("nowIso 时间辅助", () => {
  it("返回合法 ISO 8601 字符串（应用层写时间约定，schema.md 第 16 行）", () => {
    const iso = nowIso();
    expect(Number.isNaN(Date.parse(iso))).toBe(false);
    // 与 Date 构造可往返
    expect(new Date(iso).toISOString()).toBe(iso);
  });
});
