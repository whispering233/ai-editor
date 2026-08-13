// 自动备份与恢复测试（B2.2，决策 27）：
// 备份管道（有变更才备份/同秒去重/保留策略）、备份管理端点（列表/立即备份/restore）、
// 定时器生命周期（open 启/close 停/无变更跳过）
// 契约来源：doc/api/endpoints.md「备份管理」节、doc/design/decisions.md 决策 27
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { zipSync } from "fflate";
import type { OutlineFileTree, ProjectFileConfig } from "@whispering233/ai-editor-shared";
import { parseBackupFileName } from "@whispering233/ai-editor-shared";
import {
  closeDatabase,
  DATA_DB_FILE_NAME,
  openDatabase,
  OUTLINE_FILE_NAME,
  PROJECT_FILE_NAME,
  readProjectFile,
  SCHEMA_VERSION,
  setUserVersion,
  writeOutlineFile,
  writeProjectFile,
} from "@whispering233/ai-editor-db";
import { errorHandler } from "./middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "./middleware/project.js";
import { projectRoutes, setProjectRoot } from "./routes/project.js";
import { BACKUPS_DIR_NAME, maybeAutoBackup, pruneBackups, writeBackup } from "./backup.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" }; // 来源校验 host 白名单（决策 17 修订）
const T0 = "2026-08-01T10:00:00Z";

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "bk-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（projectMiddleware 从 currentProject 单例注入） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/project", projectRoutes);
  return app;
}

/** 合法项目配置（手工构造；缺省不含 backup_frequency_minutes——读侧兜底 10） */
function makeConfig(id: string, name: string): ProjectFileConfig {
  return {
    id,
    name,
    language: "zh",
    prompt: "",
    schema_version: SCHEMA_VERSION,
    current_position: null,
    created_at: T0,
    updated_at: T0,
  };
}

/** 含非软删/软删节点的正常大纲（供 initProjectDir 与恢复断言用） */
function makeOutlineTree(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: SCHEMA_VERSION,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: T0,
        children: [
          {
            id: "ch-1",
            type: "chapter",
            title: "第一章",
            updated_at: T0,
            children: [{ id: "sc-1", type: "scene", title: "场景一", updated_at: T0 }],
          },
        ],
      },
    ],
  };
}

/** 构造「正常（版本匹配）项目」：project.json + outline.json + data.db（user_version=SCHEMA_VERSION） */
function initProjectDir(dir: string, config: ProjectFileConfig, outline: OutlineFileTree = makeOutlineTree()): void {
  mkdirSync(dir, { recursive: true });
  writeProjectFile(dir, config);
  writeOutlineFile(dir, outline);
  const db = openDatabase(join(dir, DATA_DB_FILE_NAME));
  setUserVersion(db, SCHEMA_VERSION);
  closeDatabase(db);
}

/** open 一个项目并返回测试 app（setCurrentProject 联动启动自动备份调度） */
async function openProject(dir: string): Promise<Hono> {
  const app = buildApp();
  const res = await app.request("/api/v1/project/open", {
    method: "POST",
    headers: HOST_HEADERS,
    body: JSON.stringify({ path: dir }),
  });
  expect(res.status).toBe(200);
  return app;
}

/** 当前项目 .backups/ 下可解析的备份文件名列表（按文件名升序 = 时间升序） */
function backupFileNames(dir: string): string[] {
  let files: string[];
  try {
    files = readdirSync(join(dir, BACKUPS_DIR_NAME));
  } catch {
    return []; // .backups/ 不存在
  }
  return files.filter((f) => parseBackupFileName(f) !== null).sort();
}

/** .backups/ 最新备份时间（文件名解析） */
function latestBackupTime(dir: string): Date {
  const names = backupFileNames(dir);
  expect(names.length).toBeGreaterThan(0);
  return parseBackupFileName(names[names.length - 1]) as Date; // 升序取最后一个
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-backup-"));
  setCurrentProject(null);
  setProjectRoot(null);
});

