// 纯工具函数聚合出口（新增子模块在此补 `export *`；不在注释里维护文件清单——`ls` 才是事实）
export * from "./id.js";
export * from "./format.js";
export * from "./mapping.js";
export * from "./backup.js";
export * from "./ability-panel.js"; // 能力面板（人物）结构纯函数
export * from "./relation-type.js"; // 关系类型自定义值语法校验（单一来源，卡片 8.2）
export * from "./block-document.js"; // 块文档浅校验 + 轻量 md 投影（卡片 12.3）
export * from "./deduction.js"; // 推演节点标记纯函数（唯一编号口径 + 标记派生）
export * from "./outline-numbering.js"; // 大纲展示编号派生（卷号 + 章号；消费 orderVisibleChapters）
export * from "./file-name.js"; // 文件名 sanitize（唯一实现；正文导入导出 + 小说文档导出）
export * from "./novel-export.js"; // 小说文档导出（zip 条目 / 章正文组装 / 下载文件名）
