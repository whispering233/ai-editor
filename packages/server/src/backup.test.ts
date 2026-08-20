// 自动备份与恢复测试（B2.2 决策 27 + B2.5 决策 28）：
// 备份管道（有变更才备份/同毫秒去重/保留策略）、备份管理端点（列表/立即备份/restore）、
// 定时器生命周期（open 启/close 停/无变更跳过）；决策 28：自定义名称/旧格式兼容
// 契约来源：doc/api/endpoints.md「备份管理」节、doc/design/decisions.md 决策 27/28
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { zipSync } from "fflate";
import type { OutlineFileTree, ProjectFileConfig } from "@whispering233/ai-editor-shared";
import { parseBackupFileName } from "@whispering233/ai-editor-shared";
import {
  AGENTS_FILE_NAME,
  closeDatabase,
  DATA_DB_FILE_NAME,
  listSessions,
  openDatabase,
  OUTLINE_FILE_NAME,
  PROJECT_FILE_NAME,
  readAgentsFile,
  readProjectFile,
  SCHEMA_VERSION,
  setUserVersion,
  writeOutlineFile,
  writeProjectFile,
} from "@whispering233/ai-editor-db";
import { errorHandler } from "./middleware/error.js";
import { HttpError } from "./middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "./middleware/project.js";
import { projectRoutes, setProjectRoot } from "./routes/project.js";
import { BACKUPS_DIR_NAME, maybeAutoBackup, pruneBackups, renameBackup, writeBackup, writeProjectFilesFromBackup } from "./backup.js";

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
  return (parseBackupFileName(names[names.length - 1]) as NonNullable<ReturnType<typeof parseBackupFileName>>).time; // 升序取最后一个
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

  it("仅 data.db-wal 变更触发备份（F2：WAL 模式下普通写事务只追加 -wal 伴生文件、主文件 mtime 不动）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, { ...makeConfig("proj-wal", "wal 变更"), backup_frequency_minutes: 5 });
    await openProject(dir);
    const project = getCurrentProject() as NonNullable<ReturnType<typeof getCurrentProject>>;

    expect(maybeAutoBackup(project)).toBe(true); // 首备（.backups/ 为空）
    expect(backupFileNames(dir)).toHaveLength(1);

    // 模拟 WAL 写入：-wal 文件 mtime 置为「上次备份 + 2s」（超出 1s 容差；三主文件不碰）
    const walPath = join(dir, `${DATA_DB_FILE_NAME}-wal`);
    writeFileSync(walPath, ""); // 确保 wal 存在（SQLite 连接打开时可能尚无 wal 文件）
    const later = new Date(latestBackupTime(dir).getTime() + 2000);
    utimesSync(walPath, later, later);
    expect(maybeAutoBackup(project)).toBe(true); // 检测到 wal 变更 → 备份
    expect(backupFileNames(dir)).toHaveLength(2);
    // 备份管道 wal_checkpoint(TRUNCATE) 已把 wal mtime 刷新到备份时刻（容差内）→ 不持续误报；
    // 空 wal 文件（0 字节）存在且 mtime ≈ 备份时刻 → 判定无变更（wal 缺失语义见下用例）
    expect(maybeAutoBackup(project)).toBe(false);
    expect(backupFileNames(dir)).toHaveLength(2);
  });

  it("data.db-wal 缺失 ≠ 变更（F2：无未 checkpoint 的写属正常状态，不产生垃圾备份）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, { ...makeConfig("proj-wal-miss", "wal 缺失"), backup_frequency_minutes: 5 });
    await openProject(dir);
    const project = getCurrentProject() as NonNullable<ReturnType<typeof getCurrentProject>>;

    expect(maybeAutoBackup(project)).toBe(true); // 首备
    expect(backupFileNames(dir)).toHaveLength(1);

    // 删除 wal 文件（期间无任何 DB 操作，SQLite 不会重建路径）→ 判定无变更
    rmSync(join(dir, `${DATA_DB_FILE_NAME}-wal`), { force: true });
    expect(maybeAutoBackup(project)).toBe(false);
    expect(backupFileNames(dir)).toHaveLength(1);
  });
});

// ============ writeBackup / 保留策略 ============

