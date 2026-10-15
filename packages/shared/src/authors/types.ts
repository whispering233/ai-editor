// 预置作家素材的类型（作家介绍 / 作品清单 / 风格说明）
//
// 素材放 shared 常量的理由见 `docs/design/60-practice.md` §3：三处（客户端页面、
// 作品下拉、AI 工具）读同一份，且不引入「文件资产」要同时改的 npm 发布 / 构建复制 /
// 桌面版 `pnpm deploy` 三处。**作品清单是封闭集合**（不可增删改，兜底 = 「其他」）。
import type { AUTHOR_CATALOG } from "./catalog.js";

/** 一部预置作品：`id` = 稳定 slug（英文小写连字符，全局唯一），`name` = 中文显示名 */
export interface PracticeWork {
  id: string;
  name: string;
  intro: string;
}

/** 一位预置作家：介绍与风格说明是给人读的 markdown */
export interface AuthorEntry {
  id: string;
  name: string;
  intro: string;
  works: readonly PracticeWork[];
  styleNotes: string;
}

/** 预置作家 id（= 清单键；`工作区 project.json` 的 `author_id` / 素材包主键取它） */
export type AuthorId = keyof typeof AUTHOR_CATALOG;