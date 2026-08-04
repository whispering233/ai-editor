// 左栏 Sidebar（doc/ui/layout.md §2.3）：产品标识 + 书架（项目→会话二级树）+ 底部设置/主题切换
// U3 实现：书架树——bookshelf 列表（挂载即拉取，与 config 无关，无项目时照常展示）；
//   点击项目行 openProjectAt（当前项目 name 匹配高亮）；chevron 单展开会话列表（归属项目，决策 22，
//   展开时 chat store 自动 loadSessions）；底部 [+ 新建项目] Dialog（bookshelf.rootPath + buildBookPath）；
//   主题切换用 use-theme hook（layout.md §3.4 Sun/Moon，localStorage 持久化）
// E3 导出/导入（release-review §二「数据主权归用户」载体）：
//   - 书架头部行 [+ 导入备份]（Upload，zip 恢复为新书，导入不自动打开 → 刷新书架）；
//   - 当前项目行尾部 [导出备份]（Download，点击即下载 zip；无项目打开时不渲染——「导出当前项目」语义）
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { BookOpen, ChevronRight, Download, Loader2, MessageSquare, Moon, Plus, Settings, Sun, Upload } from "lucide-react";
import { formatRelativeTime, formatTimestamp } from "@whispering233/ai-editor-shared";
import { useTheme } from "../../hooks/use-theme";
import { ApiError, CLIENT_NETWORK_ERROR, exportProjectZip, importProjectZip } from "../../lib/api";
import { describeExportError, describeImportError, describeOpenError } from "../../lib/error-messages";
import { cn } from "../../lib/utils";
import { buildBookPath, useProjectStore } from "../../stores/project";
import { useChatStore } from "../../stores/chat";
import { useUiStore } from "../../stores/ui";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

