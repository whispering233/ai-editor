// @ai-editor/client 入口（空壳）
// 架构约束：client 只依赖 @ai-editor/shared（仅类型 + 常量，编译期消失）
import { SHARED_PKG_NAME } from "@ai-editor/shared";
import type { Entity, OutlineTree, ProjectConfig } from "@ai-editor/shared";

export const CLIENT_PKG_NAME = "@ai-editor/client";
export const CLIENT_PKG_VERSION = "0.1.0";
export const SHARED_DEP = SHARED_PKG_NAME;

// T1.1 类型级冒烟：验证 client 可消费 shared 契约类型（import type 编译期消失，零运行时依赖）
export const ENTITY_SAMPLE: Entity = {
  id: "char-sample",
  type: "character",
  name: "示例角色",
  data: {},
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
};
export const OUTLINE_ROOT_ID: OutlineTree["id"] = "root";
export const PROJECT_LANG: ProjectConfig["language"] = "zh";
