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
  OUTLINE_FILE_NAME,
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
  hasUnbackedChanges,
  latestParseableBackupTime,
  setProjectTick,
  startAutoBackup,
  stopAutoBackup,
  writeBackup,
} from "../backup.js";
import type { ProjectContext } from "../middleware/project.js";
import { initCloudState, readBookState, writeBookState, writeCloudConfig } from "./state.js";
import { pushBackup } from "./sync.js";
import { AUTO_PUSH_THROTTLE_MS, autoPushAfterManualBackup, autoPushOnClose, maybeAutoPush } from "./auto-push.js";

const BASE = "https://dav.example.com/dav"; // 云盘根（配置值）；客户端会拼上工作根 `ai-editor`
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
  // 请求路径 = 云盘根 + 工作根（`ai-editor`）+ relPath → 去掉前两段取 relPath
  const basePath = `${new URL(BASE).pathname.replace(/\/+$/, "")}/ai-editor`;
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

/**
 * 造「有改动，且已被最新备份涵盖」的形态（卡 B 守卫的前提）：
 * 变更 mtime 落在 (lastSyncAt, 备份时间戳) 之间——先把 lastSyncAt 与变更都放到过去，再生成备份。
 * 注意不能用 `writeAfter(rel, base)`（mtime = base + 60s 落在未来），那样任何备份都「盖不住」它。
 */
function changeCoveredByBackup(rel: string): void {
  const now = Date.now();
  writeBookState(project.config.id, { lastSyncAt: new Date(now - 300_000).toISOString() });
  writeAfter(rel, now - 120_000, 0);
  writeBackup(project, { kind: "auto" });
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
    writeAfter(AGENTS_FILE_NAME, base); // 确有创作变更（AGENTS.md）——被开关挡下

    expect(await maybeAutoPush(project)).toBe(false);
    await autoPushOnClose(project);
    await autoPushAfterManualBackup(project);

    expect(calls).toEqual([]);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBeUndefined();
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();
  });

  it("纯聊天变更（只动 sessions/）不触发定时推送；AGENTS.md（创作数据）变更即推一次", async () => {
    makeBackupAndBaseline();
    writeAfter(join("sessions", "s2.jsonl"), Date.now() - 60_000, 0); // 1 分钟前的纯聊天改动

    expect(await maybeAutoPush(project)).toBe(false);
    expect(putCount()).toBe(0);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBeUndefined();

    changeCoveredByBackup(AGENTS_FILE_NAME); // 生产里 tick 内先 maybeAutoBackup 生成新份

    expect(await maybeAutoPush(project)).toBe(true);
    expect(putCount()).toBe(1);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBeTypeOf("string");
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();
  });

  it("节流（注入 throttleMs 与假时钟）：窗口内的第二次变更不推，越过窗口即推", async () => {
    changeCoveredByBackup(AGENTS_FILE_NAME); // 变更已被最新备份涵盖（卡 B 守卫的前提）
    let clock = Date.now();
    const push = (): Promise<boolean> => maybeAutoPush(project, { throttleMs: 1000, now: () => clock });

    expect(await push()).toBe(true); // 首次：无 lastAutoPushAt → 放行
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBe(new Date(clock).toISOString());
    expect(putCount()).toBe(1);

    changeCoveredByBackup(AGENTS_FILE_NAME); // 确有新变更（且已被备份涵盖）
    expect(await push()).toBe(false); // 距上次 < 1000ms → 节流挡下
    expect(putCount()).toBe(1);

    clock += 1000;
    expect(await push()).toBe(true);
    expect(putCount()).toBe(2);
  });

  it("关闭项目：聊天变更若已被最新备份涵盖则推一次（不受节流、不推进 lastAutoPushAt）；未涵盖则跳过", async () => {
    changeCoveredByBackup(AGENTS_FILE_NAME);
    expect(await maybeAutoPush(project, { throttleMs: 10 * 60_000 })).toBe(true); // 先占住节流基准
    const throttledAt = readBookState(project.config.id)?.lastAutoPushAt;

    // 场景 A：纯聊天变更**未**进最新备份 → 关闭项目跳过（卡 B (ii)：不静默推旧包）
    writeAfter(join("sessions", "s2.jsonl"), Date.now() - 60_000, 0);
    const beforeSkip = putCount();
    await autoPushOnClose(project);
    expect(putCount()).toBe(beforeSkip);
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();

    // 场景 B：备份涵盖聊天变更后 → 关闭项目推一次（不受节流、不推进节流基准）
    changeCoveredByBackup(join("sessions", "s3.jsonl"));
    await autoPushOnClose(project);
    expect(putCount()).toBe(beforeSkip + 1);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBe(throttledAt);
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();
  });

  it("关闭项目：云盘不可达时不抛，只写 lastAutoPushError（关闭语义不受影响）", async () => {
    changeCoveredByBackup(AGENTS_FILE_NAME);
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

  it("手动备份后：无条件立刻推一次（未到节流），不推进节流基准；**同一份重复推 = 零上传**", async () => {
    changeCoveredByBackup(AGENTS_FILE_NAME);
    expect(await maybeAutoPush(project, { throttleMs: 10 * 60_000 })).toBe(true);
    const throttledAt = readBookState(project.config.id)?.lastAutoPushAt;

    // 场景 A：同一份再推一次 → 幂等跳过上传（云端已有同名同大小份；省配额、避开 MOVE 覆盖语义差异）
    await autoPushAfterManualBackup(project);
    expect(putCount()).toBe(1);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBe(throttledAt);

    // 场景 B：**新**一份（手动备份刚生成的那份）→ 真的上传
    writeBackup(project, { kind: "manual", name: "新一份" });
    await autoPushAfterManualBackup(project);
    expect(putCount()).toBe(2);
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBe(throttledAt);
  });

  it("本机没有任何备份：跳过（不写 lastAutoPushError、零网络请求）", async () => {
    const base = Date.now();
    writeBookState(project.config.id, { lastSyncAt: new Date(base).toISOString() });
    writeAfter(AGENTS_FILE_NAME, base);

    expect(await maybeAutoPush(project)).toBe(false);
    await autoPushOnClose(project);
    // 手动备份后的路径**不查** backupStale（调用方刚生成备份）——这里没有备份，
    // 走到 pushBackup 的 404 分支：跳过而非失败（该分支的唯一可达用例）
    await autoPushAfterManualBackup(project);

    expect(calls).toEqual([]); // 「没有可推送的备份」在本地判定，先于任何网络动作
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBeUndefined();
  });
});

  it("失败标记的清除是**任何一次推送成功**就清（手动推送成功后台账不再残留）", async () => {
    // 先制造一条自动推送失败（云盘不可达）
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")));
    await maybeAutoPush(project); // 无变更/或失败都行——这里直接构造失败态
    stubDav(); // 恢复可用的假云盘
    writeBookState(project.config.id, {
      lastAutoPushError: { code: "CLOUD_UNREACHABLE", message: "旧失败", at: T0 },
    });
    expect(readBookState(project.config.id)?.lastAutoPushError?.code).toBe("CLOUD_UNREACHABLE");

    // 手动推送成功（走 pushBackup 的成功写）→ 标记应被清除
    writeBackup(project, { kind: "manual" }); // 推送需要一份本地备份
    await pushBackup(project);
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();
  });

  it("卡 B：有改动未进最新备份（backupStale）→ 定时与关闭项目路径都跳过（零网络请求、不写失败标记）", async () => {
    makeBackupAndBaseline(); // 写一份备份 + 把 lastSyncAt 设到 base
    // 让「最新改动」晚于最新备份：mtime = 备份时间戳 + 1ms（真实序：备份刚结束就改了一笔；不造未来 mtime）
    const backupAt = latestParseableBackupTime(project);
    expect(backupAt).not.toBeNull();
    writeAfter(join("sessions", "s1.jsonl"), backupAt!.getTime(), 1);
    expect(hasUnbackedChanges(project)).toBe(true);

    const before = putCount();
    expect(await maybeAutoPush(project)).toBe(false); // 定时路径跳过
    await autoPushOnClose(project); // 关闭项目路径跳过
    expect(putCount()).toBe(before); // 零 PUT
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined(); // 不是失败
    // 把该改动"收进"备份（mtime 回到过去 + 生成新份）→ 状态消除
    writeAfter(join("sessions", "s1.jsonl"), Date.now() - 60_000, 0);
    writeBackup(project, { kind: "manual" });
    expect(hasUnbackedChanges(project)).toBe(false);
  });

  it("卡 B：手动备份后的路径不受 backupStale 限制（刚生成的份必然最新）", async () => {
    makeBackupAndBaseline();
    writeBackup(project, { kind: "manual" }); // 模拟「手动备份成功」
    expect(hasUnbackedChanges(project)).toBe(false);
    const before = putCount();
    await autoPushAfterManualBackup(project);
    expect(putCount()).toBeGreaterThan(before); // 真的推了
  });

