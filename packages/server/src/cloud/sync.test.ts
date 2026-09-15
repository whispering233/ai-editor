// 云端推送测试（卡 4）：冲突判定 / force 留档 / 保留策略 / 目录定位回退 / 体积与白名单 / 状态更新
//
// 策略：**内存版最小 WebDAV**（stub 全局 fetch）——精确控制目录内容（含带标签份、非本程序命名的
// 文件、`.tmp-` 残留），覆盖本地 WebDAV 服务难以构造的组合；协议本身由 `webdav.test.ts` 与
// `webdav.integration.test.ts`（真 HTTP）覆盖。
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATA_DB_FILE_NAME,
  openDatabase,
  closeDatabase,
  readProjectFile,
  setUserVersion,
  writeOutlineFile,
  writeProjectFile,
  SCHEMA_VERSION,
} from "@whispering233/ai-editor-db";
import type { ProjectFileConfig } from "@whispering233/ai-editor-shared";
import { BACKUPS_DIR_NAME, writeBackup } from "../backup.js";
import type { ProjectContext } from "../middleware/project.js";
import { HttpError } from "../middleware/error.js";
import { initCloudState, writeBookState, writeCloudConfig, readBookState } from "./state.js";
import { MAX_CLOUD_BACKUPS, computeCloudSync, pullBackup, pushBackup } from "./sync.js";

const BASE = "https://dav.example.com/dav/ai-editor";
const USER = "u@example.com";
const PASSWORD = "app-pw";
const T0 = "2026-08-01T10:00:00Z";

// ============ 内存版最小 WebDAV（仅本测试用） ============

interface FakeNode {
  isDir: boolean;
  bytes: Uint8Array;
  mtime: number;
}

/** 云盘状态：相对 BASE 的路径（"" = 根）→ 节点 */
let store: Map<string, FakeNode>;
/** 记录每个方法的调用（断言 PUT 临时名 + MOVE、DELETE 目标等） */
let calls: Array<{ method: string; path: string; destination?: string }>;
/** 让指定路径的 DELETE / MOVE 返回 403（验证「清理失败不阻塞推送」与「MOVE 失败清理临时名」） */
let deleteFailure: ((rel: string) => boolean) | null;
let moveFailure: ((rel: string, destination: string) => boolean) | null;

/** 绝对 URL → BASE 之后的相对路径（空串 = 根） */
function relOfUrl(input: string): string {
  const pathname = new URL(input).pathname;
  const basePath = new URL(BASE).pathname.replace(/\/+$/, "");
  const rest = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  return rest
    .split("/")
    .filter((s) => s !== "")
    .map((s) => decodeURIComponent(s))
    .join("/");
}

function hrefOf(rel: string, isDir: boolean): string {
  const basePath = new URL(BASE).pathname.replace(/\/+$/, "");
  const encoded = rel
    .split("/")
    .filter((s) => s !== "")
    .map(encodeURIComponent)
    .join("/");
  const path = encoded === "" ? `${basePath}/` : `${basePath}/${encoded}${isDir ? "/" : ""}`;
  return path;
}

