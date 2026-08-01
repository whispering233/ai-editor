// 项目路由（S1.2）：POST /create、POST /open、POST /close、GET/PUT /config
//
// 契约来源：doc/api/endpoints.md 第 18-122 行（项目管理全部端点）、doc/design/decisions.md
//   决策 8（单进程 currentProject）、决策 13 修订（open 时 user_version 判定删库重建）、决策 17（路径校验防越权）。
// 校验失败统一 400 INVALID_PROJECT_PATH（shared ErrorCode，endpoints.md 第 66 行）。
import { isAbsolute, join, resolve } from "node:path";
import { mkdirSync, realpathSync } from "node:fs";
import { Hono } from "hono";
import type { ProjectFileConfig } from "@ai-editor/shared";
import { mapProjectFileToConfig } from "@ai-editor/shared";
import { openDatabase } from "@ai-editor/db";
import { ensureSchemaCompatible, DATA_DB_FILE_NAME } from "@ai-editor/db";
import { findOutlineNode, readOutlineFile, readProjectFile, writeProjectFile } from "@ai-editor/db";
import { nowIso } from "@ai-editor/db";
import {
  projectConfigUpdateReqSchema,
  projectCreateReqSchema,
  projectOpenReqSchema,
} from "@ai-editor/shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import {
  closeProject,
  ensureProject,
  getCurrentProject,
  requireCurrentProject,
  setCurrentProject,
} from "../middleware/project.js";

/**
 * 规范化并校验项目路径（决策 17，create/open 通用）：
 *
 * 1. **必须是绝对路径**：endpoints.md 契约要求绝对路径；path.resolve 对相对输入会基于
 *    process.cwd() 折叠，语义歧义（cwd 变化结果即变），显式拒绝
 * 2. **path.resolve 规范化**：折叠 `..` 与重复分隔符（防 `..` 逃逸——规范化后即为最终操作目录，
 *    不再拼接用户输入）
 * 3. **realpath 一致性校验**：解析后的真实路径（符号链接展开）必须与规范化路径一致，否则拒绝——
 *    校验语义（决策 17「防越权读写任意目录」）：本应用单项目根模型下「允许范围」即规范化后的
 *    路径本身，符号链接会把读写导向意外位置（链接指向任意目录即越权），故链接跳转一律拒绝
 *
 * 调用方约定：create 流程在调用前先 mkdirSync（目录可能尚不存在，realpath 需要目录存在）；
 * open 流程目录不存在时 realpath 抛错 → 同样 400。
 *
 * @param rawPath 用户提供的路径（绝对路径）
 * @returns 规范化后的项目目录绝对路径
 * @throws HttpError 400 INVALID_PROJECT_PATH
 */
export function resolveProjectDir(rawPath: string): string {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new HttpError(400, "INVALID_PROJECT_PATH", "path 不能为空");
  }
  if (!isAbsolute(rawPath)) {
    throw new HttpError(400, "INVALID_PROJECT_PATH", "path 必须是绝对路径");
  }
  const resolved = resolve(rawPath);
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    throw new HttpError(400, "INVALID_PROJECT_PATH", `路径不存在或不可访问: ${resolved}`);
  }
  if (real !== resolved) {
    throw new HttpError(400, "INVALID_PROJECT_PATH", `路径含符号链接跳转，已拒绝: ${resolved}`);
  }
  return resolved;
}

/** 项目路由（挂载于 /api/v1/project，index.ts） */
export const projectRoutes = new Hono();

// POST /api/v1/project/create —— 创建新项目（决策 8 初始化三文件）
projectRoutes.post("/create", async (c) => {
  const raw = await c.req.json().catch(() => null); // 空 body / 非法 JSON → 校验失败
  const parsed = projectCreateReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → app.onError → 400 VALIDATION_ERROR（含 fields）
  }
  const { path: rawPath, config } = parsed.data;

  // 路径校验（决策 17）：绝对路径 + 规范化 + 链接检查；create 允许目录尚不存在——先建目录再校验
  if (!isAbsolute(rawPath)) {
    throw new HttpError(400, "INVALID_PROJECT_PATH", "path 必须是绝对路径");
  }
  const resolved = resolve(rawPath);
  try {
    mkdirSync(resolved, { recursive: true });
  } catch {
    throw new HttpError(400, "INVALID_PROJECT_PATH", `目录创建失败: ${resolved}`);
  }
  const dir = resolveProjectDir(resolved);

  // create 语义：新建项目；目录已是项目（含 project.json）→ 409 拒绝（不幂等复用，与 open 区分）
  if (readProjectFile(dir) !== null) {
    throw new HttpError(409, "PROJECT_ALREADY_EXISTS", `目录已是项目（含 project.json），请用 open 打开: ${dir}`);
  }

  // 初始化三文件（决策 8：project.json + data.db + outline.json，schema_version 同步写入，决策 13）
  // ensureProject 初始化分支已写 user_version=SCHEMA_VERSION（S1.1 审核建议：避免 brand-new 库
  // 在 open 时触发无意义删库重建并留下空库 data.db.v0.bak）
  const project = ensureProject(dir);

  // create 不打开项目（不设 currentProject；open 才打开），创建的 db 连接即刻释放
  const configOverride: Partial<Pick<ProjectFileConfig, "name" | "language" | "prompt">> =
    config ?? {};
  if (configOverride.name !== undefined || configOverride.language !== undefined || configOverride.prompt !== undefined) {
    const next: ProjectFileConfig = {
      ...project.config,
      ...(configOverride.name !== undefined ? { name: configOverride.name } : {}),
      ...(configOverride.language !== undefined ? { language: configOverride.language } : {}),
      ...(configOverride.prompt !== undefined ? { prompt: configOverride.prompt } : {}),
      updated_at: nowIso(),
    };
    writeProjectFile(dir, next);
    project.config = next;
  }
  closeProject(project);

  return c.json(
    ok({
      id: project.config.id,
      path: dir,
      created: true as const,
    }),
  );
});

