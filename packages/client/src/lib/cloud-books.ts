// 「从云端恢复」对话框的展示口径（行状态判定 / 元信息文案 / 失败文案）——纯函数，可无 jsdom 单测。
//
// 契约：docs/ui/DESIGN.md §书架主页 `cloud-remote-books-dialog`（行 = 书名 + 元信息 + 行尾状态；
// 「本机已有」置灰 / 无备份置灰 / 可导入给「导入」按钮）、docs/api/100-api-cloud.md
//（GET /cloud/remote-books 字段、POST /cloud/import-book 错误码）。
// 为什么落 lib/：框走 `components/ui/dialog.tsx`（createPortal），node 环境渲染即崩
// ——分支与文案收在纯函数里，presenter 只负责摆放（同 `components/shelf/book-delete-dialog.tsx` 惯例）。
import type { CloudRemoteBook } from "@whispering233/ai-editor-shared";
import { formatBackupTime, formatBytes } from "./backup";

/** 行尾状态三分支（`importable` 才给「导入」按钮） */
export type CloudRemoteBookRowState = "importable" | "already-local" | "no-backup";

/**
 * 行状态。**优先级 = 本机已有 > 无备份 > 可导入**：两态同时成立时说「本机已有」——
 * 那是用户唯一能做的事（打开那本书自己同步），说「无备份」会把人引到错的结论上。
 */
export function cloudRemoteBookRowState(
  book: Pick<CloudRemoteBook, "localExists" | "backups">,
): CloudRemoteBookRowState {
  if (book.localExists) return "already-local";
  if (book.backups.length === 0) return "no-backup";
  return "importable";
}

/** 置灰态的行尾徽标文案（单一来源；可导入行不渲染徽标——那行给按钮） */
export const CLOUD_REMOTE_ROW_LABELS: Record<
  Exclude<CloudRemoteBookRowState, "importable">,
  string
> = {
  "already-local": "本机已有",
  "no-backup": "无备份",
};

/** 行标题：书名解析不出（回退命名 / 用户手工命名目录）→ 回退目录名（API 契约的 UI 口径） */
export function cloudRemoteBookTitle(book: Pick<CloudRemoteBook, "name" | "dirName">): string {
  return book.name ?? book.dirName;
}

/**
 * 行元信息（`caption-text`）：`最近备份时间 · N 份 · 大小`。
 * 大小取 **head（最近那份）**——缺省导入的就是它，用户核对的也是它；
 * 目录内一份可解析的备份都没有 → null（行尾已是「无备份」，元信息行不复述）。
 */
export function describeCloudBookMeta(book: Pick<CloudRemoteBook, "backups">): string | null {
  const head = book.backups[0];
  if (head === undefined) return null;
  return `${formatBackupTime(head.createdAt)} · ${book.backups.length} 份 · ${formatBytes(head.size)}`;
}

/**
 * 「从云端恢复」框内失败文案（列表拉取与导入共用——两处的错误码集与用户动作相同）。
 * - `CLOUD_NOT_CONFIGURED`：本机解决不了 → 引导去设置页云端面板（框内另给「去设置页」入口）
 * - `PROJECT_ALREADY_EXISTS`：本机已有同 id 的书，服务端**不静默覆盖** → 打开那本自己同步
 * - 其余（409 `SCHEMA_VERSION_MISMATCH` / 404 / 400 `VALIDATION_ERROR` / 502 三码）：服务端 message
 *   已中文可读（含具体原因），透传最准确
 */
export function describeCloudImportError(code: string | null, message: string): string {
  switch (code) {
    case "CLOUD_NOT_CONFIGURED":
      return "还没有配置云端账号——去「设置 → 备份 → 云端备份」填好地址与账号再回来";
    case "PROJECT_ALREADY_EXISTS":
      return "本机已有这本书，打开后同步即可";
    case "CLIENT_NETWORK_ERROR":
      return "无法连接服务，请确认 ai-editor 服务已启动";
    default:
      return message !== "" ? message : "从云端恢复失败，请稍后重试";
  }
}
