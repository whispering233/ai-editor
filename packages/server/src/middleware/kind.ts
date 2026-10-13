// 工作区类型守卫（kind）：小说语义端点 / 字段与练习端点互斥（2026-10）
//
// 契约：`docs/design/architecture.md`「工作区类型（kind）与能力收窄」（路由守卫那一行）、
// `docs/api/error-code.md` 的 `KIND_MISMATCH`（400）。**唯一实现**——三处消费：
// 1. 整组中间件 `requireKind(kind)`：挂载点**只在 `index.ts`**（每组一行
//    `app.use("/api/v1/<组>/*", requireKind(...))`，且**必须注册在该组 `app.route` 之前**——
//    Hono 的中间件与 handler 按注册序组合，registration 顺序错了守卫不生效）。
//    小说语义组 = entity / outline / manuscript / relation / delta / trash / names / proposal；
//    通用组（project / chat / backup / cloud / settings）不挂。
// 2. handler 内 `assertWorkspaceKind(project, kind)`：端点级粒度不够时用——目前两处：
//    `PUT /project/config`（`current_position` / `deduction_nodes` 是小说语义**字段**，
//    端点本身通用）与 `GET /project/export-novel`（同组内还有对两种 kind 都放行的
//    `GET /project/export`，无法整组挂）。
// 3. 反向守卫（练习端点组）随练习路由一起挂（`requireKind("practice")`）。
//
// 无当前工作区时**放行**：`NO_PROJECT_OPEN` 409 由各 handler 的 `requireCurrentProject`
// 给出——守卫不改写既有错误语义。
import type { MiddlewareHandler } from "hono";
import type { WorkspaceKind } from "@whispering233/ai-editor-shared";
import { resolveWorkspaceKind } from "@whispering233/ai-editor-shared";
import { HttpError } from "./error.js";
import { getCurrentProject, type ProjectContext } from "./project.js";

/**
 * `KIND_MISMATCH` 的固定文案（key = **被要求**的工作区类型）；中间件与 handler 断言共用的单一定义，
 * 与 `docs/api/error-code.md` 逐字一致（文案描述的是「要求」，不随实际 kind 变化）。
 */
export const KIND_MISMATCH_MESSAGES: Record<WorkspaceKind, string> = {
  novel: "该端点仅适用于小说工作区",
  practice: "该端点仅适用于练习工作区",
};

/**
 * 断言当前项目的工作区类型；不匹配则抛 400 `KIND_MISMATCH`（handler 内使用，经 errorHandler 转响应）。
 * kind 经 shared `resolveWorkspaceKind` 兜底（旧 project.json 缺该键 → novel）。
 */
export function assertWorkspaceKind(project: ProjectContext, required: WorkspaceKind): void {
  if (resolveWorkspaceKind(project.config.kind) === required) return;
  throw new HttpError(400, "KIND_MISMATCH", KIND_MISMATCH_MESSAGES[required]);
}

/**
 * 路由组守卫中间件：当前工作区 kind ≠ `required` → 400 `KIND_MISMATCH`。
 * 无当前工作区（待命态）→ 放行（`docs/api/error-code.md`：`NO_PROJECT_OPEN` 409 语义不变）。
 */
export function requireKind(required: WorkspaceKind): MiddlewareHandler {
  return async (_c, next) => {
    const project = getCurrentProject();
    if (project !== null) {
      assertWorkspaceKind(project, required);
    }
    await next();
  };
}