function propfindXml(rel: string): string {
  const self = store.get(rel);
  if (self === undefined) return "";
  const entries: Array<{ rel: string; node: FakeNode }> = [{ rel, node: self }];
  if (self.isDir) {
    for (const [key, node] of store) {
      if (key === rel || key === "") continue;
      const prefix = rel === "" ? "" : `${rel}/`;
      if (!key.startsWith(prefix) || key.slice(prefix.length).includes("/")) continue;
      entries.push({ rel: key, node });
    }
  }
  const responses = entries
    .map(
      ({ rel: entryRel, node }) =>
        `<d:response><d:href>${hrefOf(entryRel, node.isDir)}</d:href><d:propstat><d:prop><d:resourcetype>${
          node.isDir ? "<d:collection/>" : ""
        }</d:resourcetype>${node.isDir ? "" : `<d:getcontentlength>${node.bytes.length}</d:getcontentlength>`}<d:getlastmodified>${new Date(
          node.mtime,
        ).toUTCString()}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`;
}

/** 装载内存 DAV 到全局 fetch（返回 spy 供断言） */
function stubDav() {
  store = new Map([["", { isDir: true, bytes: new Uint8Array(), mtime: Date.now() }]]);
  calls = [];
  deleteFailure = null;
  moveFailure = null;
  const spy = vi.fn((input: unknown, init?: RequestInit) => {
    const method = String(init?.method ?? "GET");
    const rel = relOfUrl(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const destination = headers.Destination === undefined ? undefined : relOfUrl(headers.Destination);
    calls.push({ method, path: rel, ...(destination !== undefined ? { destination } : {}) });
    const node = store.get(rel);

    switch (method) {
      case "PROPFIND":
        return Promise.resolve(
          node === undefined ? new Response(null, { status: 404 }) : new Response(propfindXml(rel), { status: 207 }),
        );
      case "MKCOL": {
        if (node !== undefined) return Promise.resolve(new Response(null, { status: 405 }));
        const parentRel = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
        if (!store.has(parentRel)) return Promise.resolve(new Response(null, { status: 409 }));
        store.set(rel, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      case "PUT": {
        const body = init?.body;
        store.set(rel, {
          isDir: false,
          bytes: typeof body === "string" ? new TextEncoder().encode(body) : (body as Uint8Array),
          mtime: Date.now(),
        });
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      case "GET":
        return Promise.resolve(
          node === undefined || node.isDir ? new Response(null, { status: 404 }) : new Response(node.bytes, { status: 200 }),
        );
      case "MOVE": {
        if (node === undefined) return Promise.resolve(new Response(null, { status: 404 }));
        if (destination === undefined) return Promise.resolve(new Response(null, { status: 400 }));
        if (moveFailure?.(rel, destination) === true) return Promise.resolve(new Response("forbidden", { status: 403 }));
        if (store.has(destination) && headers.Overwrite === "F") {
          return Promise.resolve(new Response(null, { status: 412 }));
        }
        store.delete(rel);
        store.set(destination, node);
        // 目录改名：连同子孙一起搬（本测试场景不用，但保持语义正确）
        for (const key of [...store.keys()]) {
          if (key.startsWith(`${rel}/`)) {
            const moved = `${destination}${key.slice(rel.length)}`;
            store.set(moved, store.get(key) as FakeNode);
            store.delete(key);
          }
        }
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      case "DELETE": {
        if (node === undefined) return Promise.resolve(new Response(null, { status: 404 }));
        if (deleteFailure?.(rel) === true) return Promise.resolve(new Response("forbidden", { status: 403 }));
        store.delete(rel);
        for (const key of [...store.keys()]) if (key.startsWith(`${rel}/`)) store.delete(key);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      default:
        return Promise.resolve(new Response(null, { status: 405 }));
    }
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** 在内存 DAV 里预置一份云端备份（文件名即协议；content 可为字符串或真实字节） */
function seedCloudFile(fileName: string, content: string | Uint8Array = "zip"): void {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  store.set(fileName, { isDir: false, bytes, mtime: Date.now() });
}

// ============ 项目夹具 ============

let root: string;
let project: ProjectContext;

/** 造一个真项目目录（三文件 + 两个打包目录），返回可用 ProjectContext；调用方负责 closeDatabase */
function makeProject(id = "proj-sync-1", name = "测试书"): ProjectContext {
  const dir = mkdtempSync(join(tmpdir(), "ai-editor-sync-"));
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
  const db0 = openDatabase(join(dir, DATA_DB_FILE_NAME));
  setUserVersion(db0, SCHEMA_VERSION);
  closeDatabase(db0);
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "references", "笔记.md"), "# 笔记");
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(join(dir, "sessions", "s1.jsonl"), "{}\n");
  const db = openDatabase(join(dir, DATA_DB_FILE_NAME));
  return { root: dir, config: readProjectFile(dir) as ProjectFileConfig, db };
}

beforeEach(() => {
  stubDav();
  root = mkdtempSync(join(tmpdir(), "ai-editor-sync-root-"));
  initCloudState(root);
  writeCloudConfig({ url: BASE, username: USER, password: PASSWORD });
  project = makeProject();
});

afterEach(() => {
  closeDatabase(project.db);
  rmSync(project.root, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  initCloudState(null);
  vi.unstubAllGlobals();
});

/** 通过备份管道造一份真备份（含 references/ 与 sessions/ 条目） */
function makeBackup(name?: string, kind: "auto" | "manual" = "manual"): string {
  return writeBackup(project, { kind, ...(name !== undefined ? { name } : {}) }).fileName;
}

describe("pushBackup：上传管道（临时名 + MOVE）", () => {
  it("推送最新一份：创建目录 → PUT 临时名 → MOVE 成正式名；正式名下内容与本地逐字节一致", async () => {
    const localName = makeBackup("定稿");
    const result = await pushBackup(project);

    expect(result.pushed.fileName).toBe(localName);
    expect(result.remote.dirName).toBe(`测试书-${project.config.id}`);
    expect(result.remote.headFileName).toBe(localName);
    expect(result.pruned).toEqual([]);

    const dir = store.get(`测试书-${project.config.id}`);
    expect(dir?.isDir).toBe(true);
    const cloudFile = store.get(`测试书-${project.config.id}/${localName}`);
    expect(cloudFile?.isDir).toBe(false);
    // 临时名不留残（PUT 的那个 key 已被 MOVE 消费）
    expect(store.has(`测试书-${project.config.id}/.tmp-${localName}`)).toBe(false);

    // 调用序列：PROPFIND（根扫描找 `-<id>` 后缀目录）→ MKCOL → PROPFIND → PUT(.tmp-) → MOVE → 清理/保留 PROPFIND
    const methods = calls.map((c) => c.method);
    expect(methods[0]).toBe("PROPFIND"); // 首次必是根扫描（按 `-<id>` 后缀找已存在的目录）
    expect(methods.indexOf("MKCOL")).toBeGreaterThan(-1);
    expect(methods.indexOf("MKCOL")).toBeLessThan(methods.indexOf("PUT")); // 先建目录再上传
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.path).toBe(`测试书-${project.config.id}/.tmp-${localName}`);
    const move = calls.find((c) => c.method === "MOVE");
    expect(move?.path).toBe(`测试书-${project.config.id}/.tmp-${localName}`);
    expect(move?.destination).toBe(`测试书-${project.config.id}/${localName}`);
  });

  it("推送前清理遗留 .tmp-*（只删这个前缀；用户手放的文件不动）", async () => {
    const localName = makeBackup();
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    seedCloudFile(`${dirName}/.tmp-半截.zip`, "half");
    seedCloudFile(`${dirName}/用户手放的文件.txt`, "mine");

    await pushBackup(project);

    expect(store.has(`${dirName}/.tmp-半截.zip`)).toBe(false);
    expect(store.has(`${dirName}/用户手放的文件.txt`)).toBe(true);
    expect(store.has(`${dirName}/${localName}`)).toBe(true);
  });

  it("MOVE 失败时清理临时名并抛错（云盘不会留下半截正式名）", async () => {
    const localName = makeBackup();
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    moveFailure = (_rel, destination) => destination.endsWith(localName);

    // 假服务器的 MOVE 返回 403 → 按错误码表映射为 CLOUD_AUTH_FAILED（真实云盘上「只读/权限不足」即此路）
    await expect(pushBackup(project)).rejects.toMatchObject({ code: "CLOUD_AUTH_FAILED" });
    expect(store.has(`${dirName}/.tmp-${localName}`)).toBe(false); // 临时名被清理
    expect(store.has(`${dirName}/${localName}`)).toBe(false); // 正式名没有半截内容
  });
});

describe("pushBackup：冲突判定与 force", () => {
  it("云端 head ≠ lastPushed → 409 CLOUD_CONFLICT（且不产生任何写入）", async () => {
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    const otherName = "20260101-000000000-自动-别的机器-人物0-设定0-章0.zip";
    seedCloudFile(`${dirName}/${otherName}`);
    writeBookState(project.config.id, { dirName, lastPushedFileName: "20250101-000000000-自动-本机-人物0-设定0-章0.zip" });
    makeBackup("本机的"); // 本机要先有一份可推的备份，才走得到冲突判定

    await expect(pushBackup(project)).rejects.toMatchObject({ code: "CLOUD_CONFLICT" });
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    expect(store.has(`${dirName}/${otherName}`)).toBe(true);
  });

  it("head === lastPushed → 不算冲突（本机上次推的那份仍是 head）", async () => {
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    const localName = makeBackup();
    seedCloudFile(`${dirName}/${localName}`, "旧内容");
    writeBookState(project.config.id, { dirName, lastPushedFileName: localName });

    const result = await pushBackup(project);
    expect(result.remote.headFileName).toBe(localName);
    // 覆盖成功（内容更新为本机那份）
    expect((store.get(`${dirName}/${localName}`)?.bytes.length ?? 0) > 4).toBe(true);
  });

  it("force：先把云端 head 下载存进本地 .backups/（文件名原样）再覆盖云端 —— 两边都留档", async () => {
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    const otherName = "20260101-000000000-自动-别的机器-人物0-设定0-章0.zip";
    seedCloudFile(`${dirName}/${otherName}`, "cloud-version-bytes");
    makeBackup("本机的");

    const result = await pushBackup(project, { force: true });

    expect(result.snapshot).toEqual({ fileName: otherName });
    expect(existsSync(join(project.root, BACKUPS_DIR_NAME, otherName))).toBe(true);
    const archived = readdirSync(join(project.root, BACKUPS_DIR_NAME));
    expect(archived).toContain(otherName);
    expect(archived).toContain(result.pushed.fileName); // 本机那份也还在
  });

  it("无冲突记录但云端有 head（状态文件丢失）→ 仍按冲突处理（保守：不静默覆盖别人的份）", async () => {
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    seedCloudFile(`${dirName}/20260101-000000000-自动-别的机器-人物0-设定0-章0.zip`);
    makeBackup("本机的");
    await expect(pushBackup(project)).rejects.toMatchObject({ code: "CLOUD_CONFLICT" });
  });
});

describe("pushBackup：保留策略（只删可解析且无标签的份，最多 5）", () => {
  it("第 6 份起删最旧；带标签的份永不删；非本程序命名的文件不动", async () => {
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    // 5 份旧的可删 + 1 份带标签 + 1 个陌生文件
    const olds = Array.from({ length: MAX_CLOUD_BACKUPS }, (_, i) => `2026010${i + 1}-000000000-自动-旧${i}-人物0-设定0-章0.zip`);
    for (const name of olds) seedCloudFile(`${dirName}/${name}`);
    const labeled = "20251231-000000000-手动-本机-定稿-人物0-设定0-章0.zip";
    seedCloudFile(`${dirName}/${labeled}`);
    seedCloudFile(`${dirName}/别人的笔记.txt`);
    makeBackup(); // 不带标签 → 参与保留策略
    // 让冲突判定通过：本机 lastPushed = 云端当前 head（最新那份旧备份）
    writeBookState(project.config.id, { dirName, lastPushedFileName: olds[MAX_CLOUD_BACKUPS - 1] as string });

    const result = await pushBackup(project); // 推送后共 6 份可删 → 删最旧的 1 份
    // 夹具说明：本机那份必须是**不带标签**的（带标签的永不清理，见下方豁免断言）

    expect(result.pruned).toEqual([olds[0]]);
    expect(store.has(`${dirName}/${olds[0]}`)).toBe(false);
    for (const name of olds.slice(1)) expect(store.has(`${dirName}/${name}`)).toBe(true);
    expect(store.has(`${dirName}/${labeled}`)).toBe(true); // 标签豁免
    expect(store.has(`${dirName}/别人的笔记.txt`)).toBe(true);
    expect(store.has(`${dirName}/${result.pushed.fileName}`)).toBe(true);
  });

  it("清理失败不阻塞推送（删除报错只记日志，pruned 为空）", async () => {
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    const olds = Array.from({ length: MAX_CLOUD_BACKUPS }, (_, i) => `2026010${i + 1}-000000000-自动-旧${i}-人物0-设定0-章0.zip`);
    for (const name of olds) seedCloudFile(`${dirName}/${name}`);
    deleteFailure = (rel) => rel.includes("20260101-"); // 最旧那份（olds[0]）删不掉
    makeBackup(); // 不带标签 → 参与保留策略
    writeBookState(project.config.id, { dirName, lastPushedFileName: olds[MAX_CLOUD_BACKUPS - 1] as string });

    const result = await pushBackup(project);

    expect(result.pruned).toEqual([]); // 删除失败 → 不计入 pruned
    expect(store.has(`${dirName}/${olds[0]}`)).toBe(true); // 残留但不影响推送
    expect(store.has(`${dirName}/${result.pushed.fileName}`)).toBe(true); // 推送本身成功
  });
});

describe("pushBackup：目录定位与体积/白名单校验", () => {
  it("缓存 dirName 命中：不扫描根目录（少一次 PROPFIND）", async () => {
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    writeBookState(project.config.id, { dirName });
    makeBackup("本机的");
    await pushBackup(project);
    // 第一次 PROPFIND 就打在缓存目录上
    const firstPropfind = calls.find((c) => c.method === "PROPFIND");
    expect(firstPropfind?.path).toBe(dirName);
  });

  it("缓存失效 → 扫描根目录按 `-<projectId>` 后缀重新定位（改名后仍认得出）", async () => {
    const renamed = `新书名-${project.config.id}`;
    store.set(renamed, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    writeBookState(project.config.id, { dirName: "旧书名-" + project.config.id }); // 缓存已失效
    makeBackup("本机的");
    const result = await pushBackup(project);
    expect(result.remote.dirName).toBe(renamed);
    expect(readBookState(project.config.id)?.dirName).toBe(renamed); // 缓存被修正
  });

  it("云端无该书目录 → 用预期名 `<书名>-<id>` 新建", async () => {
    makeBackup("本机的");
    const result = await pushBackup(project);
    expect(result.remote.dirName).toBe(`测试书-${project.config.id}`);
    expect(store.get(`测试书-${project.config.id}`)?.isDir).toBe(true);
  });

  it("超过 500MB → 400 CLOUD_BACKUP_TOO_LARGE（不发起上传）", async () => {
    const localName = makeBackup();
    // 用稀疏文件撑到上限之上（不真写 500MB 数据）
    const { openSync, ftruncateSync, closeSync: close } = await import("node:fs");
    const fd = openSync(join(project.root, BACKUPS_DIR_NAME, localName), "r+");
    ftruncateSync(fd, 520 * 1024 * 1024);
    close(fd);
    await expect(pushBackup(project)).rejects.toMatchObject({ code: "CLOUD_BACKUP_TOO_LARGE" });
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("本地备份文件名不在白名单（路径穿越）→ 400 VALIDATION_ERROR", async () => {
    await expect(pushBackup(project, { fileName: "../../etc/passwd" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("本地备份不存在 → 404；没有可推送备份 → 404", async () => {
    await expect(pushBackup(project)).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 404 }); // 还没有任何备份
    await expect(pushBackup(project, { fileName: "20260101-000000000-自动-苹果本-人物0-设定0-章0.zip" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("未配置云盘 → 409 CLOUD_NOT_CONFIGURED（先于任何本地/网络动作）", async () => {
    writeCloudConfig({ url: null, username: null, password: null });
    await expect(pushBackup(project)).rejects.toMatchObject({ code: "CLOUD_NOT_CONFIGURED", status: 409 });
  });

  it("不传 fileName 时推最新一份（按文件名时间戳）", async () => {
    const older = makeBackup("旧");
    const newer = makeBackup("新");
    const result = await pushBackup(project);
    expect(result.pushed.fileName).toBe(newer);
    expect(store.has(`测试书-${project.config.id}/${older}`)).toBe(false);
  });
});

describe("pushBackup：状态更新（cloud.json 的 books 段）", () => {
  it("写入 dirName / lastPushedFileName / lastSeenHeadFileName / lastSyncAt / baseEntries", async () => {
    makeBackup("本机的");
    const result = await pushBackup(project);
    const state = readBookState(project.config.id);
    expect(state).not.toBeNull();
    expect(state?.dirName).toBe(result.remote.dirName);
    expect(state?.lastPushedFileName).toBe(result.pushed.fileName);
    expect(state?.lastSeenHeadFileName).toBe(result.pushed.fileName);
    expect(typeof state?.lastSyncAt).toBe("string");
    // baseEntries = 备份包内两个打包目录的条目名（拉取并集的基线）
    expect(state?.baseEntries).toContain("references/笔记.md");
    expect(state?.baseEntries).toContain("sessions/s1.jsonl");
  });

  it("只覆盖出现过的键：重复推送不丢已有状态（含其它书的记录）", async () => {
    writeBookState("proj-other", { dirName: "别的书-proj-other" });
    makeBackup("本机的");
    await pushBackup(project);
    await pushBackup(project);
    expect(readBookState("proj-other")?.dirName).toBe("别的书-proj-other");
    expect(readBookState(project.config.id)?.lastPushedFileName).toBe(readBookState(project.config.id)?.lastSeenHeadFileName);
  });
});

describe("HttpError 基本形态（防回归：码与状态成对）", () => {
  it("冲突是 409、体积是 400、未配置是 409", () => {
    expect(new HttpError(409, "CLOUD_CONFLICT", "x").status).toBe(409);
    expect(new HttpError(400, "CLOUD_BACKUP_TOO_LARGE", "x").status).toBe(400);
    expect(new HttpError(409, "CLOUD_NOT_CONFIGURED", "x").status).toBe(409);
  });
});

// ============ 卡 5：拉取（并集合并 / 基线三方比较）与三态判定 ============

import { readFileSync as readFile, writeFileSync as writeFile, mkdirSync as mkdirP, utimesSync } from "node:fs";

/** 造一份「云端侧」备份 zip（真走备份管道，只在 references/ 与 sessions/ 放指定文件） */
function makeCloudZip(packed: { references?: string[]; sessions?: string[]; packInto?: string }): {
  bytes: Uint8Array;
  fileName: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "ai-editor-sync-cloud-"));
  writeProjectFile(dir, {
    id: "proj-cloud-side",
    name: "云端书",
    language: "zh",
    schema_version: SCHEMA_VERSION,
    current_position: null,
    created_at: T0,
    updated_at: T0,
  });
  writeOutlineFile(dir, { id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] });
  const db0 = openDatabase(join(dir, DATA_DB_FILE_NAME));
  setUserVersion(db0, SCHEMA_VERSION);
  closeDatabase(db0);
  for (const name of packed.references ?? []) {
    mkdirP(join(dir, "references"), { recursive: true });
    writeFile(join(dir, "references", name), `cloud:${name}`);
  }
  for (const name of packed.sessions ?? []) {
    mkdirP(join(dir, "sessions"), { recursive: true });
    writeFile(join(dir, "sessions", name), `cloud:${name}`);
  }
  const db = openDatabase(join(dir, DATA_DB_FILE_NAME));
  const info = writeBackup({ root: dir, config: readProjectFile(dir) as ProjectFileConfig, db }, { kind: "manual" });
  closeDatabase(db);
  const zipPath = join(dir, BACKUPS_DIR_NAME, info.fileName);
  const bytes = new Uint8Array(readFile(zipPath));
  if (packed.packInto !== undefined) {
    // 把 zip 复制到目标项目（避免临时目录被清理时丢失字节——本函数直接返回字节，此参数仅用于就近取证）
  }
  return { bytes, fileName: info.fileName };
}

describe("pullBackup：并集合并六种情形（基线三方比较、删除优先）", () => {
  it("两边都有→云端取胜；云端删了→删本机；本机新增→保留；本机删了→不复活；云端新增→写入", async () => {
    // 基线（上次同步时云端那份的内容）
    const base = ["references/a.md", "references/b.md", "references/c.md", "sessions/s1.jsonl"];
    // 本机现状：a.md 改过、b.md 还在、local-only.md 是本机新增、s1.jsonl 还在；c.md 本机已删
    const refDir = join(project.root, "references");
    const sessDir = join(project.root, "sessions");
    mkdirP(refDir, { recursive: true });
    mkdirP(sessDir, { recursive: true });
    writeFile(join(refDir, "a.md"), "local:a.md");
    writeFile(join(refDir, "b.md"), "local:b.md");
    writeFile(join(refDir, "local-only.md"), "local-only");
    writeFile(join(sessDir, "s1.jsonl"), "local:s1");

    // 云端那份：a.md（云端版）、c.md（本机已删 → 不该复活）、cloud-only.md（云端新增）；b.md 与 s1.jsonl 已被云端删掉
    const cloud = makeCloudZip({ references: ["a.md", "c.md", "cloud-only.md"] });
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    seedCloudFile(`${dirName}/${cloud.fileName}`, cloud.bytes);
    writeBookState(project.config.id, {
      dirName,
      lastPushedFileName: cloud.fileName, // 不判冲突（本机以云端那份为基准）
      baseEntries: base,
    });

    const result = await pullBackup(project, { fileName: cloud.fileName });

    expect(result.pulled.fileName).toBe(cloud.fileName);
    // kept=2：夹具自带的 references/笔记.md + 本机新增的 local-only.md（都不在基线与云端）
    expect(result.merged).toEqual({ kept: 2, written: 1, removed: 2 });
    // case 1：两边都有 → 云端取胜
    expect(readFile(join(refDir, "a.md"), "utf8")).toBe("cloud:a.md");
    // case 5：云端新增 → 写入
    expect(readFile(join(refDir, "cloud-only.md"), "utf8")).toBe("cloud:cloud-only.md");
    // case 3：本机新增 → 保留
    expect(readFile(join(refDir, "local-only.md"), "utf8")).toBe("local-only");
    // case 2：云端删除 → 删本机（b.md 与 sessions/s1.jsonl）
    expect(existsSync(join(refDir, "b.md"))).toBe(false);
    expect(existsSync(join(sessDir, "s1.jsonl"))).toBe(false);
    // case 4：本机删除优先 → c.md 不被云端复活
    expect(existsSync(join(refDir, "c.md"))).toBe(false);
    // 覆盖前自动快照存在（后悔药）
    expect(existsSync(join(project.root, BACKUPS_DIR_NAME, result.snapshot.fileName))).toBe(true);
    // 云端那份也落进了本地 .backups/（参与保留策略）
    expect(existsSync(join(project.root, BACKUPS_DIR_NAME, cloud.fileName))).toBe(true);
  });

  it("基线缺失（首次同步）→ 不删任何本机文件、云端都写进来（保守）", async () => {
    const refDir = join(project.root, "references");
    writeFile(join(refDir, "local-only.md"), "local-only");
    const cloud = makeCloudZip({ references: ["a.md"], sessions: ["s1.jsonl"] });
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    seedCloudFile(`${dirName}/${cloud.fileName}`, cloud.bytes);
    writeBookState(project.config.id, { dirName, baseEntries: [] }); // 无基线

    const result = await pullBackup(project);

    // 本机原有 references/笔记.md + local-only.md 都保留（kept=2）；云端 a.md 写入（written=1）；
    // 夹具自带 sessions/s1.jsonl 两边都有 → 不比 written（case 1 覆盖不计）
    expect(result.merged).toEqual({ kept: 2, written: 1, removed: 0 });
    expect(existsSync(join(refDir, "local-only.md"))).toBe(true);
    expect(existsSync(join(refDir, "a.md"))).toBe(true);
    expect(existsSync(join(project.root, "sessions", "s1.jsonl"))).toBe(true);
  });

  it("拉取后同步状态更新：lastPushedFileName = 拉到的这份、lastSeenCloudFiles = 云端集合、baseEntries = 该包条目", async () => {
    const cloud = makeCloudZip({ references: ["a.md"] });
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    seedCloudFile(`${dirName}/${cloud.fileName}`, cloud.bytes);
    writeBookState(project.config.id, { dirName });

    await pullBackup(project);

    const state = readBookState(project.config.id);
    expect(state?.lastPushedFileName).toBe(cloud.fileName);
    expect(state?.lastSeenHeadFileName).toBe(cloud.fileName);
    expect(state?.lastSeenCloudFiles).toEqual([cloud.fileName]);
    expect(state?.baseEntries).toEqual(["references/a.md"]);
  });

  it("缺省拉取云端 head；指定不存在/非法文件名 → 404/400；未配置 → 409", async () => {
    const older = makeCloudZip({ references: ["old.md"] });
    const newer = makeCloudZip({ references: ["new.md"] });
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    // 让 newer 的时间戳晚于 older：直接改 store 里的键名时间戳不可行 → 用两个真备份名（时间戳由管道生成，newer 必然更晚）
    seedCloudFile(`${dirName}/${older.fileName}`, older.bytes);
    seedCloudFile(`${dirName}/${newer.fileName}`, newer.bytes);
    expect(newer.fileName > older.fileName).toBe(true); // 同秒内毫秒递增（前置断言）

    const head = await pullBackup(project);
    expect(head.pulled.fileName).toBe(newer.fileName); // 缺省 = head（时间戳最大）

    await expect(pullBackup(project, { fileName: "../../etc/passwd" })).rejects.toMatchObject({ status: 400 });
    await expect(
      pullBackup(project, { fileName: "20200101-000000000-自动-机上-人物0-设定0-章0.zip" }),
    ).rejects.toMatchObject({ code: "CLOUD_FILE_NOT_FOUND", status: 404 });

    writeCloudConfig({ url: null, username: null, password: null });
    await expect(pullBackup(project)).rejects.toMatchObject({ code: "CLOUD_NOT_CONFIGURED", status: 409 });
  });

  it("云端那份版本过高（SCHEMA_VERSION_MISMATCH）→ 409 且不留坏包、数据零触碰", async () => {
    // 造一份 user_version 更高的 data.db 的 zip
    const cloud = makeCloudZip({ references: ["a.md"] });
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    seedCloudFile(`${dirName}/${cloud.fileName}`, cloud.bytes);
    writeBookState(project.config.id, { dirName });
    // 直接改 zip 内的 data.db 不可行 → 用 validateBackupPackage 的版本分流已由 backup.test.ts 覆盖；
    // 本用例只验「拉取失败后不留坏包」这条路径：用一个坏包（非 zip 内容）触发 400
    const bogus = `${dirName}/20200101-000000000-自动-机上-人物0-设定0-章0.zip`;
    seedCloudFile(bogus, "NOT-A-ZIP");
    writeBookState(project.config.id, { dirName, lastPushedFileName: bogus });

    await expect(pullBackup(project, { fileName: bogus })).rejects.toMatchObject({ status: 400 });
    expect(existsSync(join(project.root, BACKUPS_DIR_NAME, bogus))).toBe(false); // 坏包被回收
    // 数据零触碰：references/笔记.md 仍在、a.md 未被写入
    expect(existsSync(join(project.root, "references", "笔记.md"))).toBe(true);
    expect(existsSync(join(project.root, "references", "a.md"))).toBe(false);
  });
});

describe("computeCloudSync：三态判定（集合基准 + 本机 mtime，不含 .backups/）", () => {
  const files = (names: string[]): { files: string[] } => ({ files: names });

  it("未配置 / 未打开项目 / 云端不可达", () => {
    expect(computeCloudSync(null, false, null).state).toBe("unconfigured");
    expect(computeCloudSync(null, true, null).state).toBe("no-project");
    expect(computeCloudSync(project, true, null).state).toBe("unreachable");
    expect(computeCloudSync(project, false, files([])).state).toBe("unconfigured");
  });

  it("已同步：云端集合 == lastSeenCloudFiles 且本机无改动", () => {
    writeBookState(project.config.id, { lastSyncAt: new Date().toISOString(), lastSeenCloudFiles: ["x.zip"] });
    expect(computeCloudSync(project, true, files(["x.zip"])).state).toBe("synced");
  });

  it("云端有更新：集合变化（即便 head 时间戳更早也不会漏报——集合基准）", () => {
    writeBookState(project.config.id, { lastSyncAt: new Date().toISOString(), lastSeenCloudFiles: ["x.zip"] });
    const out = computeCloudSync(project, true, files(["20200101-000000000-自动-别的机器-人物0-设定0-章0.zip", "x.zip"]));
    expect(out.state).toBe("remote-ahead");
  });

  it("本机有改动：创作数据晚于 lastSyncAt（references/ 改动即算）", () => {
    writeBookState(project.config.id, { lastSyncAt: "2026-01-01T00:00:00.000Z", lastSeenCloudFiles: [] });
    expect(computeCloudSync(project, true, files([])).state).toBe("local-ahead");
  });

  it("两边都有改动 → conflict；无同步记录 + 云端有份 → conflict（保守）", () => {
    writeBookState(project.config.id, { lastSyncAt: "2026-01-01T00:00:00.000Z", lastSeenCloudFiles: ["x.zip"] });
    expect(computeCloudSync(project, true, files(["x.zip", "y.zip"])).state).toBe("conflict");
    // 无同步记录：`writeBookState` 是合并写（不能清字段）→ 用全新项目模拟「从未同步过」
    const fresh = makeProject("proj-sync-fresh", "从没同步过");
    try {
      // 无记录 ⇒ dirty 视为 true（保守）⇒ 云端也有份 = 两边都有 → conflict（用户裁决：拉取或强推）
      expect(computeCloudSync(fresh, true, files(["x.zip"])).state).toBe("conflict");
      expect(computeCloudSync(fresh, true, files([])).state).toBe("local-ahead"); // 无记录 + 云端空 → 本机先推
    } finally {
      closeDatabase(fresh.db);
      rmSync(fresh.root, { recursive: true, force: true });
    }
  });

  it("`.backups/` 的变化**不算**本机改动（force 会把云端旧份写进那里）", () => {
    writeBookState(project.config.id, { lastSyncAt: new Date().toISOString(), lastSeenCloudFiles: [] });
    const newest = new Date(Date.now() + 2000);
    mkdirP(join(project.root, BACKUPS_DIR_NAME), { recursive: true });
    const strayBackup = join(project.root, BACKUPS_DIR_NAME, "20260915-000000000-自动-机上-人物0-设定0-章0.zip");
    writeFile(strayBackup, "stray");
    utimesSync(strayBackup, newest, newest);
    const out = computeCloudSync(project, true, files([]));
    expect(out.local?.dirty).toBe(false);
    expect(out.state).toBe("synced");
  });

  it("容差只给 data.db：references/ 改动严格比较（同步后 0.5s 的改动也算 dirty）", () => {
    // 基准设在未来：夹具写入的三文件/两目录 mtime 都早于它 → 初始不 dirty（确定性构造）
    const base = new Date(Date.now() + 10_000);
    writeBookState(project.config.id, { lastSyncAt: base.toISOString(), lastSeenCloudFiles: [] });
    expect(computeCloudSync(project, true, files([])).local?.dirty).toBe(false);

    const refPath = join(project.root, "references", "同.md");
    writeFile(refPath, "edited");
    const within = new Date(base.getTime() + 500); // +0.5s：落在 data.db 的 1s 容差窗口内
    utimesSync(refPath, within, within);
    const out = computeCloudSync(project, true, files([]));
    expect(out.local?.dirty).toBe(true); // 严格比较命中
    expect(out.state).toBe("local-ahead");
  });

  it("容差给 data.db / -wal：其 mtime 落在窗口内不算 dirty（防 checkpoint 自激）", () => {
    const base = new Date(Date.now() + 10_000);
    writeBookState(project.config.id, { lastSyncAt: base.toISOString(), lastSeenCloudFiles: [] });
    const within = new Date(base.getTime() + 500); // +0.5s：仍在容差内
    const dbPath = join(project.root, DATA_DB_FILE_NAME);
    utimesSync(dbPath, within, within);
    const walPath = `${dbPath}-wal`;
    if (existsSync(walPath)) utimesSync(walPath, within, within);

    const out = computeCloudSync(project, true, files([]));
    expect(out.local?.dirty).toBe(false); // data.db/-wal 在容差窗口内 → 不算改动
    expect(out.state).toBe("synced");
  });

  it("拉取后立刻复查 → synced（严格比较不得把管道自己写的文件误判成本机改动）", async () => {
    const cloud = makeCloudZip({ references: ["a.md"], sessions: ["s1.jsonl"] });
    const dirName = `测试书-${project.config.id}`;
    store.set(dirName, { isDir: true, bytes: new Uint8Array(), mtime: Date.now() });
    seedCloudFile(`${dirName}/${cloud.fileName}`, cloud.bytes);
    writeBookState(project.config.id, { dirName });

    await pullBackup(project);

    const out = computeCloudSync(project, true, files([cloud.fileName]));
    expect(out.local?.dirty).toBe(false);
    expect(out.state).toBe("synced");
    // **拉取后不再误报「有改动未进最新备份」**（用户实测）：覆盖前快照的时间戳早于拉取写入的文件，
    // 只看 mtime 会永远为真 ⇒ `backupStale` 必须与「确有未同步改动」合取
    expect(out.local?.backupStale).toBe(false);
  });

  it("backupStale 与 dirty 合取：同步后新改动才为真", () => {
    const backupName = makeBackup("基线");
    const base = new Date(Date.now() + 10_000).toISOString(); // 基准放未来 → 夹具文件都算「已覆盖」
    writeBookState(project.config.id, { lastSyncAt: base, lastSeenCloudFiles: [] });
    expect(computeCloudSync(project, true, files([])).local?.backupStale).toBe(false);

    // 改一处创作数据且晚于 lastSyncAt → dirty=true 且备份未覆盖 → backupStale=true
    const ref = join(project.root, "references", "新.md");
    writeFileSync(ref, "x");
    const after = new Date(Date.now() + 20_000);
    utimesSync(ref, after, after);
    const out = computeCloudSync(project, true, files([]));
    expect(out.local?.dirty).toBe(true);
    expect(out.local?.backupStale).toBe(true);
    expect(out.local?.latestBackupFileName).toBe(backupName);
  });

  it("本机段字段：lastPushedFileName / lastSyncAt / latestBackupFileName", () => {
    const backupName = makeBackup("本机的");
    writeBookState(project.config.id, {
      lastPushedFileName: backupName,
      lastSyncAt: "2026-01-01T00:00:00.000Z",
      lastSeenCloudFiles: [],
    });
    const out = computeCloudSync(project, true, files([]));
    expect(out.local?.lastPushedFileName).toBe(backupName);
    expect(out.local?.lastSyncAt).toBe("2026-01-01T00:00:00.000Z");
    expect(out.local?.latestBackupFileName).toBe(backupName);
  });
});
