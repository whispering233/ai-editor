// settings 端点：pi 配置目录 + 本机配置文件（docs/api/90-api-settings.md）
//
// 隔离手法：路径/生效动作被 mock（`state.agentDir` 指向临时目录），**校验逻辑用真实实现**
// （vi.importActual）——非法 JSON 不写盘这条必须验真，不能跟着一起 mock 掉。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  agentDir: "",
  currentProjectRoot: null as string | null,
  activeChat: false,
  calls: [] as string[],
}));

vi.mock("../middleware/project.js", () => ({
  getCurrentProject: () => (state.currentProjectRoot === null ? null : { root: state.currentProjectRoot }),
}));

vi.mock("../chat-runtime.js", () => ({
  hasActiveChat: (root: string) => state.activeChat && root === state.currentProjectRoot,
}));

vi.mock("../pi-agent-dir.js", async () => {
  const actual = await vi.importActual<typeof import("../pi-agent-dir.js")>("../pi-agent-dir.js");
  return {
    ...actual,
    DEFAULT_PI_AGENT_DIR: "/default/pi-agent",
    configFilePath: (name: string) => join(state.agentDir, name),
    resolvePiAgentDir: () => state.agentDir,
    writeConfiguredAgentDir: (dir: string) => {
      state.calls.push(`write-dir:${dir}`);
    },
    applyPiConfigChange: () => {
      state.calls.push("apply");
    },
  };
});

const { errorHandler } = await import("../middleware/error.js");
const { settingsRoutes } = await import("./settings.js");

let dir: string;

