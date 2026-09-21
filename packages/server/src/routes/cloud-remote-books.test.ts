// 云端书架端点测试（卡 23.6）：GET /cloud/remote-books（列云端书目录）与 POST /cloud/import-book（导入为新书）。
//
// 契约：docs/api/100-api-cloud.md（字段与错误码）、docs/design/40-cloud-sync.md §10（三条为什么）。
// 云端用**内存版最小 WebDAV**（stub 全局 fetch）：能精确构造「工作根不存在 / 无法解析 id 的目录 /
// 无备份目录 / 非本程序命名的文件 / 坏包 / 未来版本包」，并断言**零写请求**；协议本身由
// webdav.test.ts / webdav.integration.test.ts 覆盖。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { unzipSync, zipSync } from "fflate";
import { formatBackupFileName, generateProjectId, type ProjectFileConfig } from "@whispering233/ai-editor-shared";
// 三文件名单单源（与备份管道逐字同一常量；根入口是 type-only barrel，运行时常量只在 schemas 子路径）
import { PROJECT_EXPORT_FILE_NAMES } from "@whispering233/ai-editor-shared/schemas";
import {
  closeDatabase,
  DATA_DB_FILE_NAME,
  openDatabase,
  readProjectFile,
  SCHEMA_VERSION,
  setUserVersion,
  writeOutlineFile,
  writeProjectFile,
} from "@whispering233/ai-editor-db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { BACKUPS_DIR_NAME, writeBackup } from "../backup.js";
import { initCloudState, readBookState, writeCloudConfig } from "../cloud/state.js";
import { cloudRoutes } from "./cloud.js";
import { projectRoutes, setProjectRoot } from "./project.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const JSON_HEADERS = { ...HOST_HEADERS, "content-type": "application/json" };
const DAV_BASE = "https://dav.example.com/dav";
/** 客户端实际读写的前缀 = 云盘根 + 工作根 `ai-editor`（createWebdavClient 唯一拼接点） */
const WORK_PATH = `${new URL(DAV_BASE).pathname.replace(/\/+$/, "")}/ai-editor`;
const T0 = "2026-08-01T10:00:00Z";
/** 备份文件名里的设备段（构造云端份用；不含 `-`） */
const DEVICE = "测试机";
const STATS = { characters: 0, settings: 0, chapters: 0 };

let root: string;

function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/project", projectRoutes);
  app.route("/api/v1/cloud", cloudRoutes);
  return app;
}

