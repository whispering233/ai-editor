// 纯工具函数聚合出口
// 文件划分见 （utils/：id.ts / validate.ts / format.ts / backup.ts；validate.ts 随 Zod 于 T1.4 引入）
export * from "./id.js";
export * from "./format.js";
export * from "./mapping.js";
export * from "./backup.js";
export * from "./reference-file.js"; // 参考资料文件 frontmatter/文件名纯函数
export * from "./ability-panel.js"; // 能力面板（人物）结构纯函数
export * from "./relation-type.js"; // 关系类型自定义值语法校验（单一来源，卡片 8.2）
export * from "./block-document.js"; // 块文档浅校验 + 轻量 md 投影（卡片 12.3）
