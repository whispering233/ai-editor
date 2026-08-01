// @ai-editor/tools 入口（空壳）
export const TOOLS_PKG_NAME = "@ai-editor/tools";
export const TOOLS_PKG_VERSION = "0.1.0";
// workspace 依赖冒烟（T0.3）：@ai-editor/db 依赖声明在 package.json 中，
// 依赖解析由 tsc/workspace 链接在编译期验证（oracle 审核：去掉恒真三元）
export const DB_DEP = "@ai-editor/db";
