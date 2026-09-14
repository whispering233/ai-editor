// 备份文件名纯函数测试（B2.1 + B2.5 + B2.6 + 云端存档批次 1）
//
// 覆盖：
// - 唯一格式 `<YYYYMMDD-HHmmssSSS>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip` 的生成/解析
//   与「尾部三段固定倒切」的消歧能力
// - 旧命名（秒级 / 带名称无类型段 / 单字母 `-m`/`-a` 段）一律不解析（→ null，文件留盘不识别）
// - 设备名规则（sanitizeDeviceName）与 hostname 派生（deviceNameFromHostname）
// - sanitizeBackupName 规则（标签）
import { describe, expect, it } from "vitest";
import { MAX_BACKUP_NAME_LENGTH, MAX_DEVICE_NAME_LENGTH } from "../constants/backup.js";
import {
  deviceNameFromHostname,
  formatBackupFileName,
  parseBackupFileName,
  sanitizeBackupName,
  sanitizeDeviceName,
} from "./backup.js";

/** 统计段样本（人物32 · 设定58 · 章120） */
const STATS = { characters: 32, settings: 58, chapters: 120 };
/** 标准时间戳（2026-08-13 10:15:30.123 本地时间） */
const AT = new Date(2026, 7, 13, 10, 15, 30, 123);

describe("formatBackupFileName：唯一格式（时间戳 + 类型 + 设备 + 标签 + 统计）", () => {
  it("自动备份（无标签）：<时间戳>-自动-<设备>-人物N-设定N-章N.zip", () => {
    expect(formatBackupFileName(AT, { device: "苹果本", stats: STATS })).toBe(
      "20260813-101530123-自动-苹果本-人物32-设定58-章120.zip",
    );
    expect(formatBackupFileName(AT, { kind: "auto", device: "苹果本", stats: STATS })).toBe(
      "20260813-101530123-自动-苹果本-人物32-设定58-章120.zip",
    );
  });

  it("手动备份（有/无标签）", () => {
    expect(formatBackupFileName(AT, { kind: "manual", device: "苹果本", stats: STATS })).toBe(
      "20260813-101530123-手动-苹果本-人物32-设定58-章120.zip",
    );
    expect(formatBackupFileName(AT, { kind: "manual", name: "定稿", device: "苹果本", stats: STATS })).toBe(
      "20260813-101530123-手动-苹果本-定稿-人物32-设定58-章120.zip",
    );
  });

  it("标签可含连字符（段序固定：标签在设备与统计之间）", () => {
    expect(formatBackupFileName(AT, { name: "大改前-第一版", device: "MacBook_Pro", stats: STATS })).toBe(
      "20260813-101530123-自动-MacBook_Pro-大改前-第一版-人物32-设定58-章120.zip",
    );
  });

  it("空标签不产生空段（无标签 = 无标签段）", () => {
    expect(formatBackupFileName(AT, { name: "", device: "苹果本", stats: STATS })).toBe(
      "20260813-101530123-自动-苹果本-人物32-设定58-章120.zip",
    );
  });

  it("毫秒 3 位补零 + 统计为 0 也照写", () => {
    expect(
      formatBackupFileName(new Date(2026, 0, 3, 5, 7, 9, 5), {
        device: "d",
        stats: { characters: 0, settings: 0, chapters: 0 },
      }),
    ).toBe("20260103-050709005-自动-d-人物0-设定0-章0.zip");
  });
});