afterEach(() => {
  vi.useRealTimers(); // 复位 fake timers（部分用例使用）
  const cur = getCurrentProject();
  if (cur !== null) {
    closeProject(cur);
    setCurrentProject(null);
  }
  setProjectRoot(null);
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ============ maybeAutoBackup（有变更才备份，决策 27） ============

describe("maybeAutoBackup（有变更才备份）", () => {
  it(".backups/ 为空 → 备份；随后无变更 → 跳过（不产生垃圾备份）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, { ...makeConfig("proj-m", "变更判定"), backup_frequency_minutes: 5 });
    await openProject(dir);
    const project = getCurrentProject() as NonNullable<ReturnType<typeof getCurrentProject>>;

    expect(maybeAutoBackup(project)).toBe(true); // 首次：无上次备份时刻 → 需要备份
    expect(backupFileNames(dir)).toHaveLength(1);

    expect(maybeAutoBackup(project)).toBe(false); // 三文件 mtime 未变 → 跳过
    expect(backupFileNames(dir)).toHaveLength(1);
  });

  it("任一文件 mtime 晚于上次备份时刻 → 备份（mtime 判定，1s 容差内不误报）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, { ...makeConfig("proj-m2", "变更判定"), backup_frequency_minutes: 5 });
    await openProject(dir);
    const project = getCurrentProject() as NonNullable<ReturnType<typeof getCurrentProject>>;
    maybeAutoBackup(project);

    // 备份完成后 checkpoint 刷新了 data.db mtime（毫秒，落在文件名秒时间 + 1s 容差内）
    // → 不误判为变更
    expect(maybeAutoBackup(project)).toBe(false);

    // 用户修改 outline.json：mtime 置为「上次备份时刻 + 2s」（超出 1s 容差）→ 判定有变更
    const last = latestBackupTime(dir);
    const later = new Date(last.getTime() + 2000);
    utimesSync(join(dir, OUTLINE_FILE_NAME), later, later);
    expect(maybeAutoBackup(project)).toBe(true);
    expect(backupFileNames(dir)).toHaveLength(2);
  });

  it("频率关闭（null / 0 / 非枚举值）→ 不备份（决策 27 + B2.1 疑问裁决 2：读侧非枚举按关闭）", async () => {
    for (const freq of [null, 0, 7]) {
      const dir = makeTmpDir();
      initProjectDir(dir, { ...makeConfig("proj-off", "关闭备份"), backup_frequency_minutes: freq });
      await openProject(dir);
      const project = getCurrentProject() as NonNullable<ReturnType<typeof getCurrentProject>>;
      expect(maybeAutoBackup(project)).toBe(false);
      expect(backupFileNames(dir)).toHaveLength(0);
    }
  });
});

// ============ writeBackup / 保留策略 ============

describe("writeBackup 与保留策略", () => {
  it("同秒连续备份不覆盖：文件名时间戳 +1 秒去重（保持 <YYYYMMDD-HHmmss>.zip 格式契约）", () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-dedup", "去重"));
    // 固定系统时间：两次 writeBackup 落在同一秒 → 第二个文件名 +1s
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 13, 10, 15, 30));
    const project = {
      root: dir,
      config: readProjectFile(dir) as ProjectFileConfig,
      db: openDatabase(join(dir, DATA_DB_FILE_NAME)),
    };
    try {
      const a = writeBackup(project);
      const b = writeBackup(project);
      expect(a.fileName).toBe("20260813-101530.zip");
      expect(b.fileName).toBe("20260813-101531.zip"); // +1s 去重，格式仍可解析
      expect(parseBackupFileName(b.fileName)).not.toBeNull();
      expect(existsSync(join(dir, BACKUPS_DIR_NAME, a.fileName))).toBe(true);
      expect(existsSync(join(dir, BACKUPS_DIR_NAME, b.fileName))).toBe(true);
    } finally {
      closeDatabase(project.db);
    }
  });

  it("保留策略：超出 20 份删除最旧（按文件名时间戳排序）", () => {
    const dir = makeTmpDir();
    const backupsDir = join(dir, BACKUPS_DIR_NAME);
    mkdirSync(backupsDir, { recursive: true });
    // 手工造 25 份：20260813-000000.zip ~ 000024.zip（时间递增，000000 最旧）
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(backupsDir, `20260813-${String(i).padStart(6, "0")}.zip`), `fake-${i}`);
    }
    pruneBackups(backupsDir);
    const remaining = readdirSync(backupsDir).sort();
    expect(remaining).toHaveLength(20);
    expect(remaining[0]).toBe("20260813-000005.zip"); // 最旧 5 份（000000-000004）被删
    expect(remaining[19]).toBe("20260813-000024.zip");
  });

  it("非法文件名不参与保留判定（手工放入的非时间戳文件不受影响）", () => {
    const dir = makeTmpDir();
    const backupsDir = join(dir, BACKUPS_DIR_NAME);
    mkdirSync(backupsDir, { recursive: true });
    for (let i = 0; i < 21; i++) {
      writeFileSync(join(backupsDir, `20260813-${String(i).padStart(6, "0")}.zip`), "x");
    }
    writeFileSync(join(backupsDir, "notes.txt"), "非法文件"); // 不在白名单格式内
    pruneBackups(backupsDir);
    expect(existsSync(join(backupsDir, "notes.txt"))).toBe(true); // 非法文件不参与清理
    expect(readdirSync(backupsDir).filter((f) => f.endsWith(".zip"))).toHaveLength(20);
  });
});

