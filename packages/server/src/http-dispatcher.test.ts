// 出站 HTTP dispatcher 单测：配置解析 + 代理环境写入 + 安装后经全局 fetch 能正常出网（本地回环）
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyHttpProxySettings,
  configureHttpDispatcher,
  DEFAULT_HTTP_IDLE_TIMEOUT_MS,
  formatHttpIdleTimeoutMs,
  parseHttpIdleTimeoutMs,
} from "./http-dispatcher.js";

let server: Server;
let baseUrl = "";
const savedProxy = { http: process.env.HTTP_PROXY, https: process.env.HTTPS_PROXY };

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/slow") {
      // 空闲超时路径：不写响应，由 dispatcher 的 headersTimeout 触发
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("本地测试服务监听失败");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // 环境代理变量还原（测试隔离）
  if (savedProxy.http === undefined) delete process.env.HTTP_PROXY;
  else process.env.HTTP_PROXY = savedProxy.http;
  if (savedProxy.https === undefined) delete process.env.HTTPS_PROXY;
  else process.env.HTTPS_PROXY = savedProxy.https;
});

describe("parseHttpIdleTimeoutMs / formatHttpIdleTimeoutMs", () => {
  it("数字 / 数字串 / disabled 均可解析", () => {
    expect(parseHttpIdleTimeoutMs(30_000)).toBe(30_000);
    expect(parseHttpIdleTimeoutMs("60000")).toBe(60_000);
    expect(parseHttpIdleTimeoutMs("disabled")).toBe(0);
    expect(parseHttpIdleTimeoutMs(1.9)).toBe(1);
  });

  it("非法值 → undefined（不静默转 0）", () => {
    for (const value of ["", "abc", -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}]) {
      expect(parseHttpIdleTimeoutMs(value)).toBeUndefined();
    }
  });

  it("格式化：枚举命中给标签，其余给秒", () => {
    expect(formatHttpIdleTimeoutMs(DEFAULT_HTTP_IDLE_TIMEOUT_MS)).toBe("5 min");
    expect(formatHttpIdleTimeoutMs(0)).toBe("disabled");
    expect(formatHttpIdleTimeoutMs(1_234)).toBe("1.234 sec");
  });
});

describe("applyHttpProxySettings", () => {
  it("仅在未设置时写入 HTTP(S)_PROXY；空值忽略", () => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    applyHttpProxySettings("");
    applyHttpProxySettings("   ");
    expect(process.env.HTTP_PROXY).toBeUndefined();
    applyHttpProxySettings("http://127.0.0.1:7890");
    expect(process.env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(process.env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    // 已设置时不覆盖（env 优先于设置）
    applyHttpProxySettings("http://other:1");
    expect(process.env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    // 用例结束即还原：后续 dispatcher 用例不得被代理地址影响（测试顺序无关）
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
  });
});

describe("configureHttpDispatcher", () => {
  it("非法超时抛错；合法值安装后全局 fetch 可用", async () => {
    // 防误配：无环境代理时本地回环必须直连（若外部环境设了代理，NO_PROXY 保底回环）
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    process.env.NO_PROXY = "127.0.0.1,localhost";
    expect(() => configureHttpDispatcher(-1)).toThrow(/Invalid HTTP idle timeout/);
    configureHttpDispatcher(5_000);
    const res = await fetch(`${baseUrl}/ok`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("headersTimeout 生效：空闲超时后请求失败（而非永久挂起）", async () => {
    configureHttpDispatcher(300);
    await expect(fetch(`${baseUrl}/slow`)).rejects.toBeDefined();
    configureHttpDispatcher(5_000); // 还原，避免影响后续用例
  });
});
