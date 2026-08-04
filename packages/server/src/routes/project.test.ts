// 项目路由测试（S1.2）：create / open（含 schema 删库重建）/ close / config GET/PUT
// 覆盖：三文件初始化与版本号写入、路径校验（相对路径/符号链接）、版本不匹配重建 + 备份、
//       currentProject 单例切换与清空、current_position 非软删节点校验
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { unzipSync, zipSync } from "fflate";
import type { OutlineFileTree, ProjectFileConfig } from "@whispering233/ai-editor-shared";
import {
  closeDatabase,
  DATA_DB_FILE_NAME,
  getUserVersion,
  openDatabase,
  OUTLINE_FILE_NAME,
  PROJECT_FILE_NAME,
  SCHEMA_VERSION,
  setUserVersion,
} from "@whispering233/ai-editor-db";
import { PROJECT_EXPORT_FILE_NAMES } from "@whispering233/ai-editor-shared/schemas";
import { readOutlineFile, readProjectFile, writeOutlineFile, writeProjectFile } from "@whispering233/ai-editor-db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { projectRoutes, setProjectRoot } from "./project.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" }; // 来源校验 host 白名单（决策 17 修订）
const T0 = "2026-08-01T10:00:00Z";

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "proj-"));
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

/** 合法项目配置（手工构造，供 seed 旧版本项目用） */
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

/**
 * 构造「旧版本项目」：project.json + outline.json（含脏数据）+ data.db（user_version=0，旧版）
 * ——open 时应触发删库重建（决策 13 修订）
 */
function seedOldProject(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeProjectFile(dir, makeConfig("proj-old", "旧项目"));
  writeOutlineFile(dir, {
    id: "root",
    type: "root",
    schema_version: 1,
    children: [{ id: "vol-1", type: "volume", title: "第一卷", updated_at: T0, children: [] }],
  });
  const db = openDatabase(join(dir, "data.db")); // 新库 user_version=0 = 旧版本
  db.prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "char-1", "character", "旧角色", T0, T0,
  );
  closeDatabase(db);
}

/** 含非软删/软删节点的正常大纲（供 current_position 校验） */
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
          { id: "ch-2", type: "chapter", title: "已删章", updated_at: T0, deleted: true, deleted_at: T0 },
        ],
      },
    ],
  };
}

/**
 * 构造「正常（版本匹配）项目」：project.json + outline.json + data.db（user_version=SCHEMA_VERSION）
 * ——open 时不触发重建，可正常用于 config 等用例
 */
function initProjectDir(dir: string, config: ProjectFileConfig, outline: OutlineFileTree = makeOutlineTree()): void {
  mkdirSync(dir, { recursive: true });
  writeProjectFile(dir, config);
  writeOutlineFile(dir, outline);
  const db = openDatabase(join(dir, "data.db"));
  setUserVersion(db, SCHEMA_VERSION); // 版本匹配（决策 13：以 user_version 为准）
  closeDatabase(db);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-project-"));
  setCurrentProject(null);
  setProjectRoot(null);
});

afterEach(() => {
  // 清理 currentProject 单例：仍开着的连接先释放
  const cur = getCurrentProject();
  if (cur !== null) {
    closeProject(cur);
    setCurrentProject(null);
  }
  setProjectRoot(null); // 清理创作根模块状态（S1.5），防跨测试泄漏
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ============ POST /api/v1/project/create ============

describe("POST /project/create", () => {
  it("新目录初始化三文件：proj- 前缀 id、schema_version 同步写 project.json/outline.json/data.db", async () => {
    const dir = makeTmpDir(); // 目录已存在（空）；另外验证「目录不存在时自动创建」见下一用例
    const res = await buildApp().request("/api/v1/project/create", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { id: expect.stringMatching(/^proj-/), path: dir, created: true },
    });
    // project.json：proj- 前缀 id + schema_version
    const config = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
    expect(config.id).toMatch(/^proj-/);
    expect(config.schema_version).toBe(SCHEMA_VERSION);
    // outline.json：空树 + 同步 schema_version
    expect(readOutlineFile(dir)).toEqual({ id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] });
    // data.db：user_version 已写（S1.1 审核建议：避免 open 时无意义重建）
    const db = openDatabase(join(dir, "data.db"));
    try {
      expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    } finally {
      closeDatabase(db);
    }
  });

  it("目录不存在时自动创建（mkdir recursive）后初始化", async () => {
    const dir = join(makeTmpDir(), "nested", "new-project"); // 两级不存在
    const res = await buildApp().request("/api/v1/project/create", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(200);
    expect(readProjectFile(dir)?.id).toMatch(/^proj-/);
  });

  it("config 覆盖参数生效：name/language/prompt 写入 project.json 且 updated_at 刷新", async () => {
    const dir = makeTmpDir();
    const res = await buildApp().request("/api/v1/project/create", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir, config: { name: "指定名", language: "en", prompt: "力量体系" } }),
    });
    expect(res.status).toBe(200);
    const config = readProjectFile(dir);
    expect(config?.name).toBe("指定名");
    expect(config?.language).toBe("en");
    expect(config?.prompt).toBe("力量体系");
    expect(config?.updated_at).not.toBe(T0);
  });

  it("目录已是项目（含 project.json）→ 409 PROJECT_ALREADY_EXISTS（create 不幂等复用）", async () => {
    const dir = makeTmpDir();
    writeProjectFile(dir, makeConfig("proj-1", "已有"));
    const res = await buildApp().request("/api/v1/project/create", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "PROJECT_ALREADY_EXISTS", message: expect.stringContaining("已是项目") },
    });
  });

  it("相对路径 → 400 INVALID_PROJECT_PATH（契约要求绝对路径，拒绝 cwd 折叠歧义）", async () => {
    const res = await buildApp().request("/api/v1/project/create", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: "../escape" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "INVALID_PROJECT_PATH", message: expect.stringContaining("绝对路径") },
    });
  });

  it("符号链接指向项目目录之外 → 400 INVALID_PROJECT_PATH（决策 17 防越权）", async () => {
    const outside = makeTmpDir();
    const linkDir = join(makeTmpDir(), "link-out");
    symlinkSync(outside, linkDir); // 链接指向外部目录
    const res = await buildApp().request("/api/v1/project/create", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: linkDir }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "INVALID_PROJECT_PATH", message: expect.stringContaining("符号链接") },
    });
  });

  it("create 不打开项目：currentProject 保持 null", async () => {
    const dir = makeTmpDir();
    await buildApp().request("/api/v1/project/create", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(getCurrentProject()).toBeNull();
  });
});

