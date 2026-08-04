// S11.2 端到端冒烟测试：脚本化走查核心链路
//   建项目 → 建大纲 → 建实体 → 建关系 → Delta → 回收站 → 伏笔 → 对话 → 提案确认
//
// 形态（任务卡既定决策）：
//   - 走 HTTP 层：Hono app.request + 真实中间件（errorHandler/originCheck/projectMiddleware）
//     + 真实 tmp 项目目录（project.json/outline.json/data.db 三文件落盘），非独立 node 脚本——
//     沿用仓库测试基建，`pnpm --filter @ai-editor/server test` 全绿即「脚本全绿」。
//   - 对话链路用 mock produce 注入（createChatRoutes({ produce })，不经真实 DeepSeek）：
//     mock 模仿真实 LLM——第 1 轮输出文本 + get_outline 工具调用（**不注入 dispatcher**，
//     走真实 createToolDispatcher 在真实项目上执行真实工具），第 2 轮纯文本收尾；
//     步骤 9 独立 mock 走 propose_create_entity → proposal 事件 → confirm → 真实落库（决策 14）。
//   - 自包含：不修改任何现有文件；SSE 解析/装配 helper 参照 chat.test.ts 同款写法复制。
//
// 断言风格：单条长 it 按 9 步顺序执行（步骤间强依赖 id 流转，连贯性优先，可读性靠
//   编号注释保证）；响应包裹契约 {success:true,data}/{success:false,error:{code,message}}；
//   请求体 snake_case、响应 camelCase；软删/还原级联计数只断言 >= 1（非本卡目标，不死抠数字）。
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { defaultProposalStore, type RunAgentDeps } from "@ai-editor/agent";
import { errorHandler, ok } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
} from "../middleware/project.js";
import { initDebugConfig } from "../debug.js";
import { projectRoutes, setProjectRoot } from "./project.js";
import { createChatRoutes } from "./chat.js";
import { deltaRoutes } from "./delta.js";
import { entityRoutes } from "./entity.js";
import { outlineRoutes } from "./outline.js";
import { proposalRoutes } from "./proposal.js";
import { relationRoutes } from "./relation.js";
import { settingsRoutes } from "./settings.js";
import { trashRoutes } from "./trash.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "smoke-"));
  tmpDirs.push(dir);
  return dir;
}

/**
 * 组装全链路测试 app（镜像 index.ts 装配：错误兜底 → 来源校验 → 项目上下文 → 全部业务路由）。
 * chat 路由经 createChatRoutes(deps) 注入（S11.2：mock produce 不经真实 DeepSeek）。
 */
function buildApp(chat: Hono): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.get("/api/v1/health", (c) => c.json(ok({ status: "ok" })));
  app.route("/api/v1/settings", settingsRoutes);
  app.route("/api/v1/entity", entityRoutes);
  app.route("/api/v1/project", projectRoutes);
  app.route("/api/v1/outline", outlineRoutes);
  app.route("/api/v1/trash", trashRoutes);
  app.route("/api/v1/relation", relationRoutes);
  app.route("/api/v1/delta", deltaRoutes);
  app.route("/api/v1/chat", chat);
  app.route("/api/v1/proposal", proposalRoutes);
  return app;
}

// ============ HTTP 请求辅助 ============

/**
 * JSON 接口调用辅助（GET/POST/PUT/DELETE 通用）：
 * 返回状态码 + 完整响应体（body 类型沿用 Hono Response.json() 的松散推断——与现有路由测试
 * 的 `(await res.json()).data` 断言风格一致，避免逐字段类型收窄样板）。
 */
async function api(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? HOST_HEADERS : { ...HOST_HEADERS, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ============ SSE 解析辅助（S7.6 同款，复制自 chat.test.ts） ============

interface SseFrame {
  event: string;
  data: unknown;
}

/** 解析单个 SSE 帧（event/data 提取；data JSON 解析失败保留原文） */
function parseSseFrame(raw: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) {
      let value = line.slice("data:".length);
      if (value.startsWith(" ")) value = value.slice(1);
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) return null;
  const text = dataLines.join("\n");
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // 保留原文（非 JSON data 属异常流，测试中不应出现）
  }
  return { event, data };
}

