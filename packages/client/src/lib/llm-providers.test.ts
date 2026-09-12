// 「AI 模型」三级导航 / 添加列表的纯逻辑走查：
// - navProviderIds：导航只列已配置 ∪ 当前激活 ∪ 刚点选（「配置了多少显示多少」）
// - unconfiguredProviders：「添加」列表 = 未配置的家 + 搜索过滤
// - providerIcon：pi provider id → 精灵 symbol（未命中 → null → 组件回退 ApiOutlined）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SettingsProviderInfo } from "./api";
import {
  navProviderIds,
  PROVIDER_ICON_SYMBOLS,
  providerIcon,
  unconfiguredProviders,
} from "./llm-providers";

function provider(id: string, authConfigured: boolean): SettingsProviderInfo {
  return { id, displayName: `名字-${id}`, authConfigured, models: [] };
}

const providers: SettingsProviderInfo[] = [
  provider("deepseek", true),
  provider("anthropic", false),
  provider("openai-codex", true),
  provider("qwen", false),
];

describe("navProviderIds", () => {
  it("只列已配置的家（未配置的 40 家不进导航）", () => {
    expect(navProviderIds(providers, "deepseek", null)).toEqual(["deepseek", "openai-codex"]);
  });

  it("当前激活家即使凭据被清掉也保留（否则切不走）", () => {
    expect(navProviderIds(providers, "qwen", null)).toEqual(["deepseek", "openai-codex", "qwen"]);
  });

  it("刚点选的未配置家先挂上（保存成功前只在导航里临时可见）", () => {
    expect(navProviderIds(providers, "deepseek", "anthropic")).toEqual([
      "deepseek",
      "anthropic",
      "openai-codex",
    ]);
  });

  it("什么都没配置且无激活 → 空导航", () => {
    expect(navProviderIds([provider("a", false)], "", null)).toEqual([]);
  });
});

describe("unconfiguredProviders", () => {
  it("只列未配置的家", () => {
    expect(unconfiguredProviders(providers, "").map((p) => p.id)).toEqual(["anthropic", "qwen"]);
  });

  it("搜索匹配 id 或显示名（大小写不敏感、去首尾空白）", () => {
    expect(unconfiguredProviders(providers, "ANTHROP").map((p) => p.id)).toEqual(["anthropic"]);
    expect(unconfiguredProviders(providers, "  qwen ").map((p) => p.id)).toEqual(["qwen"]);
    expect(unconfiguredProviders(providers, "名字-anthropic").map((p) => p.id)).toEqual([
      "anthropic",
    ]);
  });

  it("无命中 → 空列表（页面给「没有匹配的 provider」）", () => {
    expect(unconfiguredProviders(providers, "zzz")).toEqual([]);
  });
});

describe("providerIcon", () => {
  it("pi provider id 命中精灵 symbol（含别名与多家园：xiaomi/opencode/cloudflare）", () => {
    expect(providerIcon("deepseek")).toEqual({ symbol: "deepseek", color: true });
    expect(providerIcon("openai-codex")).toEqual({ symbol: "openai", color: false });
    expect(providerIcon("xiaomi-token-plan-cn")).toEqual({ symbol: "xiaomimimo", color: false });
    expect(providerIcon("cloudflare-workers-ai")).toEqual({ symbol: "cloudflare", color: true });
  });

  it("自定义 provider（models.json）无映射 → null（组件回退通用图标）", () => {
    expect(providerIcon("my-gateway")).toBeNull();
  });

  it("映射表引用的 symbol 在 public/provider-icons.svg 里全部存在（漏一个就是空白图标）", () => {
    const svg = readFileSync(new URL("../../public/provider-icons.svg", import.meta.url), "utf8");
    const symbols = new Set([...svg.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]));
    expect(PROVIDER_ICON_SYMBOLS.filter((symbol) => !symbols.has(symbol))).toEqual([]);
  });
});
