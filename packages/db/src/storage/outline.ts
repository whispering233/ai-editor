// @whispering233/ai-editor-db outline.json 存储模块（T2.2）
//
// 单一事实来源：doc/database/schema.md 第 123-155 行（outline.json 契约）——
// 严格三层（卷→章→场景，决策 19）、节点携带 updated_at 版本戳、顶层 schema_version、
// 软删字段 deleted/deleted_at（决策 12）。
// 读接口返回 shared 存储形态 OutlineFileTree（snake_case），映射到 API 形态由
// @whispering233/ai-editor-shared/utils 的 mapOutlineFileToTree 负责（本模块不映射）。

import { join } from "node:path";
import type { OutlineFileNode, OutlineFileNodeBase, OutlineFileTree } from "@whispering233/ai-editor-shared";
import { SCHEMA_VERSION } from "../schema.js";
import { readTextFileOrNull, writeJsonAtomic } from "./atomic.js";

/** outline.json 文件名（决策 8：项目根目录） */
export const OUTLINE_FILE_NAME = "outline.json";

/** 最小空树：文件缺失时的返回值（见 readOutlineFile 注释） */
const EMPTY_TREE: OutlineFileTree = {
  id: "root",
  type: "root",
  schema_version: SCHEMA_VERSION,
  children: [],
};

/**
 * 读取 outline.json。
 *
 * 缺失文件语义（本项目首次初始化即创建，决策 8）：**返回最小空树**而非抛错——
 * 调用方（server 打开项目前的探测、初始化流程）无需为「文件还不存在」分支处理；
 * 空树的 schema_version 取当前 SCHEMA_VERSION，与初始化流程写入的一致（决策 13）。
 * 注意：返回的是新对象，调用方修改它不会影响后续读取。
 *
 * JSON 损坏 / 结构不符：**抛错**，不静默重建——静默覆盖会掩盖文件损坏并可能
 * 丢弃用户数据，由上层决定提示用户还是重建。
 * schema_version 数值与 SCHEMA_VERSION 不一致时**不在此校验**（决策 13：以
 * data.db 的 user_version 为准判定重建，JSON 版本仅用于结构判断，由上层流程处理）。
 *
 * @param dir 项目根目录
 * @throws 文件存在但 JSON 解析失败或顶层结构不符时抛出
 */
export function readOutlineFile(dir: string): OutlineFileTree {
  const raw = readTextFileOrNull(join(dir, OUTLINE_FILE_NAME));
  if (raw === null) return { ...EMPTY_TREE, children: [] };
  const parsed: unknown = JSON.parse(raw); // JSON 损坏抛 SyntaxError，不静默吞
  return validateOutlineFile(parsed);
}

/**
 * 校验 outline.json 顶层结构（读时校验，schema.md 契约）：
 * 顶层必须是 { id:"root", type:"root", schema_version:number, children:[] }。
 * 节点级字段（title/updated_at 等）不逐一校验——文件格式演进由 schema_version
 * 判定（决策 13），此处只拦「完全不是大纲树」的脏数据。
 */
function validateOutlineFile(parsed: unknown): OutlineFileTree {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).id !== "root" ||
    (parsed as Record<string, unknown>).type !== "root" ||
    typeof (parsed as Record<string, unknown>).schema_version !== "number" ||
    !Array.isArray((parsed as Record<string, unknown>).children)
  ) {
    throw new Error("outline.json 顶层结构不符契约（需 {id:\"root\", type:\"root\", schema_version, children[]}）");
  }
  return parsed as OutlineFileTree;
}

/**
 * 原子写 outline.json（决策 11：临时文件 + fsync + rename，见 writeJsonAtomic）。
 * 顶层 schema_version 随 tree.schema_version 原样写入——保持与 project.json
 * 同步写入是调用方职责（决策 13 修订：两个文件用同一版本号常量）。
 * 节点 updated_at 版本戳（决策 19）由调用方在变更后通过 touch/update 更新，
 * 本函数不隐式修改树。
 */
export function writeOutlineFile(dir: string, tree: OutlineFileTree): void {
  writeJsonAtomic(join(dir, OUTLINE_FILE_NAME), tree);
}

