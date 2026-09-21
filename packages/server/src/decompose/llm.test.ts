// 拆解模型调用底座测试：**一律走 pi 的 Agent 路径**（不自建 fetch / 不直连 completeSimple）
// + **每 job 一枚落盘会话、每 turn 独立成根**（卡 22.2，契约 = docs/design/60-decompose.md §2.1）。
//
// 钉住这几件事（都是 2026-09 实测踩过的坑）：
// 1. provider 特化头由 **pi** 注入：opencode 系的 `x-opencode-session`（缺则 400 MissingSessionID）
//    ——断言方式是拿 pi 自己传下来的 `transformHeaders` 跑一遍，看有效头；
// 2. 系统提示词 = 本次调用的 system（不掺 pi 内核提示词、**不注入项目 AGENTS.md**）；
// 3. 会话**落盘**到 `<项目根>/sessions/`，且**同一个 job 只有一枚**（S2/S3/S4 共用）；
// 4. 每 turn 新根：两轮 prompt 后文件里有两条 `parentId: null` 的 message 条目，且第二轮**发给模型的
//    请求体不含第一轮内容**（faux provider 捕获请求体断言——这是 O(N²) 重复付费的唯一防线）；
// 5. 自动压缩关闭（`setAutoCompactionEnabled(false)`）且**不污染用户全局设置**；会话名条目存在；
// 6. 过程条目（`appendCustomEntry`）落盘但**不出现在发给模型的请求体里**；
// 7. 会话 id 适配 pi 的约束（我们的 `job-<nanoid>` 可能以 `-` 结尾 ⇒ 直接当 id 会抛错）。

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { AgentSession, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { DECOMPOSE_SESSION_ID_PREFIX } from "@whispering233/ai-editor-shared";
import {
  DECOMPOSE_LOG_CUSTOM_TYPE,
  decomposeSessionId,
  openDecomposeSession,
  type DecomposeSession,
} from "./llm.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "decompose-llm-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("decomposeSessionId（会话 id 的唯一组装点）", () => {
  it("清掉尾部的 '-'（我们的 job-<nanoid> 实测会出现这种 id）", () => {
    expect(decomposeSessionId("job-L-3IBP5CGYWvbRKY3lzM-")).toBe("decompose-job-L-3IBP5CGYWvbRKY3lzM");
  });

  it("保留合法字符（字母数字 / . / _ / -），去掉其它", () => {
    expect(decomposeSessionId("job-abc_1.2")).toBe("decompose-job-abc_1.2");
    expect(decomposeSessionId("job/ab c")).toBe("decompose-jobabc");
  });

  it("前缀 = shared 的 DECOMPOSE_SESSION_ID_PREFIX（chat 侧守卫 / 保留上限 / 客户端读同一常量）", () => {
    expect(decomposeSessionId("job-x").startsWith(DECOMPOSE_SESSION_ID_PREFIX)).toBe(true);
  });

  it("清不出合法 id → 抛错（静默让 pi 自生成会得到不带前缀的会话文件，守卫认不出它）", () => {
    expect(() => decomposeSessionId("")).toThrow();
    expect(() => decomposeSessionId("---")).toThrow();
  });
});

/** 真运行时 + 内存凭据 + faux provider（provider 名可控；离线、不触网） */
async function runtimeFor(providerId: string): Promise<{ runtime: ModelRuntime; script: (texts: readonly string[]) => void }> {
  const faux = fauxProvider({ provider: providerId, models: [{ id: "m", name: "M" }] });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "faux-key" }));
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  return { runtime, script: (texts) => faux.setResponses(texts.map((text) => fauxAssistantMessage(text))) };
}

interface CapturedRequest {
  systemPrompt?: string;
  messages: unknown;
}

/**
 * 捕获 pi 传给 provider 的请求上下文与有效请求头：**spy 但调用原实现**（真流仍走 faux），
 * `transformHeaders` 是 pi 的 Agent 包装层（core/sdk.js 的 streamFn）传下来的 ⇒ 跑它一次即得有效头。
 */
function capture(runtime: ModelRuntime): {
  requests: CapturedRequest[];
  headers: () => Promise<Record<string, string>>;
} {
  const original = runtime.streamSimple.bind(runtime);
  const calls: Array<SimpleStreamOptions | undefined> = [];
  const requests: CapturedRequest[] = [];
  vi.spyOn(runtime, "streamSimple").mockImplementation((model, context, options) => {
    calls.push(options);
    requests.push(context as CapturedRequest);
    return original(model, context, options);
  });
  return {
    requests,
    headers: async () => {
      const options = calls[0] as
        | { transformHeaders?: (h: Record<string, string>) => Promise<Record<string, string>> }
        | undefined;
      return options?.transformHeaders === undefined ? {} : await options.transformHeaders({});
    },
  };
}

