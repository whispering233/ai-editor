// 章正文页可测逻辑（卡 12.5）：自动保存调度（假定时器）、相邻章推导、字数文案、错误码分流。
// 页面组件（含 BlockNote 编辑器）不参与单测——仓内无 jsdom，BlockNote 内部不测（tasks.md 卡 12.5 口径）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutlineTree } from "@whispering233/ai-editor-shared";
import {
  AUTOSAVE_DELAY_MS,
  chapterNeighbors,
  createAutosave,
  formatTextLength,
  manuscriptErrorAction,
} from "./manuscript";

describe("createAutosave（空闲落盘 / flush / 丢弃）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("空闲到点才落盘；连续输入只提交最后一次内容", async () => {
    const save = vi.fn<(content: string) => Promise<void>>(async () => {});
    const autosave = createAutosave({ delayMs: AUTOSAVE_DELAY_MS, save });

    autosave.schedule("第一版");
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled(); // 未到空闲时长：不落盘
    autosave.schedule("第二版"); // 新输入重置计时
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith("第二版"));
    expect(save).toHaveBeenCalledTimes(1); // 中间版本被折叠丢弃
  });

  it("flush 立即提交待存内容（不等计时），无待存内容时是 no-op", async () => {
    const save = vi.fn<(content: string) => Promise<void>>(async () => {});
    const autosave = createAutosave({ delayMs: AUTOSAVE_DELAY_MS, save });

    await autosave.flush();
    expect(save).not.toHaveBeenCalled(); // 无待存 = 不发请求

    autosave.schedule("未落盘内容");
    await autosave.flush();
    expect(save).toHaveBeenCalledWith("未落盘内容");
    // flush 已提交：原计时器被取消，不会再重复提交
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("reset 丢弃待存内容（409 冲突「重新加载」后不得回写）", async () => {
    const save = vi.fn<(content: string) => Promise<void>>(async () => {});
    const autosave = createAutosave({ delayMs: AUTOSAVE_DELAY_MS, save });

    autosave.schedule("本地改动");
    autosave.reset();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS + 1);
    await autosave.flush();
    expect(save).not.toHaveBeenCalled();
  });
});

/** 造树：卷1（第1章、第2章）、卷2（第3章）+ 存量根级章 */
function tree(): OutlineTree {
  const chapter = (id: string, title: string, textLength?: number) => ({
    id,
    type: "chapter" as const,
    title,
    updatedAt: "t",
    ...(textLength !== undefined ? { metadata: { textLength } } : {}),
  });
  return {
    id: "root",
    type: "root",
    schemaVersion: 1,
    children: [
      { id: "vol-1", type: "volume", title: "第一卷", updatedAt: "t", children: [chapter("ch-1", "雪夜"), chapter("ch-2", "旧盟")] },
      { id: "vol-2", type: "volume", title: "第二卷", updatedAt: "t", children: [chapter("ch-3", "归途")] },
      chapter("ch-9", "根级章"),
    ],
  };
}

describe("chapterNeighbors（阅读序相邻章：卷序 → 卷内章序）", () => {
  const ids = (id: string) => {
    const { prev, next } = chapterNeighbors(tree(), id);
    return { prev: prev?.chapter.id ?? null, next: next?.chapter.id ?? null };
  };

  it("中间章：两侧都有；跨卷也接得上（ch-2 → ch-3）", () => {
    expect(ids("ch-1")).toEqual({ prev: null, next: "ch-2" });
    expect(ids("ch-2")).toEqual({ prev: "ch-1", next: "ch-3" });
    expect(ids("ch-3")).toEqual({ prev: "ch-2", next: "ch-9" }); // 跨卷 + 存量根级章
  });

  it("末章：下一章为 null（页面据此禁用按钮）", () => {
    expect(ids("ch-9")).toEqual({ prev: "ch-3", next: null });
  });

  it("章不在树上（已软删/已 purge）/ 树未加载：两侧皆 null", () => {
    expect(ids("ch-404")).toEqual({ prev: null, next: null });
    expect(chapterNeighbors(null, "ch-1")).toEqual({ prev: null, next: null });
  });
});

describe("formatTextLength（字数文案：0 不显示）", () => {
  it("0 / 负值 / 非法值 → null（调用方省略该处文案）", () => {
    expect(formatTextLength(0)).toBeNull();
    expect(formatTextLength(-1)).toBeNull();
    expect(formatTextLength(Number.NaN)).toBeNull();
  });

  it("不足千字：按字；千字以上：千字一位小数、整数不带 .0", () => {
    expect(formatTextLength(1)).toBe("1 字");
    expect(formatTextLength(999)).toBe("999 字");
    expect(formatTextLength(1000)).toBe("1 千字");
    expect(formatTextLength(1200)).toBe("1.2 千字");
    expect(formatTextLength(12345)).toBe("12.3 千字");
  });
});

describe("manuscriptErrorAction（正文端点错误码 → 页面动作）", () => {
  it("409 → 冲突对话框；404 → 页面 404 态；其余 → 错误条 + 重试", () => {
    expect(manuscriptErrorAction("DOCUMENT_STALE")).toBe("conflict");
    expect(manuscriptErrorAction("OUTLINE_NODE_NOT_FOUND")).toBe("missing");
    expect(manuscriptErrorAction("VALIDATION_ERROR")).toBe("retry"); // 非章节点（400）
    expect(manuscriptErrorAction("CLIENT_NETWORK_ERROR")).toBe("retry");
    expect(manuscriptErrorAction(null)).toBe("retry");
  });
});
