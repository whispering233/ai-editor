// 云端存档路由：GET /status、PUT /config、POST /test、GET /remote-books、POST /import-book（挂载于 /api/v1/cloud）
//
// 契约 = `docs/api/100-api-cloud.md`；语义与不变式 = `docs/design/40-cloud-sync.md`。
//
// 除 push/pull（需当前项目）外均**不要求**项目已打开（设置页需先能配账号；projectId 仅作回显；
// 新机器恢复时书架还没打开任何书）。凭据纪律：password 永不进响应——不是脱敏展示，而是根本不回传。

import { Hono } from "hono";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import {
  cloudConfigPutReqSchema,
  cloudImportBookReqSchema,
  cloudPullReqSchema,
  cloudPushReqSchema,
  PROJECT_EXPORT_FILE_NAMES,
} from "@whispering233/ai-editor-shared/schemas";
import type {
  CloudConfigPutResult,
  CloudImportBookResult,
  CloudRemoteBook,
  CloudRemoteBooksResult,
  CloudStatus,
  CloudTestResult,
} from "@whispering233/ai-editor-shared";
import { parseBackupFileName, sanitizeDeviceName } from "@whispering233/ai-editor-shared";
import { HttpError, ok } from "../middleware/error.js";
import { getCurrentProject, requireCurrentProject } from "../middleware/project.js";
import { currentDeviceName } from "../cloud/device.js";
import { configuredDeviceName, readAutoPush, readBookState, readWebdavConfig, writeBookState, writeCloudConfig } from "../cloud/state.js";
import { startAutoBackup, validateBackupPackage, writeProjectFilesFromBackup, writeRawBackupFile } from "../backup.js";
import { cloudFileSet, computeCloudSync, findExistingCloudDir, pullBackup, pushBackup, toCloudBackups } from "../cloud/sync.js";
import { CLOUD_WORK_DIR, createWebdavClient, type DavEntry } from "../cloud/webdav.js";
import { findBookDirById, getProjectRoot, isBookNameValid, uniqueBookDir } from "./project.js";

/** 云端存档路由（挂载于 /api/v1/cloud） */
export const cloudRoutes = new Hono();

/** 读写探测用的临时文件名（沿用 `.tmp-` 约定：推送前清理流程会顺带回收遗留文件） */
export const WEBDAV_WRITE_TEST_FILE = ".tmp-ai-editor-writetest";
/** 探针用的工作子目录：**坚果云等云盘不允许在根目录直接建文件**（PUT 根 → 404 ObjectNotFound），
 * 但允许建子目录 ⇒ 探针写进它里面；建不了子目录（不支持/权限不足）时退回根目录写法 */
export const WEBDAV_WRITE_TEST_DIR = ".tmp-ai-editor-writetest-dir";

/**
 * 归一化 WebDAV 根 URL：必须是 `http(s)` 绝对地址；去尾斜杠（路径拼接由客户端逐段编码）。
 * 非法 → 400 VALIDATION_ERROR（文案面向用户，指出期望形态与示例）。
 */
function normalizeWebdavUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      // 不回显原始输入（用户可能把 ftp://用户名:密码@host 这类串粘进来；卡 D）
      "WebDAV 地址不是合法 URL（示例：https://dav.jianguoyun.com/dav/ai-editor）",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    // 只回显协议段（`parsed.protocol`），不回显原始输入（同上；卡 D）
    throw new HttpError(400, "VALIDATION_ERROR", `WebDAV 地址只接受 http/https（当前：${parsed.protocol}）`);
  }
 // 拒绝 URL 内嵌凭据（oracle 卡 2 验证 F1）：undici 拒绍带 credentials 的 URL（保存后永远不通），
 // 且该串会被原样回显进响应（凭据泄露）。**不静默剥离**——静默会让用户以为填对了。
  if (parsed.username !== "" || parsed.password !== "") {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "WebDAV 地址不得内嵌用户名/密码（如 https://user:pw@host/dav）——请分别填到用户名与应用密码字段",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

// GET /api/v1/cloud/status —— 配置段 + 云端段（remote：目录与备份列表）+ 本机段与三态（local/state）
// 已配置且打开了项目时发起 PROPFIND（缓存命中 2 次、需回退扫描时 3 次：书目录 + 目录列举 [+ 云根]）；
// 失败不影响本端点成功返回（remote=null + errorCode，state="unreachable"）
cloudRoutes.get("/status", async (c) => {
  const webdav = readWebdavConfig();
  const project = getCurrentProject();
  let remote: CloudStatus["remote"] = null;
  let rawEntries: DavEntry[] = [];
  let errorCode: string | undefined;
  if (webdav !== null && project !== null) {
    try {
      const client = createWebdavClient(webdav);
      const state = readBookState(project.config.id);
      const dirName = await findExistingCloudDir(client, project, state?.dirName);
      rawEntries = dirName === null ? [] : ((await client.list(dirName)) ?? []);
      remote = { dirName, backups: toCloudBackups(rawEntries) };
    } catch (err) {
      // 云端检查失败：只反映在状态里（remote=null + errorCode），不阻塞本地功能
      errorCode = err instanceof HttpError ? err.code : "CLOUD_UNREACHABLE";
    }
  }
  const { local, state } = computeCloudSync(
    project,
    webdav !== null,
    remote === null ? null : { files: cloudFileSet(rawEntries) },
  );
  const payload: CloudStatus = {
    configured: webdav !== null,
    url: webdav?.url ?? null,
    username: webdav?.username ?? null,
    device: currentDeviceName(),
    // 「用户显式设过」与「生效值」分开（卡 (a)）：面板只预填设过的值，避免保存时把派生值钉进配置
    deviceConfigured: configuredDeviceName() !== null,
    autoPush: readAutoPush(),
    projectId: project?.config.id ?? null,
    remote,
    local,
    state,
    ...(errorCode !== undefined ? { errorCode } : {}),
  };
  return c.json(ok(payload));
});

// POST /api/v1/cloud/pull —— 从云端拉取一份备份应用到当前项目（缺省 = 云端 head）
// 语义：三文件覆盖（`sessions/` 是纯本地目录，不写不删）；
// 覆盖前自动快照本机当前状态（restore 管道既有行为）
cloudRoutes.post("/pull", async (c) => {
  const project = requireCurrentProject(); // 409 NO_PROJECT_OPEN
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = cloudPullReqSchema.parse(body);
  const result = await pullBackup(project, {
    ...(parsed.file_name !== undefined ? { fileName: parsed.file_name } : {}),
  });
  return c.json(ok(result));
});

// PUT /api/v1/cloud/config —— 写入账号配置/设备名/自动推送开关（合并写；响应不含凭据）
cloudRoutes.put("/config", async (c) => {
  const parsed = cloudConfigPutReqSchema.parse(await c.req.json());

  // url：空串 = 清空；非空 → 归一化（校验失败 400）
  const url = parsed.url === undefined ? undefined : parsed.url.trim() === "" ? null : normalizeWebdavUrl(parsed.url.trim());
  // username：空串 = 清空
  const username = parsed.username === undefined ? undefined : parsed.username.trim();
  // password：**缺省或空串 = 保留原值**（响应从不回传 → 表单留空即不改）
  const password = parsed.password === undefined || parsed.password === "" ? undefined : parsed.password;
  // device：空串 = 回到缺省；非空 → sanitize（非法 400）
  let device: string | null | undefined;
  if (parsed.device !== undefined) {
    if (parsed.device.trim() === "") {
      device = null;
    } else {
      const sanitized = sanitizeDeviceName(parsed.device);
      if (sanitized === null) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "设备名非法（trim 后 1-16 字符，禁连字符 `-` 与路径分隔符/保留字符）",
        );
      }
      device = sanitized;
    }
  }

  writeCloudConfig({
    ...(url !== undefined ? { url } : {}),
    ...(username !== undefined ? { username } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(device !== undefined ? { device } : {}),
    ...(parsed.autoPush !== undefined ? { autoPush: parsed.autoPush } : {}),
  });

  // 自动推送的排程条件依赖自动备份频率：本机开关可能在本次保存中改变——立即重排一次 tick
  //（幂等；只在「备份频率关闭 + autoPush」时才真的排上 2h 兜底）——否则要等下次 open/restore
  const project = getCurrentProject();
  if (project !== null) startAutoBackup(project);

  const payload: CloudConfigPutResult = { saved: true };
  return c.json(ok(payload));
});

// POST /api/v1/cloud/push —— 推送一份本地备份到云端（缺省取最新一份；force = 冲突时用本机覆盖云端）
cloudRoutes.post("/push", async (c) => {
  const project = requireCurrentProject(); // 409 NO_PROJECT_OPEN
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = cloudPushReqSchema.parse(body);
  const result = await pushBackup(project, {
    ...(parsed.file_name !== undefined ? { fileName: parsed.file_name } : {}),
    ...(parsed.force !== undefined ? { force: parsed.force } : {}),
  });
  return c.json(ok(result));
});

