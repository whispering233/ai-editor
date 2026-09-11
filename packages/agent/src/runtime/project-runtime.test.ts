// K2 pi 运行时装配测试（离线：pi-ai faux provider + 临时项目目录，不联网）
//
// 覆盖卡片的硬性检查点：
// 1. 项目 `.pi/extensions` 不被执行（换内核后唯一的代码执行面必须关闭）
// 2. AGENTS.md 只注入项目根那一个文件（祖先目录与 agent dir 都不注入）
// 3. 项目 `.pi/settings.json` 不参与配置（项目可能来自他人）
// 4. 会话文件落 `<项目根>/sessions` 且可被 SessionManager 读回
// 5. 35 个领域工具装配进会话、builtin 全关、faux 工具调用可真正执行
// 6. 系统提示词 = 内核提示词（不含 pi 默认编码 agent 工具说明）
// 7. 未配置凭据/模型时装配失败要显式报错（不静默兜底到某个模型）

import { describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { listTools, type ToolContext } from "@whispering233/ai-editor-tools";
import { projectSessionsDir } from "./paths.js";
import {
  createProjectRuntime,
  NoModelConfiguredError,
  resolveDefaultModel,
  type ProjectRuntime,
} from "./project-runtime.js";

// ============ 夹具 ============

const PROJECT_RULE_TOKEN = "PROJECT_RULE_TOKEN";
const PARENT_RULE_TOKEN = "PARENT_RULE_TOKEN";
const AGENT_DIR_RULE_TOKEN = "AGENT_DIR_RULE_TOKEN";
const OUTLINE_TITLE_TOKEN = "标记卷";

const tempDirs: string[] = [];

function mkTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

interface FauxEnv {
  modelRuntime: ModelRuntime;
  model: Model<Api>;
  faux: ReturnType<typeof fauxProvider>;
}

/** 离线模型环境：faux provider + 内存凭据（无需 auth.json，也不联网） */
async function createFauxEnv(): Promise<FauxEnv> {
  const faux = fauxProvider({ models: [{ id: "faux-1", name: "Faux 1", contextWindow: 128_000, maxTokens: 8192 }] });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "faux-key" }));
  const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.refresh({ allowNetwork: false });
  const model = modelRuntime.getModel(faux.provider.id, "faux-1");
  if (model === undefined) throw new Error("faux 模型未注册进 ModelRuntime");
  return { modelRuntime, model, faux };
}

/** 工具上下文（本批测试只用 get_outline，db 仅为占位） */
function toolContextFor(projectRoot: string): ToolContext {
  return { db: {} as ToolContext["db"], outlineDir: projectRoot, projectId: "proj-k2-test" };
}

/** 合法 outline.json（含可断言的标题标记） */
function writeOutlineFixture(projectRoot: string): void {
  writeFileSync(
    join(projectRoot, "outline.json"),
    JSON.stringify({
      id: "root",
      type: "root",
      schema_version: 1,
      children: [
        {
          id: "vol-1",
          type: "volume",
          title: OUTLINE_TITLE_TOKEN,
          updated_at: "2026-08-01T10:00:00Z",
          children: [],
        },
      ],
    }),
  );
}

/** 装配运行时（agent dir 与项目目录都隔离在临时目录） */
async function setupRuntime(options: {
  projectRoot: string;
  env: FauxEnv;
  agentDir: string;
}): Promise<ProjectRuntime> {
  return createProjectRuntime({
    projectRoot: options.projectRoot,
    toolContext: toolContextFor(options.projectRoot),
    agentDir: options.agentDir,
    modelRuntime: options.env.modelRuntime,
    model: options.env.model,
  });
}

// ============ 1. 扩展不执行 ============

