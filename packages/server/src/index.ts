// @ai-editor/server 入口（T6.1 服务骨架）
//
// 职责（doc/design/architecture.md 第 307-336 行「构建与部署」）：
//   - startServer(projectRoot, opts?)：检测/初始化项目（决策 8）→ 装配 Hono（错误中间件 +
//     来源校验 + 项目上下文 + /api/v1/health 探活）→ 端口策略监听（dev 被占报错 / 生产 +1）→
//     可选打开浏览器（127.0.0.1，决策 8：禁 localhost）
//   - SPA 静态托管：client/dist 静态文件 + 非 /api GET fallback 到 index.html（决策 8 单进程架构）
//   - 直接执行（node packages/server/dist/index.js [projectRoot]）时自动启动；业务路由（routes/）
//     留到切片 1 挂载（结构预留：health 旁并列注册即可）
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createAdaptorServer, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { errorHandler, fail, ok } from "./middleware/error.js";
import { settingsRoutes } from "./routes/settings.js";
import {
  closeProject,
  ensureProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
  type ProjectContext,
  type ProjectVariables,
} from "./middleware/project.js";
import { projectRoutes } from "./routes/project.js";

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
  project: ProjectContext;
  /** 关闭服务并释放数据库连接（data-flow.md 第 46 行） */
  close: () => Promise<void>;
}

/** client/dist 默认位置：packages/server/{dist,src} → packages/client/dist（monorepo 布局） */
function defaultClientDist(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../client/dist");
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
 * 1. 检测/初始化项目（project.json 缺失自动创建，含 data.db + outline.json）
 * 2. 装配 Hono：errorHandler → originCheck → projectMiddleware → 路由（health + SPA）
 * 3. 监听端口：dev 被占直接报错；生产被占自动 +1 重试
 * 4. 非 dev 且 openBrowser 默认开启时，打开 http://127.0.0.1:{实际端口}
 */
export async function startServer(projectRoot: string, options: StartServerOptions = {}): Promise<ServerHandle> {
  const dev = options.dev ?? process.env.NODE_ENV === "development";
  const port = options.port ?? DEFAULT_PORT;
  const openBrowser = options.openBrowser ?? !dev;
  const clientDist = options.clientDist ?? defaultClientDist();

  const project = ensureProject(projectRoot);
  setCurrentProject(project); // 初始项目即当前项目（S1.2：create/open 可切换、close 清空）

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
      closeProject(project);
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

// ============ 直接执行入口（生产态：node packages/server/dist/index.js [projectRoot]） ============

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const projectRoot = process.argv[2] ?? process.cwd();
  const dev = process.env.NODE_ENV === "development";
  const handle = await startServer(projectRoot, { dev });
  console.log(`[ai-editor] 服务已启动: http://127.0.0.1:${handle.port}（项目: ${projectRoot}）`);

  const shutdown = () => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
