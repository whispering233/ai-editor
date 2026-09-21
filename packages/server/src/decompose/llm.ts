// 拆解管线的模型调用底座（S2 批抽取 / S3 别名归并 / S4 报告共用）。
//
// **一律走 pi 的 Agent 路径**（2026-09 裁决）：不自建 fetch、不直连 `ModelRuntime.completeSimple`。
// 理由：provider 特化行为（如 opencode 系的 `x-opencode-session`，缺则 400 MissingSessionID）、
// 重试/超时设置（`getProviderRetrySettings`）、思考档位都**只在 pi 的 Agent 包装层生效**
// （`pi-coding-agent` core/sdk.js 的 streamFn → `transformHeaders` → `mergeProviderAttributionHeaders`），
// 自己补一遍等于「无限期跟随上游」。
//
// 形态 = **每 job 一枚落盘会话，每 turn 独立成根**（docs/design/60-decompose.md §2.1）：
// - 落点：`<项目根>/sessions/<时间戳>_decompose-<jobId>.jsonl`（与 chat 会话同目录 ⇒ 随备份/导出/云携带）；
// - 会话 id：`decompose-<清洗后的 jobId>`（清洗与组装同一纯函数 `decomposeSessionId`；前缀常量在 shared）；
// - 每 turn：`resetLeaf()` 后再 prompt ⇒ 本轮用户消息是**新根**（`parentId: null`），模型上下文只含本轮
//   ——累积历史是 O(N²) 重复付费（一本 757 章的书差两个数量级），故每轮必须新根；
// - 自动压缩关闭（一轮一上下文，没有可压缩的东西）；
// - 过程条目 `appendCustomEntry("decompose", …)`：**不参与 LLM 上下文**，供 `#/decompose` 时间线读；
// - system prompt 按调用给（S2 / S3 / S4 各一套）⇒ 每次调用新建一个 AgentSession，但**共用同一枚
//   SessionManager**（会话文件只有一枚）；`noTools: "all"`（拆解不需要任何工具，正文由服务端注入）；
// - 既有会话文件（暂停后 resume / 单批重跑）复用同一枚：否则同一 job 会散成多枚文件（§7.2 的上限按 job 算）。
//
// 两个 pi 行为上的坑（实测）：
// 1. `resetLeaf()` 只重置 pi 的 leaf 指针，**不清 agent 的内存消息**——若建会话时 leaf 还指着上一轮，
//    pi 会把整段历史装回 agent 再发出去（实测第二轮请求体含第一轮原文）⇒ 建会话**前**先 resetLeaf；
// 2. 建会话会往会话里写 `model_change` / `thinking_level_change` 元数据条目并推进 leaf ⇒ prompt 前
//    再 resetLeaf 一次，本轮用户消息才是新根（元数据条目留在文件里，与 chat 会话同形态）。
//
// `setAutoCompactionEnabled(false)` 写的是 settingsManager（会落盘）⇒ 拆解用**本项目设置快照的内存副本**
// （`SettingsManager.inMemory`），绝不改用户全局设置（否则会把 chat 会话的自动压缩一起关掉）。
//
// 模型目录 / 凭据 / settings 全经 server 的 `getModelRuntime()` / `getSettingsManager()` 单例，
// 出站统一走启动时装好的全局 undici dispatcher（http-dispatcher.ts）。`deps` 可注入：测试用
// faux provider 离线跑通，不触网。

import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { contentText, parseJsonWithRepair, type AssistantMessage, type Usage } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  SettingsManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { DECOMPOSE_SESSION_ID_PREFIX } from "@whispering233/ai-editor-shared";
import { projectSessionsDir, resolveAgentDir } from "@whispering233/ai-editor-agent";
import { getModelRuntime, getSettingsManager, resolveActiveSelection } from "../model-runtime.js";

/** 拆解管线的可注入依赖（缺省走 pi 单例；同一份依赖贯穿 S2 / S3 / S4） */
export interface DecomposeLlmDeps {
  runtime?: ModelRuntime;
  settings?: SettingsManager;
}

/** 单次补全入参（系统提示 = 角色与输出契约；用户消息 = 本次素材） */
export interface ModelRequest {
  system: string;
  user: string;
}

/** 单次补全产物：末条 assistant 文本 + 本次用量（过程条目记用量用） */
export interface DecomposeCompletion {
  text: string;
  usage: Usage;
}