// ============ POST /api/v1/project/open ============

describe("POST /project/open", () => {
  it("正常打开：返回 id/name/language/config 全量（currentPosition 映射 current_position）", async () => {
    const dir = makeTmpDir();
    const project = { ...makeConfig("proj-9", "我的小说"), current_position: "sc-1", prompt: "提示词" };
    initProjectDir(dir, project);

    const res = await buildApp().request("/api/v1/project/open", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("proj-9");
    expect(body.data.name).toBe("我的小说");
    expect(body.data.language).toBe("zh");
    expect(body.data.config).toEqual({
      id: "proj-9",
      name: "我的小说",
      language: "zh",
      prompt: "提示词",
      schemaVersion: SCHEMA_VERSION,
      currentPosition: "sc-1",
      createdAt: T0,
      updatedAt: T0,
    });
    expect(body.data.rebuilt).toBeUndefined();
    // currentProject 已切换为该项目
    expect(getCurrentProject()?.root).toBe(dir);
  });

  it("版本不匹配（user_version=0 旧库）→ 删库重建：rebuilt 提示 + 备份文件 + 数据清空 + outline 重置", async () => {
    const dir = makeTmpDir();
    seedOldProject(dir); // data.db user_version=0 + 1 行实体 + 非空大纲

    const res = await buildApp().request("/api/v1/project/open", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 向客户端提示已重建（endpoints.md 第 69 行；附加字段，shared openResSchema 未含）
    expect(body.data.rebuilt).toBe(true);
    expect(body.data.fromVersion).toBe(0);
    // 备份文件存在（决策 13：data.db.v0.bak + outline.json.v0.bak）
    expect(readFileSync(join(dir, "data.db.v0.bak")).subarray(0, 15).toString("utf8")).toBe("SQLite format 3");
    const oldOutline = JSON.parse(readFileSync(join(dir, "outline.json.v0.bak"), "utf8"));
    expect(oldOutline.children).toHaveLength(1); // 旧大纲留档
    // 重建后：新库版本号正确、表空（回收站天然清空）、outline 重置为空树
    const active = getCurrentProject();
    expect(active?.db !== undefined).toBe(true);
    const count = active!.db.prepare("SELECT COUNT(*) AS c FROM entities").get() as { c: number };
    expect(count.c).toBe(0);
    expect(readOutlineFile(dir)).toEqual({ id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] });
  });

  it("目录不含 project.json → 400 INVALID_PROJECT_PATH（open 必须含 project.json，endpoints.md 第 65 行）", async () => {
    const dir = makeTmpDir(); // 空目录
    const res = await buildApp().request("/api/v1/project/open", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "INVALID_PROJECT_PATH", message: expect.stringContaining("project.json") },
    });
  });

  it("目录不存在 → 400 INVALID_PROJECT_PATH", async () => {
    const dir = join(makeTmpDir(), "no-such-dir");
    const res = await buildApp().request("/api/v1/project/open", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "INVALID_PROJECT_PATH", message: expect.stringContaining("不存在") },
    });
  });

  it("open 切换语义：旧项目连接被释放，新项目成为 currentProject", async () => {
    const dirA = makeTmpDir();
    initProjectDir(dirA, makeConfig("proj-a", "项目A"));
    const dirB = makeTmpDir();
    initProjectDir(dirB, makeConfig("proj-b", "项目B"));

    const app = buildApp();
    await app.request("/api/v1/project/open", { method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ path: dirA }) });
    const first = getCurrentProject();
    const firstDbOpen = first!.db.open;

    await app.request("/api/v1/project/open", { method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ path: dirB }) });
    const second = getCurrentProject();

    expect(firstDbOpen).toBe(true); // 打开 A 时连接有效
    expect(first!.db.open).toBe(false); // 切到 B 后 A 连接已释放
    expect(second?.root).toBe(dirB);
  });

  it("未来版本（user_version > SCHEMA_VERSION）→ 409 PROJECT_VERSION_NEWER：拒绝打开、数据未动、无备份生成（E4 堵降级数据丢失）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-future", "未来项目"));
    // 模拟更高版本程序创建的库：user_version = SCHEMA_VERSION + 1
    const db = openDatabase(join(dir, "data.db"));
    setUserVersion(db, SCHEMA_VERSION + 1);
    closeDatabase(db);
    const outlineBefore = readFileSync(join(dir, "outline.json"), "utf8");

    const res = await buildApp().request("/api/v1/project/open", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "PROJECT_VERSION_NEWER", message: expect.stringContaining("高于当前程序版本") },
    });
    // open 失败 = 操作未生效：单例保持 null（无项目被打开）
    expect(getCurrentProject()).toBeNull();
    // 数据原封不动：outline.json 字节原样、无 .bak 备份、user_version 未被改动（未触发重建）
    expect(readFileSync(join(dir, "outline.json"), "utf8")).toBe(outlineBefore);
    expect(existsSync(join(dir, "data.db.v0.bak"))).toBe(false);
    expect(existsSync(join(dir, "outline.json.v0.bak"))).toBe(false);
    const reopened = openDatabase(join(dir, "data.db"));
    try {
      expect(getUserVersion(reopened)).toBe(SCHEMA_VERSION + 1);
    } finally {
      closeDatabase(reopened);
    }
  });

  it("open 失败（重建中途备份失败）不影响当前项目：单例保持旧项目且连接有效（oracle 建议 1）", async () => {
    // 正常项目 A 先打开
    const dirA = makeTmpDir();
    initProjectDir(dirA, makeConfig("proj-a", "项目A"));
    const app = buildApp();
    await app.request("/api/v1/project/open", { method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ path: dirA }) });
    expect(getCurrentProject()?.root).toBe(dirA);

    // 失败项目 B：旧版本（user_version=0 触发重建），且把备份目标 data.db.v0.bak 预建为目录
    // → backupDbFile 的 copyFileSync 复制到目录抛 EISDIR → rebuildProjectStorage 中途失败
    const dirB = makeTmpDir();
    seedOldProject(dirB);
    mkdirSync(join(dirB, "data.db.v0.bak"), { recursive: true });

    const res = await app.request("/api/v1/project/open", { method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ path: dirB }) });
    expect(res.status).toBe(500); // errorHandler → INTERNAL_ERROR

    // open 失败 = 操作未生效：单例仍指向 A，且连接保持有效（不悬挂关闭连接）
    expect(getCurrentProject()?.root).toBe(dirA);
    expect(getCurrentProject()?.db.open).toBe(true);
    // 业务请求仍可用
    const cfgRes = await app.request("/api/v1/project/config", { headers: HOST_HEADERS });
    expect(cfgRes.status).toBe(200);
    expect((await cfgRes.json()).data.id).toBe("proj-a");
  });

  it("open 失败后单例干净：无当前项目时 open 失败 → 单例保持 null（不悬挂）", async () => {
    const dir = makeTmpDir();
    seedOldProject(dir);
    mkdirSync(join(dir, "data.db.v0.bak"), { recursive: true }); // 备份目标为目录 → 重建失败

    const res = await buildApp().request("/api/v1/project/open", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(500);
    expect(getCurrentProject()).toBeNull(); // 无悬挂（旧代码此处会悬挂指向已关连接）
  });

  it("open 失败（openDatabase 阶段：data.db 为目录）也不影响当前项目", async () => {
    const dirA = makeTmpDir();
    initProjectDir(dirA, makeConfig("proj-a", "项目A"));
    const app = buildApp();
    await app.request("/api/v1/project/open", { method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ path: dirA }) });

    // B：project.json 合法但 data.db 是目录 → openDatabase 抛 SQLITE_CANTOPEN
    const dirB = makeTmpDir();
    initProjectDir(dirB, makeConfig("proj-b", "项目B"));
    rmSync(join(dirB, "data.db"), { force: true });
    mkdirSync(join(dirB, "data.db"));

    const res = await app.request("/api/v1/project/open", { method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ path: dirB }) });
    expect(res.status).toBe(500);
    // 单例保持 A、连接有效
    expect(getCurrentProject()?.root).toBe(dirA);
    expect(getCurrentProject()?.db.open).toBe(true);
  });
});

