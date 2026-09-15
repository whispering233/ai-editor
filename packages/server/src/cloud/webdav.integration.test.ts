// 云端存档集成测试（卡 2）：对**真的 HTTP 服务**跑 WebDAV 客户端与 `/cloud/test` 端点
//
// 为什么需要：单测（`webdav.test.ts`）用 stub 的 fetch 覆盖协议与错误映射；本文件起一个最小
// WebDAV 服务（node:http + 真文件系统）验证「真 HTTP 往返」：URL 编码（中文书名）、邮箱风格
// 用户名、Basic 认证、目录列举、MKCOL/PUT/DELETE、以及 `/cloud/test` 的读+写探测结果。
// 本机无 rclone / wsgidav（已确认），故用最小自建服务——它只服务本测试文件，不入包。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.js";
import { cloudRoutes } from "../routes/cloud.js";
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
import { initCloudState, readBookState } from "./state.js";
import { pushBackup } from "./sync.js";
import { BACKUPS_DIR_NAME } from "../backup.js";
import type { ProjectContext } from "../middleware/project.js";
import { createWebdavClient } from "./webdav.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const JSON_HEADERS = { ...HOST_HEADERS, "content-type": "application/json" };
const USER = "me@example.com";
const PASSWORD = "app-password-秘密值";

// ============ 最小 WebDAV 服务（仅本测试用） ============

interface FakeDavOptions {
  username?: string;
  password?: string;
  /** 非空时，PUT 一律返回该状态码（配额用例） */
  putStatus?: number;
  /** 非空时，MKCOL 的目标名超过该长度 → 400 IllegalArgument（模拟坚果云 "sandbox name is too long"） */
  mkcolRejectLongNames?: number;
}

interface FakeDav {
  /** `http://127.0.0.1:<port>/dav` */
  url: string;
  close: () => Promise<void>;
  /** 已处理的请求（method + 目标路径）——断言「零上传」这类行为用 */
  calls: Array<{ method: string; path: string }>;
}

/** 把请求 URL 映射到根目录下的真实路径（越界 → null，防穿越） */
function resolveTarget(davRoot: string, rawUrl: string): string | null {
  const pathname = decodeURIComponent(new URL(rawUrl, "http://placeholder").pathname);
  const target = resolve(davRoot, `.${pathname}`);
  return target === davRoot || target.startsWith(`${davRoot}/`) ? target : null;
}

