// 最小 WebDAV 客户端（PROPFIND / MKCOL / PUT / DELETE + 窄 XML 解析）
//
// 为什么手写不引依赖（`docs/design/40-cloud-sync.md` §2）：只需要四个动词与四种响应字段，
// 引 SDK 或 XML 解析器会带进体积与第二套错误模型。出站请求走**全局 fetch**
// （服务启动时已安装 undici dispatcher：环境代理 + 连接族退避），**本模块不得自建 agent**。
//
// 路径约定：调用方传**解码后的相对路径**（如 `books/斗破苍穹-proj-x` 或 `""` = 根），
// 编码在本模块内逐段完成（`encodeURIComponent`）；href 解码亦在此收口——中文书名/空格
// 对调用方透明，且请求编码与解析解码口径一致。
//
// 错误映射（→ HttpError；码表 `docs/api/error-code.md`）：
// - 401/403 → 502 `CLOUD_AUTH_FAILED`（凭据无效/被吊销/权限不足）
// - 507 或 403 且响应体提示配额 → 502 `CLOUD_QUOTA_EXCEEDED`
// - 其余 4xx/5xx、超时、网络错误 → 502 `CLOUD_UNREACHABLE`
// - 404 **不抛错**：`list()` 返回 null（目录不存在，由调用方决定 MKCOL），`remove()` 幂等返回
//
// 范围：卡 2 只实现上述四个动词（配置/连通性测试用）。GET（下载）与 MOVE（原子改名）在
// 推送/拉取卡片按同一 `davFetch` 模板补——不在本卡预先实现未被调用的代码。

import { HttpError } from "../middleware/error.js";

/** 单次请求超时（毫秒）：云端操作是用户可见的同步动作，30s 足够且能及时报错 */
export const DEFAULT_WEBDAV_TIMEOUT_MS = 30_000;

/** PROPFIND 请求体（只取我们需要的三种属性；命名空间前缀 `d:` 是通行写法） */
const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';

/** XML 名称的宽容前缀（服务器可能用 `d:` / `D:` / `ns0:` 或不带前缀） */
const NS = "(?:[A-Za-z_][\\w.-]*:)?";
const RESPONSE_BLOCK_RE = new RegExp(`<${NS}response\\b[^>]*>([\\s\\S]*?)</${NS}response>`, "g");
const COLLECTION_RE = new RegExp(`<${NS}collection\\b`);

/** WebDAV 目录条目（`list()` 元素） */
export interface DavEntry {
  /** 服务端返回的原始 href（未解码；排查用） */
  href: string;
  /** 末段名称（已解码，如 `20260813-101530123-自动-苹果本-人物32-设定58-章120.zip`） */
  name: string;
  /**
 * 解码后的**基路径相对**路径（如 `书-proj-x/file.zip`）：base 带路径前缀时
 *（如 `https://host/dav/ai-editor`）服务端 href 多出的 `dav/ai-editor` 段会被剥掉
 *（由 `list()` 归一，`parsePropfind` 保留服务端原样）
 */
  path: string;
  isCollection: boolean;
  /** 字节数（集合或未提供 → null） */
  size: number | null;
  /** `getlastmodified` 原样（HTTP 日期；未提供 → null） */
  lastModified: string | null;
}

export interface WebdavClientOptions {
  /** WebDAV 根 URL（含用户自定义前缀，如 `https://dav.jianguoyun.com/dav/ai-editor`） */
  url: string;
  username: string;
  password: string;
  /** 单次请求超时（缺省 `DEFAULT_WEBDAV_TIMEOUT_MS`；测试注入小值） */
  timeoutMs?: number;
}

export interface WebdavClient {
  /** 列目录（`Depth: 1`）：目录不存在（404）→ null；**结果不含目录自身**；按 path 升序 */
  list(relPath: string): Promise<DavEntry[] | null>;
  /** 创建目录（幂等）：true = 本次创建；false = 已存在（405） */
  mkcol(relPath: string): Promise<boolean>;
  /** 上传（PUT）：覆盖同名文件 */
  put(relPath: string, body: Uint8Array): Promise<void>;
  /** 下载（GET）：文件不存在（404）→ null */
  get(relPath: string): Promise<Uint8Array | null>;
  /** 同目录/跨目录改名（MOVE）：用于「临时名 → 正式名」的原子落盘与书名改名时的目录迁移 */
  move(fromRelPath: string, toRelPath: string): Promise<void>;
  /** 删除文件/目录（幂等：404 视为已删） */
  remove(relPath: string): Promise<void>;
  /**
   * 删除**目录**（幂等）：比 `remove` 多两件事——集合用带尾斜杠的 URL，并带 `Depth: infinity`
   * （RFC 4918 §9.6.1：对集合的 DELETE 需要它；部分服务器（坚果云实测）缺了会拒绝/重定向导致残留）。
   * 两种形态都失败时抛错（调用方自行决定是否忽略）。
   */
  removeDir(relPath: string): Promise<void>;
}

