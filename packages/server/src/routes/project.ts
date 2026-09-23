// 项目路由（S1.2）：POST /create、POST /open、POST /close、GET/PUT /config、GET /export、
// POST /import、GET /backups + POST /backup + POST /backup/rename + POST /backup/restore
// （B2.2 + B2.6）
//
// 校验失败统一 400 INVALID_PROJECT_PATH（shared ErrorCode）。
// 备份管道/校验/恢复/重命名逻辑在 backup.ts（B2.2 提取：createBackupZip/validateBackupPackage/
// writeBackup/listBackups/restoreBackup/renameBackup——与自动定时器同模块）。
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  type Dirent,
} from "node:fs";
import { Hono, type Context } from "hono";
import type { ProjectFileConfig, ProjectListBook } from "@whispering233/ai-editor-shared";
import { mapProjectFileToConfig, orderVisibleChapters } from "@whispering233/ai-editor-shared";
import { SchemaVersionError, type MigrationResult, type Db } from "@whispering233/ai-editor-db";
import { closeDatabase, openDatabase } from "@whispering233/ai-editor-db";
import { OUTLINE_FILE_NAME } from "@whispering233/ai-editor-db";
import { PROJECT_FILE_NAME } from "@whispering233/ai-editor-db";
import { DATA_DB_FILE_NAME } from "@whispering233/ai-editor-db";
import {
  agentsFileMtimeIso,
  findOutlineNode,
  readAgentsFile,
  readOutlineFile,
  readProjectFile,
  writeAgentsFile,
  writeProjectFile,
} from "@whispering233/ai-editor-db";
import { nowIso } from "@whispering233/ai-editor-db";
import {
  projectAgentsGetResSchema,
  projectAgentsPutReqSchema,
  projectAgentsPutResSchema,
  projectBackupRenameReqSchema,
  projectBackupReqSchema,
  projectConfigUpdateReqSchema,
  projectCreateReqSchema,
  projectDeleteReqSchema,
  projectListResSchema,
  projectOpenReqSchema,
} from "@whispering233/ai-editor-shared/schemas";
import { createBackupZip, listBackups, migratePromptToAgents, overwriteProjectFiles, renameBackup, restoreBackup, snapshotBookDir, validateBackupPackage, writeBackup, writeProjectFilesFromBackup } from "../backup.js";
import { HttpError, ok } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  openProjectDatabase,
  requireCurrentProject,
  setCurrentProject,
  type ProjectContext,
} from "../middleware/project.js";
import { autoPushAfterManualBackup, autoPushOnClose } from "../cloud/auto-push.js";
import { deleteBookState, readBookState, readWebdavConfig } from "../cloud/state.js";
import { pushBackup, renameCloudDir } from "../cloud/sync.js";
import { createWebdavClient } from "../cloud/webdav.js";
import { logSoftDeleteReconcile, reconcileSoftDelete } from "../consistency.js";
import { clearLastProject, writeLastProject } from "../last-project.js";

// ============ 创作根（书架模式 S1.5） ============
//
// 语义：启动目录 = 创作根（书架），每本书 = 创作根/books/<书名>/（含 project.json 等三文件）。
// 创作根是 server 启动参数（index.ts startServer 的 projectRoot），与 currentProject（运行态）
// 不同维度——list 端点**不依赖 currentProject**（书架模式待命时无当前项目也要能列书），
// 因此以模块级状态持有，startServer 挂载路由前经 setProjectRoot 注入。

/** 创作根绝对路径（startServer 注入；null = 未初始化，list 端点防御性 500） */
let projectRoot: string | null = null;

/** 设置创作根（index.ts startServer 调用；测试隔离用传 null 重置） */
export function setProjectRoot(root: string | null): void {
  projectRoot = root;
}

/** 读创作根（书架模式：创作根 / `books/<书名>/`；未初始化 → null） */
export function getProjectRoot(): string | null {
  return projectRoot;
}

/** books/ 子目录名（书架模式：创作根/books/<书名>/） */
export const BOOKS_DIR_NAME = "books";