// ============ POST /api/v1/project/close ============

describe("POST /project/close", () => {
  it("关闭后 currentProject 清空、连接释放；重复 close 幂等返回 saved:true", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-c", "项目"));
    const app = buildApp();
    await app.request("/api/v1/project/open", { method: "POST", headers: HOST_HEADERS, body: JSON.stringify({ path: dir }) });
    const opened = getCurrentProject()!;
    expect(opened.db.open).toBe(true);

    const res = await app.request("/api/v1/project/close", { method: "POST", headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { saved: true } });
    expect(getCurrentProject()).toBeNull();
    expect(opened.db.open).toBe(false); // 连接已释放

    // 幂等：无当前项目时 close 仍返回 saved:true
    const res2 = await app.request("/api/v1/project/close", { method: "POST", headers: HOST_HEADERS });
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ success: true, data: { saved: true } });
  });
});

// ============ GET/PUT /api/v1/project/config ============

describe("GET/PUT /project/config", () => {
  /** open 一个正常项目并返回测试 app */
  async function openProject(dir: string): Promise<Hono> {
    initProjectDir(dir, makeConfig("proj-cfg", "配置项目"));
    const app = buildApp();
    const res = await app.request("/api/v1/project/open", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    expect(res.status).toBe(200);
    return app;
  }

  it("无当前项目时 GET /config → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp().request("/api/v1/project/config", { headers: HOST_HEADERS });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "NO_PROJECT_OPEN", message: expect.stringContaining("open") },
    });
  });

  it("GET 读回全量配置（camelCase 映射：schemaVersion/currentPosition/createdAt/updatedAt）", async () => {
    const dir = makeTmpDir();
    const app = await openProject(dir);
    const res = await app.request("/api/v1/project/config", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        id: "proj-cfg",
        name: "配置项目",
        language: "zh",
        prompt: "",
        schemaVersion: SCHEMA_VERSION,
        currentPosition: null,
        createdAt: T0,
        updatedAt: T0,
      },
    });
  });

  it("PUT 更新 name/prompt/language → updated:true，GET 读回新值，project.json updated_at 刷新", async () => {
    const dir = makeTmpDir();
    const app = await openProject(dir);

    const res = await app.request("/api/v1/project/config", {
      method: "PUT",
      headers: HOST_HEADERS,
      body: JSON.stringify({ name: "新名字", prompt: "新提示词", language: "en" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { updated: true } });

    const getRes = await app.request("/api/v1/project/config", { headers: HOST_HEADERS });
    const body = await getRes.json();
    expect(body.data.name).toBe("新名字");
    expect(body.data.prompt).toBe("新提示词");
    expect(body.data.language).toBe("en");
    expect(body.data.updatedAt).not.toBe(T0);
    // 盘上同步（写入 project.json）
    expect(readProjectFile(dir)?.name).toBe("新名字");
  });

  it("PUT current_position 指向存在的非软删节点 → 更新成功", async () => {
    const dir = makeTmpDir();
    const app = await openProject(dir);
    const res = await app.request("/api/v1/project/config", {
      method: "PUT",
      headers: HOST_HEADERS,
      body: JSON.stringify({ current_position: "sc-1" }),
    });
    expect(res.status).toBe(200);
    const getRes = await app.request("/api/v1/project/config", { headers: HOST_HEADERS });
    expect((await getRes.json()).data.currentPosition).toBe("sc-1");
  });

  it("PUT current_position 指向不存在的节点 → 400 OUTLINE_NODE_NOT_FOUND", async () => {
    const dir = makeTmpDir();
    const app = await openProject(dir);
    const res = await app.request("/api/v1/project/config", {
      method: "PUT",
      headers: HOST_HEADERS,
      body: JSON.stringify({ current_position: "sc-999" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "OUTLINE_NODE_NOT_FOUND", message: expect.stringContaining("sc-999") },
    });
  });

  it("PUT current_position 指向软删节点 → 400 OUTLINE_NODE_NOT_FOUND（endpoints.md 第 115 行：非软删）", async () => {
    const dir = makeTmpDir();
    const app = await openProject(dir);
    const res = await app.request("/api/v1/project/config", {
      method: "PUT",
      headers: HOST_HEADERS,
      body: JSON.stringify({ current_position: "ch-2" }), // makeOutlineTree 中 deleted: true
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "OUTLINE_NODE_NOT_FOUND", message: expect.stringContaining("软删") },
    });
  });

  it("PUT current_position: null 允许（清除当前位置）", async () => {
    const dir = makeTmpDir();
    const app = await openProject(dir);
    // 先设一个合法值，再清空
    await app.request("/api/v1/project/config", {
      method: "PUT",
      headers: HOST_HEADERS,
      body: JSON.stringify({ current_position: "sc-1" }),
    });
    const res = await app.request("/api/v1/project/config", {
      method: "PUT",
      headers: HOST_HEADERS,
      body: JSON.stringify({ current_position: null }),
    });
    expect(res.status).toBe(200);
    const getRes = await app.request("/api/v1/project/config", { headers: HOST_HEADERS });
    expect((await getRes.json()).data.currentPosition).toBeNull();
  });

  it("无当前项目时 PUT /config → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp().request("/api/v1/project/config", {
      method: "PUT",
      headers: HOST_HEADERS,
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(409);
  });
});