describe("parseBackupFileName（→ { time, kind, name?, device, stats } | null）", () => {
  it("唯一格式：与 format 往返一致（自动/手动 + 标签 + 设备 + 统计）", () => {
    const auto = formatBackupFileName(AT, { device: "苹果本", stats: STATS });
    expect(parseBackupFileName(auto)).toEqual({ time: AT, kind: "auto", device: "苹果本", stats: STATS });
    const manual = formatBackupFileName(AT, { kind: "manual", name: "定稿", device: "苹果本", stats: STATS });
    expect(parseBackupFileName(manual)).toEqual({
      time: AT,
      kind: "manual",
      name: "定稿",
      device: "苹果本",
      stats: STATS,
    });
  });

  it("标签含连字符：与设备段不混淆（设备段禁 `-`）", () => {
    expect(parseBackupFileName("20260813-101530123-手动-MacBook_Pro-大改前-第一版-人物32-设定58-章120.zip")).toEqual({
      time: AT,
      kind: "manual",
      device: "MacBook_Pro",
      name: "大改前-第一版",
      stats: STATS,
    });
  });

  it("标签恰好长成统计段的样子：尾部固定三段倒切，不歧义", () => {
    expect(parseBackupFileName("20260813-101530123-自动-苹果本-人物99-人物32-设定58-章120.zip")).toEqual({
      time: AT,
      kind: "auto",
      device: "苹果本",
      name: "人物99",
      stats: STATS,
    });
  });

  it("多位统计数字 + 中文类型段（自动/手动）解析", () => {
    const parsed = parseBackupFileName("20260813-101530123-手动-设备甲-人物1234-设定5678-章9999.zip");
    expect(parsed?.stats).toEqual({ characters: 1234, settings: 5678, chapters: 9999 });
    expect(parsed?.kind).toBe("manual");
    expect(parsed?.name).toBeUndefined();
    expect(parseBackupFileName("20260813-101530123-自动-设备甲-人物0-设定0-章0.zip")?.kind).toBe("auto");
  });

  it("缺统计段/缺设备段的文件名不被唯一格式吞掉：一律 null（格式完整是硬要求）", () => {
    expect(parseBackupFileName("20260813-101530123-自动-苹果本.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101530123-手动-苹果本-定稿-人物32-设定58.zip")).toBeNull();
  });

  it("三类旧命名一律 null（秒级 / 带名称无类型段 / 单字母 -m/-a 段）", () => {
    expect(parseBackupFileName("20260813-101500.zip")).toBeNull(); // 旧秒级
    expect(parseBackupFileName("20260813-101530123-初稿.zip")).toBeNull(); // 旧带名称（无类型段）
    expect(parseBackupFileName("20260813-101530123-定稿-最终版 v2.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101530123-定稿.v2.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101530123-m.zip")).toBeNull(); // 旧单字母类型段
    expect(parseBackupFileName("20260813-101530123-a.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101530123-m-定稿.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101530123-a-定稿.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101530123-m-定稿-最终版.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101530123-m-.zip")).toBeNull(); // 类型段后空名称
    expect(parseBackupFileName("20260813-101530123-m-苹果本-人物1-设定2-章3.zip")).toBeNull(); // 单字母段 + 设备/统计
    expect(parseBackupFileName("20260813-101530123-随意-设备-人物1-设定2-章3.zip")).toBeNull(); // 类型段仅接受 手动/自动
  });

  it("个位数分量（20260103-050709123-自动-d-人物1-设定2-章3.zip）解析正确（kind auto）", () => {
    const parsed = parseBackupFileName("20260103-050709123-自动-d-人物1-设定2-章3.zip");
    expect(parsed?.time).toEqual(new Date(2026, 0, 3, 5, 7, 9, 123));
    expect(parsed?.kind).toBe("auto");
  });

  it("格式不符 → null：路径分隔符 / \\ 与 .. 拒绝（防路径穿越，含标签部分）", () => {
    expect(parseBackupFileName("../20260813-101500123.zip")).toBeNull();
    expect(parseBackupFileName("..\\20260813-101500123.zip")).toBeNull();
    expect(parseBackupFileName("a/20260813-101500123.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101500123.zip/..")).toBeNull();
    expect(parseBackupFileName(".backups/20260813-101500123.zip")).toBeNull();
    expect(parseBackupFileName("20260813-101500123-自动-设备-标/签-人物1-设定2-章3.zip")).toBeNull(); // 标签含 /
    expect(parseBackupFileName("20260813-101500123-自动-设备-标\\签-人物1-设定2-章3.zip")).toBeNull(); // 标签含 \\
    expect(parseBackupFileName("20260813-101500123-自动-设备/甲-人物1-设定2-章3.zip")).toBeNull(); // 设备含 /
    expect(parseBackupFileName("20260813-101500123-自动-设备-定稿/甲-人物1-设定2-章3.zip")).toBeNull(); // 标签含 /
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
    expect(parseBackupFileName("20260813-101500123-.zip")).toBeNull(); // 无类型段
    expect(parseBackupFileName("20260813-101500123-自动-.zip")).toBeNull(); // 类型段后无设备/统计段
  });

  it("数字合法但日期不存在 → null（Date 滚动进位回读校验拒绝，含毫秒进位）", () => {
    expect(parseBackupFileName("20261301-101500123-自动-设备-人物1-设定2-章3.zip")).toBeNull(); // 13 月
    expect(parseBackupFileName("20260230-101500123-自动-设备-人物1-设定2-章3.zip")).toBeNull(); // 2 月 30 日
    expect(parseBackupFileName("20260832-101500123-自动-设备-人物1-设定2-章3.zip")).toBeNull(); // 8 月 32 日
    expect(parseBackupFileName("20260813-246000123-自动-设备-人物1-设定2-章3.zip")).toBeNull(); // 24 时
    expect(parseBackupFileName("20260813-106000123-自动-设备-人物1-设定2-章3.zip")).toBeNull(); // 60 分
    expect(parseBackupFileName("20260813-101060123-自动-设备-人物1-设定2-章3.zip")).toBeNull(); // 60 秒
    expect(parseBackupFileName("20260813-1015309999-自动-设备-人物1-设定2-章3.zip")).toBeNull(); // 4 位毫秒
  });
});