function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.route("/api/v1/settings", settingsRoutes);
  return app;
}

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await buildApp().request(path);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function put(path: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await buildApp().request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** 成功响应里的 data（信封 = { code, msg, data }） */
function data(body: Record<string, unknown>): Record<string, unknown> {
  return body.data as Record<string, unknown>;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-settings-cfg-"));
  state.agentDir = join(dir, "pi-agent");
  mkdirSync(state.agentDir, { recursive: true });
  state.currentProjectRoot = null;
  state.activeChat = false;
  state.calls = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("GET/PUT /settings/pi/dir", () => {
  it("GET 返回生效目录 + 缺省目录", async () => {
    const { status, body } = await get("/api/v1/settings/pi/dir");
    expect(status).toBe(200);
    expect(data(body)).toEqual({ dir: state.agentDir, defaultDir: "/default/pi-agent" });
  });

  it("相对路径 / 空串 → 400 VALIDATION_ERROR（不写盘、不触发生效）", async () => {
    for (const value of ["relative/dir", "   "]) {
      const { status, body } = await put("/api/v1/settings/pi/dir", { dir: value });
      expect(status).toBe(400);
      expect((body.error as Record<string, unknown>).code).toBe("VALIDATION_ERROR");
    }
    expect(state.calls).toEqual([]);
  });

  it("绝对路径 → 写 pi.json 并立即生效，响应回显新目录", async () => {
    const target = join(dir, "elsewhere");
    const { status, body } = await put("/api/v1/settings/pi/dir", { dir: target });
    expect(status).toBe(200);
    expect(data(body)).toMatchObject({ dir: state.agentDir });
    expect(state.calls).toEqual([`write-dir:${target}`, "apply"]);
  });

  it("当前项目有在途对话 → 409 CHAT_BUSY（不写盘）", async () => {
    state.currentProjectRoot = join(dir, "book");
    state.activeChat = true;
    const { status, body } = await put("/api/v1/settings/pi/dir", { dir: join(dir, "elsewhere") });
    expect(status).toBe(409);
    expect((body.error as Record<string, unknown>).code).toBe("CHAT_BUSY");
    expect(state.calls).toEqual([]);
  });
});

describe("GET/PUT /settings/config-file/:name", () => {
  it("白名单外的文件名 → 400（绝不进入路径拼接）", async () => {
    const { status, body } = await get("/api/v1/settings/config-file/..%2Fsettings.json");
    expect(status).toBe(400);
    expect((body.error as Record<string, unknown>).code).toBe("VALIDATION_ERROR");
  });

  it("文件不存在 → exists:false + 空文本", async () => {
    const { status, body } = await get("/api/v1/settings/config-file/auth.json");
    expect(status).toBe(200);
    expect(data(body)).toEqual({ name: "auth.json", exists: false, content: "" });
  });

  it("文件存在 → 回传整份原文（含明文凭据）", async () => {
    writeFileSync(state.agentDir + "/auth.json", '{\n  "deepseek": { "type": "api_key", "key": "sk-1" }\n}\n');
    const { body } = await get("/api/v1/settings/config-file/auth.json");
    expect(data(body).content).toContain("sk-1");
    expect(data(body).exists).toBe(true);
  });

  it("非法 JSON / 顶层非对象 → 400 且文件保持原样", async () => {
    const path = join(state.agentDir, "settings.json");
    writeFileSync(path, '{"defaultModel":"m-1"}');
    for (const content of ["{ 坏 JSON", "[1,2]"]) {
      const { status, body } = await put("/api/v1/settings/config-file/settings.json", { content });
      expect(status).toBe(400);
      expect((body.error as Record<string, unknown>).code).toBe("VALIDATION_ERROR");
    }
    expect(readFileSync(path, "utf8")).toBe('{"defaultModel":"m-1"}');
    expect(state.calls).toEqual([]);
  });

  it("models.json 容忍 // 注释与尾逗号（与 pi 读口径一致），原文逐字落盘", async () => {
    const text = '{\n  // 自定义 provider\n  "providers": { "x": { "baseUrl": "http://a" } },\n}\n';
    const { status } = await put("/api/v1/settings/config-file/models.json", { content: text });
    expect(status).toBe(200);
    expect(readFileSync(join(state.agentDir, "models.json"), "utf8")).toBe(text);
    expect(state.calls).toEqual(["apply"]);
  });

  it("search.json 只接受 { apiKey }（未知键 → 400）", async () => {
    const bad = await put("/api/v1/settings/config-file/search.json", { content: '{"api_key":"k"}' });
    expect(bad.status).toBe(400);
    const good = await put("/api/v1/settings/config-file/search.json", { content: '{"apiKey":"sk-1"}' });
    expect(good.status).toBe(200);
    expect(readFileSync(join(state.agentDir, "search.json"), "utf8")).toBe('{"apiKey":"sk-1"}');
  });

  it("空文本允许（= 未配置）", async () => {
    const { status } = await put("/api/v1/settings/config-file/auth.json", { content: "" });
    expect(status).toBe(200);
  });
});

describe("models.json 写入前滚动备份（models.json.bak）", () => {
  const modelsPath = (): string => join(state.agentDir, "models.json");
  const bakPath = (): string => join(state.agentDir, "models.json.bak");
  const first = '{\n  // 旧文\n  "providers": { "x": { "baseUrl": "http://a" } },\n}\n';
  const second = '{ "providers": { "x": { "baseUrl": "http://b" } } }';
  const third = '{ "providers": { "x": { "baseUrl": "http://c" } } }';

  it("写入后 .bak = 旧文；再次写入滚动覆盖上一代", async () => {
    writeFileSync(modelsPath(), first);
    expect((await put("/api/v1/settings/config-file/models.json", { content: second })).status).toBe(200);
    expect(readFileSync(bakPath(), "utf8")).toBe(first);
    expect(readFileSync(modelsPath(), "utf8")).toBe(second);

    expect((await put("/api/v1/settings/config-file/models.json", { content: third })).status).toBe(200);
    expect(readFileSync(bakPath(), "utf8")).toBe(second); // 单份滚动：上一代被覆盖
    expect(readFileSync(modelsPath(), "utf8")).toBe(third);
  });

  it("内容与盘上相同 → 不产生也不改 .bak", async () => {
    writeFileSync(modelsPath(), first);
    expect((await put("/api/v1/settings/config-file/models.json", { content: first })).status).toBe(200);
    expect(existsSync(bakPath())).toBe(false);

    writeFileSync(bakPath(), "上一代");
    expect((await put("/api/v1/settings/config-file/models.json", { content: first })).status).toBe(200);
    expect(readFileSync(bakPath(), "utf8")).toBe("上一代");
  });

  it("文件不存在（首次保存）→ 不备份；其他配置文件不备份", async () => {
    expect((await put("/api/v1/settings/config-file/models.json", { content: second })).status).toBe(200);
    expect(existsSync(bakPath())).toBe(false);

    writeFileSync(join(state.agentDir, "auth.json"), '{"a":{"type":"api_key","key":"sk-1"}}');
    expect((await put("/api/v1/settings/config-file/auth.json", { content: '{"a":{}}' })).status).toBe(200);
    expect(existsSync(join(state.agentDir, "auth.json.bak"))).toBe(false);
  });

  it("备份失败 → 500 INTERNAL_ERROR，主文件不动", async () => {
    writeFileSync(modelsPath(), first);
    mkdirSync(bakPath()); // .bak 是目录 → 原子改名失败
    const { status, body } = await put("/api/v1/settings/config-file/models.json", { content: second });
    expect(status).toBe(500);
    expect((body.error as Record<string, unknown>).code).toBe("INTERNAL_ERROR");
    expect(String((body.error as Record<string, unknown>).message)).toContain("models.json.bak");
    expect(readFileSync(modelsPath(), "utf8")).toBe(first);
    expect(state.calls).toEqual([]); // 中止保存，不再触发「立即生效」
  });

  it(".bak 不在白名单 → 该对端点读写不到它（GET / PUT 都 400）", async () => {
    writeFileSync(bakPath(), "机密");
    const got = await get("/api/v1/settings/config-file/models.json.bak");
    expect(got.status).toBe(400);
    expect((got.body.error as Record<string, unknown>).code).toBe("VALIDATION_ERROR");
    const putRes = await put("/api/v1/settings/config-file/models.json.bak", { content: "{}" });
    expect(putRes.status).toBe(400);
    expect(readFileSync(bakPath(), "utf8")).toBe("机密");
  });
});