/** 读取 SSE 响应直至流结束/超时（返回全部帧）；超时兜底 cancel 并吸收挂起 read 的拒绝 */
async function readSseFrames(res: Response, timeoutMs = 5000): Promise<SseFrame[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: SseFrame[] = [];
  let pending: Promise<{ done: boolean; value?: Uint8Array }> | null = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    pending = reader.read();
    const remaining = deadline - Date.now();
    const timer = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), Math.max(remaining, 1)));
    const out = await Promise.race([pending, timer]);
    if (out === "timeout") break;
    if (out.done) break;
    buffer += decoder.decode(out.value as Uint8Array, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const frame = parseSseFrame(raw);
      if (frame) frames.push(frame);
    }
  }
  await reader.cancel().catch(() => {});
  await pending?.catch(() => {}); // 吸收 cancel 引起的挂起 read 拒绝（unhandled rejection 防御）
  return frames;
}

// ============ 环境隔离（参照 chat.test.ts：项目单例 / 提案仓 / HOME / key / 调试配置） ============

let originalHome: string | undefined;
let originalKey: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-smoke-"));
  setCurrentProject(null);
  setProjectRoot(tmpRoot); // 创作根（书架模式语义；冒烟链路不用 list，仅为装配完整性）
  defaultProposalStore.clear(); // 提案仓为模块级单例，测试间隔离（get_outline 不产提案，防御性清空）
  originalHome = process.env.HOME;
  originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.HOME = tmpRoot; // 用户级配置隔离（决策 17 key 来源；mock produce 注入时不读 key，防御性）
  delete process.env.DEEPSEEK_API_KEY;
  initDebugConfig(undefined); // 调试默认全关（无配置文件）
});

