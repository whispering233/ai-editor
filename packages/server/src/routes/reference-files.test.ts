// 参考资料文件服务与路由测试（决策 43，批次十一）
// 覆盖：
//   模块级（reference-files.ts）：写/读 roundtrip、文件名唯一化、软删移动/还原/物理删、
//     scan（新增/幂等跳过/外部修改更新/外部删除软删/软删索引还原/容错）
//   路由级（entity/trash/reference）：file 类创建落盘、link 类 url 必填、PUT 先写文件后更新 DB、
//     409 REFERENCE_FILE_MISSING、软删文件入 .trash/、restore 移回、purge 物理删、scan 端点
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.js";
import {
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { entityRoutes } from "./entity.js";
import { trashRoutes } from "./trash.js";
import { referenceRoutes } from "./reference.js";
import {
  moveReferenceToTrash,
  readReferenceFile,
  REFERENCE_DIR,
  REFERENCE_TRASH_DIR,
  removeReferenceFile,
  restoreReferenceFromTrash,
  scanReferences,
  uniqueFileNameIn,
  writeReferenceFile,
} from "../reference-files.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "ref-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（entity + trash + reference 路由） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/entity", entityRoutes);
  app.route("/api/v1/trash", trashRoutes);
  app.route("/api/v1/reference", referenceRoutes);
  return app;
}

function openProject(): void {
  setCurrentProject(initProject(makeTmpDir()));
}