/**
 * 规范化并校验项目路径（create/open 通用）：
 *
 * 1. **必须是绝对路径**：要求绝对路径；path.resolve 对相对输入会基于
 * process.cwd 折叠，语义歧义（cwd 变化结果即变），显式拒绝
 * 2. **path.resolve 规范化**：折叠 `..` 与重复分隔符（防 `..` 逃逸——规范化后即为最终操作目录，
 * 不再拼接用户输入）
 * 3. **realpath 一致性校验**：解析后的真实路径（符号链接展开）必须与规范化路径一致，否则拒绝——
 * 校验语义（「防越权读写任意目录」）：本应用单项目根模型下「允许范围」即规范化后的
 * 路径本身，符号链接会把读写导向意外位置（链接指向任意目录即越权），故链接跳转一律拒绝
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

// POST /api/v1/project/create —— 创建新项目（初始化三文件）
projectRoutes.post("/create", async (c) => {
  const raw = await c.req.json().catch(() => null); // 空 body / 非法 JSON → 校验失败
  const parsed = projectCreateReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → app.onError → 400 VALIDATION_ERROR（含 fields）
  }
  const { path: rawPath, config } = parsed.data;

 // 路径校验：绝对路径 + 规范化 + 链接检查；create 允许目录尚不存在——先建目录再校验
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

 // 初始化三文件（project.json + data.db + outline.json，schema_version 同步写入）
 // initProject 内置：建目录（幂等）+ 三文件 + config 覆盖参数 + user_version=SCHEMA_VERSION
 // （S1.1 审核建议：避免 brand-new 库在 open 时触发无意义删库重建并留下空库 data.db.v0.bak）
  const project = initProject(dir, config);

 // create 不打开项目（不设 currentProject；open 才打开），创建的 db 连接即刻释放
  closeProject(project);

  return c.json(
    ok({
      id: project.config.id,
      path: dir,
      created: true as const,
    }),
  );
});

// POST /api/v1/project/open —— 打开已有项目（schema 版本检测 + 删库重建）
projectRoutes.post("/open", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = projectOpenReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const dir = resolveProjectDir(parsed.data.path); // 目录不存在 / 链接跳转 → 400

 // open 必须包含 project.json
  const config = readProjectFile(dir);
  if (config === null) {
    throw new HttpError(400, "INVALID_PROJECT_PATH", `目标目录不含 project.json，不是项目: ${dir}`);
  }

 // 打开顺序（oracle 审核建议 1）：**先开新项目成功后再关旧的**——
 // 若先 closeProject(prev) 再开新项目，openProjectDatabase 抛错时
 // currentProject 会悬挂指向连接已关闭的旧项目（后续请求 "connection not open" → 500）。
 // 失败语义：open 失败 = 操作未生效——当前项目保持原样（连接仍有效、单例不变）。
 // schema 版本检测：data.db user_version——
 // 旧版本（< 当前）→ 删库重建（备份 data.db.v{n}.bak + outline.json.v{n}.bak、重置
 // outline 空树、清空回收站）；**未来版本（> 当前）→ 拒绝打开 409
 // PROJECT_VERSION_NEWER**（提示升级程序；不触发任何重建/备份，数据原封不动——
 // 堵降级路径数据丢失）。SchemaVersionError 由 db 包
 // 抛出前已关闭本次打开的连接（无句柄泄漏）。
  try {
 // 打开管道（卡 2.8）：与开机路径 detectProject 共用 `openProjectDatabase`——
 // 版本对齐（迁移/重建/迁移前快照）与未来版本拒绝只有一处实现
    let activeDb: Db;
    let result: MigrationResult;
    try {
      ({ db: activeDb, result } = openProjectDatabase(dir));
    } catch (err) {
 // 未来版本拒绝（SchemaVersionError → 409 PROJECT_VERSION_NEWER，message 透传
 // 「请升级程序后打开」；连接已由 openProjectDatabase 关闭，此处仅做错误码映射）
      if (err instanceof SchemaVersionError) {
        throw new HttpError(409, "PROJECT_VERSION_NEWER", err.message);
      }
      throw err;
    }

 // 新项目就绪，切换单例：释放旧项目连接（重建分支已关闭旧连接，closeProject 幂等；
 // 匹配分支旧连接仍开，此处统一释放）
    const prev = getCurrentProject();
    if (prev !== null && prev.db !== activeDb) {
      closeProject(prev);
    }
    const project: ProjectContext = { root: dir, config, db: activeDb };
    setCurrentProject(project);
 // 记住本次打开（创作根 .ai-editor/config.json 的 lastProject）：下次启动自动打开这本书
 //（服务端启动恢复，见 index.ts startServer；写入失败静默——偏好丢失不影响 open）
    if (projectRoot !== null) {
      writeLastProject(projectRoot, dir);
    }
 // 自动迁移：project.json 有非空 prompt 且无 → 迁移写入（原样，一次性；
 // 失败不阻塞打开，记录日志下次 open 重试——「迁移在 open 流程内完成」）
    migratePromptToAgents(project);
 // S4.2 启动一致性校验：打开项目即以大纲节点软删为准补标 DB 关联记录
 //（先 DB 后 JSON 崩溃窗口的幽灵形态兜底，幂等；无软删节点不输出日志）
    logSoftDeleteReconcile(reconcileSoftDelete(project));

 // 响应：openResSchema 核心字段 + rebuilt 提示（端到端文档「向客户端提示已重建」；
 // rebuilt/fromVersion 为附加字段——shared 的 projectOpenResSchema 未含（shared 冻结约束），
 // 此处不经 schema parse 直接构造，避免 zod 默认 strip 掉附加字段；建议 2 记录在案，修订时收敛）
 // 有迁移路径的旧版本经前向迁移打开时附加 migrated:true（提示客户端已自动升级数据）
    return c.json(
      ok({
        id: config.id,
        name: config.name,
        language: config.language,
        config: mapProjectFileToConfig(config),
        ...(result.rebuilt ? { rebuilt: true, fromVersion: result.fromVersion } : {}),
        ...(result.migrated ? { migrated: true, fromVersion: result.fromVersion } : {}),
      }),
    );
  } catch (err) {
 // open 失败恢复（oracle 审核建议 1 兜底）：正常情况下当前项目连接未被触碰（见上注释）；
 // 防御性检查——若旧项目连接已被关闭（如未来 openProjectDatabase 失败路径提前关连接），
 // 清空单例，后续业务请求走 requireCurrentProject → 409 NO_PROJECT_OPEN（语义化错误而非 500）
    const prev = getCurrentProject();
    if (prev !== null && !prev.db.open) {
      setCurrentProject(null);
    }
    throw err;
  }
});

// GET /api/v1/project/list —— 书架列表（S1.5）：扫描创作根 books/ 下含 project.json 的书
projectRoutes.get("/list", (c) => {
  if (projectRoot === null) {
    throw new HttpError(500, "INTERNAL_ERROR", "创作根未初始化（startServer 未调用 setProjectRoot）");
  }
  const booksDir = join(projectRoot, BOOKS_DIR_NAME);
 // books/ 不存在 → 空书架（不报错——新创作根首次启动的正常状态）
  let entries: Dirent[];
  try {
    entries = readdirSync(booksDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return listResponse(c, { rootPath: projectRoot, books: [] });
    }
    throw err;
  }
 // 过滤：仅目录 + 含 project.json（readProjectFile 探测——损坏的 project.json 抛错向上传播，
 // 与 open 语义一致：坏数据不静默吞）
  const books = entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, dir: join(booksDir, e.name) }))
    .map((b) => {
      const config = readProjectFile(b.dir);
      return config === null
        ? null
        : {
            id: config.id,
            name: b.name,
            path: b.dir,
            updatedAt: config.updated_at,
          };
    })
    .filter((b): b is ProjectListBook => b !== null)
 // 倒序：最近更新在前（ISO 8601 字符串字典序 = 时间序）
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return listResponse(c, { rootPath: projectRoot, books });
});

/**
 * list 响应统一出口：经 projectListResSchema 自检后返回（oracle 审核建议 1——
 * 「类型对应 types/api.ts 的 Zod schema」）。
 *
 * **ZodError 处理取舍**：errorHandler 对 ZodError 统一转 400 VALIDATION_ERROR（路由入参校验语义）；
 * 但此处 parse 的是**服务端自检**（构造的响应是否符合）——失败是服务端 bug 而非客户端
 * 参数错误，直接让 ZodError 冒泡会误报 400。故 catch 后重新抛 HttpError(500, INTERNAL_ERROR)，
 * 保持「入参 ZodError → 400、服务端自检 ZodError → 500」的语义边界。
 */