/**
 * 按 id 递归查找节点（卷/章/场景，不匹配 root 自身）。
 * @returns 找到的节点引用（修改它即修改树）；未找到返回 undefined
 */
export function findOutlineNode(tree: OutlineFileTree, nodeId: string): OutlineFileNode | undefined {
  return findInChildren(tree.children, nodeId);
}

/** 在节点数组内递归查找（children 可选，严格三层由 shared 类型约束） */
function findInChildren(nodes: readonly OutlineFileNode[], nodeId: string): OutlineFileNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const children = nodeChildren(node);
    if (children !== undefined) {
      const found = findInChildren(children, nodeId);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** 取节点的 children（卷→章、章→场景；场景为叶子返回 undefined） */
function nodeChildren(node: OutlineFileNode): readonly OutlineFileNode[] | undefined {
  return (node as { children?: readonly OutlineFileNode[] }).children;
}

/**
 * 更新节点版本戳（决策 19：任何字段变更——含 children 重排、软删/还原——
 * 由服务端原子写时统一更新 updated_at，支撑决策 14 提案快照比对）。
 * 仅更新 updated_at，不改动其他字段；改 title/summary 用 updateOutlineNode。
 *
 * @param updatedAt ISO 8601，由调用方（应用层）传入，模块不生成时间
 * @throws 节点不存在时抛错——静默忽略会掩盖「改了个不存在的节点」的调用方 bug
 */
export function touchOutlineNode(tree: OutlineFileTree, nodeId: string, updatedAt: string): void {
  const node = findOutlineNode(tree, nodeId);
  if (node === undefined) {
    throw new Error(`touchOutlineNode: 大纲节点不存在 ${nodeId}`);
  }
  node.updated_at = updatedAt;
}

/**
 * updateOutlineNode 可更新的节点字段
 * （决策 19：title/summary；决策 23：data——与 title/summary 同等对待，patch 含 data 时整体替换，
 * 未传字段保留；data 的浅合并语义在 outline-ops.updateOutlineNodeInfo（与实体 updateEntity 同构）；
 * 决策 12：软删字段）
 */
export type OutlineNodePatch = Partial<
  Pick<OutlineFileNodeBase, "title" | "summary" | "data" | "deleted" | "deleted_at">
>;

/**
 * 更新节点字段并统一更新 updated_at 版本戳（决策 19）。
 * 就地修改树（返回节点引用），调用方随后 writeOutlineFile 落盘；
 * children 重排等无法用 patch 表达的变更请用 touchOutlineNode。
 *
 * @param updatedAt ISO 8601，由调用方（应用层）传入，模块不生成时间
 * @returns 更新后的节点引用
 * @throws 节点不存在时抛错
 */
export function updateOutlineNode(
  tree: OutlineFileTree,
  nodeId: string,
  patch: OutlineNodePatch,
  updatedAt: string,
): OutlineFileNode {
  const node = findOutlineNode(tree, nodeId);
  if (node === undefined) {
    throw new Error(`updateOutlineNode: 大纲节点不存在 ${nodeId}`);
  }
  Object.assign(node, patch);
  node.updated_at = updatedAt;
  return node;
}

/**
 * 根 → 目标节点的路径 id 列表（含 root 与目标节点自身）。
 * 供后续卡使用：章节序现推（决策 21）、computeState 树路径排序（决策 9，
 * data-flow.md 第 50 行 getNodePathIds）。
 *
 * @throws 节点不存在时抛错（路径唯一是严格三层的推论，找不到即调用方 bug）
 */
export function getOutlinePathIds(tree: OutlineFileTree, nodeId: string): string[] {
  const path: string[] = [tree.id];
  if (findPath(tree.children, nodeId, path)) return path;
  throw new Error(`getOutlinePathIds: 大纲节点不存在 ${nodeId}`);
}

/** 递归找路径：命中返回 true 且 path 已包含完整路径；未命中回溯 */
function findPath(nodes: readonly OutlineFileNode[], nodeId: string, path: string[]): boolean {
  for (const node of nodes) {
    path.push(node.id);
    if (node.id === nodeId) return true;
    const children = nodeChildren(node);
    if (children !== undefined && findPath(children, nodeId, path)) return true;
    path.pop();
  }
  return false;
}
