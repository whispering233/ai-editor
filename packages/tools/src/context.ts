// 工具执行上下文（S6.3 ToolContext 设计）
// 由上层（agent/server，S7）注入：db 访问 + outline.json 读取 + projectId。
// 工具实现只依赖本接口工作，不持有任何全局状态——同一实例可服务多次工具调用；
// projectId = 当前打开项目的 id（提案绑定 project_id，S6.6 起提案工具已在用）。
//
// 注入方职责（S7.4 executor 组装）：
// - db：当前项目的 data.db 连接（better-sqlite3 同步连接，查询层 API 直接使用）
// - outlineDir：项目根目录（outline.json 所在目录）
// - projectId：当前打开项目的 id（会话归属项目；提案绑定 project_id）

import type { Db } from "@whispering233/ai-editor-db";
import type { FetchPagePort } from "./schemas/fetch.js";
import type { WebSearchPort } from "./schemas/web-search.js";

export interface ToolContext {
 /** 当前项目的 data.db 连接（@whispering233/ai-editor-db openDatabase 返回值） */
  db: Db;
 /** 项目根目录（outline.json 所在目录；关系/Delta 端点软删校验读树用） */
  outlineDir: string;
  /** 当前项目 id（proj- 前缀；提案归属绑定，S6.6 使用） */
  projectId: string;
  /**
   * 联网检索通道（`web_search` 用；**可选**）：由 server 注入（凭据与 HTTP 都在 server 侧，
   * tools 不自己做网络与凭据）。未注入时 `web_search` 抛可读错误——不静默返回空结果。
   */
  webSearch?: WebSearchPort;
  /**
   * 网页抓取通道（`fetch_content` 用；**可选**）：由 server 注入（`packages/server/src/fetch.ts`）。
   * 未注入时 `fetch_content` 抛可读错误——不静默返回空结果。
   */
  fetchPage?: FetchPagePort;
}