function listResponse(c: Context, result: { rootPath: string; books: ProjectListBook[] }) {
  try {
    return c.json(ok(projectListResSchema.parse(result)));
  } catch (err) {
    throw new HttpError(
      500,
      "INTERNAL_ERROR",
      `list 响应不符合${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// POST /api/v1/project/close —— 关闭当前项目（释放数据库连接）
projectRoutes.post("/close", (c) => {
  const project = getCurrentProject();
  if (project !== null) {
 // 自动推送（卡 7）：「工作段结束」语义——变更判定 = 三文件（`sessions/` 不参与），不受 2h 节流。
 // **fire-and-forget**（不 await）：网络差时一次 push 可能数秒，不能拖住关闭；失败只记
 // lastAutoPushError + 日志（响应语义与无云盘时完全一致）。推送只读 .backups/ 与 cloud.json，
 // 不碰 data.db 连接，故先启动再关连接安全
    void autoPushOnClose(project);
    closeProject(project);
    setCurrentProject(null);
  }
 // 无当前项目时幂等返回 saved:true（close 语义是「确保已关闭」，非报错）
  return c.json(ok({ saved: true as const }));
});

// GET /api/v1/project/export —— 导出当前项目三文件为 zip
//
// 响应：application/zip **二进制**（通用约定显式例外，见 shared
// types/api.ts PROJECT_EXPORT_FILE_NAMES 注释）；Content-Disposition attachment，
// 文件名 <书名>.zip（RFC 5987 filename* UTF-8 编码，中文书名安全）。
// 流程：requireCurrentProject（无项目 → 409，与 /config 一致）→ 三文件存在性防御
// （缺失任一 → 500：打开的项目三文件必然齐全，缺失即损坏，不导出半成品包）→
// createBackupZip（B2.2 提取：wal_checkpoint 合并 WAL + zipSync 打包——与自动备份
// 同款管道，条目名保持数据文件原名，import/restore 侧按固定名校验）。
// key 存用户级配置，天然不入包。
projectRoutes.get("/export", (c) => {
  const project = requireCurrentProject();
  const dir = project.root;

 // 三文件缺失任一 → 500（数据完整性推断：打开的项目三文件必然齐全，缺失即损坏）
  for (const f of [PROJECT_FILE_NAME, OUTLINE_FILE_NAME, DATA_DB_FILE_NAME]) {
    if (!existsSync(join(dir, f))) {
      throw new HttpError(500, "INTERNAL_ERROR", `项目数据文件缺失，无法导出: ${f}`);
    }
  }

 // 备份管道复用（B2.2 提取）：WAL checkpoint + fflate zipSync（键序稳定）
  const zipData = createBackupZip(project);

 // Content-Disposition：ASCII fallback + RFC 5987 filename*（中文/空格书名编码安全）
  const fileName = `${project.config.name}.zip`;
  c.header("Content-Type", "application/zip");
  c.header("Content-Disposition", `attachment; filename="book.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return c.body(zipData);
});

// ============ 导入与备份管理（B2.2） ============

/** 上传大小上限（50MB；ora-4 复核保留——zip 含 data.db，正常项目远小于此） */
const MAX_IMPORT_SIZE = 50 * 1024 * 1024;

/** 书名为空/非法时的兜底名（后续会被 uniqueBookDir 去重成「导入的书籍 (2)」等） */
const FALLBACK_IMPORT_NAME = "导入的书籍";

/**
 * 书名合法性（纯判定，不抛）：与 client 同规则——禁路径分隔符/纯点/控制字符。
 * 导出供 `/cloud/import-book` 复用（那份书名有两种来源：云端目录名、包内 project.json——后者
 * 只经「非空字符串」校验，拼 `books/<书名>/` 前必须过同一道规则，否则可逃出 books/）。
 */
export function isBookNameValid(name: string): boolean {
  return name !== "" && !/[\\/]|^\.+$|[\u0000-\u001f]/.test(name);
}

/** 书名校验（与 client `lib/book-name.ts` 同规则）：禁路径分隔符/纯点/控制字符 */
function validateBookName(name: string): void {
  if (!name) {
    throw new HttpError(400, "VALIDATION_ERROR", "缺少书名字段 name");
  }
 // 与 client 同规则（lib/book-name.ts）："/"、"\"、纯点（. / ..）、控制字符一律拒绝——
 // name 直接拼 books/<name>/ 目录名，否则可逃出 books/（防越权精神）
  if (!isBookNameValid(name)) {
    throw new HttpError(400, "VALIDATION_ERROR", "书名不能包含 /、\\ 或为 . / ..");
  }
}

// 注：zip 解压（unzipWithBudget，含 zip 炸弹预算）、条目白名单、三文件顶层与
// data.db user_version 三态校验已在 backup.ts 提取为 validateBackupPackage（restore 与
// import 共用，import 校验顺序 3-7 语义）；本文件只保留 import 专属的分流与搬入逻辑。

/**
 * 按 project_id 在书架 books/ 下定位书目录（唯一 key = project_id）：
 * 遍历 books/ 下各书目录的 project.json 读 id 比对；无匹配返回 null。
 * 损坏的 project.json 抛错向上传播（与 list/open 语义一致：坏数据不静默吞）。
 * 导出供 `/cloud/remote-books`（`localExists`）与 `/cloud/import-book`（同 id 拒重复导入）复用。
 */
export function findBookDirById(root: string, id: string): string | null {
  const booksDir = join(root, BOOKS_DIR_NAME);
  let entries: Dirent[];
  try {
    entries = readdirSync(booksDir, { withFileTypes: true });
  } catch {
    return null; // books/ 不存在 → 无匹配
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(booksDir, e.name);
    const config = readProjectFile(dir);
    if (config !== null && config.id === id) return dir;
  }
  return null;
}

/**
 * 新书目标目录去重（import 节）：`books/<name>/` 已存在 →
 * `books/<name> (N)/`（N 为最小正整数，从 2 起，避免与去重命名惯例冲突）；
 * 返回去重后的目录绝对路径。project.json 内部 name 由调用方同步为去重名
 * （「目录名 = 书名」不变式）。
 */
export function uniqueBookDir(root: string, name: string): string {
  const booksDir = join(root, BOOKS_DIR_NAME);
  let candidate = join(booksDir, name);
  for (let n = 2; existsSync(candidate); n++) {
    candidate = join(booksDir, `${name} (${n})`);
  }
  return candidate;
}

// POST /api/v1/project/import —— 导入备份 zip 为新书
//
// 流程（全部校验通过才搬入，校验失败不触碰 books/）：
// content-length 预检（>50MB 快速拒绝，防超大请求先缓冲）→ multipart 解析
// （file=zip + name=书名）→ 书名校验（防路径逃逸）→ file.size 上限复核 →
// fflate Unzip 流式解压（**解压总字节预算 200MB**——zip 炸弹防御；未知条目仅记名
// 不解压；失败 400「不是有效的项目备份包」）→ **条目白名单**（只接受
// PROJECT_EXPORT_FILE_NAMES 三文件名，非白名单条目即损坏/恶意包，严格拒绝——
// 逐名比对天然防 zip 路径穿越）→ 三文件齐全 → project.json/outline.json 顶层
// → data.db 校验（**大小 > 0 → 打开成功 → user_version === SCHEMA_VERSION**；
// 0 字节/非 SQLite → 400 坏包；版本不匹配 409 SCHEMA_VERSION_MISMATCH 按相对版本
// 分流文案，拒绝导入不静默重建——与 open 的删库重建语义刻意区分）→ 目标
// books/<name>/ 冲突（409 PROJECT_ALREADY_EXISTS，与 create 同语义）→ mkdir + copy
// 原子搬入（任一失败清理半成品目录）→ 不打开（与 create 一致，前端刷新书架）。
// 校验在 mkdtemp 临时目录完成（finally 清理）；目标目录由服务端拼 books/<name>/，
// 客户端不可指定路径（防越权）。
projectRoutes.post("/import", async (c) => {
  if (projectRoot === null) {
    throw new HttpError(500, "INTERNAL_ERROR", "创作根未初始化（startServer 未调用 setProjectRoot）");
  }

 // 0. 上传大小预检（ora-4：parseBody 缓冲前先查 content-length，快速拒绝超大请求，
 // 避免先把几十上百 MB 读进内存；与 file.size 检查双保险——content-length 可缺失/不可信）
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > MAX_IMPORT_SIZE) {
    throw new HttpError(400, "VALIDATION_ERROR", `备份包超过大小上限（${MAX_IMPORT_SIZE / 1024 / 1024}MB）`);
  }

 // 1. multipart 解析（Hono 4 c.req.parseBody；非 multipart body → 解析失败 → 400）
 // 书名为**可选**：留空 = 用备份内的书名（备份是权威——备份文件名是
 // `<时间戳>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip`，拿它当书名是错的）
  const body = await c.req.parseBody().catch(() => null);
  const requestedName = typeof body?.name === "string" ? body.name.trim() : "";
  const file = body?.file;
  if (!(file instanceof File)) {
    throw new HttpError(400, "VALIDATION_ERROR", "缺少文件字段 file（zip 备份包）");
  }
  if (file.size > MAX_IMPORT_SIZE) {
    throw new HttpError(400, "VALIDATION_ERROR", `备份包超过大小上限（${MAX_IMPORT_SIZE / 1024 / 1024}MB）`);
  }

 // 2-4. 备份包校验（validateBackupPackage，backup.ts 提取——restore 与 import 共用）：
 // zip 解析（流式 + 200MB 预算，zip 炸弹防御）→ 条目白名单（防 zip 路径穿越）→
 // 三文件齐全 → 临时目录顶层（project.json/outline.json）→ data.db user_version
 // 三态分流（拒绝不静默重建）。通过返回内存 entries 与 project_id；
 // 失败抛 HttpError（400 坏包 / 409 SCHEMA_VERSION_MISMATCH），未触碰任何目标数据。
  let entries: Record<string, Uint8Array>;
  let projectId: string;
  let projectName: string;
  try {
    const validated = validateBackupPackage(new Uint8Array(await file.arrayBuffer()));
    entries = validated.entries;
    projectId = validated.projectId;
    projectName = validated.projectName;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "VALIDATION_ERROR", "不是有效的项目备份包（zip 解析失败）");
  }

 // 最终书名：用户显式填写优先（非法 → 400，与原语义一致）；留空 → 用备份内的
 // （备份名可能为空串或非法字符——isValidProjectFile 只校验类型，故需兜底）
  let name: string;
  if (requestedName !== "") {
    validateBookName(requestedName);
    name = requestedName;
  } else {
    const backed = projectName.trim();
    name = isBookNameValid(backed) ? backed : FALLBACK_IMPORT_NAME;
  }

 // 5. 分流（import 节）：id 匹配书架已有项目 → 覆盖恢复；
 // 不匹配 → 导入为新书（同名不再 409，目录自动去重）
  const matchedDir = findBookDirById(projectRoot, projectId);
  if (matchedDir !== null) {
 // —— 覆盖恢复（restore 同款管道）——
 // 覆盖目标按 id 定位目录（不是按 name，请求体 name 在覆盖场景不生效）；
 // 覆盖时 project.json 内 name 归一为当前目录名（「目录名 = 书名」不变式，
 // id 是身份、name 是展示名——修正 f4424b7）；数据随备份替换。
    const cur = getCurrentProject();
    if (cur !== null && cur.root === matchedDir) {
 // 目标是当前打开的书：复用现有连接快照 + 覆盖管道（重连 data.db + 定时器重启）
      try {
        const snapshot = writeBackup(cur); // 覆盖前自动快照（后悔药）
        overwriteProjectFiles(cur, entries, { name: basename(matchedDir), snapshotFileName: snapshot.fileName });
      } catch (err) {
 // P1-2：覆盖失败——overwriteProjectFiles 已尝试恢复连接；重连失败时连接悬挂，
 // 此处清空单例（与 open 路由同款防御），后续请求 409 NO_PROJECT_OPEN 而非 500
        if (getCurrentProject() !== null && !getCurrentProject()!.db.open) {
          setCurrentProject(null);
        }
        throw err;
      }
    } else {
 // 目标是书架其他书（未打开）：无连接，临时连接快照 + 文件层替换
      const snapshot = snapshotBookDir(matchedDir); // 覆盖前自动快照
      writeProjectFilesFromBackup(matchedDir, entries, {
        keepId: projectId,
        name: basename(matchedDir),
        snapshotFileName: snapshot.fileName,
      });
    }
    return c.json(ok({ imported: true as const, id: projectId, path: matchedDir, name: basename(matchedDir), mode: "restored" as const }));
  }

 // —— 导入为新书（原 同名不再 409）——
 // 目标目录 books/<name>/ 冲突 → 自动去重 books/<书名> (N)/（N 最小正整数，从 2 起）；
 // project.json 内部 name 同步为去重名（维持「目录名 = 书名」不变式）
  const bookDir = uniqueBookDir(projectRoot, name);
  try {
    mkdirSync(bookDir, { recursive: true });
 // zip id 沿用（keepId 不传）；name 归一为最终目录名
    writeProjectFilesFromBackup(bookDir, entries, { name: basename(bookDir) });
  } catch (err) {
    rmSync(bookDir, { recursive: true, force: true }); // 不留下残缺书
    throw err; // → errorHandler 500 INTERNAL_ERROR
  }

  return c.json(ok({ imported: true as const, id: projectId, path: bookDir, name: basename(bookDir), mode: "new" as const }));
});

