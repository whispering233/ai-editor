# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

## 卡：web_search 结果条数与摘要异常上限（P1，上下文/性能）

**背景**：实测一轮检索返回 10 条，单条 `summary` 约 1,350–1,550 字符，合计约 14,500 字符；后续请求 input 从 7.5K 涨到 20K+。单条降到 1,200 只能省约 17%，却会砍掉尾部结论段；真正的膨胀源是条数。故改为「默认 5 条、上限 10 条 + 2,000 字符异常保护」：正常摘要完整保留，默认上下文约降至 7,500 字符；极长上游 `content` 仍被兜住。

### 范围
- `packages/tools/src/schemas/web-search.ts`：`DEFAULT_SEARCH_RESULT_COUNT` 改为 5，`MAX_SEARCH_RESULT_COUNT` 改为 10；新增 `MAX_SEARCH_SUMMARY_CHARS = 2000`（异常保护，含截断省略号）。工具描述与 schema 均从常量插值，文档引用常量名，不复述数字。
- `packages/tools/src/query/web-search.ts`：`projectHit` 对 `summary`（含 `snippet` 回落、`content` 回落）仅在超过异常上限时截断；截断标记 `truncated: true`（`WebSearchHit` 增可选字段），正常摘要不带该字段。title/url/date/authority 与顺序不动。
- `packages/tools/src/index.ts`：`web_search` 描述改为「默认 5 条 / 上限 10 条」，补「单条摘要仅做异常上限」；说明全文走 `fetch_content`。
- 同步 `docs/api/tool-calling.md`「外部检索（自动）」：`count` 缺省/上限、`summary` 异常上限与 `truncated` 标记。

### 验收
- `packages/tools/src/schemas/schemas.test.ts`：`count` 10 合法、11 非法；现有 query 长度断言不回归。
- `packages/tools/src/query/web-search.test.ts`：缺省 `count` = 5；显式 10 原样透传；超长 `summary` / `snippet` / `content` 才截断且 `truncated: true`；1,500 字符正常摘要原样无标记；结果顺序与 title/url/date/authority 不变；空字段仍省略。
- `packages/tools/src/index.test.ts`：工具描述包含默认 5 / 上限 10 / 摘要异常上限的常量值；现有 query/count 断言不回归。
- 全量 `pnpm -r build`、`pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-tools test` 通过；不跑真实 DeepSeek（mock port）。

### 不做
- 不改 `fetch_content`；不改 `TOOL_RESULT_MAX_TOKENS`；不加缓存/分页/多供应商/总量二次截断；不改 UI 来源卡；不持久化检索结果。

**硬完成判据**：`git log` 含本卡新 commit、`git status` 干净；汇报必附 commit hash 与上述命令输出；无 commit 不许报 PASS。

> 新任务先在此登记；未排期遗留项进 `backlog.md`。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
