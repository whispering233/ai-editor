// 自动推送测试（卡 7）：三条触发路径 / 2h 节流 / 变更口径（排除 sessions/）/ 单一定时器排程 / 失败只记状态
//
// 契约：`docs/design/40-cloud-sync.md` §5（触发口径与排程口径）、§7（cloud.json 字段）、
// `docs/api/100-api-cloud.md`（`GET /cloud/status` 的 `local.lastAutoPushError`）。
// 策略：**内存版最小 WebDAV**（stub 全局 fetch，记录每个动词）+ 假时钟（节流与「本机没有备份」
// 都在本地判定，不打真网络）——与 `sync.test.ts` 同款手法（协议本身由 `webdav.test.ts` /
// `webdav.integration.test.ts` 覆盖）。
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENTS_FILE_NAME,
  closeDatabase,
  DATA_DB_FILE_NAME,
  openDatabase,
  readProjectFile,
  SCHEMA_VERSION,
  setUserVersion,
  writeOutlineFile,
  writeProjectFile,
} from "@whispering233/ai-editor-db";
import type { ProjectFileConfig } from "@whispering233/ai-editor-shared";
import {
  hasAuthoringChangesSince,
  hasLocalEditsSince,
  setProjectTick,
  startAutoBackup,
  stopAutoBackup,
  writeBackup,
} from "../backup.js";
import type { ProjectContext } from "../middleware/project.js";
import { initCloudState, readBookState, writeBookState, writeCloudConfig } from "./state.js";
import { AUTO_PUSH_THROTTLE_MS, autoPushAfterManualBackup, autoPushOnClose, maybeAutoPush } from "./auto-push.js";

const BASE = "https://dav.example.com/dav/ai-editor";
const USER = "u@example.com";
const PASSWORD = "app-pw";
const T0 = "2026-08-01T10:00:00Z";

// ============ 内存版最小 WebDAV（只够推送管道跑通） ============

interface FakeNode {
  isDir: boolean;
  bytes: Uint8Array;
}

