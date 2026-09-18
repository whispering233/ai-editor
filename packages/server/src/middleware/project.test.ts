// 项目上下文中间件测试（T6.1）：来源校验+ 自动初始化
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { ProjectFileConfig } from "@whispering233/ai-editor-shared";
import {
  closeDatabase,
  getUserVersion,
  openDatabase,
  SCHEMA_VERSION,
  setUserVersion,
  writeOutlineFile,
  writeProjectFile,
} from "@whispering233/ai-editor-db";
import { errorHandler } from "./error.js";
import {
  closeProject,
  detectProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
  type ProjectVariables,
} from "./project.js";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-editor-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  setCurrentProject(null); // 清理模块级 currentProject 单例（S1.2），防跨测试泄漏
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 组装带中间件的测试 app（projectMiddleware 从 currentProject 单例注入；initProject 保证有项目） */
function buildApp(root: string) {
  const project = initProject(root);
  setCurrentProject(project);
  const app = new Hono<{ Variables: ProjectVariables }>();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.get("/api/v1/health", (c) => c.json({ ok: true, root: c.get("project").root }));
  return { app, project };
}

describe("来源校验（host 白名单，不校验端口）", () => {
  it("Host 为本机白名单内通过", async () => {
    const { app } = buildApp(makeTmpDir());
    const res = await app.request("http://127.0.0.1:3456/api/v1/health", { headers: { host: "127.0.0.1:3456" } });
    expect(res.status).toBe(200);
    const res2 = await app.request("http://localhost:3456/api/v1/health", { headers: { host: "localhost:3456" } });
    expect(res2.status).toBe(200);
  });

  it("Host 白名单外拒绝 403 FORBIDDEN", async () => {
    const { app } = buildApp(makeTmpDir());
    const res = await app.request("http://evil.com:3456/api/v1/health");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "FORBIDDEN", message: expect.stringContaining("来源校验失败") },
    });
  });

  it("Origin 存在时校验 Origin（白名单内端口不同也通过——dev 态 Vite proxy :5173）", async () => {
    const { app } = buildApp(makeTmpDir());
    const res = await app.request("http://127.0.0.1:3456/api/v1/health", {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    expect(res.status).toBe(200);
  });

  it("Origin 为恶意站点时拒绝（即使 Host 合法）", async () => {
    const { app } = buildApp(makeTmpDir());
    const res = await app.request("http://127.0.0.1:3456/api/v1/health", {
      headers: { Origin: "http://evil.com" },
    });
    expect(res.status).toBe(403);
  });

  it("IPv6 本机 ::1 通过（去括号比对）", async () => {
    const { app } = buildApp(makeTmpDir());
    const res = await app.request("http://[::1]:3456/api/v1/health", { headers: { host: "[::1]:3456" } });
    expect(res.status).toBe(200);
  });
});

