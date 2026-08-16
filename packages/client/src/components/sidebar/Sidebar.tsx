// 左栏 Sidebar（doc/ui/layout.md §2.3）：产品标识 + 书架（项目→会话二级树）+ 底部设置/主题切换
// U3 实现：书架树——bookshelf 列表（挂载即拉取，与 config 无关，无项目时照常展示）；
//   点击项目行 openProjectAt（当前项目 name 匹配高亮）；chevron 单展开会话列表（归属项目，决策 22，
//   展开时 chat store 自动 loadSessions）；书架头部 [+ 新建项目] 行内输入（UX2：bookshelf.rootPath +
//   buildBookPath）；主题切换用 use-theme hook（layout.md §3.4 Sun/Moon，localStorage 持久化）
// E3 导出/导入（release-review §二「数据主权归用户」载体）：
//   - 书架头部行 [+ 导入备份]（Upload，zip 恢复为新书，导入不自动打开 → 刷新书架）；
//   - 当前项目行尾部 [导出备份]（Download，点击即下载 zip；无项目打开时不渲染——「导出当前项目」语义）
// B2（决策 27）：
//   - 导入同名二选一：书名与书架已有书同名 → Dialog 内联冲突提示 + [重命名导入]（Input 可编辑，
//     预填 `<名> (2)`）/ [保持原样导入]（服务端目录自动去重）；响应 mode 分流 toast（restored/new）
//   - 项目行 [重命名] 图标按钮：仅当前项目行渲染（H3：直接展示，不收进 ⋯ 菜单）；点击 → 行内输入框
//     （预填当前名，Enter/失焦提交 POST /project/rename，Esc 取消）；成功刷新书架 + config；
//     409 PROJECT_ALREADY_EXISTS → 行内内联错误（不关闭输入态）
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  BookOpen,
  ChevronRight,
  Download,
  Loader2,
  MessageSquare,
  Moon,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { formatRelativeTime, formatTimestamp } from "@whispering233/ai-editor-shared";
import { useTheme } from "../../hooks/use-theme";
import { SIDEBAR_MIN_WIDTH } from "../../hooks/use-panels";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  exportProjectZip,
  importProjectZip,
  renameProject,
} from "../../lib/api";
import { describeExportError, describeImportError, describeOpenError } from "../../lib/error-messages";
import { cn } from "../../lib/utils";
import { validateBookName } from "../../lib/book-name";
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
          <Button variant="outline" size="xs" className="mt-0.5" onClick={() => void loadSessions()}>
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

