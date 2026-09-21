// 删书端点测试（卡 23.4）：路径校验 / 云端前置推送（零请求 · 顺序 · 失败中止与 force）/
// 当前书收尾（连接 + currentProject + lastProject）/ delete_remote（成功与 best-effort 失败）/
// 删非当前书不影响当前书的在跑拆解 job。
//
// 契约：docs/api/10-api-project.md §POST /project/delete、docs/design/40-cloud-sync.md §4 / §8.5。
// 云端用**内存版最小 WebDAV**（stub 全局 fetch）：既能断言请求序列与「推送发生在本地删除之前」，
// 又能注入失败（PUT / DELETE 403）。协议本身由 webdav.test.ts / webdav.integration.test.ts 覆盖。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  createDecomposeJob,
  getDecomposeJob,
  readProjectFile,
  updateJobStatus,
} from "@whispering233/ai-editor-db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { initCloudState, readBookState, writeBookState, writeCloudConfig } from "../cloud/state.js";
import { readLastProject } from "../last-project.js";
import { projectRoutes, setProjectRoot } from "./project.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const DAV_BASE = "https://dav.example.com/dav";
/** 客户端实际读写的前缀 = 云盘根 + 工作根 `ai-editor`（createWebdavClient 唯一拼接点） */
const WORK_PATH = `${new URL(DAV_BASE).pathname.replace(/\/+$/, "")}/ai-editor`;

let root: string;

function makeTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "ai-editor-project-delete-"));
}

function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/project", projectRoutes);
  return app;
}

