// 会话状态栏的纯视图口径（DESIGN.md `session-status-bar`；数据口径 = docs/design/20-context.md §2.1）
//
// 职责边界：compact 格式化（k / M / 美元 / tok·s⁻¹）、占用段三态、段清单与窄栏优先级、行级 hover 文案组装。
// 数字全部由服务端算好下发（占用 = pi `getContextUsage()`；账目 = agent 包 `sessionUsage()`；
// 速度 = agent 包 `createSpeedMeter()`）——本模块**不累加、不计时、不复算分母**，只做格式化与优先级隐藏。
import type { ChatContextUsage, ChatSpeed, ChatUsage } from "@whispering233/ai-editor-shared";

// ============ 阈值常量（唯一定义处；组件侧容器查询类字面量的同值断言在 session-status.test.ts） ============

/** 占用条告警线（占比百分比）：达到即占用条转 `colorWarning` */
export const CONTEXT_WARN_PERCENT = 70;
/** 占用条危险线（占比百分比）：达到即占用条转 `colorError` */
export const CONTEXT_ERROR_PERCENT = 90;
/** 窄栏第一级阈值（容器宽度 px 上限）：不足即隐 `STATUS_HIDE_ORDER` 首项（累计 tokens 段） */
export const STATUS_NARROW_WIDTH = 420;
/** 窄栏第二级阈值（容器宽度 px 上限，窄于 `STATUS_NARROW_WIDTH`）：不足即再隐次项（缓存段） */
export const STATUS_CRAMPED_WIDTH = 340;

// ============ 段清单（行内顺序）与窄栏优先级 ============

/** 段键（占用段单独带条，见 `usageBarView`，不在本清单内） */
export type SessionStatusSegmentKey = "cost" | "speed" | "cache" | "total";

/** 行内段顺序（DESIGN：占用段 → 费用 → 速度 → 缓存 → 累计 tokens） */
export const STATUS_SEGMENT_ORDER: readonly SessionStatusSegmentKey[] = ["cost", "speed", "cache", "total"];

/** 窄栏隐藏优先级（容器越窄先隐越靠前的项；与两级阈值自上而下、由宽到窄一一对应） */
export const STATUS_HIDE_ORDER: readonly SessionStatusSegmentKey[] = ["total", "cache"];

/** 行内段（text 已是 compact 值；精确账目只走行级 `title`） */
export interface SessionStatusSegment {
  key: SessionStatusSegmentKey;
  text: string;
}

/** 占用段视图 */
export interface ContextBarView {
  /** 条占比（0..100；null = 占用未知：压缩后 `tokens` / `percent` 为 null，只显示 `? · 窗口`，不画条） */
  percent: number | null;
  /** 行内文案：`42% · 1M` / `? · 1M` */
  text: string;
}

/** 状态栏整行视图（null = 无任何可见内容 → 整行不渲染） */
export interface SessionStatusView {
  /** 占用段（null = 连窗口都没有 → 整段隐藏） */
  context: ContextBarView | null;
  /** 无数据的段不在数组里 */
  segments: SessionStatusSegment[];
  /** 行级 hover 文案（原生 `title`，多行 `\n`：占用明细 / 账目 / 命中率分母说明 / 成本小数位 / 速度样本） */
  title: string;
}

/** 状态栏数据源（三者都来自 store，缺一即对应段隐藏） */
export interface SessionStatusInput {
  contextUsage: ChatContextUsage | null;
  usage: ChatUsage | null;
  speed: ChatSpeed | null;
}

// ============ compact 格式化（行内只放 compact 值） ============