// POST /api/v1/project/open —— 打开已有项目（schema 版本检测 + 删库重建，决策 13 修订）
projectRoutes.post("/open", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = projectOpenReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const dir = resolveProjectDir(parsed.data.path); // 目录不存在 / 链接跳转 → 400

  // open 必须包含 project.json（endpoints.md 第 65 行）
  const config = readProjectFile(dir);
  if (config === null) {
    throw new HttpError(400, "INVALID_PROJECT_PATH", `目标目录不含 project.json，不是项目: ${dir}`);
  }

  // 打开顺序（oracle 审核建议 1）：**先开新项目成功后再关旧的**——
  // 若先 closeProject(prev) 再开新项目，openDatabase/ensureSchemaCompatible 抛错时
  // currentProject 会悬挂指向连接已关闭的旧项目（后续请求 "connection not open" → 500）。
  // 失败语义：open 失败 = 操作未生效——当前项目保持原样（连接仍有效、单例不变）。
  // schema 版本检测（决策 13 修订 + endpoints.md 第 68-70 行）：data.db user_version 与当前版本
  // 不匹配 → 删库重建（备份 data.db.v{n}.bak + outline.json.v{n}.bak、重置 outline 空树、清空回收站）
  try {
    const dbPath = join(dir, DATA_DB_FILE_NAME);
    const db = openDatabase(dbPath);
    const { db: activeDb, result } = ensureSchemaCompatible(db, dir, dbPath);

    // 新项目就绪，切换单例：释放旧项目连接（重建分支已关闭旧连接，closeProject 幂等；
    // 匹配分支旧连接仍开，此处统一释放）
    const prev = getCurrentProject();
    if (prev !== null && prev.db !== activeDb) {
      closeProject(prev);
    }
    setCurrentProject({ root: dir, config, db: activeDb });

    // 响应：openResSchema 核心字段 + rebuilt 提示（端到端文档「向客户端提示已重建」，endpoints.md 第 69 行；
    // rebuilt/fromVersion 为附加字段——shared 的 projectOpenResSchema 未含（shared 冻结约束），
    // 此处不经 schema parse 直接构造，避免 zod 默认 strip 掉附加字段；建议 2 记录在案，契约修订时收敛）
    return c.json(
      ok({
        id: config.id,
        name: config.name,
        language: config.language,
        config: mapProjectFileToConfig(config),
        ...(result.rebuilt ? { rebuilt: true, fromVersion: result.fromVersion } : {}),
      }),
    );
  } catch (err) {
    // open 失败恢复（oracle 审核建议 1 兜底）：正常情况下当前项目连接未被触碰（见上注释）；
    // 防御性检查——若旧项目连接已被关闭（如未来 ensureSchemaCompatible 失败路径提前关连接），
    // 清空单例，后续业务请求走 requireCurrentProject → 409 NO_PROJECT_OPEN（语义化错误而非 500）
    const prev = getCurrentProject();
    if (prev !== null && !prev.db.open) {
      setCurrentProject(null);
    }
    throw err;
  }
});

// POST /api/v1/project/close —— 关闭当前项目（释放数据库连接）
projectRoutes.post("/close", (c) => {
  const project = getCurrentProject();
  if (project !== null) {
    closeProject(project);
    setCurrentProject(null);
  }
  // 无当前项目时幂等返回 saved:true（close 语义是「确保已关闭」，非报错）
  return c.json(ok({ saved: true as const }));
});

// GET /api/v1/project/config —— 获取当前项目配置
projectRoutes.get("/config", (c) => {
  const project = requireCurrentProject(); // 无当前项目 → 409 NO_PROJECT_OPEN
  // 读内存 config（open 时载入、PUT 同步更新；单进程下与盘一致，data-flow.md 第 46 行）
  return c.json(ok(mapProjectFileToConfig(project.config)));
});

// PUT /api/v1/project/config —— 更新当前项目配置
projectRoutes.put("/config", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const parsed = projectConfigUpdateReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const { name, language, prompt, current_position } = parsed.data;

  // current_position 校验：须指向存在的**非软删**大纲节点（endpoints.md 第 115 行）；
  // 400 + OUTLINE_NODE_NOT_FOUND（参数语义错误用 400，非资源访问 404）
  if (current_position !== undefined && current_position !== null) {
    const tree = readOutlineFile(project.root);
    const node = findOutlineNode(tree, current_position);
    if (node === undefined || node.deleted === true) {
      throw new HttpError(
        400,
        "OUTLINE_NODE_NOT_FOUND",
        `current_position 指向的大纲节点不存在或已软删: ${current_position}`,
      );
    }
  }

  // 合并更新 + 刷新 updated_at（时间 ISO 8601 应用层写入，schema.md 第 16 行），写盘并同步内存
  const next: ProjectFileConfig = {
    ...project.config,
    ...(name !== undefined ? { name } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(current_position !== undefined ? { current_position } : {}),
    updated_at: nowIso(),
  };
  writeProjectFile(project.root, next);
  project.config = next;

  return c.json(ok({ updated: true as const }));
});