function request(url: string, body?: unknown): Promise<Response> {
  return buildApp().request(url, {
    method: "POST",
    headers: HOST_HEADERS,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

async function responseData<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}

/** 建一本书（走 create 端点，返回书目录）；书目录 = <创作根>/books/<名> */
async function createBook(name: string): Promise<string> {
  const dir = join(root, "books", name);
  expect((await request("/api/v1/project/create", { path: dir })).status).toBe(200);
  return dir;
}

async function openBook(dir: string): Promise<Response> {
  return request("/api/v1/project/open", { path: dir });
}

function bookId(dir: string): string {
  const config = readProjectFile(dir);
  if (config === null) throw new Error(`不是项目: ${dir}`);
  return config.id;
}

function configureCloud(): void {
  writeCloudConfig({ url: DAV_BASE, username: "u@example.com", password: "app-pw" });
}

const EXISTING_BACKUP = "20260801-100000000-手动-测试机-人物0-设定0-章0.zip";

// ============ 内存版最小 WebDAV（只覆盖删书路径用到的动词） ============

interface DavCall {
  method: string;
  path: string;
  /** 该请求发出时本地书目录 / `.backups/` 的状态（断言「先推后删」的顺序） */
  localDirExists: boolean;
  backupCount: number;
  depth?: string;
}

interface FakeDav {
  dirs: Set<string>;
  files: Map<string, Uint8Array>;
  calls: DavCall[];
  failPut: boolean;
  failDelete: boolean;
  spy: ReturnType<typeof vi.fn>;
}

function parentOf(rel: string): string {
  return rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
}

function stubDav(localBookDir: string): FakeDav {
  const dav: FakeDav = { dirs: new Set([""]), files: new Map(), calls: [], failPut: false, failDelete: false, spy: vi.fn() };
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
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let backupCount = 0;
    try {
      backupCount = readdirSync(join(localBookDir, ".backups")).length;
    } catch {
      backupCount = 0;
    }
    dav.calls.push({
      method,
      path: rel,
      localDirExists: existsSync(localBookDir),
      backupCount,
      ...(headers.Depth !== undefined ? { depth: headers.Depth } : {}),
    });

    switch (method) {
      case "PROPFIND": {
        if (rel !== "" && !dav.dirs.has(rel)) return Promise.resolve(new Response(null, { status: 404 }));
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
        if (dav.failPut) return Promise.resolve(new Response(null, { status: 403 }));
        dav.files.set(rel, new Uint8Array(init?.body as Uint8Array));
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      case "MOVE": {
        const bytes = dav.files.get(rel);
        if (bytes === undefined) return Promise.resolve(new Response(null, { status: 404 }));
        dav.files.delete(rel);
        dav.files.set(relOf(headers.Destination ?? ""), bytes);
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      case "DELETE": {
        if (dav.failDelete) return Promise.resolve(new Response(null, { status: 403 }));
        if (dav.files.delete(rel)) return Promise.resolve(new Response(null, { status: 204 }));
        if (dav.dirs.delete(rel)) {
          for (const key of [...dav.files.keys()]) if (key.startsWith(`${rel}/`)) dav.files.delete(key);
          for (const key of [...dav.dirs]) if (key.startsWith(`${rel}/`)) dav.dirs.delete(key);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      default:
        return Promise.resolve(new Response(null, { status: 405 }));
    }
  });
  vi.stubGlobal("fetch", dav.spy);
  return dav;
}

beforeEach(() => {
  root = makeTmpRoot();
  setCurrentProject(null);
  setProjectRoot(root);
  initCloudState(root);
});

afterEach(() => {
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

describe("POST /project/delete —— 无云状态", () => {
  it("未配置云盘 → 直接删目录且零云端请求（响应不带 pushed/remote）", async () => {
    const dir = await createBook("无云书");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    const res = await request("/api/v1/project/delete", { path: dir });

    expect(res.status).toBe(200);
    expect(await responseData(res)).toEqual({ deleted: true, path: dir });
    expect(existsSync(dir)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("云盘已配置但该书无同步记录（从未推过）→ 同样零云端请求", async () => {
    const dir = await createBook("未上云");
    configureCloud();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    const res = await request("/api/v1/project/delete", { path: dir });

    expect(res.status).toBe(200);
    expect(await responseData(res)).toEqual({ deleted: true, path: dir });
    expect(existsSync(dir)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("POST /project/delete —— 云端前置推送", () => {
  it("有同步记录（未打开的书）→ 新备份落地后才 PUT，推送在本地删除之前，云端目录保留", async () => {
    const dir = await createBook("待删");
    configureCloud();
    const id = bookId(dir);
    const dirName = `待删-${id}`;
    writeBookState(id, { dirName });
    const dav = stubDav(dir);

    const res = await request("/api/v1/project/delete", { path: dir });
    const data = await responseData<{ deleted: true; path: string; pushed: { fileName: string } }>(res);

    expect(res.status).toBe(200);
    expect(data.deleted).toBe(true);
    expect(data.path).toBe(dir);
    expect(data.pushed.fileName).toMatch(/\.zip$/);
 // 推送的是**刚生成的那一份**（PUT 的临时名 = `.tmp-<本次备份名>`）
    const put = dav.calls.find((call) => call.method === "PUT");
    expect(put?.path).toBe(`${dirName}/.tmp-${data.pushed.fileName}`);
    expect(put?.backupCount).toBeGreaterThan(0); // 打包先落盘，再上传
    expect(put?.localDirExists).toBe(true); // 推送发生在本地删除之前
    expect(dav.calls.some((call) => call.method === "MOVE")).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(dav.calls.some((call) => call.method === "DELETE")).toBe(false); // 未勾「删云端」→ 原样保留
  });

  it("删除前推送失败 → 不删且回原错误码；force:true 才继续删", async () => {
    const dir = await createBook("推送失败");
    configureCloud();
    const id = bookId(dir);
    writeBookState(id, { dirName: `推送失败-${id}` });
    const dav = stubDav(dir);
    dav.failPut = true;

    const blocked = await request("/api/v1/project/delete", { path: dir });

    expect(blocked.status).toBe(502);
    expect(await errorCode(blocked)).toBe("CLOUD_AUTH_FAILED");
    expect(existsSync(dir)).toBe(true); // 一个字节都没删
    expect(readBookState(id)).not.toBeNull();

    const forced = await request("/api/v1/project/delete", { path: dir, force: true });

    expect(forced.status).toBe(200);
    expect(existsSync(dir)).toBe(false);
    expect(readBookState(id)).not.toBeNull(); // 未勾「删云端」→ 同步状态保留
  });
});

describe("POST /project/delete —— 当前书收尾", () => {
  it("删当前书：关连接 + 清 currentProject + 抹 lastProject（保留同文件其他键），config 回 409", async () => {
    mkdirSync(join(root, ".ai-editor"), { recursive: true });
    writeFileSync(join(root, ".ai-editor", "config.json"), JSON.stringify({ debug: { enabled: true } }), "utf8");
    const dir = await createBook("当前书");
    expect((await openBook(dir)).status).toBe(200);
    expect(readLastProject(root)).toBe(dir); // open 成功即记住（前置条件）
    const id = bookId(dir);
    configureCloud();
    writeBookState(id, { dirName: `当前书-${id}` });
    const dav = stubDav(dir);

    const res = await request("/api/v1/project/delete", { path: dir });
    const data = await responseData<{ pushed?: { fileName: string } }>(res);

    expect(res.status).toBe(200);
    expect(data.pushed?.fileName).toMatch(/\.zip$/); // 当前打开的书走现有连接也推一份
    expect(dav.calls.some((call) => call.method === "PUT")).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(getCurrentProject()).toBeNull();
    expect((await buildApp().request("/api/v1/project/config", { headers: HOST_HEADERS })).status).toBe(409);
    const rootConfig = JSON.parse(readFileSync(join(root, ".ai-editor", "config.json"), "utf8")) as Record<string, unknown>;
    expect(rootConfig.lastProject).toBeUndefined();
    expect(rootConfig.debug).toEqual({ enabled: true }); // 同文件其他键原样保留
  });

  it("删非当前书：当前项目保持打开，其上的在跑拆解 job 不被暂停（零云端请求）", async () => {
    const dirA = await createBook("跑拆解的书");
    const dirB = await createBook("被删的书");
    expect((await openBook(dirA)).status).toBe(200);
    const projectA = getCurrentProject();
    if (projectA === null) throw new Error("open 后应有当前项目");
    const job = createDecomposeJob(projectA.db, {
      scopeStart: 1,
      scopeEnd: 1,
      batchTargetChars: 1000,
      model: null,
      batches: [],
      now: "2026-08-01T10:00:00Z",
    });
    updateJobStatus(projectA.db, job.id, "running", "2026-08-01T10:00:01Z");
    const dirBSpy = stubDav(dirB).spy;

    const res = await request("/api/v1/project/delete", { path: dirB });

    expect(res.status).toBe(200);
    expect(existsSync(dirB)).toBe(false);
    expect(getCurrentProject()).toBe(projectA);
    expect(projectA.db.open).toBe(true);
    expect(getDecomposeJob(projectA.db)?.status).toBe("running"); // 未被 pauseRunningJobs 归一为 paused
    expect((await buildApp().request("/api/v1/project/config", { headers: HOST_HEADERS })).status).toBe(200);
    expect(dirBSpy).not.toHaveBeenCalled();
  });
});

describe("POST /project/delete —— delete_remote（best-effort）", () => {
  it("删除云端目录成功：本地删完后 DELETE 集合（Depth: infinity），并清掉该书 state", async () => {
    const dir = await createBook("删云端");
    configureCloud();
    const id = bookId(dir);
    const dirName = `删云端-${id}`;
    writeBookState(id, { dirName, lastPushedFileName: EXISTING_BACKUP });
    const dav = stubDav(dir);
    dav.dirs.add(dirName);
    dav.files.set(`${dirName}/${EXISTING_BACKUP}`, new Uint8Array([1]));

    const res = await request("/api/v1/project/delete", { path: dir, delete_remote: true });
    const data = await responseData<{ remoteDeleted?: true; remoteError?: unknown }>(res);

    expect(res.status).toBe(200);
    expect(data.remoteDeleted).toBe(true);
    expect(data.remoteError).toBeUndefined();
    const del = dav.calls.find((call) => call.method === "DELETE");
    expect(del?.path).toBe(dirName); // 只认 state 记录的目录名，不猜
    expect(del?.depth).toBe("infinity");
    expect(del?.localDirExists).toBe(false); // 云端删除在本地删除之后
    expect(dav.dirs.has(dirName)).toBe(false);
    expect(existsSync(dir)).toBe(false);
    expect(readBookState(id)).toBeNull();
  });

  it("云端删除失败：本地已删（200 + remoteError），state 保留可重试", async () => {
    const dir = await createBook("云端删不掉");
    configureCloud();
    const id = bookId(dir);
    const dirName = `云端删不掉-${id}`;
    writeBookState(id, { dirName, lastPushedFileName: EXISTING_BACKUP });
    const dav = stubDav(dir);
    dav.dirs.add(dirName);
    dav.files.set(`${dirName}/${EXISTING_BACKUP}`, new Uint8Array([1]));
    dav.failDelete = true;

    const res = await request("/api/v1/project/delete", { path: dir, delete_remote: true });
    const data = await responseData<{ deleted: true; remoteDeleted?: true; remoteError: { code: string } }>(res);

    expect(res.status).toBe(200);
    expect(data.deleted).toBe(true);
    expect(data.remoteDeleted).toBeUndefined();
    expect(data.remoteError.code).toBe("CLOUD_AUTH_FAILED");
    expect(existsSync(dir)).toBe(false); // 本地已删的结果不回退
    expect(readBookState(id)?.dirName).toBe(dirName); // 云端未删 → state 不清理
  });

  it("delete_remote 但该书无云端目录记录 → 本地删完回 remoteError（不猜目录名）", async () => {
    const dir = await createBook("无目录记录");
    configureCloud();
    const id = bookId(dir);
    writeBookState(id, {}); // 有 state 但没 dirName（存量形态）
    const dav = stubDav(dir);

    const res = await request("/api/v1/project/delete", { path: dir, delete_remote: true });
    const data = await responseData<{ remoteError: { code: string } }>(res);

    expect(res.status).toBe(200);
    expect(data.remoteError.code).toBe("CLOUD_FILE_NOT_FOUND");
    expect(dav.calls.some((call) => call.method === "DELETE")).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("POST /project/delete —— 路径与入参校验", () => {
  it("相对路径 / books 之外 / 缺 project.json / 符号链接 / 重复删除 → 400 INVALID_PROJECT_PATH", async () => {
    const dir = await createBook("合法书");

 // 相对路径（resolveProjectDir 拒绝歧义输入）
    expect(await errorCode(await request("/api/v1/project/delete", { path: "books/合法书" }))).toBe("INVALID_PROJECT_PATH");
 // books/ 之外的项目目录（创作根下的 outside/）
    const outside = join(root, "outside");
    expect((await request("/api/v1/project/create", { path: outside })).status).toBe(200);
    const outRes = await request("/api/v1/project/delete", { path: outside });
    expect(outRes.status).toBe(400);
    expect(await errorCode(outRes)).toBe("INVALID_PROJECT_PATH");
    expect(existsSync(outside)).toBe(true);
 // `..` 折叠后落在 books/ 之外（逃逸形态：resolve 先行，不拿原始串拼路径）
    const escape = await request("/api/v1/project/delete", { path: join(root, "books", "合法书", "..", "..", "outside") });
    expect(escape.status).toBe(400);
    expect(await errorCode(escape)).toBe("INVALID_PROJECT_PATH");
 // books/ 下但没有 project.json（草稿目录）
    const draft = join(root, "books", "草稿");
    mkdirSync(draft, { recursive: true });
    const draftRes = await request("/api/v1/project/delete", { path: draft });
    expect(draftRes.status).toBe(400);
    expect(await errorCode(draftRes)).toBe("INVALID_PROJECT_PATH");
 // books/ 下的符号链接（realpath 不一致 → 拒绝，不跟随）
    const link = join(root, "books", "链接书");
    symlinkSync(outside, link);
    expect(await errorCode(await request("/api/v1/project/delete", { path: link }))).toBe("INVALID_PROJECT_PATH");

 // 正常删除一次后重复删除 → 目录已不存在 → 400
    expect((await request("/api/v1/project/delete", { path: dir })).status).toBe(200);
    const again = await request("/api/v1/project/delete", { path: dir });
    expect(again.status).toBe(400);
    expect(await errorCode(again)).toBe("INVALID_PROJECT_PATH");
  });

  it("缺 path / force 非布尔 / 未知字段 → 400 VALIDATION_ERROR（strict schema）", async () => {
    const dir = await createBook("入参校验");
    const cases = [{}, { path: dir, force: "yes" }, { path: dir, deleteRemote: true }];
    for (const body of cases) {
      const res = await request("/api/v1/project/delete", body);
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("VALIDATION_ERROR");
    }
    expect(existsSync(dir)).toBe(true); // 校验失败不触碰目录
 // 顺带确认：未被校验拦下的正常请求能删（同一目录）
    expect((await request("/api/v1/project/delete", { path: dir })).status).toBe(200);
  });
});
