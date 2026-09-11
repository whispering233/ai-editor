// K3 端到端接线测试：faux 模型调用 propose_* 工具 → 提案入仓 + SSE 帧携带载荷
//
// 这是「sink 真的接上了」的证明：不 mock 工具与运行时，只把模型换成 faux provider，
// 断言三处同一 id（tool content / SSE details / 提案仓 key）。

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ToolContext } from "@whispering233/ai-editor-tools";
import { toSseFrame, type SseFrame } from "./events.js";
import { createProjectRuntime, type ProjectRuntime } from "./project-runtime.js";
import { createProposalStore } from "./proposals.js";

const PROJECT_ID = "proj-k3-flow";
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

/** 合法大纲 fixture（提案 build 层会读大纲校验层级） */
function writeOutline(projectRoot: string): void {
  writeFileSync(
    join(projectRoot, "outline.json"),
    JSON.stringify({ id: "root", type: "root", schema_version: 1, children: [] }),
  );
}

describe("提案链路（模型工具调用 → 仓 + SSE）", () => {
  it("propose_outline_node：提案入仓，SSE frame 的 details 携带载荷，三处同一 proposal_id", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1", name: "Faux 1", contextWindow: 128_000, maxTokens: 8192 }] });
    const credentials = new InMemoryCredentialStore();
    await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "faux-key" }));
    const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
    modelRuntime.registerNativeProvider(faux.provider);
    await modelRuntime.refresh({ allowNetwork: false });
    const model = modelRuntime.getModel(faux.provider.id, "faux-1");
    if (model === undefined) throw new Error("faux 模型未注册");

    const projectRoot = mkTempDir("ai-editor-k3-flow-");
    const agentDir = mkTempDir("ai-editor-k3-agentdir-");
    writeOutline(projectRoot);

    const store = createProposalStore();
    const toolContext: ToolContext = {
      db: {} as ToolContext["db"],
      outlineDir: projectRoot,
      projectId: PROJECT_ID,
    };
    const runtime: ProjectRuntime = await createProjectRuntime({
      projectRoot,
      agentDir,
      toolContext,
      modelRuntime,
      model,
      proposalStore: store,
    });

    try {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("propose_outline_node", { type: "chapter", title: "第一卷" })]),
        fauxAssistantMessage("提案已发出，等你确认。"),
      ]);

      const frames: SseFrame[] = [];
      runtime.session.subscribe((event) => {
        const frame = toSseFrame(event, { getContextUsage: () => runtime.session.getContextUsage() });
        if (frame !== null) frames.push(frame);
      });

      await runtime.session.prompt("帮我加一章");

      // 工具帧：PROPOSAL 工具的 details 下发（AUTO 工具的 details 会被剥掉）
      const toolEnd = frames.find(
        (frame) => frame.event === "tool_execution_end" && frame.data.toolName === "propose_outline_node",
      );
      expect(toolEnd).toBeDefined();
      const payload = (toolEnd?.data as { result: { details: { proposal_id: string; type: string; preview: unknown } } })
        .result.details;
      expect(payload.type).toBe("propose_outline_node");
      expect(payload.proposal_id.startsWith("prop_")).toBe(true);
      expect(payload.preview).toMatchObject({ type: "propose_outline_node" });

      // tool content 只给「提案已发出」提示（不含预览细节）
      const content = (toolEnd?.data as { result: { content: Array<{ type: string; text?: string }> } }).result.content;
      const text = content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
      expect(text).toContain(payload.proposal_id);
      expect(text).not.toContain("args");

      // 仓内可查：同一 id、绑定项目、args 为执行参数
      const stored = store.get(payload.proposal_id, PROJECT_ID);
      expect(stored).not.toBeNull();
      expect(stored?.args).toEqual({ type: "chapter", title: "第一卷" });
      expect(store.get(payload.proposal_id, "proj-other")).toBeNull();

      // 帧序列完整性：本轮没有 partial（delta 帧也不带完整消息）
      expect(frames.map((frame) => frame.event)).toContain("agent_end");
      for (const frame of frames) {
        expect(JSON.stringify(frame)).not.toContain("\"partial\"");
      }
    } finally {
      runtime.dispose();
    }
  });
});
