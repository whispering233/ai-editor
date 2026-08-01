// 项目上下文中间件（T6.1 + S1.2）
//
// 职责（doc/design/architecture.md 第 121-122 行 middleware/project.ts「项目路径注入」）：
//   1. detectProject：检测 project.json——存在则打开（部署场景「启动即用」）；不存在返回
//      null 待命（不初始化、不建文件，由前端 Dashboard 引导 create/open；S1.4 开/建页依赖）
//      initProject：显式初始化三文件（S1.2 create 路由专用，含建目录 + user_version）
//   2. currentProject 内存单例（S1.2，data-flow.md 第 46 行）：create/open 切换、close 清空，
//      模块级可变状态由路由（routes/project.ts）读写，projectMiddleware 从状态注入 Hono 上下文
//   3. 来源校验（决策 17 修订）：全部请求校验 Origin（缺失时退化为 Host）的 host
//      ∈ {127.0.0.1, localhost, ::1}，不匹配拒绝 403；**不校验端口**
//      （端口 +1 可变；dev 态 Vite proxy 转发后端口为 5173，校验端口会误杀开发请求）
import { basename, join } from "node:path";
import { mkdirSync } from "node:fs";
import type { Context, MiddlewareHandler } from "hono";
import type { ProjectFileConfig } from "@ai-editor/shared";
import { generateProjectId } from "@ai-editor/shared";
import { closeDatabase, openDatabase, setUserVersion, type Db } from "@ai-editor/db";
import { readProjectFile, writeProjectFile } from "@ai-editor/db";
import { writeOutlineFile } from "@ai-editor/db";
import { SCHEMA_VERSION } from "@ai-editor/db";
import { nowIso } from "@ai-editor/db";
import { HttpError, fail, type ApiErrorCode } from "./error.js";

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

// ============ currentProject 内存单例（S1.2） ============
//
// 语义（data-flow.md 第 46 行）：单进程内存中只有一个 currentProject，所有 API 调用共享；
// create/open 切换它、close 清空它。多项目并发打开不在 MVP 范围（backlog）。
// 模块级可变状态 + 显式读写函数：路由层可读可写，中间件只读注入。

/** 当前打开的项目（null = 无） */
let currentProject: ProjectContext | null = null;

/** 设置当前项目（create/open 成功后调用；传 null 清空——close 时） */
export function setCurrentProject(project: ProjectContext | null): void {
  currentProject = project;
}

/** 读取当前项目（可能为 null） */
export function getCurrentProject(): ProjectContext | null {
  return currentProject;
}

/**
 * 路由内取当前项目；无已打开项目 → 409 NO_PROJECT_OPEN。
 * （错误码为服务端补充码，不在 shared ErrorCode——记录待收敛，见 error.ts 注释）
 */
export function requireCurrentProject(): ProjectContext {
  if (currentProject === null) {
    throw new HttpError(409, "NO_PROJECT_OPEN" as ApiErrorCode, "当前无已打开的项目，请先 POST /api/v1/project/open");
  }
  return currentProject;
}

/**
 * 检测并打开项目（决策 8 启动流程 ④ 修订——设计缺陷修复）：
 * project.json 存在 → openDatabase 打开，返回项目上下文（打开语义，部署场景「启动即用」）；
 * project.json 不存在 → **返回 null（待命）**——不初始化、不建任何文件（含目录），
 * 由前端 Dashboard 引导走 POST /project/create 或 /project/open（S1.4 开/建页；
 * 此前无条件初始化导致引导永不显示、dev 态污染 packages/server 包目录）。
 * project.json 损坏（JSON 解析失败）→ 抛错（readProjectFile 语义：不静默重建，防数据误伤）。
 * 打开时不写 user_version——版本检测交给 open 路由的 ensureSchemaCompatible（S1.1）；
 * 显式初始化（create 路由）用 initProject（内部写 user_version=SCHEMA_VERSION）。
 */
export function detectProject(root: string): ProjectContext | null {
  const existing = readProjectFile(root);
  if (existing === null) {
    return null;
  }
  return { root, config: existing, db: openDatabase(join(root, DATA_DB_FILE_NAME)) };
}

/**
 * 显式初始化新项目（S1.2 create 路由专用，决策 8「首次初始化三文件」语义）：
 * 建目录（mkdir recursive，含嵌套不存在的父目录）→ 写 project.json（id=proj- 前缀 nanoid、
 * name 默认取目录名、language 默认 zh、schema_version=SCHEMA_VERSION，created_at/updated_at
 * 应用层写当前 ISO 时间）→ 写 outline.json 最小空树 → openDatabase 建 data.db（自动建表）
 * → setUserVersion(SCHEMA_VERSION)（S1.1 审核建议：brand-new 库立即写版本号，
 * 避免后续 open 时 ensureSchemaCompatible 触发无意义重建并留空库 data.db.v0.bak）。
 *
 * @param configOverride 可选覆盖 {name?, language?, prompt?}（create 请求的 config 字段）；
 *   传入时 updated_at 一并刷新
 * @returns 已打开的项目上下文（调用方负责 closeProject；create 路由创建后即关闭）
 */
export function initProject(
  root: string,
  configOverride?: Partial<Pick<ProjectFileConfig, "name" | "language" | "prompt">>,
): ProjectContext {
  mkdirSync(root, { recursive: true });
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
    ...configOverride, // 覆盖参数（若有）；updated_at 已含当前时间
  };
  writeProjectFile(root, config);
  writeOutlineFile(root, { id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] });
  const db = openDatabase(join(root, DATA_DB_FILE_NAME)); // 文件不存在则创建 + 自动建表
  setUserVersion(db, SCHEMA_VERSION); // 与 project.json/outline.json 的 schema_version 同步（决策 13）
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

/**
 * 项目上下文注入中间件：从 currentProject 单例读取并 c.set("project", ...)，
 * 路由经 getProject / requireCurrentProject 读取。create/open 切换单例后新请求自动生效；
 * 无当前项目时 c.set 不执行（业务路由由 requireCurrentProject 兜底 409）。
 */
export function projectMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const project = getCurrentProject();
    if (project !== null) {
      c.set("project", project);
    }
    await next();
  };
}
