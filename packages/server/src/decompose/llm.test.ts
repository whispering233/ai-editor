// 拆解模型调用底座测试：**一律走 pi 的 Agent 路径**（不自建 fetch / 不直连 completeSimple）。
//
// 钉住四件事（都是 2026-09 实测踩过的坑）：
// 1. provider 特化头由 **pi** 注入：opencode 系的 `x-opencode-session`（缺则 400 MissingSessionID）
//    ——断言方式是拿 pi 自己传下来的 `transformHeaders` 跑一遍，看有效头；
// 2. 系统提示词 = 本次调用的 system（不掺 pi 内核提示词、**不注入项目 AGENTS.md**）；
// 3. 会话不落文件（`SessionManager.inMemory`）：cwd 下不产生 `sessions/`；
// 4. 会话 id 适配 pi 的约束（我们的 `job-<nanoid>` 可能以 `-` 结尾 ⇒ 直接当 id 会抛错）。

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { completeOnce, piSessionId } from "./llm.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "decompose-llm-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("piSessionId（适配 pi 的会话 id 约束）", () => {
  it("清掉尾部的 '-'（我们的 job-<nanoid> 实测会出现这种 id）", () => {
    expect(piSessionId("job-L-3IBP5CGYWvbRKY3lzM-")).toBe("job-L-3IBP5CGYWvbRKY3lzM");
  });

  it("保留合法字符（字母数字 / . / _ / -），去掉其它", () => {
    expect(piSessionId("job-abc_1.2")).toBe("job-abc_1.2");
    expect(piSessionId("job/ab c")).toBe("jobabc");
  });

  it("清不出合法 id → undefined（交给 pi 自生成）", () => {
    expect(piSessionId(undefined)).toBeUndefined();
    expect(piSessionId("")).toBeUndefined();
    expect(piSessionId("---")).toBeUndefined();
  });
});

/** 真运行时 + 内存凭据 + faux provider（provider 名可控；离线、不触网） */
async function runtimeFor(providerId: string): Promise<{ runtime: ModelRuntime; script: (text: string) => void }> {
  const faux = fauxProvider({ provider: providerId, models: [{ id: "m", name: "M" }] });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "faux-key" }));
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  return { runtime, script: (text) => faux.setResponses([fauxAssistantMessage(text)]) };
}

interface CapturedRequest {
  systemPrompt?: string;
  messages: unknown;
}

/**
 * 捕获 pi 传给 provider 的请求上下文与有效请求头：**spy 但调用原实现**（真流仍走 faux），
 * `transformHeaders` 是 pi 的 Agent 包装层（core/sdk.js 的 streamFn）传下来的 ⇒ 跑它一次即得有效头。
 */
function capture(runtime: ModelRuntime): { request: () => CapturedRequest | undefined; headers: () => Promise<Record<string, string>> } {
  const original = runtime.streamSimple.bind(runtime);
  const calls: Array<SimpleStreamOptions | undefined> = [];
  let request: CapturedRequest | undefined;
  vi.spyOn(runtime, "streamSimple").mockImplementation((model, context, options) => {
    calls.push(options);
    request = context as CapturedRequest;
    return original(model, context, options);
  });
  return {
    request: () => request,
    headers: async () => {
      const options = calls[0] as { transformHeaders?: (h: Record<string, string>) => Promise<Record<string, string>> } | undefined;
      return options?.transformHeaders === undefined ? {} : await options.transformHeaders({});
    },
  };
}

const settings = (provider: string): SettingsManager =>
  SettingsManager.inMemory({ defaultProvider: provider, defaultModel: "m" });

describe("completeOnce 经 pi 的 Agent 路径（无工具单轮会话）", () => {
  it("opencode-go：pi 自动带上 x-opencode-session（= 会话 id，已按 pi 约束清洗）", async () => {
    const { runtime, script } = await runtimeFor("opencode-go");
    script("ok");
    const captureSpy = capture(runtime);

    // 会话 id 直接用会抛错（尾部 '-'）⇒ 清洗后才是合法 id，同时它也进 provider 头
    await expect(
      completeOnce({ runtime, settings: settings("opencode-go"), cwd: tempDir() }, { system: "S", user: "U" }, "job-abc-"),
    ).resolves.toBe("ok");

    const headers = await captureSpy.headers();
    expect(headers["x-opencode-session"]).toBe("job-abc");
    expect(headers["x-opencode-client"]).toBe("pi");
  });

  it("其它 provider：不带 opencode 头（不污染 deepseek 一类直连请求）", async () => {
    const { runtime, script } = await runtimeFor("deepseek");
    script("ok");
    const captureSpy = capture(runtime);

    await completeOnce({ runtime, settings: settings("deepseek"), cwd: tempDir() }, { system: "S", user: "U" }, "job-x");

    const headers = await captureSpy.headers();
    expect(headers["x-opencode-session"]).toBeUndefined();
    expect(headers["x-opencode-client"]).toBeUndefined();
  });

  it("系统提示词 = 本次的 system；用户消息 = 本次的 user（不掺内核提示词 / 不注入 AGENTS.md）", async () => {
    const { runtime, script } = await runtimeFor("deepseek");
    script("ok");
    const captureSpy = capture(runtime);

    await completeOnce(
      { runtime, settings: settings("deepseek"), cwd: tempDir() },
      { system: "拆解系统提示", user: "批素材正文" },
      "job-sys",
    );

    const request = captureSpy.request();
    // 我们给的是 system prompt 主体；pi 的 prompt builder 会再追加环境块（cwd）——pi 行为，接受不裁剪
    expect(request?.systemPrompt?.startsWith("拆解系统提示")).toBe(true);
    expect(request?.systemPrompt).toContain("Current working directory: ");
    expect(request?.systemPrompt).not.toContain("project_instructions");
    const userText = JSON.stringify(request?.messages);
    expect(userText).toContain("批素材正文");
    expect(userText).not.toContain("AGENTS.md");
    expect(userText).not.toContain("project_instructions");
  });

  it("会话不落文件：cwd 下不产生 sessions/（in-memory 会话）", async () => {
    const { runtime, script } = await runtimeFor("deepseek");
    script("ok");
    const cwd = tempDir();

    await completeOnce({ runtime, settings: settings("deepseek"), cwd }, { system: "S", user: "U" }, "job-files");

    expect(readdirSync(cwd)).toEqual([]);
  });
});