// POST /api/v1/cloud/test —— 连通性 + 读/写权限探测（认证通过但无写权限是最常见的误配）
cloudRoutes.post("/test", async (c) => {
  const webdav = readWebdavConfig();
  if (webdav === null) {
    throw new HttpError(409, "CLOUD_NOT_CONFIGURED", "云盘未配置：请先填写 WebDAV 地址与用户名/应用密码");
  }
  const client = createWebdavClient(webdav);

  // 1) 根目录可达性：列不出来（404）→ 幂等创建 → **复核**（卡：MKCOL 可能被服务器以
  // 「已存在」等状态敷衍而不真正创建；不复核的话错误会错位到后面的 PUT 上，报 404 让人以为
  // 是写权限问题）。复核仍不存在 → 报「目录不存在且创建失败」并给出地址与建议。
  const entries = await client.list("");
  let created = false;
  if (entries === null) {
    created = await client.ensureWorkingRoot(); // 云盘根 + 工作根都幂等创建（地址还不存在也能自愈）
    if ((await client.list("")) === null) {
      throw new HttpError(
        502,
        "CLOUD_UNREACHABLE",
        `云盘目录不存在且创建失败：${webdav.url}（请确认地址指向你自己的 WebDAV 根目录，坚果云为 https://dav.jianguoyun.com/dav；若地址多带了一层不存在的子目录，先删掉它再测）`,
      );
    }
  }
  // 2) 写权限探测：**优先写进工作子目录**（坚果云等云盘根目录不可写文件：PUT `/dav/x` → 404
  // ObjectNotFound，而建子目录是允许的）；子目录建不了（不支持/权限不足）→ 退回根目录写法。
  // **可写不可删的云盘（DELETE 403/405…）不降级为认证失败**——读 + 写都通过了，凭据有效，只是清理失败；
  // 报 502 AUTH_FAILED 会误导用户去查凭据。这里改为成功 + 提示残留（具体状态码进日志）。
  let probeDir: string | null = null;
  try {
    // 先清历史残留（上一次因删除失败留下的空目录）——顺带验证删除能力
    await client.removeDir(WEBDAV_WRITE_TEST_DIR).catch(() => undefined);
    await client.mkcol(WEBDAV_WRITE_TEST_DIR); // 幂等：已存在返回 false，同样可用
    probeDir = WEBDAV_WRITE_TEST_DIR;
  } catch (err) {
    console.error("[cloud] 工作子目录创建失败，探针退回根目录写法:", err);
  }
  const probePath = probeDir === null ? WEBDAV_WRITE_TEST_FILE : `${probeDir}/${WEBDAV_WRITE_TEST_FILE}`;
  await client.put(probePath, new TextEncoder().encode("ai-editor webdav write test"));
  let leftover = false;
  try {
    await client.remove(probePath);
  } catch (err) {
    leftover = true;
    console.error("[cloud] 测试文件删除失败（云盘可能不允许删除；凭据本身正常）:", err);
  }
  if (probeDir !== null && !leftover) {
    // 子目录一并清掉（用 removeDir：集合删除需要尾斜杠 + Depth: infinity，否则某些云盘不删、留空目录）
    try {
      await client.removeDir(probeDir);
    } catch (err) {
      console.error("[cloud] 测试目录删除失败（空目录残留，下次「测试连接」会再清一次）:", err);
    }
  }

  // baseUrl 回显**用户的云盘根**（配置值；工作根 `<根>/ai-editor` 由客户端层拼，不进配置语义）
  const payload: CloudTestResult = { connected: true, baseUrl: webdav.url, created, ...(leftover ? { leftoverWriteTestFile: true } : {}) };
  return c.json(ok(payload));
});

// ============ 新机器恢复：列云端书 + 导入为新书（`docs/design/40-cloud-sync.md` §10） ============

/** 未配置云盘时两个端点的统一拒绝（码表：409 CLOUD_NOT_CONFIGURED） */
function requireWebdavConfig() {
  const webdav = readWebdavConfig();
  if (webdav === null) {
    throw new HttpError(409, "CLOUD_NOT_CONFIGURED", "云盘未配置：请先在设置页填写 WebDAV 地址与用户名/应用密码");
  }
  return webdav;
}

/**
 * 云端书目录名 → `{ name, projectId }`；解析不出 → null（= 目录名没带 id / 无 id 声明，**不阻止导入**；UI 只对无备份置灰）。
 *
 * 三种命名（`docs/api/100-api-cloud.md`）：`<书名>-<projectId>`（默认）、`ai-editor-<projectId>`
 * （云盘拒长名后的回退）、`<projectId>`（回退链最后一档）。projectId 形状 = `proj-` + 21 位 URL 安全
 * 字母（shared `generateProjectId`）——按这个形状匹配尾部，不按 `-` 切分（书名与 nanoid 段都可含 `-`）。
 * 两种回退命名的首段不是真书名 → `name = null`。
 */