function jsonRequest(method: string, path: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { ...HOST_HEADERS, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

async function api(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(path, jsonRequest(method, path, body));
  const json = (await res.json()) as { success: boolean; data?: unknown; error?: { code: string; message: string } };
  return { status: res.status, json };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 模拟用户手动创建 references/ 目录并放文件（外部新增场景；initProject 不预建该目录） */
function ensureRefDir(root: string): string {
  const dir = join(root, REFERENCE_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-ref-"));
});
afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  rmSync(tmpRoot, { recursive: true, force: true });
  setCurrentProject(null); // 清理单例（否则后续「无项目」用例受污染）
});

// ============ 模块级：文件读写 ============

describe("reference-files 文件读写", () => {
  it("写/读 roundtrip（frontmatter + 正文 + 未知字段保留）", () => {
    const root = makeTmpDir();
    const { fileName, mtime } = writeReferenceFile(
      root,
      "测试.md",
      { title: "测试标题", category: "material", tags: ["a", "b"], extraLines: ["author: 张三"] },
      "正文第一行\n\n第二段",
    );
    expect(fileName).toBe("测试.md");
    expect(mtime).toBeTruthy();
    const file = readReferenceFile(root, "测试.md");
    expect(file).not.toBeNull();
    expect(file!.title).toBe("测试标题");
    expect(file!.category).toBe("material");
    expect(file!.tags).toEqual(["a", "b"]);
    expect(file!.extraLines).toEqual(["author: 张三"]);
    expect(file!.body).toBe("正文第一行\n\n第二段");
    // 文件内容：frontmatter 在顶部
    const raw = readFileSync(join(root, REFERENCE_DIR, "测试.md"), "utf8");
    expect(raw.startsWith("---\ntitle: 测试标题\ncategory: material\ntags: [a, b]\nauthor: 张三\n---")).toBe(true);
  });

  it("读缺失文件 → null", () => {
    const root = makeTmpDir();
    expect(readReferenceFile(root, "不存在.md")).toBeNull();
  });

  it("uniqueFileNameIn 冲突递增", () => {
    const root = makeTmpDir();
    writeReferenceFile(root, "同名.md", { title: "t", category: "material", tags: [] }, "1");
    writeReferenceFile(root, "同名 (2).md", { title: "t", category: "material", tags: [] }, "2");
    expect(uniqueFileNameIn(join(root, REFERENCE_DIR), "同名")).toBe("同名 (3).md");
  });

  it("软删移动 → 还原 → 物理删", () => {
    const root = makeTmpDir();
    writeReferenceFile(root, "文档.md", { title: "t", category: "material", tags: [] }, "body");
    // 移动入 .trash/
    const trashName = moveReferenceToTrash(root, "文档.md");
    expect(trashName).toBe("文档.md");
    expect(existsSync(join(root, REFERENCE_DIR, "文档.md"))).toBe(false);
    expect(existsSync(join(root, REFERENCE_DIR, REFERENCE_TRASH_DIR, "文档.md"))).toBe(true);
    // 还原
    const restored = restoreReferenceFromTrash(root, "文档.md");
    expect(restored).toBe("文档.md");
    expect(existsSync(join(root, REFERENCE_DIR, "文档.md"))).toBe(true);
    // 物理删（references/ 与 .trash/ 都清）
    removeReferenceFile(root, "文档.md");
    expect(existsSync(join(root, REFERENCE_DIR, "文档.md"))).toBe(false);
  });

  it("软删移动冲突递增 + 还原冲突递增", () => {
    const root = makeTmpDir();
    writeReferenceFile(root, "文档.md", { title: "t", category: "material", tags: [] }, "body");
    // .trash/ 预置同名文件（模拟外部放入）
    const trashDir = join(root, REFERENCE_DIR, REFERENCE_TRASH_DIR);
    writeFileSync(join(trashDir, "文档.md"), "外部文件");
    const trashName = moveReferenceToTrash(root, "文档.md");
    expect(trashName).toBe("文档 (2).md");
    expect(existsSync(join(trashDir, "文档 (2).md"))).toBe(true);
    expect(existsSync(join(trashDir, "文档.md"))).toBe(true); // 外部文件未被动
    // 还原：references/ 预置同名 → 递增移回
    writeFileSync(join(root, REFERENCE_DIR, "文档 (2).md"), "外部新建");
    const restored = restoreReferenceFromTrash(root, "文档 (2).md");
    expect(restored).toBe("文档 (2) (2).md");
    expect(existsSync(join(root, REFERENCE_DIR, "文档 (2) (2).md"))).toBe(true);
  });
});

// ============ 模块级：scan ============

describe("scanReferences", () => {
  it("空目录 + 空索引 → 全零", () => {
    openProject();
    const r = scanReferences(getCurrentProject()!.root, getCurrentProject()!.db);
    expect(r).toEqual({ added: 0, updated: 0, restored: 0, removed: 0, skipped: 0, errors: [] });
  });

  it("新增：frontmatter 完整解析 + 纯 markdown 容错", async () => {
    openProject();
    const root = getCurrentProject()!.root;
    const refDir = ensureRefDir(root);
    writeFileSync(
      join(refDir, "五行.md"),
      "---\ntitle: 五行相生相克\ntags: [五行, 设定]\n---\n五行正文",
    );
    writeFileSync(join(refDir, "纯笔记.md"), "没有 frontmatter 的笔记");
    const r = scanReferences(root, getCurrentProject()!.db);
    expect(r.added).toBe(2);
    // 索引内容校验
    const db = getCurrentProject()!.db;
    const rows = db.prepare("SELECT name, data FROM entities WHERE type='reference'").all() as Array<{ name: string; data: string }>;
    const byName = new Map(rows.map((x) => [x.name, JSON.parse(x.data) as Record<string, unknown>]));
    expect(byName.get("五行相生相克")?.kind).toBe("file");
    expect(byName.get("五行相生相克")?.tags).toEqual(["五行", "设定"]);
    expect(byName.get("五行相生相克")?.content).toBe("五行正文");
    expect(byName.get("五行相生相克")?.type).toBe("material"); // category 缺省
    // 无 frontmatter → title 兜底 = 文件名去扩展名（决策 43 容错语义）
    expect(byName.get("纯笔记")?.content).toBe("没有 frontmatter 的笔记");
    expect(byName.get("纯笔记")?.file_name).toBe("纯笔记.md");
  });

  it("幂等：二次 scan 全 skipped", async () => {
    openProject();
    const root = getCurrentProject()!.root;
    const refDir = ensureRefDir(root);
    writeFileSync(join(refDir, "a.md"), "---\ntitle: A\n---\n内容A");
    scanReferences(root, getCurrentProject()!.db);
    const r2 = scanReferences(root, getCurrentProject()!.db);
    expect(r2).toMatchObject({ skipped: 1, added: 0, updated: 0 });
  });

  it("外部修改 → updated（以文件为准）", async () => {
    openProject();
    const root = getCurrentProject()!.root;
    const refDir = ensureRefDir(root);
    writeFileSync(join(refDir, "a.md"), "---\ntitle: A\ntags: [旧]\n---\n旧内容");
    scanReferences(root, getCurrentProject()!.db);
    await sleep(20); // mtime 粒度
    writeFileSync(join(refDir, "a.md"), "---\ntitle: A2\ntags: [新]\n---\n新内容");
    const r = scanReferences(root, getCurrentProject()!.db);
    expect(r.updated).toBe(1);
    const row = getCurrentProject()!.db.prepare("SELECT name, data FROM entities WHERE type='reference'").get() as { name: string; data: string };
    expect(row.name).toBe("A2");
    const data = JSON.parse(row.data) as Record<string, unknown>;
    expect(data.tags).toEqual(["新"]);
    expect(data.content).toBe("新内容");
  });

  it("外部删除 → removed（索引软删进回收站）", async () => {
    openProject();
    const root = getCurrentProject()!.root;
    const refDir = ensureRefDir(root);
    writeFileSync(join(refDir, "a.md"), "内容A");
    scanReferences(root, getCurrentProject()!.db);
    rmSync(join(refDir, "a.md"));
    const r = scanReferences(root, getCurrentProject()!.db);
    expect(r.removed).toBe(1);
    const row = getCurrentProject()!.db.prepare("SELECT deleted_at FROM entities WHERE type='reference'").get() as { deleted_at: string | null };
    expect(row.deleted_at).not.toBeNull(); // 回收站可还原
  });

  it("软删索引 + 文件回归 references/ → restored", async () => {
    openProject();
    const root = getCurrentProject()!.root;
    const refDir = ensureRefDir(root);
    writeFileSync(join(refDir, "a.md"), "---\ntitle: A\n---\n内容");
    scanReferences(root, getCurrentProject()!.db);
    // 软删（走路由：文件移入 .trash/）
    const id = (getCurrentProject()!.db.prepare("SELECT id FROM entities WHERE type='reference'").get() as { id: string }).id;
    await api(buildApp(), "DELETE", `/api/v1/entity/reference/${id}`);
    expect(existsSync(join(refDir, "a.md"))).toBe(false);
    // 外部把文件移回 references/（模拟）
    const trashDir = join(root, REFERENCE_DIR, REFERENCE_TRASH_DIR);
    writeFileSync(join(refDir, "a.md"), readFileSync(join(trashDir, "a.md")));
    const r = scanReferences(root, getCurrentProject()!.db);
    expect(r.restored).toBe(1);
    const row = getCurrentProject()!.db.prepare("SELECT deleted_at FROM entities WHERE type='reference'").get() as { deleted_at: string | null };
    expect(row.deleted_at).toBeNull();
  });
});

// ============ 路由级：entity CRUD 文件联动 ============

describe("entity/reference 文件联动（决策 43）", () => {
  it("创建 file 类：落盘 + 索引（kind/file_name/file_mtime/content 镜像）", async () => {
    openProject();
    const app = buildApp();
    const res = await api(app, "POST", "/api/v1/entity/reference", {
      name: "五行摘抄",
      data: { kind: "file", type: "material", tags: ["五行"], content: "正文内容" },
    });
    expect(res.status).toBe(201);
    const root = getCurrentProject()!.root;
    expect(existsSync(join(root, REFERENCE_DIR, "五行摘抄.md"))).toBe(true);
    const raw = readFileSync(join(root, REFERENCE_DIR, "五行摘抄.md"), "utf8");
    expect(raw).toContain("title: 五行摘抄");
    expect(raw).toContain("category: material");
    const data = (res.json as { data: { data: Record<string, unknown> } }).data.data;
    expect(data.kind).toBe("file");
    expect(data.file_name).toBe("五行摘抄.md");
    expect(data.file_mtime).toBeTruthy();
    expect(data.content).toBe("正文内容");
  });

  it("创建 file 类重名 → 自动 (N) 递增", async () => {
    openProject();
    const app = buildApp();
    await api(app, "POST", "/api/v1/entity/reference", { name: "同名", data: { kind: "file" } });
    const res = await api(app, "POST", "/api/v1/entity/reference", { name: "同名", data: { kind: "file" } });
    const data = (res.json as { data: { data: Record<string, unknown> } }).data.data;
    expect(data.file_name).toBe("同名 (2).md");
  });

  it("创建 link 类：url 必填（缺失 → 400）；缺省 kind 视为 link 同样校验", async () => {
    openProject();
    const app = buildApp();
    const res1 = await api(app, "POST", "/api/v1/entity/reference", { name: "无链接", data: { kind: "link" } });
    expect(res1.status).toBe(400);
    const res2 = await api(app, "POST", "/api/v1/entity/reference", { name: "缺省kind", data: {} });
    expect(res2.status).toBe(400); // 缺省视为 link → url 必填
    const res3 = await api(app, "POST", "/api/v1/entity/reference", {
      name: "网文研究",
      data: { kind: "link", url: "https://example.com/a", type: "theory" },
    });
    expect(res3.status).toBe(201);
    const data = (res3.json as { data: { data: Record<string, unknown> } }).data.data;
    expect(data.kind).toBe("link");
    expect(data.url).toBe("https://example.com/a");
  });

  it("PUT file 类：改名/改分类 → 先写文件再更新 DB（正文保留）；带 content → 正文更新", async () => {
    openProject();
    const app = buildApp();
    const created = await api(app, "POST", "/api/v1/entity/reference", {
      name: "原标题",
      data: { kind: "file", tags: ["旧"], content: "正文" },
    });
    const id = (created.json as { data: { id: string } }).data.id;
    const root = getCurrentProject()!.root;
    // 只改标题（行内编辑场景）：frontmatter title 更新、正文保留、文件名不变
    const res = await api(app, "PUT", `/api/v1/entity/reference/${id}`, { name: "新标题" });
    expect(res.status).toBe(200);
    const raw = readFileSync(join(root, REFERENCE_DIR, "原标题.md"), "utf8");
    expect(raw).toContain("title: 新标题");
    expect(raw).toContain("正文");
    // 改分类 + 正文
    await api(app, "PUT", `/api/v1/entity/reference/${id}`, {
      data: { type: "theory", content: "新正文" },
    });
    const raw2 = readFileSync(join(root, REFERENCE_DIR, "原标题.md"), "utf8");
    expect(raw2).toContain("category: theory");
    expect(raw2).toContain("新正文");
    expect(raw2).not.toContain("\n\n正文\n"); // 旧正文（frontmatter 后独立行）被替换
    // 索引 content 镜像同步
    const row = getCurrentProject()!.db.prepare("SELECT data FROM entities WHERE id=?").get(id) as { data: string };
    expect((JSON.parse(row.data) as Record<string, unknown>).content).toBe("新正文");
  });

  it("PUT file 类文件缺失（外部删除）→ 409 REFERENCE_FILE_MISSING", async () => {
    openProject();
    const app = buildApp();
    const created = await api(app, "POST", "/api/v1/entity/reference", { name: "将被外部删", data: { kind: "file" } });
    const id = (created.json as { data: { id: string } }).data.id;
    const root = getCurrentProject()!.root;
    rmSync(join(root, REFERENCE_DIR, "将被外部删.md"));
    const res = await api(app, "PUT", `/api/v1/entity/reference/${id}`, { name: "改名" });
    expect(res.status).toBe(409);
    expect((res.json as { error: { code: string } }).error.code).toBe("REFERENCE_FILE_MISSING");
  });

  it("DELETE file 类：文件移入 .trash/ + 软删；restore 移回；purge 物理删", async () => {
    openProject();
    const app = buildApp();
    const created = await api(app, "POST", "/api/v1/entity/reference", { name: "回收站验证", data: { kind: "file", content: "内容" } });
    const id = (created.json as { data: { id: string } }).data.id;
    const root = getCurrentProject()!.root;
    // 软删
    const del = await api(app, "DELETE", `/api/v1/entity/reference/${id}`);
    expect(del.status).toBe(200);
    expect(existsSync(join(root, REFERENCE_DIR, "回收站验证.md"))).toBe(false);
    expect(existsSync(join(root, REFERENCE_DIR, REFERENCE_TRASH_DIR, "回收站验证.md"))).toBe(true);
    // restore
    const rest = await api(app, "POST", `/api/v1/trash/entity/reference/${id}/restore`);
    expect(rest.status).toBe(200);
    expect(existsSync(join(root, REFERENCE_DIR, "回收站验证.md"))).toBe(true);
    // 再软删 + purge
    await api(app, "DELETE", `/api/v1/entity/reference/${id}`);
    const purge = await api(app, "DELETE", `/api/v1/trash/entity/reference/${id}`);
    expect(purge.status).toBe(200);
    expect(existsSync(join(root, REFERENCE_DIR, REFERENCE_TRASH_DIR, "回收站验证.md"))).toBe(false);
    const row = getCurrentProject()!.db.prepare("SELECT id FROM entities WHERE id=?").get(id);
    expect(row).toBeUndefined();
  });

  it("link 类无文件联动（DELETE 不碰文件系统）", async () => {
    openProject();
    const app = buildApp();
    const created = await api(app, "POST", "/api/v1/entity/reference", {
      name: "链接条目",
      data: { kind: "link", url: "https://example.com/x" },
    });
    const id = (created.json as { data: { id: string } }).data.id;
    const del = await api(app, "DELETE", `/api/v1/entity/reference/${id}`);
    expect(del.status).toBe(200);
    // 无 references/ 目录产生（link 类不落盘）
    expect(existsSync(join(getCurrentProject()!.root, REFERENCE_DIR))).toBe(false);
  });
});

// ============ 路由级：scan 端点 ============

describe("POST /api/v1/reference/scan", () => {
  it("无项目 → 409 NO_PROJECT_OPEN", async () => {
    const app = buildApp();
    const res = await api(app, "POST", "/api/v1/reference/scan");
    expect(res.status).toBe(409);
    expect((res.json as { error: { code: string } }).error.code).toBe("NO_PROJECT_OPEN");
  });

  it("GET /scan/status：无未同步文件 → 0；外部新增/修改 → 计数；无副作用（不建索引）", async () => {
    openProject();
    const app = buildApp();
    const root = getCurrentProject()!.root;
    const refDir = ensureRefDir(root);
    // 空目录 → 0
    let res = await api(app, "GET", "/api/v1/reference/scan/status");
    expect((res.json as { data: { unsynced: number } }).data.unsynced).toBe(0);
    // 外部新增文件 → 1（只读探测不建索引）
    writeFileSync(join(refDir, "新文件.md"), "内容");
    res = await api(app, "GET", "/api/v1/reference/scan/status");
    expect((res.json as { data: { unsynced: number } }).data.unsynced).toBe(1);
    const countBefore = (getCurrentProject()!.db.prepare("SELECT COUNT(*) AS c FROM entities WHERE type='reference'").get() as { c: number }).c;
    expect(countBefore).toBe(0); // 探测无副作用
    // 扫描后 → 0
    await api(app, "POST", "/api/v1/reference/scan");
    res = await api(app, "GET", "/api/v1/reference/scan/status");
    expect((res.json as { data: { unsynced: number } }).data.unsynced).toBe(0);
  });

  it("扫描本地新增文件建索引 + 返回统计", async () => {
    openProject();
    const app = buildApp();
    const root = getCurrentProject()!.root;
    const refDir = ensureRefDir(root);
    writeFileSync(join(refDir, "本地新增.md"), "---\ntitle: 本地新增\ncategory: inspiration\n---\n内容");
    const res = await api(app, "POST", "/api/v1/reference/scan");
    expect(res.status).toBe(200);
    expect((res.json as { data: { added: number } }).data.added).toBe(1);
    const row = getCurrentProject()!.db.prepare("SELECT name FROM entities WHERE type='reference'").get() as { name: string };
    expect(row.name).toBe("本地新增");
  });
});