/** 目录列举响应（含自身条目；href 逐段百分号编码 + 集合带尾斜杠，与真实服务器一致） */
function propfindXml(davRoot: string, target: string): string {
  const entries: Array<{ abs: string; isDir: boolean }> = [
    { abs: target, isDir: true },
    ...readdirSync(target).map((name) => ({ abs: join(target, name), isDir: statSync(join(target, name)).isDirectory() })),
  ];
  const responses = entries
    .map(({ abs, isDir }) => {
      const rel = relative(davRoot, abs);
      const segments = rel.split(sep).filter((s) => s !== "");
      const href =
        segments.length === 0 ? "/" : `/${segments.map(encodeURIComponent).join("/")}${isDir ? "/" : ""}`;
      const stat = statSync(abs);
      return `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${
        isDir ? "<d:collection/>" : ""
      }</d:resourcetype>${isDir ? "" : `<d:getcontentlength>${stat.size}</d:getcontentlength>`}<d:getlastmodified>${new Date(
        stat.mtimeMs,
      ).toUTCString()}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`;
}

/** 启动最小 WebDAV 服务（根 = `<root>/dav`） */
async function startFakeDav(root: string, options: FakeDavOptions = {}): Promise<FakeDav> {
  const username = options.username ?? USER;
  const password = options.password ?? PASSWORD;
  const davRoot = join(root, "dav");
  mkdirSync(davRoot, { recursive: true });

  const calls: Array<{ method: string; path: string }> = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    calls.push({ method: req.method ?? "?", path: decodeURIComponent(req.url ?? "/") });
    const expected = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="dav"' }).end("unauthorized");
      return;
    }
    const target = resolveTarget(davRoot, req.url ?? "/");
    if (target === null) {
      res.writeHead(403).end("forbidden");
      return;
    }

    switch (req.method) {
      case "PROPFIND": {
        if (!existsSync(target)) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(207, { "content-type": "application/xml; charset=utf-8" }).end(propfindXml(davRoot, target));
        return;
      }
      case "MKCOL": {
        const rejectAt = options.mkcolRejectLongNames;
        if (rejectAt !== undefined) {
          const seg = decodeURIComponent(new URL(String(req.url), "http://x").pathname).split("/").filter(Boolean).pop() ?? "";
          if (seg.length > rejectAt) {
            res.writeHead(400, { "content-type": "application/xml" }).end(
              '<?xml version="1.0"?><d:error xmlns:d="DAV:" xmlns:s="http://ns.jianguoyun.com"><s:exception>IllegalArgument</s:exception><s:message>sandbox name is too long</s:message></d:error>',
            );
            return;
          }
        }
        if (existsSync(target)) {
          res.writeHead(405).end("already exists");
          return;
        }
        if (!existsSync(dirname(target))) {
          res.writeHead(409).end("parent missing");
          return;
        }
        mkdirSync(target);
        res.writeHead(201).end();
        return;
      }
      case "PUT": {
        if (options.putStatus !== undefined) {
          res.writeHead(options.putStatus).end("insufficient storage");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          writeFileSync(target, Buffer.concat(chunks));
          res.writeHead(201).end();
        });
        return;
      }
      case "GET": {
        if (!existsSync(target) || statSync(target).isDirectory()) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, { "content-type": "application/zip" }).end(readFileSync(target));
        return;
      }
      case "MOVE": {
        const destination = typeof req.headers.destination === "string" ? resolveTarget(davRoot, req.headers.destination) : null;
        if (destination === null || !existsSync(target)) {
          res.writeHead(404).end("not found");
          return;
        }
        if (existsSync(destination) && req.headers.overwrite === "F") {
          res.writeHead(412).end("precondition failed");
          return;
        }
        renameSync(target, destination);
        res.writeHead(201).end();
        return;
      }
      case "DELETE": {
        if (!existsSync(target)) {
          res.writeHead(404).end("not found");
          return;
        }
        if (statSync(target).isDirectory()) rmSync(target, { recursive: true, force: true });
        else unlinkSync(target);
        res.writeHead(204).end();
        return;
      }
      default: {
        res.writeHead(405).end("method not allowed");
      }
    }
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  return {
 // 假服务的根就是 davRoot（无 URL 前缀）：需要前缀的用例自行拼子路径（`${url}/ai-editor`）
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

// ============ 集成用例 ============

let root: string;
let dav: FakeDav | null = null;
let app: Hono;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-editor-cloud-integ-"));
  initCloudState(root);
  app = new Hono();
  app.onError(errorHandler());
  app.route("/api/v1/cloud", cloudRoutes);
});

afterEach(async () => {
  if (dav !== null) {
    await dav.close();
    dav = null;
  }
  initCloudState(null);
  rmSync(root, { recursive: true, force: true });
});

/** 配置云盘指向当前假服务（走真实端点，顺带覆盖写入路径） */
async function configure(url: string, password: string = PASSWORD) {
  const res = await app.request("/api/v1/cloud/config", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ url, username: USER, password }),
  });
  expect(res.status).toBe(200);
}