function request(url: string, method: "GET" | "POST", body?: unknown): Promise<Response> {
  return buildApp().request(url, {
    method,
    headers: body !== undefined ? JSON_HEADERS : HOST_HEADERS,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function errorBody(res: Response): Promise<{ code: string; message: string }> {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
}

async function responseData<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}

// ============ 内存版最小 WebDAV（只覆盖本端点用到的动词） ============

interface DavCall {
  method: string;
  path: string;
}

interface FakeDav {
  /** 相对工作根的目录集合（"" = 工作根自身） */
  dirs: Set<string>;
  files: Map<string, Uint8Array>;
  calls: DavCall[];
  spy: ReturnType<typeof vi.fn>;
}

function parentOf(rel: string): string {
  return rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
}

/** 装一个空云盘（只有工作根）到全局 fetch——`workingRoot: false` = 工作根都不存在 */
function stubDav(workingRoot = true): FakeDav {
  const dav: FakeDav = { dirs: new Set(workingRoot ? [""] : []), files: new Map(), calls: [], spy: vi.fn() };
  const relOf = (input: string): string => {
    const pathname = new URL(input).pathname;
    const rest = pathname.startsWith(WORK_PATH) ? pathname.slice(WORK_PATH.length) : pathname;
    return rest
      .split("/")
      .filter((s) => s !== "")
      .map((s) => decodeURIComponent(s))
      .join("/");
  };
  const hrefOf = (rel: string, isDir: boolean): string => {
    const encoded = rel
      .split("/")
      .filter((s) => s !== "")
      .map(encodeURIComponent)
      .join("/");
    return encoded === "" ? `${WORK_PATH}/` : `${WORK_PATH}/${encoded}${isDir ? "/" : ""}`;
  };
  const entryXml = (rel: string, isDir: boolean, size: number): string =>
    `<d:response><d:href>${hrefOf(rel, isDir)}</d:href><d:propstat><d:prop><d:resourcetype>${
      isDir ? "<d:collection/>" : ""
    }</d:resourcetype>${
      isDir ? "" : `<d:getcontentlength>${size}</d:getcontentlength>`
    }</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

  dav.spy.mockImplementation((input: unknown, init?: RequestInit) => {
    const method = String(init?.method ?? "GET");
    const rel = relOf(String(input));
    dav.calls.push({ method, path: rel });

    switch (method) {
      case "PROPFIND": {
        // 目录不存在 → 404（含工作根自身；`list()` 据此返回 null = 「不存在」）
        if (!dav.dirs.has(rel)) return Promise.resolve(new Response(null, { status: 404 }));
        const dirs = [...dav.dirs].filter((d) => d !== rel && parentOf(d) === rel);
        const files = [...dav.files.entries()].filter(([f]) => parentOf(f) === rel);
        const xml = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${entryXml(rel, true, 0)}${dirs
          .map((d) => entryXml(d, true, 0))
          .join("")}${files.map(([f, bytes]) => entryXml(f, false, bytes.length)).join("")}</d:multistatus>`;
        return Promise.resolve(new Response(xml, { status: 207 }));
      }
      case "MKCOL": {
        if (dav.dirs.has(rel)) return Promise.resolve(new Response(null, { status: 405 }));
        dav.dirs.add(rel);
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      case "PUT": {
        dav.files.set(rel, new Uint8Array(init?.body as Uint8Array));
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      case "GET": {
        const bytes = dav.files.get(rel);
        return Promise.resolve(
          bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes, { status: 200 }),
        );
      }
      case "DELETE": {
        if (dav.files.delete(rel)) return Promise.resolve(new Response(null, { status: 204 }));
        dav.dirs.delete(rel);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      default:
        return Promise.resolve(new Response(null, { status: 405 }));
    }
  });
  vi.stubGlobal("fetch", dav.spy);
  return dav;
}

/** 在云盘建一个书目录（含若干份；份名即协议文件名） */
function seedCloudBook(dav: FakeDav, dirName: string, files: Array<{ fileName: string; bytes: Uint8Array }>): void {
  dav.dirs.add(dirName);
  for (const file of files) {
    dav.files.set(`${dirName}/${file.fileName}`, file.bytes);
  }
}

/** 预置一份**非本程序命名**的文件（不可解析 → 不列出） */
function seedForeignFile(dav: FakeDav, dirName: string, name: string): void {
  dav.files.set(`${dirName}/${name}`, new TextEncoder().encode("foreign"));
}

// ============ 项目夹具 ============

/** 造一本本地书（真三文件 + 真 data.db，user_version = SCHEMA_VERSION）；返回 id 与目录 */
function makeLocalBook(name: string, id = generateProjectId()): { dir: string; id: string } {
  const dir = join(root, "books", name);
  mkdirSync(dir, { recursive: true });
  writeProjectFile(dir, {
    id,
    name,
    language: "zh",
    schema_version: SCHEMA_VERSION,
    current_position: null,
    created_at: T0,
    updated_at: T0,
  });
  writeOutlineFile(dir, { id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] });
  const db = openDatabase(join(dir, DATA_DB_FILE_NAME));
  setUserVersion(db, SCHEMA_VERSION);
  closeDatabase(db);
  return { dir, id };
}

/** 用真备份管道造一份合法 zip（三文件）；返回文件名与字节 */
function makeBackupZip(bookDir: string): { fileName: string; bytes: Uint8Array } {
  const db = openDatabase(join(bookDir, DATA_DB_FILE_NAME));
  try {
    const info = writeBackup(
      { root: bookDir, config: readProjectFile(bookDir) as ProjectFileConfig, db },
      { kind: "manual" },
    );
    return {
      fileName: info.fileName,
      bytes: new Uint8Array(readFileSync(join(bookDir, BACKUPS_DIR_NAME, info.fileName))),
    };
  } finally {
    closeDatabase(db);
  }
}

