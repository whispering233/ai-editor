// 工作区类型路由守卫测试（卡 3）：requireKind + KIND_MISMATCH / PRACTICE_NOT_FOUND 的错误面
//
// **形态：经 `startServer` 装配真实 app**（不是手搭 Hono）——守卫的挂载点只在 `index.ts` 一处，
// 手搭 app 会把「index.ts 少挂一组」这类缺陷漏掉（本卡的核心风险正是漏挂/顺序挂错）。
// 断言逐组进行（七个小说语义组各取一条代表端点），并在**小说工作区**上跑同一批端点对照，
// 证明 400 KIND_MISMATCH 来自守卫而非「端点本身 404」。
//
// 隔离：临时 HOME（pi agent dir 不出沙箱，同 settings.test.ts）+ 每个用例独立的 tmp 工作区目录；
// 工作区 = 真正落盘的三文件（project.json 显式写 `kind`）。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { OutlineFileTree, WorkspaceKind } from "@whispering233/ai-editor-shared";
import {
  SCHEMA_VERSION,
  closeDatabase,
  openDatabase,
  readProjectFile,
  setUserVersion,
  writeOutlineFile,
  writeProjectFile,
} from "@whispering233/ai-editor-db";
import { startServer, type ServerHandle } from "../index.js";
import { errorHandler, ok } from "../middleware/error.js";
import { requireKind } from "../middleware/kind.js";
import { resetModelRuntime } from "../model-runtime.js";
import { getCurrentProject, setCurrentProject } from "../middleware/project.js";
import { defaultProposalStore } from "@whispering233/ai-editor-agent";
import { buildProposal } from "@whispering233/ai-editor-tools";

const HOST_HEADERS = { host: "127.0.0.1" };
const JSON_HEADERS = { ...HOST_HEADERS, "content-type": "application/json" };
const T0 = "2026-10-01T10:00:00Z";
/** 小说语义端点对练习工作区的固定文案（`docs/api/error-code.md`，key = 被要求的 kind） */
const NOVEL_ONLY_MESSAGE = "该端点仅适用于小说工作区";

const tmpDirs: string[] = [];
const handles: ServerHandle[] = [];
let homeDir: string;
let originalHome: string | undefined;

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 单卷一章（manuscript 探测取 ch-1；novel 侧对照要求章存在才是 200 而非 404） */
function novelOutline(): OutlineFileTree {
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
        children: [{ id: "ch-1", type: "chapter", title: "初见", updated_at: T0, children: [] }],
      },
    ],
  };
}

function emptyOutline(): OutlineFileTree {
  return { id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] };
}

/**
 * 建一个工作区（三文件落盘 + `kind` 显式写入）并**以该目录为创作根启动真实服务**
 * （`detectProject` 打开它 → 当前工作区即该 kind）。
 */
async function startWorkspace(kind: WorkspaceKind, outline: OutlineFileTree = emptyOutline()): Promise<ServerHandle> {
  const dir = makeTmpDir(`ai-editor-kind-${kind}-`);
  tmpDirs.push(dir);
  writeProjectFile(dir, {
    id: `proj-${kind}-1`,
    name: kind === "practice" ? "练习工作区" : "小说工作区",
    language: "zh",
    schema_version: SCHEMA_VERSION,
    current_position: null,
    created_at: T0,
    updated_at: T0,
    kind,
  });
  writeOutlineFile(dir, outline);
  const db = openDatabase(join(dir, "data.db"));
  try {
    setUserVersion(db, SCHEMA_VERSION);
  } finally {
    closeDatabase(db);
  }
  const handle = await startServer(dir, { port: 0, openBrowser: false });
  handles.push(handle);
  expect(handle.project?.config.kind, "前置：服务已打开该工作区").toBe(kind);
  return handle;
}

interface ProbeResult {
  status: number;
  code: string | undefined;
  message: string | undefined;
  contentType: string | null;
}

