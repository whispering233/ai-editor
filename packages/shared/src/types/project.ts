// 项目配置类型：API 形态（camelCase）+ project.json 存储形态（snake_case）两套

/** 项目语言 */
export type ProjectLanguage = "zh" | "en";

/**
 * 项目配置（API 响应形态，GET /api/v1/project/config）
 * 注：`prompt` 字段已废弃——不再返回；项目规则唯一事实源改为项目目录 
 * （见 GET /api/v1/project/agents）
 */
export interface ProjectConfig {
  id: string;
  name: string;
  language: ProjectLanguage;
 /** schema 版本（对应 project.json 的 schema_version） */
  schemaVersion: number;
 /** 大纲「当前位置」节点 id（伏笔健康指标依赖）；null = 未设置 */
  currentPosition: string | null;
 /** 推演节点标记（**章**节点 id 数组；顺序 = 可见章先序，由写入侧归一；字段缺失 = []） */
  deductionNodes: string[];
 /** 自动备份频率（分钟）；null = 关闭；缺省 10（新项目默认开启，读侧兜底） */
  backupFrequencyMinutes: number | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

/**
 * project.json 存储形态（内部 snake_case）
 * 硬约束：DeepSeek API key 绝不写入本文件
 */
export interface ProjectFileConfig {
  id: string;
  name: string;
  language: ProjectLanguage;
 /**
 * **已废弃**：项目级提示词——不再读写；项目规则改由项目目录 承载。
 * 旧文件中的残留字段宽松读取（不参与 schema_version 判定），新写入不再产生该字段
 */
  prompt?: string;
  schema_version: number;
  current_position: string | null;
 /**
 * 推演节点标记（**可选字段**，2026-09）：章节点 id 数组；顺序 = 可见章先序（写入侧去重 + 归一）；
 * 缺失 = 空数组（旧文件兜底）；软删 / 已失效 id 由渲染、注入、工具三处过滤，不自动清理
 */
  deduction_nodes?: string[];
 /**
 * 自动备份频率（**可选字段**——旧项目文件可缺失，读侧兜底缺省 10；
 * 写侧「只写显式值」：未在 patch 中出现则不写盘，避免污染旧数据）
 * 仅接受枚举 1/5/10/15/30/60（BACKUP_FREQUENCIES）；null / 0 = 关闭（0 为读侧兼容旧数据语义）
 */
  backup_frequency_minutes?: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * 项目规则文件 （项目规则唯一事实源，取代 project.json `prompt` 字段）
 * GET /api/v1/project/agents 响应形态
 */
export interface ProjectAgents {
 /** 文件内容（文件不存在 → 空串） */
  content: string;
 /** 文件是否存在（false 时 content 为空串） */
  exists: boolean;
 /** 文件 mtime（ISO 8601；文件不存在 → null）——外部修改检测依据 */
  updatedAt: string | null;
}
