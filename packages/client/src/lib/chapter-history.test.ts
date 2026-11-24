// 章级历史抽屉的可测逻辑（C2）：列表行文案（相对 / 绝对时间 + 字数 + 与当前字数之差）、
// 空态文案、列表 / 恢复两类失败文案。契约：docs/api/110-api-manuscript.md「章级历史（快照 + 恢复）」。
// 抽屉组件本身（含只读预览）不参与渲染单测——仓内无 jsdom（同 lib/manuscript.test.ts 口径）；
// 叶子列表组件 `ChapterHistoryList` 的 SSR 走查见 components/manuscript/chapter-history-drawer.test.tsx。
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  chapterHistoryRows,
  describeCharDelta,
  formatSnapshotAbsolute,
  formatSnapshotRelative,
  historyErrorText,
  HISTORY_EMPTY_TEXT,
  restoreErrorText,
} from "./chapter-history";

/** 本地时区的某个时刻的 ISO 串（绝对时间按本地时区渲染，断言与运行机器时区无关） */
function isoAt(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

describe("formatSnapshotRelative（相对时间）", () => {
  const now = new Date(2026, 10, 5, 14, 32).getTime();

  it("不足一分钟 → 刚刚；分钟 / 小时 / 天 / 月逐档升级", () => {
    expect(formatSnapshotRelative(isoAt(2026, 11, 5, 14, 32), now)).toBe("刚刚");
    expect(formatSnapshotRelative(isoAt(2026, 11, 5, 14, 2), now)).toBe("30 分钟前");
    expect(formatSnapshotRelative(isoAt(2026, 11, 5, 11, 32), now)).toBe("3 小时前");
    expect(formatSnapshotRelative(isoAt(2026, 10, 31, 14, 32), now)).toBe("5 天前");
    expect(formatSnapshotRelative(isoAt(2026, 9, 6, 14, 32), now)).toBe("2 个月前");
  });

  it("未来时间戳（时钟偏差）按刚刚处理，不出现负数", () => {
    expect(formatSnapshotRelative(isoAt(2026, 11, 5, 14, 35), now)).toBe("刚刚");
  });

  it("坏时间戳 → 时间未知（防御，不抛）", () => {
    expect(formatSnapshotRelative("not-a-date", now)).toBe("时间未知");
  });
});

describe("formatSnapshotAbsolute（绝对时间）", () => {
  it("本地时区 YYYY-MM-DD HH:mm（两位补零）", () => {
    expect(formatSnapshotAbsolute(isoAt(2026, 11, 5, 9, 5))).toBe("2026-11-05 09:05");
  });

  it("坏时间戳 → 时间未知", () => {
    expect(formatSnapshotAbsolute("")).toBe("时间未知");
  });
});

describe("describeCharDelta（比当前少 / 多 N 字）", () => {
  it("更短 → 少 N 字；更长 → 多 N 字；相等 → 与当前字数相同", () => {
    expect(describeCharDelta(340, 500)).toBe("比当前少 160 字");
    expect(describeCharDelta(508, 500)).toBe("比当前多 8 字");
    expect(describeCharDelta(500, 500)).toBe("与当前字数相同");
  });

  it("当前正文为空（0 字）时也按真实差值表达", () => {
    expect(describeCharDelta(0, 0)).toBe("与当前字数相同");
    expect(describeCharDelta(120, 0)).toBe("比当前多 120 字");
  });
});

describe("chapterHistoryRows（列表行 = 顺序 + 四段文案）", () => {
  const now = new Date(2026, 10, 5, 14, 32).getTime();

  it("沿用服务端 seq 降序，不重排", () => {
    const rows = chapterHistoryRows(
      [
        { seq: 9, createdAt: isoAt(2026, 11, 5, 14, 31), charCount: 500 },
        { seq: 8, createdAt: isoAt(2026, 11, 5, 13, 0), charCount: 340 },
      ],
      500,
      now,
    );
    expect(rows.map((row) => row.seq)).toEqual([9, 8]);
  });

  it("每行给相对时间 + 绝对时间 + 字数 + 与当前字数之差", () => {
    const [row] = chapterHistoryRows(
      [{ seq: 8, createdAt: isoAt(2026, 11, 5, 13, 0), charCount: 1240 }],
      1100,
      now,
    );
    expect(row).toEqual({
      seq: 8,
      relative: "1 小时前",
      absolute: "2026-11-05 13:00",
      charCountText: "1.2 千字",
      deltaText: "比当前多 140 字",
    });
  });

  it("空快照字数（0）走「0 字」（formatTextLength 对 0 返回 null 时的兜底）", () => {
    const [row] = chapterHistoryRows(
      [{ seq: 1, createdAt: isoAt(2026, 11, 5, 14, 0), charCount: 0 }],
      30,
      now,
    );
    expect(row.charCountText).toBe("0 字");
    expect(row.deltaText).toBe("比当前少 30 字");
  });

  it("空列表 → 空数组（抽屉据此渲染空态文案）", () => {
    expect(chapterHistoryRows([], 500, now)).toEqual([]);
  });
});

describe("空态文案（本卡选择「抽屉空态」而非「入口禁用」）", () => {
  it("文案说明历史从哪来（不是只写「暂无」）", () => {
    expect(HISTORY_EMPTY_TEXT).toContain("还没有历史版本");
    expect(HISTORY_EMPTY_TEXT).toContain("保存");
  });
});

describe("失败文案（不静默）", () => {
  it("列表 / 预览失败：服务端 message 透出；非 ApiError（网络层）给中文兜底", () => {
    expect(historyErrorText(new ApiError("OUTLINE_NODE_NOT_FOUND", "大纲节点不存在: ch1"))).toBe(
      "大纲节点不存在: ch1",
    );
    expect(historyErrorText(new Error("boom"))).toBe("网络请求失败，无法读取历史版本");
  });

  it("恢复成功前的 404（快照已被裁剪）单独解释并提示已刷新列表", () => {
    expect(restoreErrorText(new ApiError("SNAPSHOT_NOT_FOUND", "快照不存在: 7"))).toBe(
      "该版本已不存在（可能已被清理），已刷新列表",
    );
  });

  it("恢复的其他服务端错误（400 / 409 等）透出 message；网络层失败给重试提示", () => {
    expect(restoreErrorText(new ApiError("DOCUMENT_STALE", "正文已被其他窗口修改"))).toBe(
      "正文已被其他窗口修改",
    );
    expect(restoreErrorText(new TypeError("fetch failed"))).toBe("网络请求失败，请重试");
  });
});