/** 过程条目类别（`#/decompose` 时间线按它分组；文案由服务端渲染成单行中文，客户端直接展示） */
export const DECOMPOSE_LOG_KINDS = [
  "session_pruned",
  "snapshot",
  "batch_start",
  "attempt_failed",
  "batch_done",
  "merge_done",
  "report_done",
] as const;

export type DecomposeLogKind = (typeof DECOMPOSE_LOG_KINDS)[number];

/** 过程条目（custom entry 的 data；不参与 LLM 上下文，只服务拆解记录时间线） */
export interface DecomposeLogEntry {
  kind: DecomposeLogKind;
  /** 单行中文文案（服务端渲染） */
  text: string;
  /** 落盘时刻（ISO 8601） */
  at: string;
  /** 所属批序号（批级条目的定位锚；归并 / 报告条目不带） */
  batchSeq?: number;
}

/** 记一条过程条目的入参（`at` 由会话盖章，调用方不生成时间） */
export type DecomposeLogInput = Omit<DecomposeLogEntry, "at">;

/** custom entry 的 `customType`（读侧按它过滤出过程条目） */
export const DECOMPOSE_LOG_CUSTOM_TYPE = "decompose";

/** 一枚拆解会话（= 一个 job 的过程记录）：S2 / S3 / S4 的所有调用与过程条目都写进它 */
export interface DecomposeSession {
  /** pi 会话 id（= `decompose-<清洗后 jobId>`） */
  sessionId: string;
  /** 单轮补全：本轮 system + 本轮素材 → 末条 assistant 文本（每轮独立成根，上下文只含本轮） */
  complete(request: ModelRequest): Promise<DecomposeCompletion>;
  /** 记一条过程条目（不参与 LLM 上下文） */
  log(entry: DecomposeLogInput): void;
}

/** 开会话的入参（`projectRoot` 必填：会话 cwd 与 `sessions/` 落点都由它定，避免落到进程 cwd） */
export interface OpenDecomposeSessionInput {
  /** 项目根（pi 的会话身份上下文；`sessions/` 建在它下面） */
  projectRoot: string;
  /** job id（`decomposeSessionId` 清洗后拼进会话 id） */
  jobId: string;
  /** 书名（会话名 = 「《书名》拆解」）；缺省回退项目目录名 */
  bookName?: string;
}

/**
 * 拆解会话 id（**唯一组装点**）：`decompose-` 前缀 + 清洗后的 job id。
 * 清洗口径 = pi `SessionManager` 的 id 约束（非空、只允许 `[A-Za-z0-9._-]`、首尾必须是字母数字）：
 * 我们的 id 是 `job-<nanoid>`，而 nanoid 字母表含 `-`/`_` ⇒ **可能以 `-` 结尾**（实测踩到过），
 * 直接当会话 id 会抛错。清不出合法 id（一个字母数字都没有）时抛错——静默交给 pi 自生成会得到一枚
 * **不带前缀**的会话文件，chat 侧守卫与保留上限都认不出它。
 */
export function decomposeSessionId(jobId: string): string {
  const cleaned = jobId
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9]+$/, "");
  if (cleaned === "") throw new Error(`job id 无法适配 pi 的会话 id 约束: ${jobId}`);
  return `${DECOMPOSE_SESSION_ID_PREFIX}${cleaned}`;
}

/** pi 资源加载选项（cwd / agentDir / settingsManager 由 SDK 填充，此处只给行为开关） */
type ResourceLoaderOptions = NonNullable<
  Parameters<typeof createAgentSessionServices>[0]["resourceLoaderOptions"]
>;

/**
 * 拆解用的资源加载选项：四项全关（扩展 / 技能 / 提示词模板 / 上下文文件=AGENTS.md），
 * system prompt = 本次调用的 system（拆解提示词自包含，不掺 pi 内核提示词）。
 */
function decomposeResourceOptions(systemPrompt: string): ResourceLoaderOptions {
  return {
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    systemPrompt,
  };
}

/**
 * 打开一个 job 的拆解会话（缺模型 / 缺凭据 → 抛错，调用方决定落失败还是重试）。
 * 既有会话文件（resume / 单批重跑）→ 打开续写，**不新建第二枚**。
 */
