// 备份文件名纯函数测试（B2.1 决策 27 + B2.5 决策 28 + B2.6 决策 29）：毫秒级
//   <YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip 生成/解析、类型标签（auto/manual）、
//   自定义名称、旧格式兼容、sanitizeBackupName 规则
// 契约来源：doc/database/schema.md「自动备份目录」（时间戳命名）、doc/api/endpoints.md
//   POST /project/backup/restore（fileName 白名单：拒绝路径分隔符 / ..，防路径穿越）
import { describe, expect, it } from "vitest";
import { MAX_BACKUP_NAME_LENGTH } from "../constants/backup.js";
import { formatBackupFileName, parseBackupFileName, sanitizeBackupName } from "./backup.js";

describe("formatBackupFileName（Date → <YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip，决策 28 毫秒 + 决策 29 kind 段）", () => {
  it("本地时间各分量按 2 位补零 + 毫秒 3 位补零生成（kind 缺省 auto 无名称 → 纯时间戳）", () => {
    const date = new Date(2026, 7, 13, 10, 15, 30, 123);
    expect(formatBackupFileName(date)).toBe("20260813-101530123.zip");
    expect(formatBackupFileName(date, { kind: "auto" })).toBe("20260813-101530123.zip");
  });

  it("毫秒个位补零（5 毫秒 → 005）", () => {
    const date = new Date(2026, 0, 3, 5, 7, 9, 5);
    expect(formatBackupFileName(date)).toBe("20260103-050709005.zip");
  });

  it("毫秒为 0 也输出 3 位（000）", () => {
    const date = new Date(2026, 7, 13, 10, 15, 30, 0);
    expect(formatBackupFileName(date)).toBe("20260813-101530000.zip");
  });

  it("四类输出（决策 29）：auto 无名称纯时间戳 / auto 带名称 -a- / manual 无名称 -m / manual 带名称 -m-", () => {
    const date = new Date(2026, 7, 13, 10, 15, 30, 123);
    expect(formatBackupFileName(date, { kind: "auto" })).toBe("20260813-101530123.zip");
    expect(formatBackupFileName(date, { kind: "auto", name: "定稿" })).toBe("20260813-101530123-a-定稿.zip");
    expect(formatBackupFileName(date, { kind: "manual" })).toBe("20260813-101530123-m.zip");
    expect(formatBackupFileName(date, { kind: "manual", name: "定稿" })).toBe("20260813-101530123-m-定稿.zip");
  });

  it("kind 缺省 auto：仅传名称 → -a-<名称> 段（决策 29）", () => {
    const date = new Date(2026, 7, 13, 10, 15, 30, 123);
    expect(formatBackupFileName(date, { name: "定稿" })).toBe("20260813-101530123-a-定稿.zip");
  });

  it("名称为空串 → 不拼接名称（auto → 纯时间戳）", () => {
    const date = new Date(2026, 7, 13, 10, 15, 30, 123);
    expect(formatBackupFileName(date, { name: "" })).toBe("20260813-101530123.zip");
    expect(formatBackupFileName(date, { kind: "manual", name: "" })).toBe("20260813-101530123-m.zip");
  });
});