/** 按给定时刻造一个可解析的备份文件名（云端份的排序基准） */
function backupNameAt(iso: string, kind: "auto" | "manual" = "auto"): string {
  return formatBackupFileName(new Date(iso), { kind, device: DEVICE, stats: STATS });
}

function configureCloud(): void {
  writeCloudConfig({ url: DAV_BASE, username: "u@example.com", password: "app-pw" });
}

function importedBookDir(name: string): string {
  return join(root, "books", name);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-editor-cloud-remote-"));
  setCurrentProject(null);
  setProjectRoot(root);
  initCloudState(root);
});

afterEach(() => {
  vi.useRealTimers(); // 复位 fake timers（lastSyncAt 基准那条用）
  const current = getCurrentProject();
  if (current !== null) {
    closeProject(current);
    setCurrentProject(null);
  }
  setProjectRoot(null);
  initCloudState(null);
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/v1/cloud/remote-books", () => {
  it("未配置云盘 → 409 CLOUD_NOT_CONFIGURED，零请求", async () => {
    const dav = stubDav();

    const res = await request("/api/v1/cloud/remote-books", "GET");

    expect(res.status).toBe(409);
    expect((await errorBody(res)).code).toBe("CLOUD_NOT_CONFIGURED");
    expect(dav.spy).not.toHaveBeenCalled();
  });

  it("工作根不存在 → {books: []}，且**零写请求**（GET 不 MKCOL、不落任何文件）", async () => {
    configureCloud();
    const dav = stubDav(false); // 云盘根也没有工作根

    const res = await request("/api/v1/cloud/remote-books", "GET");

    expect(res.status).toBe(200);
    expect(await responseData(res)).toEqual({ books: [] });
    expect(dav.calls).toEqual([{ method: "PROPFIND", path: "" }]); // 只列了一次工作根
    expect(dav.dirs.size).toBe(0); // 未创建任何目录
    expect(dav.files.size).toBe(0);
  });

  it("多目录：解析书名/projectId、localExists 命中与不命中、无法解析 id 的目录与无备份目录也列出", async () => {
    configureCloud();
    const dav = stubDav();
    const local = makeLocalBook("本机书"); // 本机书架已有（localExists 命中）
    const foreign = generateProjectId(); // 云端独有（本机没有）
    const zip = makeBackupZip(local.dir);
    seedCloudBook(dav, `本机书-${local.id}`, [zip]);
    seedCloudBook(dav, `云端书-${foreign}`, [zip]);
    seedCloudBook(dav, `ai-editor-${foreign}`, [zip]); // 云盘拒长名后的回退命名
    seedCloudBook(dav, `没有 id 的目录`, [zip]); // 解析不出 projectId
    const emptyDir = `空目录-${generateProjectId()}`;
    seedCloudBook(dav, emptyDir, []); // 一份可解析的备份都没有
    seedForeignFile(dav, `云端书-${foreign}`, "别的程序的文件.txt");

    const res = await request("/api/v1/cloud/remote-books", "GET");
    expect(res.status).toBe(200);
    const books = (await responseData<{ books: Array<Record<string, unknown>> }>(res)).books;

    expect(books.map((b) => b.dirName).sort()).toEqual(
      [`本机书-${local.id}`, `云端书-${foreign}`, `ai-editor-${foreign}`, "没有 id 的目录", emptyDir].sort(),
    );
    const byDir = new Map(books.map((b) => [b.dirName, b]));
    expect(byDir.get(`本机书-${local.id}`)).toMatchObject({
      name: "本机书",
      projectId: local.id,
      localExists: true,
      // 设备段来自本机（writeBackup 写入时取 currentDeviceName）→ 只断言形状
      backups: [{ fileName: zip.fileName, size: zip.bytes.length, kind: "manual", device: expect.any(String) }],
    });
    // 云端独有 → localExists 不命中
    expect(byDir.get(`云端书-${foreign}`)).toMatchObject({
      name: "云端书",
      projectId: foreign,
      localExists: false,
      backups: [{ fileName: zip.fileName }], // 「别的程序的文件.txt」不在列表里
    });
    // 回退命名 `ai-editor-<id>`：projectId 解析得出，书名段不是真书名 → name = null（UI 回退显示 dirName）
    expect(byDir.get(`ai-editor-${foreign}`)).toMatchObject({ name: null, projectId: foreign, localExists: false });
    // 无法解析 id 的目录：也列出（UI 置灰），不可导入
    expect(byDir.get("没有 id 的目录")).toMatchObject({ name: null, projectId: null, localExists: false });
    expect(byDir.get(emptyDir)?.backups).toEqual([]);
  });

  it("备份按时间倒序、head = [0]；请求量 = 1（工作根）+ 书目录数", async () => {
    configureCloud();
    const dav = stubDav();
    const id = generateProjectId();
    const dirName = `多份-${id}`;
    const zip = makeBackupZip(makeLocalBook("多份").dir);
    seedCloudBook(dav, dirName, [
      { fileName: backupNameAt("2026-08-03T10:00:00Z"), bytes: zip.bytes },
      { fileName: backupNameAt("2026-08-01T10:00:00Z"), bytes: zip.bytes },
      { fileName: backupNameAt("2026-08-02T10:00:00Z", "manual"), bytes: zip.bytes },
    ]);

    const res = await request("/api/v1/cloud/remote-books", "GET");
    const books = (await responseData<{ books: Array<{ backups: Array<{ fileName: string; createdAt: string }> }> }>(res))
      .books;

    expect(books).toHaveLength(1);
    expect(books[0]?.backups.map((b) => b.createdAt)).toEqual([
      new Date("2026-08-03T10:00:00Z").toISOString(),
      new Date("2026-08-02T10:00:00Z").toISOString(),
      new Date("2026-08-01T10:00:00Z").toISOString(),
    ]);
    expect(books[0]?.backups[0]?.fileName).toBe(backupNameAt("2026-08-03T10:00:00Z"));
    expect(dav.calls).toHaveLength(2); // 工作根 + 该目录
  });
});