describe("sanitizeDeviceName（设备名规则，写侧权威校验）", () => {
  it("合法：中文 / 字母数字 / 下划线 / 点 / 空格", () => {
    expect(sanitizeDeviceName("苹果本")).toBe("苹果本");
    expect(sanitizeDeviceName("MacBook_Pro")).toBe("MacBook_Pro");
    expect(sanitizeDeviceName("DESKTOP_8K3J9F2")).toBe("DESKTOP_8K3J9F2");
    expect(sanitizeDeviceName("家里的台式机")).toBe("家里的台式机");
    expect(sanitizeDeviceName(" 客厅 iMac ")).toBe("客厅 iMac");
  });

  it("禁连字符（段分隔符——含 `-` 则设备段与标签段不可分）", () => {
    expect(sanitizeDeviceName("MacBook-Pro")).toBeNull();
    expect(sanitizeDeviceName("a-b")).toBeNull();
  });

  it("trim 后空 / 超长 / 纯点 / 路径分隔符与保留字符 / 控制字符 → null", () => {
    expect(sanitizeDeviceName("")).toBeNull();
    expect(sanitizeDeviceName("   ")).toBeNull();
    expect(sanitizeDeviceName(".".repeat(3))).toBeNull();
    expect(sanitizeDeviceName("a".repeat(MAX_DEVICE_NAME_LENGTH))).toBe("a".repeat(MAX_DEVICE_NAME_LENGTH));
    expect(sanitizeDeviceName("a".repeat(MAX_DEVICE_NAME_LENGTH + 1))).toBeNull();
    for (const bad of ["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", "a\nb"]) {
      expect(sanitizeDeviceName(bad)).toBeNull();
    }
  });
});