/** 一位小数并去掉尾随 `.0`（`1.0k` → `1k`） */
function trimOne(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

/**
 * tokens 数值 compact：`<1k` 取整；`k` / `M` 一位小数（`1000` → `1k`、`1200` → `1.2k`、窗口 `1M`）。
 * 单位按**进位后**的值选（`999999` → `1M` 而不是 `1000k`）。
 */
export function compactTokens(value: number): string {
  if (value < 1_000) return `${Math.round(value)}`;
  const k = Math.round(value / 100) / 10;
  if (k < 1_000) return `${trimOne(k)}k`;
  return `${trimOne(Math.round(value / 100_000) / 10)}M`;
}

/** 美元 compact：`≥$1` 两位小数、`≥$0.01` 三位、更小四位（小数位只在 hover 的精确账目里给全） */
export function compactCost(usd: number): string {
  const decimals = usd >= 1 ? 2 : usd >= 0.01 ? 3 : 4;
  return `$${usd.toFixed(decimals)}`;
}

/** 解码速度 compact（单位 tok/s；`<10` 一位小数，其余取整） */
export function compactSpeed(tps: number): string {
  return `${tps < 10 ? tps.toFixed(1) : Math.round(tps)} tok/s`;
}

// ============ 占用段（三态）与占比取色 ============

/** 占用条填充色对应的 antd token 名（色值只经 token 取——禁硬编码色值） */
export function contextBarColor(percent: number): "colorError" | "colorWarning" | "colorPrimary" {
  if (percent >= CONTEXT_ERROR_PERCENT) return "colorError";
  if (percent >= CONTEXT_WARN_PERCENT) return "colorWarning";
  return "colorPrimary";
}

/**
 * 占用段三态：
 * - `percent` + `tokens` 有值 → 条（占比 clamp 到 0..100，服务端四舍五入可能略微越界）+ `42% · 1M`
 * - 只有窗口（压缩后占用未知）→ `? · 1M`，**不画条**（percent = null）
 * - 连窗口都没有（无模型 / 设置未加载）→ null（整段隐藏）
 */
export function usageBarView(usage: ChatContextUsage | null): ContextBarView | null {
  if (usage === null) return null;
  const window = compactTokens(usage.contextWindow);
  if (usage.percent === null || usage.tokens === null) return { percent: null, text: `? · ${window}` };
  const percent = Math.min(100, Math.max(0, Math.round(usage.percent)));
  return { percent, text: `${percent}% · ${window}` };
}

// ============ 行内段文案（无数据 → null，段不渲染） ============

/** 缓存段：命中率（服务端分母为 0 时省略键——那时读/写量也必为 0，段随之隐藏；读/写量只走 hover） */
function cacheSegmentText(usage: ChatUsage): string | null {
  return usage.cacheHitRate === undefined ? null : `缓存 ${Math.round(usage.cacheHitRate * 100)}%`;
}

/** 单段文案（null = 该段无数据）；成本为 0 = 模型无价格配置 → 隐藏（DESIGN + §2.1） */
function segmentText(key: SessionStatusSegmentKey, input: SessionStatusInput): string | null {
  const { usage, speed } = input;
  switch (key) {
    case "cost":
      return usage !== null && usage.cost > 0 ? compactCost(usage.cost) : null;
    case "speed":
      return speed === null ? null : compactSpeed(speed.tps);
    case "cache":
      return usage === null ? null : cacheSegmentText(usage);
    case "total":
      return usage !== null && usage.total > 0 ? `累计 ${compactTokens(usage.total)}` : null;
  }
}

// ============ 占用 / 账目 / 速度的 hover 明细行 ============

/** 占用明细（未知态必须可区分——不报假百分比） */
function contextTitleLine(usage: ChatContextUsage): string {
  return usage.tokens === null
    ? `上下文占用：未知（窗口 ${usage.contextWindow} tokens）`
    : `上下文占用：${usage.tokens} / ${usage.contextWindow} tokens`;
}

/** 多行 title 组装（只收有数据的行；空数组 = 无任何数据，调用方据此整行不渲染） */
function titleLines(input: SessionStatusInput): string[] {
  const { contextUsage, usage, speed } = input;
  const lines: string[] = [];
  if (contextUsage !== null) lines.push(contextTitleLine(contextUsage));
  if (usage !== null) {
    lines.push(
      `输入 ${usage.input} · 输出 ${usage.output} · 缓存读 ${usage.cacheRead} · 缓存写 ${usage.cacheWrite} · 合计 ${usage.total}`,
    );
    if (usage.cacheHitRate !== undefined) {
      lines.push(
        `缓存命中率：${Math.round(usage.cacheHitRate * 100)}%（分母 = 输入 + 缓存读 + 缓存写）`,
      );
    }
    if (usage.cost > 0) {
      lines.push(`成本：$${usage.cost.toFixed(4)}${usage.subscription ? "（订阅 · 估算）" : ""}`);
    }
  }
  if (speed !== null) {
    const sample = `${speed.outputTokens} tokens / ${(speed.ms / 1000).toFixed(1)}s`;
    lines.push(`速度：${speed.tps.toFixed(1)} tok/s（样本 ${sample}）`);
  }
  return lines;
}

/**
 * 状态栏整行视图：**无任何可见内容 → null**（整行不渲染，不常态白占消息区高度）。
 * 「无内容」包括账目全零（无 usage 条目的会话 `sessionUsage()` 恒返回全零对象）——
 * 那种情形只剩一段零账目 title，渲染出来就是一个只有 `mt-1` 的空行。
 * `speed` 只对进行中的会话有效（历史会话无样本）→ 速度段与明细一并消失。
 */
export function sessionStatusView(input: SessionStatusInput): SessionStatusView | null {
  const context = usageBarView(input.contextUsage);
  const segments = STATUS_SEGMENT_ORDER.map((key) => ({ key, text: segmentText(key, input) })).filter(
    (segment): segment is SessionStatusSegment => segment.text !== null,
  );
  if (context === null && segments.length === 0) return null;
  return { context, segments, title: titleLines(input).join("\n") };
}