describe("writeBackup 与保留策略", () => {
  it("同毫秒连续备份不覆盖：文件名时间戳 +1 毫秒去重（保持 <YYYYMMDD-HHmmssSSS>.zip 格式契约）", () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-dedup", "去重"));
    // 固定系统时间：两次 writeBackup 落在同一毫秒 → 第二个文件名 +1ms
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 13, 10, 15, 30, 0));
    const project = {
      root: dir,
      config: readProjectFile(dir) as ProjectFileConfig,
      db: openDatabase(join(dir, DATA_DB_FILE_NAME)),
    };
    try {
      const a = writeBackup(project);
      const b = writeBackup(project);
      expect(a.fileName).toBe("20260813-101530000.zip");
      expect(b.fileName).toBe("20260813-101530001.zip"); // +1ms 去重，格式仍可解析
      expect(parseBackupFileName(b.fileName)).not.toBeNull();
      expect(existsSync(join(dir, BACKUPS_DIR_NAME, a.fileName))).toBe(true);
      expect(existsSync(join(dir, BACKUPS_DIR_NAME, b.fileName))).toBe(true);
    } finally {
      closeDatabase(project.db);
    }
  });

  it("自定义名称备份（kind 缺省 auto → 文件名 <时间戳>-a-<名称>.zip，名称原样进响应；trim/剥 .zip 规范化）", () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-named", "自定义名"));
    const project = {
      root: dir,
      config: readProjectFile(dir) as ProjectFileConfig,
      db: openDatabase(join(dir, DATA_DB_FILE_NAME)),
    };
    try {
      const a = writeBackup(project, { name: "  定稿.zip  " });
      expect(a.fileName).toMatch(/^\d{8}-\d{9}-a-定稿\.zip$/);
      expect(a.kind).toBe("auto"); // kind 缺省 auto
      expect(a.name).toBe("定稿");
      expect(existsSync(join(dir, BACKUPS_DIR_NAME, a.fileName))).toBe(true);
      // 同毫秒同名称再备份 → +1ms 去重且名称保留
      const b = writeBackup(project, { name: "定稿" });
      expect(b.fileName).toMatch(/^\d{8}-\d{9}-a-定稿\.zip$/);
      expect(b.fileName).not.toBe(a.fileName);
      expect(b.kind).toBe("auto");
      expect(b.name).toBe("定稿");
    } finally {
      closeDatabase(project.db);
    }
  });

  it("manual kind：无名称 → <时间戳>-m.zip；带名称 → <时间戳>-m-<名称>.zip（决策 29）", () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-kind", "kind 段"));
    const project = {
      root: dir,
      config: readProjectFile(dir) as ProjectFileConfig,
      db: openDatabase(join(dir, DATA_DB_FILE_NAME)),
    };
    try {
      const a = writeBackup(project, { kind: "manual" });
      expect(a.fileName).toMatch(/^\d{8}-\d{9}-m\.zip$/);
      expect(a.kind).toBe("manual");
      expect(a).not.toHaveProperty("name");
      const b = writeBackup(project, { kind: "manual", name: "定稿" });
      expect(b.fileName).toMatch(/^\d{8}-\d{9}-m-定稿\.zip$/);
      expect(b.kind).toBe("manual");
      expect(b.name).toBe("定稿");
    } finally {
      closeDatabase(project.db);
    }
  });

  it("自定义名称非法 → 400 VALIDATION_ERROR（路径分隔符/超长/纯点）", () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-badname", "非法名"));
    const project = {
      root: dir,
      config: readProjectFile(dir) as ProjectFileConfig,
      db: openDatabase(join(dir, DATA_DB_FILE_NAME)),
    };
    try {
      for (const bad of ["a/b", "a\\b", "a:b", "..", "a".repeat(31), "a\nb"]) {
        expect(() => writeBackup(project, { name: bad })).toThrow(/备份名称非法/);
      }
      // 非法名称不产出备份文件
      expect(backupFileNames(dir)).toHaveLength(0);
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
    expect(backups[0]).toEqual({ fileName: "20260813-140000.zip", size: 1, createdAt: new Date(2026, 7, 13, 14, 0, 0).toISOString(), kind: "auto" });
    expect(backups[1].fileName).toBe("20260813-130000.zip");
    expect(backups[2].fileName).toBe("20260813-120000.zip");
  });

  it("POST /backup：立即备份返回 { backup: { fileName, size, createdAt, kind } }，文件落盘且 createdAt 与文件名解析一致（决策 29：手动备份落 -m 段）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-now", "立即备份"));
    const app = await openProject(dir);
    const res = await app.request("/api/v1/project/backup", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    const backup = body.data.backup;
    expect(backup.fileName).toMatch(/^\d{8}-\d{9}-m\.zip$/); // 决策 28 毫秒精度 + 决策 29 manual kind 段
    expect(backup.kind).toBe("manual");
    expect(typeof backup.size).toBe("number");
    expect(backup.size).toBeGreaterThan(0);
    // createdAt 由文件名时间戳解析（决策 27 无状态语义）
    expect(backup.createdAt).toBe(parseBackupFileName(backup.fileName)?.time.toISOString());
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, backup.fileName))).toBe(true);
  });

  it("POST /backup 带自定义名称：文件名 <时间戳>-m-<名称>.zip + 响应 name 字段（决策 28/29）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-named-ep", "端点自定义名"));
    const app = await openProject(dir);
    const res = await app.request("/api/v1/project/backup", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ name: "交编辑前" }),
    });
    expect(res.status).toBe(200);
    const backup = (await res.json()).data.backup;
    expect(backup.fileName).toMatch(/^\d{8}-\d{9}-m-交编辑前\.zip$/);
    expect(backup.kind).toBe("manual");
    expect(backup.name).toBe("交编辑前");
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, backup.fileName))).toBe(true);

    // GET /backups 列表项带 name 与 kind
    const listRes = await app.request("/api/v1/project/backups", { headers: HOST_HEADERS });
    const backups = (await listRes.json()).data.backups;
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({ fileName: backup.fileName, kind: "manual", name: "交编辑前" });
  });

  it("POST /backup 名称非法 → 400 VALIDATION_ERROR（路由层 zod 校验 + writeBackup sanitize）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-badname-ep", "端点非法名"));
    const app = await openProject(dir);
    for (const bad of ["a/b", "a: b", "..", "a".repeat(31)]) {
      const res = await app.request("/api/v1/project/backup", {
        method: "POST",
        headers: HOST_HEADERS,
        body: JSON.stringify({ name: bad }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
    // 无任何备份产出
    const listRes = await app.request("/api/v1/project/backups", { headers: HOST_HEADERS });
    expect((await listRes.json()).data.backups).toEqual([]);
  });

  it("GET /backups：旧秒级格式 kind auto 无 name；旧带名称（无 kind 段）kind manual 含 name；时间倒序（决策 28/29 兼容）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-legacy", "旧格式"));
    const app = await openProject(dir);
    const backupsDir = join(dir, BACKUPS_DIR_NAME);
    mkdirSync(backupsDir, { recursive: true });
    writeFileSync(join(backupsDir, "20260813-120000.zip"), "legacy"); // 旧秒级格式（手工遗留）→ kind auto
    writeFileSync(join(backupsDir, "20260813-130000999-初稿.zip"), "named"); // 旧带名称（无 kind 段）→ kind manual

    const res = await app.request("/api/v1/project/backups", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const backups = (await res.json()).data.backups;
    expect(backups).toHaveLength(2);
    expect(backups[0].fileName).toBe("20260813-130000999-初稿.zip"); // 最新在前
    expect(backups[0].kind).toBe("manual"); // 旧带名称兼容为 manual（决策 29）
    expect(backups[0].name).toBe("初稿");
    expect(backups[1].fileName).toBe("20260813-120000.zip"); // 旧格式兼容列出
    expect(backups[1].kind).toBe("auto"); // 旧秒级 → auto
    expect(backups[1]).not.toHaveProperty("name");
  });

  it("无当前项目时备份端点 → 409 NO_PROJECT_OPEN（与 /config 一致）", async () => {
    const app = buildApp();
    // GET 不带 body；POST 带请求体
    const getRes = await app.request("/api/v1/project/backups", { headers: HOST_HEADERS });
    expect(getRes.status).toBe(409);
    const postBackupRes = await app.request("/api/v1/project/backup", { method: "POST", headers: HOST_HEADERS });
    expect(postBackupRes.status).toBe(409);
    const renameRes = await app.request("/api/v1/project/backup/rename", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: "20260813-101500123.zip", name: "新名" }),
    });
    expect(renameRes.status).toBe(409);
    const restoreRes = await app.request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: "x.zip" }),
    });
    expect(restoreRes.status).toBe(409);
  });
});

