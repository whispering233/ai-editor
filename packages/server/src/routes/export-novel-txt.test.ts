// GET /api/v1/project/export-novel-txt 测试：整本纯文本（`.txt`）。
// 覆盖：① 默认 layout=preserve 的正文（阅读序 / 卷标题跳过无可见章的卷 / 空章只留标题行 /
// 标题原始名 / CRLF / 无 BOM / 末尾一个换行）；② 显式 layout=webnovel（段首缩进 / 段间不空行）；
// ③ Content-Disposition 双文件名；④ 非法 layout 400；⑤ 无可见章 400；⑥ 练习工作区 400
// KIND_MISMATCH；⑦ 未打开项目 409 NO_PROJECT_OPEN。
// 纯文本直接断言 body（不解压），排版规则本身在 shared 单测里走查。
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
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

function makeConfig(
  id: string,
  name: string,
  kind?: ProjectFileConfig["kind"],
): ProjectFileConfig {
  return {
    id,
    name,
    language: "zh",
    prompt: "",
    schema_version: SCHEMA_VERSION,
    current_position: null,
    created_at: T0,
    updated_at: T0,
    ...(kind === undefined ? {} : { kind }),
  };
}

/**
 * 阅读序用例（书名「测试书」）：root 直挂章 ch-r（**树序在卷前** = 第1章）→ 卷「风起」
 * （ch-1 有正文 / ch-del 软删）→ 卷「云涌」（**无可见章**，软删章也未进编号）→ 卷「落日」
 * （ch-3 无 document 行 = **空章**）。
 */
function makeTxtOutline(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: SCHEMA_VERSION,
    children: [
      { id: "ch-r", type: "chapter", title: "直挂章", updated_at: T0, children: [] },
      {
        id: "vol-1",
        type: "volume",
        title: "风起",
        updated_at: T0,
        children: [
          { id: "ch-1", type: "chapter", title: "初见", updated_at: T0, children: [] },
          { id: "ch-del", type: "chapter", title: "已删章", updated_at: T0, deleted: true, deleted_at: T0 },
        ],
      },
      {
        id: "vol-2",
        type: "volume",
        title: "云涌",
        updated_at: T0,
        children: [
          { id: "ch-d2", type: "chapter", title: "软删章二", updated_at: T0, deleted: true, deleted_at: T0 },
        ],
      },
      {
        id: "vol-3",
        type: "volume",
        title: "落日",
        updated_at: T0,
        children: [{ id: "ch-3", type: "chapter", title: "末章", updated_at: T0, children: [] }],
      },
    ],
  };
}

/**
 * 构造版本匹配项目并 open：三文件 + 章正文行（**经 db 包 upsertDocument**，投影随行写入）。
 * `docs` = `[chapterId, contentText]`（content 块 JSON 走一份最小块数组——TXT 导出不读它）。
 */
async function openProject(
  dir: string,
  outline: OutlineFileTree,
  docs: [string, string][] = [],
  name = "测试书",
  kind?: ProjectFileConfig["kind"],
): Promise<Hono> {
  mkdirSync(dir, { recursive: true });
  writeProjectFile(dir, makeConfig("proj-export-txt", name, kind));
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

/** 打开带正文的整本 TXT 用例项目 */
async function openTxtProject(): Promise<Hono> {
  const dir = makeTmpDir();
  setProjectRoot(makeTmpDir());
  return openProject(
    dir,
    makeTxtOutline(),
    [
      ["ch-r", "直挂正文"],
      ["ch-1", "初见第一段\n\n初见第二段"],
      ["ch-del", "软删章正文（不得导出）"],
      ["ch-d2", "软删章二正文（不得导出）"],
    ],
    "测试书",
  );
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-export-novel-txt-"));
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

describe("GET /project/export-novel-txt（整本纯文本）", () => {
  it("默认 preserve：text/plain; charset=utf-8、CRLF、无 BOM、末尾一个换行；阅读序 + 跳过无章卷 + 空章留标题", async () => {
    const app = await openTxtProject();
    const res = await app.request("/api/v1/project/export-novel-txt", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain('filename="book.txt"');
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain(encodeURIComponent("测试书.txt"));

    const bytes = new Uint8Array(await res.arrayBuffer());
    // UTF-8 无 BOM（首字节就是「第」）
    expect(Array.from(bytes.slice(0, 3))).not.toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(
      [
        "第1章 直挂章",
        "",
        "直挂正文",
        "",
        "第1卷 风起",
        "",
        "第2章 初见",
        "",
        "初见第一段",
        "",
        "初见第二段",
        "",
        "第3卷 落日",
        "",
        "第3章 末章",
      ].join("\r\n") + "\r\n",
    );
    // 无可见章的卷（云涌）不输出卷标题；软删章不进文件
    expect(text).not.toContain("云涌");
    expect(text).not.toContain("已删章");
    expect(text.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(text.endsWith("\r\n\r\n")).toBe(false);
  });

  it("layout=webnovel：段首两个全角空格、连续段落不空行；文件名加 -网文；标题不缩进", async () => {
    const app = await openTxtProject();
    const res = await app.request("/api/v1/project/export-novel-txt?layout=webnovel", {
      headers: HOST_HEADERS,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain(encodeURIComponent("测试书-网文.txt"));
    expect(await res.text()).toBe(
      [
        "第1章 直挂章",
        "",
        "　　直挂正文",
        "",
        "第1卷 风起",
        "",
        "第2章 初见",
        "",
        "　　初见第一段",
        "　　初见第二段",
        "",
        "第3卷 落日",
        "",
        "第3章 末章",
      ].join("\r\n") + "\r\n",
    );
  });

  it("卷 / 章标题用原始名（`:` / `/` 不 sanitize）", async () => {
    const app = await openProject(
      makeTmpDir(),
      {
        id: "root",
        type: "root",
        schema_version: SCHEMA_VERSION,
        children: [
          {
            id: "vol-1",
            type: "volume",
            title: "上/下:序",
            updated_at: T0,
            children: [{ id: "ch-1", type: "chapter", title: "起点/上:1", updated_at: T0, children: [] }],
          },
        ],
      },
      [["ch-1", "正文"]],
      "原始名",
    );
    setProjectRoot(makeTmpDir());
    const res = await app.request("/api/v1/project/export-novel-txt", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("第1卷 上/下:序\r\n");
    expect(text).toContain("第1章 起点/上:1\r\n");
  });

  it("非法 layout → 400 VALIDATION_ERROR", async () => {
    const app = await openTxtProject();
    const res = await app.request("/api/v1/project/export-novel-txt?layout=gbk", {
      headers: HOST_HEADERS,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("无可见章（全部软删）→ 400 VALIDATION_ERROR，不产空文件", async () => {
    setProjectRoot(makeTmpDir());
    const app = await openProject(makeTmpDir(), {
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
    });
    const res = await app.request("/api/v1/project/export-novel-txt", { headers: HOST_HEADERS });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "本书还没有章节" },
    });
  });

  it("练习工作区 → 400 KIND_MISMATCH（客户端据此在书架弹窗隐藏该选项）", async () => {
    setProjectRoot(makeTmpDir());
    const app = await openProject(makeTmpDir(), makeTxtOutline(), [], "仿写练习", "practice");
    const res = await app.request("/api/v1/project/export-novel-txt", { headers: HOST_HEADERS });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "KIND_MISMATCH", message: "该端点仅适用于小说工作区" },
    });
  });

  it("未打开项目 → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp().request("/api/v1/project/export-novel-txt", {
      headers: HOST_HEADERS,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_PROJECT_OPEN");
  });
});
