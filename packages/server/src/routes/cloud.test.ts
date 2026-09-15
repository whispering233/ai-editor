// 云端路由测试（卡 2）：GET /status、PUT /config、POST /test
//
// 契约：docs/api/100-api-cloud.md（三端点的字段与错误码）、docs/design/40-cloud-sync.md §7（凭据纪律）。
// 隔离：临时创作根 + initCloudState；fetch 全部 stub（不打真实网络）。
// 断言重点：**任何响应都不含 password**（不是脱敏，而是根本不回传）、0600 权限、错误码映射。
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.js";
import { WEBDAV_WRITE_TEST_DIR, WEBDAV_WRITE_TEST_FILE } from "./cloud.js";
import { cloudRoutes } from "./cloud.js";
import { initCloudState, readCloudFile, readWebdavConfig } from "../cloud/state.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const JSON_HEADERS = { ...HOST_HEADERS, "content-type": "application/json" };
const PASSWORD = "app-password-秘密值";

/** 组装带错误处理的测试 app */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.route("/api/v1/cloud", cloudRoutes);
  return app;
}

/** 云端根目录的 PROPFIND 响应（健康路径：只含目录自身） */
const PROPFIND_ROOT_OK = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/ai-editor/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response></D:multistatus>`;

let root: string;
let app: Hono;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-editor-cloud-routes-"));
  initCloudState(root);
  app = buildApp();
});

afterEach(() => {
  initCloudState(null);
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

/** 写入一份配置（走真实端点，顺带验证写入路径） */
async function putConfig(body: Record<string, unknown>) {
  return app.request("/api/v1/cloud/config", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

describe("GET /api/v1/cloud/status（配置段）", () => {
  it("未配置：configured=false、url/username 为 null、device 回缺省 hostname、projectId=null", async () => {
    const res = await app.request("/api/v1/cloud/status", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      configured: false,
      url: null,
      username: null,
      autoPush: false,
      projectId: null,
      remote: null,
      local: null,
      state: "unconfigured",
    });
    expect(typeof body.data.device).toBe("string");
    expect(body.data.device.length).toBeGreaterThan(0);
    // 没设过设备名 → device 是派生值、deviceConfigured=false（面板据此**不预填**，卡 (a)）
    expect(body.data.deviceConfigured).toBe(false);
  });

  it("配置后回显三项中的 url/username + 设备名与开关；**响应文本不含 password**", async () => {
    await putConfig({ url: "https://dav.example.com/dav/ai-editor/", username: "me@example.com", password: PASSWORD, device: "苹果本", autoPush: true });
    const res = await app.request("/api/v1/cloud/status", { headers: HOST_HEADERS });
    const text = await res.text();
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("password");
    expect(JSON.parse(text).data).toEqual({
      configured: true,
      url: "https://dav.example.com/dav/ai-editor",
      username: "me@example.com",
      device: "苹果本",
      deviceConfigured: true, // 用户显式设过（面板据此预填该值）
      autoPush: true,
      projectId: null,
      remote: null, // 无项目打开 → 不做云端检查（卡 4 起 remote 段）
      local: null, // 无项目打开 → 无本机段（卡 5）
      state: "no-project", // 三态（卡 5）：已配置但未打开项目
    });
  });

  it("清空设备名（空串）→ 回缺省 hostname 派生，且 deviceConfigured 回到 false（卡 (a)）", async () => {
    await putConfig({ url: "https://dav.example.com/dav/ai-editor", username: "me@example.com", password: PASSWORD, device: "苹果本" });
    await putConfig({ device: "" }); // 清空 = 回缺省
    const body = await (await app.request("/api/v1/cloud/status", { headers: HOST_HEADERS })).json();
    expect(body.data.deviceConfigured).toBe(false);
    expect(body.data.device.length).toBeGreaterThan(0);
    expect(body.data.device).not.toBe("苹果本");
  });
});

describe("PUT /api/v1/cloud/config", () => {
  it("写入成功：200 {saved:true}、响应不含 password、文件权限 0600", async () => {
    const res = await putConfig({ url: "https://dav.example.com/dav", username: "u", password: PASSWORD });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).data).toEqual({ saved: true });
    expect(text).not.toContain(PASSWORD);
    expect(statSync(join(root, ".ai-editor", "cloud.json")).mode & 0o777).toBe(0o600);
    expect(readWebdavConfig()).toEqual({ url: "https://dav.example.com/dav", username: "u", password: PASSWORD });
  });

  it("url 归一化：去尾斜杠；**三项齐空 → 回到未配置且密码一并丢弃**（oracle 卡 2 F3）", async () => {
    await putConfig({ url: "https://dav.example.com/dav/ai-editor///", username: "u", password: "SECRET-PW" });
    expect(readWebdavConfig()?.url).toBe("https://dav.example.com/dav/ai-editor");
 // UI 表单里的「清除凭据」：清空 url+username，密码框留空（不传 / 空串）
    await putConfig({ url: "", username: "" });
    expect(readWebdavConfig()).toBeNull();
    expect(JSON.stringify(readCloudFile())).not.toContain("SECRET-PW"); // 死密码不留在磁盘上
    await putConfig({ url: "", username: "" });
    expect((await (await app.request("/api/v1/cloud/status", { headers: HOST_HEADERS })).json()).data.configured).toBe(false);
  });

  it("url 内嵌用户名/密码（userinfo）→ 400，且不静默剥离、不落盘（oracle 卡 2 F1）", async () => {
    const res = await putConfig({ url: "https://user:URL-SECRET@dav.example.com/dav", username: "u", password: "pw" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("不得内嵌用户名/密码");
    expect(body.error.message).not.toContain("URL-SECRET"); // 错误文案也不回显输入里的凭据
    expect(readCloudFile()).toBeNull(); // 未落盘（没把坏配置存下来）
  });

  it("password 缺省或空串 = 不修改（设置页表单留空即保留原值）", async () => {
    await putConfig({ url: "https://dav.example.com/dav", username: "u", password: "原密码" });
    await putConfig({ username: "u2" });
    expect(readWebdavConfig()).toMatchObject({ username: "u2", password: "原密码" });
    await putConfig({ password: "" });
    expect(readWebdavConfig()?.password).toBe("原密码");
  });

  it("device：合法值生效；空串 = 回缺省；非法（含 `-`/超长）→ 400 VALIDATION_ERROR", async () => {
    expect((await putConfig({ device: "家里的台式机" })).status).toBe(200);
    expect((await app.request("/api/v1/cloud/status", { headers: HOST_HEADERS })).ok).toBe(true);
    const bad = await putConfig({ device: "MacBook-Pro" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("VALIDATION_ERROR");
    expect((await putConfig({ device: "a".repeat(17) })).status).toBe(400);
    expect((await putConfig({ device: "" })).status).toBe(200);
    // 清除后 status.device 回缺省（非空且不等于被清除的值）
    const status = await (await app.request("/api/v1/cloud/status", { headers: HOST_HEADERS })).json();
    expect(status.data.device).not.toBe("家里的台式机");
  });

  it("url 非法（非 URL / 非 http(s)）→ 400 VALIDATION_ERROR；未知字段 → 400（strict schema）", async () => {
    for (const url of ["不是地址", "ftp://dav.example.com/dav", "file:///tmp/x"]) {
      const res = await putConfig({ url, username: "u", password: "pw" });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
    expect((await putConfig({ nope: 1 })).status).toBe(400);
  });

  it("autoPush 与未知顶层键共存（合并写：books 段不被抹掉）", async () => {
    // 先手工写入一个带 books 段的文件，再走端点改开关
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(root, ".ai-editor"), { recursive: true });
    writeFileSync(
      join(root, ".ai-editor", "cloud.json"),
      JSON.stringify({ webdav: { url: "https://dav.example.com/dav", username: "u", password: "pw" }, books: { "proj-a": { dirName: "书-proj-a" } } }),
    );
    await putConfig({ autoPush: true });
    const file = readCloudFile() as Record<string, unknown>;
    expect(file.books).toEqual({ "proj-a": { dirName: "书-proj-a" } });
  });
});


describe("POST /api/v1/cloud/test", () => {
  /** 按方法分派的 fetch stub（健康路径）+ 记录调用 */
  function stubHealthy(overrides: Partial<Record<string, Response>> = {}) {
    const spy = vi.fn((input: unknown, init?: RequestInit) => {
      const method = String(init?.method ?? "GET");
      const preset = overrides[method];
      if (preset !== undefined) return Promise.resolve(preset);
      if (method === "PROPFIND") return Promise.resolve(new Response(PROPFIND_ROOT_OK, { status: 207 }));
      if (method === "MKCOL" || method === "PUT") return Promise.resolve(new Response(null, { status: 201 }));
      if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("URL 校验失败不回显原始输入（含 userinfo 串，卡 D）", async () => {
    for (const bad of ["ftp://u:pw@host/dav", "https://u:pw@", "不是 URL"]) {
      const res = await app.request("/api/v1/cloud/config", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ url: bad, username: "u", password: "pw" }),
      });
      expect(res.status).toBe(400);
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain("u:pw"); // 原始输入（可能含密码）不得回显
      expect(text).not.toContain("不是 URL");
    }
    // 只回显协议段是允许的（给用户可行动的线索）
    const res = await app.request("/api/v1/cloud/config", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ url: "ftp://host/dav", username: "u", password: "pw" }),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("ftp:");
  });

  it("未配置 → 409 CLOUD_NOT_CONFIGURED（不发起任何请求）", async () => {
    const spy = stubHealthy();
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CLOUD_NOT_CONFIGURED");
    expect(spy).not.toHaveBeenCalled();
  });

  it("读 + 写探测通过 → 200 {connected:true, created:false}；写了临时文件又删掉", async () => {
    await putConfig({ url: "https://dav.example.com/dav/ai-editor", username: "u", password: "pw" });
    const spy = stubHealthy();
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      connected: true,
      baseUrl: "https://dav.example.com/dav/ai-editor",
      created: false,
    });
    const methods = spy.mock.calls.map((c) => String((c[1] as RequestInit).method));
    // 探针先建工作子目录再写文件（坚果云等云盘根目录不可写文件），成功路径连子目录一起清掉
    expect(methods).toEqual(["PROPFIND", "MKCOL", "PUT", "DELETE", "DELETE"]);
    // 探测文件名走 `.tmp-` 前缀（推送前清理流程会回收遗留）；本轮起写在**工作子目录内**
    const putUrl = String((spy.mock.calls[2] as unknown as [unknown])[0]);
    expect(putUrl.endsWith(`/${WEBDAV_WRITE_TEST_FILE}`)).toBe(true);
    expect(putUrl).toContain(`${WEBDAV_WRITE_TEST_DIR}/`);
  });

  it("根目录不存在（404）→ MKCOL 创建 → **复核已存在** → created:true", async () => {
    await putConfig({ url: "https://dav.example.com/dav/ai-editor", username: "u", password: "pw" });
    // 第一次 PROPFIND 404（目录不存在）→ MKCOL → 第二次 PROPFIND 207（复核存在）
    let propfind = 0;
    const spy = vi.fn((_input: unknown, init?: RequestInit) => {
      const method = String(init?.method ?? "GET");
      if (method === "PROPFIND") {
        propfind += 1;
        return Promise.resolve(propfind === 1 ? new Response(null, { status: 404 }) : new Response(PROPFIND_ROOT_OK, { status: 207 }));
      }
      if (method === "MKCOL" || method === "PUT") return Promise.resolve(new Response(null, { status: 201 }));
      if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", spy);
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect((await res.json()).data).toMatchObject({ connected: true, created: true });
    expect(spy.mock.calls.map((c) => String((c[1] as RequestInit).method))).toEqual([
      "PROPFIND",
      "MKCOL",
      "PROPFIND",
      "MKCOL",
      "PUT",
      "DELETE",
      "DELETE",
    ]);
  });

  it("MKCOL 之后目录仍不存在（服务器敷衍式应答）→ 502 明确报「目录不存在且创建失败」（不再错位到 PUT 的 404）", async () => {
    await putConfig({ url: "https://dav.jianguoyun.com/dav/ai-editor", username: "u", password: "pw" });
    stubHealthy({ PROPFIND: new Response(null, { status: 404 }) }); // 永远列不出来
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("CLOUD_UNREACHABLE");
    expect(body.error.message).toContain("云盘目录不存在且创建失败");
    expect(body.error.message).toContain("dav.jianguoyun.com/dav");
  });

  it("探针写进工作子目录（坚果云根目录不可写文件），成功后连子目录一起清理", async () => {
    await putConfig({ url: "https://dav.jianguoyun.com/dav/ai-editor", username: "u", password: "pw" });
    const spy = stubHealthy();
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect((await res.json()).data).toMatchObject({ connected: true });
    const calls = spy.mock.calls.map((c) => [String((c[1] as RequestInit).method), String(c[0])] as const);
    // 顺序：PROPFIND 根 → MKCOL 探针目录 → PUT 探针文件（目录内）→ DELETE 文件 → DELETE 目录
    expect(calls.map(([m]) => m).slice(0, 5)).toEqual(["PROPFIND", "MKCOL", "PUT", "DELETE", "DELETE"]);
    expect(calls[1]?.[1]).toContain(".tmp-ai-editor-writetest-dir");
    expect(calls[2]?.[1]).toContain(".tmp-ai-editor-writetest-dir/.tmp-ai-editor-writetest");
  });

  it("工作子目录建不出来（不支持 MKCOL）→ 探针退回根目录写法（老行为，不因探针失败而误报）", async () => {
    await putConfig({ url: "https://dav.example.com/dav/ai-editor", username: "u", password: "pw" });
    const spy = stubHealthy({ MKCOL: new Response("nope", { status: 403 }) });
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const put = spy.mock.calls.find((c) => String((c[1] as RequestInit).method) === "PUT");
    expect(String(put?.[0])).not.toContain("writetest-dir/"); // 直接写在根下
  });

  it("认证失败（401）→ 502 CLOUD_AUTH_FAILED；不可达（网络错误）→ 502 CLOUD_UNREACHABLE", async () => {
    await putConfig({ url: "https://dav.example.com/dav/ai-editor", username: "u", password: "pw" });
    stubHealthy({ PROPFIND: new Response("Unauthorized", { status: 401 }) });
    const auth = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(auth.status).toBe(502);
    expect((await auth.json()).error.code).toBe("CLOUD_AUTH_FAILED");

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("fetch failed: ECONNREFUSED"))),
    );
    const down = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(down.status).toBe(502);
    expect((await down.json()).error.code).toBe("CLOUD_UNREACHABLE");
  });

  it("写权限不足（PUT 403）→ 502 CLOUD_AUTH_FAILED（读得到但写不了 = 常见误配）", async () => {
    await putConfig({ url: "https://dav.example.com/dav/ai-editor", username: "u", password: "pw" });
    stubHealthy({ PUT: new Response("Forbidden", { status: 403 }) });
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("CLOUD_AUTH_FAILED");
  });

  it("可写不可删（DELETE 403）→ 仍 200 + leftoverWriteTestFile:true（不误报认证失败，卡 C）", async () => {
    await putConfig({ url: "https://dav.example.com/dav/ai-editor", username: "u", password: "pw" });
    stubHealthy({ DELETE: new Response("forbidden", { status: 403 }) });
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { connected: boolean; leftoverWriteTestFile?: boolean } };
    expect(body.data.connected).toBe(true);
    expect(body.data.leftoverWriteTestFile).toBe(true);
  });

  it("响应文本永不含 password（含失败路径）", async () => {
    await putConfig({ url: "https://dav.example.com/dav/ai-editor", username: "u", password: PASSWORD });
    stubHealthy({ PROPFIND: new Response("Unauthorized", { status: 401 }) });
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(await res.text()).not.toContain(PASSWORD);
  });
});