describe("parseBackupFileName（→ { time, kind, name? } | null，决策 28 + 决策 29）", () => {
  it("新格式毫秒级文件名解析为对应本地时间 + kind auto，与 format 往返一致", () => {
    const date = new Date(2026, 7, 13, 10, 15, 30, 123);
    const name = formatBackupFileName(date);
    const parsed = parseBackupFileName(name);
    expect(parsed).toEqual({ time: date, kind: "auto" });
    expect(formatBackupFileName(parsed!.time)).toBe(name);
  });

  it("新格式 kind 段解析（决策 29）：-m.zip → manual 无名称；-m-名称 → manual+名称；-a-名称 → auto+名称", () => {
    expect(parseBackupFileName("20260813-101530123-m.zip")).toEqual({
      time: new Date(2026, 7, 13, 10, 15, 30, 123),
      kind: "manual",
    });
    expect(parseBackupFileName("20260813-101530123-m-定稿.zip")).toEqual({
      time: new Date(2026, 7, 13, 10, 15, 30, 123),
      kind: "manual",
      name: "定稿",
    });
    expect(parseBackupFileName("20260813-101530123-a-定稿.zip")).toEqual({
      time: new Date(2026, 7, 13, 10, 15, 30, 123),
      kind: "auto",
      name: "定稿",
    });
    // 新格式名称可含连字符（oracle P2-5）：-m-定稿-最终版.zip → manual + 名称「定稿-最终版」
    expect(parseBackupFileName("20260813-101530123-m-定稿-最终版.zip")).toEqual({
      time: new Date(2026, 7, 13, 10, 15, 30, 123),
      kind: "manual",
      name: "定稿-最终版",
    });
  });

  it("kind 段后空名称（-m-.zip）→ 新格式不匹配，回退旧带名称解析为 manual + 名称「m-」（oracle P2-5 钉死现状）", () => {
    // 新格式要求名称 ≥1 字符：-m- 后空 → 正则 1 整组回退；旧带名称正则把「m-」当作名称
    expect(parseBackupFileName("20260813-101530123-m-.zip")).toEqual({
      time: new Date(2026, 7, 13, 10, 15, 30, 123),
      kind: "manual",
      name: "m-",
    });
  });

  it("歧义用例（决策 29，接受）：旧「名称恰为单字母 a/m」的备份按新格式解析为 kind 标记（无名称）", () => {
    // 旧带名称格式 <时间戳>-m.zip / -a.zip（名称恰为单字母）→ 按新格式 kind 段解析：
    // -m.zip → manual 无名称、-a.zip → auto 无名称
    expect(parseBackupFileName("20260813-101530123-m.zip")?.kind).toBe("manual");
    expect(parseBackupFileName("20260813-101530123-m.zip")?.name).toBeUndefined();
    expect(parseBackupFileName("20260813-101530123-a.zip")?.kind).toBe("auto");
    expect(parseBackupFileName("20260813-101530123-a.zip")?.name).toBeUndefined();
  });

  it("旧带名称（无 kind 段，决策 28 格式）解析出 time/name + kind manual（兼容为手动）", () => {
    const parsed = parseBackupFileName("20260813-101530123-定稿-最终版 v2.zip");
    expect(parsed?.time).toEqual(new Date(2026, 7, 13, 10, 15, 30, 123));
    expect(parsed?.kind).toBe("manual");
    expect(parsed?.name).toBe("定稿-最终版 v2");
  });

  it("名称含点（v1.2 类）合法解析（旧带名称格式 → kind manual）", () => {
    const parsed = parseBackupFileName("20260813-101530123-定稿.v2.zip");
    expect(parsed?.name).toBe("定稿.v2");
    expect(parsed?.kind).toBe("manual");
    expect(parsed?.time.getMilliseconds()).toBe(123);
  });

  it("旧秒级格式兼容解析（决策 28/29 不迁移；毫秒 = 0、无名称、kind auto）", () => {
    const parsed = parseBackupFileName("20260813-101500.zip");
    expect(parsed).toEqual({ time: new Date(2026, 7, 13, 10, 15, 0), kind: "auto" });
    expect(parsed?.time.getMilliseconds()).toBe(0);
    expect(parsed?.name).toBeUndefined();
  });

  it("个位数分量（20260103-050709123.zip）解析正确（kind auto）", () => {
    const parsed = parseBackupFileName("20260103-050709123.zip");
    expect(parsed?.time).toEqual(new Date(2026, 0, 3, 5, 7, 9, 123));
    expect(parsed?.kind).toBe("auto");
  });

  it("格式不符 → null：路径分隔符 / \\ 与 .. 拒绝（防路径穿越，含名称部分）", () => {
    expect(parseBackupFileName("../20260813-101500123.zip")).toBeNull();
    expect(parseBackupFileName("..\\20260813-101500123.zip")).toBeNull();
    expect(parseBackupFileName("a/20260813-101500123.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101500123.zip/..")).toBeNull();
    expect(parseBackupFileName(".backups/20260813-101500123.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101500123-a/b.zip")).toBeNull(); // 名称含 /
    expect(parseBackupFileName("20260813-101500123-a\\b.zip")).toBeNull(); // 名称含 \\
    expect(parseBackupFileName("20260813-101500123-m-a/b.zip")).toBeNull(); // 新格式名称含 /
    expect(parseBackupFileName("20260813-101500123-m-a\\b.zip")).toBeNull(); // 新格式名称含 \\
  });

  it("格式不符 → null：非 17 位时间戳 / 缺 .zip 后缀 / 非法字符 / 空串", () => {
    expect(parseBackupFileName("20260813-10150.zip")).toBeNull(); // 秒位缺失
    expect(parseBackupFileName("20260813-101500123")).toBeNull(); // 无 .zip
    expect(parseBackupFileName("20260813-101500123.zip.bak")).toBeNull(); // 多后缀
    expect(parseBackupFileName("2026-08-13-101500123.zip")).toBeNull(); // 含分隔符
    expect(parseBackupFileName("abcdefgh-abcdef123.zip")).toBeNull(); // 非数字
    expect(parseBackupFileName("20260813-101500123.ZIP")).toBeNull(); // 大小写不符
    expect(parseBackupFileName("")).toBeNull();
    expect(parseBackupFileName("20260813-101500123.zipx")).toBeNull();
    expect(parseBackupFileName("20260813-101500123-.zip")).toBeNull(); // 空名称（-后无字符）
    expect(parseBackupFileName("20260813-101500123-a-.zip")?.name).toBe("a-"); // 新格式空名称不匹配 → 回退旧带名称（名称 "a-"）
    // kind 段仅接受 a/m：其他单字母（如 x）按旧带名称回退解析（决策 28 备份名 "x" 仍可解析/恢复）
    expect(parseBackupFileName("20260813-101500123-x.zip")).toEqual({
      time: new Date(2026, 7, 13, 10, 15, 0, 123),
      kind: "manual",
      name: "x",
    });
  });

  it("数字合法但日期不存在 → null（Date 滚动进位回读校验拒绝，含毫秒进位）", () => {
    expect(parseBackupFileName("20261301-101500123.zip")).toBeNull(); // 13 月
    expect(parseBackupFileName("20260230-101500123.zip")).toBeNull(); // 2 月 30 日
    expect(parseBackupFileName("20260832-101500123.zip")).toBeNull(); // 8 月 32 日
    expect(parseBackupFileName("20260813-246000123.zip")).toBeNull(); // 24 时
    expect(parseBackupFileName("20260813-106000123.zip")).toBeNull(); // 60 分
    expect(parseBackupFileName("20260813-101060123.zip")).toBeNull(); // 60 秒
    expect(parseBackupFileName("20260813-1015309999.zip")).toBeNull(); // 4 位毫秒
  });
});

