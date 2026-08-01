// startServer 集成测试（T6.1）：
//   health 探活 / SPA fallback（fixture clientDist）/ 静态文件 / 未知 API 404 /
//   clientDist 缺失优雅降级 / 端口策略（生产 +1、dev 报错）/ close 释放
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startServer } from "./index.js";

const tmpDirs: string[] = [];
const occupiedServers: Server[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-editor-srv-"));
  tmpDirs.push(dir);
  return dir;
}

/** 构造 client/dist fixture：index.html + assets/app.js */
function makeClientDist(root: string): string {
  const dist = join(root, "client-dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>测试 SPA</title><div id=\"root\"></div>");
  writeFileSync(join(dist, "assets", "app.js"), "console.log('fixture');");
  return dist;
}

/** 占用一个真实端口（EADDRINUSE 触发用） */
function occupyPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      occupiedServers.push(server);
      resolve((server.address() as { port: number }).port);
    });
  });
}

afterEach(async () => {
  for (const s of occupiedServers.splice(0)) {
    await new Promise((r) => s.close(r));
  }
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("startServer 基础路由", () => {
  it("health 探活返回 ok 包裹", async () => {
    const handle = await startServer(makeTmpDir(), { port: 0, openBrowser: false });
    try {
      const res = await handle.app.request("http://127.0.0.1/api/v1/health", { headers: { host: "127.0.0.1" } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { status: "ok" } });
    } finally {
      await handle.close();
    }
  });

  it("未知 /api 端点 → 404 JSON 包裹", async () => {
    const handle = await startServer(makeTmpDir(), { port: 0, openBrowser: false });
    try {
      const res = await handle.app.request("http://127.0.0.1/api/v1/unknown", { headers: { host: "127.0.0.1" } });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        success: false,
        error: { code: "NOT_FOUND", message: expect.stringContaining("未知 API 端点") },
      });
    } finally {
      await handle.close();
    }
  });
});

describe("SPA 静态服务（决策 8 单进程架构）", () => {
  it("非 /api GET → fallback 到 index.html", async () => {
    const handle = await startServer(makeTmpDir(), {
      port: 0,
      openBrowser: false,
      clientDist: makeClientDist(makeTmpDir()),
    });
    try {
      const res = await handle.app.request("http://127.0.0.1/outline", { headers: { host: "127.0.0.1" } }); // 前端路由
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("<title>测试 SPA</title>");
    } finally {
      await handle.close();
    }
  });

  it("/assets/* 静态文件按 MIME 返回", async () => {
    const handle = await startServer(makeTmpDir(), {
      port: 0,
      openBrowser: false,
      clientDist: makeClientDist(makeTmpDir()),
    });
    try {
      const res = await handle.app.request("http://127.0.0.1/assets/app.js", { headers: { host: "127.0.0.1" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/javascript");
      expect(await res.text()).toContain("fixture");
    } finally {
      await handle.close();
    }
  });

  it("clientDist 缺失时优雅降级 404 提示先构建", async () => {
    const handle = await startServer(makeTmpDir(), {
      port: 0,
      openBrowser: false,
      clientDist: join(makeTmpDir(), "不存在"),
    });
    try {
      const res = await handle.app.request("http://127.0.0.1/", { headers: { host: "127.0.0.1" } });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        success: false,
        error: { code: "NOT_FOUND", message: expect.stringContaining("client/dist 未构建") },
      });
    } finally {
      await handle.close();
    }
  });

  it("目录穿越被拦截（解析路径必须在 clientDist 内）", async () => {
    const dist = makeClientDist(makeTmpDir());
    const handle = await startServer(makeTmpDir(), { port: 0, openBrowser: false, clientDist: dist });
    try {
      const res = await handle.app.request("http://127.0.0.1/../../etc/passwd", { headers: { host: "127.0.0.1" } });
      // 不返回文件内容（回退到 index.html 或 404）
      const text = await res.text();
      expect(text).not.toContain("root:");
    } finally {
      await handle.close();
    }
  });
});

describe("端口策略（决策 8 / 17 修订）", () => {
  it("生产态端口被占自动 +1", async () => {
    const occupiedPort = await occupyPort();
    const handle = await startServer(makeTmpDir(), { port: occupiedPort, openBrowser: false });
    try {
      expect(handle.port).toBe(occupiedPort + 1);
      // 实际可访问
      const res = await fetch(`http://127.0.0.1:${handle.port}/api/v1/health`);
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it("dev 态端口被占直接报错（不自动 +1）", async () => {
    const occupiedPort = await occupyPort();
    await expect(
      startServer(makeTmpDir(), { port: occupiedPort, openBrowser: false, dev: true }),
    ).rejects.toThrow(/已被占用/);
  });
});