// GET /api/v1/project/config —— 获取当前项目配置
projectRoutes.get("/config", (c) => {
  const project = requireCurrentProject(); // 无当前项目 → 409 NO_PROJECT_OPEN
 // 读内存 config（open 时载入、PUT 同步更新；单进程下与盘一致）
  return c.json(ok(mapProjectFileToConfig(project.config)));
});

// PUT /api/v1/project/config —— 更新当前项目配置
// 注：`prompt` 已废弃——strict schema 不再接受该字段（传入 → 400 VALIDATION_ERROR）；
// 项目规则改由 PUT /api/v1/project/agents 写入 
projectRoutes.put("/config", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const parsed = projectConfigUpdateReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error;
  }
  const { name, language, current_position, backup_frequency_minutes, deduction_nodes } = parsed.data;

 // current_position 校验：须指向存在的**非软删**大纲节点；
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
 // 章级收窄（卡片 1.1）：「当前位置」表达写作进度，只承载在章上——卷太粗、
 // 场景太碎；非章 → 400 VALIDATION_ERROR（收窄仅限写入侧，读侧不校验存量值）
    if (node.type !== "chapter") {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `current_position 须指向章节点（卷/场景不承载写作进度）: ${current_position}`,
      );
    }
  }

 // deduction_nodes 校验（同 current_position 口径）：逐 id 须存在 + 未软删 + 是 **章**，且落在**可见章序**内；
 // 不存在 / 不可见（自身软删，或所属卷被软删 ⇒ 整棵子树软删）→ 400 OUTLINE_NODE_NOT_FOUND；
 // 非章（卷/场景）→ 400 VALIDATION_ERROR
  let normalizedDeductionNodes: string[] | undefined;
  if (deduction_nodes !== undefined) {
    const tree = readOutlineFile(project.root);
    const visibleChapters = orderVisibleChapters(tree); // 唯一编号口径（shared）
    const visible = new Set(visibleChapters);
    for (const nodeId of deduction_nodes) {
      const node = findOutlineNode(tree, nodeId);
      if (node === undefined || node.deleted === true) {
        throw new HttpError(
          400,
          "OUTLINE_NODE_NOT_FOUND",
          `deduction_nodes 指向的大纲节点不存在或已软删: ${nodeId}`,
        );
      }
      if (node.type !== "chapter") {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          `deduction_nodes 须指向章节点（卷/场景不承载推演标记）: ${nodeId}`,
        );
      }
 // 章但不可见（所属卷被软删 ⇒ 整棵子树软删）：同样视为已失效
      if (!visible.has(nodeId)) {
        throw new HttpError(
          400,
          "OUTLINE_NODE_NOT_FOUND",
          `deduction_nodes 指向的大纲节点不可见（所属卷已软删）: ${nodeId}`,
        );
      }
    }
 // 归一：去重 + 按可见章先序（库里不表达标记先后）——可见章序上过滤，天然去重且保序
    const marked = new Set(deduction_nodes);
    normalizedDeductionNodes = visibleChapters.filter((id) => marked.has(id));
  }

 // 合并更新 + 刷新 updated_at（时间 ISO 8601 应用层写入），写盘并同步内存
 // backup_frequency_minutes 写侧「只写显式」：未在 patch 中出现不写盘——
 // 旧项目文件缺字段时不因无关更新被补写成缺省值（读侧兜底 10 不落盘，避免污染旧数据）；
 // 显式 null = 关闭（写入 null）；枚举值原样写入
  const next: ProjectFileConfig = {
    ...project.config,
    ...(name !== undefined ? { name } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(current_position !== undefined ? { current_position } : {}),
    ...(backup_frequency_minutes !== undefined ? { backup_frequency_minutes } : {}),
    ...(normalizedDeductionNodes !== undefined ? { deduction_nodes: normalizedDeductionNodes } : {}),
    updated_at: nowIso(),
  };
  writeProjectFile(project.root, next);
  project.config = next;

  return c.json(ok({ updated: true as const }));
});

