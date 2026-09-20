// LLM 调用纪律守卫：把「凡调 LLM 一律走 pi 的 Agent 路径」变成可执行的源码断言
// （契约 = docs/design/60-decompose.md §2.1；实现单点 = decompose/llm.ts）。
//
// 为什么需要它：直连 provider / 自建鉴权头的代码能跑通 typecheck 与单测（甚至看起来更简单），
// 但会丢掉 pi **Agent 包装层**的行为（provider 特化头、重试/超时、思考档位）——只在真实调用时
// 才炸（实测：opencode 系缺 `x-opencode-session` 直接 400 MissingSessionID），属「改完没人拦得住」
// 的类别；自己补头/补重试等于无限期跟随上游。
//
// 豁免表（逐字列出；新增第三项必须由人审——见任务卡条款）：
// - decompose/llm.ts  ：拆解管线唯一合法 LLM 调用点，就是这条 pi Agent 路径本身
// - cloud/webdav.ts   ：`Authorization: authHeader` 是 WebDAV Basic 头，非 LLM 出站（云端存档）
//
// 有意**不**禁止的合法出站机制：`fetch(` 与 undici `new Agent(`（http-dispatcher.ts / 云端 WebDAV）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;

/** LLM 调用唯一合法实现点 */
const LLM_IMPL = "decompose/llm.ts";
/** WebDAV Basic 认证（非 LLM 出站） */
const WEBDAV = "cloud/webdav.ts";

/** 命中即失败的提示语：出现在每条违规记录里，让人一眼知道正确出口 */
const HINT =
  "提示：LLM 调用只允许经 packages/server/src/decompose/llm.ts 的 pi Agent 路径（不得直连 provider / 自建鉴权头）";

interface Rule {
  id: string;
  /** 返回该行是否违规（逐行扫描） */
  violationsIn: (line: string) => boolean;
  /** 该文件是否豁免此规则（键 = 相对 src 的 posix 路径） */
  allow?: (file: string) => boolean;
}

const RULES: Rule[] = [
  {
    // pi 的 `ModelRuntime.completeSimple`：最直接的自建调用方式，绕过 Agent 包装层
    id: "complete-simple",
    violationsIn: (line) => /\bcompleteSimple\b/.test(line),
    allow: (file) => file === LLM_IMPL,
  },
  {
    // provider 主机名字面量：自建请求的招牌特征（正常代码只需要 provider id，不需要 URL）
    id: "provider-host-literal",
    violationsIn: (line) =>
      /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.deepseek\.com|openrouter\.ai/i.test(
        line,
      ),
    allow: (file) => file === LLM_IMPL,
  },
  {
    // 自建鉴权头：provider 凭据只由 pi 从 `~/.pi/agent/auth.json` 取并注入
    id: "self-built-auth-header",
    violationsIn: (line) =>
      /\bAuthorization\b|\bx-api-key\b|\bx-opencode-session\b/i.test(line),
    allow: (file) => file === LLM_IMPL || file === WEBDAV,
  },
];

/** 采集 src 下所有非测试源码文件（相对 src 的 posix 风格路径） */
function sourceFiles(dir: string = SRC): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
    out.push({ path: relative(SRC, full).split(sep).join("/"), text: readFileSync(full, "utf8") });
  }
  return out;
}

const FILES = sourceFiles();

/** 注释行豁免：规则扫的是「真正生效的代码」。注释里写清「为什么禁直连 completeSimple」是文档职责
 * （60-decompose.md §2.1 同款内容），不能因此把守卫变成「禁写注释里的关键词」。 */
function isCommentLine(text: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(text);
}

describe("LLM 调用纪律守卫（源码扫描）", () => {
  for (const rule of RULES) {
    it(`${rule.id}：全仓无违规`, () => {
      const hits = FILES.filter((file) => !rule.allow?.(file.path)).flatMap((file) =>
        file.text
          .split("\n")
          .map((line, index) => ({ line: index + 1, text: line }))
          .filter((entry) => !isCommentLine(entry.text) && rule.violationsIn(entry.text))
          .map((entry) => `${file.path}:${entry.line}  ${entry.text.trim().slice(0, 120)}  ——${HINT}`),
      );
      expect(hits).toEqual([]);
    });
  }
});

describe("守卫规则自检（规则必须能识别违规样例，否则规则形同虚设）", () => {
  it("逐条命中违规样例", () => {
    const samples: Record<string, string> = {
      "complete-simple": `const msg = await runtime.completeSimple(model, { messages });`,
      "provider-host-literal": `await fetch("https://api.anthropic.com/v1/messages", init);`,
      "self-built-auth-header": `headers: { "x-api-key": apiKey },`,
    };
    for (const rule of RULES) expect(rule.violationsIn(samples[rule.id]), rule.id).toBe(true);
  });

  it("合法写法不误报（fetch / undici Agent / 注释由扫描层放过）", () => {
    const legal = [
      `return await fetch(target, { method, headers });`,
      `const dispatcher = new Agent({ connect: { timeout } });`,
      `const headers = { "content-type": "application/json" };`,
    ];
    for (const rule of RULES) {
      for (const line of legal) expect(rule.violationsIn(line), `${rule.id}: ${line}`).toBe(false);
    }
    // 豁免表逐字两项：第三项须人审
    const exempt = [
      ...new Set(FILES.filter((f) => RULES.some((r) => r.allow?.(f.path))).map((f) => f.path)),
    ].sort();
    expect(exempt).toEqual(["cloud/webdav.ts", "decompose/llm.ts"]);
  });
});
