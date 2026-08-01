// 项目上下文中间件（T6.1）
//
// 职责（doc/design/architecture.md 第 121-122 行 middleware/project.ts「项目路径注入」）：
//   1. ensureProject：检测 project.json，不存在则按决策 8 自动初始化
//      （project.json + data.db + outline.json，三文件带 schema_version，衔接决策 13）
//   2. 来源校验（决策 17 修订）：全部请求校验 Origin（缺失时退化为 Host）的 host
//      ∈ {127.0.0.1, localhost, ::1}，不匹配拒绝 403；**不校验端口**
//      （端口 +1 可变；dev 态 Vite proxy 转发后端口为 5173，校验端口会误杀开发请求）
//   3. 项目上下文挂到 Hono 上下文（c.set("project", ...)），关闭时释放 db 连接（data-flow.md 第 46 行）
import { basename, join } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import type { ProjectFileConfig } from "@ai-editor/shared";
import { generateProjectId } from "@ai-editor/shared";
import { closeDatabase, openDatabase, type Db } from "@ai-editor/db";
import { readProjectFile, writeProjectFile } from "@ai-editor/db";
import { writeOutlineFile } from "@ai-editor/db";
import { SCHEMA_VERSION } from "@ai-editor/db";
import { nowIso } from "@ai-editor/db";
import { fail } from "./error.js";

/** data.db 文件名（决策 8：项目根目录） */
export const DATA_DB_FILE_NAME = "data.db";

/** 来源白名单 host（决策 17：仅允许本机访问；IPv6 ::1 去括号后比对） */
const ALLOWED_HOSTS = ["127.0.0.1", "localhost", "::1"];

/** 项目上下文：内存中单一 currentProject（data-flow.md 第 46 行，所有 API 共享） */
export interface ProjectContext {
  root: string;
  config: ProjectFileConfig;
  db: Db;
}

/** Hono 上下文变量声明（routes 里 c.get("project") 获得类型） */
export interface ProjectVariables {
  project: ProjectContext;
}

/** 从 Hono 上下文取项目上下文（路由内使用） */
export function getProject(c: Context<{ Variables: ProjectVariables }>): ProjectContext {
  return c.get("project");
}

/**
 * 检测 + 初始化项目（决策 8 启动流程 ④）：
 * project.json 存在 → 直接加载；不存在 → 自动创建 project.json + data.db + outline.json。
 * project.json 损坏（JSON 解析失败）→ 抛错（readProjectFile 语义：不静默重建，防数据误伤）。
 */
export function ensureProject(root: string): ProjectContext {
  const existing = readProjectFile(root);
  if (existing) {
    return { root, config: existing, db: openDatabase(join(root, DATA_DB_FILE_NAME)) };
  }
  // 首次初始化：三个数据文件都带 schema_version（决策 8 / 决策 13）
  const now = nowIso();
  const config: ProjectFileConfig = {
    id: generateProjectId(), // proj- 前缀（endpoints.md id 约定）
    name: basename(root),
    language: "zh",
    prompt: "",
    schema_version: SCHEMA_VERSION,
    current_position: null,
    created_at: now,
    updated_at: now,
  };
  writeProjectFile(root, config);
  writeOutlineFile(root, { id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] });
  const db = openDatabase(join(root, DATA_DB_FILE_NAME)); // 文件不存在则创建 + 自动建表
  return { root, config, db };
}

/** 关闭项目：释放数据库连接（data-flow.md 第 46 行；WAL + synchronous=FULL 已即时落盘） */
export function closeProject(project: ProjectContext): void {
  closeDatabase(project.db);
}

/** 从 Origin / Host 头提取 hostname（端口剥离；IPv6 去括号） */
function extractHostname(value: string): string {
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    return url.hostname.replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

/**
 * 来源校验中间件（决策 17 修订）：
 * Origin 头存在 → 校验其 host；Origin 缺失（地址栏直接导航）→ 退化为校验 Host 头 host。
 * 两者皆拒 → 403（防 CSRF / DNS rebinding；DNS rebinding 下读操作同样是敏感操作）。
 */
export function originCheckMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("origin");
    const value = origin ?? c.req.header("host") ?? "";
    if (!ALLOWED_HOSTS.includes(extractHostname(value))) {
      return c.json(fail("FORBIDDEN", "来源校验失败：仅允许本机（127.0.0.1/localhost/::1）访问"), 403);
    }
    await next();
  };
}

/** 项目上下文注入中间件：c.set("project", context)，路由经 getProject 读取 */
export function projectMiddleware(project: ProjectContext): MiddlewareHandler {
  return async (c, next) => {
    c.set("project", project);
    await next();
  };
}