// GET /api/v1/project/agents —— 读取项目规则文件 （项目规则唯一事实源）
//
// 语义：
// - 无当前项目 → 409 NO_PROJECT_OPEN（与 /config 一致）
// - **文件不存在不报错**：是可选文件（新项目/未迁移项目可能没有），返回
// exists:false + 空串，前端据此展示空编辑区
// - updatedAt = 文件系统 mtime（ISO 8601）——外部修改检测依据
// - 读取为**每次实时读文件**（不缓存）——外部编辑立即可见
projectRoutes.get("/agents", (c) => {
  const project = requireCurrentProject();
 // 实时读文件（不缓存）——外部编辑立即可见；readAgentsFile 返回 null = 文件不存在
  const fileContent = readAgentsFile(project.root);
  const content = fileContent ?? "";
  const exists = fileContent !== null; // 空文件（清空规则后保留）exists 仍为 true
  const updatedAt = agentsFileMtimeIso(project.root);
  return c.json(ok(projectAgentsGetResSchema.parse({ content, exists, updatedAt })));
});

// PUT /api/v1/project/agents —— 写入项目规则文件 （设置页直接编辑文件内容）
//
// 语义：
// - 无当前项目 → 409 NO_PROJECT_OPEN
// - **整体替换**（非追加）：content 为 完整内容；空串 = 清空规则（保留空文件不删除）
// - 文件不存在时自动创建；写入走**原子写**（临时文件 + fsync + rename，同款）
// - 写入后返回新 mtime，前端更新本地比对基线（外部修改检测用）
// - 写入失败 → 500 INTERNAL_ERROR（errorHandler 兜底）
projectRoutes.put("/agents", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const parsed = projectAgentsPutReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → app.onError → 400 VALIDATION_ERROR（含 fields）
  }
  writeAgentsFile(project.root, parsed.data.content);
  const updatedAt = agentsFileMtimeIso(project.root);
  return c.json(ok(projectAgentsPutResSchema.parse({ saved: true as const, updatedAt: updatedAt ?? nowIso() })));
});

