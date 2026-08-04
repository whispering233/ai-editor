// startServer 集成测试（T6.1）：
//   health 探活 / SPA fallback（fixture clientDist）/ 静态文件 / 未知 API 404 /
//   clientDist 缺失优雅降级 / 端口策略（生产 +1、dev 报错）/ close 释放
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePortEnv, resolveClientDist, startServer } from "./index.js";

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

  it("相对路径创作根 → list 返回绝对 rootPath（2026-08 修复：前端拼路径可过 isAbsolute 校验）", async () => {
    // 模拟 CLI 相对路径启动（node dist/index.js test-project）：startServer 内部须归一化为
    // 绝对路径（基于 process.cwd() resolve），否则 list 返回相对 rootPath → 前端
    // buildBookPath 拼出相对路径 → POST /project/create 的 resolveProjectDir 400 拒绝
    const dir = makeTmpDir();
    const handle = await startServer(relative(process.cwd(), dir), { port: 0, openBrowser: false });
    try {
      const res = await handle.app.request("http://127.0.0.1/api/v1/project/list", { headers: { host: "127.0.0.1" } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.rootPath).toBe(resolve(dir)); // 绝对路径（resolve 对绝对输入幂等）
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

describe("defaultClientDist 双路径探测（resolveClientDist 纯函数）", () => {
  // fixture 结构（模拟模块目录）：
  //   <tmp>/packages/server/dist           → baseDir（对应 dist 或 src）
  //   <tmp>/packages/client/dist           → monorepo 路径（resolve ../../client/dist）
  //   <tmp>/packages/server/client-dist    → 安装态路径（resolve ../client-dist）
  it("monorepo 路径存在时优先", () => {
    const dir = makeTmpDir();
    const baseDir = join(dir, "packages", "server", "dist");
    mkdirSync(join(dir, "packages", "client", "dist"), { recursive: true }); // 仅 monorepo 路径
    expect(resolveClientDist(baseDir)).toBe(resolve(baseDir, "../../client/dist"));
  });

  it("monorepo 缺失时回退安装态路径", () => {
    const dir = makeTmpDir();
    const baseDir = join(dir, "packages", "server", "dist");
    mkdirSync(join(baseDir, "..", "client-dist"), { recursive: true }); // 仅安装态路径
    expect(resolveClientDist(baseDir)).toBe(resolve(baseDir, "../client-dist"));
  });

  it("两路径都存在时取 monorepo", () => {
    const dir = makeTmpDir();
    const baseDir = join(dir, "packages", "server", "dist");
    mkdirSync(join(dir, "packages", "client", "dist"), { recursive: true });
    mkdirSync(join(baseDir, "..", "client-dist"), { recursive: true });
    expect(resolveClientDist(baseDir)).toBe(resolve(baseDir, "../../client/dist"));
  });
});

describe("AI_EDITOR_PORT 解析（parsePortEnv）", () => {
  it("非法值（NaN/越界/非整数/空串/未设置）→ undefined（bin 入口回退默认 3456）", () => {
    expect(parsePortEnv("abc")).toBeUndefined();
    expect(parsePortEnv("0")).toBeUndefined();
    expect(parsePortEnv("65536")).toBeUndefined();
    expect(parsePortEnv("12.5")).toBeUndefined();
    expect(parsePortEnv("")).toBeUndefined();
    expect(parsePortEnv(undefined)).toBeUndefined();
  });

  it("合法值（1-65535 整数）原样返回", () => {
    expect(parsePortEnv("3456")).toBe(3456);
    expect(parsePortEnv("1")).toBe(1);
    expect(parsePortEnv("65535")).toBe(65535);
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