// ============ renameBackup（决策 29：只改名称段，时间戳与 kind 保持） ============

describe("renameBackup", () => {
  /** 打开一个项目并返回其 ProjectContext（供 renameBackup 直接调用） */
  async function openProjectCtx(dir: string) {
    await openProject(dir);
    return getCurrentProject() as NonNullable<ReturnType<typeof getCurrentProject>>;
  }

  it("成功改名：kind/时间戳保持、名称更新、文件确实改名（manual -m-旧名 → -m-新名）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-rn1", "改名"));
    const project = await openProjectCtx(dir);
    const a = writeBackup(project, { kind: "manual", name: "旧名" });
    const res = renameBackup(project, a.fileName, "新名");
    expect(res.fileName).toBe(a.fileName.replace("-m-旧名.zip", "-m-新名.zip")); // 时间戳与 kind 段保持
    expect(res.kind).toBe("manual");
    expect(res.name).toBe("新名");
    expect(res.createdAt).toBe(a.createdAt);
    expect(res.size).toBe(a.size);
    // 文件确实改名：旧名消失、新名存在
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, a.fileName))).toBe(false);
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, res.fileName))).toBe(true);
  });

  it("幂等：重命名为相同名称 → 不报错、文件不动、返回当前条目（重新 stat 的 size）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-rn2", "幂等"));
    const project = await openProjectCtx(dir);
    const a = writeBackup(project, { kind: "manual", name: "旧名" });
    const res = renameBackup(project, a.fileName, "旧名");
    expect(res.fileName).toBe(a.fileName);
    expect(res.kind).toBe("manual");
    expect(res.name).toBe("旧名");
    expect(res.size).toBe(a.size);
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, a.fileName))).toBe(true); // 文件原样保留
  });

  it("清除名称：manual -m-名.zip → -m.zip（name 缺省）；auto -a-名.zip → 纯时间戳（name 空串）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-rn3", "清名"));
    const project = await openProjectCtx(dir);
    // manual：请求未传 name → 清除名称段（落 -m.zip）
    const m = writeBackup(project, { kind: "manual", name: "名" });
    const mRes = renameBackup(project, m.fileName);
    expect(mRes.fileName).toBe(m.fileName.replace("-m-名.zip", "-m.zip"));
    expect(mRes.kind).toBe("manual");
    expect(mRes).not.toHaveProperty("name");
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, m.fileName))).toBe(false);
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, mRes.fileName))).toBe(true);
    // auto：name 传空串 → 清除名称段（落纯时间戳）
    const a = writeBackup(project, { kind: "auto", name: "名" });
    const aRes = renameBackup(project, a.fileName, "");
    expect(aRes.fileName).toBe(a.fileName.replace("-a-名.zip", ".zip"));
    expect(aRes.kind).toBe("auto");
    expect(aRes).not.toHaveProperty("name");
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, aRes.fileName))).toBe(true);
  });

  it("纯空白名称 → 清除名称段（与空串/缺省同语义，oracle P2-5）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-rn3b", "空白清名"));
    const project = await openProjectCtx(dir);
    const m = writeBackup(project, { kind: "manual", name: "名" });
    const res = renameBackup(project, m.fileName, "   ");
    expect(res.fileName).toBe(m.fileName.replace("-m-名.zip", "-m.zip"));
    expect(res.kind).toBe("manual");
    expect(res).not.toHaveProperty("name");
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, m.fileName))).toBe(false);
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, res.fileName))).toBe(true);
  });

  it("目标文件名已存在 → 409 BACKUP_TARGET_EXISTS（oracle P1-1：rename 不静默覆盖）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-rn409", "目标冲突"));
    const project = await openProjectCtx(dir);
    const backupsDir = join(dir, BACKUPS_DIR_NAME);
    mkdirSync(backupsDir, { recursive: true });
    // 同毫秒双 manual：T-m-来源.zip（源）与 T-m-目标.zip（已存在目标）——改名撞名场景
    writeFileSync(join(backupsDir, "20260813-101500000-m-来源.zip"), "src");
    writeFileSync(join(backupsDir, "20260813-101500000-m-目标.zip"), "target");
    let err: unknown;
    try {
      renameBackup(project, "20260813-101500000-m-来源.zip", "目标");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    const he = err as HttpError;
    expect(he.status).toBe(409);
    expect(he.code).toBe("BACKUP_TARGET_EXISTS");
    expect(he.message).toContain("目标备份文件名已存在");
    // 数据零损失：源文件未被移动、目标文件原内容未被覆盖
    expect(existsSync(join(backupsDir, "20260813-101500000-m-来源.zip"))).toBe(true);
    expect(readFileSync(join(backupsDir, "20260813-101500000-m-目标.zip"), "utf8")).toBe("target");
  });

  it("旧格式兼容改名：旧秒级（kind auto）改名后落 -a- 段；旧带名称（kind manual）改名保持 -m- 段", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-rn4", "旧格式改名"));
    const project = await openProjectCtx(dir);
    const backupsDir = join(dir, BACKUPS_DIR_NAME);
    mkdirSync(backupsDir, { recursive: true });
    // 旧秒级（决策 27 遗留）→ 解析 kind auto（毫秒 = 0）→ 改名后 -a- 段（format 统一毫秒精度）
    writeFileSync(join(backupsDir, "20260813-101500.zip"), "legacy");
    const legacyRes = renameBackup(project, "20260813-101500.zip", "升级整理");
    expect(legacyRes.fileName).toBe("20260813-101500000-a-升级整理.zip");
    expect(legacyRes.kind).toBe("auto");
    expect(existsSync(join(backupsDir, "20260813-101500.zip"))).toBe(false);
    expect(existsSync(join(backupsDir, legacyRes.fileName))).toBe(true);
    // 旧带名称（决策 28 遗留）→ 解析 kind manual → 改名保持 -m- 段
    writeFileSync(join(backupsDir, "20260813-101500999-初稿.zip"), "named");
    const namedRes = renameBackup(project, "20260813-101500999-初稿.zip", "定稿");
    expect(namedRes.fileName).toBe("20260813-101500999-m-定稿.zip");
    expect(namedRes.kind).toBe("manual");
  });

  it("格式合法但备份不存在 → 404 VALIDATION_ERROR", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-rn404", "缺失"));
    const project = await openProjectCtx(dir);
    let err: unknown;
    try {
      renameBackup(project, "20260813-101500.zip", "新名");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    const he = err as HttpError;
    expect(he.status).toBe(404);
    expect(he.code).toBe("VALIDATION_ERROR");
    expect(he.message).toContain("备份不存在");
  });

  it("文件名格式非法 → 400 VALIDATION_ERROR（防路径穿越白名单）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-rn400", "非法名"));
    const project = await openProjectCtx(dir);
    for (const bad of ["../20260813-101500.zip", "a/20260813-101500.zip", "20260813-101500.zip/..", "20260813-10150.zip", "notes.txt", ""]) {
      let err: unknown;
      try {
        renameBackup(project, bad, "新名");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(HttpError);
      const he = err as HttpError;
      expect(he.status).toBe(400);
      expect(he.code).toBe("VALIDATION_ERROR");
      expect(he.message).toContain("文件名格式非法");
    }
  });

  it("新名称非法 → 400 VALIDATION_ERROR（路径分隔符/超长/纯点；文案同 writeBackup）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-rn400b", "非法名"));
    const project = await openProjectCtx(dir);
    const a = writeBackup(project, { kind: "manual", name: "旧名" });
    for (const bad of ["a/b", "a\\b", "a:b", "..", "a".repeat(31), "a\nb"]) {
      let err: unknown;
      try {
        renameBackup(project, a.fileName, bad);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(HttpError);
      const he = err as HttpError;
      expect(he.status).toBe(400);
      expect(he.code).toBe("VALIDATION_ERROR");
      expect(he.message).toContain("备份名称非法");
    }
    // 非法名称不产生改名副作用（原文件仍在）
    expect(existsSync(join(dir, BACKUPS_DIR_NAME, a.fileName))).toBe(true);
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

  it("覆盖时保留当前项目 id（决策 27：换 id 即断连 chat_messages 会话历史）；name 归一为目录名、prompt 随备份替换", async () => {
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
    // id 保留当前项目（proj-A）；name 归一为当前目录名（审核裁决：与 import 覆盖一致，
    // 维持「目录名 = 书名」不变式——id 是身份、name 是展示名，不再随备份包）；prompt 随备份包替换
    expect(readProjectFile(dirA)?.id).toBe("proj-A");
    expect(readProjectFile(dirA)?.name).toBe(basename(dirA)); // 归一为目录名（makeTmpDir 随机目录）
    expect(readProjectFile(dirA)?.name).not.toBe("书B"); // 不再使用备份包内 name
    expect(readProjectFile(dirA)?.prompt).toBe("B 的提示词");
  });

  it("restore 含遗留 prompt 的旧备份 → 覆盖路径触发 AGENTS.md 迁移（决策 41 oracle 评审修复）", async () => {
    const dirA = makeTmpDir();
    initProjectDir(dirA, makeConfig("proj-mig-restore", "书A")); // 无 prompt、无 AGENTS.md
    await openProject(dirA);

    // 异项目备份 B：project.json 含遗留 prompt（旧备份形态——决策 41 前创建的备份）
    const dirB = makeTmpDir();
    initProjectDir(dirB, { ...makeConfig("proj-B", "书B"), prompt: "B 的遗留提示词" });
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

    // 恢复前 A 无 AGENTS.md（open 未触发迁移——A 的 project.json 无 prompt）
    expect(readAgentsFile(dirA)).toBeNull();

    const res = await buildApp().request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: bkpB.fileName }),
    });
    expect(res.status).toBe(200);
    // 覆盖路径同步迁移：AGENTS.md 已创建（内容 = 备份内遗留 prompt，原样）
    expect(existsSync(join(dirA, AGENTS_FILE_NAME))).toBe(true);
    expect(readAgentsFile(dirA)).toBe("B 的遗留提示词");
  });

  it("跨项目恢复（P1-1）：chat_messages 会话归属迁移为当前项目 id，会话列表按当前 id 可查", async () => {
    const dirA = makeTmpDir();
    initProjectDir(dirA, makeConfig("proj-mig-a", "迁移书A"));
    await openProject(dirA);

    // 异项目备份 B：data.db 内含 B 的会话行（project_id = proj-mig-b）
    const dirB = makeTmpDir();
    initProjectDir(dirB, makeConfig("proj-mig-b", "迁移书B"));
    const dbB = openDatabase(join(dirB, DATA_DB_FILE_NAME));
    dbB.prepare("INSERT INTO chat_messages (id, session_id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "m-b1", "sess-b", "proj-mig-b", "user", "B 的消息 1", T0,
    );
    dbB.prepare("INSERT INTO chat_messages (id, session_id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "m-b2", "sess-b", "proj-mig-b", "assistant", "B 的消息 2", T0,
    );
    closeDatabase(dbB);
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

    // restore 异项目备份 → 会话归属迁移（旧 id → 当前 id；覆盖恢复语义：A 原数据被备份覆盖）
    const res = await buildApp().request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: bkpB.fileName }),
    });
    expect(res.status).toBe(200);

    // chat_messages 全部 project_id = 当前项目 id（B 的 2 行迁移；A 原数据已被覆盖）
    const dbA = openDatabase(join(dirA, DATA_DB_FILE_NAME));
    try {
      const rows = dbA.prepare("SELECT project_id FROM chat_messages ORDER BY id").all() as Array<{ project_id: string }>;
      expect(rows).toEqual([{ project_id: "proj-mig-a" }, { project_id: "proj-mig-a" }]);
      // 会话列表按当前 id 可查（决策 18：按 project_id 隔离——不迁移则 B 的会话静默消失）
      const sessions = listSessions(dbA, "proj-mig-a");
      expect(sessions.map((s) => s.id)).toEqual(["sess-b"]);
      expect(sessions[0]?.messageCount).toBe(2);
    } finally {
      closeDatabase(dbA);
    }
  });

  it("同项目恢复：不执行多余迁移（chat_messages 行保持原 project_id，行为不变）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-same", "同项目"));
    const app = await openProject(dir);
    // 插入当前项目会话行后备份（zip id = 当前 id）
    const db = openDatabase(join(dir, DATA_DB_FILE_NAME));
    db.prepare("INSERT INTO chat_messages (id, session_id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "m-1", "sess-1", "proj-same", "user", "消息", T0,
    );
    closeDatabase(db);
    const project = getCurrentProject() as NonNullable<ReturnType<typeof getCurrentProject>>;
    const bkp = writeBackup(project);

    const res = await app.request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: bkp.fileName }),
    });
    expect(res.status).toBe(200);
    // 行仍在且 project_id 不变（同 id 恢复跳过迁移）
    const dbAfter = openDatabase(join(dir, DATA_DB_FILE_NAME));
    try {
      const rows = dbAfter.prepare("SELECT project_id FROM chat_messages").all() as Array<{ project_id: string }>;
      expect(rows).toEqual([{ project_id: "proj-same" }]);
    } finally {
      closeDatabase(dbAfter);
    }
  });

  it("P1-2：文件替换失败日志输出已替换/未替换清单与覆盖前快照名", () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-log", "日志"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // 构造缺 outline.json 的 entries（绕过校验直接调用——模拟替换中途失败：
      // project.json 已替换成功、outline.json 抛错）
      const entries = {
        "project.json": new TextEncoder().encode(JSON.stringify(makeConfig("proj-log", "日志"))),
        "data.db": new Uint8Array([1, 2, 3]),
      } as unknown as Record<string, Uint8Array>;
      expect(() => writeProjectFilesFromBackup(dir, entries, { name: "日志", snapshotFileName: "20260813-000000.zip" })).toThrow();
      const log = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(log).toContain("project.json"); // 已替换清单
      expect(log).toContain("outline.json"); // 未替换清单
      expect(log).toContain("20260813-000000.zip"); // 覆盖前快照名
    } finally {
      errorSpy.mockRestore();
    }
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

  it("自定义名称备份可恢复（决策 28：restore 白名单兼容 <时间戳>-<名称>.zip）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, { ...makeConfig("proj-named-restore", "命名恢复"), prompt: "旧提示词" });
    const app = await openProject(dir);
    const project = getCurrentProject() as NonNullable<ReturnType<typeof getCurrentProject>>;

    // 带名称备份当前状态（kind 缺省 auto → -a- 段）
    const bkp = writeBackup(project, { name: "定稿前" });
    expect(bkp.fileName).toMatch(/^\d{8}-\d{9}-a-定稿前\.zip$/);

    // 修改内容后按自定义名称恢复
    writeProjectFile(dir, { ...readProjectFile(dir)!, prompt: "新提示词" });
    const res = await app.request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: bkp.fileName }),
    });
    expect(res.status).toBe(200);
    expect(readProjectFile(dir)?.prompt).toBe("旧提示词"); // 数据回滚
  });

  it("旧秒级格式备份可恢复（决策 28：restore 白名单兼容 <YYYYMMDD-HHmmss>.zip，升级前遗留）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, { ...makeConfig("proj-legacy-restore", "旧格式恢复"), prompt: "旧提示词" });
    const app = await openProject(dir);
    const project = getCurrentProject() as NonNullable<ReturnType<typeof getCurrentProject>>;

    // 生成合法备份后改名为旧秒级格式文件名（模拟升级前遗留的历史备份，zip 内容合法）
    const bkp = writeBackup(project);
    const legacyName = "20260813-101500.zip";
    renameSync(join(dir, BACKUPS_DIR_NAME, bkp.fileName), join(dir, BACKUPS_DIR_NAME, legacyName));

    // 修改内容后按旧格式名恢复 → 200 + 数据回滚
    writeProjectFile(dir, { ...readProjectFile(dir)!, prompt: "新提示词" });
    const res = await app.request("/api/v1/project/backup/restore", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ fileName: legacyName }),
    });
    expect(res.status).toBe(200);
    expect(readProjectFile(dir)?.prompt).toBe("旧提示词");
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