// ============ 备份管理（B2.2，「备份管理」节） ============
//
// 备份管道/保留策略/校验/恢复逻辑集中 backup.ts（与自动定时器同模块）；
// 本文件只挂端点：requireCurrentProject（无项目 → 409 NO_PROJECT_OPEN，与 /config 一致）。

// GET /api/v1/project/backups —— 备份列表（时间倒序；.backups/ 不存在 → 空数组不报错）
projectRoutes.get("/backups", (c) => {
  const project = requireCurrentProject();
  return c.json(ok({ backups: listBackups(project) }));
});

// POST /api/v1/project/backup —— 立即备份（手动触发；同款管道 + 保留策略清理）
// 请求体可选 name（手动备份自定义名称，trim 后 1-30 字符；形状校验 zod schema，
// 名称规范化/权威校验收敛 sanitizeBackupName → writeBackup 唯一执行点）。
// 手动备份文件名落类型段「手动」（<时间戳>-手动-<设备>[-<标签>]-人物N-设定N-章N.zip）
projectRoutes.post("/backup", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const parsed = projectBackupReqSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new HttpError(400, "VALIDATION_ERROR", `备份请求体非法: ${parsed.error.issues[0]?.message ?? "参数校验失败"}`);
  }
 // kind 显式传 "manual"：name undefined 时 writeBackup 内部不 sanitize、无标签段
  const backup = writeBackup(project, { name: parsed.data.name, kind: "manual" });
 // 自动推送（卡 7）：手动备份成功后无条件推一次（**fire-and-forget**，不 await；不受节流、不推进
 // lastAutoPushAt；推的内容 = 最新一份 = 刚生成的这份）。推送失败不影响备份响应
  void autoPushAfterManualBackup(project);
  return c.json(ok({ backup }));
});