describe("sanitizeBackupName（决策 28 名称规则，写侧权威校验）", () => {
  it("合法名称原样返回（中文/空格/连字符/点/括号）", () => {
    expect(sanitizeBackupName("定稿")).toBe("定稿");
    expect(sanitizeBackupName("初稿-最终版 v2")).toBe("初稿-最终版 v2");
    expect(sanitizeBackupName("交编辑前 (2)")).toBe("交编辑前 (2)");
  });

  it("trim 前后空白 + 自动剥离尾部 .zip（含大写 .ZIP）", () => {
    expect(sanitizeBackupName("  定稿  ")).toBe("定稿");
    expect(sanitizeBackupName("定稿.zip")).toBe("定稿");
    expect(sanitizeBackupName("定稿.ZIP")).toBe("定稿");
  });

  it("循环剥尽尾部 .zip（oracle P2-2：「定稿.zip.zip」→「定稿」，不产生双 .zip 文件名）", () => {
    expect(sanitizeBackupName("定稿.zip.zip")).toBe("定稿");
    expect(sanitizeBackupName("定稿.ZIP.zip")).toBe("定稿");
    expect(sanitizeBackupName("a.zip.zip.zip")).toBe("a");
  });

  it("空串/纯空白/仅 .zip → null", () => {
    expect(sanitizeBackupName("")).toBeNull();
    expect(sanitizeBackupName("   ")).toBeNull();
    expect(sanitizeBackupName(".zip")).toBeNull();
  });

  it("超长（> MAX_BACKUP_NAME_LENGTH）→ null", () => {
    expect(sanitizeBackupName("a".repeat(MAX_BACKUP_NAME_LENGTH))).toBe("a".repeat(MAX_BACKUP_NAME_LENGTH));
    expect(sanitizeBackupName("a".repeat(MAX_BACKUP_NAME_LENGTH + 1))).toBeNull();
    // 剥 .zip 前超长但剥离后不超长 → 合法（先剥后判长）
    expect(sanitizeBackupName("a".repeat(MAX_BACKUP_NAME_LENGTH) + ".zip")).toBe("a".repeat(MAX_BACKUP_NAME_LENGTH));
    // 剥 .zip 后仍超长 → null
    expect(sanitizeBackupName("a".repeat(MAX_BACKUP_NAME_LENGTH + 1) + ".zip")).toBeNull();
  });

  it("路径分隔符/保留字符/控制字符 → null", () => {
    expect(sanitizeBackupName("a/b")).toBeNull();
    expect(sanitizeBackupName("a\\b")).toBeNull();
    expect(sanitizeBackupName("a:b")).toBeNull();
    expect(sanitizeBackupName("a*b")).toBeNull();
    expect(sanitizeBackupName("a?b")).toBeNull();
    expect(sanitizeBackupName("a\"b")).toBeNull();
    expect(sanitizeBackupName("a<b")).toBeNull();
    expect(sanitizeBackupName("a>b")).toBeNull();
    expect(sanitizeBackupName("a|b")).toBeNull();
    expect(sanitizeBackupName("a\nb")).toBeNull(); // 控制字符
  });

  it("纯点（. / ..）→ null", () => {
    expect(sanitizeBackupName(".")).toBeNull();
    expect(sanitizeBackupName("..")).toBeNull();
    expect(sanitizeBackupName("...")).toBeNull();
  });
});