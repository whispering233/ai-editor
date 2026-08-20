// 纯工具函数聚合出口
// 文件划分见 doc/design/architecture.md（utils/：id.ts / validate.ts / format.ts / backup.ts；validate.ts 随 Zod 于 T1.4 引入）
export * from "./id.js";
export * from "./format.js";
export * from "./mapping.js";
export * from "./backup.js";
export * from "./reference-file.js"; // 决策 43：参考资料文件 frontmatter/文件名纯函数
