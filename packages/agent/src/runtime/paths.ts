// pi 运行时：路径解析（项目目录 vs pi agent dir）
//
// 会话文件落**项目目录**（随书移动/备份天然携带），模型/凭据/参数落 pi agent dir。
// 两个位置都由本模块给出，避免调用方自行拼接路径（路径只出一处）。

import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** 项目内会话目录名（与备份管道登记的随包目录同名） */
export const SESSIONS_DIR_NAME = "sessions";

/** 项目规则文件名（唯一持久化上下文通道；读取只认项目根这一个文件） */
export const AGENTS_FILE_NAME = "AGENTS.md";

/** pi agent dir（`~/.pi/agent`；调用方可覆盖——测试隔离依赖） */
export function resolveAgentDir(override?: string): string {
  return override === undefined ? getAgentDir() : resolve(override);
}

/** 项目内会话目录绝对路径（`<项目根>/sessions`） */
export function projectSessionsDir(projectRoot: string): string {
  return join(resolve(projectRoot), SESSIONS_DIR_NAME);
}

/** 项目根 AGENTS.md 绝对路径 */
export function projectAgentsFilePath(projectRoot: string): string {
  return join(resolve(projectRoot), AGENTS_FILE_NAME);
}