describe("deviceNameFromHostname（主机名 → 缺省设备名）", () => {
  it("去域名后缀（MacBook-Pro.local → MacBook_Pro：连字符转下划线）", () => {
    expect(deviceNameFromHostname("MacBook-Pro.local")).toBe("MacBook_Pro");
    expect(deviceNameFromHostname("host.example.com")).toBe("host");
  });

  it("Windows 风格主机名（连字符转下划线）", () => {
    expect(deviceNameFromHostname("DESKTOP-8K3J9F2")).toBe("DESKTOP_8K3J9F2");
  });

  it("非法字符转下划线、连续下划线归并、去首尾下划线（空格本身合法，保留）", () => {
    expect(deviceNameFromHostname("a b:c")).toBe("a b_c");
    expect(deviceNameFromHostname("--a--b--")).toBe("a_b");
    expect(deviceNameFromHostname("主机:甲")).toBe("主机_甲");
  });

  it("首尾空白一律剥除（空格 / 制表符 / NBSP）——含剥后为空与截断后再剥两类", () => {
 // oracle 实测反例：截断处落在空白上（5 例）
    expect(deviceNameFromHostname("aaaaaaaaaaaaaaa bcdef")).toBe("aaaaaaaaaaaaaaa");
    expect(deviceNameFromHostname(" ? 99|")).toBe("99");
    expect(deviceNameFromHostname("?>//-<\t   ~")).toBe("~");
    expect(deviceNameFromHostname("<<| a~:")).toBe("a~");
    expect(deviceNameFromHostname("\u00a0甲\u00a0")).toBe("甲"); // NBSP 也算空白（trim 口径）
 // 剥后为空（含纯空白 / 只剩分隔符）→ unknown
    expect(deviceNameFromHostname("_ _:>")).toBe("unknown");
    expect(deviceNameFromHostname("   ")).toBe("unknown");
    expect(deviceNameFromHostname("\t \u00a0")).toBe("unknown");
  });

  it("首尾空白与 `_` 的剥除在截断前做（`__abc__` 类不残留）", () => {
    expect(deviceNameFromHostname("__abc__")).toBe("abc");
    expect(deviceNameFromHostname("__" + "a".repeat(20) + "__")).toBe("a".repeat(MAX_DEVICE_NAME_LENGTH));
    expect(deviceNameFromHostname("__ _ __")).toBe("unknown");
  });

  it("超长截断到 MAX_DEVICE_NAME_LENGTH，且截断后不残留尾随下划线", () => {
    const long = "a".repeat(MAX_DEVICE_NAME_LENGTH + 5);
    expect(deviceNameFromHostname(long)).toBe("a".repeat(MAX_DEVICE_NAME_LENGTH));
    // 第 16 位恰为 `_` → 截断后再去尾部下划线
    expect(deviceNameFromHostname(`${"a".repeat(15)}-bcd`)).toBe("a".repeat(15));
  });

  it("空 / 纯点 / 全非法字符主机名 → unknown", () => {
    expect(deviceNameFromHostname("")).toBe("unknown");
    expect(deviceNameFromHostname("...")).toBe("unknown");
    expect(deviceNameFromHostname("---")).toBe("unknown");
    expect(deviceNameFromHostname("   ")).toBe("unknown");
  });

  it("结果必然通过 sanitizeDeviceName（样本矩阵 + 长度边界）", () => {
    const samples = [
      "MacBook-Pro.local",
      "DESKTOP-8K3J9F2",
      "whispering2333",
      "host.example.com",
      "a b:c",
      "---",
      "",
      "主机:甲",
      "a".repeat(40),
      `${"a".repeat(15)}-bcd`,
    ];
    for (const s of samples) {
      const device = deviceNameFromHostname(s);
      expect(sanitizeDeviceName(device)).toBe(device);
    }
  });

  it("不变式（恒合法且已规范）：sanitizeDeviceName(d) === d 且非 null——含空白/分隔符边界样本矩阵", () => {
 // oracle 验证轮（卡 1）实测的 277 样本里的失败集 + 边界集：修前 44 例非幂等、1 例被 sanitize 拒绝
    const samples = [
      "_ _:>",
      " ? 99|",
      " \t甲甲\\ZZ9\t<\\ /*",
      "?>//-<\t   ~",
      "<<| a~:",
      "/\t🙂-9|<-\\_9<?|-🙂|\\Z ?",
      "aaaaaaaaaaaaaaa bcdef",
      "aaaaaaaaaaaaaaa-",
      `${"a".repeat(15)} `,
      " ",
      "\t",
      "\u00a0",
      "   ",
      "...",
      "---",
      "__abc__",
      "__ _ __",
      "",
      "a".repeat(64),
      `${"a".repeat(15)}-bcd`,
      "主机:甲",
      "MacBook-Pro.local",
    ];
    for (const h of samples) {
      const device = deviceNameFromHostname(h);
      expect(sanitizeDeviceName(device)).toBe(device); // 等价于同时挡住 null 与首尾空白
      expect(device.length).toBeLessThanOrEqual(MAX_DEVICE_NAME_LENGTH);
      expect(device).not.toContain("-");
      expect(device.trim()).toBe(device);
    }
  });
});

describe("sanitizeBackupName（标签规则，写侧权威校验）", () => {
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
