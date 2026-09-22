// 会话状态栏视图口径测试（contract = DESIGN.md `session-status-bar` + docs/design/20-context.md §2.1）
// 覆盖面：compact 格式化（k / M 边界）、占用段三态与占比取色阈值、段清单与窄栏优先级/阈值常量、
// 行级 title 组装。数字口径全部由服务端下发，本模块只格式化——故用例只断言渲染值，不重算账目。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChatUsage } from "@whispering233/ai-editor-shared";
import {
  compactCost,
  compactSpeed,
  compactTokens,
  CONTEXT_ERROR_PERCENT,
  CONTEXT_WARN_PERCENT,
  contextBarColor,
  sessionStatusView,
  STATUS_CRAMPED_WIDTH,
  STATUS_HIDE_ORDER,
  STATUS_NARROW_WIDTH,
  STATUS_SEGMENT_ORDER,
  usageBarView,
} from "./session-status";

const usage = (overrides: Partial<ChatUsage> = {}): ChatUsage => ({
  input: 1000,
  output: 2000,
  cacheRead: 500,
  cacheWrite: 0,
  total: 3500,
  cost: 0.42,
  subscription: false,
  ...overrides,
});

describe("compact 格式化", () => {
  it("tokens：<1k 取整；k / M 边界按进位后的值选单位（999999 → 1M 而不是 1000k）", () => {
    expect(compactTokens(0)).toBe("0");
    expect(compactTokens(999)).toBe("999");
    expect(compactTokens(1_000)).toBe("1k");
    expect(compactTokens(1_200)).toBe("1.2k");
    expect(compactTokens(15_000)).toBe("15k");
    expect(compactTokens(999_999)).toBe("1M");
    expect(compactTokens(1_000_000)).toBe("1M"); // 窗口取值（DESIGN 示例 `42% · 1M`）
    expect(compactTokens(1_200_000)).toBe("1.2M");
  });

  it("美元：≥$1 两位小数、≥$0.01 三位、更小四位（精确小数位只走 hover）", () => {
    expect(compactCost(12.345)).toBe("$12.35");
    expect(compactCost(0.42)).toBe("$0.420");
    expect(compactCost(0.0043)).toBe("$0.0043");
  });

  it("速度：<10 一位小数，其余取整；单位 tok/s", () => {
    expect(compactSpeed(8.24)).toBe("8.2 tok/s");
    expect(compactSpeed(66.6)).toBe("67 tok/s");
  });
});

describe("占用段三态（口径 = pi getContextUsage）", () => {
  it("percent + tokens 有值 → 条 + `42% · 1M`", () => {
    expect(usageBarView({ percent: 42, tokens: 420_000, contextWindow: 1_000_000 })).toEqual({
      percent: 42,
      text: "42% · 1M",
    });
  });

  it("占比 clamp 到 0..100（服务端四舍五入可能略微越界）", () => {
    expect(usageBarView({ percent: 100.4, tokens: 1, contextWindow: 1 })?.percent).toBe(100);
    expect(usageBarView({ percent: -0.2, tokens: 0, contextWindow: 10 })?.percent).toBe(0);
  });

  it("只有窗口（压缩后占用未知）→ `? · 1M` 且不画条（percent = null）", () => {
    expect(usageBarView({ percent: null, tokens: null, contextWindow: 1_000_000 })).toEqual({
      percent: null,
      text: "? · 1M",
    });
  });

  it("连窗口都没有（无模型 / 设置未加载）→ null（整段隐藏）", () => {
    expect(usageBarView(null)).toBeNull();
  });
});

describe("占比阈值常量（占用条取色：error / warning / primary）", () => {
  it("达到 CONTEXT_ERROR_PERCENT 取 colorError；达到 CONTEXT_WARN_PERCENT 取 colorWarning；其余 colorPrimary", () => {
    expect(CONTEXT_WARN_PERCENT).toBeLessThan(CONTEXT_ERROR_PERCENT);
    expect(contextBarColor(CONTEXT_ERROR_PERCENT - 1)).toBe("colorWarning");
    expect(contextBarColor(CONTEXT_ERROR_PERCENT)).toBe("colorError");
    expect(contextBarColor(CONTEXT_WARN_PERCENT - 1)).toBe("colorPrimary");
    expect(contextBarColor(CONTEXT_WARN_PERCENT)).toBe("colorWarning");
  });
});

