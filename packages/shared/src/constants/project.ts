// 项目出处常量（跨端共用：服务端 list 的缺省归一 + client 书架分组的取值域）
//
// 口径出处：docs/db/schema.md「project.json — 项目配置契约」的 `origin` 行
// （可选字段、读侧缺省 `book`、只增不改）。

/** 项目出处：book = 手建 / 导入的普通书籍（缺省，project.json 无该字段即归此类）；decompose = 由「拆解小说」建档 */
export const PROJECT_ORIGINS = ["book", "decompose"] as const;

/** 项目出处（project.json `origin` 的取值域；书架按它分「小说项目 / 小说拆解」两组） */
export type ProjectOrigin = (typeof PROJECT_ORIGINS)[number];