// ============ GET /api/v1/project/list（书架模式 S1.5） ============

describe("GET /project/list（书架：创作根 books/ 扫描）", () => {
  /** 在创作根下造一本书（books/<name>/ 含 project.json，updated_at 可控） */
  function seedBook(root: string, name: string, updatedAt: string): string {
    const dir = join(root, "books", name);
    mkdirSync(dir, { recursive: true });
    writeProjectFile(dir, { ...makeConfig(`proj-${name}`, name), updated_at: updatedAt });
    return dir;
  }

  it("books/ 下两本书 → 返回两条（name/path/updatedAt），按 updatedAt 倒序", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    seedBook(root, "第一本", "2026-08-01T10:00:00Z");
    seedBook(root, "第二本", "2026-08-02T10:00:00Z");

    const res = await buildApp().request("/api/v1/project/list", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.rootPath).toBe(root);
    expect(body.data.books).toEqual([
      { name: "第二本", path: join(root, "books", "第二本"), updatedAt: "2026-08-02T10:00:00Z" },
      { name: "第一本", path: join(root, "books", "第一本"), updatedAt: "2026-08-01T10:00:00Z" },
    ]);
  });

  it("books/ 不存在 → 空数组（不报错），rootPath 仍返回创作根", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    const res = await buildApp().request("/api/v1/project/list", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { rootPath: root, books: [] } });
  });

  it("非书目录（无 project.json）与普通文件被过滤", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    seedBook(root, "真书", "2026-08-01T10:00:00Z");
    mkdirSync(join(root, "books", "草稿箱"), { recursive: true }); // 无 project.json
    writeFileSync(join(root, "books", "笔记.txt"), "不是书", "utf8"); // 非目录

    const res = await buildApp().request("/api/v1/project/list", { headers: HOST_HEADERS });
    const body = await res.json();
    expect(body.data.books).toEqual([
      { name: "真书", path: join(root, "books", "真书"), updatedAt: "2026-08-01T10:00:00Z" },
    ]);
  });

  it("无当前项目（待命态）时 list 可用，不 409——书架模式核心语义", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    seedBook(root, "书", "2026-08-01T10:00:00Z");
    // 不 open/create 任何项目（currentProject = null）
    const res = await buildApp().request("/api/v1/project/list", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data.books).toHaveLength(1);
  });

  it("创作根自身有 project.json 时，list 仍只列 books/（根自身不是书，兼容旧语义）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    // 根自身是旧语义项目（含 project.json）
    writeProjectFile(root, makeConfig("proj-root", "根项目"));
    seedBook(root, "书架上的书", "2026-08-01T10:00:00Z");

    const res = await buildApp().request("/api/v1/project/list", { headers: HOST_HEADERS });
    const body = await res.json();
    // 根自身不出现在 books 列表（books 只列 books/ 子目录）
    expect(body.data.books).toEqual([
      { name: "书架上的书", path: join(root, "books", "书架上的书"), updatedAt: "2026-08-01T10:00:00Z" },
    ]);
  });

  it("创作根未注入（setProjectRoot 未调用）→ 500 INTERNAL_ERROR（防御）", async () => {
    // beforeEach 已 setProjectRoot(null)
    const res = await buildApp().request("/api/v1/project/list", { headers: HOST_HEADERS });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
  });

  it("端到端联动：POST /project/create 创建书到 创作根/books/<书名>/ → list 扫到该书（书架主链路）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    const app = buildApp();

    // 走真实 create 路由（mkdir recursive + 三文件 + user_version），前端拼 books/ 路径语义
    const bookDir = join(root, "books", "联动书");
    const createRes = await app.request("/api/v1/project/create", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: bookDir, config: { name: "联动书" } }),
    });
    expect(createRes.status).toBe(200);
    // 三文件已创建（create 语义不回归）
    expect(readProjectFile(bookDir)?.name).toBe("联动书");

    // list 扫到该书：name/path/updatedAt 与盘上 project.json 一致（不依赖 open/currentProject）
    const listRes = await app.request("/api/v1/project/list", { headers: HOST_HEADERS });
    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(body.data.rootPath).toBe(root);
    expect(body.data.books).toEqual([
      { name: "联动书", path: bookDir, updatedAt: readProjectFile(bookDir)?.updated_at },
    ]);

    // 再建一本 → 仍可扫到（两本）
    const bookDir2 = join(root, "books", "第二本联动");
    await app.request("/api/v1/project/create", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: bookDir2 }),
    });
    const listRes2 = await app.request("/api/v1/project/list", { headers: HOST_HEADERS });
    expect((await listRes2.json()).data.books).toHaveLength(2);
  });
});