const settings = (provider: string): SettingsManager =>
  SettingsManager.inMemory({ defaultProvider: provider, defaultModel: "m" });

/** 打开一枚拆解会话（cwd / sessions 落点 = 传入的临时项目根） */
function openSession(
  deps: { runtime: ModelRuntime; settings: SettingsManager },
  projectRoot: string,
  jobId = "job-abc",
  bookName = "测试书",
): Promise<DecomposeSession> {
  return openDecomposeSession(deps, { projectRoot, jobId, bookName });
}

/** 会话文件（`<项目根>/sessions/<时间戳>_<会话 id>.jsonl`）的条目（header 除外） */
function sessionEntries(projectRoot: string, sessionId: string): Record<string, unknown>[] {
  const dir = join(projectRoot, "sessions");
  const file = readdirSync(dir).find((name) => name.endsWith(`_${sessionId}.jsonl`));
  if (file === undefined) throw new Error(`会话文件不存在：${sessionId}（${readdirSync(dir).join(",")}）`);
  return readFileSync(join(dir, file), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.type !== "session");
}

describe("openDecomposeSession 经 pi 的 Agent 路径（无工具单轮会话）", () => {
  it("opencode-go：pi 自动带上 x-opencode-session（= 会话 id，已按 pi 约束清洗）", async () => {
    const { runtime, script } = await runtimeFor("opencode-go");
    script(["ok"]);
    const captureSpy = capture(runtime);
    const projectRoot = tempDir();

    const session = await openSession({ runtime, settings: settings("opencode-go") }, projectRoot, "job-abc-");
    // 会话 id 直接用会抛错（尾部 '-'）⇒ 清洗后才是合法 id，同时它也进 provider 头
    await expect(session.complete({ system: "S", user: "U" })).resolves.toMatchObject({ text: "ok" });

    const headers = await captureSpy.headers();
    expect(session.sessionId).toBe("decompose-job-abc");
    expect(headers["x-opencode-session"]).toBe("decompose-job-abc");
    expect(headers["x-opencode-client"]).toBe("pi");
  });

  it("其它 provider：不带 opencode 头（不污染 deepseek 一类直连请求）", async () => {
    const { runtime, script } = await runtimeFor("deepseek");
    script(["ok"]);
    const captureSpy = capture(runtime);

    const session = await openSession({ runtime, settings: settings("deepseek") }, tempDir(), "job-x");
    await session.complete({ system: "S", user: "U" });

    const headers = await captureSpy.headers();
    expect(headers["x-opencode-session"]).toBeUndefined();
    expect(headers["x-opencode-client"]).toBeUndefined();
  });

  it("系统提示词 = 本次的 system；用户消息 = 本次的 user（不掺内核提示词 / 不注入 AGENTS.md）", async () => {
    const { runtime, script } = await runtimeFor("deepseek");
    script(["ok"]);
    const captureSpy = capture(runtime);

    const session = await openSession({ runtime, settings: settings("deepseek") }, tempDir(), "job-sys");
    await session.complete({ system: "拆解系统提示", user: "批素材正文" });

    const request = captureSpy.requests[0];
    // 我们给的是 system prompt 主体；pi 的 prompt builder 会再追加环境块（cwd）——pi 行为，接受不裁剪
    expect(request?.systemPrompt?.startsWith("拆解系统提示")).toBe(true);
    expect(request?.systemPrompt).toContain("Current working directory: ");
    expect(request?.systemPrompt).not.toContain("project_instructions");
    const userText = JSON.stringify(request?.messages);
    expect(userText).toContain("批素材正文");
    expect(userText).not.toContain("AGENTS.md");
    expect(userText).not.toContain("project_instructions");
  });

  it("会话落盘：<项目根>/sessions/decompose-<jobId>.jsonl 存在（chat 面板可见、随备份携带）", async () => {
    const { runtime, script } = await runtimeFor("deepseek");
    script(["ok"]);
    const projectRoot = tempDir();

    const session = await openSession({ runtime, settings: settings("deepseek") }, projectRoot, "job-files");
    await session.complete({ system: "S", user: "U" });

    const files = readdirSync(join(projectRoot, "sessions"));
    expect(files.filter((name) => name.endsWith(`_${session.sessionId}.jsonl`))).toHaveLength(1);
    // 会话名条目（列表里显示「《书名》拆解」而不是被截断的原文）
    expect(sessionEntries(projectRoot, session.sessionId).map((entry) => entry.type)).toContain("session_info");
    expect(sessionEntries(projectRoot, session.sessionId).find((entry) => entry.type === "session_info")?.name).toBe(
      "《测试书》拆解",
    );
  });

  it("每 turn 新根：两轮 prompt 后两条 parentId: null 的 message，且第二轮请求体不含第一轮内容", async () => {
    const { runtime, script } = await runtimeFor("deepseek");
    script(["第一轮回答", "第二轮回答"]);
    const captureSpy = capture(runtime);
    const projectRoot = tempDir();

    const session = await openSession({ runtime, settings: settings("deepseek") }, projectRoot, "job-roots");
    await session.complete({ system: "S1", user: "第一轮原文" });
    await session.complete({ system: "S2", user: "第二轮原文" });

    const messages = sessionEntries(projectRoot, session.sessionId).filter((entry) => entry.type === "message");
    expect(messages).toHaveLength(4); // 两轮各 user + assistant
    // 两轮各成一根（parentId: null 的是各自的用户消息），assistant 挂在本轮用户消息下
    expect(messages.filter((entry) => entry.parentId === null)).toEqual([messages[0], messages[2]]);
    expect(messages[1]?.parentId).toBe(messages[0]?.id);
    expect(messages[3]?.parentId).toBe(messages[2]?.id);

    const second = JSON.stringify(captureSpy.requests[1]?.messages);
    expect(second).toContain("第二轮原文");
    expect(second).not.toContain("第一轮原文");
    expect(second).not.toContain("第一轮回答");
  });

  it("自动压缩关闭（且不改用户全局设置）；同一 job 复用同一枚会话文件", async () => {
    const { runtime, script } = await runtimeFor("deepseek");
    script(["ok", "ok"]);
    const userSettings = settings("deepseek");
    const projectRoot = tempDir();
    const compactionSpy = vi.spyOn(AgentSession.prototype, "setAutoCompactionEnabled");

    const first = await openSession({ runtime, settings: userSettings }, projectRoot, "job-compact");
    await first.complete({ system: "S", user: "U" });
    expect(compactionSpy).toHaveBeenCalledWith(false);

    // 暂停后 resume / 单批重跑：同一 job 再开会话 ⇒ 续写同一枚文件，不产生第二枚
    const again = await openSession({ runtime, settings: userSettings }, projectRoot, "job-compact");
    await again.complete({ system: "S", user: "U2" });

    expect(readdirSync(join(projectRoot, "sessions")).filter((name) => name.endsWith(`_${first.sessionId}.jsonl`))).toHaveLength(1);
    expect(sessionEntries(projectRoot, first.sessionId).filter((entry) => entry.type === "message")).toHaveLength(4);
    // 关压缩走的是本项目设置的内存副本：用户全局设置不受影响（否则 chat 会话的自动压缩会一起被关）
    expect(userSettings.getCompactionEnabled()).toBe(true);
  });

  it("过程条目落盘但不出现在发给模型的请求体里（custom entry 不参与 LLM 上下文）", async () => {
    const { runtime, script } = await runtimeFor("deepseek");
    script(["ok", "ok"]);
    const captureSpy = capture(runtime);
    const projectRoot = tempDir();

    const session = await openSession({ runtime, settings: settings("deepseek") }, projectRoot, "job-log");
    await session.complete({ system: "S", user: "第一轮" });
    session.log({ kind: "batch_start", batchSeq: 1, text: "批 1 开始（3 章）" });
    await session.complete({ system: "S", user: "第二轮" });

    const logs = sessionEntries(projectRoot, session.sessionId).filter((entry) => entry.type === "custom");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ customType: DECOMPOSE_LOG_CUSTOM_TYPE });
    expect(logs[0]?.data).toMatchObject({ kind: "batch_start", text: "批 1 开始（3 章）", batchSeq: 1 });
    expect(Number.isNaN(Date.parse(String((logs[0]?.data as { at?: string }).at)))).toBe(false);

    const second = JSON.stringify(captureSpy.requests[1]?.messages);
    expect(second).not.toContain("批 1 开始");
    expect(second).not.toContain(DECOMPOSE_LOG_CUSTOM_TYPE);
  });
});
