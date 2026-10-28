# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### 卡 1：单条工具结果上限 20000 + `fetch_content` 抓取工具（后端）

**目标**：AI 在摘要不够时能打开原文；单条工具结果预算从 8000 提到 20000 tokens。契约：`docs/api/tool-calling.md`「外部检索（自动）」的 `fetch_content` 段。

改动范围：
1. `packages/agent/src/runtime/tool-result.ts`：`TOOL_RESULT_MAX_TOKENS = 20000`（注释说明理由 = 外部网页正文，不是目标值）。
2. 过时数值注释（**不得复述数字**，只引用常量名）：`packages/tools/src/query/manuscript.ts:30-37`、`packages/tools/src/query/manuscript.test.ts:127-128` 用例名、`packages/server/src/routes/chat.test.ts:1736` 注释；`MAX_TEXT_PAGE_CHARS` 不动。
3. `packages/tools/src/schemas/fetch.ts`（新）：`fetchContentArgsSchema = { url: string(1..MAX_FETCH_URL_CHARS) }`（`additionalProperties: false`）；常量 `MAX_FETCH_URL_CHARS`；类型 `FetchedPage = { title: string; url: string; content: string }`；从 `schemas/index.ts` 导出。
4. `packages/tools/src/query/fetch-content.ts`（新）：`runFetchContent(ctx, args, signal)`——未注入 port 抛可读错误；URL 校验（`new URL` 可解析、协议 http/https、无账号密码、长度上限）；port 返回后原样返回 `{ title, url, content }`（正文交给运行时截断）。
5. `packages/tools/src/context.ts`：`ToolContext` 加可选 `fetchPage?: FetchPagePort`（`fetchPage(input, signal): Promise<FetchedPage>`）。
6. `packages/tools/src/index.ts`：注册 `fetch_content`（`AUTO`、`scope: "common"`），description 用常量插值，写明「先 web_search 看摘要，不够再抓取」「长页可能被截断」「只读、无缓存」；文件头计数 45 → 46。
7. `packages/server/src/fetch.ts`（新）：`createDeepSeekFetch()`——与 `web-search.ts` 同款（`getAuth("deepseek")`、`fetch`、超时 `FETCH_TIMEOUT_MS = 30_000`、`AbortSignal.any`）；`POST https://api.deepseek.com/v1/tools/fetch`，body `{ url }`；错误映射 401/402/403/404/408/413/429/5xx 与网络错误可读文案，不重试；响应投影 `{ title, url, content }`。
8. `packages/server/src/chat-runtime.ts`：`toolContext` 注入 `fetchPage: createDeepSeekFetch()`。
9. shared：`COMMON_TOOLS` 加 `fetch_content`（`TOOL_NAMES` 自动并入）；同步计数断言（shared / agent）。
10. 测试：tools（fake port：URL 校验各分支、未注入报错、原样投影）；server（fake fetch + fake 凭据：请求形状、错误码文案、超时、调用方中止、缺凭据、零真实网络）；schema 边界（超长 URL / 非法 JSON 键拒绝）；description 数字集断言。

**验收**：`pnpm -r build && pnpm typecheck && pnpm lint` 绿；`pnpm --filter @whispering233/ai-editor-tools test` / `-server` / `-agent` / `-shared` 绿；截断用例（`chat.test.ts` 大 outline）仍截断（实跑，不推算）。

---

### 卡 2：聊天来源卡片（`chat-source-cards`）

**目标**：`web_search` / `fetch_content` 工具行下方渲染可点来源卡片；历史重载后仍在。契约：`docs/ui/DESIGN.md` 的 `chat-source-cards` 段。

改动范围：
1. `packages/client/src/components/chat/source-cards.tsx`（新）：`SourceCards({ toolName, result })`——`result` 为工具结果文本，`JSON.parse` 后按工具名分派：搜索 → 命中数组；抓取 → `{ title, url, content }`。解析失败 / 形状不符 / 空数组 → 返回 `null`（回退普通工具行）。
2. 字段：`title`（两行截断）、`summary` 一行（搜索）、域名 = `new URL(url).hostname` 去 `www.`、日期 `YYYY-MM-DD`（有则显示）；抓取卡显示正文字数（千分位）。整卡 `<a href target="_blank" rel="noopener noreferrer">`。
3. `ChatPanel.tsx` 的 `ToolCallRow`：折叠头之下渲染 `<SourceCards toolName={toolName} result={result} />`；原始 JSON 展开态不变。
4. 样式只走 Tailwind + 现有 token（`text-muted-foreground` / `caption` 级字号），禁内联色值、禁 `!important`、禁 ad-hoc 字号（过 `design-discipline.test.ts`）。
5. 测试：`source-cards.test.tsx`（SSR：搜索多卡顺序 / 空字段省略 / 抓取卡字数与域名 / 非法 JSON 与形状不符返回 null）；`ChatPanel` 渲染走查若断言工具行结构需同步。

**不做**：favicon、`site_name`、权威性分数、行内引用编号、来源抽屉、正文阅读面板。

**验收**：`pnpm --filter @whispering233/ai-editor-client test` 绿；`pnpm typecheck` / `lint` 绿；浏览器实测两种卡片渲染、点击外链、重载后仍在、流式期出现时机。

---


- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **测试环境前提**（端口占用会打挂一条环境性用例）：见 `build.md`「本地开发」最后一条。