/** 发一条 JSON 请求（响应非 JSON——如导出 zip——返回 message=undefined 且不解析） */
async function probe(
  handle: ServerHandle,
  req: { method: string; path: string; body?: unknown },
): Promise<ProbeResult> {
  const res = await handle.app.request(req.path, {
    method: req.method,
    headers: req.body === undefined ? HOST_HEADERS : JSON_HEADERS,
    ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
  });
  const contentType = res.headers.get("content-type");
  if (contentType?.includes("application/json") !== true) {
    return { status: res.status, code: undefined, message: undefined, contentType };
  }
  const body = (await res.json()) as { success: boolean; error?: { code: string; message: string } };
  return { status: res.status, code: body.error?.code, message: body.error?.message, contentType };
}

/**
 * 七个**小说语义**路由组各一条代表端点（含组根路径：`/outline`、`/trash`、`/relation` 就挂在组根上，
 * 守卫用 `"/api/v1/<组>/*"` 通配——这条清单同时验证「组根与子路径都被覆盖」）。
 * `novelStatus` = 小说工作区上的既有状态码（守卫不得改写）。
 */
const NOVEL_GROUP_PROBES: { group: string; method: string; path: string; body?: unknown; novelStatus: number }[] = [
  { group: "entity", method: "GET", path: "/api/v1/entity/character", novelStatus: 200 },
  { group: "outline", method: "GET", path: "/api/v1/outline", novelStatus: 200 },
  { group: "manuscript", method: "GET", path: "/api/v1/manuscript/ch-1", novelStatus: 200 },
  { group: "relation", method: "GET", path: "/api/v1/relation?depth=1", novelStatus: 200 },
  { group: "delta", method: "GET", path: "/api/v1/delta/node/ch-1", novelStatus: 200 },
  { group: "trash", method: "GET", path: "/api/v1/trash", novelStatus: 200 },
  { group: "names", method: "POST", path: "/api/v1/names/resolve", body: { ids: [] }, novelStatus: 200 },
];

beforeEach(() => {
  originalHome = process.env.HOME;
  homeDir = makeTmpDir("ai-editor-kind-home-");
  process.env.HOME = homeDir;
  resetModelRuntime(); // pi 运行时单例持有 agent dir 路径：HOME 变了必须重建
});