describe("项目检测与初始化（启动待命，不无条件初始化）", () => {
  it("空目录：detectProject 返回 null，且不创建任何文件（含目录）", () => {
    const dir = makeTmpDir();
    expect(detectProject(dir)).toBeNull();
 // 三文件均不存在（不初始化）
    expect(existsSync(join(dir, "project.json"))).toBe(false);
    expect(existsSync(join(dir, "outline.json"))).toBe(false);
    expect(existsSync(join(dir, "data.db"))).toBe(false);
  });

  it("不存在的嵌套目录：detectProject 返回 null 且不建目录（待命语义，修复前会建目录初始化）", () => {
    const dir = join(makeTmpDir(), "nested", "deep", "proj");
    expect(detectProject(dir)).toBeNull();
    expect(existsSync(dir)).toBe(false); // 目录未被创建
  });

  it("存在 project.json：detectProject 打开返回上下文（两次检测 id 一致、db 已打开）", () => {
    const dir = makeTmpDir();
    const p1 = initProject(dir);
    const id1 = p1.config.id;
    closeProject(p1);
 // 第二次检测（模拟重启后）：打开而非重复初始化
    const p2 = detectProject(dir);
    try {
      expect(p2).not.toBeNull();
      expect(p2!.config.id).toBe(id1); // id 跨启动稳定
      expect(p2!.db.open).toBe(true);
    } finally {
      closeProject(p2!);
    }
  });

  it("initProject 显式初始化：建嵌套目录 + 三文件 + proj- 前缀 id + schema_version 同步写库（create 路由语义）", () => {
 // 两级不存在的目录（父目录也不存在）——initProject 负责建目录（原 ensureProject mkdir 语义迁移至此）
    const dir = join(makeTmpDir(), "nested", "deep", "proj");
    const project = initProject(dir, { name: "指定名" });
    try {
 // 目录被创建
      expect(existsSync(dir)).toBe(true);
 // project.json：id/name/schema_version + config 覆盖参数生效
      const config = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
      expect(config.id).toMatch(/^proj-/);
      expect(config.name).toBe("指定名");
      expect(config.schema_version).toBeTypeOf("number");
      expect(config.current_position).toBeNull();
 // outline.json：空树 + schema_version 同步
      const outline = JSON.parse(readFileSync(join(dir, "outline.json"), "utf8"));
      expect(outline).toEqual({ id: "root", type: "root", schema_version: config.schema_version, children: [] });
 // data.db：SQLite 文件 + user_version 已写（S1.1 审核建议：避免 open 时无意义重建）
      const dbHead = readFileSync(join(dir, "data.db"));
      expect(dbHead.subarray(0, 15).toString("utf8")).toBe("SQLite format 3");
      expect(getUserVersion(project.db)).toBe(SCHEMA_VERSION);
    } finally {
      closeProject(project);
    }
  });
});

// ============ 启动路径的版本对齐（卡 2.8：开机直达不再跳过迁移） ============

const T0 = "2026-08-01T10:00:00Z";

/** 可迁移的旧版本号（当前版本 - 1）——模拟「上一版程序写的库」；
 * 注：本仓迁移存在数据型（如 007）与 DDL 型两类，此处用「当前 DDL 库 + 旧 user_version」
 * 模拟旧库（数据型迁移的忠实仿真；DDL 型迁移另有 routes/project.test.ts 的手建旧表用例） */
/** 可迁移的旧版本号——**最后一个「数据型」迁移（007 abilities→ability_panel）的前一版本 v6**；
 * 008 起为纯 DDL 迁移（document_records），数据型仿真的起点固定在 v6，否则 v7 库只剩 008 可跑、
 * 旧 abilities 不会被迁移（DDL 型迁移另有 routes/project.test.ts 的手建旧表用例） */
const PREV_VERSION = 6;

/** 造旧版本项目：project.json + outline.json + data.db（user_version=version，含一条旧 abilities 角色行） */
function seedLegacyProject(dir: string, version: number): void {
  mkdirSync(dir, { recursive: true });
  const config: ProjectFileConfig = {
    id: "proj-legacy",
    name: "旧库",
    language: "zh",
    schema_version: version,
    current_position: null,
    created_at: T0,
    updated_at: T0,
  };
  writeProjectFile(dir, config);
  writeOutlineFile(dir, { id: "root", type: "root", schema_version: version, children: [] });
  const db = openDatabase(join(dir, "data.db"));
  setUserVersion(db, version);
  db.prepare("INSERT INTO entities (id, type, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    "char-1",
    "character",
    "张三",
    JSON.stringify({ role: "主角", abilities: ["剑术", "炼丹"] }),
    T0,
    T0,
  );
  closeDatabase(db);
}

