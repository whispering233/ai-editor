// 工作区类型（project.json 的 `kind`）常量与兜底（2026-10）
//
// 语义与不变式见 `docs/design/architecture.md`「工作区类型（kind）与能力收窄」，
// 字段契约见 `docs/db/schema.md`「project.json」与 `docs/api/10-api-project.md`。
// **不 import zod**：纯常量 + 纯函数，客户端可安全经 shared 根入口打包。

/** 工作区类型：决定目录映射、AI 工具集与内核提示词、路由守卫与导航 */
export type WorkspaceKind = "novel" | "practice";

/** 缺省工作区类型（`kind` 缺失 / 未知值的读侧兜底） */
export const DEFAULT_WORKSPACE_KIND: WorkspaceKind = "novel";

/** 工作区类型 → 创作根下的顶层目录名（**唯一定义处**：服务端拼路径、客户端导航一律取这里） */
export const WORKSPACE_DIRS: Record<WorkspaceKind, string> = {
  novel: "books",
  practice: "practice",
};

/** 全部工作区类型（顺序 = 目录表键序；zod 枚举与 list 扫描同源） */
export const WORKSPACE_KINDS = Object.keys(WORKSPACE_DIRS) as WorkspaceKind[];

/**
 * 工作区类型的**中文名**（用户可见文案的唯一定义处：服务端 `KIND_MISMATCH` 文案、客户端分区标题
 * 都取这里）。程序设计侧词（`novel` / `practice`）**不得进用户侧文案**——它们是目录映射与
 * 工具集收窄的实现词，用户看到的是「小说」/「文风练习」。
 */
export const WORKSPACE_KIND_LABELS: Record<WorkspaceKind, string> = {
  novel: "小说",
  practice: "文风练习",
};

/**
 * 工作区类型**唯一兜底函数**：缺 `kind` / 非字符串 / 未知值 → 缺省 `novel`。
 *
 * 消费方（API 输出、目录映射、路由守卫）一律经它归一，禁止各处自写 `?? "novel"`；
 * 归一结果只是**读侧口径**——写侧只写显式值（存量 project.json 不因读取被补上 `kind` 键）。
 */
export function resolveWorkspaceKind(value: unknown): WorkspaceKind {
  return WORKSPACE_KINDS.find((kind) => kind === value) ?? DEFAULT_WORKSPACE_KIND;
}