// ============ 备份管理端点（endpoints.md「备份管理」节） ============

describe("GET /project/backups 与 POST /project/backup", () => {
  it("GET /backups：时间倒序（最新在前）+ fileName/size/createdAt；.backups/ 不存在 → 空数组", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-list", "列表"));
    const app = await openProject(dir);
    // 空 .backups/ → 空数组
    const emptyRes = await app.request("/api/v1/project/backups", { headers: HOST_HEADERS });
    expect(emptyRes.status).toBe(200);
    expect((await emptyRes.json()).data.backups).toEqual([]);

    // 手工造 3 份不同时间的备份（内容随意，列表不校验内容）
    const backupsDir = join(dir, BACKUPS_DIR_NAME);
    mkdirSync(backupsDir, { recursive: true });
    writeFileSync(join(backupsDir, "20260813-120000.zip"), "a");
    writeFileSync(join(backupsDir, "20260813-140000.zip"), "c");
    writeFileSync(join(backupsDir, "20260813-130000.zip"), "b");
    writeFileSync(join(backupsDir, "notes.txt"), "非法文件不展示");

    const res = await app.request("/api/v1/project/backups", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const backups = (await res.json()).data.backups;
    expect(backups).toHaveLength(3);
    expect(backups[0]).toEqual({ fileName: "20260813-140000.zip", size: 1, createdAt: new Date(2026, 7, 13, 14, 0, 0).toISOString() });
    expect(backups[1].fileName).toBe("20260813-130000.zip");
    expect(backups[2].fileName).toBe("20260813-120000.zip");
  });

  it("POST /backup：立即备份返回 { backup: { fileName, size, createdAt } }，文件落盘且 createdAt 与文件名解析一致", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-now", "立即备份"));
    const app = await openProject(dir);
    const res = await app.request("/api/v1/project/backup", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    const backup = body.data.backup;
    expect(backup.fileName).toMatch(/^\d{8}-\d{6}\.zip$/);
    expect(typeof backup.size).toBe("number");
    expect(backup.size).toBeGreaterThan(0);
    // createdAt 由文件名时间戳解析（决策 27 无状态语义）
    expect(backup.createdAt).toBe(parseBackupFileName(backup.fileName)?.toISOString());
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, backup.fileName))).toBe(true);
  });

  it("无当前项目时备份端点 → 409 NO_PROJECT_OPEN（与 /config 一致）", async () => {
    const app = buildApp();
    // GET 不带 body；POST 带请求体
    const getRes = await app.request("/api/v1/project/backups", { headers: HOST_HEADERS });
    expect(getRes.status).toBe(409);
    const postBackupRes = await app.request("/api/v1/project/backup", { method: "POST", headers: HOST_HEADERS });
    expect(postBackupRes.status).toBe(409);
    const restoreRes = await app.request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: "x.zip" }),
    });
    expect(restoreRes.status).toBe(409);
  });
});

// ============ POST /project/backup/restore ============

