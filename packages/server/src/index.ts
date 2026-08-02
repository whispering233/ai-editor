#!/usr/bin/env node
// @ai-editor/server 入口（T6.1 服务骨架）
//
// 职责（doc/design/architecture.md 第 307-336 行「构建与部署」）：
//   - startServer(projectRoot, opts?)：检测/初始化项目（决策 8）→ 装配 Hono（错误中间件 +
//     来源校验 + 项目上下文 + /api/v1/health 探活）→ 端口策略监听（dev 被占报错 / 生产 +1）→
//     可选打开浏览器（127.0.0.1，决策 8：禁 localhost）
//   - SPA 静态托管：client/dist 静态文件 + 非 /api GET fallback 到 index.html（决策 8 单进程架构）
//   - 直接执行（node packages/server/dist/index.js [projectRoot]）时自动启动；业务路由（routes/）
//     留到切片 1 挂载（结构预留：health 旁并列注册即可）
//   - bin 入口（打包安装）：package.json "bin": {"ai-editor": "dist/index.js"}——
//     shebang 必须是文件首行（tsc 构建保留），npm 全局/本地安装后生成 ai-editor 命令；
//     argv[2] 为项目根（缺省 cwd），NODE_ENV 非 development 即生产态（端口占用自动 +1）
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createAdaptorServer, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { errorHandler, fail, ok } from "./middleware/error.js";
import { settingsRoutes } from "./routes/settings.js";
import {
  closeProject,
  detectProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
  type ProjectContext,
  type ProjectVariables,
} from "./middleware/project.js";
import { projectRoutes, setProjectRoot } from "./routes/project.js";

/** 默认端口（决策 8 / 17；dev 态 Vite proxy 写死 3456） */
export const DEFAULT_PORT = 3456;

/** 生产态端口 +1 重试上限（决策 8：占用自动 +1） */
const MAX_PORT_ATTEMPTS = 20;

/** 静态文件 MIME（client/dist 产物类型） */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

export interface StartServerOptions {
  /** 监听端口（默认 3456；0 = 系统分配，测试用） */
  port?: number;
  /**
   * dev 态：端口被占直接报错（Vite proxy 写死 3456，自动 +1 会造成 proxy 与实际监听不一致，
   * 决策 17 修订）；默认取 NODE_ENV === "development"
   */
  dev?: boolean;
  /** 启动后打开浏览器（默认非 dev 态开启；测试传 false） */
  openBrowser?: boolean;
  /** client/dist 目录覆盖（默认从 server 包相对位置推导；测试用临时 fixture） */
  clientDist?: string;
}

export interface ServerHandle {
  app: Hono<{ Variables: ProjectVariables }>;
  server: ServerType;
  /** 实际监听端口（port=0 时为系统分配值） */
  port: number;
  /** 启动时检测到的项目（目录含 project.json）；null = 待命（前端引导 create/open） */
  project: ProjectContext | null;
  /** 关闭服务并释放数据库连接（data-flow.md 第 46 行） */
  close: () => Promise<void>;
}

/**
 * client/dist 默认位置（双路径解析）：
 * 1. **monorepo 开发态**：packages/server/{dist,src} → ../../client/dist（Vite 构建产物原位）
 * 2. **打包安装态**（fallback）：node_modules/@ai-editor/server/dist → ../client-dist
 *    （prepack 时由 scripts/copy-client-dist.mjs 复制到包根，随 tarball 携带）
 * 探测优先：源存在即用（开发态 client/dist 已构建时走 1）；都不存在返回 2 的路径，
 * SPA fallback 优雅降级（404 JSON 提示「client/dist 未构建」，不崩溃）。
 */
