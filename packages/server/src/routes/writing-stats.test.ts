// 码字统计路由测试（GET /api/v1/writing-stats，stats-1）
// 覆盖：空库（0 / 0 / []、today 格式）、两日累计与升序、无项目 409。
// 练习工作区 400 KIND_MISMATCH 的整组守卫在 kind-guard.test.ts（真实 startServer 装配）。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { addWritingChars } from "@whispering233/ai-editor-db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { localDateKey } from "../local-date.js";
import { writingStatsRoutes } from "./writing-stats.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };
const T1 = "2026-11-01T10:00:00Z";

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "writing-stats-"));
  tmpDirs.push(dir);
  return dir;
}

function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/writing-stats", writingStatsRoutes);
  return app;
}

function openProject(): void {
  setCurrentProject(initProject(makeTmpDir()));
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-writing-stats-"));
  setCurrentProject(null);
});

afterEach(() => {
  const cur = getCurrentProject();
  if (cur !== null) {
    closeProject(cur);
    setCurrentProject(null);
  }
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/v1/writing-stats", () => {
  it("空库：today 报本地日、totalChars 0、totalDays 0、days []", async () => {
    const app = buildApp();
    openProject();

    const res = await app.request("/api/v1/writing-stats", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body).toEqual({ today: localDateKey(), totalChars: 0, totalDays: 0, days: [] });
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("两日累计：合计 / 天数 / 行集（升序、只有正增量日）", async () => {
    const app = buildApp();
    openProject();
    const db = getCurrentProject()!.db;
    addWritingChars(db, "2026-11-02", 80, T1);
    addWritingChars(db, "2026-10-31", 120, T1);

    const res = await app.request("/api/v1/writing-stats", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      today: localDateKey(),
      totalChars: 200,
      totalDays: 2,
      days: [
        { date: "2026-10-31", chars: 120 },
        { date: "2026-11-02", chars: 80 },
      ],
    });
  });

  it("无当前项目 → 409 NO_PROJECT_OPEN", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/writing-stats", { headers: HOST_HEADERS });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_PROJECT_OPEN");
  });
});