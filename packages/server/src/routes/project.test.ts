// 项目路由测试（S1.2）：create / open（含 schema 删库重建）/ close / config GET/PUT
// 覆盖：三文件初始化与版本号写入、路径校验（相对路径/符号链接）、版本不匹配重建 + 备份、
//       currentProject 单例切换与清空、current_position 非软删节点校验
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { unzipSync } from "fflate";
import type { OutlineFileTree, ProjectFileConfig } from "@ai-editor/shared";
import { closeDatabase, getUserVersion, openDatabase, SCHEMA_VERSION, setUserVersion } from "@ai-editor/db";
import { readOutlineFile, readProjectFile, writeOutlineFile, writeProjectFile } from "@ai-editor/db";
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

describe("GET /project/export（E1：zip 导出三文件）", () => {
  /** open 一个含实体数据的正常项目（验证 data.db 完整快照）并返回测试 app */
  async function openSeededProject(dir: string): Promise<Hono> {
    initProjectDir(dir, makeConfig("proj-exp", "导出项目"));
    // 写入真实数据：导出后解包出的 data.db 应能直接打开且含该实体（WAL 已合并验证）
    const db = openDatabase(join(dir, "data.db"));
    try {
      db.prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
        "char-exp", "character", "导出角色", T0, T0,
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

  it("zip 内 data.db 为完整快照：可直接打开且含写入的实体（WAL 已合并）", async () => {
    const dir = makeTmpDir();
    const app = await openSeededProject(dir);
    const res = await app.request("/api/v1/project/export", { headers: HOST_HEADERS });
    const unzipped = unzipSync(new Uint8Array(await res.arrayBuffer()));

    const snapshotPath = join(makeTmpDir(), "snapshot.db");
    writeFileSync(snapshotPath, Buffer.from(unzipped["data.db"]));
    const db = openDatabase(snapshotPath);
    try {
      const row = db.prepare("SELECT name FROM entities WHERE id = ?").get("char-exp") as { name: string } | undefined;
      expect(row?.name).toBe("导出角色");
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