// POST /api/v1/project/backup/rename —— 重命名备份（只改名称段，时间戳与 kind 保持）
//
// 请求体（projectBackupRenameReqSchema）：
// - fileName 必填：.backups/ 下唯一命名格式（parseBackupFileName 白名单校验 → 非法 400）
// - name 可选：非空 → sanitizeBackupName 规范化（非法 400）；空串/缺省 → 清除名称段
// 语义：重命名只改标签段（时间戳/类型/设备/统计保持原份的值，kind 不随重命名改变）；
// 幂等——新文件名与原文件名相同 → 返回当前条目（不报错）。备份不存在 → 404。
projectRoutes.post("/backup/rename", async (c) => {
  const project = requireCurrentProject(); // 无当前项目 → 409 NO_PROJECT_OPEN（与 /backup 一致）
  const raw = await c.req.json().catch(() => null);
 // parseAsync 失败抛 ZodError → errorHandler → 400 VALIDATION_ERROR（含 fields，与 /config PUT 同款语义）
  const parsed = await projectBackupRenameReqSchema.parseAsync(raw);
  return c.json(ok({ backup: renameBackup(project, parsed.fileName, parsed.name) }));
});

// POST /api/v1/project/backup/restore —— 从备份恢复当前项目（覆盖恢复）
//
// 流程：
// 1. fileName 白名单校验（仅 .backups/ 下唯一命名格式，防路径穿越）→ 非法 400
// 2. 覆盖前自动快照（复用备份管道，参与保留策略——后悔药）→ 备份不存在 404
// 3. 备份包校验（zip/白名单//user_version 三态）→ 400/409 零触碰
// 4. 原子替换三文件 + 重连 data.db + 同步内存 config + 重启定时器（restoreBackup）
projectRoutes.post("/backup/restore", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const fileName =
    typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>).fileName === "string"
      ? ((raw as Record<string, unknown>).fileName as string)
      : null;
  if (fileName === null) {
    throw new HttpError(400, "VALIDATION_ERROR", "缺少文件名字段 fileName（备份文件名）");
  }
  try {
    return c.json(ok({ restored: true as const, ...restoreBackup(project, fileName) }));
  } catch (err) {
 // P1-2：restore 失败——overwriteProjectFiles 已尝试恢复连接；重连失败时连接悬挂，
 // 此处清空单例（与 open 路由同款防御），后续请求 409 NO_PROJECT_OPEN 而非 500
    if (getCurrentProject() !== null && !getCurrentProject()!.db.open) {
      setCurrentProject(null);
    }
    throw err;
  }
});

// POST /api/v1/project/rename —— 重命名当前书籍（同名并存场景的区分配套；
// 修正 f4424b7：仅当前打开项目，与导出按钮一致）
//
// 流程：
// 1. 校验新名（同创建规则：禁路径分隔符/纯点/控制字符 → 400 VALIDATION_ERROR）
// 2. 目标 books/<新名>/ 已存在且非当前书自身目录 → 409 PROJECT_ALREADY_EXISTS
// 3. 原子移动：先更新 project.json 内 name（原目录原子写）→ renameSync 移动目录；
// 移动失败 → 还原 name（回滚，不留下半成品）；.backups/ 随目录移动自然携带
// 4. 引用同步：project.root 指向新目录（定时器持有同一 project 引用，tick 内按
// project.root 计算路径，自动跟随）；会话/历史按 id 不受影响
projectRoutes.post("/rename", async (c) => {
  const project = requireCurrentProject(); // 无当前项目 → 409 NO_PROJECT_OPEN
  if (projectRoot === null) {
    throw new HttpError(500, "INTERNAL_ERROR", "创作根未初始化（startServer 未调用 setProjectRoot）");
  }
  const raw = await c.req.json().catch(() => null);
  const name =
    typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>).name === "string"
      ? ((raw as Record<string, unknown>).name as string).trim()
      : "";
  validateBookName(name); // 400（缺字段/非法字符）

 // 仅支持移动 books/ 下的书（创作根自身是项目时不可改名——移动创作根会破坏书架语义）
  const booksDir = join(projectRoot, BOOKS_DIR_NAME);
  if (dirname(project.root) !== booksDir) {
    throw new HttpError(400, "VALIDATION_ERROR", "仅支持重命名书架 books/ 下的书");
  }
  const oldDir = project.root;
  const targetDir = join(booksDir, name);
  if (targetDir === oldDir) {
 // 目录名未变（自身）→ 幂等成功（name 已是目录名，无需写盘）
    return c.json(ok({ renamed: true as const, path: oldDir, name }));
  }
  if (existsSync(targetDir)) {
    throw new HttpError(409, "PROJECT_ALREADY_EXISTS", `书架已存在同名书: ${name}`);
  }

 // 原子移动：先写新 name 到原目录 → rename 移动目录；移动失败还原 name
  const oldName = project.config.name;
  const written = { ...project.config, name, updated_at: nowIso() };
  writeProjectFile(oldDir, written);
  try {
    renameSync(oldDir, targetDir);
  } catch (err) {
 // 回滚：目录未移动，还原 project.json 内 name（不留下半成品）
    writeProjectFile(oldDir, { ...written, name: oldName, updated_at: nowIso() });
    throw err; // → errorHandler 500 INTERNAL_ERROR
  }

 // 引用同步：当前项目路径指向新目录（config 内存同步为写盘值；会话按 id 不受影响）
  project.root = targetDir;
  project.config = written;

 // 云端书目录跟随改名（卡 4）：**不阻塞本地改名**（云端慢/不可达时改名照常成功）；
 // 失败只记日志——下一轮同步按 `-<projectId>` 回退扫描仍能定位（云端目录名暂时落后）
  void renameCloudDir(project).catch((err: unknown) => {
    console.error("[cloud] 云端书目录改名失败（不阻塞本地改名，下次同步会按 id 重新定位）:", err);
  });

  return c.json(ok({ renamed: true as const, path: targetDir, name }));
});