function defaultClientDist(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  const monoDist = resolve(dir, "../../client/dist");
  if (existsSync(monoDist)) {
    return monoDist;
  }
  return resolve(dir, "../client-dist");
}

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** 安全读取文件：不存在/目录/越权返回 null */
async function readFileSafe(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * 启动服务（决策 8 / 17）：
 * 1. 检测项目（detectProject）：目录含 project.json → 打开并设为当前项目（部署场景「启动即用」）；
 *    无 project.json → 待命（不初始化、不建文件——前端 Dashboard 引导 create/open，S1.4）
 * 2. 装配 Hono：errorHandler → originCheck → projectMiddleware → 路由（health + project + settings + SPA）
 * 3. 监听端口：dev 被占直接报错；生产被占自动 +1 重试
 * 4. 非 dev 且 openBrowser 默认开启时，打开 http://127.0.0.1:{实际端口}
 */
export async function startServer(projectRoot: string, options: StartServerOptions = {}): Promise<ServerHandle> {
  const dev = options.dev ?? process.env.NODE_ENV === "development";
  const port = options.port ?? DEFAULT_PORT;
  const openBrowser = options.openBrowser ?? !dev;
  const clientDist = options.clientDist ?? defaultClientDist();

  // 检测语义（设计缺陷修复）：不再无条件初始化——待命态下 GET /project/config → 409
  // NO_PROJECT_OPEN，前端引导「新建/打开项目」（client store loadConfig 已处理该错误码）
  const project = detectProject(projectRoot);
  if (project !== null) {
    setCurrentProject(project); // 启动即打开（决策 8 部署场景）；null 则保持待命
  }

  // 书架模式（S1.5）：projectRoot = 创作根，GET /api/v1/project/list 扫描 books/ 子目录
  // 需要创作根路径（与 currentProject 无关——待命态也要能列书）；兼容旧语义：
  // 创作根自身有 project.json 仍按 detectProject 打开，list 只列 books/（根自身不是书）
  setProjectRoot(projectRoot);

  const app = new Hono<{ Variables: ProjectVariables }>();

  // 中间件装配顺序：错误兜底 → 来源校验 → 项目上下文注入（从 currentProject 单例读取）
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());

  // 探活路由（本卡基础路由；切片 1 起在下方并列挂载 routes/ 业务路由）
  app.get("/api/v1/health", (c) => c.json(ok({ status: "ok" })));

  // 设置路由（S1.3）：GET/PUT /api/v1/settings/llm（用户级配置，决策 17）
  app.route("/api/v1/settings", settingsRoutes);

  // 项目路由（S1.2）：create/open/close/config（项目管理，决策 8/13/17）
  app.route("/api/v1/project", projectRoutes);

  // 兜底：/api/* → JSON 404；其他 GET/HEAD → 静态文件 → SPA fallback index.html（决策 8）
  app.notFound(async (c) => {
    const path = c.req.path;
    if (path.startsWith("/api/")) {
      return c.json(fail("NOT_FOUND", `未知 API 端点: ${path}`), 404);
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.json(fail("NOT_FOUND", `未知端点: ${path}`), 404);
    }
    // 静态文件（含 client 的 public/ 拷贝）：路径必须解析在 clientDist 内（防目录穿越）
    const clientRoot = resolve(clientDist);
    const candidate = resolve(clientRoot, `.${path}`);
    if (candidate.startsWith(clientRoot + sep)) {
      const data = await readFileSafe(candidate);
      if (data) {
        return new Response(data, { headers: { "Content-Type": contentTypeFor(candidate) } });
      }
    }
    // SPA fallback（决策 8：/* → index.html；client/dist 未构建时优雅降级提示）
    const html = await readFileSafe(join(clientRoot, "index.html"));
    if (!html) {
      return c.json(
        fail("NOT_FOUND", "client/dist 未构建（请先运行 pnpm --filter @ai-editor/client build）"),
        404,
      );
    }
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  });

  // 端口策略：dev 单次尝试（被占报错）；生产 EADDRINUSE 自动 +1（决策 8 / 17 修订）
  const maxPort = dev ? port : port + MAX_PORT_ATTEMPTS - 1;
  let server: ServerType | null = null;
  let actualPort = port;
  for (let p = port; p <= maxPort; p++) {
    try {
      server = await listenOnce(app.fetch, p);
      actualPort = p === 0 ? (server.address() as AddressInfo).port : p;
      break;
    } catch (err) {
      const eaddrinuse = (err as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!eaddrinuse || p === maxPort) {
        if (eaddrinuse) {
          throw new Error(
            `端口 ${port} 已被占用（${dev ? "dev 态不自动 +1，请指定其他端口" : `已尝试至 ${maxPort}`}）`,
          );
        }
        throw err;
      }
      // 生产态：+1 重试
    }
  }
  if (server === null) throw new Error("端口监听失败（不可达）");

  if (openBrowser) {
    await openBrowserUrl(`http://127.0.0.1:${actualPort}`); // 127.0.0.1 而非 localhost（决策 8）
  }

  return {
    app,
    server,
    port: actualPort,
    project,
    close: async () => {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      if (project !== null) {
        closeProject(project); // 待命态（project=null）无连接可释放
      }
    },
  };
}

/** 基于 @hono/node-server 的监听：'listening' 成功 / 'error'（如 EADDRINUSE）失败 */
function listenOnce(fetchHandler: Parameters<typeof createAdaptorServer>[0]["fetch"], port: number): Promise<ServerType> {
  return new Promise((resolveListen, reject) => {
    const server = createAdaptorServer({ fetch: fetchHandler, hostname: "127.0.0.1", port });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveListen(server);
    });
  });
}

/** 打开浏览器（决策 8：xdg-open/open/start，失败静默——无图形环境不阻塞） */
export async function openBrowserUrl(url: string): Promise<void> {
  const platform = process.platform;
  const cmd = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    await new Promise<void>((resolveOpen, reject) => {
      execFile(cmd, args, (err) => (err ? reject(err) : resolveOpen()));
    });
  } catch {
    // 打开失败静默（无图形环境等）
  }
}

// ============ 直接执行入口（bin/生产态：ai-editor [projectRoot]） ============
//
// isDirectRun 判定（打包安装实测修复）：npm 安装 bin 后 node_modules/.bin/ai-editor 是指向
// dist/index.js 的**符号链接**——经 bin 执行时 process.argv[1] 是 symlink 路径而非真实文件路径，
// 直接与 import.meta.url 比较会误判为「非直接执行」导致进程静默退出（无输出、exit 0）。
// 因此两侧都经 realpathSync 归一化后再比较。
const isDirectRun =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const projectRoot = process.argv[2] ?? process.cwd();
  const dev = process.env.NODE_ENV === "development";
  // AI_EDITOR_PORT 环境变量可覆盖默认端口（决策 8 端口策略；测试/多实例场景用，
  // 如打包安装冒烟与 dev server 并存时指定独立端口）
  const port = process.env.AI_EDITOR_PORT ? Number(process.env.AI_EDITOR_PORT) : undefined;
  const handle = await startServer(projectRoot, { dev, ...(port !== undefined ? { port } : {}) });
  console.log(
    handle.project === null
      ? `[ai-editor] 服务已启动: http://127.0.0.1:${handle.port}（未打开项目，等待创建或打开: ${projectRoot}）`
      : `[ai-editor] 服务已启动: http://127.0.0.1:${handle.port}（已打开项目: ${handle.project.root}）`,
  );

  const shutdown = () => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
