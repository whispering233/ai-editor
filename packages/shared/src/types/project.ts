// 项目配置类型：API 形态（camelCase）+ project.json 存储形态（snake_case）两套
// 契约来源：doc/api/endpoints.md（GET /api/v1/project/config）、doc/database/schema.md（project.json 契约）

/** 项目语言 */
export type ProjectLanguage = "zh" | "en";

/**
 * 项目配置（API 响应形态，GET /api/v1/project/config，endpoints.md）
 */
export interface ProjectConfig {
  id: string;
  name: string;
  language: ProjectLanguage;
  /** 项目级提示词（决策 7 三层注入的项目层） */
  prompt: string;
  /** schema 版本（对应 project.json 的 schema_version，决策 13） */
  schemaVersion: number;
  /** 大纲「当前位置」节点 id（伏笔健康指标依赖，决策 21）；null = 未设置 */
  currentPosition: string | null;
  /** 自动备份频率（分钟，决策 27）；null = 关闭；缺省 10（新项目默认开启，读侧兜底） */
  backupFrequencyMinutes: number | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

/**
 * project.json 存储形态（schema.md 契约，内部 snake_case）
 * 硬约束：DeepSeek API key 绝不写入本文件（决策 17）
 */
export interface ProjectFileConfig {
  id: string;
  name: string;
  language: ProjectLanguage;
  prompt: string;
  schema_version: number;
  current_position: string | null;
  /**
   * 自动备份频率（决策 27，**可选字段**——旧项目文件可缺失，读侧兜底缺省 10；
   * 写侧「只写显式值」：未在 patch 中出现则不写盘，避免污染旧数据）
   * 仅接受枚举 5/10/15/30/60；null / 0 = 关闭（0 为读侧兼容旧数据语义）
   */
  backup_frequency_minutes?: number | null;
  created_at: string;
  updated_at: string;
}