describe("hasAuthoringChangesSince：创作数据口径（排除 sessions/、含 AGENTS.md）", () => {
  it("只动 sessions/ → 不算创作变更（hasLocalEditsSince 仍算：关闭项目那次要带上聊天）", () => {
    const base = makeBackupAndBaseline();
    writeAfter(join("sessions", "s2.jsonl"), base);

    expect(hasAuthoringChangesSince(project, new Date(base))).toBe(false);
    expect(hasLocalEditsSince(project, new Date(base))).toBe(true);
  });

  it("动 outline.json（三文件）→ 算创作变更（卡 12.7b：创作数据 = 三文件 + AGENTS.md）", () => {
    const base = makeBackupAndBaseline();
    writeAfter(OUTLINE_FILE_NAME, base);

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

  it("生产装配（middleware 注册）：备份频率关闭 + autoPush 开启 + 改动已被最新备份涵盖 → 2h tick 真的推一次", async () => {
    changeCoveredByBackup(AGENTS_FILE_NAME); // 卡 B：有未备份改动时 tick 会跳过，这里造「已涵盖」
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

  it("生产装配：备份频率关闭 + 有改动未进最新备份 → 2h tick 跳过（零 PUT、不写失败标记）", async () => {
    makeBackupAndBaseline();
    const backupAt = latestParseableBackupTime(project);
    expect(backupAt).not.toBeNull();
    writeAfter(join("sessions", "s2.jsonl"), backupAt!.getTime(), 1); // 改动晚于最新备份（sessions/ 参与变更判定）
    const freqOff: ProjectContext = { ...project, config: { ...project.config, backup_frequency_minutes: null } };
    await import("../middleware/project.js");

    vi.useFakeTimers();
    startAutoBackup(freqOff);
    try {
      await vi.advanceTimersByTimeAsync(AUTO_PUSH_THROTTLE_MS);
    } finally {
      stopAutoBackup();
      vi.useRealTimers();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(putCount()).toBe(0);
    expect(readBookState(project.config.id)?.lastAutoPushError).toBeUndefined();
    expect(readBookState(project.config.id)?.lastAutoPushAt).toBeUndefined();
  });
});