let store: Map<string, FakeNode>;
/** 记录每个请求（断言「一次推送」与「零网络请求」） */
let calls: Array<{ method: string; path: string }>;

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
  return encoded === "" ? `${basePath}/` : `${basePath}/${encoded}${isDir ? "/" : ""}`;
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
        }</d:resourcetype>${node.isDir ? "" : `<d:getcontentlength>${node.bytes.length}</d:getcontentlength>`}<d:getlastmodified>${new Date().toUTCString()}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`;
}

/** 装载内存 DAV 到全局 fetch */
function stubDav(): void {
  store = new Map([["", { isDir: true, bytes: new Uint8Array() }]]);
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown, init?: RequestInit) => {
      const method = String(init?.method ?? "GET");
      const rel = relOfUrl(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ method, path: rel });
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
          store.set(rel, { isDir: true, bytes: new Uint8Array() });
          return Promise.resolve(new Response(null, { status: 201 }));
        }
        case "PUT": {
          const body = init?.body;
          store.set(rel, {
            isDir: false,
            bytes: typeof body === "string" ? new TextEncoder().encode(body) : (body as Uint8Array),
          });
          return Promise.resolve(new Response(null, { status: 201 }));
        }
        case "GET":
          return Promise.resolve(
            node === undefined || node.isDir
              ? new Response(null, { status: 404 })
              : new Response(node.bytes, { status: 200 }),
          );
        case "MOVE": {
          const destination = headers.Destination === undefined ? undefined : relOfUrl(headers.Destination);
          if (node === undefined || destination === undefined) return Promise.resolve(new Response(null, { status: 404 }));
          store.delete(rel);
          store.set(destination, node);
          return Promise.resolve(new Response(null, { status: 201 }));
        }
        case "DELETE": {
          if (node === undefined) return Promise.resolve(new Response(null, { status: 404 }));
          store.delete(rel);
          for (const key of [...store.keys()]) if (key.startsWith(`${rel}/`)) store.delete(key);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        default:
          return Promise.resolve(new Response(null, { status: 405 }));
      }
    }),
  );
}

/** 上传次数（一次成功推送 = 一个 PUT） */
function putCount(): number {
  return calls.filter((c) => c.method === "PUT").length;
}

// ============ 项目夹具 ============

let cloudRoot: string;
let project: ProjectContext;

function makeProject(id = "proj-autopush-1", name = "自动推送测试书"): ProjectContext {
  const dir = mkdtempSync(join(tmpdir(), "ai-editor-autopush-"));
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

/** 新增/覆盖项目内文件并把 mtime 显式置到 `baseMs + deltaMs`（严格比较口径下确定性地制造「有变更」） */
function writeAfter(rel: string, baseMs: number, deltaMs = 60_000): void {
  const full = join(project.root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `x-${rel}`);
  const at = new Date(baseMs + deltaMs);
  utimesSync(full, at, at);
}

/**
 * 造一份可推送的真备份（`pushBackup` 缺省目标）+ 把同步基准 `lastSyncAt` 设到**当下**
 * （晚于夹具与备份管道的全部写入——含 wal_checkpoint 刷新 data.db mtime），返回该基准毫秒值。
 */
function makeBackupAndBaseline(): number {
  writeBackup(project, { kind: "manual" });
  const base = Date.now();
  writeBookState(project.config.id, { lastSyncAt: new Date(base).toISOString() });
  return base;
}

beforeEach(() => {
  stubDav();
  cloudRoot = mkdtempSync(join(tmpdir(), "ai-editor-autopush-root-"));
  initCloudState(cloudRoot);
  writeCloudConfig({ url: BASE, username: USER, password: PASSWORD, autoPush: true });
  project = makeProject();
});

afterEach(() => {
  stopAutoBackup();
  setProjectTick({});
  closeDatabase(project.db);
  rmSync(project.root, { recursive: true, force: true });
  rmSync(cloudRoot, { recursive: true, force: true });
  initCloudState(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("自动推送：开关与三条触发路径", () => {
  it("autoPush 关：三条路径都不推（零网络请求，也不写任何自动推送状态）", async () => {
    writeCloudConfig({ autoPush: false });
    const base = makeBackupAndBaseline();
    writeAfter(join("references", "新资料.md"), base); // 确有创作变更——被开关挡下

    expect(await maybeAutoPush(project)).toBe(false);
    await autoPushOnClose(project);
    await autoPushAfterManualBackup(project);

    expect(calls).toEqual([]);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBeUndefined();
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();
  });

  it("纯聊天变更（只动 sessions/）不触发定时推送；references/ 变更即推一次", async () => {
    const base = makeBackupAndBaseline();
    writeAfter(join("sessions", "s2.jsonl"), base);

    expect(await maybeAutoPush(project)).toBe(false);
    expect(putCount()).toBe(0);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBeUndefined();

    writeAfter(join("references", "新资料.md"), base);

    expect(await maybeAutoPush(project)).toBe(true);
    expect(putCount()).toBe(1);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBeTypeOf("string");
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();
  });

  it("节流（注入 throttleMs 与假时钟）：窗口内的第二次变更不推，越过窗口即推", async () => {
    const base = makeBackupAndBaseline();
    let clock = base;
    const push = (): Promise<boolean> => maybeAutoPush(project, { throttleMs: 1000, now: () => clock });

    writeAfter(join("references", "一.md"), base);
    expect(await push()).toBe(true); // 首次：无 lastAutoPushAt → 放行
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBe(new Date(base).toISOString());
    expect(putCount()).toBe(1);

    writeAfter(join("references", "二.md"), clock);
    expect(await push()).toBe(false); // 距上次 < 1000ms → 节流挡下（即便确有变更）
    expect(putCount()).toBe(1);

    clock = base + 1000;
    expect(await push()).toBe(true);
    expect(putCount()).toBe(2);
  });

  it("关闭项目：纯聊天变更也推一次（不受节流），且不推进 lastAutoPushAt", async () => {
    const base = makeBackupAndBaseline();
    writeAfter(join("references", "一.md"), base);
    expect(await maybeAutoPush(project, { throttleMs: 10 * 60_000 })).toBe(true); // 先占住节流基准
    const throttledAt = readBookState(project.config.id)?.lastAutoPushAt;

    writeAfter(join("sessions", "s2.jsonl"), Date.now()); // 纯聊天（只在关闭项目路径算变更）
    await autoPushOnClose(project);

    expect(putCount()).toBe(2);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBe(throttledAt);
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();
  });

  it("关闭项目：云盘不可达时不抛，只写 lastAutoPushError（关闭语义不受影响）", async () => {
    const base = makeBackupAndBaseline();
    writeAfter(join("references", "一.md"), base);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    await expect(autoPushOnClose(project)).resolves.toBeUndefined();

    const err = readBookState(project.config.id)?.lastAutoPushError;
    expect(err?.code).toBe("CLOUD_UNREACHABLE");
    expect(err?.message).toContain("无法连接云盘");
    expect(err?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("手动备份后：无条件立刻推一次（未到节流、也没有新变更），不推进节流基准", async () => {
    const base = makeBackupAndBaseline();
    writeAfter(join("references", "一.md"), base);
    expect(await maybeAutoPush(project, { throttleMs: 10 * 60_000 })).toBe(true);
    const throttledAt = readBookState(project.config.id)?.lastAutoPushAt;

    await autoPushAfterManualBackup(project); // 节流中且无变更 → 仍需推

    expect(putCount()).toBe(2);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBe(throttledAt);
  });

  it("本机没有任何备份：跳过（不写 lastAutoPushError、零网络请求）", async () => {
    const base = Date.now();
    writeBookState(project.config.id, { lastSyncAt: new Date(base).toISOString() });
    writeAfter(join("references", "一.md"), base);

    expect(await maybeAutoPush(project)).toBe(false);
    await autoPushOnClose(project);

    expect(calls).toEqual([]); // 「没有可推送的备份」在本地判定，先于任何网络动作
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBeUndefined();
  });
});

describe("hasAuthoringChangesSince：创作数据口径（排除 sessions/、含 AGENTS.md）", () => {
  it("只动 sessions/ → 不算创作变更（hasLocalEditsSince 仍算：关闭项目那次要带上聊天）", () => {
    const base = makeBackupAndBaseline();
    writeAfter(join("sessions", "s2.jsonl"), base);

    expect(hasAuthoringChangesSince(project, new Date(base))).toBe(false);
    expect(hasLocalEditsSince(project, new Date(base))).toBe(true);
  });

  it("动 references/ → 算创作变更", () => {
    const base = makeBackupAndBaseline();
    writeAfter(join("references", "新资料.md"), base);

    expect(hasAuthoringChangesSince(project, new Date(base))).toBe(true);
  });

  it("动 AGENTS.md（项目规则）→ 算创作变更", () => {
    const base = makeBackupAndBaseline();
    writeAfter(AGENTS_FILE_NAME, base);

    expect(hasAuthoringChangesSince(project, new Date(base))).toBe(true);
  });
});

describe("排程钩子：自动推送挂在自动备份的同一条 tick 链上（不新增定时器）", () => {
  it("备份频率关闭 + 兜底间隔注入 → 仍排程（onTick 被调用）", async () => {
    const freqOff: ProjectContext = { ...project, config: { ...project.config, backup_frequency_minutes: null } };
    let ticks = 0;
    setProjectTick({
      onTick: () => {
        ticks += 1;
      },
      fallbackIntervalMs: () => 20,
    });

    startAutoBackup(freqOff);
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
    } finally {
      stopAutoBackup();
    }

    expect(ticks).toBeGreaterThanOrEqual(1);
  });

  it("备份频率关闭 + 兜底为 null（autoPush 关）→ 不排程", async () => {
    const freqOff: ProjectContext = { ...project, config: { ...project.config, backup_frequency_minutes: null } };
    let ticks = 0;
    setProjectTick({
      onTick: () => {
        ticks += 1;
      },
      fallbackIntervalMs: () => null,
    });

    startAutoBackup(freqOff);
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
    } finally {
      stopAutoBackup();
    }

    expect(ticks).toBe(0);
  });

  it("备份频率开启 → 按频率排程（兜底间隔不参与）", () => {
    const freqOn: ProjectContext = { ...project, config: { ...project.config, backup_frequency_minutes: 5 } };
    let ticks = 0;
    setProjectTick({
      onTick: () => {
        ticks += 1;
      },
      fallbackIntervalMs: () => 20, // 诱导项：必须以频率为准
    });

    vi.useFakeTimers();
    startAutoBackup(freqOn);
    try {
      vi.advanceTimersByTime(80);
      expect(ticks).toBe(0); // 兜底的 20ms 不生效
      vi.advanceTimersByTime(5 * 60_000);
      expect(ticks).toBe(1); // 频率 5 分钟到点
    } finally {
      stopAutoBackup();
      vi.useRealTimers();
    }
  });

  it("生产装配（middleware 注册）：备份频率关闭 + autoPush 开启 → 2h tick 真的推一次", async () => {
    const base = makeBackupAndBaseline();
    writeAfter(join("references", "一.md"), base);
    const freqOff: ProjectContext = { ...project, config: { ...project.config, backup_frequency_minutes: null } };

    // 本文件其余用例都是显式注入钩子（且 afterEach 会清空）——此处**首次**运行时加载该模块，
    // 走的就是生产装配那条路径（本文件对它的其余引用都是 type-only，不进运行时）
    await import("../middleware/project.js");

    vi.useFakeTimers();
    startAutoBackup(freqOff);
    try {
      await vi.advanceTimersByTimeAsync(AUTO_PUSH_THROTTLE_MS);
    } finally {
      stopAutoBackup();
      vi.useRealTimers();
    }

    // tick 里的推送是 fire-and-forget（`void maybeAutoPush`）——给它一拍真实时间再断言
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(putCount()).toBe(1);
  });
});