/**
 * 删书前置推送（`POST /project/delete` 第 1 步）：打包一份最新备份并推送。
 *
 * - **当前打开的书**：复用现有连接（`getCurrentProject`）走备份管道；
 * - **未打开的书**：临时 `openDatabase` data.db → 打包 → 关闭（同 `snapshotBookDir` 管道）；
 *   **不走 `openProjectDatabase`**——删书不该触发迁移/重建（删前最后一步只读不写结构）。
 *
 * @returns 本次推送的备份文件名
 * @throws 推送链路原错误（HttpError 502 CLOUD_* / 409；其他 → 500）
 */
async function pushLatestBackupBeforeDelete(
  dir: string,
  config: ProjectFileConfig,
): Promise<{ fileName: string }> {
  const current = getCurrentProject();
  if (current !== null && current.root === dir) {
    const backup = writeBackup(current);
    await pushBackup(current, { fileName: backup.fileName });
    return { fileName: backup.fileName };
  }
  const db = openDatabase(join(dir, DATA_DB_FILE_NAME));
  try {
    const project: ProjectContext = { root: dir, config, db };
    const backup = writeBackup(project);
    await pushBackup(project, { fileName: backup.fileName });
    return { fileName: backup.fileName };
  } finally {
    closeDatabase(db);
  }
}

// POST /api/v1/project/delete —— 删除书架中的一本书（本地目录；可选云端目录）
//
// 契约 = `docs/api/10-api-project.md` §POST /project/delete、`docs/design/40-cloud-sync.md` §4 / §8.5。
// **删除不可恢复**：该书 `.backups/` 在书目录内，随目录一并消失 → 有云同步记录的书删前必
// 推一份最新副本（不变式：删书前必有一份**不在同一磁盘上**的副本，或用户明确的 `force`）。
// 删除顺序（当前书先收尾）：closeProject + setCurrentProject(null)（该单点释放会话运行时与定时器）
// + 抹 lastProject → rm；非当前书直接 rm（不碰当前项目的任何运行态）。
// `delete_remote` 在本地删除**之后**执行，best-effort（失败只回 `remoteError`，本地已删不回退）。
projectRoutes.post("/delete", async (c) => {
  if (projectRoot === null) {
    throw new HttpError(500, "INTERNAL_ERROR", "创作根未初始化（startServer 未调用 setProjectRoot）");
  }
  const parsed = projectDeleteReqSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw parsed.error; // → 400 VALIDATION_ERROR（含 fields）
  }
  const dir = resolveProjectDir(parsed.data.path); // 绝对路径 + 规范化 + 链接校验（不存在/链接跳转 → 400）
 // 只删 books/ 的**直接子目录**（创作根自身、嵌套目录、books/ 之外一律拒——路径归一后比较，不再拼用户输入）
  if (dirname(dir) !== join(projectRoot, BOOKS_DIR_NAME)) {
    throw new HttpError(400, "INVALID_PROJECT_PATH", `仅支持删除书架 books/ 下的书: ${dir}`);
  }
  const config = readProjectFile(dir); // 目录不含 project.json → 400（同 open 口径）
  if (config === null) {
    throw new HttpError(400, "INVALID_PROJECT_PATH", `目标目录不含 project.json，不是项目: ${dir}`);
  }

 // 前置推送（判据**纯本地**：云盘已配置 **且** 该书有同步记录（推过/拉过）；其余情况零云端请求）
  const stateBefore = readBookState(config.id);
  const webdav = readWebdavConfig();
  let pushed: { fileName: string } | undefined;
  if (webdav !== null && stateBefore !== null) {
    try {
      pushed = await pushLatestBackupBeforeDelete(dir, config);
    } catch (err) {
      if (parsed.data.force !== true) throw err; // 不删：原错误码透传（502 CLOUD_* / 409 CLOUD_CONFLICT / 500 INTERNAL_ERROR）
      console.error(`[cloud] 删书前置推送失败，force 继续删除: ${dir}`, err);
    }
  }

 // 删除：当前书先收尾（关连接 + 清单例 → 释放会话运行时、停定时器）
  const current = getCurrentProject();
  if (current !== null && current.root === dir) {
    closeProject(current);
    setCurrentProject(null);
    clearLastProject(projectRoot); // 下次启动回书架，不指向已删目录
  }
  rmSync(dir, { recursive: true, force: true });

 // 云端书目录删除（本地删除之后；目录名只认 book state 的记录，**不猜**；失败不回退本地结果）
  let remoteDeleted = false;
  let remoteError: { code: string; message: string } | undefined;
  if (parsed.data.delete_remote === true) {
    // 目录名在**前置推送之后**重读：原来没有 `dirName` 的书，推送成功会把这次建/用的目录名写回 state；
    // 照推送前的快照取名字就会漏掉刚推上去的那份（只回 remoteError，一次 DELETE 都不发）
    const dirName = readBookState(config.id)?.dirName ?? stateBefore?.dirName;
    if (webdav === null) {
      remoteError = { code: "CLOUD_NOT_CONFIGURED", message: "云盘未配置，云端备份未删除（本地已删除）" };
    } else if (dirName === undefined) {
      remoteError = {
        code: "CLOUD_FILE_NOT_FOUND",
        message: "该书没有云端目录记录（从未同步过），未删除云端内容（本地已删除）",
      };
    } else {
      try {
        await createWebdavClient(webdav).removeDir(dirName); // 集合删除：尾斜杠 + Depth: infinity 由客户端负责
        deleteBookState(config.id); // 云端已删 → 清掉该书 state（失败静默，不影响已删结果）
        remoteDeleted = true;
      } catch (err) {
        remoteError = {
          code: err instanceof HttpError ? err.code : "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  return c.json(
    ok({
      deleted: true as const,
      path: dir,
      ...(pushed !== undefined ? { pushed } : {}),
      ...(remoteDeleted ? { remoteDeleted: true as const } : {}),
      ...(remoteError !== undefined ? { remoteError } : {}),
    }),
  );
});