function parseCloudBookDirName(dirName: string): { name: string | null; projectId: string } | null {
  const match = /^(?:(.+)-)?(proj-[A-Za-z0-9_-]{21})$/.exec(dirName);
  if (match === null) return null;
  const name = match[1] === undefined || match[1] === CLOUD_WORK_DIR ? null : match[1];
  return { name, projectId: match[2] as string };
}

/**
 * 导入完成时的同步基准（写进 `cloud.json` 的 `lastSyncAt`）= `max(now, 刚写下的三文件 mtime 向上取整到毫秒)`。
 *
 * 为何不直接 `new Date()`：文件系统 mtime 是**亚毫秒**精度，而 `new Date()` 只到毫秒——同一毫秒内
 * 写下的文件会被 `hasLocalEditsSince` 的**严格**比较（project.json/outline.json 无容差）读成
 * 「本机有改动」，于是刚导入完查状态就是 `local-ahead`（实测同毫秒写入下约 1/6 概率）。
 * 基准不由自己写入的文件决定，才符合「刚导入 = 已同步」的语义。
 */
function importSyncBaseline(bookDir: string): string {
  let baseline = Date.now();
  for (const name of PROJECT_EXPORT_FILE_NAMES) {
    try {
      baseline = Math.max(baseline, Math.ceil(statSync(join(bookDir, name)).mtimeMs));
    } catch {
      continue; // 三文件刚写完，stat 失败不改变基准（基准只影响三态判定的灵敏度）
    }
  }
  return new Date(baseline).toISOString();
}

// GET /api/v1/cloud/remote-books —— 列云端工作根下的全部书目录（不要求项目已打开）
// 工作根不存在 → 空数组（**GET 不写云盘**：不 MKCOL，用户先配好并在本机推一份）；
// 每书目录一次 PROPFIND（请求量 = 1 + 书目录数）；无法解析的目录也列出（backups:[] / projectId:null）
cloudRoutes.get("/remote-books", async (c) => {
  const webdav = requireWebdavConfig();
  const client = createWebdavClient(webdav);
  const rootEntries = await client.list("");
  if (rootEntries === null) {
    const empty: CloudRemoteBooksResult = { books: [] };
    return c.json(ok(empty));
  }
  const root = getProjectRoot();
  const books: CloudRemoteBook[] = [];
  for (const dir of rootEntries.filter((entry) => entry.isCollection)) {
    const entries = (await client.list(dir.name)) ?? [];
    const parsed = parseCloudBookDirName(dir.name);
    books.push({
      dirName: dir.name,
      name: parsed?.name ?? null,
      projectId: parsed?.projectId ?? null,
      // 本机已有同 id 的书 → 不可重复导入（UI 置灰并提示去打开同步）
      localExists: parsed !== null && root !== null && findBookDirById(root, parsed.projectId) !== null,
      backups: toCloudBackups(entries),
    });
  }
  const payload: CloudRemoteBooksResult = { books };
  return c.json(ok(payload));
});