// ============ GET /api/v1/project/export（E1：导出 zip 三文件） ============

/**
 * 构造含实体数据的项目并 open（E1 export / E2 import roundtrip 共用）：
 * initProjectDir + 插入实体 + open 路由切换 currentProject
 */
async function openSeededProject(
  dir: string,
  id = "proj-exp",
  name = "导出项目",
  charId = "char-exp",
  charName = "导出角色",
): Promise<Hono> {
  initProjectDir(dir, makeConfig(id, name));
  // 写入真实数据：导出后解包出的 data.db 应能直接打开且含该实体（WAL 已合并验证）
  const db = openDatabase(join(dir, "data.db"));
  try {
    db.prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      charId, "character", charName, T0, T0,
    );
  } finally {
    closeDatabase(db);
  }
  const app = buildApp();
  const res = await app.request("/api/v1/project/open", {
    method: "POST",
    headers: HOST_HEADERS,
    body: JSON.stringify({ path: dir }),
  });
  expect(res.status).toBe(200);
  return app;
}

describe("GET /project/export（E1：zip 导出三文件）", () => {
  it("导出成功：application/zip + attachment；解包三文件齐全且与源文件一致", async () => {
    const dir = makeTmpDir();
    const app = await openSeededProject(dir);

    const res = await app.request("/api/v1/project/export", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    // RFC 5987 filename*：UTF-8 percent-encoded 中文书名（解码后校验）
    expect(disposition).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(disposition)).toContain("导出项目.zip");

    const unzipped = unzipSync(new Uint8Array(await res.arrayBuffer()));
    // 三文件齐全（key = zip 条目名，与数据文件原名一致）
    expect(Object.keys(unzipped).sort()).toEqual(["data.db", "outline.json", "project.json"]);
    // project.json / outline.json 与源文件字节一致
    expect(Buffer.from(unzipped["project.json"]).equals(readFileSync(join(dir, "project.json")))).toBe(true);
    expect(Buffer.from(unzipped["outline.json"]).equals(readFileSync(join(dir, "outline.json")))).toBe(true);
    // data.db：与盘上主文件字节一致（export 前已 wal_checkpoint(TRUNCATE)）
    expect(Buffer.from(unzipped["data.db"]).equals(readFileSync(join(dir, "data.db")))).toBe(true);
  });

  it("zip 内 data.db 为完整快照：已打开连接上的写入（仅存于 WAL）经 checkpoint 合并入包（ora-4 真实验证）", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-wal", "WAL 项目"));
    const app = buildApp();
    await app.request("/api/v1/project/open", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    // 关键（ora-4 修复）：在**已打开的项目连接**上插入——better-sqlite3 WAL 模式下
    // 数据此刻仅存于 -wal 文件。反证：盘上主文件不含该实体；若 export 解包出的
    // data.db 能查到 → 证明 wal_checkpoint(TRUNCATE) 真实合并（E1 核心卖点）。
    // 旧版用例经独立连接写入后 close（WAL 恒空），checkpoint 从未被真正验证。
    const active = getCurrentProject()!;
    active.db.prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "char-wal", "character", "WAL角色", T0, T0,
    );
    expect(readFileSync(join(dir, "data.db")).includes(Buffer.from("WAL角色"))).toBe(false); // 主文件不含（未合并）

    const res = await app.request("/api/v1/project/export", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const unzipped = unzipSync(new Uint8Array(await res.arrayBuffer()));
    // 解包出的 data.db（导出时已 checkpoint）应能直接查到 WAL 中的实体
    const snapshotPath = join(makeTmpDir(), "snapshot.db");
    writeFileSync(snapshotPath, Buffer.from(unzipped["data.db"]));
    const db = openDatabase(snapshotPath);
    try {
      const row = db.prepare("SELECT name FROM entities WHERE id = ?").get("char-wal") as { name: string } | undefined;
      expect(row?.name).toBe("WAL角色");
    } finally {
      closeDatabase(db);
    }
  });

  it("zip 不含任何 key 内容（决策 17：key 存用户级配置，天然不入包）", async () => {
    const dir = makeTmpDir();
    const app = await openSeededProject(dir);
    const res = await app.request("/api/v1/project/export", { headers: HOST_HEADERS });
    const unzipped = unzipSync(new Uint8Array(await res.arrayBuffer()));
    // key 只可能出现在两个明文 JSON 中（data.db 二进制不做子串断言，避免误报）
    const text = [unzipped["project.json"], unzipped["outline.json"]]
      .map((b) => Buffer.from(b).toString("utf8"))
      .join("\n");
    expect(text).not.toContain("api_key");
    expect(text).not.toContain("sk-");
  });

  it("无当前项目 → 409 NO_PROJECT_OPEN（与 /config 一致）", async () => {
    const res = await buildApp().request("/api/v1/project/export", { headers: HOST_HEADERS });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "NO_PROJECT_OPEN", message: expect.stringContaining("open") },
    });
  });

  it("data.db 缺失（损坏）→ 500 INTERNAL_ERROR，不导出半成品包", async () => {
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-exp2", "损坏项目"));
    const app = buildApp();
    await app.request("/api/v1/project/open", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: dir }),
    });
    // open 成功后外部删除 data.db（模拟损坏：打开的项目三文件不齐全）
    rmSync(join(dir, "data.db"), { force: true });

    const res = await app.request("/api/v1/project/export", { headers: HOST_HEADERS });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
  });
});