/** 紧凑日期（左栏 10% 很窄）：当年显示 MM-DD，跨年显示 YY-MM-DD；非法输入原样返回 */
function formatShortTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const sameYear = date.getFullYear() === new Date().getFullYear();
  if (sameYear) return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${String(date.getFullYear()).slice(-2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 会话子列表（展开的项目行下方渲染）：未加载/失败/空态各自呈现；点击会话 → 右栏切换 */
function SessionList() {
  const sessions = useChatStore((s) => s.sessions);
  const sessionsLoading = useChatStore((s) => s.sessionsLoading);
  const sessionsError = useChatStore((s) => s.sessionsError);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const setCurrentSession = useChatStore((s) => s.setCurrentSession);

  // 展开时若列表「从未尝试加载」→ 拉取（oracle U3 审核 H1：失败后停住，
  // 由下方错误 UI 的手动重试按钮负责重试——避免失败时 sessions 保持 null 触发无限循环）
  useEffect(() => {
    if (sessions === null && !sessionsLoading && sessionsError === null) {
      void loadSessions();
    }
  }, [sessions, sessionsLoading, sessionsError, loadSessions]);

  if (sessions === null) {
    if (sessionsError !== null) {
      // 无项目打开时服务端返回 NO_PROJECT_OPEN：展示提示而非错误（会话归属项目，决策 22）
      if (sessionsError === "NO_PROJECT_OPEN") {
        return (
          <p className="ml-3 border-l border-border py-1 pl-2 text-xs text-muted-foreground/60">
            打开项目后查看会话
          </p>
        );
      }
      return (
        <div className="ml-3 border-l border-border py-1 pl-2">
          <p className="text-xs text-muted-foreground">会话加载失败</p>
          <Button variant="ghost" size="xs" className="mt-0.5" onClick={() => void loadSessions()}>
            重试
          </Button>
        </div>
      );
    }
    return <p className="ml-3 border-l border-border py-1 pl-2 text-xs text-muted-foreground/60">会话加载中…</p>;
  }

  if (sessions.length === 0) {
    return <p className="ml-3 border-l border-border py-1 pl-2 text-xs text-muted-foreground/60">暂无会话</p>;
  }

  return (
    <ul className="ml-3 border-l border-border py-0.5 pl-1.5">
      {sessions.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            title={s.lastMessage || "空会话"}
            onClick={() => setCurrentSession(s.id)}
            className={cn(
              "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors",
              currentSessionId === s.id
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <MessageSquare className="size-3 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{s.lastMessage || "（空会话）"}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground/60">{formatRelativeTime(s.updatedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar() {
  const { theme, toggleTheme } = useTheme();

  // 书架（bookshelf 与 config 无关：无项目打开也展示）
  const config = useProjectStore((s) => s.config);
  const bookshelf = useProjectStore((s) => s.bookshelf);
  const bookshelfLoading = useProjectStore((s) => s.bookshelfLoading);
  const bookshelfError = useProjectStore((s) => s.bookshelfError);
  const loadBookshelf = useProjectStore((s) => s.loadBookshelf);
  const openProjectAt = useProjectStore((s) => s.openProjectAt);
  const createProjectAt = useProjectStore((s) => s.createProjectAt);

  // 展开的项目行（单展开：同一时刻只展开一本，布局 §2.3 推荐）；展开会话由 SessionList 按需加载
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  // 新建项目 Dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [bookName, setBookName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // 导入备份 Dialog（E3）
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importName, setImportName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // 导出备份进行态（当前项目行下载按钮；exporting 防连点）
  const [exporting, setExporting] = useState(false);

  // 挂载时加载书架（Sidebar 常驻；Dashboard 书架形态已加载则不重复）
  useEffect(() => {
    if (!bookshelfLoading && bookshelf === null && bookshelfError === null) {
      void loadBookshelf();
    }
  }, [bookshelfLoading, bookshelf, bookshelfError, loadBookshelf]);

  /** 打开书籍（走 openProjectAt：store 自动刷新 config/outline；chat store 订阅联动重载会话） */
  async function handleOpenBook(path: string) {
    try {
      await openProjectAt(path);
      // 展开新打开的项目行（M1：Sidebar 发起的打开天然对齐展开态）
      setExpandedPath(path);
    } catch (err) {
      useUiStore.getState().showToast(describeOpenError(err instanceof ApiError ? err.code : null), "error");
    }
  }

  // M1（oracle U3 审核）：项目切换（含 Dashboard 卡片等其他入口）时收起展开态，
  // 避免「A 行展开却展示 B 项目会话」的错位呈现（chat store 数据已随项目切换，仅展开态需收敛）
  const projectId = config?.id ?? null;
  const prevProjectId = useRef(projectId);
  useEffect(() => {
    if (prevProjectId.current !== projectId) {
      prevProjectId.current = projectId;
      setExpandedPath(null);
    }
  }, [projectId]);

  /** 新建项目：书名 → 创作根/books/<书名>/，create（不打开）→ open 进入新书 → toast + 刷新书架 + 展开新书行 */
  async function handleCreateBook(e: FormEvent) {
    e.preventDefault();
    const name = bookName.trim();
    // L3（oracle U3 审核）：书名禁路径分隔符/相对路径段/控制字符——buildBookPath 直接拼目录名，
    // 否则 ".." 或含 "/" 的书名可逃出 books/ 目录
    if (!name) {
      setCreateError("请输入书名");
      return;
    }
    if (/[\\/]|^\.+$|[\u0000-\u001f]/.test(name)) {
      setCreateError("书名不能包含 /、\\ 或为 . / ..");
      return;
    }
    if (!bookshelf) {
      setCreateError("书架未加载，请稍后重试");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createProjectAt(buildBookPath(bookshelf.rootPath, name), { name, language: "zh" });
      useUiStore.getState().showToast(`已创建并打开《${name}》`);
      await loadBookshelf(); // 刷新书架让新书出现（失败由 bookshelfError 呈现）
      // 展开新书所在行（用刷新后的列表按名匹配；config 已指向新项目）
      const book = useProjectStore.getState().bookshelf?.books.find((b) => b.name === name);
      if (book) setExpandedPath(book.path);
      setBookName("");
      setCreateOpen(false);
    } catch (err) {
      setCreateError(describeOpenError(err instanceof ApiError ? err.code : null));
    } finally {
      setCreating(false);
    }
  }

  /**
   * 导出当前项目备份（E3：GET /project/export 二进制 zip → 临时 <a> 触发浏览器下载）。
   * 按钮仅渲染在当前项目行（无项目打开时无入口，与「导出当前项目」语义一致）；
   * 导出中按钮 loading 防连点；失败 toast（网络/服务端 message 映射）
   */
  async function handleExportBook(name: string) {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await exportProjectZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 延迟到下一帧 revoke（ora-1：旧版 Safari 下载开始前即 revoke 会中断下载的竞态防御）
      setTimeout(() => URL.revokeObjectURL(url), 0);
      useUiStore.getState().showToast(`已导出《${name}》备份`);
    } catch (err) {
      useUiStore.getState().showToast(
        describeExportError(
          err instanceof ApiError ? err.code : null,
          err instanceof ApiError ? err.message : "导出失败，请重试",
        ),
        "error",
      );
    } finally {
      setExporting(false);
    }
  }

  /** 文件选择：书名预填为文件名去 .zip 扩展名（zip 未解析前拿不到 project.json 内部 name） */
  function handleImportFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImportFile(file);
    setImportError(null);
    if (file) {
      setImportName((cur) => (cur.trim() === "" ? file.name.replace(/\.zip$/i, "") : cur));
    }
  }

  /**
   * 导入备份为新书（E3：multipart 上传 zip + 书名 → 服务端校验（三文件齐全 + 契约 +
   * data.db user_version）原子搬入 books/<name>/ → 刷新书架）。导入不自动打开（与 create 一致）；
   * 失败内联显示（对话框保持打开可换文件/改名重试）；成功 toast + 关闭
   */
  async function handleImportSubmit(e: FormEvent) {
    e.preventDefault();
    const name = importName.trim();
    // 客户端预检（与服务端同规则，快速反馈；最终以服务端校验为准）
    if (!importFile) {
      setImportError("请选择备份文件");
      return;
    }
    if (!name) {
      setImportError("请输入书名");
      return;
    }
    if (/[\\/]|^\.+$|[\u0000-\u001f]/.test(name)) {
      setImportError("书名不能包含 /、\\ 或为 . / ..");
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      await importProjectZip(importFile, name);
      useUiStore.getState().showToast(`已导入《${name}》`);
      await loadBookshelf(); // 刷新书架让新书出现（失败由 bookshelfError 呈现）
      setImportOpen(false);
      setImportFile(null);
      setImportName("");
    } catch (err) {
      const text = describeImportError(
        err instanceof ApiError ? err.code : null,
        err instanceof ApiError ? err.message : "导入失败，请重试",
      );
      setImportError(text);
      // 兜底反馈（ora-1）：onOpenChange 未守卫 importing——导入中途关闭对话框后内联错误不可见，
      // toast 保证失败一定有反馈（框开闭均提示；空文案如 NO_PROJECT_OPEN 不打扰）
      if (text !== "") useUiStore.getState().showToast(text, "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <aside className="flex min-w-0 flex-[1_1_10%] flex-col border-r border-border bg-sidebar">
      {/* 产品标识：衬线斜体（layout.md §3.3），点击回 #/ */}
      <a
        href="#/"
        className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-3 font-serif text-base italic text-foreground hover:text-primary"
      >
        <span className="text-primary">◈</span>
        <span className="truncate">我的小说</span>
      </a>

      {/* 书架区：项目→会话二级树 + 新建项目入口（U3） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {/* 头部：书架标签 + 导入备份 + 新建项目（E3 导入入口与新建并列——书架是书籍管理的自然宿主） */}
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs font-medium text-muted-foreground">书架</span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setImportOpen(true)}
              aria-label="导入备份"
              title="导入备份（zip）"
            >
              <Upload />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setCreateOpen(true)}
              aria-label="新建项目"
              title="新建项目"
            >
              <Plus />
            </Button>
          </div>
        </div>

        {/* 书架加载失败：错误 + 重试（layout.md §3.2 错误呈现） */}
        {bookshelfError !== null && (
          <div className="flex flex-col items-start gap-1 px-1 py-2">
            <p className="text-xs text-muted-foreground">
              {bookshelfError === CLIENT_NETWORK_ERROR ? "无法连接服务" : "书架加载失败"}
            </p>
            <Button variant="ghost" size="xs" onClick={() => void loadBookshelf()}>
              重试
            </Button>
          </div>
        )}

        {/* 首次加载骨架 */}
        {bookshelfLoading && bookshelf === null && (
          <div className="space-y-1 px-1 py-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        )}

        {/* 空书架 */}
        {bookshelfError === null && !bookshelfLoading && bookshelf && bookshelf.books.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground/70">还没有书，先创建一本</p>
        )}

        {/* 项目列表（点击行打开；chevron 展开会话；无项目打开时照常展示可点击） */}
        {bookshelfError === null && bookshelf && bookshelf.books.length > 0 && (
          <ul className="space-y-0.5">
            {bookshelf.books.map((book) => {
              const expanded = expandedPath === book.path;
              // 当前项目高亮：config.id 与书无直接映射（open 响应无 path 字段），
              // MVP 用书名匹配（创建时书名 = 目录名 = config.name；改名后高亮失效，可接受）
              const isCurrent = config !== null && book.name === config.name;
              return (
                <li key={book.path}>
                  <div className="flex items-center">
                    <button
                      type="button"
                      title={`打开《${book.name}》`}
                      onClick={() => void handleOpenBook(book.path)}
                      className={cn(
                        "flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-left text-sm transition-colors",
                        isCurrent
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <BookOpen className={cn("size-3.5 shrink-0", isCurrent ? "text-primary" : "text-muted-foreground/60")} />
                      <span className="min-w-0 flex-1 truncate">{book.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/60" title={formatTimestamp(book.updatedAt)}>
                        {formatShortTimestamp(book.updatedAt)}
                      </span>
                    </button>
                    {/* 导出备份（E3）：仅当前项目行渲染——「导出当前项目」语义；无项目打开时无入口 */}
                    {isCurrent && (
                      <button
                        type="button"
                        onClick={() => void handleExportBook(book.name)}
                        disabled={exporting}
                        aria-label={`导出《${book.name}》备份`}
                        title="导出备份（zip）"
                        className="flex h-8 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                      >
                        {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedPath((cur) => (cur === book.path ? null : book.path))}
                      aria-expanded={expanded}
                      aria-label={expanded ? `收起《${book.name}》会话` : `展开《${book.name}》会话`}
                      className="flex h-8 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <ChevronRight className={cn("size-4 transition-transform duration-200", expanded && "rotate-90")} />
                    </button>
                  </div>
                  {expanded && <SessionList />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 底部区：设置入口 + 主题切换（layout.md §2.3） */}
      <div className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
        <a
          href="#/settings"
          className="flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="size-4 shrink-0" />
          <span className="truncate">设置</span>
        </a>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-muted-foreground"
          onClick={toggleTheme}
          aria-label="切换主题"
        >
          {theme === "dark" ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
          <span className="truncate">{theme === "dark" ? "浅色模式" : "深色模式"}</span>
        </Button>
      </div>

      {/* 新建项目 Dialog（与引导页表单等效：书名 → createProjectAt） */}
      <Dialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) setCreateError(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>创建于 创作根/books/书名/ 目录，创建后自动打开</DialogDescription>
          </DialogHeader>
          <form id="create-book-form" onSubmit={handleCreateBook} className="flex flex-col gap-3">
            <Input
              value={bookName}
              onChange={(e) => setBookName(e.target.value)}
              placeholder="书名"
              maxLength={60}
              disabled={creating}
            />
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setCreateOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button type="submit" form="create-book-form" disabled={creating}>
              {creating ? "创建中…" : "创建并打开"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导入备份 Dialog（E3：选 zip + 书名 → 导入为新书，不自动打开；失败内联显示保持打开可重试） */}
      <Dialog
        open={importOpen}
        onOpenChange={(v) => {
          setImportOpen(v);
          if (!v) {
            setImportError(null);
            setImportFile(null);
            setImportName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>导入书籍</DialogTitle>
            <DialogDescription>从备份 zip 导入为新书，数据原样恢复；导入后从书架打开</DialogDescription>
          </DialogHeader>
          <form id="import-book-form" onSubmit={handleImportSubmit} className="flex flex-col gap-3">
            {/* 文件选择（accept zip；token 类样式，layout.md §3；file: 变体美化原生按钮） */}
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={handleImportFileChange}
              disabled={importing}
              aria-label="选择备份文件"
              className="block w-full cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:text-muted-foreground disabled:opacity-50"
            />
            <Input
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder="书名（默认取文件名）"
              maxLength={60}
              disabled={importing}
            />
            {importError && <p className="text-sm text-destructive">{importError}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setImportOpen(false)} disabled={importing}>
              取消
            </Button>
            <Button type="submit" form="import-book-form" disabled={importing || importFile === null}>
              {importing ? "导入中…" : "导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