// POST /api/v1/cloud/import-book —— 把云端某本书的一份备份导入为本机新书（不要求项目已打开）
//
// 流程：目录/文件存在性（404）→ 下载 → **既有导入校验管道** `validateBackupPackage`
// （与 `POST /project/import` 同一实现：坏包 400 / 版本 409）→ **目录名一致性守卫**
// （目录名能解析出 id 且 ≠ 包内 id → 400；必读包内 id 故此时才能比对；从未触碰 `books/`）
// → 本机已有同 id → 409（不静默覆盖：
// 那本书应在应用内自己同步）→ `uniqueBookDir` 建档（**id 沿用**、name 归一为目录名）→
// 那份 zip **原样**落新书 `.backups/`（新机器立刻有一份「最新本地备份」）→ 写 `cloud.json` book state
// （`lastPushedFileName` = 导入的那份 / `lastSeenCloudFiles` = 当时云端集合 / `lastSyncAt` = 见
// `importSyncBaseline`）——不写则新机器一打开就是 `conflict`（云端有份 + 本机无同步记录），
// 刚拉下来就逼用户裁决。**不自动打开**。
cloudRoutes.post("/import-book", async (c) => {
  const webdav = requireWebdavConfig();
  const parsed = cloudImportBookReqSchema.parse(await c.req.json().catch(() => ({})));
  const root = getProjectRoot();
  if (root === null) {
    throw new HttpError(500, "INTERNAL_ERROR", "创作根未初始化（startServer 未调用 setProjectRoot）");
  }
  // dir_name 进云盘路径拼接，也作书名兜底 → 只接受**单段目录名**（不含路径分隔符与 `..`，
  // 且通过书名规则：纯点/控制字符同样拒——`books/` 下目标目录名就从它派生）
  if (parsed.dir_name.trim() === "" || /[/\\]|\.\./.test(parsed.dir_name) || !isBookNameValid(parsed.dir_name)) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `云端目录名非法（须为不含路径分隔符与 .. 的单段名）: ${parsed.dir_name}`,
    );
  }
  if (parsed.file_name !== undefined && parseBackupFileName(parsed.file_name) === null) {
    throw new HttpError(400, "VALIDATION_ERROR", `备份文件名不在白名单内: ${parsed.file_name}`);
  }

  const client = createWebdavClient(webdav);
  const entries = await client.list(parsed.dir_name);
  if (entries === null) {
    throw new HttpError(404, "CLOUD_FILE_NOT_FOUND", `云端没有这个书目录: ${parsed.dir_name}`);
  }
  const backups = toCloudBackups(entries);
  const head = backups[0] ?? null;
  const target =
    parsed.file_name === undefined ? head : (backups.find((entry) => entry.fileName === parsed.file_name) ?? null);
  if (target === null) {
    throw new HttpError(
      404,
      "CLOUD_FILE_NOT_FOUND",
      parsed.file_name === undefined
        ? `云端书目录里没有可导入的备份: ${parsed.dir_name}`
        : `云端那份备份已不存在: ${parsed.file_name}`,
    );
  }
  const bytes = await client.get(`${parsed.dir_name}/${target.fileName}`);
  if (bytes === null) {
    throw new HttpError(404, "CLOUD_FILE_NOT_FOUND", `云端那份备份已不存在: ${target.fileName}`);
  }

  // 校验通过前不触碰 books/（与 import 同管道同语义）；版本过高/坏包直接抛出，不落半成品
  const validated = validateBackupPackage(new Uint8Array(bytes));
  // 目录名解析出的 id ≠ 包内 id → 拒绝（设计文档 §10 表）。危害不是「导入错书」而是 state.dirName 取自目录名：
  // 之后推送会把这本书写进**别人的书的云端目录**（跨书污染）。解析不出 id（用户手工命名目录）无 id 声明，不算冲突。
  const declaredId = parseCloudBookDirName(parsed.dir_name)?.projectId ?? null;
  if (declaredId !== null && declaredId !== validated.projectId) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `云端目录与备份内容不是同一本书（目录名声明 id: ${declaredId}，备份包内 id: ${validated.projectId}）——请确认选对了书目录`,
    );
  }
  if (findBookDirById(root, validated.projectId) !== null) {
    throw new HttpError(
      409,
      "PROJECT_ALREADY_EXISTS",
      `本机书架已有这本书（id: ${validated.projectId}）——打开它自己同步即可，不重复导入`,
    );
  }

  // 书名：目录名解析出的优先（云端目录名就是书名来源）；回退命名解析不出 → 包内 project.json 的书名；
  // 两者都不合法（包内书名只经「非空字符串」校验，拼目录前必须过同一道规则）→ 用目录名（已验单段）
  const candidate = parseCloudBookDirName(parsed.dir_name)?.name ?? validated.projectName.trim();
  const bookDir = uniqueBookDir(root, isBookNameValid(candidate) ? candidate : parsed.dir_name);
  try {
    mkdirSync(bookDir, { recursive: true });
    writeProjectFilesFromBackup(bookDir, validated.entries, { name: basename(bookDir) }); // id 沿用（keepId 不传）
    writeRawBackupFile(bookDir, target.fileName, bytes);
    writeBookState(validated.projectId, {
      dirName: parsed.dir_name,
      lastPushedFileName: target.fileName,
      lastSeenHeadFileName: head?.fileName ?? target.fileName,
      lastSyncAt: importSyncBaseline(bookDir),
      lastSeenCloudFiles: cloudFileSet(entries),
    });
  } catch (err) {
    rmSync(bookDir, { recursive: true, force: true }); // 半成品不留（含已落盘的那份 zip）
    throw err;
  }

  const payload: CloudImportBookResult = {
    imported: true,
    id: validated.projectId,
    path: bookDir,
    name: basename(bookDir),
    fileName: target.fileName,
    size: bytes.length,
  };
  return c.json(ok(payload));
});