afterEach(async () => {
  defaultProposalStore.clear(); // 仓为模块级单例（与调度同仓），测试间隔离
  for (const handle of handles.splice(0)) {
    await handle.close(); // 关监听 + 释放 data.db；再清单例（避免留下已关闭的连接）
  }
  setCurrentProject(null);
  resetModelRuntime();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(homeDir, { recursive: true, force: true });
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("工作区类型守卫（requireKind）", () => {
  it("练习工作区访问七个小说语义路由组 → 每组一条端点均 400 KIND_MISMATCH（固定文案）", async () => {
    const practice = await startWorkspace("practice");
    for (const item of NOVEL_GROUP_PROBES) {
      const res = await probe(practice, item);
      expect(res.status, `${item.group} ${item.method} ${item.path}`).toBe(400);
      expect(res.code, `${item.group} ${item.method} ${item.path}`).toBe("KIND_MISMATCH");
      expect(res.message, `${item.group} ${item.method} ${item.path}`).toBe(NOVEL_ONLY_MESSAGE);
    }
  });

  it("小说工作区上同一批端点照常（守卫不改写既有行为）", async () => {
    const novel = await startWorkspace("novel", novelOutline());
    for (const item of NOVEL_GROUP_PROBES) {
      const res = await probe(novel, item);
      expect(res.status, `${item.group} ${item.method} ${item.path}`).toBe(item.novelStatus);
      expect(res.code, `${item.group} ${item.method} ${item.path}`).not.toBe("KIND_MISMATCH");
    }
  });

  it("通用组（project / backup / chat / settings）在练习工作区上均放行；config 读侧字段原样", async () => {
    const practice = await startWorkspace("practice");
    const probes = [
      { path: "/api/v1/project/config", status: 200 },
      { path: "/api/v1/project/list", status: 200 },
      { path: "/api/v1/project/backups", status: 200 },
      { path: "/api/v1/chat/sessions", status: 200 },
      { path: "/api/v1/settings/llm", status: 200 },
    ];
    for (const item of probes) {
      const res = await probe(practice, { method: "GET", path: item.path });
      expect(res.status, item.path).toBe(item.status);
      expect(res.code, item.path).toBeUndefined();
    }
    // 读侧不特殊处理：两项字段仍在响应中，未写入即自然为 null / []
    const config = await practice.app.request("/api/v1/project/config", { headers: HOST_HEADERS });
    const body = (await config.json()) as { data: { kind: string; currentPosition: unknown; deductionNodes: unknown } };
    expect(body.data.kind).toBe("practice");
    expect(body.data.currentPosition).toBeNull();
    expect(body.data.deductionNodes).toEqual([]);
  });

  it("无当前工作区 → 守卫放行，既有 409 NO_PROJECT_OPEN 语义不变", async () => {
    const novel = await startWorkspace("novel", novelOutline());
    setCurrentProject(null); // 待命态（单例清空，服务仍持有该项目的连接）
    const res = await probe(novel, { method: "GET", path: "/api/v1/entity/character" });
    expect(res.status).toBe(409);
    expect(res.code).toBe("NO_PROJECT_OPEN");
  });

  it("反向：requireKind(\"practice\") 在小说工作区上 → 400 KIND_MISMATCH（文案随被要求的 kind）", async () => {
 // 练习路由组本体属卡 5（尚未挂载）——这里只验守卫双向：占位组 + requireKind("practice")
    const app = new Hono();
    app.onError(errorHandler());
    app.use("/api/v1/practice/*", requireKind("practice"));
    app.get("/api/v1/practice/targets", (c) => c.json(ok({ targets: [] })));

    const novel = await startWorkspace("novel", novelOutline());
    const denied = await app.request("/api/v1/practice/targets", { headers: HOST_HEADERS });
    expect(denied.status, "小说工作区访问练习端点").toBe(400);
    expect(((await denied.json()) as { error: { code: string; message: string } }).error).toEqual({
      code: "KIND_MISMATCH",
      message: "该端点仅适用于练习工作区",
    });
    expect(novel.project?.config.kind).toBe("novel"); // 前置：被拒时当前工作区确实是小说

    await startWorkspace("practice"); // 切到练习工作区（单例更新）→ 同一请求放行
    const allowed = await app.request("/api/v1/practice/targets", { headers: HOST_HEADERS });
    expect(allowed.status, "练习工作区访问练习端点").toBe(200);
  });
});

describe("proposal 路由组的工作区类型约束", () => {
  // 端到端闭合：练习工作区上真造提案（工具面尚未按 kind 收窄，属卡 4）→ confirm 必须被守卫
  // 挡在 handler 之前（不落 character 行、不消费提案），而非 404 PROPOSAL_NOT_FOUND。
  it("练习工作区：真造提案 + confirm → 400 KIND_MISMATCH（不是 404，提案未被消费）", async () => {
    const practice = await startWorkspace("practice");
    const project = getCurrentProject()!;
    const proposal = buildProposal(
      { db: project.db, outlineDir: project.root, projectId: project.config.id },
      "propose_create_entity",
      { type: "character", name: "越权角色" },
      [],
      "创建实体「越权角色」（character）",
    );
    defaultProposalStore.set(proposal);

    const res = await probe(practice, { method: "POST", path: `/api/v1/proposal/${proposal.proposal_id}/confirm` });
    expect(res.status, "守卫先于 handler：不是 404 PROPOSAL_NOT_FOUND").toBe(400);
    expect(res.code).toBe("KIND_MISMATCH");
    expect(res.message).toBe(NOVEL_ONLY_MESSAGE);
    // 提案未被消费（守卫拦在 resolveProposal / executeProposal 之前）
    expect(defaultProposalStore.peek(proposal.proposal_id)).not.toBeNull();
  });

  it("练习工作区：不存在的 id 同样 400 KIND_MISMATCH（不是 404）", async () => {
    const practice = await startWorkspace("practice");
    const res = await probe(practice, { method: "POST", path: "/api/v1/proposal/nonexistent/confirm" });
    expect(res.status).toBe(400);
    expect(res.code).toBe("KIND_MISMATCH");
    expect(res.message).toBe(NOVEL_ONLY_MESSAGE);
  });

  it("小说工作区：同请求保持既有 404 PROPOSAL_NOT_FOUND（守卫不改写小说侧语义）", async () => {
    const novel = await startWorkspace("novel", novelOutline());
    const res = await probe(novel, { method: "POST", path: "/api/v1/proposal/nonexistent/confirm" });
    expect(res.status).toBe(404);
    expect(res.code).toBe("PROPOSAL_NOT_FOUND");
  });
});

describe("GET /project/export-novel 的工作区类型约束", () => {
  it("练习工作区 → 400 KIND_MISMATCH（不产包）", async () => {
    const practice = await startWorkspace("practice");
    const res = await probe(practice, { method: "GET", path: "/api/v1/project/export-novel" });
    expect(res.status).toBe(400);
    expect(res.code).toBe("KIND_MISMATCH");
    expect(res.message).toBe(NOVEL_ONLY_MESSAGE);
  });

  it("小说工作区：有可见章 → 200 zip；无可见章 → 400 VALIDATION_ERROR（既有行为不变）", async () => {
    const novel = await startWorkspace("novel", novelOutline());
    const okRes = await probe(novel, { method: "GET", path: "/api/v1/project/export-novel" });
    expect(okRes.status).toBe(200);
    expect(okRes.contentType).toBe("application/zip");

    const empty = await startWorkspace("novel", emptyOutline());
    const emptyRes = await probe(empty, { method: "GET", path: "/api/v1/project/export-novel" });
    expect(emptyRes.status).toBe(400);
    expect(emptyRes.code).toBe("VALIDATION_ERROR");
  });
});

describe("PUT /project/config 的工作区类型约束", () => {
  it("练习工作区：出现 current_position / deduction_nodes（含 null / []）→ 400 KIND_MISMATCH", async () => {
    const practice = await startWorkspace("practice");
    const cases: { body: unknown; note: string }[] = [
      { body: { current_position: null }, note: "null 也是显式写" },
      { body: { current_position: "ch-1" }, note: "非空值" },
      { body: { deduction_nodes: [] }, note: "[] 也是显式写" },
      { body: { deduction_nodes: ["ch-1"] }, note: "非空数组" },
      { body: { name: "改名", current_position: null }, note: "混在同一请求里同样拒绝" },
    ];
    for (const item of cases) {
      const res = await probe(practice, { method: "PUT", path: "/api/v1/project/config", body: item.body });
      expect(res.status, item.note).toBe(400);
      expect(res.code, item.note).toBe("KIND_MISMATCH");
      expect(res.message, item.note).toBe(NOVEL_ONLY_MESSAGE);
    }
  });

  it("练习工作区：通用字段照常写入（盘上 name 更新，小说语义字段不被写上）", async () => {
    const practice = await startWorkspace("practice");
    const res = await probe(practice, {
      method: "PUT",
      path: "/api/v1/project/config",
      body: { name: "练习区改名", language: "en", backup_frequency_minutes: 30 },
    });
    expect(res.status).toBe(200);

    const dir = practice.project!.root;
    const onDisk = readProjectFile(dir)!;
    expect(onDisk.name).toBe("练习区改名");
    expect(onDisk.language).toBe("en");
    expect(onDisk.backup_frequency_minutes).toBe(30);
    expect(onDisk.kind).toBe("practice");
    expect(onDisk.current_position).toBeNull(); // 未被此次写入改动
    expect(onDisk.deduction_nodes).toBeUndefined(); // 未被此次写入补写
  });

  it("小说工作区：current_position / deduction_nodes 原行为不变（200）", async () => {
    const novel = await startWorkspace("novel", novelOutline());
    const res = await probe(novel, {
      method: "PUT",
      path: "/api/v1/project/config",
      body: { current_position: null, deduction_nodes: [] },
    });
    expect(res.status).toBe(200);
    const onDisk = readProjectFile(novel.project!.root)!;
    expect(onDisk.current_position).toBeNull();
    expect(onDisk.deduction_nodes).toEqual([]);
  });
});
