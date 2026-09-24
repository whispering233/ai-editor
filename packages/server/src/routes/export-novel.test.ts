// GET /api/v1/project/export-novel 测试（卡 E3）：小说文档 zip（卷/章目录树 + 章正文投影）。
// 覆盖：① 卷/章齐备（含无可见章的卷 / 软删章 / 存量直挂 root 的章 / 空章）→ 解压条目名与 md 内容；
// ② 全部章软删 → 400 VALIDATION_ERROR（不产空包）；③ 未打开项目 → 409 NO_PROJECT_OPEN。
// 断言的是**真实解压后的条目与文本**（不 mock zip 管道），编号/命名走 shared 纯函数实现。
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { unzipSync } from "fflate";
import type { OutlineFileTree, ProjectFileConfig } from "@whispering233/ai-editor-shared";
import {
  closeDatabase,
  openDatabase,
  SCHEMA_VERSION,
  setUserVersion,
  upsertDocument,
  writeOutlineFile,
  writeProjectFile,
} from "@whispering233/ai-editor-db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { projectRoutes, setProjectRoot } from "./project.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" }; // 来源校验 host 白名单
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

/** 卷「风起」= 章 ch-1（有正文）/ ch-2（软删）/ ch-3（空章）；卷「云涌」= 无可见章；root 直挂 ch-4 */
function makeExportOutline(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: SCHEMA_VERSION,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "风起",
        updated_at: T0,
        children: [
          { id: "ch-1", type: "chapter", title: "初见", updated_at: T0, children: [] },
          { id: "ch-2", type: "chapter", title: "已删章", updated_at: T0, deleted: true, deleted_at: T0 },
          { id: "ch-3", type: "chapter", title: "空白", updated_at: T0, children: [] },
        ],
      },
      { id: "vol-2", type: "volume", title: "云涌", updated_at: T0, children: [] },
      { id: "ch-4", type: "chapter", title: "直挂", updated_at: T0, children: [] },
    ],
  };
}

/** 全部章软删的大纲（卷下唯一章 deleted） */
function makeAllDeletedOutline(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: SCHEMA_VERSION,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "风起",
        updated_at: T0,
        children: [
          { id: "ch-1", type: "chapter", title: "已删章", updated_at: T0, deleted: true, deleted_at: T0 },
        ],
      },
    ],
  };
}

/**
 * 构造版本匹配项目并 open：三文件 + 章正文行（**经 db 包 upsertDocument**，投影随行写入）。
 * `docs` = `[chapterId, contentText]`（content 块 JSON 走一份最小块数组——导出不读它）。
 */
async function openProject(
  dir: string,
  outline: OutlineFileTree,
  docs: [string, string][] = [],
  name = "测试书",
): Promise<Hono> {
  mkdirSync(dir, { recursive: true });
  writeProjectFile(dir, makeConfig("proj-novel", name));
  writeOutlineFile(dir, outline);
  const db = openDatabase(join(dir, "data.db"));
  try {
    setUserVersion(db, SCHEMA_VERSION);
    for (const [chapterId, contentText] of docs) {
      upsertDocument(db, {
        ownerKind: "chapter",
        ownerId: chapterId,
        content: JSON.stringify([{ id: "blk-1", type: "paragraph", content: contentText }]),
        contentText,
        now: T0,
      });
    }
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

/** 解压条目名 → UTF-8 文本（zip 条目内容以字节返回，断言文本用） */
function textOf(unzipped: Record<string, Uint8Array>, key: string): string {
  return new TextDecoder().decode(unzipped[key]);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-export-novel-"));
  setCurrentProject(null);
  setProjectRoot(null);
});

afterEach(() => {
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

describe("GET /project/export-novel（小说文档 zip）", () => {
  it("卷/章齐备：条目名 = 卷目录树 + 章号跨卷连续；正文取 content_text 投影、空章只有标题行", async () => {
    const dir = makeTmpDir();
    setProjectRoot(makeTmpDir());
    const app = await openProject(
      dir,
      makeExportOutline(),
      [
        ["ch-1", "初见正文"],
        ["ch-2", "软删章正文（不得进包）"],
        ["ch-4", "直挂正文"],
      ],
    );

    const res = await app.request("/api/v1/project/export-novel", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(disposition)).toContain("测试书-小说文档.zip");

    const unzipped = unzipSync(new Uint8Array(await res.arrayBuffer()));
    // 条目名与顺序 = 卷序（含无可见章的卷的空目录条目）→ 卷内章序 → 直挂 root 的章
    expect(Object.keys(unzipped)).toEqual([
      "测试书/第1卷 风起/第1章 初见.md",
      "测试书/第1卷 风起/第2章 空白.md",
      "测试书/第2卷 云涌/",
      "测试书/第3章 直挂.md",
    ]);
    // 软删章不进包（编号侧已过滤，且其正文行在库内 → 证明过滤发生在条目侧）
    expect(Object.keys(unzipped).some((key) => key.includes("已删章"))).toBe(false);

    // 章文件内容：标题行 + 空行 + 投影；章名/编号由 shared 组装
    expect(textOf(unzipped, "测试书/第1卷 风起/第1章 初见.md")).toBe("# 第1章 初见\n\n初见正文");
    // 空章（无 document 行）→ 只有标题行，无尾随换行
    expect(textOf(unzipped, "测试书/第1卷 风起/第2章 空白.md")).toBe("# 第2章 空白");
    // 无可见章的卷 → 显式空目录条目（内容为空字节）
    expect(unzipped["测试书/第2卷 云涌/"].length).toBe(0);
    // 存量直挂 root 的章：不落任何卷目录、章号照常连续
    expect(textOf(unzipped, "测试书/第3章 直挂.md")).toBe("# 第3章 直挂\n\n直挂正文");
  });

  it("全部章软删（无可见章）→ 400 VALIDATION_ERROR，不产空包", async () => {
    const dir = makeTmpDir();
    setProjectRoot(makeTmpDir());
    const app = await openProject(dir, makeAllDeletedOutline(), [["ch-1", "软删正文"]]);

    const res = await app.request("/api/v1/project/export-novel", { headers: HOST_HEADERS });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "本书还没有章节" },
    });
    expect(res.headers.get("content-type")).not.toBe("application/zip");
  });

  it("未打开项目 → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp().request("/api/v1/project/export-novel", { headers: HOST_HEADERS });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_PROJECT_OPEN");
  });
});
