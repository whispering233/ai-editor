// 项目上下文中间件测试（T6.1）：来源校验（决策 17 修订）+ 自动初始化（决策 8）
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { getUserVersion, SCHEMA_VERSION } from "@whispering233/ai-editor-db";
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

describe("来源校验（决策 17 修订：host 白名单，不校验端口）", () => {
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

describe("项目检测与初始化（决策 8 修订：启动待命，不无条件初始化）", () => {
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
      expect(p2!.config.id).toBe(id1); // id 跨启动稳定（决策 8/10）
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