export function Sidebar({
  width,
  onToggleCollapse,
}: {
  /** 桌面态像素宽度（flex-basis 覆盖默认 10%）；undefined = 小屏默认百分比布局 */
  width?: number;
  /** 收起左栏回调（F7：桌面态由 AppShell 传入；小屏无收起能力，不传即不渲染按钮） */
  onToggleCollapse?: () => void;
}) {
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
  // 新建项目行内输入（UX2：书架头部「＋」展开单字段输入；状态仅行内使用）
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
  // 导入同名冲突（B2，决策 27）：书名与书架已有书同名时进入冲突态——
  // importConflictBase = 冲突基础名（「保持原样导入」提交它；服务端目录自动去重）
  const [importConflict, setImportConflict] = useState(false);
  const [importConflictBase, setImportConflictBase] = useState("");
  // 导出备份进行态（当前项目行下载按钮；exporting 防连点）
  const [exporting, setExporting] = useState(false);
  // 书架行 [重命名] 图标按钮（B2/H3）：行内输入框状态（仅当前项目行触发，按书 path 标记）
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamingSubmitting, setRenamingSubmitting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

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
      setRenamingPath(null); // 行内重命名同样只对「当前项目行」有效，切换即收敛
    }
  }, [projectId]);

  /** 取消行内新建（× 按钮 / Esc / 失焦共用）：清空输入与错误，防下次展开残留 */
  function cancelCreate() {
    setBookName("");
    setCreateError(null);
    setCreateOpen(false);
  }

  /** 新建项目（行内输入提交）：书名 → 创作根/books/<书名>/，create（不打开）→ open 进入新书 → toast + 刷新书架 + 展开新书行 */
  async function handleCreateBook(e: FormEvent) {
    e.preventDefault();
    const name = bookName.trim();
    // 书名校验（UX2 抽取：lib/book-name.validateBookName——L3 防路径逃逸规则，创建/导入共用）
    const err = validateBookName(name);
    if (err !== null) {
      setCreateError(err);
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

  /** 文件选择：书名预填为文件名去 .zip 扩展名（zip 未解析前拿不到 project.json 内部 name）；
   *  预填名与书架已有书同名 → 同步进入冲突态（B2，决策 27） */
  function handleImportFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImportFile(file);
    setImportError(null);
    if (file) {
      const suggested = file.name.replace(/\.zip$/i, "");
      const next = importName.trim() === "" ? suggested : importName;
      setImportName(next);
      evaluateImportConflict(next);
    }
  }

  /**
   * 导入同名冲突评估（B2，决策 27：同名 id 不同不再 409，改由前端二选一）：
   * - 非冲突态：输入名与书架已有书同名 → 进入冲突态（记录基础名 + 预填 `<名> (2)`，可编辑）
   * - 冲突态内（粘性，直到用户明确选择/改名）：
   *   · 值 = 预填名（重命名导入流程）或回改回基础名 → 保持冲突态
   *   · 编辑为另一冲突名 → 更新基础名并重新预填
   *   · 编辑为非冲突名 → 退出冲突态（回到普通导入）
   * 预填导致的 onChange（值 = 预填名）不会退出冲突态——「保持原样」入口不被预填破坏
   */
  function evaluateImportConflict(next: string) {
    const trimmed = next.trim();
    const isBookName = (name: string) => bookshelf?.books.some((b) => b.name === name) ?? false;
    if (importConflict) {
      if (trimmed === `${importConflictBase} (2)` || (trimmed === importConflictBase && isBookName(trimmed))) {
        return; // 预填名 / 回改基础名：保持冲突态
      }
      if (isBookName(trimmed)) {
        setImportConflictBase(trimmed);
        setImportName(`${trimmed} (2)`);
        return;
      }
      setImportConflict(false);
      setImportConflictBase("");
      return;
    }
    if (trimmed !== "" && isBookName(trimmed)) {
      setImportConflictBase(trimmed);
      setImportConflict(true);
      setImportName(`${trimmed} (2)`);
    }
  }

  /** 书名输入（编辑即重新评估冲突；空名不进入冲突态） */
  function handleImportNameChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setImportName(next);
    evaluateImportConflict(next);
  }

  /**
   * 导入备份（E3 + B2 决策 27）：multipart 上传 zip + 书名 → 服务端校验后原子搬入/覆盖 →
   * 刷新书架。书名由调用方传入（普通导入 = 当前输入名；冲突态二选一 = 基础名「保持原样」/ 编辑后新名
   * 「重命名导入」）；响应 mode 分流 toast——restored（id 匹配覆盖恢复）/ new（导入为新书，name 为
   * 服务端实际目录名，含自动去重）。导入不自动打开（与 create 一致）；失败内联显示保持打开可重试
   */
  async function handleImportSubmit(name: string, e?: FormEvent) {
    e?.preventDefault();
    const trimmed = name.trim();
    // 客户端预检（与服务端同规则，快速反馈；最终以服务端校验为准）
    if (!importFile) {
      setImportError("请选择备份文件");
      return;
    }
    // 书名校验与新建项目共用（UX2 抽取）
    const err = validateBookName(trimmed);
    if (err !== null) {
      setImportError(err);
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const res = await importProjectZip(importFile, trimmed);
      // 决策 27 分流提示（settings.md/layout.md §2.3：restored → 已恢复备份；new → 已导入为新书）
      useUiStore
        .getState()
        .showToast(res.mode === "restored" ? `已恢复备份《${res.name}》` : `已导入为新书《${res.name}》`);
      await loadBookshelf(); // 刷新书架让新书出现（失败由 bookshelfError 呈现）
      setImportOpen(false);
      setImportFile(null);
      setImportName("");
      setImportConflict(false);
      setImportConflictBase("");
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

  /** 打开行内重命名输入（菜单项点击）：预填当前书名；菜单关闭动画期间 Base UI 会把焦点还给 trigger，
   *  延迟到动画后聚焦输入框，避免刚挂载的输入被抢焦触发「失焦提交」误退出 */
  function startRename(book: { name: string; path: string }) {
    setRenamingPath(book.path);
    setRenameValue(book.name);
    setRenameError(null);
    window.setTimeout(() => renameInputRef.current?.focus(), 150);
  }

  /** 取消行内重命名（Esc / 成功 / 未变化）：清空输入与错误，防下次展开残留 */
  function cancelRename() {
    setRenamingPath(null);
    setRenameValue("");
    setRenameError(null);
  }

  /**
   * 行内重命名提交（Enter / 失焦）：POST /project/rename → 成功刷新书架 + config（name 变化驱动
   * 当前行高亮与 InfoBar 项目名）；409 PROJECT_ALREADY_EXISTS → 行内内联错误（不关闭输入态，可改名重试）；
   * 值未变化（含菜单关闭抢焦的误失焦）→ 直接退出不请求
   */
  async function handleRenameSubmit() {
    if (renamingPath === null || renamingSubmitting) return;
    const name = renameValue.trim();
    if (name === useProjectStore.getState().config?.name) {
      cancelRename();
      return;
    }
    // 书名校验与新建项目共用（UX2 抽取：禁路径分隔符/纯点/控制字符）
    const err = validateBookName(name);
    if (err !== null) {
      setRenameError(err);
      return;
    }
    setRenamingSubmitting(true);
    setRenameError(null);
    try {
      await renameProject(name);
      useUiStore.getState().showToast(`已重命名为《${name}》`);
      await Promise.all([loadBookshelf(), useProjectStore.getState().loadConfig()]);
      cancelRename();
    } catch (err) {
      // 服务端补充码 PROJECT_ALREADY_EXISTS 不在 shared ErrorCode 枚举，统一按 string 比较
      const code: string | null = err instanceof ApiError ? err.code : null;
      if (code === "PROJECT_ALREADY_EXISTS") {
        setRenameError("书架已有同名书籍，请换一个名字"); // 不关闭输入态
      } else if (err instanceof ApiError && err.code !== CLIENT_NETWORK_ERROR) {
        setRenameError(err.message); // VALIDATION_ERROR 等透传服务端 message
      } else {
        setRenameError("无法连接服务，请确认 ai-editor 服务已启动");
      }
    } finally {
      setRenamingSubmitting(false);
    }
  }

  return (
    <aside
      className="flex min-w-0 flex-[1_1_10%] flex-col border-r border-border bg-sidebar"
      style={width !== undefined ? { flex: `0 1 ${width}px`, minWidth: SIDEBAR_MIN_WIDTH } : undefined}
    >
      {/* 产品标识：衬线斜体（layout.md §3.3），点击回 #/；F7 起行右侧带收起左栏按钮（仅桌面态渲染） */}
      <div className="flex h-12 shrink-0 items-center border-b border-border">
        <a
          href="#/"
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-3 font-serif text-base italic text-foreground hover:text-primary"
        >
          <span className="text-primary">◈</span>
          <span className="truncate">我的小说</span>
        </a>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="收起左栏"
            title="收起左栏"
            className="mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      {/* 书架区：项目→会话二级树 + 新建项目入口（U3） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {/* 头部：书架标签 + 导入备份 + 新建项目（UX2：＋ 展开行内输入；展开态变 × 取消） */}
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
            {createOpen ? (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={cancelCreate}
                aria-label="取消新建项目"
                title="取消新建"
              >
                <X />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setCreateOpen(true)}
                aria-label="新建项目"
                title="新建项目"
              >
                <Plus />
              </Button>
            )}
          </div>
        </div>

        {/* 行内新建输入（UX2）：书架头部下方展开单字段书名输入——回车提交（复用 handleCreateBook 校验/路径安全/toast/刷新书架），
            Esc / × / 失焦取消。
            失焦策略选「失焦取消」：失焦提交会把误触（点书架其他行/导入按钮等）变成落盘建书的重操作，代价不可逆；
            失焦取消最坏只是丢掉已输入文本（可重输）——提交唯一入口为显式回车（含路径安全校验提示），不误触、
            且与 Esc 语义统一（都是「不创建」）。× 按钮存在时点它会先触发 input 失焦再触发 click——两条路径都走
            cancelCreate（幂等），不会误开/误建 */}
        {createOpen && (
          <form onSubmit={handleCreateBook} className="mb-1 flex flex-col gap-1 px-1" aria-label="新建项目">
            <Input
              value={bookName}
              onChange={(e) => setBookName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelCreate();
              }}
              onBlur={cancelCreate}
              placeholder="书名，回车创建"
              maxLength={60}
              disabled={creating}
              autoFocus
              aria-label="书名"
            />
            {createError && <p className="text-xs text-destructive">{createError}</p>}
          </form>
        )}

        {/* 书架加载失败：错误 + 重试（layout.md §3.2 错误呈现） */}
        {bookshelfError !== null && (
          <div className="flex flex-col items-start gap-1 px-1 py-2">
            <p className="text-xs text-muted-foreground">
              {bookshelfError === CLIENT_NETWORK_ERROR ? "无法连接服务" : "书架加载失败"}
            </p>
            <Button variant="outline" size="xs" onClick={() => void loadBookshelf()}>
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
              // MVP 用书名匹配（创建时书名 = 目录名 = config.name；改名后 loadConfig 刷新）
              const isCurrent = config !== null && book.name === config.name;
              const isRenaming = renamingPath === book.path;
              return (
                <li key={book.path}>
                  <div className="flex items-center">
                    {isRenaming ? (
                      /* 行内重命名输入（B2）：替换书名按钮区（div 而非 button——输入框不可嵌套交互元素）；
                          Enter/失焦提交 POST /project/rename，Esc 取消；输入框 flex-1 与书名同宽 */
                      <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-muted px-2">
                        <BookOpen className="size-3.5 shrink-0 text-primary" />
                        <Input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleRenameSubmit();
                            } else if (e.key === "Escape") {
                              cancelRename();
                            }
                          }}
                          onBlur={() => void handleRenameSubmit()}
                          maxLength={60}
                          disabled={renamingSubmitting}
                          aria-label="重命名书名"
                          className="h-6 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-sm focus-visible:ring-2"
                        />
                      </div>
                    ) : (
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
                    )}
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
                    {/* 重命名图标按钮（H3：直接展示，不收进 ⋯ 菜单；仅当前项目行渲染） */}
                    {isCurrent && (
                      <button
                        type="button"
                        aria-label={`重命名《${book.name}》`}
                        title="重命名"
                        onClick={() => startRename(book)}
                        className="flex h-8 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {/* 重命名行内错误（409 同名等：不关闭输入态，可改名重试） */}
                  {isRenaming && renameError && (
                    <p className="px-2 pb-1 text-xs text-destructive">{renameError}</p>
                  )}
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
          variant="outline"
          size="sm"
          className="justify-start text-muted-foreground"
          onClick={toggleTheme}
          aria-label="切换主题"
        >
          {theme === "dark" ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
          <span className="truncate">{theme === "dark" ? "浅色模式" : "深色模式"}</span>
        </Button>
      </div>

      {/* 导入备份 Dialog（E3：选 zip + 书名 → 导入为新书，不自动打开；失败内联显示保持打开可重试） */}
      <Dialog
        open={importOpen}
        onOpenChange={(v) => {
          setImportOpen(v);
          if (!v) {
            setImportError(null);
            setImportFile(null);
            setImportName("");
            setImportConflict(false);
            setImportConflictBase("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>导入书籍</DialogTitle>
            <DialogDescription>
              从备份 zip 导入；与书架已有书 id 匹配时覆盖恢复，否则导入为新书（同名可重命名或保持原样并存）
            </DialogDescription>
          </DialogHeader>
          <form
            id="import-book-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleImportSubmit(importName);
            }}
            className="flex flex-col gap-3"
          >
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
              onChange={handleImportNameChange}
              placeholder="书名（默认取文件名）"
              maxLength={60}
              disabled={importing}
            />
            {/* 同名冲突提示（B2，决策 27）：预填 `<名> (2)` 后可编辑；保持原样由服务端目录自动去重 */}
            {importConflict && (
              <p className="text-sm text-primary">
                书架已有同名书籍《{importConflictBase}》——可重命名导入，或保持原样（服务端自动去重）
              </p>
            )}
            {importError && <p className="text-sm text-destructive">{importError}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setImportOpen(false)} disabled={importing}>
              取消
            </Button>
            {importConflict ? (
              <>
                {/* 保持原样导入：不改名，服务端目录自动去重为 books/<书名> (N)/ */}
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => void handleImportSubmit(importConflictBase)}
                  disabled={importing || importFile === null}
                >
                  {importing ? "导入中…" : "保持原样导入"}
                </Button>
                {/* 重命名导入：提交当前 Input 值（已预填 `<名> (2)`，可编辑） */}
                <Button
                  type="button"
                  onClick={() => void handleImportSubmit(importName)}
                  disabled={importing || importFile === null}
                >
                  {importing ? "导入中…" : "重命名导入"}
                </Button>
              </>
            ) : (
              <Button type="submit" form="import-book-form" disabled={importing || importFile === null}>
                {importing ? "导入中…" : "导入"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
