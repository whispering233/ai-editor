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
 * 只是候选链的第一项——**不弹对话框**，但也不保证可用（见 `libraryRootCandidates`）。
 */
export function suggestedLibraryDir(documentsDir: string): string {
  return join(documentsDir, "AI Editor");
}

/** 是否 OneDrive 重定向出来的路径（Documents 常见被「已知文件夹移动」改到这里） */
function isCloudSynced(documentsDir: string): boolean {
  return /onedrive/i.test(documentsDir);
}

/**
 * 默认书库目录**候选链**（按优先级，调用方逐个试 `mkdir`，第一个成功的就是它）：
 *
 * 1. `<文档>/AI Editor` —— 符合用户直觉；但**跳过 OneDrive 重定向的文档目录**：
 * 我们把 `data.db`（SQLite）与备份 zip 放在书库内，实时云同步目录下会有锁竞争与冲突风险。
 * 2. `<主目录>/AI Editor` —— 不进云同步，且是用户能自己找到的地方。
 * 3. `<userData>/AI Editor` —— 应用数据目录，必定可写（前两项都不可用时的兜底）。
 *
 * 为什么需要链：Windows 上「文档」是已知文件夹，可能被重定向到**并不存在**的路径
 * （OneDrive 卸载后的注册表残留是常见成因），此时 `mkdir` 会直接抛错——
 * 不兜底就是「首次启动直接崩」（其他 Electron 应用踩过）。
 */
export function libraryRootCandidates(dirs: {
  documents: string;
  home: string;
  userData: string;
}): string[] {
  const candidates: string[] = [];
  if (!isCloudSynced(dirs.documents)) candidates.push(suggestedLibraryDir(dirs.documents));
  candidates.push(join(dirs.home, "AI Editor"));
  candidates.push(join(dirs.userData, "AI Editor"));
  return [...new Set(candidates)]; // 去重（如 home 与 userData 同盘时仍可能重复）
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
