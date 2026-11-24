// server：搜索 / 网页抓取凭据的唯一来源（`~/.ai-editor/search.json` 的 `apiKey`）
//
// 口径（docs/design/tasks.md「已定设计」）：
// - **不复用模型凭据**：pi 的 `auth.json` / `DEEPSEEK_API_KEY` 一律不读、不读任何环境变量、无回退——
//   对话 key 与搜索 key 是两份独立配置，后者缺失就是未配置（调用方抛可读错误）
// - 读取失败（文件缺失 / 坏 JSON / 顶层非对象 / `apiKey` 非字符串 / 空串）**整份忽略**、绝不抛错：
//   配置文件坏掉不该让工具调用挂在异常上，用户看到的是「设置 → 高级」的指引
// - 目录属用户级配置（不进项目文件 / 备份 / 导出 / 云端）
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthResult } from "@earendil-works/pi-ai";

/** 搜索凭据文件路径（**唯一字面量处**） */
export const SEARCH_CONFIG_PATH = join(homedir(), ".ai-editor", "search.json");

/**
 * 未配置文案（web_search / fetch_content 共用一份）：指向设置页可达入口，
 * 并说明单供应商前提——用户不会去别处找第二份 key。
 */
export const MISSING_SEARCH_KEY_MESSAGE =
  "未配置搜索凭据：设置 → 高级（search.json 的 apiKey）——搜索 / 网页抓取目前仅接入 DeepSeek";

/** 读取 `apiKey`（任何读取失败 / 形状不符 → null；path 可注入，测试绝不碰真实家目录） */
export function readSearchApiKey(path: string = SEARCH_CONFIG_PATH): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null; // 数组 / 字面量 / null 都不算配置
    const key = (parsed as { apiKey?: unknown }).apiKey;
    // 读侧只认 apiKey，不因多余键整份失效（写侧的 strict 校验属配置文件端点）
    return typeof key === "string" && key.trim() !== "" ? key : null;
  } catch {
    return null; // 文件缺失 / 读取失败 / 坏 JSON
  }
}

/**
 * 搜索 / 抓取的凭据解析（`AuthResolver` 的缺省实现）。
 * 有 key → `{ auth: { apiKey }, source: "search.json" }`；否则 `undefined`（调用方转成可读错误）。
 */
export async function resolveSearchAuth(path: string = SEARCH_CONFIG_PATH): Promise<AuthResult | undefined> {
  const apiKey = readSearchApiKey(path);
  return apiKey === null ? undefined : { auth: { apiKey }, source: "search.json" };
}