afterEach(() => {
  const cur = getCurrentProject();
  if (cur !== null) {
    closeProject(cur);
    setCurrentProject(null);
  }
  setProjectRoot(null);
  defaultProposalStore.clear();
  initDebugConfig(undefined);
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalKey !== undefined) process.env.DEEPSEEK_API_KEY = originalKey;
  else delete process.env.DEEPSEEK_API_KEY;
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ============ S11.2 端到端冒烟链路（8 步） ============

describe("S11.2 端到端冒烟：建项目→大纲→实体→关系→Delta→回收站→伏笔→对话（真实 HTTP + tmp 项目 + mock LLM）", () => {
  it("完整链路 8 步走查全绿", async () => {
    const projectDir = makeTmpDir();

    // mock LLM（决策：对话链路注入 mock produce，不经真实 DeepSeek）：
    // 第 1 轮：文本 + get_outline 工具调用（真实 dispatcher 在真实项目上执行真实工具）；
    // 第 2 轮：纯文本收尾（stop）。显式泛型保持 ok:true 字面类型（ChatStreamResult 判别联合）。
    const produce = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, onEvent) => {
      if (produce.mock.calls.length === 1) {
        onEvent?.({ type: "text", delta: "让我看看大纲。" });
        onEvent?.({
          type: "tool_call",
          toolCall: { id: "call_1", name: "get_outline", rawArguments: "{}", arguments: {} },
        });
        return { ok: true, stopReason: "tool_calls", usage: null };
      }
      onEvent?.({ type: "text", delta: "大纲共一卷、一章、两场，结构完整。" });
      return { ok: true, stopReason: "stop", usage: null };
    });
    const app = buildApp(createChatRoutes({ produce }));

    // ============ 步骤 1：建项目（create + open + config，三文件落地） ============
    const created = await api(app, "POST", "/api/v1/project/create", {
      path: projectDir,
      config: { name: "冒烟测试书", prompt: "测试提示词" },
    });
    expect(created.status).toBe(200);
    expect(created.body.data.created).toBe(true);
    expect(created.body.data.id).toMatch(/^proj-/);
    expect(created.body.data.path).toBe(projectDir);
    const projectId = created.body.data.id;

    // 三文件落地（决策 8：project.json + outline.json + data.db）
    expect(existsSync(join(projectDir, "project.json"))).toBe(true);
    expect(existsSync(join(projectDir, "outline.json"))).toBe(true);
    expect(existsSync(join(projectDir, "data.db"))).toBe(true);

    // create 不自动打开（S1.2 语义：config 仍 409 NO_PROJECT_OPEN）→ open 后 config 可读
    const preOpen = await api(app, "GET", "/api/v1/project/config");
    expect(preOpen.status).toBe(409);
    expect(preOpen.body.error.code).toBe("NO_PROJECT_OPEN");

    const opened = await api(app, "POST", "/api/v1/project/open", { path: projectDir });
    expect(opened.status).toBe(200);
    expect(opened.body.data.id).toBe(projectId);
    expect(opened.body.data.name).toBe("冒烟测试书");
    expect(opened.body.data.config.schemaVersion).toBeTypeOf("number");

    const config = await api(app, "GET", "/api/v1/project/config");
    expect(config.status).toBe(200);
    expect(config.body.data.id).toBe(projectId);
    expect(config.body.data.name).toBe("冒烟测试书");
    expect(config.body.data.prompt).toBe("测试提示词");
    expect(config.body.data.currentPosition).toBeNull();
    expect(config.body.data.schemaVersion).toBeTypeOf("number");

    // ============ 步骤 2：建大纲（严格三层，parent_id 必填，决策 19） ============
    const vol = await api(app, "POST", "/api/v1/outline", { type: "volume", title: "第一卷", parent_id: "root" });
    expect(vol.status).toBe(201);
    expect(vol.body.data.id).toMatch(/^vol-/);
    expect(vol.body.data.parentId).toBe("root");
    const volId = vol.body.data.id;

    const ch = await api(app, "POST", "/api/v1/outline", { type: "chapter", title: "第一章", parent_id: volId });
    expect(ch.status).toBe(201);
    expect(ch.body.data.id).toMatch(/^ch-/);
    expect(ch.body.data.parentId).toBe(volId);
    const chId = ch.body.data.id;

    const sc1 = await api(app, "POST", "/api/v1/outline", { type: "scene", title: "夜访雾城", parent_id: chId });
    expect(sc1.status).toBe(201);
    expect(sc1.body.data.id).toMatch(/^sc-/);
    const sc1Id = sc1.body.data.id;

    const sc2 = await api(app, "POST", "/api/v1/outline", { type: "scene", title: "码头对峙", parent_id: chId });
    expect(sc2.status).toBe(201);
    expect(sc2.body.data.id).toMatch(/^sc-/);
    const sc2Id = sc2.body.data.id;

    // 整树结构验证：卷→章→场景严格三层
    const tree = await api(app, "GET", "/api/v1/outline");
    expect(tree.status).toBe(200);
    expect(tree.body.data.id).toBe("root");
    const volNode = tree.body.data.children[0];
    expect(volNode.id).toBe(volId);
    expect(volNode.type).toBe("volume");
    expect(volNode.title).toBe("第一卷");
    const chNode = volNode.children[0];
    expect(chNode.id).toBe(chId);
    expect(chNode.type).toBe("chapter");
    expect(chNode.children.map((n: { id: string }) => n.id)).toEqual([sc1Id, sc2Id]);

    // ============ 步骤 3：建实体（四类各一，id 前缀校验） ============
    const char = await api(app, "POST", "/api/v1/entity/character", {
      name: "林晚",
      data: { role: "主角", status: "active" },
    });
    expect(char.status).toBe(201);
    expect(char.body.data.id).toMatch(/^char-/);
    const charId = char.body.data.id;

    const set = await api(app, "POST", "/api/v1/entity/setting", { name: "雾城", data: { category: "都市" } });
    expect(set.status).toBe(201);
    expect(set.body.data.id).toMatch(/^set-/);
    const setId = set.body.data.id;

    const loc = await api(app, "POST", "/api/v1/entity/location", { name: "临江码头", data: { type: "地标" } });
    expect(loc.status).toBe(201);
    expect(loc.body.data.id).toMatch(/^loc-/);
    const locId = loc.body.data.id;
    // 详情可访问（详情页契约字段：data 完整透传）
    const locDetail = await api(app, "GET", `/api/v1/entity/location/${locId}`);
    expect(locDetail.status).toBe(200);
    expect(locDetail.body.data.name).toBe("临江码头");
    expect(locDetail.body.data.data).toEqual({ type: "地标" });

    const hook = await api(app, "POST", "/api/v1/entity/hook", {
      name: "身世之谜",
      data: { status: "planted", payoff_timing: "endgame" },
    });
    expect(hook.status).toBe(201);
    expect(hook.body.data.id).toMatch(/^hook-/);
    const hookId = hook.body.data.id;

    // ============ 步骤 4：建关系（实体关系 + plot_edge；重复三元组 409） ============
    // ① 实体关系（character → setting，belongs_to）
    const rel = await api(app, "POST", "/api/v1/relation", {
      source_type: "character",
      source_id: charId,
      target_type: "setting",
      target_id: setId,
      relation_type: "belongs_to",
    });
    expect(rel.status).toBe(201);
    expect(rel.body.data.id).toMatch(/^rel-/);
    expect(rel.body.data.relation).toEqual({
      sourceType: "character",
      sourceId: charId,
      targetType: "setting",
      targetId: setId,
      relationType: "belongs_to",
    });

    // 重复建同三元组 → 409 RELATION_EXISTS
    const dup = await api(app, "POST", "/api/v1/relation", {
      source_type: "character",
      source_id: charId,
      target_type: "setting",
      target_id: setId,
      relation_type: "belongs_to",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("RELATION_EXISTS");

    // ② plot_edge（scene1 → scene2，metadata.label，画布连线，决策 10）
    const edge = await api(app, "POST", "/api/v1/relation", {
      source_type: "outline_node",
      source_id: sc1Id,
      target_type: "outline_node",
      target_id: sc2Id,
      relation_type: "plot_edge",
      metadata: { label: "路径A" },
    });
    expect(edge.status).toBe(201);
    expect(edge.body.data.id).toMatch(/^rel-/);
    const edgeId = edge.body.data.id;

    // GET /relation 按 relation_type 过滤（depth=1 紧邻）
    const edges = await api(app, "GET", "/api/v1/relation?depth=1&relation_type=plot_edge");
    expect(edges.status).toBe(200);
    const edgeRow = edges.body.data.relations.find((r: { id: string }) => r.id === edgeId);
    expect(edgeRow).toBeDefined();
    expect(edgeRow.sourceId).toBe(sc1Id);
    expect(edgeRow.targetId).toBe(sc2Id);
    expect(edgeRow.metadata).toEqual({ label: "路径A" });

    // ============ 步骤 5：Delta（决策 9：父链累积 + 兄弟分支不累积） ============
    const delta = await api(app, "POST", "/api/v1/delta", {
      node_id: sc1Id,
      target_type: "character",
      target_id: charId,
      changes: [{ field: "status", op: "update", from: "active", to: "wounded" }],
      description: "夜访雾城时受伤",
    });
    expect(delta.status).toBe(201);
    expect(delta.body.data.id).toMatch(/^delta-/);
    expect(delta.body.data.applied.changes[0]).toEqual({ field: "status", op: "update", from: "active", to: "wounded" });

    // 到达 scene1：树路径上累积 Delta → status = wounded
    const compute = await api(app, "POST", "/api/v1/delta/compute", {
      target_type: "character",
      target_id: charId,
      at_node_id: sc1Id,
    });
    expect(compute.status).toBe(200);
    expect(compute.body.data.state.status).toBe("wounded");
    expect(compute.body.data.state.role).toBe("主角"); // 初始 data 保留
    expect(compute.body.data.appliedDeltas).toHaveLength(1);
    expect(compute.body.data.conflicts).toEqual([]);

    // 到达 scene2（兄弟分支）：scene1 的 Delta 不在路径上 → 状态不累积（决策 9 树路径语义）
    const computeSc2 = await api(app, "POST", "/api/v1/delta/compute", {
      target_type: "character",
      target_id: charId,
      at_node_id: sc2Id,
    });
    expect(computeSc2.status).toBe(200);
    expect(computeSc2.body.data.state.status).toBe("active");

    // ============ 步骤 6：回收站（决策 12：软删 → 列表 → 级联还原 → 常规查询恢复） ============
    const del = await api(app, "DELETE", `/api/v1/entity/character/${charId}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);
    expect(del.body.data.cascaded.relations).toBeGreaterThanOrEqual(1); // belongs_to 级联软删
    expect(del.body.data.cascaded.deltas).toBeGreaterThanOrEqual(1); // 步骤 5 的 Delta 级联软删

    // 软删后常规查询 404（决策 12 修订：常规查询默认过滤软删对象）
    const afterDelete = await api(app, "GET", `/api/v1/entity/character/${charId}`);
    expect(afterDelete.status).toBe(404);
    expect(afterDelete.body.error.code).toBe("ENTITY_NOT_FOUND");

    // 回收站列表包含该实体
    const trash = await api(app, "GET", "/api/v1/trash");
    expect(trash.status).toBe(200);
    const inTrash = trash.body.data.entities.find((e: { id: string }) => e.id === charId);
    expect(inTrash).toBeDefined();
    expect(inTrash.type).toBe("character");
    expect(inTrash.name).toBe("林晚");
    expect(inTrash.deletedAt).toBeTypeOf("string");

    // 还原（级联还原关联关系与 Delta）
    const restore = await api(app, "POST", `/api/v1/trash/entity/character/${charId}/restore`);
    expect(restore.status).toBe(200);
    expect(restore.body.data.restored).toBe(true);
    expect(restore.body.data.restoredRelations).toBeGreaterThanOrEqual(1);
    expect(restore.body.data.restoredDeltas).toBeGreaterThanOrEqual(1);

    // 还原生效：回收站不再包含 + 常规查询可访问（决策 12：还原后端点可见）
    const trash2 = await api(app, "GET", "/api/v1/trash");
    expect(trash2.status).toBe(200);
    expect(trash2.body.data.entities.find((e: { id: string }) => e.id === charId)).toBeUndefined();

    const detail = await api(app, "GET", `/api/v1/entity/character/${charId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.name).toBe("林晚");
    expect(detail.body.data.relations).toHaveLength(1); // belongs_to 级联还原后可见
    expect(detail.body.data.relations[0].relationType).toBe("belongs_to");
    expect(detail.body.data.deltaCount).toBeGreaterThanOrEqual(1); // Delta 级联还原

    // Delta 级联还原后 compute 语义恢复
    const compute2 = await api(app, "POST", "/api/v1/delta/compute", {
      target_type: "character",
      target_id: charId,
      at_node_id: sc1Id,
    });
    expect(compute2.status).toBe(200);
    expect(compute2.body.data.state.status).toBe("wounded");

    // ============ 步骤 7：伏笔（plants/advances 关系，outline_node → hook，hooks.md 方向） ============
    const plant = await api(app, "POST", "/api/v1/relation", {
      source_type: "outline_node",
      source_id: sc1Id,
      target_type: "hook",
      target_id: hookId,
      relation_type: "plants",
    });
    expect(plant.status).toBe(201);

    const advance = await api(app, "POST", "/api/v1/relation", {
      source_type: "outline_node",
      source_id: sc2Id,
      target_type: "hook",
      target_id: hookId,
      relation_type: "advances",
    });
    expect(advance.status).toBe(201);

    // S9.2 语义：伏笔标记数据源（source_type=outline_node & relation_type=plants）
    const plants = await api(app, "GET", "/api/v1/relation?depth=1&source_type=outline_node&relation_type=plants");
    expect(plants.status).toBe(200);
    expect(plants.body.data.relations).toHaveLength(1);
    expect(plants.body.data.relations[0].sourceId).toBe(sc1Id);
    expect(plants.body.data.relations[0].targetId).toBe(hookId);
    expect(plants.body.data.relations[0].targetName).toBe("身世之谜");

    const advances = await api(app, "GET", "/api/v1/relation?depth=1&source_type=outline_node&relation_type=advances");
    expect(advances.status).toBe(200);
    expect(advances.body.data.relations.map((r: { sourceId: string }) => r.sourceId)).toEqual([sc2Id]);

    // ============ 步骤 8：对话（mock LLM 两轮：tool_call 轮 + 文本收尾轮；SSE 六类事件子集） ============
    const chatRes = await app.request("/api/v1/chat", {
      method: "POST",
      headers: { ...HOST_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "帮我看看大纲" }),
    });
    expect(chatRes.status).toBe(200);
    expect(chatRes.headers.get("content-type")).toContain("text/event-stream");

    const frames = await readSseFrames(chatRes);
    // 事件序列：text → tool_call → tool_result → text → done（endpoints.md 六类事件子集）
    expect(frames.map((f) => f.event)).toEqual(["text", "tool_call", "tool_result", "text", "done"]);
    expect(frames[0].data).toEqual({ delta: "让我看看大纲。" });
    expect(frames[1].data).toEqual({ tool: "get_outline", args: {}, id: "call_1" });
    // tool_result 为真实工具执行结果（真实 dispatcher + 真实项目）：大纲树 JSON
    const toolResult = frames[2].data as { tool: string; result: string; id: string };
    expect(toolResult.tool).toBe("get_outline");
    expect(toolResult.id).toBe("call_1");
    const outlineJson = JSON.parse(toolResult.result) as { id: string; children: Array<{ title: string }> };
    expect(outlineJson.id).toBe("root");
    expect(outlineJson.children[0].title).toBe("第一卷");
    expect(frames[3].data).toEqual({ delta: "大纲共一卷、一章、两场，结构完整。" });
    const done = frames[4].data as { session_id: string };
    expect(done.session_id).toMatch(/^sess_/); // 新建会话（endpoints.md id 约定）
    const sessionId = done.session_id;

    // 会话落库（决策 18）：列表 + 消息配对（user/assistant/tool + tool_calls/tool_call_id）
    const sessions = await api(app, "GET", "/api/v1/chat/sessions");
    expect(sessions.status).toBe(200);
    expect(sessions.body.data.sessions).toHaveLength(1);
    expect(sessions.body.data.sessions[0].id).toBe(sessionId);
    expect(sessions.body.data.sessions[0].messageCount).toBe(4);

    const msgs = await api(app, "GET", `/api/v1/chat/sessions/${sessionId}/messages`);
    expect(msgs.status).toBe(200);
    expect(msgs.body.data.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(msgs.body.data.messages[0].content).toBe("帮我看看大纲");
    expect(msgs.body.data.messages[1].toolCalls).toHaveLength(1);
    expect(msgs.body.data.messages[1].toolCalls[0].function.name).toBe("get_outline");
    expect(msgs.body.data.messages[2].toolCallId).toBe("call_1");
    expect(msgs.body.data.messages[3].content).toBe("大纲共一卷、一章、两场，结构完整。");

    // ============ 步骤 9：提案链路（oracle 审核建议——AI 写操作端到端：propose → proposal 事件 → confirm → 真实落库，决策 14） ============
    // 独立 mock produce：第 1 轮 = propose_create_entity 工具调用（真实 dispatcher 在真实项目执行 →
    //   提案入仓 + proposal 事件），第 2 轮纯文本收尾；与步骤 8 共用同一 open 项目（defaultProposalStore
    //   是模块级单例，跨 app 实例共享——proposal 事件与 confirm 路由同仓，符合生产单进程语义）
    const proposeProduce = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, onEvent) => {
      if (proposeProduce.mock.calls.length === 1) {
        onEvent?.({
          type: "tool_call",
          toolCall: {
            id: "call_2",
            name: "propose_create_entity",
            rawArguments: JSON.stringify({ type: "character", name: "AI 提案角色" }),
            arguments: { type: "character", name: "AI 提案角色" },
          },
        });
        return { ok: true, stopReason: "tool_calls", usage: null };
      }
      onEvent?.({ type: "text", delta: "已提交角色创建提案，请确认。" });
      return { ok: true, stopReason: "stop", usage: null };
    });
    const proposeApp = buildApp(createChatRoutes({ produce: proposeProduce }));
    const proposeRes = await proposeApp.request("/api/v1/chat", {
      method: "POST",
      headers: { ...HOST_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "新建一个角色" }),
    });
    expect(proposeRes.status).toBe(200);

    const proposeFrames = await readSseFrames(proposeRes);
    // 事件序列：tool_call(propose) → tool_result → proposal → text → done（proposal 在对应 tool_result 后、循环继续前）
    expect(proposeFrames.map((f) => f.event)).toEqual(["tool_call", "tool_result", "proposal", "text", "done"]);
    expect((proposeFrames[0].data as { tool: string }).tool).toBe("propose_create_entity");
    const proposal = proposeFrames[2].data as { proposal_id: string; type: string };
    expect(proposal.proposal_id).toMatch(/^prop_/);
    expect(proposal.type).toBe("propose_create_entity");

    // confirm → executor 真实落库（决策 14：快照重校验 + 一次性消费；result = 新建实体 { id }）
    const confirmed = await api(proposeApp, "POST", `/api/v1/proposal/${proposal.proposal_id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.confirmed).toBe(true);
    expect(confirmed.body.data.result.id).toMatch(/^char-/);

    // 实体真实落库可见（GET /entity/character 列表含新角色）
    const chars = await api(proposeApp, "GET", "/api/v1/entity/character");
    expect(chars.status).toBe(200);
    expect(chars.body.data.items.map((e: { name: string }) => e.name)).toContain("AI 提案角色");

    // 一次性消费：重复 confirm → 404 PROPOSAL_NOT_FOUND（决策 14 终态守卫）
    const dupConfirm = await api(proposeApp, "POST", `/api/v1/proposal/${proposal.proposal_id}/confirm`);
    expect(dupConfirm.status).toBe(404);
    expect(dupConfirm.body.error.code).toBe("PROPOSAL_NOT_FOUND");

    // 会话落库（步骤 8 + 步骤 9 共 2 个会话，决策 18 按项目隔离）
    const sessions2 = await api(proposeApp, "GET", "/api/v1/chat/sessions");
    expect(sessions2.status).toBe(200);
    expect(sessions2.body.data.sessions).toHaveLength(2);
  });
});