describe("项目扩展（安全面）", () => {
  it("项目 .pi/extensions 不被执行，且加载结果为空", async () => {
    const env = await createFauxEnv();
    const projectRoot = mkTempDir("ai-editor-k2-ext-");
    const agentDir = mkTempDir("ai-editor-k2-agentdir-");
    const markerPath = join(projectRoot, "extension-was-executed.txt");
    mkdirSync(join(projectRoot, ".pi", "extensions"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".pi", "extensions", "marker.ts"),
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(markerPath)}, "executed");\nexport default function extension() {}\n`,
    );

    const runtime = await setupRuntime({ projectRoot, env, agentDir });
    try {
      env.faux.setResponses([fauxAssistantMessage("ok")]);
      await runtime.session.prompt("你好");
      expect(existsSync(markerPath)).toBe(false);
      expect(runtime.services.resourceLoader.getExtensions().extensions).toHaveLength(0);
    } finally {
      runtime.dispose();
    }
  });
});

// ============ 2. AGENTS.md 注入边界 ============

describe("AGENTS.md 注入", () => {
  it("只注入项目根 AGENTS.md（祖先目录与 agent dir 不注入）", async () => {
    const env = await createFauxEnv();
    const base = mkTempDir("ai-editor-k2-agents-");
    const projectRoot = join(base, "book");
    const agentDir = join(base, "agent-dir");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(projectRoot, "AGENTS.md"), `${PROJECT_RULE_TOKEN}\n力量体系：练气 → 筑基`);
    writeFileSync(join(base, "AGENTS.md"), PARENT_RULE_TOKEN);
    writeFileSync(join(agentDir, "AGENTS.md"), AGENT_DIR_RULE_TOKEN);

    const runtime = await setupRuntime({ projectRoot, env, agentDir });
    try {
      const prompt = runtime.session.systemPrompt;
      expect(prompt).toContain(PROJECT_RULE_TOKEN);
      expect(prompt).toContain("<project_instructions");
      expect(prompt).not.toContain(PARENT_RULE_TOKEN);
      expect(prompt).not.toContain(AGENT_DIR_RULE_TOKEN);
    } finally {
      runtime.dispose();
    }
  });
});

// ============ 3. 项目配置不参与 ============

describe("项目 .pi/ 配置", () => {
  it("项目 .pi/settings.json 被忽略（信任为 false）", async () => {
    const env = await createFauxEnv();
    const projectRoot = mkTempDir("ai-editor-k2-settings-");
    const agentDir = mkTempDir("ai-editor-k2-agentdir2-");
    mkdirSync(join(projectRoot, ".pi"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".pi", "settings.json"),
      JSON.stringify({ defaultProvider: "evil", defaultModel: "evil-model" }),
    );

    const runtime = await setupRuntime({ projectRoot, env, agentDir });
    try {
      expect(runtime.settingsManager.isProjectTrusted()).toBe(false);
      expect(runtime.settingsManager.getDefaultModel()).not.toBe("evil-model");
      expect(runtime.settingsManager.getProjectSettings()).toEqual({});
      // 激活模型来自注入（faux），不被项目配置改写
      expect(runtime.session.model?.id).toBe("faux-1");
    } finally {
      runtime.dispose();
    }
  });
});

// ============ 4. 会话落项目目录 ============

describe("会话文件位置", () => {
  it("会话落 <项目根>/sessions 且可被 SessionManager 读回", async () => {
    const env = await createFauxEnv();
    const projectRoot = mkTempDir("ai-editor-k2-session-");
    const agentDir = mkTempDir("ai-editor-k2-agentdir3-");
    env.faux.setResponses([fauxAssistantMessage("第一轮回复")]);

    const runtime = await setupRuntime({ projectRoot, env, agentDir });
    try {
      await runtime.session.prompt("第一轮提问");
      const sessionsDir = projectSessionsDir(projectRoot);
      const files = readdirSync(sessionsDir).filter((name) => name.endsWith(".jsonl"));
      expect(files).toHaveLength(1);
      expect(readFileSync(join(sessionsDir, files[0]!), "utf8")).toContain("第一轮提问");

      const listed = await SessionManager.list(projectRoot, sessionsDir);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(runtime.session.sessionId);

      const reopened = SessionManager.open(join(sessionsDir, files[0]!));
      const userTexts = reopened
        .getEntries()
        .flatMap((entry) => (entry.type === "message" ? [JSON.stringify(entry.message)] : []))
        .join("\n");
      expect(userTexts).toContain("第一轮提问");
    } finally {
      runtime.dispose();
    }

    // dispose 只释放会话订阅，不得删数据：会话文件仍在且可再次读回
    expect(existsSync(join(projectSessionsDir(projectRoot), readdirSync(projectSessionsDir(projectRoot))[0]!))).toBe(
      true,
    );
  });
});

// ============ 5. 工具装配与执行 ============

describe("领域工具装配", () => {
  it("35 个工具全部可用、builtin 全关，faux 的工具调用真正执行", async () => {
    const env = await createFauxEnv();
    const projectRoot = mkTempDir("ai-editor-k2-tools-");
    const agentDir = mkTempDir("ai-editor-k2-agentdir4-");
    writeOutlineFixture(projectRoot);
    env.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("get_outline", {})]),
      fauxAssistantMessage("大纲已读取"),
    ]);

    const runtime = await setupRuntime({ projectRoot, env, agentDir });
    try {
      const toolEnds: Array<{ toolName: string; isError: boolean; text: string }> = [];
      runtime.session.subscribe((event) => {
        if (event.type === "tool_execution_end") {
          toolEnds.push({
            toolName: event.toolName,
            isError: event.isError,
            text: JSON.stringify(event.result),
          });
        }
      });

      const expectedNames = listTools().map((tool) => tool.name);
      const activeNames = runtime.session.getActiveToolNames();
      expect(new Set(activeNames)).toEqual(new Set(expectedNames));
      expect(expectedNames).toHaveLength(35);
      for (const builtin of ["read", "bash", "edit", "write"]) {
        expect(activeNames).not.toContain(builtin);
      }

      await runtime.session.prompt("看下大纲");

      expect(toolEnds).toHaveLength(1);
      expect(toolEnds[0]?.toolName).toBe("get_outline");
      expect(toolEnds[0]?.isError).toBe(false);
      expect(toolEnds[0]?.text).toContain(OUTLINE_TITLE_TOKEN);
    } finally {
      runtime.dispose();
    }
  });
});

// ============ 6. 系统提示词 ============

describe("系统提示词", () => {
  it("内核提示词为主，且不含 pi 默认编码 agent 的工具说明", async () => {
    const env = await createFauxEnv();
    const projectRoot = mkTempDir("ai-editor-k2-prompt-");
    const agentDir = mkTempDir("ai-editor-k2-agentdir5-");

    const runtime = await setupRuntime({ projectRoot, env, agentDir });
    try {
      const prompt = runtime.session.systemPrompt;
      expect(prompt).toContain("创作顾问");
      expect(prompt).toContain("不生成正文");
      expect(prompt).not.toContain("Available tools");
      expect(prompt).not.toContain("bash");
    } finally {
      runtime.dispose();
    }
  });
});

// ============ 7. 无模型/无凭据 → 显式失败 ============

describe("模型解析", () => {
  it("未配置凭据且无显式模型时抛 NoModelConfiguredError", async () => {
    // 直接单测解析函数：注入 stub runtime（不依赖宿主环境变量，也不联网）
    const runtime = {
      getModel: () => undefined,
      getAvailable: async () => [],
    } as unknown as ModelRuntime;
    const settings = SettingsManager.inMemory({}, { projectTrusted: false });

    await expect(resolveDefaultModel(runtime, settings)).rejects.toBeInstanceOf(NoModelConfiguredError);
  });
});
