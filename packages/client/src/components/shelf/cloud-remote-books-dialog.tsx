// `cloud-remote-books-dialog`（DESIGN.md §书架主页「从云端恢复，新机器路径」）：书架「导入备份」旁的入口。
//
// 契约：docs/api/100-api-cloud.md（GET /cloud/remote-books、POST /cloud/import-book 与错误码）。
// 形态：打开即拉列表；可滚动行列表（`data-row` 行语言）= 书名（解析不出回退目录名）+
// `caption-text` 元信息（最近备份时间 · 份数 · 大小）+ 行尾状态——「本机已有」/「无备份」置灰，
// 可导入行给「导入」（行内 `loading` 防连点）。导入成功 → 关框 + toast + 刷新书架（**不自动打开**，
// 与「导入备份」一致）；失败 → 框内错误文案，框不关。未配置云端 → 「去设置页」引导（复用跨页意图
// `requestCloudPane` + `navigate("/preferences")`）。
// 分层：容器 `CloudRemoteBooksDialog`（状态 + 请求副作用）+ presenter `CloudRemoteBooksView`
//（纯渲染 ⇒ `react-dom/server` 走查，仓内无 jsdom）。
import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import type { CloudRemoteBook } from "@whispering233/ai-editor-shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TypeChip } from "@/components/ui/tag-chip";
import { ApiError, getCloudRemoteBooks, importCloudBook } from "@/lib/api";
import {
  CLOUD_REMOTE_ROW_LABELS,
  cloudRemoteBookRowState,
  cloudRemoteBookTitle,
  describeCloudBookMeta,
  describeCloudImportError,
} from "@/lib/cloud-books";
import { navigate } from "@/hooks/use-route";
import { useCloudStore } from "@/stores/cloud";
import { useUiStore } from "@/stores/ui";

export interface CloudRemoteBooksViewProps {
  /** 云端书目录（null = 加载中；错误态由 `loadError` 表达） */
  books: CloudRemoteBook[] | null;
  /** 列表拉取失败文案（null = 正常） */
  loadError: string | null;
  /** 失败因「云端还没配置」→ 给「去设置页」入口（本机解决不了） */
  loadNotConfigured: boolean;
  /** 导入失败文案（框内一行；框不关，可换一本再试） */
  importError: string | null;
  /** 在途导入的云端目录名（该行 `loading`、其余行禁用——防连点） */
  importingDir: string | null;
  onImport: (book: CloudRemoteBook) => void;
  onRetry: () => void;
  onOpenCloudSettings: () => void;
  onClose: () => void;
}

/** presenter：加载态 / 失败态（含「去设置页」）/ 空态 / 行列表（三分支行状态） */
export function CloudRemoteBooksView({
  books,
  loadError,
  loadNotConfigured,
  importError,
  importingDir,
  onImport,
  onRetry,
  onOpenCloudSettings,
  onClose,
}: CloudRemoteBooksViewProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>从云端恢复</DialogTitle>
        <DialogDescription>
          云端存着这些书的备份——导入会为本机建一本新书（沿用原项目
          id，之后可继续同步），不会自动打开
        </DialogDescription>
      </DialogHeader>

      {loadError !== null ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm break-all text-destructive">{loadError}</p>
          <div className="flex gap-2">
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
            {loadNotConfigured && (
              <Button size="small" onClick={onOpenCloudSettings}>
                去设置页
              </Button>
            )}
          </div>
        </div>
      ) : books === null ? (
        <p className="text-sm text-muted-foreground">正在读取云端备份…</p>
      ) : books.length === 0 ? (
        <EmptyState padding="sm">云端还没有可恢复的备份</EmptyState>
      ) : (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {books.map((book) => {
            const state = cloudRemoteBookRowState(book);
            const meta = describeCloudBookMeta(book);
            return (
              <li
                key={book.dirName}
                className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{cloudRemoteBookTitle(book)}</p>
                  {meta !== null && (
                    <p className="truncate text-xs text-muted-foreground">{meta}</p>
                  )}
                </div>
                {state === "importable" ? (
                  <Button
                    size="small"
                    className="shrink-0"
                    loading={importingDir === book.dirName}
                    disabled={importingDir !== null}
                    onClick={() => onImport(book)}
                  >
                    导入
                  </Button>
                ) : (
                  <TypeChip className="shrink-0">{CLOUD_REMOTE_ROW_LABELS[state]}</TypeChip>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {importError !== null && <p className="text-sm break-all text-destructive">{importError}</p>}

      <DialogFooter>
        <Button onClick={onClose} disabled={importingDir !== null}>
          关闭
        </Button>
      </DialogFooter>
    </>
  );
}

export interface CloudRemoteBooksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 导入成功后的收敛（书架页刷新书架；**不自动打开**新书） */
  onImported: () => void;
}

/** 容器：打开即拉列表 + 导入动作（presenter 只收展示值与回调） */
export function CloudRemoteBooksDialog({
  open,
  onOpenChange,
  onImported,
}: CloudRemoteBooksDialogProps) {
  const [books, setBooks] = useState<CloudRemoteBook[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadNotConfigured, setLoadNotConfigured] = useState(false);
  const [importingDir, setImportingDir] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  /** 请求序号：关框后迟到的列表响应不得写进下一次打开的状态（事件级身份守卫） */
  const seq = useRef(0);

  async function load() {
    const mine = ++seq.current;
    setBooks(null);
    setLoadError(null);
    setLoadNotConfigured(false);
    setImportingDir(null);
    setImportError(null);
    try {
      const res = await getCloudRemoteBooks();
      if (mine !== seq.current) return;
      setBooks(res.books);
    } catch (err) {
      if (mine !== seq.current) return;
      const code = err instanceof ApiError ? err.code : null;
      setLoadNotConfigured(code === "CLOUD_NOT_CONFIGURED");
      setLoadError(describeCloudImportError(code, err instanceof ApiError ? err.message : ""));
    }
  }

  // 打开即拉（依赖仅 [open]：load 每次渲染重建，但只有「打开那一刻」需要拉一次）
  useEffect(() => {
    if (!open) return;
    void load();
  }, [open]);

  async function runImport(book: CloudRemoteBook) {
    if (importingDir !== null) return;
    setImportingDir(book.dirName);
    setImportError(null);
    try {
      const res = await importCloudBook({ dir_name: book.dirName });
      // 成功：关框 + toast（带书名）+ 刷新书架；不自动打开（用户自己决定何时进这本书）
      seq.current += 1; // 关框后迟到的列表响应作废
      onOpenChange(false);
      useUiStore.getState().showToast(`已从云端恢复《${res.name}》`, "success");
      onImported();
    } catch (err) {
      setImportError(
        describeCloudImportError(
          err instanceof ApiError ? err.code : null,
          err instanceof ApiError ? err.message : "",
        ),
      );
    } finally {
      setImportingDir(null);
    }
  }

  /** 未配置云端：跳设置页「备份 → 云端备份」（跨页意图一次性下传，设置页消费后置回 null） */
  function openCloudSettings() {
    useCloudStore.getState().requestCloudPane();
    navigate("/preferences");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 导入在途不许关框（在途请求与框状态不错位，同 `book-delete-dialog`）：服务端那份照样落盘，
        // 关掉框会让「已从云端恢复」的 toast 来得莫名其妙
        if (!next && importingDir !== null) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <CloudRemoteBooksView
          books={books}
          loadError={loadError}
          loadNotConfigured={loadNotConfigured}
          importError={importError}
          importingDir={importingDir}
          onImport={(book) => void runImport(book)}
          onRetry={() => void load()}
          onOpenCloudSettings={openCloudSettings}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
