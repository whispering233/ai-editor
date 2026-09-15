// 桌面版应用级配置（`docs/design/50-desktop.md` §2）。
//
// 唯一载体 = `<userData>/desktop.json`，唯一键 = 书库位置（创作根绝对路径）。创作根属「部署级」，
// 不能存进它自己的 `<创作根>/.ai-editor/config.json`（那要先知道创作根才能读）；CLI 形态永不读本文件。
//
// 本模块只做纯路径/编解码（入参是路径，不碰 `app.getPath`），便于单测与主进程注入。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

/** desktop.json 的结构（当前只有一个键；解析时未知键一律忽略） */
export interface DesktopConfig {
  /** 书库位置（创作根）；必须是绝对路径——桌面版不得依赖 cwd 语义 */
  projectRoot: string;
}

/** 配置文件路径：`<userData>/desktop.json` */
export function desktopConfigPath(userDataDir: string): string {
  return join(userDataDir, "desktop.json");
}

/**
 * 首次启动的建议书库位置：`<文档目录>/AI Editor`。
 * 只是对话框的初始值——**不静默创建**（用户可改选或取消）。
 */
export function suggestedLibraryDir(documentsDir: string): string {
  return join(documentsDir, "AI Editor");
}

/** 解析配置文本：非法 JSON / 结构不符 / 相对路径 → null（一律视为「未配置」） */
export function parseDesktopConfig(raw: string): DesktopConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const root = (parsed as { projectRoot?: unknown }).projectRoot;
  if (typeof root !== "string" || root.trim() === "" || !isAbsolute(root)) return null;
  return { projectRoot: root };
}

/** 读配置：文件不存在 / 读失败 / 内容非法 → null */
export function readDesktopConfig(file: string): DesktopConfig | null {
  try {
    return parseDesktopConfig(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/** 原子写配置（临时文件 + rename；父目录不存在则先建——userData 首次可能尚未落盘） */
export function writeDesktopConfig(file: string, config: DesktopConfig): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  renameSync(tmp, file);
}
