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
import { MAX_CLOUD_BACKUPS, pushBackup } from "./sync.js";

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

/** 在内存 DAV 里预置一份云端备份（文件名即协议） */
function seedCloudFile(fileName: string, content = "zip"): void {
  store.set(fileName, { isDir: false, bytes: new TextEncoder().encode(content), mtime: Date.now() });
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
