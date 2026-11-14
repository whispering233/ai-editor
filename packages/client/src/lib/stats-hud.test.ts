// 码字悬浮面板位置（`lib/stats-hud.ts`）：坏 JSON / 缺字段 / 负数回落、越界 clamp、
// 默认槽位（right 16 / bottom 72）、宿主收缩后重新 clamp、位置读写容错。
// 契约 = DESIGN.md「当日码字悬浮面板」→「拖动 / 持久化」。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampStatsPanelPosition,
  defaultStatsPanelPosition,
  parseStatsPanelPosition,
  readStatsPanelPosition,
  resolveStatsPanelPosition,
  writeStatsPanelPosition,
  STATS_PANEL_ENTRY_BOTTOM,
  STATS_PANEL_ENTRY_INSET_END,
  STATS_PANEL_MARGIN,
  STATS_PANEL_STORAGE_KEY,
  STATS_PANEL_WIDTH,
} from "./stats-hud";

const size = { width: STATS_PANEL_WIDTH, height: 200 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseStatsPanelPosition", () => {
  it("合法 JSON → 位置", () => {
    expect(parseStatsPanelPosition('{"left":120,"top":40}')).toEqual({ left: 120, top: 40 });
    expect(parseStatsPanelPosition('{"left":0,"top":0}')).toEqual({ left: 0, top: 0 });
  });

  it("坏 JSON / null → null", () => {
    expect(parseStatsPanelPosition("{坏 JSON")).toBeNull();
    expect(parseStatsPanelPosition("null")).toBeNull();
    expect(parseStatsPanelPosition(null)).toBeNull();
  });

  it("缺字段 / 非数字 / 非有限 → null", () => {
    expect(parseStatsPanelPosition('{"left":100}')).toBeNull();
    expect(parseStatsPanelPosition('{"left":"100","top":20}')).toBeNull();
    expect(parseStatsPanelPosition('{"left":1e999,"top":20}')).toBeNull();
  });

  it("负数 → null（回落默认槽位）", () => {
    expect(parseStatsPanelPosition('{"left":-1,"top":20}')).toBeNull();
    expect(parseStatsPanelPosition('{"left":20,"top":-999}')).toBeNull();
  });
});

describe("clampStatsPanelPosition", () => {
  const bounds = { width: 800, height: 600 };

  it("越界收敛到 8px 边距以内（右下 / 左上两侧）", () => {
    expect(clampStatsPanelPosition({ left: 5_000, top: 5_000 }, bounds, size)).toEqual({
      left: 800 - STATS_PANEL_WIDTH - STATS_PANEL_MARGIN,
      top: 600 - 200 - STATS_PANEL_MARGIN,
    });
    expect(clampStatsPanelPosition({ left: -50, top: -50 }, bounds, size)).toEqual({
      left: STATS_PANEL_MARGIN,
      top: STATS_PANEL_MARGIN,
    });
  });

  it("宿主收缩后重新 clamp（原位置落回矩形内）", () => {
    const saved = { left: 700, top: 500 };
    expect(clampStatsPanelPosition(saved, { width: 600, height: 400 }, size)).toEqual({
      left: 600 - STATS_PANEL_WIDTH - STATS_PANEL_MARGIN,
      top: 400 - 200 - STATS_PANEL_MARGIN,
    });
  });

  it("宿主比面板还小时贴左上边距（不产生负坐标）", () => {
    expect(clampStatsPanelPosition({ left: 10, top: 10 }, { width: 100, height: 100 }, size)).toEqual(
      { left: STATS_PANEL_MARGIN, top: STATS_PANEL_MARGIN },
    );
  });
});

describe("defaultStatsPanelPosition", () => {
  it("默认贴右下的「问 AI」正上方槽位（right 16 / bottom 72）", () => {
    const bounds = { width: 800, height: 600 };
    expect(defaultStatsPanelPosition(bounds, size)).toEqual({
      left: 800 - STATS_PANEL_WIDTH - STATS_PANEL_ENTRY_INSET_END,
      top: 600 - 200 - STATS_PANEL_ENTRY_BOTTOM,
    });
  });

  it("小宿主也落在 8px 边距内", () => {
    expect(defaultStatsPanelPosition({ width: 100, height: 100 }, size)).toEqual({
      left: STATS_PANEL_MARGIN,
      top: STATS_PANEL_MARGIN,
    });
  });
});

describe("resolveStatsPanelPosition（首次放置）", () => {
  const bounds = { width: 800, height: 600 };

  it("界内位置沿用；越界 / 无保存值回落默认槽位", () => {
    const inside = { left: 100, top: 100 };
    expect(resolveStatsPanelPosition(inside, bounds, size)).toEqual(inside);
    expect(resolveStatsPanelPosition({ left: 700, top: 500 }, { width: 600, height: 400 }, size)).toEqual(
      defaultStatsPanelPosition({ width: 600, height: 400 }, size),
    );
    expect(resolveStatsPanelPosition(null, bounds, size)).toEqual(
      defaultStatsPanelPosition(bounds, size),
    );
  });
});

describe("位置读写", () => {
  function stubStorage(initial: string | null) {
    const store = new Map<string, string>();
    if (initial !== null) store.set(STATS_PANEL_STORAGE_KEY, initial);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    return store;
  }

  it("写后可读回；坏值回落 null", () => {
    stubStorage('{"left":12,"top":"坏"}');
    expect(readStatsPanelPosition()).toBeNull();
    writeStatsPanelPosition({ left: 48, top: 96 });
    expect(readStatsPanelPosition()).toEqual({ left: 48, top: 96 });
  });

  it("无 localStorage（或抛错）时静默：读 null、写不抛", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(readStatsPanelPosition()).toBeNull();
    expect(() => writeStatsPanelPosition({ left: 1, top: 2 })).not.toThrow();
  });
});