describe("WebDAV 客户端 × 真 HTTP 服务", () => {
  it("list() 真往返：中文名 / 百分号编码 / size / 集合判定（真实 PROPFIND 解析）", async () => {
    dav = await startFakeDav(root);
    const davRoot = join(root, "dav");
    mkdirSync(join(davRoot, "斗破苍穹-proj-x"));
    writeFileSync(join(davRoot, "斗破苍穹-proj-x", "20260813-101530123-自动-苹果本-人物32-设定58-章120.zip"), "zip-bytes");
    writeFileSync(join(davRoot, "斗破苍穹-proj-x", ".tmp-半截.zip"), "");

    const client = createWebdavClient({ url: dav.url, username: USER, password: PASSWORD, timeoutMs: 5000 });
    const entries = await client.list("斗破苍穹-proj-x");
    expect(entries?.map((e) => e.name)).toEqual([
      ".tmp-半截.zip",
      "20260813-101530123-自动-苹果本-人物32-设定58-章120.zip",
    ]);
    expect(entries?.[1]).toMatchObject({ size: 9, isCollection: false });
    expect(entries?.[1]?.lastModified).toMatch(/GMT$/);
  });

  it("带路径前缀的 base（真 HTTP）：根条目剔除且 path 为 base 相对（oracle 卡 2 F2）", async () => {
    dav = await startFakeDav(root);
    mkdirSync(join(root, "dav", "ai-editor", "书-proj-x"), { recursive: true });
    writeFileSync(join(root, "dav", "ai-editor", "x.zip"), "PK");
    const client = createWebdavClient({
      url: `${dav.url}/ai-editor`,
      username: USER,
      password: PASSWORD,
      timeoutMs: 5000,
    });
    expect((await client.list(""))?.map((e) => e.path)).toEqual(["x.zip", "书-proj-x"]);
    expect(await client.list("书-proj-x")).toEqual([]);
  });

  it("mkcol（幂等）/ put / remove 真往返；根目录不存在时 404 → 创建", async () => {
    dav = await startFakeDav(root);
    const client = createWebdavClient({ url: dav.url, username: USER, password: PASSWORD, timeoutMs: 5000 });
    // 目录不存在 → list null → mkcol 创建 → 再列得空
    expect(await client.list("新书-proj-y")).toBeNull();
    expect(await client.mkcol("新书-proj-y")).toBe(true);
    expect(await client.mkcol("新书-proj-y")).toBe(false); // 已存在
    expect(await client.list("新书-proj-y")).toEqual([]);
    // 上传 + 删除（真字节与真文件）
    await client.put("新书-proj-y/a.zip", new TextEncoder().encode("PK"));
    expect(statSync(join(root, "dav", "新书-proj-y", "a.zip")).size).toBe(2);
    await client.remove("新书-proj-y/a.zip");
    expect(existsSync(join(root, "dav", "新书-proj-y", "a.zip"))).toBe(false);
    await expect(client.remove("新书-proj-y/a.zip")).resolves.toBeUndefined(); // 幂等
  });
});

describe("POST /api/v1/cloud/test × 真 HTTP 服务", () => {
  it("读 + 写探测通过：200 {connected:true, created:false}，服务端不留临时文件", async () => {
    dav = await startFakeDav(root);
    await configure(dav.url);
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ connected: true, baseUrl: dav.url, created: false });
    // 写探测的临时文件已被删除（不留垃圾）
    expect(readdirSync(join(root, "dav"))).toEqual([]);
  });

  it("根目录原先不存在 → 本次创建（created:true）并完成读写探测", async () => {
    dav = await startFakeDav(root);
    const nested = `${dav.url}/ai-editor`;
    await configure(nested);
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect((await res.json()).data).toMatchObject({ connected: true, created: true, baseUrl: nested });
    expect(existsSync(join(root, "dav", "ai-editor"))).toBe(true);
    expect(readdirSync(join(root, "dav", "ai-editor"))).toEqual([]);
  });

  it("凭据错误 → 502 CLOUD_AUTH_FAILED（真 401）", async () => {
    dav = await startFakeDav(root);
    await configure(dav.url, "错误的密码");
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("CLOUD_AUTH_FAILED");
  });

  it("服务不可达（端口已关闭）→ 502 CLOUD_UNREACHABLE", async () => {
    dav = await startFakeDav(root);
    const url = dav.url;
    await dav.close();
    dav = null;
    await configure(url);
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("CLOUD_UNREACHABLE");
    expect(body.error.message).toContain("无法连接云盘");
  });

  it("配额耗尽（PUT 507）→ 502 CLOUD_QUOTA_EXCEEDED", async () => {
    dav = await startFakeDav(root, { putStatus: 507 });
    await configure(dav.url);
    const res = await app.request("/api/v1/cloud/test", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("CLOUD_QUOTA_EXCEEDED");
  });
});

