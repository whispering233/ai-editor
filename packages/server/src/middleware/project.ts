// 项目上下文中间件（T6.1 + S1.2）
//
// 职责（第 121-122 行 middleware/project.ts「项目路径注入」）：
// 1. detectProject：检测 project.json——存在则打开（部署场景「启动即用」）；不存在返回
// null 待命（不初始化、不建文件，由前端 Dashboard 引导 create/open；S1.4 开/建页依赖）
// openProjectDatabase：data.db 打开 + schema 版本对齐的**唯一管道**（开机路径与
// POST /project/open 共用，卡 2.8——开机直达不再跳过迁移）
// initProject：显式初始化三文件（S1.2 create 路由专用，含建目录 + user_version）
// 2. currentProject 内存单例（S1.2）：create/open 切换、close 清空，
// 模块级可变状态由路由（routes/project.ts）读写，projectMiddleware 从状态注入 Hono 上下文
// 3. 来源校验：全部请求校验 Origin（缺失时退化为 Host）的 host
// ∈ {127.0.0.1, localhost, ::1}，不匹配拒绝 403；**不校验端口**
// （端口 +1 可变；dev 态 Vite proxy 转发后端口为 5173，校验端口会误杀开发请求）
import { basename, join } from "node:path";
import { mkdirSync } from "node:fs";
import type { Context, MiddlewareHandler } from "hono";
import type { ProjectFileConfig } from "@whispering233/ai-editor-shared";
import { generateProjectId, DEFAULT_BACKUP_FREQUENCY_MINUTES } from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, setUserVersion, type Db } from "@whispering233/ai-editor-db";
import { ensureSchemaCompatible, SchemaVersionError, type MigrationResult } from "@whispering233/ai-editor-db";
import { readProjectFile, writeProjectFile } from "@whispering233/ai-editor-db";
import { writeOutlineFile } from "@whispering233/ai-editor-db";
import { SCHEMA_VERSION } from "@whispering233/ai-editor-db";
import { nowIso } from "@whispering233/ai-editor-db";
import { HttpError, fail, type ApiErrorCode } from "./error.js";
import { migratePromptToAgents, startAutoBackup, stopAutoBackup } from "../backup.js";
import { disposeProjectRuntime } from "../chat-runtime.js";

/** data.db 文件名（项目根目录） */
export const DATA_DB_FILE_NAME = "data.db";

/** 来源白名单 host（仅允许本机访问；IPv6 ::1 去括号后比对） */
const ALLOWED_HOSTS = ["127.0.0.1", "localhost", "::1"];

/** 项目上下文：内存中单一 currentProject（所有 API 共享） */
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
// 语义：单进程内存中只有一个 currentProject，所有 API 调用共享；
// create/open 切换它、close 清空它。多项目并发打开不在 MVP 范围（backlog）。
// 模块级可变状态 + 显式读写函数：路由层可读可写，中间件只读注入。

/** 当前打开的项目（null = 无） */
let currentProject: ProjectContext | null = null;

/**
 * 设置当前项目（create/open 成功后调用；传 null 清空——close 时）。
 * B2.2：自动备份定时器跟随当前项目生命周期——设置非空 → 启动调度
 * （open/切换/启动即打开），清空 → 停止（close）。频率变化（restore 等）由
 * 调度器 tick 内重读 config 自行跟随。
 */