describe("启动路径的版本对齐（卡 2.8）", () => {
  it("旧版本库（可迁移）：开机直达即前向迁移——版本对齐 + abilities→ability_panel + 迁移前快照", () => {
    const dir = makeTmpDir();
    seedLegacyProject(dir, PREV_VERSION);

    const project = detectProject(dir);
    try {
      expect(project).not.toBeNull();
      expect(getUserVersion(project!.db)).toBe(SCHEMA_VERSION);
      const row = project!.db.prepare("SELECT data FROM entities WHERE id = 'char-1'").get() as { data: string };
      const data = JSON.parse(row.data) as Record<string, unknown>;
      expect(data.abilities).toBeUndefined();
      expect(data.ability_panel).toEqual([{ name: "能力", children: [{ name: "剑术" }, { name: "炼丹" }] }]);
    } finally {
      closeProject(project!);
    }
 // 迁移前自动快照：data.db.v{n}.{时间戳}.bak
    const snapshots = readdirSync(dir).filter(
      (f) => f.startsWith(`data.db.v${PREV_VERSION}.`) && f.endsWith(".bak"),
    );
    expect(snapshots).toHaveLength(1);
  });

  it("未来版本库：开机直达拒绝打开（回待命）——版本与数据零触碰、无备份生成", () => {
    const dir = makeTmpDir();
    const future = SCHEMA_VERSION + 1;
    seedLegacyProject(dir, future);

    expect(detectProject(dir)).toBeNull();

    const db = openDatabase(join(dir, "data.db"));
    try {
      expect(getUserVersion(db)).toBe(future); // 版本未被改写
      const count = db.prepare("SELECT COUNT(*) AS n FROM entities").get() as { n: number };
      expect(count.n).toBe(1); // 数据仍在（未重建、未清空）
    } finally {
      closeDatabase(db);
    }
    expect(readdirSync(dir).some((f) => f.endsWith(".bak"))).toBe(false);
  });

  it("无迁移路径的旧库（user_version=0）：开机直达走删库重建兜底——备份 + 版本对齐 + 数据清空", () => {
    const dir = makeTmpDir();
    seedLegacyProject(dir, 0);

    const project = detectProject(dir);
    try {
      expect(project).not.toBeNull();
      expect(getUserVersion(project!.db)).toBe(SCHEMA_VERSION);
      const count = project!.db.prepare("SELECT COUNT(*) AS n FROM entities").get() as { n: number };
      expect(count.n).toBe(0);
    } finally {
      closeProject(project!);
    }
    const files = readdirSync(dir);
    expect(files).toContain("data.db.v0.bak");
    expect(files).toContain("outline.json.v0.bak");
  });
});

// ============ 全新空库（卡 2.9：缺 data.db 的书不得被重建 + 重置大纲） ============

/** 造「缺 data.db 的书」：project.json + 有内容的 outline.json，不建 data.db */
function seedBookWithoutDb(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const config: ProjectFileConfig = {
    id: "proj-nodb",
    name: "无库书",
    language: "zh",
    schema_version: SCHEMA_VERSION,
    current_position: null,
    created_at: T0,
    updated_at: T0,
  };
  writeProjectFile(dir, config);
  writeOutlineFile(dir, {
    id: "root",
    type: "root",
    schema_version: SCHEMA_VERSION,
    children: [{ id: "vol-1", type: "volume", title: "第一卷", updated_at: T0, children: [] }],
  });
}

describe("全新空库（卡 2.9：缺 data.db 的书）", () => {
  it("开机直达缺 data.db 的书：就地建库写版本号——大纲不被重置、无 .bak 产物", () => {
    const dir = makeTmpDir();
    seedBookWithoutDb(dir);
    const outlineRawBefore = readFileSync(join(dir, "outline.json"), "utf8");

    const project = detectProject(dir);
    try {
      expect(project).not.toBeNull();
      expect(getUserVersion(project!.db)).toBe(SCHEMA_VERSION);
 // 大纲原样（修复前：无迁移路径 → 删库重建 → 重置为空树）
      expect(readFileSync(join(dir, "outline.json"), "utf8")).toBe(outlineRawBefore);
 // 无 .bak 产物（无数据可备）
      expect(readdirSync(dir).filter((f) => f.endsWith(".bak"))).toEqual([]);
    } finally {
      closeProject(project!);
    }
  });
});