describe("POST /project/backup/restore", () => {
  it("全流程：覆盖前自动快照 → 校验 → 原子替换 → 数据回滚 + 快照留档 + 连接可用", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, { ...makeConfig("proj-r", "恢复书"), prompt: "旧提示词" });
    const app = await openProject(dir);
    const project = getCurrentProject() as NonNullable<ReturnType<typeof getCurrentProject>>;

    // 备份当前状态（内容 = 旧提示词）
    const bkp = writeBackup(project);
    // 修改内容（prompt + 大纲）
    const changedOutline: OutlineFileTree = { id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] };
    writeProjectFile(dir, { ...makeConfig("proj-r", "恢复书"), prompt: "新提示词" });
    writeOutlineFile(dir, changedOutline);

    // restore 旧备份
    const res = await app.request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: bkp.fileName }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      restored: true,
      snapshot: { fileName: expect.any(String), createdAt: expect.any(String) },
    });

    // 数据回滚：project.json 回到旧提示词、大纲恢复（非空树）
    expect(readProjectFile(dir)?.prompt).toBe("旧提示词");
    expect(readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8")).toContain("第一卷");
    // 覆盖前快照已生成并留档（后悔药，参与保留策略）
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, body.data.snapshot.fileName))).toBe(true);
    // 备份文件本身仍在（restore 不删除源备份）
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, bkp.fileName))).toBe(true);

    // 替换后连接可用：config 端点正常、可继续立即备份
    const cfg = await app.request("/api/v1/project/config", { headers: HOST_HEADERS });
    expect(cfg.status).toBe(200);
    const again = await app.request("/api/v1/project/backup", { method: "POST", headers: HOST_HEADERS });
    expect(again.status).toBe(200);
  });

  it("覆盖时保留当前项目 id（决策 27：换 id 即断连 chat_messages 会话历史）；name/prompt 随备份替换", async () => {
    const dirA = makeTmpDir();
    initProjectDir(dirA, makeConfig("proj-A", "书A"));
    await openProject(dirA);

    // 异项目备份：项目 B 的备份文件 copy 进 A 的 .backups/（手工构造跨项目恢复场景）
    const dirB = makeTmpDir();
    initProjectDir(dirB, { ...makeConfig("proj-B", "书B"), prompt: "B 的提示词" });
    const ctxB = {
      root: dirB,
      config: readProjectFile(dirB) as ProjectFileConfig,
      db: openDatabase(join(dirB, DATA_DB_FILE_NAME)),
    };
    const bkpB = writeBackup(ctxB);
    closeDatabase(ctxB.db);
    const backupsDirA = join(dirA, BACKUPS_DIR_NAME);
    mkdirSync(backupsDirA, { recursive: true });
    copyFileSync(join(dirB, BACKUPS_DIR_NAME, bkpB.fileName), join(backupsDirA, bkpB.fileName));

    const res = await buildApp().request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: bkpB.fileName }),
    });
    expect(res.status).toBe(200);
    // id 保留当前项目（proj-A）；name/prompt 随备份包（书B / B 的提示词）
    expect(readProjectFile(dirA)?.id).toBe("proj-A");
    expect(readProjectFile(dirA)?.name).toBe("书B");
    expect(readProjectFile(dirA)?.prompt).toBe("B 的提示词");
  });

  it("文件名白名单：路径分隔符/.. 拒绝 400（防路径穿越）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-x", "穿越"));
    const app = await openProject(dir);
    for (const bad of ["../20260813-101500.zip", "a/20260813-101500.zip", "..\\20260813-101500.zip", "20260813-101500.zip/..", ""]) {
      const res = await app.request("/api/v1/project/backup/restore", {
        method: "POST",
        headers: HOST_HEADERS,
        body: JSON.stringify({ fileName: bad }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("格式合法但备份不存在 → 404 VALIDATION_ERROR", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-404", "缺失"));
    const app = await openProject(dir);
    const res = await app.request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: "20260813-101500.zip" }), // 合法格式，.backups/ 内不存在
    });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("备份不存在");
  });

  it("坏包（缺文件）→ 400，数据零触碰（outline/project 未被污染）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-bad", "坏包"));
    const app = await openProject(dir);
    // 造坏包：只含 project.json 的 zip
    const badZip = zipSync({ [PROJECT_FILE_NAME]: readFileSync(join(dir, PROJECT_FILE_NAME)) });
    const backupsDir = join(dir, BACKUPS_DIR_NAME);
    mkdirSync(backupsDir, { recursive: true });
    writeFileSync(join(backupsDir, "20260813-101500.zip"), badZip);

    const outlineBefore = readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8");
    const configBefore = readFileSync(join(dir, PROJECT_FILE_NAME), "utf8");
    const res = await app.request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: "20260813-101500.zip" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("缺少文件");
    // 数据零触碰（快照管道只 checkpoint data.db，不碰 outline/project）
    expect(readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8")).toBe(outlineBefore);
    expect(readFileSync(join(dir, PROJECT_FILE_NAME), "utf8")).toBe(configBefore);
  });

  it("高版本备份（user_version > 当前，E4）→ 409 SCHEMA_VERSION_MISMATCH，零触碰", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-high", "高版本"));
    const app = await openProject(dir);
    // 造高版本 data.db：复制当前库 → setUserVersion(SCHEMA_VERSION + 1) → 打包
    const highDbPath = join(dir, "high-version.db");
    copyFileSync(join(dir, DATA_DB_FILE_NAME), highDbPath);
    const db = openDatabase(highDbPath);
    setUserVersion(db, SCHEMA_VERSION + 1);
    closeDatabase(db);
    const highZip = zipSync({
      [PROJECT_FILE_NAME]: readFileSync(join(dir, PROJECT_FILE_NAME)),
      [OUTLINE_FILE_NAME]: readFileSync(join(dir, OUTLINE_FILE_NAME)),
      [DATA_DB_FILE_NAME]: readFileSync(highDbPath),
    });
    const backupsDir = join(dir, BACKUPS_DIR_NAME);
    mkdirSync(backupsDir, { recursive: true });
    writeFileSync(join(backupsDir, "20260813-101500.zip"), highZip);

    const outlineBefore = readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8");
    const configBefore = readFileSync(join(dir, PROJECT_FILE_NAME), "utf8");
    const res = await app.request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: "20260813-101500.zip" }),
    });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("SCHEMA_VERSION_MISMATCH");
    expect(body.error.message).toContain("更高版本程序");
    expect(readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8")).toBe(outlineBefore);
    expect(readFileSync(join(dir, PROJECT_FILE_NAME), "utf8")).toBe(configBefore);
    // 校验失败后连接仍有效（未悬挂）
    const cfg = await app.request("/api/v1/project/config", { headers: HOST_HEADERS });
    expect(cfg.status).toBe(200);
  });
});