export function setCurrentProject(project: ProjectContext | null): void {
  // 旧项目的对话运行时在此释放：中止在途流 → dispose 会话订阅 → 清空提案仓
  //（单点覆盖 create/open/close/restore 全部切换路径，见 chat-runtime.ts）
  disposeProjectRuntime();
  currentProject = project;
  if (project !== null) {
    startAutoBackup(project);
  } else {
    stopAutoBackup();
  }
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
 * data.db 打开 + schema 版本对齐的**唯一管道**（卡 2.8 收敛）：
 * 开机路径（detectProject）与显式 `POST /project/open` 共用，避免两条路径语义漂移。
 *
 * 语义（`docs/db/schema.md`「schema 版本与迁移」三态分流）：
 * - `user_version === SCHEMA_VERSION` → 原连接返回（rebuilt=false）；
 * - 旧版本**有迁移路径** → 前向迁移（迁移前自动快照 `data.db.v{n}.{时间戳}.bak`）；
 * - 旧版本**无迁移路径** → 删库重建兜底（备份 `data.db.v{n}.bak` + outline 重置）；
 * - **未来版本** → 关闭连接并抛 `SchemaVersionError`（调用方决定策略：
 *   路由映射 409 `PROJECT_VERSION_NEWER`；开机态回待命）。
 *
 * @returns 已对齐版本的活动连接 + 迁移/重建结果（路由用于响应提示）
 * @throws SchemaVersionError 未来版本拒绝打开；迁移/重建过程的 I/O 错误
 */
export function openProjectDatabase(dir: string): { db: Db; result: MigrationResult } {
  const dbPath = join(dir, DATA_DB_FILE_NAME);
  const db = openDatabase(dbPath);
  try {
    const out = ensureSchemaCompatible(db, dir, dbPath);
    return { db: out.db, result: out.result };
  } catch (err) {
 // 幂等：拒绝/迁移失败分支内已关连接（db 包保证无句柄泄漏），此处仅防御
    closeDatabase(db);
    throw err;
  }
}

/**
 * 检测并打开项目（启动流程 ④ 修订——设计缺陷修复）：
 * project.json 存在 → 走 `openProjectDatabase`（版本检测 + 迁移/重建，与 open 路由同管道），
 * 返回项目上下文（打开语义，部署场景「启动即用」）；
 * project.json 不存在 → **返回 null（待命）**——不初始化、不建任何文件（含目录），
 * 由前端 Dashboard 引导走 POST /project/create 或 /project/open（S1.4 开/建页；
 * 此前无条件初始化导致引导永不显示、dev 态污染 packages/server 包目录）。
 * project.json 损坏（JSON 解析失败）→ 抛错（readProjectFile 语义：不静默重建，防数据误伤）。
 *
 * **版本对齐（卡 2.8）**：旧库有迁移路径 → 前向迁移（含迁移前快照）；无路径 → 删库重建兜底；
 * **未来版本库**（`SchemaVersionError`）→ 拒绝打开、**零写操作**，本函数记日志并回待命
 *（用户点开这本书时 open 路由仍返回 409 `PROJECT_VERSION_NEWER`）；打开/迁移的其他错误
 * 同理回待命并记日志（下次 open/重启重试）——与 `detectLastProject` 的「不阻断启动」
 * 语义一致，数据原封不动。
 */
export function detectProject(root: string): ProjectContext | null {
  const existing = readProjectFile(root);
  if (existing === null) {
    return null;
  }
  let db: Db;
  try {
    ({ db } = openProjectDatabase(root));
  } catch (err) {
    logStartupOpenFailure(root, err);
    return null;
  }
  const project: ProjectContext = { root, config: existing, db };
 // 自动迁移：project.json 有非空 prompt 且无 AGENTS.md → 迁移写入（原样，一次性）
 //（实现位于 backup.ts——backup 模块不依赖 middleware，middleware 侧经 ../backup.js 复用）
  migratePromptToAgents(project);
  return project;
}

/** 启动路径打开失败的日志（不阻断启动；未来版本另给明确文案） */
function logStartupOpenFailure(root: string, err: unknown): void {
  if (err instanceof SchemaVersionError) {
    console.error(`[server] 启动自动打开被拒绝（data.db 版本高于程序版本，已回待命）: ${root} — ${err.message}`);
    return;
  }
  console.error(`[server] 启动自动打开失败（已回待命，下次 open/重启重试）: ${root}`, err);
}

/**
 * 显式初始化新项目（S1.2 create 路由专用，「首次初始化三文件」语义）：
 * 建目录（mkdir recursive，含嵌套不存在的父目录）→ 写 project.json（id=proj- 前缀 nanoid、
 * name 默认取目录名、language 默认 zh、schema_version=SCHEMA_VERSION，created_at/updated_at
 * 应用层写当前 ISO 时间）→ 写 outline.json 最小空树 → openDatabase 建 data.db（自动建表）
 * → setUserVersion(SCHEMA_VERSION)（S1.1 审核建议：brand-new 库立即写版本号，
 * 避免后续 open 时 ensureSchemaCompatible 触发无意义重建并留空库 data.db.v0.bak）。
 * 注：`prompt` 已废弃——新项目不再写入该字段（项目规则改由 承载）。
 *
 * @param configOverride 可选覆盖 {name?, language?}（create 请求的 config 字段）；
 * 传入时 updated_at 一并刷新
 * @returns 已打开的项目上下文（调用方负责 closeProject；create 路由创建后即关闭）
 */
export function initProject(
  root: string,
  configOverride?: Partial<Pick<ProjectFileConfig, "name" | "language">>,
): ProjectContext {
  mkdirSync(root, { recursive: true });
  const now = nowIso();
  const config: ProjectFileConfig = {
    id: generateProjectId(), // proj- 前缀（id 约定）
    name: basename(root),
    language: "zh",
    schema_version: SCHEMA_VERSION,
    current_position: null,
 // 新项目默认开启自动备份（显式写入缺省 10，跟随书籍）
    backup_frequency_minutes: DEFAULT_BACKUP_FREQUENCY_MINUTES,
    created_at: now,
    updated_at: now,
    ...configOverride, // 覆盖参数（若有）；updated_at 已含当前时间
  };
  writeProjectFile(root, config);
  writeOutlineFile(root, { id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] });
  const db = openDatabase(join(root, DATA_DB_FILE_NAME)); // 文件不存在则创建 + 自动建表
  setUserVersion(db, SCHEMA_VERSION); // 与 project.json/outline.json 的 schema_version 同步
  return { root, config, db };
}

/** 关闭项目：释放数据库连接（WAL + synchronous=FULL 已即时落盘） */
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
 * 来源校验中间件：
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
