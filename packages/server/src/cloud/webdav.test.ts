// WebDAV 客户端测试（卡 2）：窄 XML 解析 / 请求形态（URL 编码 / 认证头） / 错误映射
//
// 契约：docs/design/40-cloud-sync.md §2（传输层只做 WebDAV、出站走全局 fetch）、
// docs/api/error-code.md（四个云错误码映射）。全部用 stub 的 fetch——不打真实网络。
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../middleware/error.js";
import { DEFAULT_WEBDAV_TIMEOUT_MS, createWebdavClient, parsePropfind } from "./webdav.js";

/** 构造客户端（默认指向一个假云盘根；timeoutMs 小值避免测试悬挂） */
function makeClient(overrides: Partial<Parameters<typeof createWebdavClient>[0]> = {}) {
  return createWebdavClient({
    url: "https://dav.example.com/dav/ai-editor",
    username: "me@example.com",
    password: "app-pw",
    timeoutMs: 1000,
    ...overrides,
  });
}

/** stub 全局 fetch 并返回 spy */
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn((input: unknown, init?: RequestInit) => Promise.resolve(handler(String(input), init ?? {})));
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** 断言 HttpError 的码与状态 */
function expectHttpError(err: unknown, code: string, status: number): void {
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).code).toBe(code);
  expect((err as HttpError).status).toBe(status);
}

/** 取一次调用（断言请求形态用） */
function callOf(spy: ReturnType<typeof stubFetch>, index = 0): { url: string; init: RequestInit } {
  const call = spy.mock.calls[index] as unknown as [unknown, RequestInit];
  return { url: String(call[0]), init: call[1] };
}

/** 典型 PROPFIND 响应（命名空间前缀 `D:`、中文名百分号编码、含目录自身条目） */
const PROPFIND_XML = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/ai-editor/books/%E6%96%97%E7%A0%B4-proj-x/</D:href>
    <D:propstat><D:prop>
      <D:resourcetype><D:collection/></D:resourcetype>
      <D:getlastmodified>Tue, 01 Sep 2026 10:00:00 GMT</D:getlastmodified>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/ai-editor/books/%E6%96%97%E7%A0%B4-proj-x/20260813-101530123-%E8%87%AA%E5%8A%A8-%E8%8B%B9%E6%9E%9C%E6%9C%AC-%E4%BA%BA%E7%89%A932-%E8%AE%BE%E5%AE%9A58-%E7%AB%A0120.zip</D:href>
    <D:propstat><D:prop>
      <D:resourcetype/>
      <D:getcontentlength>4096</D:getcontentlength>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/ai-editor/books/%E6%96%97%E7%A0%B4-proj-x/.tmp-%E5%8D%8A%E6%88%AA.zip</D:href>
    <D:propstat><D:prop><D:resourcetype/><D:getcontentlength>0</D:getcontentlength></D:prop></D:propstat>
  </D:response>
</D:multistatus>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parsePropfind（窄解析：命名空间前缀 / 编码 / 实体）", () => {
  it("解析 href 解码、集合判定、size 与 lastModified；结果按 path **代码单元序**升序", () => {
    const entries = parsePropfind(PROPFIND_XML);
    expect(entries.map((e) => e.name)).toEqual([
      "斗破-proj-x",
      ".tmp-半截.zip", // 代码单元序：`.` (0x2E) < `2` (0x32)
      "20260813-101530123-自动-苹果本-人物32-设定58-章120.zip",
    ]);
    expect(entries[0]).toMatchObject({
      path: "dav/ai-editor/books/斗破-proj-x",
      isCollection: true,
      size: null,
      lastModified: "Tue, 01 Sep 2026 10:00:00 GMT",
    });
    expect(entries[2]).toMatchObject({ isCollection: false, size: 4096, lastModified: null });
    expect(entries.every((e) => e.href.startsWith("/dav/"))).toBe(true);
  });

  it("无命名空间前缀（部分服务器）同样解析；XML 实体还原", () => {
    const xml = `<multistatus><response><href>/dav/a%20b/x&amp;y.zip</href><propstat><prop><resourcetype/><getcontentlength>7</getcontentlength></prop></propstat></response></multistatus>`;
    const entries = parsePropfind(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "x&y.zip", path: "dav/a b/x&y.zip", size: 7, isCollection: false });
  });

  it("绝对 URL 形式的 href（取 pathname）与非法百分号编码（原样返回，不抛错）", () => {
    const xml = `<D:multistatus xmlns:D="DAV:"><D:response><D:href>https://dav.example.com/dav/ai-editor/books/x.zip</D:href><D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat></D:response><D:response><D:href>/dav/ai-editor/books/100%.zip</D:href><D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat></D:response></D:multistatus>`;
    const entries = parsePropfind(xml);
    expect(entries.map((e) => e.name)).toEqual(["100%.zip", "x.zip"]);
  });

  it("无 href 的坏块与非法 size 文本被跳过/置 null", () => {
    const xml = `<D:multistatus xmlns:D="DAV:"><D:response><D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat></D:response><D:response><D:href>/dav/x.zip</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>abc</D:getcontentlength></D:prop></D:propstat></D:response></D:multistatus>`;
    const entries = parsePropfind(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.size).toBeNull();
  });
});

