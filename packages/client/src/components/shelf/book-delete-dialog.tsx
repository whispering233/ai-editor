// `book-delete-dialog`（DESIGN.md §书架主页）：删书确认框——复用受控 `components/ui/dialog.tsx`，
// 不新造浮层。契约 = docs/api/10-api-project.md §POST /project/delete。
//
// 形态：书名 + 三行后果 + 复选项「同时删除云端备份」（**默认不勾**）+ Footer `[取消]` + `[删除]`（danger）。
// **删除前的云端推送失败**（未 force，含 409 CLOUD_CONFLICT）→ 服务端**什么都没删**：框内显示错误文案，
// Footer 换成 `[取消]` + `[仍要删除]`（danger，`force: true`），并写明「最新改动不会上传云端」。
// 删除在途 `loading` 防连点；删除成功后由调用方（书架页）刷新书架并按需回书架。
import { useState } from "react";
import { Button, Checkbox } from "antd";
import type { ProjectDeleteRes } from "@whispering233/ai-editor-shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, deleteProject } from "@/lib/api";
import { describeDeleteBookError } from "@/lib/error-messages";
import { useUiStore } from "@/stores/ui";

/** 删除目标：项目 id（调用方用它判定「是不是当前书」）+ 书名（文案）+ 书目录绝对路径（服务端入参） */
export interface BookDeleteTarget {
  id: string;
  name: string;
  path: string;
}

/** 复选项初始值：**默认不勾**——云端那份是唯一不在本机的副本，删它必须是显式选择 */
export const BOOK_DELETE_REMOTE_DEFAULT = false;

/** 框内三行后果（文案单一定义） */
export const BOOK_DELETE_CONSEQUENCES = [
  "本地目录连同 .backups/ 里的全部备份一并删除，不可恢复",
  "已启用云备份时，会先把当前状态推送到云端（云端不会停在旧状态）",
  "在跑的拆解任务会被取消",
] as const;

/** 确认按钮视图：有错误 → 换「仍要删除」（force）并写明最新改动不上云 */
export function bookDeleteConfirmView(error: string | null): {
  confirmLabel: string;
  force: boolean;
  note: string | null;
} {
  return error === null
    ? { confirmLabel: "删除", force: false, note: null }
    : {
        confirmLabel: "仍要删除",
        force: true,
        note: "仍要删除：最新改动不会上传云端（云端那份保持原样）",
      };
}

/** 成功结果 → toast（三种口径：只删本机 / 删前推送过一份 / 本地已删但云端保留） */
export function bookDeleteToast(
  res: ProjectDeleteRes,
  name: string,
): { text: string; kind: "success" | "error" } {
  const parts = [`已删除《${name}》`];
  if (res.pushed !== undefined) parts.push(`（删前已推送一份 ${res.pushed.fileName} 到云端）`);
  if (res.remoteDeleted === true) parts.push("（云端备份也已删除）");
  if (res.remoteError !== undefined) {
    return {
      text: `${parts.join("")}——云端备份未能删除（${res.remoteError.message}），可到云盘网页手动清理`,
      kind: "error",
    };
  }
  return { text: parts.join(""), kind: "success" };
}

export function BookDeleteDialog({
  book,
  onDeleted,
  onOpenChange,
}: {
  /** 非 null = 打开（受控：删除目标由书架页持有） */
  book: BookDeleteTarget | null;
  /** 删除成功后由调用方收敛：刷新书架；删的是当前书时回书架并清项目/云端镜像 */
  onDeleted: (book: BookDeleteTarget) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [deleteRemote, setDeleteRemote] = useState<boolean>(BOOK_DELETE_REMOTE_DEFAULT);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = bookDeleteConfirmView(error);

  /** 清本地状态（关闭与成功后都走它）：下次打开是干净的一遍 */
  function resetLocal() {
    setError(null);
    setDeleteRemote(BOOK_DELETE_REMOTE_DEFAULT);
  }

  /** 关闭路径（Esc / 遮罩 / 取消）；删除在途不许关（在途请求与框状态不许错位） */
  function close() {
    if (deleting) return;
    resetLocal();
    onOpenChange(false);
  }

  async function runDelete(force: boolean) {
    if (book === null || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await deleteProject({ path: book.path, force, delete_remote: deleteRemote });
      const toast = bookDeleteToast(res, book.name);
      useUiStore.getState().showToast(toast.text, toast.kind);
      resetLocal();
      onOpenChange(false);
      onDeleted(book);
    } catch (err) {
      setError(
        describeDeleteBookError(
          err instanceof ApiError ? err.code : null,
          err instanceof ApiError ? err.message : "",
        ),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={book !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除《{book?.name}》</DialogTitle>
          <DialogDescription>删除不可恢复。这次删除会做三件事：</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {BOOK_DELETE_CONSEQUENCES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Checkbox
          checked={deleteRemote}
          onChange={(e) => setDeleteRemote(e.target.checked)}
          disabled={deleting}
        >
          同时删除云端备份
        </Checkbox>
        {error !== null && <p className="text-sm text-destructive">{error}</p>}
        {view.note !== null && <p className="text-sm text-destructive">{view.note}</p>}
        <DialogFooter>
          <Button onClick={close} disabled={deleting}>
            取消
          </Button>
          <Button type="primary" danger loading={deleting} onClick={() => void runDelete(view.force)}>
            {view.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
