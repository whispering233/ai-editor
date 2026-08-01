// 项目上下文中间件测试（T6.1）：来源校验（决策 17 修订）+ 自动初始化（决策 8）
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "./error.js";
import {
  closeProject,
  ensureProject,
  originCheckMiddleware,
  projectMiddleware,
  type ProjectVariables,
} from "./project.js";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-editor-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 组装带中间件的测试 app */
function buildApp(root: string) {
  const project = ensureProject(root);
  const app = new Hono<{ Variables: ProjectVariables }>();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware(project));
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

describe("项目自动初始化（决策 8）", () => {
  it("空目录自动创建 project.json（id 前缀 proj-）+ outline.json + data.db", () => {
    const dir = makeTmpDir();
    const project = ensureProject(dir);
    try {
      // project.json：id/name/schema_version 必填 + proj- 前缀（endpoints.md id 约定）
      const config = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
      expect(config.id).toMatch(/^proj-/);
      expect(config.name).toBeTruthy();
      expect(config.schema_version).toBeTypeOf("number");
      expect(config.current_position).toBeNull();
      // outline.json：空树 + schema_version
      const outline = JSON.parse(readFileSync(join(dir, "outline.json"), "utf8"));
      expect(outline).toEqual({ id: "root", type: "root", schema_version: config.schema_version, children: [] });
      // data.db：已创建（SQLite 文件头）
      const dbHead = readFileSync(join(dir, "data.db"));
      expect(dbHead.subarray(0, 15).toString("utf8")).toBe("SQLite format 3");
    } finally {
      closeProject(project);
    }
  });

  it("已存在 project.json 时不重复初始化", () => {
    const dir = makeTmpDir();
    ensureProject(dir).db.close();
    const project = ensureProject(dir);
    try {
      const config = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
      // 两次初始化 id 一致（未重建）
      expect(project.config.id).toBe(config.id);
    } finally {
      closeProject(project);
    }
  });
});