describe("POST /api/v1/cloud/import-book", () => {
  it("未配置云盘 → 409 CLOUD_NOT_CONFIGURED", async () => {
    const res = await request("/api/v1/cloud/import-book", "POST", { dir_name: "任意" });
    expect(res.status).toBe(409);
    expect((await errorBody(res)).code).toBe("CLOUD_NOT_CONFIGURED");
  });

  it("正常导入：新书出现 + id 沿用 + name 归一为目录名 + 该 zip 原样落 .backups/ + 不自动打开", async () => {
    configureCloud();
    const dav = stubDav();
    const local = makeLocalBook("云端来的书"); // 只作 zip 来源；导入目标目录会另建
    const zip = makeBackupZip(local.dir);
    const dirName = `云端来的书-${local.id}`;
    seedCloudBook(dav, dirName, [zip]);
    rmSync(local.dir, { recursive: true, force: true }); // 模拟新机器：本机没有这本书

    const res = await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName });

    expect(res.status).toBe(200);
    const bookDir = importedBookDir("云端来的书");
    expect(await responseData(res)).toEqual({
      imported: true,
      id: local.id,
      path: bookDir,
      name: "云端来的书",
      fileName: zip.fileName,
      size: zip.bytes.length,
    });
    // 三文件到位：project.json 的 id = zip 内 id（跨机器身份）、name 归一为目录名
    expect(readProjectFile(bookDir)).toMatchObject({ id: local.id, name: "云端来的书" });
    expect(existsSync(join(bookDir, "outline.json"))).toBe(true);
    // 那份 zip **原样**落新书 .backups/（逐字节一致）
    expect([...readFileSync(join(bookDir, BACKUPS_DIR_NAME, zip.fileName))]).toEqual([...zip.bytes]);
    // cloud.json 的五个字段（不写则一打开就 conflict——设计文档 §10 为什么 1）
    expect(readBookState(local.id)).toEqual({
      dirName,
      lastPushedFileName: zip.fileName,
      lastSeenHeadFileName: zip.fileName,
      lastSyncAt: expect.any(String),
      lastSeenCloudFiles: [zip.fileName],
    });
    // **不自动打开**（与 import 一致：前端刷新书架，由用户点开）
    expect(getCurrentProject()).toBeNull();
    expect((await request("/api/v1/project/config", "GET")).status).toBe(409);
  });

  it("导入后打开该书立刻查状态 → synced（写同步状态才有的结果）", async () => {
    configureCloud();
    const dav = stubDav();
    const local = makeLocalBook("刚拉下的书");
    const zip = makeBackupZip(local.dir);
    const dirName = `刚拉下的书-${local.id}`;
    seedCloudBook(dav, dirName, [zip]);
    rmSync(local.dir, { recursive: true, force: true });

    expect((await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName })).status).toBe(200);
    const bookDir = importedBookDir("刚拉下的书");
    expect((await request("/api/v1/project/open", "POST", { path: bookDir })).status).toBe(200);

    const status = await responseData<{ state: string; remote: { dirName: string | null } | null }>(
      await request("/api/v1/cloud/status", "GET"),
    );

    expect(status.remote?.dirName).toBe(dirName);
    expect(status.state).toBe("synced");
  });

  it("回退命名目录（ai-editor-<id>）→ 书名回退包内 project.json 的名字", async () => {
    configureCloud();
    const dav = stubDav();
    const local = makeLocalBook("原名很长的书");
    const zip = makeBackupZip(local.dir);
    seedCloudBook(dav, `ai-editor-${local.id}`, [zip]); // 云盘拒长名后的回退命名
    rmSync(local.dir, { recursive: true, force: true });

    const res = await request("/api/v1/cloud/import-book", "POST", { dir_name: `ai-editor-${local.id}` });

    expect(res.status).toBe(200);
    expect(await responseData(res)).toMatchObject({ id: local.id, name: "原名很长的书" });
    expect(readProjectFile(importedBookDir("原名很长的书"))).toMatchObject({ name: "原名很长的书" });
  });

  it("指定份（非 head）→ 导入那份；state 记「导入的份 + 云端 head + 当时云端集合」", async () => {
    configureCloud();
    const dav = stubDav();
    const local = makeLocalBook("指定份的书");
    const zip = makeBackupZip(local.dir);
    const dirName = `指定份的书-${local.id}`;
    const older = backupNameAt("2026-08-01T10:00:00Z");
    const newer = backupNameAt("2026-08-02T10:00:00Z");
    seedCloudBook(dav, dirName, [
      { fileName: older, bytes: zip.bytes },
      { fileName: newer, bytes: zip.bytes },
    ]);
    rmSync(local.dir, { recursive: true, force: true });

    const res = await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName, file_name: older });

    expect(res.status).toBe(200);
    expect(await responseData(res)).toMatchObject({ fileName: older, size: zip.bytes.length });
    expect(readBookState(local.id)).toEqual({
      dirName,
      lastPushedFileName: older,
      lastSeenHeadFileName: newer, // 云端 head ≠ 导入的那份
      lastSyncAt: expect.any(String),
      lastSeenCloudFiles: [older, newer].sort(),
    });
  });

  it("导入后 lastSyncAt 基准取自三文件 mtime（非本地时钟）", async () => {
    // 确定性用例：把本地时钟停在 2020，基准若取 `new Date()` 就会滞后于刚写下的三文件 → 本条红
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    configureCloud();
    const dav = stubDav();
    const local = makeLocalBook("基准书");
    const zip = makeBackupZip(local.dir);
    const dirName = `基准书-${local.id}`;
    seedCloudBook(dav, dirName, [zip]);
    rmSync(local.dir, { recursive: true, force: true });

    expect((await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName })).status).toBe(200);
    const bookDir = importedBookDir("基准书");
    const newestMtime = Math.max(
      ...PROJECT_EXPORT_FILE_NAMES.map((name) => Math.ceil(statSync(join(bookDir, name)).mtimeMs)),
    );
    // 基准早于任一自己刚写下的文件 ⇒ project.json/outline.json 的**严格**比较读成「本机有改动」
    const state = readBookState(local.id);
    expect(Date.parse(state?.lastSyncAt as string)).toBeGreaterThanOrEqual(newestMtime);

    expect((await request("/api/v1/project/open", "POST", { path: bookDir })).status).toBe(200);
    expect((await responseData<{ state: string }>(await request("/api/v1/cloud/status", "GET"))).state).toBe("synced");
  });

  it("目录名解析出的 id 与包内 id 不符 → 400 VALIDATION_ERROR，零残留（防把书写进别人的云端目录）", async () => {
    configureCloud();
    const dav = stubDav();
    const local = makeLocalBook("包内书"); // zip 来源（包内 id）
    const zip = makeBackupZip(local.dir);
    const otherId = generateProjectId(); // 目录名声明的 id（别人的书）
    const dirName = `别人的书-${otherId}`;
    seedCloudBook(dav, dirName, [zip]);
    const booksBefore = readdirSync(join(root, "books"));

    const res = await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName });

    expect(res.status).toBe(400);
    const error = await errorBody(res);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain(otherId); // 两个 id 都写进文案
    expect(error.message).toContain(local.id);
    expect(readdirSync(join(root, "books"))).toEqual(booksBefore); // books/ 无新增
    expect(readBookState(otherId)).toBeNull(); // 无 state ⇒ 之后不会推进别人的云端目录
    expect(dav.calls.every((call) => call.method === "PROPFIND" || call.method === "GET")).toBe(true); // 拒绝前不写云盘
  });

  it("目录名解析不出 id（用户手工命名）→ 仍可导入（无 id 声明，不算冲突）", async () => {
    configureCloud();
    const dav = stubDav();
    const local = makeLocalBook("手工目录里的书");
    const zip = makeBackupZip(local.dir);
    const dirName = "我手工建的目录";
    seedCloudBook(dav, dirName, [zip]);
    rmSync(local.dir, { recursive: true, force: true });

    const res = await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName });

    expect(res.status).toBe(200);
    expect(await responseData(res)).toMatchObject({ id: local.id, name: "手工目录里的书" }); // 书名回退包内名
    expect(readBookState(local.id)?.dirName).toBe(dirName);
  });

  it("本机已有同名但不同 id 的书 → 目录去重；同 id 再导一次 → 409 PROJECT_ALREADY_EXISTS", async () => {
    configureCloud();
    const dav = stubDav();
    makeLocalBook("重名书"); // 本机已有同名书（不同 id）→ 导入目标要走 uniqueBookDir 去重
    const local = makeLocalBook("云里的重名书");
    const zip = makeBackupZip(local.dir);
    const dirName = `重名书-${local.id}`;
    seedCloudBook(dav, dirName, [zip]);
    rmSync(local.dir, { recursive: true, force: true });

    const first = await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName });

    expect(first.status).toBe(200);
    expect(await responseData(first)).toMatchObject({ name: "重名书 (2)" }); // 目录去重（N 从 2 起）
    expect(readProjectFile(importedBookDir("重名书 (2)"))?.id).toBe(local.id);

    const again = await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName });

    expect(again.status).toBe(409);
    expect((await errorBody(again)).code).toBe("PROJECT_ALREADY_EXISTS");
    expect(readdirSync(join(root, "books")).sort()).toEqual(["重名书", "重名书 (2)"]); // 没有第三本
  });

  it("坏包 → 400 VALIDATION_ERROR，books/ 无残留", async () => {
    configureCloud();
    const dav = stubDav();
    const id = generateProjectId();
    const dirName = `坏包-${id}`;
    seedCloudBook(dav, dirName, [
      { fileName: backupNameAt("2026-08-01T10:00:00Z"), bytes: new TextEncoder().encode("not a zip") },
    ]);

    const res = await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName });

    expect(res.status).toBe(400);
    expect((await errorBody(res)).code).toBe("VALIDATION_ERROR");
    expect(existsSync(join(root, "books"))).toBe(false);
    expect(readBookState(id)).toBeNull();
  });

  it("zip 内 data.db 版本过高 → 409 SCHEMA_VERSION_MISMATCH（与 POST /project/import 同一管道）", async () => {
    configureCloud();
    const dav = stubDav();
    const local = makeLocalBook("未来版书");
    const zip = makeBackupZip(local.dir);
    // 合法三文件 + data.db user_version = SCHEMA_VERSION + 1（未来版本）
    const futureDir = join(root, "future");
    mkdirSync(futureDir, { recursive: true });
    const db = openDatabase(join(futureDir, DATA_DB_FILE_NAME));
    setUserVersion(db, SCHEMA_VERSION + 1);
    closeDatabase(db);
    const entries = unzipSync(zip.bytes);
    const futureZip = zipSync({ ...entries, "data.db": readFileSync(join(futureDir, DATA_DB_FILE_NAME)) });
    const dirName = `未来版书-${local.id}`;
    seedCloudBook(dav, dirName, [{ fileName: zip.fileName, bytes: futureZip }]);
    rmSync(local.dir, { recursive: true, force: true });

    const res = await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName });

    expect(res.status).toBe(409);
    expect((await errorBody(res)).code).toBe("SCHEMA_VERSION_MISMATCH");
    expect(existsSync(importedBookDir("未来版书"))).toBe(false);
    expect(readBookState(local.id)).toBeNull();
  });

  it("目录不存在 / 指定的份不存在 → 404 CLOUD_FILE_NOT_FOUND", async () => {
    configureCloud();
    const dav = stubDav();
    const local = makeLocalBook("不存在");
    const zip = makeBackupZip(local.dir);
    const dirName = `不存在-${local.id}`;
    seedCloudBook(dav, dirName, [zip]);

    const noDir = await request("/api/v1/cloud/import-book", "POST", { dir_name: `别的目录-${generateProjectId()}` });
    expect(noDir.status).toBe(404);
    expect((await errorBody(noDir)).code).toBe("CLOUD_FILE_NOT_FOUND");

    const noFile = await request("/api/v1/cloud/import-book", "POST", {
      dir_name: dirName,
      file_name: backupNameAt("2020-01-01T00:00:00Z"),
    });
    expect(noFile.status).toBe(404);
    expect((await errorBody(noFile)).code).toBe("CLOUD_FILE_NOT_FOUND");

    // 目录里一份可解析的备份都没有（缺省 head）→ 同码
    const emptyDir = `空目录-${generateProjectId()}`;
    seedCloudBook(dav, emptyDir, []);
    const noHead = await request("/api/v1/cloud/import-book", "POST", { dir_name: emptyDir });
    expect(noHead.status).toBe(404);
    expect((await errorBody(noHead)).code).toBe("CLOUD_FILE_NOT_FOUND");

    expect(existsSync(join(root, "books"))).toBe(true); // 只有 zip 来源那本，未新建任何目录
    expect(readdirSync(join(root, "books"))).toEqual(["不存在"]);
  });

  it("dirName 含路径分隔符或 `..`、fileName 不在白名单 → 400 VALIDATION_ERROR", async () => {
    configureCloud();
    const dav = stubDav();
    const id = generateProjectId();

    for (const dirName of [`../${id}`, `a/${id}`, "a\\b", "..", ".", ""]) {
      const res = await request("/api/v1/cloud/import-book", "POST", { dir_name: dirName });
      expect(res.status, `dirName=${dirName}`).toBe(400);
      expect((await errorBody(res)).code).toBe("VALIDATION_ERROR");
    }
    const badName = await request("/api/v1/cloud/import-book", "POST", {
      dir_name: `书-${id}`,
      file_name: "不是备份文件名.zip",
    });
    expect(badName.status).toBe(400);
    expect((await errorBody(badName)).code).toBe("VALIDATION_ERROR");
    // 旧 camelCase 字段名（曾错抄契约）→ strict 拒绝（请求体一律 snake_case）
    const legacy = await request("/api/v1/cloud/import-book", "POST", { dirName: `书-${id}` });
    expect(legacy.status).toBe(400);
    expect((await errorBody(legacy)).code).toBe("VALIDATION_ERROR");
    expect(dav.spy).not.toHaveBeenCalled(); // 全部在发起网络请求前拒绝
  });
});
