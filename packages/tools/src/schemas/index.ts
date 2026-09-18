// 工具参数 schema 聚合出口（TypeBox）
//
// 契约见 docs/api/tool-calling.md「工具定义（TypeBox）」：schema 定义在 tools 包
// （不放 shared——client 不打包工具 schema），`Type`/`Static` 经 @earendil-works/pi-ai 重导出。

export * from "./entity.js";
export * from "./relation.js";
export * from "./outline.js";
export * from "./delta.js";
export * from "./reference.js";
export * from "./manuscript.js";
export * from "./analysis.js";
export * from "./proposal.js";
