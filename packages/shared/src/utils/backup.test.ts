// 备份文件名纯函数测试（B2.1，决策 27）：<YYYYMMDD-HHmmss>.zip 解析/生成
// 契约来源：doc/database/schema.md「自动备份目录」（时间戳命名）、doc/api/endpoints.md
//   POST /project/backup/restore（fileName 白名单：拒绝路径分隔符 / ..，防路径穿越）
import { describe, expect, it } from "vitest";
import { formatBackupFileName, parseBackupFileName } from "./backup.js";

describe("formatBackupFileName（Date → <YYYYMMDD-HHmmss>.zip）", () => {
  it("本地时间各分量按 2 位补零生成", () => {
    // 本地时区构造（与 parse 对称），2026-08-13 10:15:00
    const date = new Date(2026, 7, 13, 10, 15, 0);
    expect(formatBackupFileName(date)).toBe("20260813-101500.zip");
  });

  it("个位数分量补零（1 月 3 日 5 时 7 分 9 秒）", () => {
    const date = new Date(2026, 0, 3, 5, 7, 9);
    expect(formatBackupFileName(date)).toBe("20260103-050709.zip");
  });
});

describe("parseBackupFileName（<YYYYMMDD-HHmmss>.zip → Date | null）", () => {
  it("合法文件名解析为对应本地时间，与 format 往返一致", () => {
    const date = new Date(2026, 7, 13, 10, 15, 0);
    const name = formatBackupFileName(date);
    expect(parseBackupFileName(name)).toEqual(date);
    // 往返：parse → format 幂等
    expect(formatBackupFileName(parseBackupFileName(name) as Date)).toBe(name);
  });

  it("个位数分量（20260103-050709.zip）解析正确", () => {
    expect(parseBackupFileName("20260103-050709.zip")).toEqual(new Date(2026, 0, 3, 5, 7, 9));
  });

  it("格式不符 → null：路径分隔符 / \\ 与 .. 拒绝（防路径穿越）", () => {
    expect(parseBackupFileName("../20260813-101500.zip")).toBeNull();
    expect(parseBackupFileName("..\\20260813-101500.zip")).toBeNull();
    expect(parseBackupFileName("a/20260813-101500.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101500.zip/..")).toBeNull();
    expect(parseBackupFileName(".backups/20260813-101500.zip")).toBeNull();
  });

  it("格式不符 → null：非 14 位时间戳 / 缺 .zip 后缀 / 非法字符 / 空串", () => {
    expect(parseBackupFileName("20260813-10150.zip")).toBeNull(); // 秒位缺失
    expect(parseBackupFileName("20260813-101500")).toBeNull(); // 无 .zip
    expect(parseBackupFileName("20260813-101500.zip.bak")).toBeNull(); // 多后缀
    expect(parseBackupFileName("2026-08-13-101500.zip")).toBeNull(); // 含分隔符
    expect(parseBackupFileName("abcdefgh-abcdef.zip")).toBeNull(); // 非数字
    expect(parseBackupFileName("20260813-101500.ZIP")).toBeNull(); // 大小写不符
    expect(parseBackupFileName("")).toBeNull();
    expect(parseBackupFileName("20260813-101500.zipx")).toBeNull();
  });

  it("数字合法但日期不存在 → null（Date 滚动进位回读校验拒绝）", () => {
    expect(parseBackupFileName("20261301-101500.zip")).toBeNull(); // 13 月
    expect(parseBackupFileName("20260230-101500.zip")).toBeNull(); // 2 月 30 日
    expect(parseBackupFileName("20260832-101500.zip")).toBeNull(); // 8 月 32 日
    expect(parseBackupFileName("20260813-246000.zip")).toBeNull(); // 24 时
    expect(parseBackupFileName("20260813-106000.zip")).toBeNull(); // 60 分
    expect(parseBackupFileName("20260813-101060.zip")).toBeNull(); // 60 秒
  });
});