describe("list（Depth: 1，剔除目录自身）", () => {
  it("请求形态：PROPFIND + Depth: 1 + Basic 认证 + 逐段百分号编码（中文书名/空格）", async () => {
    const spy = stubFetch(() => new Response(PROPFIND_XML, { status: 207 }));
    const entries = await makeClient().list("books/斗破-proj-x");
    const { url, init } = callOf(spy);
    expect(url).toBe("https://dav.example.com/dav/ai-editor/books/%E6%96%97%E7%A0%B4-proj-x/");
    expect(init.method).toBe("PROPFIND");
    expect((init.headers as Record<string, string>).Depth).toBe("1");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("me@example.com:app-pw").toString("base64")}`,
    );
    expect(String(init.body)).toContain("<d:propfind");
    // 目录自身被剔除，只剩两个文件（代码单元序：`.tmp-` 在前）
    expect(entries?.map((e) => e.name)).toEqual([
      ".tmp-半截.zip",
      "20260813-101530123-自动-苹果本-人物32-设定58-章120.zip",
    ]);
  });

  it("根目录（空 relPath）→ 请求根 URL；404 → null（目录不存在，不抛错）", async () => {
    const spy = stubFetch(() => new Response("", { status: 404 }));
    expect(await makeClient().list("")).toBeNull();
    expect(callOf(spy).url).toBe("https://dav.example.com/dav/ai-editor/");
  });

  it("根目录列举：自身条目（href 为 `/`）也被剔除，只留子项", async () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/%E4%B9%A6-proj-x/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`;
    stubFetch(() => new Response(xml, { status: 207 }));
    const entries = await makeClient().list("");
    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toMatchObject({ name: "书-proj-x", isCollection: true });
  });

  it("带路径前缀的 base：自身条目被剔除，且 path 为 **base 相对**（oracle 卡 2 F2）", async () => {
    const rootXml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/ai-editor/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/dav/ai-editor/%E4%B9%A6-proj-x/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/dav/ai-editor/x.zip</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>3</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>`;
    stubFetch(() => new Response(rootXml, { status: 207 }));
    const entries = await makeClient().list("");
    // 无 `dav/ai-editor/` 前缀，也无幽灵根条目（代码单元序：x < 书）
    expect(entries?.map((e) => e.path)).toEqual(["x.zip", "书-proj-x"]);

    const subXml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/ai-editor/sub</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/dav/ai-editor/sub/y.zip</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>`;
    stubFetch(() => new Response(subXml, { status: 207 }));
    expect((await makeClient().list("sub"))?.map((e) => e.path)).toEqual(["sub/y.zip"]);
  });

  it("服务器 href 与请求前缀不一致（反代重写）：不做剥离、不误剔", async () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/x.zip</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>`;
    stubFetch(() => new Response(xml, { status: 207 }));
    expect((await makeClient().list(""))?.map((e) => e.path)).toEqual(["x.zip"]);
  });

  it("尾斜杠的 base url 归一（不产生双斜杠）", async () => {
    const spy = stubFetch(() => new Response(PROPFIND_XML, { status: 207 }));
    await makeClient({ url: "https://dav.example.com/dav/ai-editor///" }).list("");
    expect(callOf(spy).url).toBe("https://dav.example.com/dav/ai-editor/");
  });

  it("207 之外的 2xx（部分服务器回 200）也接受", async () => {
    stubFetch(() => new Response(PROPFIND_XML, { status: 200 }));
    expect(await makeClient().list("books/斗破-proj-x")).toHaveLength(2);
  });
});

describe("mkcol / put / remove", () => {
  it("mkcol：201 → true；405（已存在）→ false", async () => {
    stubFetch(() => new Response("", { status: 201 }));
    expect(await makeClient().mkcol("books/新书")).toBe(true);
    stubFetch(() => new Response("", { status: 405 }));
    expect(await makeClient().mkcol("books/已存在")).toBe(false);
  });

  it("put：PUT + Content-Type application/zip + 原始字节体", async () => {
    const spy = stubFetch(() => new Response("", { status: 201 }));
    const body = new TextEncoder().encode("PK\u0003\u0004");
    await makeClient().put(".tmp-x.zip", body);
    const { url, init } = callOf(spy);
    expect(url).toBe("https://dav.example.com/dav/ai-editor/.tmp-x.zip");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/zip");
    expect(init.body).toBe(body);
  });

  it("remove：DELETE；404 幂等返回（不抛错）", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(makeClient().remove("x.zip")).resolves.toBeUndefined();
    stubFetch(() => new Response(null, { status: 404 }));
    await expect(makeClient().remove("已删除.zip")).resolves.toBeUndefined();
  });
});

describe("错误映射（→ HttpError；码表 docs/api/error-code.md）", () => {
  it("401/403 → 502 CLOUD_AUTH_FAILED（提示核对地址与凭据）", async () => {
    for (const status of [401, 403]) {
      stubFetch(() => new Response("Unauthorized", { status }));
      try {
        await makeClient().list("");
        expect.unreachable("应当抛错");
      } catch (err) {
        expectHttpError(err, "CLOUD_AUTH_FAILED", 502);
        expect((err as HttpError).message).toContain("应用密码");
      }
    }
  });

  it("507 → 502 CLOUD_QUOTA_EXCEEDED", async () => {
    stubFetch(() => new Response("Insufficient Storage", { status: 507 }));
    try {
      await makeClient().put("x.zip", new Uint8Array([1]));
      expect.unreachable("应当抛错");
    } catch (err) {
      expectHttpError(err, "CLOUD_QUOTA_EXCEEDED", 502);
    }
  });

  it("403 带配额提示（国内网盘常见）→ CLOUD_QUOTA_EXCEEDED；403 无提示 → AUTH_FAILED", async () => {
    stubFetch(() => new Response("上传流量已用尽，请升级", { status: 403 }));
    await expect(makeClient().put("x.zip", new Uint8Array([1]))).rejects.toMatchObject({
      code: "CLOUD_QUOTA_EXCEEDED",
    });
    stubFetch(() => new Response("Forbidden", { status: 403 }));
    await expect(makeClient().put("x.zip", new Uint8Array([1]))).rejects.toMatchObject({
      code: "CLOUD_AUTH_FAILED",
    });
  });

  it("5xx 与其它 4xx → 502 CLOUD_UNREACHABLE（含状态码与响应片段）", async () => {
    stubFetch(() => new Response("Server Error", { status: 500 }));
    try {
      await makeClient().list("");
      expect.unreachable("应当抛错");
    } catch (err) {
      expectHttpError(err, "CLOUD_UNREACHABLE", 502);
      expect((err as HttpError).message).toContain("HTTP 500");
    }
    stubFetch(() => new Response("Conflict", { status: 409 }));
    await expect(makeClient().mkcol("a/b")).rejects.toMatchObject({ code: "CLOUD_UNREACHABLE" });
  });

  it("网络错误/超时 → 502 CLOUD_UNREACHABLE（附原因）", async () => {
    stubFetch(() => {
      throw new Error("fetch failed: ENOTFOUND dav.example.com");
    });
    try {
      await makeClient().list("");
      expect.unreachable("应当抛错");
    } catch (err) {
      expectHttpError(err, "CLOUD_UNREACHABLE", 502);
      expect((err as HttpError).message).toContain("ENOTFOUND");
    }
  });

  it("undici 笼统的 `fetch failed` 会带上 cause.code（对用户可行动：ECONNREFUSED/ENOTFOUND…）", async () => {
    stubFetch(() => {
 // undici 真实形态：message 笼统、诊断在 cause.code
      const err = new Error("fetch failed") as Error & { cause?: { code?: string } };
      err.cause = { code: "ECONNREFUSED" };
      throw err;
    });
    await expect(makeClient().list("")).rejects.toMatchObject({ code: "CLOUD_UNREACHABLE" });
    try {
      await makeClient().list("");
      expect.unreachable("应当抛错");
    } catch (err) {
      expect((err as HttpError).message).toContain("fetch failed（ECONNREFUSED）");
    }
  });

  it("单次请求带超时信号（AbortSignal；缺省 30s）", async () => {
    const spy = stubFetch(() => new Response(PROPFIND_XML, { status: 207 }));
    await makeClient().list("");
    expect(callOf(spy).init.signal).toBeInstanceOf(AbortSignal);
    expect(DEFAULT_WEBDAV_TIMEOUT_MS).toBe(30_000);
  });
});

describe("PROPFIND 空 multistatus = 路径不存在（坚果云实测）", () => {
  it("207 + 空 body → list() 返回 null（否则调用方会跳过 MKCOL，PUT 才报 404）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"></D:multistatus>', { status: 207 }))),
    );
    const client = createWebdavClient({ url: "https://dav.jianguoyun.com/dav/ai-editor", username: "u", password: "p" });
    await expect(client.list("")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("207 + 仅自身条目 → 存在但为空：返回 []（与「不存在」区分）", async () => {
    const selfOnly = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/ai-editor/</D:href><D:propstat><D:prop><D:displayname>ai-editor</D:displayname><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(selfOnly, { status: 207 }))));
    const client = createWebdavClient({ url: "https://dav.jianguoyun.com/dav/ai-editor", username: "u", password: "p" });
    await expect(client.list("")).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });

  it("404 仍返回 null（原有语义不变）", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))));
    const client = createWebdavClient({ url: "https://dav.example.com/dav", username: "u", password: "p" });
    await expect(client.list("")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("MKCOL 形态与目录复核（坚果云实测反馈）", () => {
  it("mkcol 请求 URL 不带尾斜杠（带尾斜杠时部分服务器回 405 却并不创建）", async () => {
    const spy = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
    vi.stubGlobal("fetch", spy);
    const client = createWebdavClient({ url: "https://dav.jianguoyun.com/dav", username: "u", password: "p" });
    await client.mkcol("ai-editor");
    expect(spy.mock.calls[0]?.[0]).toBe("https://dav.jianguoyun.com/dav/ai-editor");
    expect(String(spy.mock.calls[0]?.[0])).not.toMatch(/\/$/);
    vi.unstubAllGlobals();
  });

  it("405 仍视为「已存在」（不抛错），其它状态抛映射错误并带上路径", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 405 }))));
    const client = createWebdavClient({ url: "https://dav.example.com/dav", username: "u", password: "p" });
    await expect(client.mkcol("x")).resolves.toBe(false);
    vi.unstubAllGlobals();

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 409 }))));
    const client2 = createWebdavClient({ url: "https://dav.example.com/dav", username: "u", password: "p" });
    // 报错带上完整 URL（自查路径用；本卡同时把「创建目录 x」改成目标地址）
    await expect(client2.mkcol("x")).rejects.toMatchObject({
      message: expect.stringContaining("创建目录 https://dav.example.com/dav/x"),
    });
    vi.unstubAllGlobals();
  });
});

describe("不可达文案的底层错误码（卡 C）", () => {
  it("普通 Error 的 cause.code 照旧带上（ECONNREFUSED）", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("fetch failed", { cause: { code: "ECONNREFUSED" } }))));
    const client = createWebdavClient({ url: "https://dav.example.com/dav", username: "u", password: "p" });
    await expect(client.list("")).rejects.toMatchObject({
      code: "CLOUD_UNREACHABLE",
      message: expect.stringContaining("ECONNREFUSED"),
    });
    vi.unstubAllGlobals();
  });

  it("AggregateError（多地址全失败）取 cause.errors[].code，不退化成 fetch failed", async () => {
    const agg = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("all addresses failed"), {
        errors: [{ code: "ECONNREFUSED" }, { code: "ECONNREFUSED" }, { code: "ETIMEDOUT" }],
      }),
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(agg)));
    const client = createWebdavClient({ url: "https://dav.example.com/dav", username: "u", password: "p" });
    const err = await client.list("").catch((e: unknown) => e as { message: string });
    expect(err.message).toContain("ECONNREFUSED"); // 去重后合并展示
    expect(err.message).toContain("ETIMEDOUT");
    expect(err.message).not.toContain("fetch failed）"); // 不再是「fetch failed」裸文案
    vi.unstubAllGlobals();
  });

  it("cause.errors 里没有可用 code → 回退顶层 message（不抛、不空文案）", async () => {
    const agg = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("agg"), { errors: [new Error("x"), new Error("y")] }),
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(agg)));
    const client = createWebdavClient({ url: "https://dav.example.com/dav", username: "u", password: "p" });
    await expect(client.list("")).rejects.toMatchObject({ message: expect.stringContaining("fetch failed") });
    vi.unstubAllGlobals();
  });
});