/** XML 实体反转义（只处理 href 里可能出现的五种 + 数字实体） */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 取块内某标签的文本（不存在 → null；trim 后为空 → ""） */
function tagText(block: string, tag: string): string | null {
  const re = new RegExp(`<${NS}${tag}\\b[^>]*>([\\s\\S]*?)</${NS}${tag}>`);
  const m = re.exec(block);
  return m === null ? null : decodeXmlEntities((m[1] ?? "").trim());
}

/** 路径段解码（百分号编码的 UTF-8；非法编码 → 原样返回，不抛错） */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** 把 href 归一为解码后的相对路径段（去空段、去首尾斜杠、绝对 URL 取 pathname） */
function hrefSegments(href: string): string[] {
  let path = href;
  if (/^https?:\/\//i.test(href)) {
    try {
      path = new URL(href).pathname;
    } catch {
      // 解析失败：按原串处理（下面的分段仍能给出可读结果）
    }
  }
  path = path.split(/[?#]/)[0] ?? path;
  return path
    .split("/")
    .filter((s) => s !== "")
    .map(decodeSegment);
}

/** 相对路径归一（去空段） */
function normalizeRel(relPath: string): string[] {
  return relPath.split("/").filter((s) => s !== "");
}

/**
 * 解析 PROPFIND 响应（**窄解析**：只取 response 块内的 href / resourcetype / getcontentlength /
 * getlastmodified）。宽容命名空间前缀；坏块（无 href）跳过；URL 编码与 XML 实体都还原。
 */
export function parsePropfind(xml: string): DavEntry[] {
  const out: DavEntry[] = [];
  for (const match of xml.matchAll(RESPONSE_BLOCK_RE)) {
    const block = match[1] ?? "";
    const href = tagText(block, "href");
    if (href === null || href === "") continue;
    const segments = hrefSegments(href);
    const sizeText = tagText(block, "getcontentlength");
    out.push({
      href,
      name: segments.length === 0 ? "" : (segments[segments.length - 1] as string),
      path: segments.join("/"),
      isCollection: COLLECTION_RE.test(block),
      size: sizeText !== null && /^\d+$/.test(sizeText) ? Number(sizeText) : null,
      lastModified: tagText(block, "getlastmodified"),
    });
  }
  /** 列表结果排序（**代码单元序**，非 locale 序）：确定、与文件系统 `ls` 口径一致 */
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * 列出目录时的自身条目判定：传入的 `path` 已剥掉 base 段（见客户端的 toBaseRelativeSegments）
 * → 退化为与 relPath 直接比较；保留 `endsWith` 兜底（服务器返回与请求不一致的前缀时）。
 */
function isSelf(entryPath: string, relPath: string): boolean {
  const rel = normalizeRel(relPath).join("/");
  if (rel === "") return entryPath === ""; // 根：href 解码后无段（`/` 或 base 段被剥光）
  return entryPath === rel || entryPath.endsWith(`/${rel}`);
}

/** 创建 WebDAV 客户端（每个云端操作会话一个；无内部状态） */
export function createWebdavClient(options: WebdavClientOptions): WebdavClient {
  const base = options.url.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_WEBDAV_TIMEOUT_MS;
  const authHeader = `Basic ${Buffer.from(`${options.username}:${options.password}`, "utf8").toString("base64")}`;

 // base 的路径段（解码后）：带路径前缀的 base（`.../dav/ai-editor`）下，服务端 href 会多出这些段，
 // 列表结果统一剥掉它们 → `path` 始终是「相对 base」的（与 JSDoc 一致，自身条目判定也简化）
  const baseSegments: string[] = (() => {
    try {
      return normalizeRel(new URL(base).pathname).map(decodeSegment);
    } catch {
      return [];
    }
  })();

  /** href 解码段 → base 相对段（前缀匹配则剥离；不匹配则原样保留，容错反代重写 href） */
  function toBaseRelativeSegments(segments: string[]): string[] {
    if (baseSegments.length === 0) return segments;
    const head = segments.slice(0, baseSegments.length).join("/");
    return head === baseSegments.join("/") ? segments.slice(baseSegments.length) : segments;
  }

  /**
 * 相对路径 → 绝对 URL（逐段编码）。
 * `withTrailingSlash`：集合操作（PROPFIND/MKCOL）带尾斜杠——RFC 4918 下集合以 `/` 结尾，
 * 部分服务器对缺斜杠的集合请求会 301 重定向（依赖 fetch 跟随不如直接写对）。
 */
  function urlOf(relPath: string, withTrailingSlash = false): string {
    const encoded = normalizeRel(relPath).map(encodeURIComponent).join("/");
    if (encoded === "") return `${base}/`;
    return `${base}/${encoded}${withTrailingSlash ? "/" : ""}`;
  }

  /** 发请求（网络错误/超时 → 502 CLOUD_UNREACHABLE） */
  async function davFetch(
    method: string,
    target: string,
    extra?: { body?: string | Uint8Array; headers?: Record<string, string> },
  ): Promise<Response> {
    try {
      return await fetch(target, {
        method,
        headers: { Authorization: authHeader, ...(extra?.headers ?? {}) },
        ...(extra?.body === undefined ? {} : { body: extra.body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
 // undici 的顶层错误常是笼统的 `fetch failed`，真正的诊断信息在 `cause.code`
 // （ECONNREFUSED/ENOTFOUND/ETIMEDOUT…）——把它带上，让「测试连接」的提示可行动。
 // 多地址轮询全失败时 undici 抛 AggregateError（`cause.errors[]`，本身没有 `code`）——
 // 那时逐个取 `errors[].code`，否则文案又退化成无信息量的 `fetch failed`（卡 5 复核登记的坑）。
      const causeCode = describeErrorCause((err as { cause?: unknown }).cause);
      const detail =
        causeCode !== null && !reason.includes(causeCode) ? `${reason}（${causeCode}）` : reason;
      throw new HttpError(502, "CLOUD_UNREACHABLE", `无法连接云盘（${method}）：${detail}`);
    }
  }

  /** 响应体片段（错误提示用；读失败不掩盖原始状态码） */
  async function bodySnippet(res: Response): Promise<string> {
    try {
      const text = await res.text();
      return text.replace(/\s+/g, " ").trim().slice(0, 200);
    } catch {
      return "";
    }
  }

  /**
 * 底层错误的「可读原因」：优先 `cause.code`（`ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`…）；
 * `cause` 是 `AggregateError`（多地址/多族轮询全失败）时取 `cause.errors[].code` 并**去重合并展示**
 * （如 `ECONNREFUSED/ETIMEDOUT`——比只报第一个更有诊断价值）。取不到 → null（调用方回退顶层 message）。
 */
function describeErrorCause(cause: unknown): string | null {
  const direct = (cause as { code?: unknown } | null | undefined)?.code;
  if (typeof direct === "string" && direct !== "") return direct;
  const errors = (cause as { errors?: unknown } | null | undefined)?.errors;
  if (Array.isArray(errors)) {
    const codes = errors
      .map((e) => (e as { code?: unknown } | null | undefined)?.code)
      .filter((c): c is string => typeof c === "string" && c !== "");
    if (codes.length > 0) return [...new Set(codes)].join("/"); // 多地址同因（ECONNREFUSED×2）合并展示
  }
  return null;
}

/** 非预期状态码 → 按码表抛错（配额判定需要在 403 时看响应体） */
  async function throwMapped(res: Response, what: string): Promise<never> {
    const detail = await bodySnippet(res);
    const suffix = detail === "" ? "" : `：${detail}`;
    // 第四个参数 = 上游原始状态码（对外仍是 502/… 的映射码；调用方靠它区分错因，如「名字被拒」）
    if (res.status === 507 || (res.status === 403 && /quota|insufficient|配额|空间|流量|容量/i.test(detail))) {
      throw new HttpError(502, "CLOUD_QUOTA_EXCEEDED", `云盘空间或上传流量不足（${what}）${suffix}`, res.status);
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(
        502,
        "CLOUD_AUTH_FAILED",
        `云盘认证失败（${what}，HTTP ${res.status}）——请检查 WebDAV 地址与用户名/应用密码`,
        res.status,
      );
    }
    throw new HttpError(502, "CLOUD_UNREACHABLE", `云盘返回 HTTP ${res.status}（${what}）${suffix}`, res.status);
  }

  return {
    async list(relPath) {
      const res = await davFetch("PROPFIND", urlOf(relPath, true), {
        headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
        body: PROPFIND_BODY,
      });
      if (res.status === 404) return null; // 目录不存在（是否创建由调用方决定）
      if (res.status !== 207 && !res.ok) await throwMapped(res, `列目录 ${urlOf(relPath, true)}`);
      const xml = await res.text();
      const parsed = parsePropfind(xml);
      // **空 multistatus = 路径不存在**（不是「存在但为空」）：Depth:1 的 PROPFIND 对**存在的**集合
      // 必然至少返回集合自身一个条目（我们随后会把它过滤掉，故「存在但空目录」也可能得到 `[]`——
      // 区别就在这里：先看**原始**条目数）。部分服务器（坚果云实测）对不存在的集合回 207 + 空 body
      // 而不是 404；若把它当「存在但空」，调用方会跳过 MKCOL，后续 PUT 才报 404 ObjectNotFound。
      if (parsed.length === 0) return null;
      return parsed
        .map((entry) => ({
          ...entry,
          path: toBaseRelativeSegments(entry.path === "" ? [] : entry.path.split("/")).join("/"),
        }))
        .filter((entry) => !isSelf(entry.path, relPath));
    },

    async mkcol(relPath) {
      // **不带尾斜杠**：RFC 4918 §9.3.1 的示例形态。带尾斜杠时部分服务器（实测坚果云）会回
      // 405「已存在」却并不创建 → 调用方以为目录就绪，后续 PUT 才 404（误导性极强的错位）。
      const target = urlOf(relPath, false);
      const res = await davFetch("MKCOL", target);
      if (res.ok) return true;
      // 405 = 目标已存在（RFC 4918）；301/302 = 部分服务器对已存在目录的规范化跳转
      if (res.status === 405 || res.status === 301 || res.status === 302) return false;
      await throwMapped(res, `创建目录 ${target}`);
      return false;
    },

    async put(relPath, body) {
      const res = await davFetch("PUT", urlOf(relPath), {
        body,
        headers: { "Content-Type": "application/zip" },
      });
      if (!res.ok) await throwMapped(res, `上传 ${urlOf(relPath)}`);
    },

    async get(relPath) {
      const res = await davFetch("GET", urlOf(relPath));
      if (res.status === 404) return null;
      if (!res.ok) await throwMapped(res, `下载 ${urlOf(relPath)}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async move(fromRelPath, toRelPath) {
      // RFC 4918：MOVE 的目标写在 `Destination` 头（绝对 URL）。
      // `Overwrite: T`（默认）：**同一份备份重复推送**（用户连点、或上次推完清理失败再推）时
      // 正式名已存在，覆盖它才是幂等语义；跨机器同名冲突由推送侧的 head 判定拦在前面，
      // 不靠 MOVE 报 412 兜底（那会让「重推同一份」永远失败）。
      const res = await davFetch("MOVE", urlOf(fromRelPath), {
        headers: { Destination: urlOf(toRelPath), Overwrite: "T" },
      });
      if (res.ok) return;
      // 兜底：部分云盘（坚果云实测）即使带 `Overwrite: T` 也因「目标已存在」回 409 DuplicateName——
      // 此时删掉目标再重试一次（目标是被覆盖的那一份，删掉不会损失别的东西）。
      if (res.status === 409 || res.status === 412) {
        await this.remove(toRelPath).catch(() => undefined);
        const retry = await davFetch("MOVE", urlOf(fromRelPath), {
          headers: { Destination: urlOf(toRelPath), Overwrite: "T" },
        });
        if (retry.ok) return;
        await throwMapped(retry, `改名 ${urlOf(fromRelPath)} → ${urlOf(toRelPath)}`);
      }
      await throwMapped(res, `改名 ${urlOf(fromRelPath)} → ${urlOf(toRelPath)}`);
    },

    async remove(relPath) {
      const res = await davFetch("DELETE", urlOf(relPath));
      if (res.status === 404) return; // 幂等：已不存在即视为已删
      if (!res.ok) await throwMapped(res, `删除 ${urlOf(relPath)}`);
    },

    async removeDir(relPath) {
      // 集合删除：先试「带尾斜杠 + Depth: infinity」（RFC 形态），失败再退回无斜杠形态
      const withSlash = urlOf(relPath, true);
      const first = await davFetch("DELETE", withSlash, { headers: { Depth: "infinity" } });
      if (first.ok || first.status === 404) return;
      const second = await davFetch("DELETE", urlOf(relPath));
      if (second.ok || second.status === 404) return;
      await throwMapped(second, `删除目录 ${urlOf(relPath)}`);
    },
  };
}
