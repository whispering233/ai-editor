// 联网来源卡片（DESIGN.md `chat-source-cards`）：`web_search` / `fetch_content` 的工具行在折叠头
// 之下直接渲染可点来源卡，无需展开；原始 JSON 仍在展开态可查。
//
// 数据源 = **工具结果 `content` 文本**（AUTO 工具的 `details` 不下发），历史重载后照旧可见。
// 解析失败（超预算被截断成非法 JSON）/ 形状不符 / 无有效命中 → null（调用方回退普通工具行，
// 不渲染空壳、不抛错）。卡片不新增状态、不新增请求。

/** 展示用来源卡：`title` → `summary`（有则显示）→ `meta`（域名 · 日期 / 字数） */
export interface SourceCardView {
  url: string;
  title: string;
  summary?: string;
  meta: string;
}

/** 非空字符串（空白字段按缺失处理——空标签只会让卡片看起来像故障） */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** URL → 可点链接与域名（去 `www.`）；**只放行 http(s)**——上游内容不可信，
 * `javascript:` 一类 href 点一下就是脚本执行。不可解析 / 协议不符 → null（该卡不渲染）。 */
function link(value: unknown): { url: string; host: string } | null {
  if (typeof value !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return { url: value, host: parsed.hostname.replace(/^www\./, "") };
}

/** 千分位（不依赖 locale：Intl 在本仓库没有先例，纯正则一行即可） */
function formatCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+$)/g, ",");
}

/** 日期只显示 `YYYY-MM-DD`（上游格式不定，不符合的前缀不猜、整段省略） */
function formatDate(value: string | undefined): string | null {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** 一条检索命中 → 卡片；无合法 url 的命中丢弃（其余字段缺省即省略） */
function searchCard(item: unknown): SourceCardView | null {
  if (typeof item !== "object" || item === null) return null;
  const hit = item as Record<string, unknown>;
  const target = link(hit.url);
  if (target === null) return null;
  const date = formatDate(text(hit.date));
  return {
    url: target.url,
    title: text(hit.title) ?? target.host,
    // 契约字段是 `summary`（`snippet` 已在工具层回落投影掉）；`content` 一并容忍
    summary: text(hit.summary) ?? text(hit.content),
    meta: date === null ? target.host : `${target.host} · ${date}`,
  };
}

/** 一次抓取 → 卡片；`{ title, url, content }` 缺 content 即形状不符（字数无从显示） */
function fetchCard(value: unknown): SourceCardView | null {
  if (typeof value !== "object" || value === null) return null;
  const page = value as Record<string, unknown>;
  if (typeof page.content !== "string") return null;
  const target = link(page.url);
  if (target === null) return null;
  return {
    url: target.url,
    title: `已读取：${text(page.title) ?? target.host}`,
    meta: `${target.host} · ${formatCount(page.content.length)} 字`,
  };
}

/**
 * 工具结果文本 → 卡片列表；不可渲染（非来源工具 / 非法 JSON / 形状不符 / 空命中）→ null。
 * @param toolName 工具名（仅 `web_search` / `fetch_content` 有卡片）
 * @param result 工具结果文本（运行时 `truncateToolResultText(stringifyToolResult(结果))` 的产物）
 */
export function parseSourceCards(toolName: string, result: unknown): SourceCardView[] | null {
  if (typeof result !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null; // 截断后的非法 JSON / 非 JSON 文本
  }
  if (toolName === "web_search") {
    if (!Array.isArray(parsed)) return null;
    const cards = parsed.map(searchCard).filter((card): card is SourceCardView => card !== null);
    return cards.length > 0 ? cards : null;
  }
  if (toolName === "fetch_content") {
    const card = fetchCard(parsed);
    return card === null ? null : [card];
  }
  return null;
}

/** 来源卡片（导出供渲染走查测试）：顺序 = 工具返回顺序；整卡新窗口外链。 */
export function SourceCards({ toolName, result }: { toolName: string; result?: unknown }) {
  const cards = parseSourceCards(toolName, result);
  if (cards === null) return null;
  return (
    <div className="space-y-1">
      {cards.map((card, index) => (
        <a
          key={`${card.url}-${index}`}
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-md border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
        >
          {/* 限行**不能**与 `block` 同用：line-clamp 靠 `display:-webkit-box`，`block` 在产出的
              CSS 里排在后面会把它盖掉（2026-10 实测标题 3 行、摘要不限行） */}
          <span className="line-clamp-2 text-foreground">{card.title}</span>
          {card.summary === undefined ? null : (
            <span className="mt-1 line-clamp-1">{card.summary}</span>
          )}
          <span className="mt-1 block">{card.meta}</span>
        </a>
      ))}
    </div>
  );
}
