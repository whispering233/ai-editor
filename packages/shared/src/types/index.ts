// 共享类型聚合出口（类型-only barrel）
// 文件划分见 doc/design/architecture.md（types/：entity / outline / project / tool / chat / api）
// **硬约束（2026-08 修订）**：全部 export type * ——api.ts 含运行时 Zod schema（xxxSchema 常量），
// 若从 barrel 运行时导出会把 zod 校验函数拉进 client 浏览器包（50KB 级）。
// 服务端需要运行时 schema 时从 @ai-editor/shared/schemas 子路径导入（见 package.json exports）
export type * from "./entity.js";
export type * from "./outline.js";
export type * from "./project.js";
export type * from "./chat.js";
export type * from "./api.js";
