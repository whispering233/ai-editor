// LLM provider 面板的纯逻辑（设置页「AI 模型」三级导航 + 「添加」选择区）：
// 导航只列**已配置**的家（authConfigured = env / OAuth / auth.json 任一来源）——pi 的 provider
// 目录有 40 家，全列会让 160px 的三级导航不可用；未配置的家走「添加」列表按需选择。
//
// 品牌 logo：`public/provider-icons.svg` 精灵（`<symbol>` + `<use>`），取自 pi-web
// （派生自 @lobehub/icons，MIT，许可头内嵌于该 svg）；pi provider id → symbol id 的映射见下表，
// 未命中的自定义 provider（models.json 自定义家）由调用方回退 antd 图标。
import type { SettingsProviderInfo } from "./api";

/** pi provider id → 精灵 symbol（+ 该 logo 是否自带品牌色：自带色的 logo 不套 currentColor） */
interface ProviderIconEntry {
  symbol: string;
  /** 品牌 logo 内含各自的品牌色（DeepSeek 蓝、Google 四色…）：不套 currentColor，原样呈现 */
  color: boolean;
}

/** provider id → 图标（与 pi-web 同表；pi 目录里同一家的多 id 别名共用同一 symbol） */
const PROVIDER_ICONS: Record<string, ProviderIconEntry> = {
  anthropic: { symbol: "anthropic", color: false },
  openai: { symbol: "openai", color: false },
  "openai-codex": { symbol: "openai", color: false },
  google: { symbol: "google", color: true },
  "google-vertex": { symbol: "google", color: true },
  "ant-ling": { symbol: "antgroup", color: true },
  deepseek: { symbol: "deepseek", color: true },
  groq: { symbol: "groq", color: false },
  mistral: { symbol: "mistral", color: true },
  moonshotai: { symbol: "moonshot", color: false },
  "moonshotai-cn": { symbol: "moonshot", color: false },
  moonshot: { symbol: "moonshot", color: false },
  minimax: { symbol: "minimax", color: true },
  "minimax-cn": { symbol: "minimax", color: true },
  fireworks: { symbol: "fireworks", color: true },
  huggingface: { symbol: "huggingface", color: true },
  cerebras: { symbol: "cerebras", color: true },
  openrouter: { symbol: "openrouter", color: false },
  xai: { symbol: "xai", color: false },
  "cloudflare-ai-gateway": { symbol: "cloudflare", color: true },
  "cloudflare-workers-ai": { symbol: "cloudflare", color: true },
  "vercel-ai-gateway": { symbol: "vercel", color: false },
  "github-copilot": { symbol: "githubcopilot", color: false },
  "amazon-bedrock": { symbol: "aws", color: true },
  "azure-openai-responses": { symbol: "azure", color: true },
  "kimi-coding": { symbol: "kimi", color: true },
  nvidia: { symbol: "nvidia", color: true },
  opencode: { symbol: "opencode", color: false },
  "opencode-go": { symbol: "opencode", color: false },
  qwen: { symbol: "qwen", color: true },
  xiaomi: { symbol: "xiaomimimo", color: false },
  "xiaomi-token-plan-ams": { symbol: "xiaomimimo", color: false },
  "xiaomi-token-plan-cn": { symbol: "xiaomimimo", color: false },
  "xiaomi-token-plan-sgp": { symbol: "xiaomimimo", color: false },
  zai: { symbol: "zai", color: false },
  "zai-coding-cn": { symbol: "zai", color: false },
  zhipu: { symbol: "zhipu", color: true },
  cohere: { symbol: "cohere", color: true },
  perplexity: { symbol: "perplexity", color: true },
  together: { symbol: "together", color: true },
  grok: { symbol: "grok", color: false },
};

/** 该 provider 的品牌 logo（null = 无对应 symbol，调用方回退通用图标） */
export function providerIcon(id: string): ProviderIconEntry | null {
  return PROVIDER_ICONS[id] ?? null;
}

/** 映射表引用到的全部精灵 symbol（测试用：逐个校验 `public/provider-icons.svg` 里真的存在——
 * 漏一个就是「图标位置空白」这种只在浏览器里看得见的失效） */
export const PROVIDER_ICON_SYMBOLS: readonly string[] = [
  ...new Set(Object.values(PROVIDER_ICONS).map((entry) => entry.symbol)),
];

/**
 * 三级导航列出的 provider id（顺序 = pi 目录顺序）：
 * **已配置** ∪ 当前激活家（凭据可能刚被清掉，但仍是激活模型所属家——列出来才切得走）
 * ∪ 刚点选的未配置家（从「添加」列表选中后立刻可见）。
 */
export function navProviderIds(
  providers: readonly SettingsProviderInfo[],
  activeProviderId: string,
  pickedProviderId: string | null,
): string[] {
  return providers
    .filter(
      (p) =>
        p.authConfigured || p.id === activeProviderId || p.id === pickedProviderId,
    )
    .map((p) => p.id);
}

/** 「添加」列表：未配置的家，按查询过滤（大小写不敏感；匹配 displayName 或 id；空查询 = 全部） */
export function unconfiguredProviders(
  providers: readonly SettingsProviderInfo[],
  query: string,
): SettingsProviderInfo[] {
  const needle = query.trim().toLowerCase();
  return providers.filter((p) => {
    if (p.authConfigured) return false;
    if (needle === "") return true;
    return p.displayName.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle);
  });
}