describe("窄栏两级阈值（容器查询声明式隐藏；先隐累计 tokens、再隐缓存段）", () => {
  it("隐藏优先级 = 累计 tokens → 缓存，且第二级阈值窄于第一级", () => {
    expect(STATUS_HIDE_ORDER).toEqual(["total", "cache"]);
    expect(STATUS_CRAMPED_WIDTH).toBeLessThan(STATUS_NARROW_WIDTH);
  });

  it("组件侧的容器查询类字面量与本模块常量同值（Tailwind 只扫字面量，不能把常量拼进 className）", () => {
    const source = readFileSync(new URL("../components/chat/session-status-bar.tsx", import.meta.url), "utf8");
    expect(source).toContain("@container");
    expect(source).toContain(`@max-[${STATUS_NARROW_WIDTH}px]:hidden`);
    expect(source).toContain(`@max-[${STATUS_CRAMPED_WIDTH}px]:hidden`);
  });
});

describe("sessionStatusView（段清单 / 无数据即隐藏 / title 组装）", () => {
  it("三者全空 → null（整行不渲染）", () => {
    expect(sessionStatusView({ contextUsage: null, usage: null, speed: null })).toBeNull();
  });

  it("段键序 = STATUS_SEGMENT_ORDER（费用 → 速度 → 缓存 → 累计）；占用段独立带条", () => {
    const view = sessionStatusView({
      contextUsage: { percent: 42, tokens: 420_000, contextWindow: 1_000_000 },
      usage: usage({ cacheHitRate: 0.25 }),
      speed: { outputTokens: 2000, ms: 30_000, tps: 66.6 },
    });
    expect(STATUS_SEGMENT_ORDER).toEqual(["cost", "speed", "cache", "total"]);
    expect(view?.context).toEqual({ percent: 42, text: "42% · 1M" });
    expect(view?.segments).toEqual([
      { key: "cost", text: "$0.420" },
      { key: "speed", text: "67 tok/s" },
      { key: "cache", text: "缓存 25%" },
      { key: "total", text: "累计 3.5k" },
    ]);
  });

  it("费用段：成本为 0（模型无价格配置）→ 隐藏；缓存段只报命中率（分母为 0 时服务端省略键 ⇒ 读/写量也必为 0 ⇒ 整段隐藏，读/写量只走 hover）", () => {
    const noPriceNoCache = sessionStatusView({
      contextUsage: null,
      usage: usage({ cost: 0, cacheHitRate: undefined, cacheRead: 0, cacheWrite: 0 }),
      speed: null,
    });
    expect(noPriceNoCache?.segments.map((s) => s.key)).toEqual(["total"]);

    const zeroRate = sessionStatusView({
      contextUsage: null,
      usage: usage({ cacheHitRate: 0 }),
      speed: null,
    });
    expect(zeroRate?.segments.some((s) => s.text === "缓存 0%")).toBe(true); // 真实 0% 是有效值，不隐藏
  });

  it("账目全零（无 usage 条目的会话）+ 无占用 / 无速度 → null（不留只有 mt-1 的空行）", () => {
    const empty = sessionStatusView({
      contextUsage: null,
      usage: usage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 }),
      speed: null,
    });
    expect(empty).toBeNull();
  });

  it("未知占用 + 历史会话（无 speed）→ `? · 窗口` 段仍在，速度段不渲染", () => {
    const view = sessionStatusView({
      contextUsage: { percent: null, tokens: null, contextWindow: 1_000_000 },
      usage: usage(),
      speed: null,
    });
    expect(view?.context).toEqual({ percent: null, text: "? · 1M" });
    expect(view?.segments.map((s) => s.key)).toEqual(["cost", "total"]); // 无命中率 ⇒ 缓存段隐藏
    expect(view?.title).not.toContain("tok/s");
  });

  it("title 多行组装：占用 tokens / 窗口、账目五数、命中率分母说明、成本小数位（订阅标「订阅 · 估算」）、速度样本", () => {
    const view = sessionStatusView({
      contextUsage: { percent: null, tokens: null, contextWindow: 1_000_000 },
      usage: usage({ cacheHitRate: 0.25, subscription: true }),
      speed: { outputTokens: 2000, ms: 30_000, tps: 66.6 },
    });
    expect(view?.title.split("\n")).toEqual([
      "上下文占用：未知（窗口 1000000 tokens）",
      "输入 1000 · 输出 2000 · 缓存读 500 · 缓存写 0 · 合计 3500",
      "缓存命中率：25%（分母 = 输入 + 缓存读 + 缓存写）",
      "成本：$0.4200（订阅 · 估算）",
      "速度：66.6 tok/s（样本 2000 tokens / 30.0s）",
    ]);

    const known = sessionStatusView({
      contextUsage: { percent: 42, tokens: 420_000, contextWindow: 1_000_000 },
      usage: usage(),
      speed: null,
    });
    expect(known?.title.split("\n")[0]).toBe("上下文占用：420000 / 1000000 tokens");
  });
});
