# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### 卡 1：AI 联网搜索工具 `web_search`（DeepSeek）

**目标**：AI 可在对话中检索外部网页，返回可引用的摘要列表。单供应商（DeepSeek），只读，无 UI。

**契约**：`docs/api/tool-calling.md`「外部检索（自动）」；`docs/design/config.md` 读写边界新增条目。

改动范围：
1. `packages/tools/src/schemas/web-search.ts`（新）：`webSearchArgsSchema` = `{ query: string(1..MAX_SEARCH_QUERY_CHARS), count?: integer(1..MAX_SEARCH_RESULT_COUNT) }`，`additionalProperties: false`；常量 `MAX_SEARCH_QUERY_CHARS` / `DEFAULT_SEARCH_RESULT_COUNT` / `MAX_SEARCH_RESULT_COUNT` 与 `WebSearchHit` 类型都在此定义并从 `schemas/index.ts` 导出。
2. `packages/tools/src/context.ts`：`ToolContext` 加**可选** `webSearch?: WebSearchPort`（`search(input, signal): Promise<WebSearchHit[]>`）；`WebSearchPort` 定义在 `schemas/web-search.ts`，注释写明「由 server 注入，tools 不自己做网络与凭据」。
3. `packages/tools/src/query/web-search.ts`（新）：`runWebSearch(ctx, args, signal)` —— 未注入 port 时抛可读错误；校验 `query.trim()` 非空；调用 port 后按「空字段省略、summary 为空回落 snippet」投影，**不改顺序**。
4. `packages/tools/src/index.ts`：注册 `web_search`（`permission: AUTO`、**`scope: "common"`**、`run: runWebSearch`）；description 用常量插值（说明 query 语法 `site:`/`after:`/`lang:`、`count` 缺省与上限、`need_content` 不返回正文、会发往 DeepSeek、未配 key 时报错）；更新文件头注释的工具计数说明（37 novel + 7 practice + 1 common）。
5. `packages/server/src/web-search.ts`（新）：`createDeepSeekWebSearch()` —— `getModelRuntime().getAuth("deepseek")` 取 key（`auth.type !== "api_key"` 或缺失 → 抛「未配置 DeepSeek API Key：设置 → 模型 → DeepSeek」）；`fetch("https://api.deepseek.com/v1/tools/search", { method:"POST", headers:{Authorization,Content-Type}, body: { query, count, need_content:false }, signal })`；超时用 `AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)])`（若类型环境不支持则手工组合）；按 `docs/api/tool-calling.md` 映射 401/402/429/5xx/网络错误的可读文案；结果投影为 `WebSearchHit[]`。
6. `packages/server/src/chat-runtime.ts:41`：`toolContext` 增 `webSearch: createDeepSeekWebSearch()`。
7. 测试：`packages/tools/src/query/web-search.test.ts`（fake port：投影/空字段省略/未注入报错/空 query 报错）；`packages/server/src/web-search.test.ts`（fake `fetch` + fake runtime：请求体与 Authorization、401/402/429/500/网络错误文案、超时中止、缺凭据文案、`count` 缺省）；schema 测试（超长 query / 越界 count 被拒）；描述与常量同值断言。

**不做**：Fetch 工具、结果缓存/`responseId` 分页、多供应商回退、来源卡片 UI、搜索费用进会话账目、设置页开关。

**验收**：`pnpm --filter @whispering233/ai-editor-tools test`、`pnpm --filter @whispering233/ai-editor-server test` 绿；`pnpm -r build && pnpm typecheck && pnpm lint` 绿；无真实网络请求（全部 fake）。

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **测试环境前提**（端口占用会打挂一条环境性用例）：见 `build.md`「本地开发」最后一条。
