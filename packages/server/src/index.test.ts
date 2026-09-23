// startServer 集成测试（T6.1）：
// health 探活 / SPA fallback（fixture clientDist）/ 静态文件 / 未知 API 404 /
// clientDist 缺失优雅降级 / 端口策略（分段起点默认、窗口内 +1、严格单端口报错）/ close 释放
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "@whispering233/ai-editor-db";
import { PORT_RANGES } from "@whispering233/ai-editor-shared";
import { parsePortEnv, resolveClientDist, startServer } from "./index.js";
import { closeProject, getCurrentProject, setCurrentProject } from "./middleware/project.js";
import { setProjectRoot } from "./routes/project.js";

/** 测试用时间戳（seedBook 构造 project.json） */
const T0 = "2026-08-01T10:00:00Z";

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

/** 占用一个真实端口（EADDRINUSE 触发用；不传端口 = 系统随机分配） */
function occupyPort(port = 0): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, "127.0.0.1", () => {
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
 // 绝对路径（基于 process.cwd resolve），否则 list 返回相对 rootPath → 前端
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

describe("SPA 静态服务（单进程架构）", () => {
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
 // <tmp>/packages/server/dist → baseDir（对应 dist 或 src）
 // <tmp>/packages/client/dist → monorepo 路径（resolve ../../client/dist）
 // <tmp>/packages/server/client-dist → 安装态路径（resolve ../client-dist）
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
  it("非法值（NaN/越界/非整数/空串/未设置）→ undefined（bin 入口回退当前形态的分段起点）", () => {
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

describe("端口策略", () => {
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

  it("maxAttempts = 1（非 dev）也严格单端口：被占直接报错", async () => {
    const occupiedPort = await occupyPort();
    await expect(
      startServer(makeTmpDir(), { port: occupiedPort, maxAttempts: 1, openBrowser: false }),
    ).rejects.toThrow(/已被占用/);
  });

  it("未指定 port 时默认从 web 分段起点开始（起点与下一端口被占 → 落起点 + 2）", async () => {
    const base = PORT_RANGES.web.base;
    await occupyPort(base);
    await occupyPort(base + 1);
    const handle = await startServer(makeTmpDir(), { openBrowser: false });
    try {
      expect(handle.port).toBe(base + 2);
    } finally {
      await handle.close();
    }
  });
});

// ============ 启动恢复上次书籍（lastProject，2026-09） ============
//
// 语义见 docs/design/build.md §启动流程：创作根自身不是项目时，按 <创作根>/.ai-editor/config.json
// 的 lastProject（POST /project/open 成功时写入）恢复上次那本书；路径失效/坏数据一律静默待命。

describe("启动恢复上次书籍（lastProject）", () => {
  /** 造一本「书架上的书」：books/<书名>/project.json（detectProject 只认这个文件） */
  function seedBook(root: string, name: string): string {
    const dir = join(root, "books", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "project.json"),
      JSON.stringify({
        id: `proj-${name}`,
        name,
        language: "zh",
        schema_version: SCHEMA_VERSION,
        current_position: null,
        created_at: T0,
        updated_at: T0,
      }),
      "utf8",
    );
    return dir;
  }

  function writeLastProject(root: string, value: string): void {
    mkdirSync(join(root, ".ai-editor"), { recursive: true });
    writeFileSync(join(root, ".ai-editor", "config.json"), JSON.stringify({ lastProject: value }), "utf8");
  }

  afterEach(() => {
    const cur = getCurrentProject();
    if (cur !== null) {
      closeProject(cur);
      setCurrentProject(null);
    }
    setProjectRoot(null);
  });

  it("lastProject 指向的书存在 → 启动即打开（config 端点直接可用）", async () => {
    const root = makeTmpDir();
    const book = seedBook(root, "上次那本");
    writeLastProject(root, book);

    const handle = await startServer(root, { port: 0, openBrowser: false });
    try {
      expect(handle.project?.root).toBe(book);
      const res = await handle.app.request("http://127.0.0.1/api/v1/project/config", {
        headers: { host: "127.0.0.1" },
      });
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it("lastProject 指向已删除的目录 → 待命（书架），不阻断启动", async () => {
    const root = makeTmpDir();
    writeLastProject(root, join(root, "books", "已删除"));

    const handle = await startServer(root, { port: 0, openBrowser: false });
    try {
      expect(handle.project).toBeNull();
      const res = await handle.app.request("http://127.0.0.1/api/v1/project/config", {
        headers: { host: "127.0.0.1" },
      });
      expect(res.status).toBe(409); // NO_PROJECT_OPEN：前端回书架引导
    } finally {
      await handle.close();
    }
  });

  it("lastProject 指向的目录 project.json 损坏 → 待命（不抛错、不重建）", async () => {
    const root = makeTmpDir();
    const dir = join(root, "books", "坏书");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.json"), "{ 坏 json", "utf8");
    writeLastProject(root, dir);

    const handle = await startServer(root, { port: 0, openBrowser: false });
    try {
      expect(handle.project).toBeNull();
    } finally {
      await handle.close();
    }
  });

  it("创作根自身有 project.json → 优先于 lastProject（旧部署模式兼容）", async () => {
    const root = makeTmpDir();
    const book = seedBook(root, "书架上的书");
    writeLastProject(root, book);
    writeFileSync(
      join(root, "project.json"),
      JSON.stringify({
        id: "proj-root",
        name: "根项目",
        language: "zh",
        schema_version: SCHEMA_VERSION,
        current_position: null,
        created_at: T0,
        updated_at: T0,
      }),
      "utf8",
    );

    const handle = await startServer(root, { port: 0, openBrowser: false });
    try {
      expect(handle.project?.root).toBe(root);
    } finally {
      await handle.close();
    }
  });
});