export async function openDecomposeSession(
  deps: DecomposeLlmDeps,
  input: OpenDecomposeSessionInput,
): Promise<DecomposeSession> {
  const runtime = deps.runtime ?? (await getModelRuntime());
  const settings = deps.settings ?? getSettingsManager();
  const selection = await resolveActiveSelection(runtime, settings);
  if (selection === null) throw new Error("未配置可用模型：请先在设置页选择模型");
  if (!runtime.hasConfiguredAuth(selection.provider)) {
    throw new Error(`未配置 ${selection.provider} 的凭据：请在设置页填写 API key`);
  }
  const model = runtime.getModel(selection.provider, selection.modelId);
  if (model === undefined) throw new Error(`模型不可用: ${selection.provider}/${selection.modelId}`);

  // 本项目设置的内存副本：拆解要关自动压缩，而 `setAutoCompactionEnabled` 写的是 settingsManager（会落盘）
  // ⇒ 用副本，用户全局设置与 chat 会话的自动压缩都不受影响（重试/超时/思考档位照旧来自用户设置）
  const sessionSettings = SettingsManager.inMemory(settings.getGlobalSettings());
  const sessionId = decomposeSessionId(input.jobId);
  const sessionsDir = projectSessionsDir(input.projectRoot);
  const existing = existingSessionFile(sessionsDir, sessionId);
  const sessionManager =
    existing === null
      ? SessionManager.create(input.projectRoot, sessionsDir, { id: sessionId })
      : SessionManager.open(existing, sessionsDir);
  if (existing === null) {
    // 会话名（列表里显示正经名字，而不是被截断的原文）；续写既有文件不重复追加
    sessionManager.appendSessionInfo(`《${input.bookName ?? basename(input.projectRoot)}》拆解`);
  }

  return {
    sessionId,
    async complete(request) {
      // 建会话前先清 leaf：否则 pi 会把「leaf 路径上的历史」装回 agent，本轮请求体会带上整段旧原文
      sessionManager.resetLeaf();
      const services = await createAgentSessionServices({
        cwd: input.projectRoot,
        agentDir: resolveAgentDir(),
        settingsManager: sessionSettings,
        modelRuntime: runtime,
        resourceLoaderOptions: decomposeResourceOptions(request.system),
      });
      const { session } = await createAgentSessionFromServices({
        services,
        sessionManager,
        model,
        noTools: "all",
      });
      session.setAutoCompactionEnabled(false);
      // 建会话写了 model_change / thinking_level_change 并推进 leaf ⇒ 再清一次，本轮用户消息才是新根
      sessionManager.resetLeaf();
      try {
        await session.prompt(request.user);
        const assistant = lastAssistantMessage(session.messages);
        if (assistant === undefined) throw new Error("模型没有返回 assistant 消息");
        if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
          throw new Error(assistant.errorMessage ?? `模型调用失败（${assistant.stopReason}）`);
        }
        return { text: contentText(assistant.content), usage: assistant.usage };
      } finally {
        session.dispose();
      }
    },
    log(entry) {
      sessionManager.appendCustomEntry(DECOMPOSE_LOG_CUSTOM_TYPE, { ...entry, at: new Date().toISOString() });
    },
  };
}

/**
 * 既有拆解会话文件（同 id）：pi 的落盘文件名是 `<时间戳>_<会话 id>.jsonl`（`SessionManager.newSession`），
 * 按 id 后缀命中；命中多个（不该发生）取文件名最大的一个。pi 是 exact pin（0.85.1），命名不由本模块自造。
 */
function existingSessionFile(sessionsDir: string, sessionId: string): string | null {
  if (!existsSync(sessionsDir)) return null;
  const suffix = `_${sessionId}.jsonl`;
  const files = readdirSync(sessionsDir).filter((name) => name.endsWith(suffix)).sort();
  const last = files[files.length - 1];
  return last === undefined ? null : join(sessionsDir, last);
}

/** 末条 assistant 消息（pi 的会话消息里工具结果/用户消息可能排在后面，故从尾部找 assistant） */
function lastAssistantMessage(messages: readonly { role: string }[]): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message !== undefined && message.role === "assistant") return message as AssistantMessage;
  }
  return undefined;
}

/** 取模型输出里的 JSON 对象：容忍 ```json 围栏与前后解释文字（模型常见形态）；坏 JSON 抛错 → 调用方定夺 */
export function parseModelJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型输出里找不到 JSON 对象");
  return parseJsonWithRepair<unknown>(body.slice(start, end + 1));
}