// ============ 推送端到端（卡 4：真 HTTP + 真文件系统） ============

/** 造一个真项目（三文件 + references/ + sessions/），返回可直接喂给 pushBackup 的上下文 */
function makeProjectFixture(id: string, name: string): { project: ProjectContext; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ai-editor-push-"));
  writeProjectFile(dir, {
    id,
    name,
    language: "zh",
    schema_version: SCHEMA_VERSION,
    current_position: null,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
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
  return { project: { root: dir, config: readProjectFile(dir) as ProjectFileConfig, db }, dir };
}

describe("pullBackup × 真 HTTP 服务", () => {
  it("端到端：推送 → 本地改动 → 拉取（同名文件云端取胜、覆盖前自动快照、并集不删本机独有文件）", async () => {
    dav = await startFakeDav(root);
    await configure(dav.url);
    const { project, dir } = makeProjectFixture("proj-pull-e2e", "拉取书");
    mkdirSync(join(dir, ".backups"), { recursive: true });
    const { writeBackup } = await import("../backup.js");
    const { pullBackup } = await import("./sync.js");
    writeBackup(project, { kind: "manual" }); // 先生成一份本地备份
    const pushed = await pushBackup(project); // 推上去（云端 head = 本机这份）

    // 本机改动：改了已有参考资料 + 新增一份本机独有资料
    const refDir = join(dir, "references");
    writeFileSync(join(refDir, "笔记.md"), "# 本机改过的笔记");
    writeFileSync(join(refDir, "本机独有.md"), "# 只在本机");

    const result = await pullBackup(project);

    expect(result.pulled.fileName).toBe(pushed.pushed.fileName);
    // 同名文件：云端取胜（本机改动被覆盖，但覆盖前已自动快照）
    expect(readFileSync(join(refDir, "笔记.md"), "utf8")).toBe("# 笔记");
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, result.snapshot.fileName))).toBe(true);
    // 并集：本机独有文件保留（基线里没有它）
    expect(existsSync(join(refDir, "本机独有.md"))).toBe(true);
    expect(result.merged.kept).toBe(1);
    // 云端那份落进本地 .backups/
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, result.pulled.fileName))).toBe(true);

    closeDatabase(project.db);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("重复推送同一份 = 幂等跳过上传（坚果云 409 DuplicateName 口径）", () => {
  it("第二次推送同一份：零 PUT / 零 MOVE，但状态照旧更新", async () => {
    dav = await startFakeDav(root);
    await configure(dav.url);
    const { project, dir } = makeProjectFixture("proj-repush", "重推书");
    mkdirSync(join(dir, ".backups"), { recursive: true });
    const { writeBackup } = await import("../backup.js");
    const info = writeBackup(project, { kind: "manual" });

    const first = await pushBackup(project);
    expect(first.pushed.fileName).toBe(info.fileName);
    const before = dav.calls.filter((c) => c.method === "PUT" || c.method === "MOVE").length;

    const second = await pushBackup(project); // 同一份再推
    expect(second.pushed.fileName).toBe(info.fileName);
    const after = dav.calls.filter((c) => c.method === "PUT" || c.method === "MOVE").length;
    // **零 PUT / 零 MOVE**（同名同大小 ⇒ 跳过上传；只做状态刷新用的 PROPFIND）
    expect(after - before).toBe(0);

    closeDatabase(project.db);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("书目录名被云盘拒绝 → 回退短名（坚果云实测口径）", () => {
  it("MKCOL 400（名字过长）→ 回退 ai-editor-<id>，并把回退名落进 state.dirName", async () => {
    dav = await startFakeDav(root, { mkcolRejectLongNames: 30 });
    await configure(dav.url);
    const { project, dir } = makeProjectFixture("proj-dirname-fallback", "末世灾星：我能提取词条");
    mkdirSync(join(dir, ".backups"), { recursive: true });
    const { writeBackup } = await import("../backup.js");
    writeBackup(project, { kind: "manual" });

    const result = await pushBackup(project);

    expect(result.remote.dirName).toBe("proj-dirname-fallback"); // 三档候选里最后那档（纯 id）
    expect(existsSync(join(root, "dav", "proj-dirname-fallback"))).toBe(true);
    expect(readBookState("proj-dirname-fallback")?.dirName).toBe("proj-dirname-fallback");

    closeDatabase(project.db);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("pushBackup × 真 HTTP 服务", () => {
  it("端到端：建目录 → 临时名上传 → MOVE → 云端正式名内容与本地逐字节一致、无 .tmp- 残留、状态落盘", async () => {
    dav = await startFakeDav(root);
    await configure(dav.url);
    const { project, dir } = makeProjectFixture("proj-push-e2e", "推送书");

    const backupDir = join(dir, ".backups");
    mkdirSync(backupDir, { recursive: true });
    // 走真备份管道生成 zip（含 references/ 与 sessions/）
    const { writeBackup } = await import("../backup.js");
    const info = writeBackup(project, { kind: "manual", name: "定稿" });

    const result = await pushBackup(project);
    expect(result.pushed.fileName).toBe(info.fileName);
    const cloudDir = join(root, "dav", result.remote.dirName);
    expect(readdirSync(cloudDir)).toEqual([info.fileName]); // 只有正式名（无 .tmp- 残留）
    // 云端内容与本地逐字节一致
    expect(readFileSync(join(cloudDir, info.fileName)).equals(readFileSync(join(backupDir, info.fileName)))).toBe(true);

    // 同步状态落盘（本机视角；含 baseEntries 基线）
    const state = readBookState("proj-push-e2e");
    expect(state?.dirName).toBe(result.remote.dirName);
    expect(state?.lastPushedFileName).toBe(info.fileName);
    expect(state?.baseEntries).toContain("references/笔记.md");
    expect(state?.baseEntries).toContain("sessions/s1.jsonl");

    closeDatabase(project.db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("冲突与强推端到端：云端更新的份 → 409；force → 云端那份被存档进本地 .backups/ 后覆盖", async () => {
    dav = await startFakeDav(root);
    await configure(dav.url);
    const { project, dir } = makeProjectFixture("proj-push-conflict", "冲突书");

    const backupDir = join(dir, ".backups");
    mkdirSync(backupDir, { recursive: true });
    const { writeBackup } = await import("../backup.js");
    writeBackup(project, { kind: "manual" });
    await pushBackup(project); // 本机先推一份（lastPushed = 它）

    // 模拟另一台机器写了更新的份（时间戳更晚 → 成为 head）
    const cloudDir = join(root, "dav", readBookState("proj-push-conflict")?.dirName ?? "");
    const otherName = "20990101-000000000-自动-别的机器-人物1-设定2-章3.zip";
    writeFileSync(join(cloudDir, otherName), "CLOUD-FROM-OTHER-MACHINE");

    await expect(pushBackup(project)).rejects.toMatchObject({ code: "CLOUD_CONFLICT" });
    expect(existsSync(join(cloudDir, otherName))).toBe(true); // 冲突时云端未被改写

    const forced = await pushBackup(project, { force: true });
    expect(forced.snapshot?.fileName).toBe(otherName);
    // 云端旧份原样存进本地 .backups/（两边都留档）
    expect(readFileSync(join(backupDir, otherName), "utf8")).toBe("CLOUD-FROM-OTHER-MACHINE");

    closeDatabase(project.db);
    rmSync(dir, { recursive: true, force: true });
  });
});