// ============ POST /api/v1/project/import（E2：校验 + 原子搬入） ============

describe("POST /project/import（E2：zip 导入新书）", () => {
  /** 造 multipart 请求体（file = zip 字节 + name = 书名） */
  function importForm(zipBytes: Uint8Array, name: string): FormData {
    const form = new FormData();
    // new Uint8Array(zipBytes)：fflate 返回 ArrayBufferLike 泛型，复制为 ArrayBuffer 视图
    // 以满足 BlobPart 类型约束（TS 5.7 泛型 Uint8Array）
    form.append("file", new File([new Uint8Array(zipBytes)], "backup.zip", { type: "application/zip" }));
    form.append("name", name);
    return form;
  }

  /** 从真实项目导出 zip（E1 路由），供 roundtrip / 冲突等用例复用 */
  async function exportZip(app: Hono): Promise<Uint8Array> {
    const res = await app.request("/api/v1/project/export", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    return new Uint8Array(await res.arrayBuffer());
  }

  it("roundtrip：E1 导出 → import 新书名 → 200 + 三文件生成 + 打开新书数据完整（与源一致）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    // 源项目：含实体数据 + open（export 需要 currentProject）
    const srcDir = makeTmpDir();
    const app = await openSeededProject(srcDir, "proj-src", "源书", "char-src", "源角色");
    const srcCfg = await app.request("/api/v1/project/config", { headers: HOST_HEADERS });
    expect((await srcCfg.json()).data.id).toBe("proj-src");
    const srcOutline = readOutlineFile(srcDir);
    // 源实体基线（DB 直查——测试 app 未挂 entity 路由，数据完整性本质对比同一张表）
    const srcDb = openDatabase(join(srcDir, "data.db"));
    const srcEntities = srcDb.prepare("SELECT id, type, name FROM entities ORDER BY id").all();
    closeDatabase(srcDb);

    // E1 导出 → E2 导入（新书名）
    const impRes = await app.request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(await exportZip(app), "导入的新书"),
    });
    expect(impRes.status).toBe(200);
    const data = (await impRes.json()).data;
    expect(data).toEqual({
      imported: true,
      id: "proj-src",
      path: join(root, "books", "导入的新书"),
      name: "导入的新书",
    });
    // 新书目录三文件生成（project.json id 沿用源 id——数据原样恢复）
    const bookDir = join(root, "books", "导入的新书");
    expect(readProjectFile(bookDir)?.id).toBe("proj-src");
    expect(readProjectFile(bookDir)?.name).toBe("源书"); // project.json 内部 name 不被篡改
    expect(readOutlineFile(bookDir)).toEqual(srcOutline);
    // import 不打开（与 create 一致）
    expect(getCurrentProject()?.root).toBe(srcDir);

    // 数据完整：打开新书 → config 与源一致 + 实体表与源一致
    const openRes = await app.request("/api/v1/project/open", {
      method: "POST",
      headers: HOST_HEADERS,
      body: JSON.stringify({ path: bookDir }),
    });
    expect(openRes.status).toBe(200);
    const cfgRes = await app.request("/api/v1/project/config", { headers: HOST_HEADERS });
    expect((await cfgRes.json()).data.id).toBe("proj-src");
    const active = getCurrentProject();
    expect(active?.db.prepare("SELECT id, type, name FROM entities ORDER BY id").all()).toEqual(srcEntities);
  });

  it("缺文件 zip（只含 project.json）→ 400 VALIDATION_ERROR（非完整备份）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    const badZip = zipSync({ "project.json": new TextEncoder().encode("{}") });
    const res = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(badZip, "缺文件书"),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("缺少文件") },
    });
  });

  it("非 zip 内容 → 400 VALIDATION_ERROR（不是有效的项目备份包）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    const res = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(new TextEncoder().encode("这不是一个 zip 文件"), "坏包书"),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("不是有效的项目备份包") },
    });
  });

  it("zip 含未知条目 → 400 VALIDATION_ERROR（白名单严格拒绝，防路径穿越）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    // 合法三文件 + 恶意条目（如 ../../evil.txt 形状名）
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-x", "x"));
    const evilZip = zipSync({
      "project.json": readFileSync(join(dir, "project.json")),
      "outline.json": readFileSync(join(dir, "outline.json")),
      "data.db": readFileSync(join(dir, "data.db")),
      "../../evil.txt": new TextEncoder().encode("pwned"),
    });
    const res = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(evilZip, "白名单书"),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("未知条目");
  });

  it("project.json 非合法 JSON → 400 VALIDATION_ERROR", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    const badZip = zipSync({
      "project.json": new TextEncoder().encode("{ 这不是 JSON"),
      "outline.json": new TextEncoder().encode(JSON.stringify({ id: "root", type: "root", schema_version: 1, children: [] })),
      "data.db": new Uint8Array(),
    });
    const res = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(badZip, "坏JSON书"),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("project.json");
  });

  it("user_version 不匹配（SCHEMA_VERSION+1）→ 409 SCHEMA_VERSION_MISMATCH（拒绝导入不静默重建）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    // 构造未来版本备份：合法三文件 + data.db user_version = SCHEMA_VERSION + 1
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-v", "未来版"));
    const db = openDatabase(join(dir, "data.db"));
    setUserVersion(db, SCHEMA_VERSION + 1);
    closeDatabase(db);
    const futureZip = zipSync({
      "project.json": readFileSync(join(dir, "project.json")),
      "outline.json": readFileSync(join(dir, "outline.json")),
      "data.db": readFileSync(join(dir, "data.db")),
    });

    const res = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(futureZip, "未来版书"),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "SCHEMA_VERSION_MISMATCH", message: expect.stringContaining("更高版本程序") },
    });
    // 拒绝导入：books/ 无残留
    expect(existsSync(join(root, "books", "未来版书"))).toBe(false);
  });

  it("旧版本备份（user_version < SCHEMA_VERSION）→ 409 文案提示「旧版本程序且无可用迁移路径」（E5：当前 MIGRATIONS 为空无路径，仍拒绝）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    // 构造旧版本备份：合法 project.json/outline.json + data.db user_version=0（新库默认）
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-old", "旧版"));
    const oldDb = openDatabase(join(dir, "data.db"));
    setUserVersion(oldDb, 0); // 旧版本（< SCHEMA_VERSION）
    closeDatabase(oldDb);
    const oldZip = zipSync({
      "project.json": readFileSync(join(dir, "project.json")),
      "outline.json": readFileSync(join(dir, "outline.json")),
      "data.db": readFileSync(join(dir, "data.db")),
    });

    const res = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(oldZip, "旧版书"),
    });
    expect(res.status).toBe(409);
    const msg = (await res.json()).error.message as string;
    expect(msg).toContain("旧版本程序");
    expect(msg).toContain("无可用迁移路径");
    expect(existsSync(join(root, "books", "旧版书"))).toBe(false);
  });

  it("data.db 为空文件（0 字节）→ 400 VALIDATION_ERROR（坏包，而非 409 版本不匹配——ora-4 顺序修复）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-empty", "空库"));
    const badZip = zipSync({
      "project.json": readFileSync(join(dir, "project.json")),
      "outline.json": readFileSync(join(dir, "outline.json")),
      "data.db": new Uint8Array(), // 0 字节：SQLite 会当新库（user_version=0），必须先按坏包拒
    });
    const res = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(badZip, "空库书"),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("空文件");
  });

  it("书名冲突（目标 books/<name>/ 已存在）→ 409 PROJECT_ALREADY_EXISTS（与 create 同语义）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    // 先导入一本书成功
    const srcDir = makeTmpDir();
    const app = await openSeededProject(srcDir);
    const okRes = await app.request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(await exportZip(app), "同名书"),
    });
    expect(okRes.status).toBe(200);
    // 再次导入同名 → 409
    const dupRes = await app.request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(await exportZip(app), "同名书"),
    });
    expect(dupRes.status).toBe(409);
    expect(await dupRes.json()).toEqual({
      success: false,
      error: { code: "PROJECT_ALREADY_EXISTS", message: expect.stringContaining("同名") },
    });
  });

  it("书名含路径分隔符（../escape）→ 400 VALIDATION_ERROR（防 books/ 逃逸，决策 17）", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-esc", "esc"));
    const zip = zipSync({
      "project.json": readFileSync(join(dir, "project.json")),
      "outline.json": readFileSync(join(dir, "outline.json")),
      "data.db": readFileSync(join(dir, "data.db")),
    });
    const res = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(zip, "../escape"),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("书名");
    // books/ 外无残留（逃逸目录未被创建）
    expect(existsSync(join(root, "books", "..", "escape"))).toBe(false);
  });

  it("缺少 multipart 字段（无 file / 无 name）→ 400 VALIDATION_ERROR", async () => {
    const root = makeTmpDir();
    setProjectRoot(root);
    // 无 file
    const noFile = new FormData();
    noFile.append("name", "无文件书");
    const res1 = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: noFile,
    });
    expect(res1.status).toBe(400);
    expect((await res1.json()).error.message).toContain("file");
    // 无 name
    const dir = makeTmpDir();
    initProjectDir(dir, makeConfig("proj-n", "n"));
    const zip = zipSync({
      "project.json": readFileSync(join(dir, "project.json")),
      "outline.json": readFileSync(join(dir, "outline.json")),
      "data.db": readFileSync(join(dir, "data.db")),
    });
    const noName = new FormData();
    noName.append("file", new File([zip], "backup.zip"));
    const res2 = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: noName,
    });
    expect(res2.status).toBe(400);
    expect((await res2.json()).error.message).toContain("name");
  });

  it("创作根未注入（setProjectRoot 未调用）→ 500 INTERNAL_ERROR（防御，同 list）", async () => {
    // beforeEach 已 setProjectRoot(null)
    const res = await buildApp().request("/api/v1/project/import", {
      method: "POST",
      headers: HOST_HEADERS,
      body: importForm(new Uint8Array(), "任意书"),
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
  });
});

// ============ 导出/导入 zip 条目契约（ora-4 钉死） ============

describe("导出/导入 zip 条目契约（ora-4）", () => {
  it("shared PROJECT_EXPORT_FILE_NAMES 与 db 包三常量相等（export 组装与 import 校验不漂移）", () => {
    expect([...PROJECT_EXPORT_FILE_NAMES].sort()).toEqual(
      [PROJECT_FILE_NAME, OUTLINE_FILE_NAME, DATA_DB_FILE_NAME].sort(),
    );
  });
});