// ============ 自动定时器（跟随当前项目生命周期） ============

describe("自动定时器（open 启 / close 停 / 切换重启）", () => {
  it("open 后按频率自动备份：有变更才备份、无变更跳过、close 停止", async () => {
    vi.useFakeTimers();
    try {
      const dir = makeTmpDir();
      initProjectDir(dir, { ...makeConfig("proj-timer", "定时"), backup_frequency_minutes: 5 });
      const app = await openProject(dir);

      // 首个 tick：.backups/ 为空 → 备份
      vi.advanceTimersByTime(5 * 60_000);
      expect(backupFileNames(dir)).toHaveLength(1);

      // 无变更 → 跳过（不产生垃圾备份）
      vi.advanceTimersByTime(10 * 60_000);
      expect(backupFileNames(dir)).toHaveLength(1);

      // 有变更（outline.json mtime 置为上次备份 + 2s）→ 备份
      const last = latestBackupTime(dir);
      const later = new Date(last.getTime() + 2000);
      utimesSync(join(dir, OUTLINE_FILE_NAME), later, later);
      vi.advanceTimersByTime(5 * 60_000);
      expect(backupFileNames(dir)).toHaveLength(2);

      // close → 定时器停止
      const closeRes = await app.request("/api/v1/project/close", { method: "POST", headers: HOST_HEADERS });
      expect(closeRes.status).toBe(200);
      vi.advanceTimersByTime(30 * 60_000);
      expect(backupFileNames(dir)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("频率关闭的项目：open 后定时器不排程（advance 后无备份）", async () => {
    vi.useFakeTimers();
    try {
      const dir = makeTmpDir();
      initProjectDir(dir, { ...makeConfig("proj-off-timer", "关闭"), backup_frequency_minutes: null });
      await openProject(dir);
      vi.advanceTimersByTime(120 * 60_000);
      expect(backupFileNames(dir)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("切换项目：定时器重启（旧项目停止、新项目按自身频率排程）", async () => {
    vi.useFakeTimers();
    try {
      const dirA = makeTmpDir();
      initProjectDir(dirA, { ...makeConfig("proj-sw-a", "切换A"), backup_frequency_minutes: 5 });
      const dirB = makeTmpDir();
      initProjectDir(dirB, { ...makeConfig("proj-sw-b", "切换B"), backup_frequency_minutes: 30 });
      const app = await openProject(dirA);
      // A 的 tick（5 分钟）→ 备份 A
      vi.advanceTimersByTime(5 * 60_000);
      expect(backupFileNames(dirA)).toHaveLength(1);

      // 切到 B（open B 路由内部 setCurrentProject → 重启调度）
      const openB = await app.request("/api/v1/project/open", {
        method: "POST",
        headers: HOST_HEADERS,
        body: JSON.stringify({ path: dirB }),
      });
      expect(openB.status).toBe(200);
      // B 频率 30 分钟：5 分钟后 A 的调度已停（不产生新备份），B 未到 tick
      vi.advanceTimersByTime(5 * 60_000);
      expect(backupFileNames(dirA)).toHaveLength(1); // A 已停止
      expect(backupFileNames(dirB)).toHaveLength(0); // B 未到 30 分钟
      // 到 B 的 tick → 备份 B
      vi.advanceTimersByTime(25 * 60_000);
      expect(backupFileNames(dirB)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
