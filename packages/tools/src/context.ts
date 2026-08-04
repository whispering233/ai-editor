// 工具执行上下文（S6.3 ToolContext 设计）
// 由上层（agent/server，S7）注入：db 访问 + outline.json 读取 + projectId。
// 工具实现只依赖本接口工作，不持有任何全局状态——同一实例可服务多次工具调用；
// projectId 本卡查询工具暂未使用（S6.6 提案工具需要提案归属项目），先定义供后续扩展。
//
// 注入方职责（S7.4 executor 组装）：
// - db：当前项目的 data.db 连接（better-sqlite3 同步连接，查询层 API 直接使用）
// - outlineDir：项目根目录（outline.json 所在目录，决策 8）
// - projectId：当前打开项目的 id（决策 22 会话归属项目；提案绑定 project_id）

import type { Db } from "@whispering233/ai-editor-db";

export interface ToolContext {
  /** 当前项目的 data.db 连接（@whispering233/ai-editor-db openDatabase 返回值） */
  db: Db;
  /** 项目根目录（outline.json 所在目录，决策 8；关系/Delta 端点软删校验读树用） */
  outlineDir: string;
  /** 当前项目 id（proj- 前缀；提案归属绑定，S6.6 使用） */
  projectId: string;
}
