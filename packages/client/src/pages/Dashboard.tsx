// 书架主页 + 项目概览两形态（拆分；mode prop 路由分发，main.tsx：`#/` → home、`#/overview` → overview）
// - home（书架主页 `#/`）：书架卡——书籍列表（行点击打开/当前书高亮；当前书「继续创作」跳概览）+
//   新建（折叠/空书架主表单）+ 打开其他路径（折叠）+ 错误/加载/空态四态；打开/新建成功 → 跳 #/overview
// - overview（`#/overview`）：项目概览四区块——项目信息（config）/ 创作要素（×4 并行 total）/
//   大纲概览（递归统计卷章场 + 最近更新）/ 最近会话（chat store 前 5 条）；无项目 → 回书架引导卡
// 交互：阅读进度/去大纲 → #/outline 并定位节点（ui store focusOutlineNodeId 跨页传参）；
// 会话行 → chat store setCurrentSession(id)（右栏恢复会话）；[开始新对话] → setCurrentSession(null)
// 错误/加载/空态按：区块级骨架、区块内「加载失败 [重试]」、空态一句说明 + 主操作
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { formatRelativeTime } from "@whispering233/ai-editor-shared";
import type { EntityType, OutlineNode } from "@whispering233/ai-editor-shared";
import {
  BookOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  LoadingOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Button, Input, Typography } from "antd";
import type { InputRef } from "antd";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionCard } from "@/components/ui/section-card";
import { TypeChip } from "@/components/ui/tag-chip";
import { DecomposeDialog } from "@/components/decompose/decompose-dialog";
import { BookDeleteDialog } from "@/components/shelf/book-delete-dialog";
import type { BookDeleteTarget } from "@/components/shelf/book-delete-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { skeletonClass } from "@/lib/styles";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  exportProjectZip,
  importProjectZip,
  listEntities,
  renameProject,
} from "../lib/api";
import { describeExportError, describeImportError } from "../lib/error-messages";
import { describeJobStatus, formatShelfBadge, isTerminalJobStatus } from "../lib/decompose";
import { validateBookName } from "../lib/book-name";
import { groupShelfBooks, isCurrentBook } from "../lib/shelf";
import { entityListHost } from "../lib/entity-paths";
import { describeOpenError } from "../lib/error-messages";
import { desktopBridge } from "../lib/desktop";
import { cn } from "../lib/utils";
import { navigate } from "../hooks/use-route";
import { buildBookPath, findOutlineNodeTitle, useProjectStore } from "../stores/project";
import { useChatStore } from "../stores/chat";
import { useCloudStore } from "../stores/cloud";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useDecomposeJob } from "../hooks/use-decompose-job";
import { useUiStore } from "../stores/ui";

/** 创作要素卡类型中文名（与 EntityList 本地映射一致；四卡顺序 = 统计请求顺序） */
const TYPE_LABEL: Record<EntityType, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  // C1 类型补全（event 时间轴事件；概览卡仍为四卡，时间轴专属 UI 由 C2 实现）
  event: "事件",
  // G2.3 类型补全（G2 时间标签点；概览卡仍为四卡——时间点无独立统计卡）
  timepoint: "时间点",
  // 参考资料 reference
  reference: "参考资料",
};
const ENTITY_ORDER: EntityType[] = ["character", "setting", "location", "hook"];

/** 大纲概览统计结果（「信息层级」：无现成汇总字段，前端自算） */
interface OutlineSummary {
  volumes: number;
  chapters: number;
  scenes: number;
  /** 树中最大 updatedAt（ISO 字符串字典序比较，时间格式统一由应用层保证）；空树 → null */
  updatedAt: string | null;
}

/** 递归统计大纲树：卷/章/场景计数 + 最近更新（树最大 updatedAt） */
function summarizeOutline(nodes: OutlineNode[]): OutlineSummary {
  const acc: OutlineSummary = { volumes: 0, chapters: 0, scenes: 0, updatedAt: null };
  const walk = (list: OutlineNode[]): void => {
    for (const n of list) {
      if (n.type === "volume") acc.volumes += 1;
      else if (n.type === "chapter") acc.chapters += 1;
      else acc.scenes += 1;
      if (acc.updatedAt === null || n.updatedAt > acc.updatedAt) acc.updatedAt = n.updatedAt;
      if (n.type !== "scene" && n.children) walk(n.children);
    }
  };
  walk(nodes);
  return acc;
}

/** 从任意错误提取错误码（ApiError → 服务端/客户端码；未知 → null 走兜底文案） */
function openErrorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/** 页面形态：home = 书架主页（#/）；overview = 项目概览（#/overview） */
export type DashboardMode = "home" | "overview";

export default function Dashboard({ mode }: { mode: DashboardMode }) {
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const outline = useProjectStore((s) => s.outline);
  const outlineLoading = useProjectStore((s) => s.outlineLoading);
  const loadOutline = useProjectStore((s) => s.loadOutline);
  // 书架用于 rootPath（buildBookPath）+ 引导卡书籍列表（S13.4：有书时列出可打开）；
  // 左栏 Sidebar 书架树与左栏 store 同源数据
  const bookshelf = useProjectStore((s) => s.bookshelf);
  const bookshelfLoading = useProjectStore((s) => s.bookshelfLoading);
  const bookshelfError = useProjectStore((s) => s.bookshelfError);
  const loadBookshelf = useProjectStore((s) => s.loadBookshelf);
  const openProjectAt = useProjectStore((s) => s.openProjectAt);
  const createProjectAt = useProjectStore((s) => s.createProjectAt);
  // 会话（chat store 已按项目联动加载：切项目自动重载，本页仅补拉与消费）
  const sessions = useChatStore((s) => s.sessions);
  const sessionsLoading = useChatStore((s) => s.sessionsLoading);
  const sessionsError = useChatStore((s) => s.sessionsError);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const setCurrentSession = useChatStore((s) => s.setCurrentSession);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  // 跨页定位（方案 A）：点击阅读进度/去大纲 → 设置 transient 目标后跳 #/outline，Outline 页消费
  const setFocusOutlineNode = useUiStore((s) => s.setFocusOutlineNode);
  // 当前项目的拆解 job（卡 21.9）：概览卡「拆解任务」+ 书架当前书行「拆解中 N/M」徽标共用同一份轮询
  // （参数 = 项目 id：未打开书不发请求，切书立即重拉并清掉上一本的状态；终态停止轮询见 use-decompose-job）
  const { job: decomposeJob } = useDecomposeJob(config?.id ?? null);

  // 引导表单状态
  const [bookName, setBookName] = useState("");
  const [bookError, setBookError] = useState<string | null>(null);
  /** 有书形态下书籍点击打开失败的行内错误（S13.4；describeOpenError 映射，同 pathError 模式） */
  const [bookOpenError, setBookOpenError] = useState<string | null>(null);
  /** 有书形态「新建一本…」折叠表单展开态 */
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showPathForm, setShowPathForm] = useState(false);
  const [path, setPath] = useState("");
  // 桌面版能力桥（浏览器形态为 null → 「浏览…」按钮不渲染；每次渲染取值，桥是无状态对象）
  const bridge = desktopBridge();
  const [pathError, setPathError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 导入备份（Sidebar 独有能力搬入书架主页——zip + 书名，同名二选一冲突态）
  const [importOpen, setImportOpen] = useState(false);
  // 拆解小说（卡 21.8）：三态对话框（选文件 → 预览 → 填名开始），入口在「新建一本…」行
  const [decomposeOpen, setDecomposeOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importName, setImportName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importConflict, setImportConflict] = useState(false);
  const [importConflictBase, setImportConflictBase] = useState("");
  // 导出当前项目备份进行态（防连点）
  const [exporting, setExporting] = useState(false);
  // 删书确认框（卡 23.5）：非 null = 打开；目标恒带项目 id（删的是不是当前书按 id 判定）
  const [deleteTarget, setDeleteTarget] = useState<BookDeleteTarget | null>(null);
  // 当前书行内重命名（仅当前打开书；行内输入态，Enter/失焦提交、Esc 取消）
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamingSubmitting, setRenamingSubmitting] = useState(false);
  const renameInputRef = useRef<InputRef>(null);

  // 创作要素统计状态（四类型并行；任一失败 → 区块内「加载失败 [重试]」，不阻塞其他区块）
  const [entityCounts, setEntityCounts] = useState<Partial<Record<EntityType, number>> | null>(
    null,
  );
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entitiesError, setEntitiesError] = useState<string | null>(null);
  const [entitiesTick, setEntitiesTick] = useState(0);

  // 大纲概览：outline 已在 project store（openProjectAt 会加载）；未加载则补拉，
  // 失败用本地 attempted 标记呈现「加载失败 [重试]」（store 的 loadOutline 静默吞错）
  const [outlineAttempted, setOutlineAttempted] = useState(false);

  const noProject = config === null && !configLoading;
  const outlineSummary = outline ? summarizeOutline(outline.children) : null;
  // 阅读进度标题（id→title 映射；outline 未加载时回退 id 占位，与 InfoBar 同语义）
  const positionTitle =
    config?.currentPosition != null
      ? (findOutlineNodeTitle(outline, config.currentPosition) ?? config.currentPosition)
      : null;

  // 书架加载（home 常驻：无项目与已打开项目均需展示书架列表；失败由 bookshelfError 呈现 + 重试）
  useEffect(() => {
    if (mode === "home" && !bookshelfLoading && bookshelf === null && bookshelfError === null) {
      void loadBookshelf();
    }
  }, [mode, bookshelfLoading, bookshelf, bookshelfError, loadBookshelf]);

  // 项目切换（同页不卸载场景：Sidebar 开新项目）时重置大纲加载标记，使新项目树重新拉取（overview 专属）
  useEffect(() => {
    if (mode !== "overview") return;
    setOutlineAttempted(false);
  }, [mode, config?.id]);

  // 数据变更信号（问题 1）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉各区块（overview 专属）
  useDataRefresh(() => {
    if (mode !== "overview") return;
    setEntitiesTick((t) => t + 1);
    void loadOutline();
    void loadSessions();
  });

  // 项目切换同样清除书籍打开错误（防下次进入引导形态时残留上次失败文案）
  useEffect(() => {
    setBookOpenError(null);
  }, [config?.id]);

  // 概览态：大纲树未加载则补拉（outlineLoading 由 store 管理；attempted 防重复）
  // mode 必须在依赖里：`#/` → `#/overview` 是同实例改 prop（useEnterLastBook 自动进书），
  // 漏了它本 effect 就不再跑，概览进度节点只剩原始 id、大纲概览永远骨架
  useEffect(() => {
    if (mode !== "overview" || config === null) return;
    if (outline === null && !outlineLoading && !outlineAttempted) {
      setOutlineAttempted(true);
      void loadOutline();
    }
  }, [mode, config, outline, outlineLoading, outlineAttempted, loadOutline]);

  // 概览态：创作要素四类型并行统计（limit=1 仅取 total，「各取 total」）；
  // entitiesTick 变化 = 区块内重试；任一失败记录 entitiesError，成功类型照常展示
  useEffect(() => {
    if (mode !== "overview" || config === null) return;
    let cancelled = false;
    setEntityCounts(null);
    setEntitiesLoading(true);
    setEntitiesError(null);
    Promise.allSettled(
      ENTITY_ORDER.map(async (type) => ({
        type,
        total: (await listEntities(type, { limit: 1 })).total,
      })),
    ).then((results) => {
      if (cancelled) return;
      const counts: Partial<Record<EntityType, number>> = {};
      let failed = false;
      for (const r of results) {
        if (r.status === "fulfilled") counts[r.value.type] = r.value.total;
        else failed = true;
      }
      setEntityCounts(counts);
      setEntitiesError(failed ? "要素统计加载失败" : null);
      setEntitiesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, config, entitiesTick]);

  // 概览态：会话列表补拉（chat store 订阅项目切换已自动加载；此处兜底「未尝试过」的场景）
  useEffect(() => {
    if (mode !== "overview" || config === null) return;
    if (sessions === null && !sessionsLoading && sessionsError === null) {
      void loadSessions();
    }
  }, [mode, config, sessions, sessionsLoading, sessionsError, loadSessions]);

  /** 新建书籍：书名 → 创作根/books/<书名>/，create（不打开）→ open 进入新书（config 就绪后本页切概览形态） */
  async function handleCreateBook(e: FormEvent) {
    e.preventDefault();
    const name = bookName.trim();
    // 书名校验复用 lib/book-name（与 Sidebar 新建/导入同款规则——L3 防路径逃逸，错误文案直接用于内联提示）
    const nameError = validateBookName(name);
    if (nameError !== null) {
      setBookError(nameError);
      return;
    }
    if (!bookshelf) {
      setBookError("书架未加载，请稍后重试");
      return;
    }
    setSubmitting(true);
    setBookError(null);
    try {
      await createProjectAt(buildBookPath(bookshelf.rootPath, name), { name, language: "zh" });
      // 成功后刷新书架（新书出现在左栏树）；config 已由 openProjectAt 刷新 → 本页切概览形态
      await loadBookshelf();
      // L4（oracle U4 审核）：与 Sidebar 新建同款提示
      useUiStore.getState().showToast(`已创建并打开《${name}》`);
      setBookName("");
      navigate("/overview");
    } catch (err) {
      setBookError(describeOpenError(openErrorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  /** 打开其他路径（S1.4 保留能力；绝对路径 openProjectAt） */
  async function handleOpenPath(e: FormEvent) {
    e.preventDefault();
    if (!path.trim()) {
      setPathError("请输入项目目录路径（绝对路径）");
      return;
    }
    setSubmitting(true);
    setPathError(null);
    try {
      await openProjectAt(path.trim());
      navigate("/overview");
    } catch (err) {
      setPathError(describeOpenError(openErrorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  /** 打开书籍（书架行；openProjectAt → 成功跳概览；失败行内展示 describeOpenError（页内行内文案） */
  async function handleOpenBook(path: string) {
    setBookOpenError(null);
    try {
      await openProjectAt(path);
      navigate("/overview");
    } catch (err) {
      setBookOpenError(describeOpenError(openErrorCode(err)));
    }
  }

  /** 桌面版「浏览…」：原生选目录 → 直接以该路径打开（取消则不动任何状态） */
  async function handleBrowse() {
    if (bridge === null || submitting) return;
    setPathError(null);
    const picked = await bridge.pickDirectory();
    if (picked === null) return;
    setPath(picked);
    setSubmitting(true);
    try {
      await openProjectAt(picked);
      navigate("/overview");
    } catch (err) {
      setPathError(describeOpenError(openErrorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  // ============ 书架行能力（Sidebar 迁入） ============

  /** 导出当前项目备份（GET /project/export zip → 临时 <a> 下载）；exporting 防连点 */
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
      // 延迟到下一帧 revoke（ora-1：旧版 Safari 下载前 revoke 中断竞态防御）
      setTimeout(() => URL.revokeObjectURL(url), 0);
      useUiStore.getState().showToast(`已导出《${name}》备份`);
    } catch (err) {
      useUiStore
        .getState()
        .showToast(
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

  /** 导入同名冲突评估（B2：同名不再 409，前端二选一；预填 `<名> (2)` 可编辑；
   * 粘性冲突态直到明确选择/改名；预填导致的 onChange 不退出冲突态） */
  function evaluateImportConflict(next: string) {
    const trimmed = next.trim();
    const isBookName = (name: string) => bookshelf?.books.some((b) => b.name === name) ?? false;
    if (importConflict) {
      if (
        trimmed === `${importConflictBase} (2)` ||
        (trimmed === importConflictBase && isBookName(trimmed))
      ) {
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

  function handleImportNameChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setImportName(next);
    evaluateImportConflict(next);
  }

  function handleImportFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImportFile(file);
    setImportError(null);
    // 不把 zip 文件名预填为书名：备份命名是 `<时间戳>-<自动|手动>-<设备>-人物N-设定N-章N.zip`，
    // 拿它当书名会把一整串元信息写进目录名与 project.json。书名留空 = 服务端用备份内的书名。
  }

  /** 导入提交（普通 = 当前输入名；冲突态 = 基础名「保持原样」/ 编辑名「重命名导入」）；
   * restored/new 分流 toast；失败内联保持打开可重试 */
  async function handleImportSubmit(name: string, e?: FormEvent) {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!importFile) {
      setImportError("请选择备份文件");
      return;
    }
    // 留空 = 用备份内的书名（服务端以备份 project.json 为准）；填了才做本地预校验
    if (trimmed !== "") {
      const err = validateBookName(trimmed);
      if (err !== null) {
        setImportError(err);
        return;
      }
    }
    setImporting(true);
    setImportError(null);
    try {
      const res = await importProjectZip(importFile, trimmed);
      useUiStore
        .getState()
        .showToast(
          res.mode === "restored" ? `已恢复备份《${res.name}》` : `已导入为新书《${res.name}》`,
        );
      await loadBookshelf();
      closeImportDialog();
    } catch (err) {
      const text = describeImportError(
        err instanceof ApiError ? err.code : null,
        err instanceof ApiError ? err.message : "导入失败，请重试",
      );
      setImportError(text);
      // 兜底反馈（ora-1）：中途关闭后内联错误不可见，toast 保证失败必有反馈
      if (text !== "") useUiStore.getState().showToast(text, "error");
    } finally {
      setImporting(false);
    }
  }

  function closeImportDialog() {
    setImportOpen(false);
    setImportError(null);
    setImportFile(null);
    setImportName("");
    setImportConflict(false);
    setImportConflictBase("");
  }

  function cancelRename() {
    setRenaming(false);
    setRenameValue("");
    setRenameError(null);
  }

  /** 行内重命名提交（Enter/失焦）：POST /project/rename → 刷新书架 + config；
   * 409 PROJECT_ALREADY_EXISTS → 行内错误不关输入态；值未变化直接退出 */
  async function handleRenameSubmit() {
    if (!renaming || renamingSubmitting) return;
    const name = renameValue.trim();
    if (name === useProjectStore.getState().config?.name) {
      cancelRename();
      return;
    }
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
      const code: string | null = err instanceof ApiError ? err.code : null;
      if (code === "PROJECT_ALREADY_EXISTS") {
        setRenameError("书架已有同名书籍，请换一个名字");
      } else if (err instanceof ApiError && err.code !== CLIENT_NETWORK_ERROR) {
        setRenameError(err.message);
      } else {
        setRenameError("无法连接服务，请确认 ai-editor 服务已启动");
      }
    } finally {
      setRenamingSubmitting(false);
    }
  }

  /** 删除成功后由书架页收敛（对话框回调）：刷新书架；删的是当前书 → 回书架并清项目/云端镜像 */
  async function handleBookDeleted(target: BookDeleteTarget) {
    await loadBookshelf();
    if (config === null || target.id !== config.id) return; // 删非当前书：只刷新书架
    // 删的是当前书：服务端已关连接 + 清 currentProject + 抹 lastProject，这里再走一次 store 的
    // closeProject 是幂等调用（无项目时服务端仍回 saved:true），作用 = **清空客户端镜像**
    //（config / outline / agents → null，下游 AppShell 的云端状态与拆解轮询随之收敛）
    useCloudStore.getState().clearStatus();
    try {
      await useProjectStore.getState().closeProject();
    } catch {
      // 网络层失败：书架区已有「加载失败 + 重试」入口，刷新后收敛（不另造第二套镜像清理）
    }
    navigate("/");
  }

  /** 开始行内重命名（当前书条输入态；autoFocus 后失焦守卫：挂载即失焦不误退） */
  function startRename() {
    setRenameValue(config?.name ?? "");
    setRenameError(null);
    setRenaming(true);
    window.setTimeout(() => renameInputRef.current?.focus(), 0);
  }

  /** 跳大纲并定位阅读进度节点（阅读进度未设置时仅跳转；「操作流」） */
  function goOutline() {
    if (config?.currentPosition != null) setFocusOutlineNode(config.currentPosition);
  }

  // ============ 加载态（config 拉取中：未判定形态前不渲染引导/概览） ============
  if (configLoading) {
    return (
      <section>
        <p className="mt-4 text-sm text-muted-foreground">加载中…</p>
      </section>
    );
  }

  // ============ 书架主页（mode=home，路由 #/） ============
  if (mode === "home") {
    const shelfLoading = bookshelf === null && bookshelfLoading;
    const shelfError = bookshelfError !== null;
    const shelfHasBooks = bookshelf !== null && bookshelf.books.length > 0;
    // 当前书在书架里的那一条（删除入口需要书目录绝对路径，走 isCurrentBook 同一判据）：
    // 用「打开其他路径」打开的项目不在 books/ 下，而删书只支持 books/ 直接子目录 → 这类项目不给
    // 删除入口（不给必然会 400 的死路按钮）；书架未加载时也拿不到路径（加载完即出现）
    const currentShelfBook = bookshelf?.books.find((b) => isCurrentBook(b, config)) ?? null;
    /** 新建表单（空书架主操作 / 有书折叠次级共用；错误与提交态由页面持有） */
    function renderCreateBookForm(className: string) {
      return (
        <form onSubmit={handleCreateBook} className={className}>
          <div className="flex gap-2">
            <Input
              value={bookName}
              onChange={(e) => setBookName(e.target.value)}
              placeholder="书名"
              maxLength={60}
              disabled={submitting}
            />
            <Button type="primary" htmlType="submit" disabled={submitting || bookshelf === null}>
              新建
            </Button>
          </div>
          {bookError && <p className="text-left text-sm text-destructive">{bookError}</p>}
        </form>
      );
    }

    return (
      <section className="mx-auto w-full max-w-2xl px-4">
        <PageHeader
          className="mt-8"
          title="书架"
          description={
            <p className="text-sm text-muted-foreground">
              {config !== null
                ? `当前打开《${config.name}》，切换书籍或继续创作`
                : "选择一本书打开，或新建一本"}
            </p>
          }
          action={
            /* 导入备份（Sidebar 迁入，1-3b）：zip 导入/覆盖恢复，Dialog 内同名二选一 */
            <Button className="shrink-0" onClick={() => setImportOpen(true)}>
              <UploadOutlined className="text-sm" />
              导入备份
            </Button>
          }
        />

        {bookshelfError !== null && (
          <div className="mt-4 rounded-md border border-border bg-card p-3">
            <p className="text-sm text-muted-foreground">
              {bookshelfError === CLIENT_NETWORK_ERROR
                ? "无法连接服务，请确认 ai-editor 服务已启动后重试。"
                : "书架加载失败，请重试。"}
            </p>
            <Button className="mt-2" onClick={() => void loadBookshelf()}>
              重试
            </Button>
          </div>
        )}

        <div className="mt-4 rounded-lg border border-dashed border-border bg-card px-6 py-6">
          {/* 当前打开书条：继续创作跳 #/overview；行内导出/重命名直显（红线） */}
          {config !== null && (
            <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <BookOutlined className="shrink-0 text-xl text-primary" />
                {renaming ? (
                  /* 重命名输入态：Enter/失焦提交、Esc 取消（div 而非 button——输入不可嵌交互元素） */
                  <div className="flex min-w-0 flex-1 items-center gap-2">
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
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{config.name}</p>
                    <p className="text-xs text-muted-foreground">已打开</p>
                  </div>
                )}
                {!renaming && (
                  <>
                    <Button
                      size="small"
                      className="shrink-0"
                      onClick={() => void handleExportBook(config.name)}
                      disabled={exporting}
                    >
                      {exporting ? (
                        <LoadingOutlined className="text-sm" spin />
                      ) : (
                        <DownloadOutlined className="text-sm" />
                      )}
                      导出
                    </Button>
                    <Button size="small" className="shrink-0" onClick={startRename}>
                      <EditOutlined className="text-sm" />
                      重命名
                    </Button>
                    {currentShelfBook !== null && (
                      <Button
                        size="small"
                        className="shrink-0"
                        onClick={() => setDeleteTarget(currentShelfBook)}
                      >
                        <DeleteOutlined className="text-sm" />
                        删除
                      </Button>
                    )}
                    <Button
                      type="primary"
                      size="small"
                      className="shrink-0"
                      onClick={() => navigate("/overview")}
                    >
                      继续创作
                    </Button>
                  </>
                )}
              </div>
              {renaming && renameError && (
                <p className="mt-1 text-sm text-destructive">{renameError}</p>
              )}
            </div>
          )}

          {shelfLoading ? (
            /* 加载中骨架（防「还没有书」误闪——bookshelf 未就绪前不渲染任何文案分支） */
            <div className="py-2">
              <div className={cn(skeletonClass, "mx-auto h-6 w-2/3")} />
              <div className={cn(skeletonClass, "mx-auto mt-2 h-4 w-1/2")} />
              <div className="mt-5 space-y-2">
                <div className={cn(skeletonClass, "h-10 rounded-lg")} />
                <div className={cn(skeletonClass, "h-10 rounded-lg")} />
              </div>
            </div>
          ) : shelfHasBooks ? (
            <>
              {/* 两组小标题（小说项目 / 小说拆解，卡 23.2）：组序 / 文案 = lib/shelf.ts 单一定义；
                  空组由 groupShelfBooks 丢弃（只有一类书时就是一张列表）；标题档 = DESIGN.md §书架主页 的 `section-title` */}
              {groupShelfBooks(bookshelf!.books).map((group) => (
                <div key={group.origin} className="mt-4 first:mt-0">
                  <Typography.Title level={5}>
                    {group.label} · {group.books.length}
                  </Typography.Title>
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {group.books.map((book) => {
                      // 当前书判定按**项目 id**（不是书名）：同名不同 id 并存时按 name 会高亮错书
                      //（纯函数 isCurrentBook，卡 23.5 收口；行为级用例见 lib/shelf.test.ts）
                      const isCurrent = isCurrentBook(book, config);
                      // 行容器 = div：行内既要有「打开」又要行尾垃圾桶，而 HTML 不允许按钮嵌套
                      // ——整行 <button> 包图标按钮是无效结构（点击冒泡成「打开」）
                      return (
                        <li key={book.path}>
                          <div
                            className={cn(
                              "flex w-full items-center gap-1 px-3 py-2.5 transition-colors hover:bg-muted",
                              // 当前打开的书：primary 淡染面（近白的 surface-muted 面在卡片白底上不可见）
                              isCurrent && "bg-primary/10 ring-1 ring-primary/30 ring-inset",
                            )}
                          >
                            <button
                              type="button"
                              title={
                                isCurrent ? `继续创作《${book.name}》` : `打开《${book.name}》`
                              }
                              onClick={() => {
                                if (isCurrent) navigate("/overview");
                                else void handleOpenBook(book.path);
                              }}
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            >
                              <BookOutlined className="shrink-0 text-base text-muted-foreground/60" />
                              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                {book.name}
                              </span>
                              {isCurrent && decomposeJob !== null && !isTerminalJobStatus(decomposeJob.status) && (
                                /* 书架行徽标（卡 21.9）：只服务**当前书**那行——GET /project/list 不含 job 状态，
                                   逐本开 data.db 不值得，且切书即暂停（DESIGN.md §拆解小说）。文案按状态：
                                   运行/待运行「拆解中 N/M」、已暂停「已暂停 N/M」（同一函数口径）。*/
                                <TypeChip className="shrink-0">{formatShelfBadge(decomposeJob)}</TypeChip>
                              )}
                              {isCurrent && (
                                <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                                  已打开
                                </span>
                              )}
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {formatRelativeTime(book.updatedAt)}
                              </span>
                            </button>
                            {/* 行尾垃圾桶（恒贴行尾；删除书不可恢复 → color="danger"，**不能**用 danger 糖：与 color+variant 同给时被忽略） */}
                            <Button
                              color="danger"
                              variant="text"
                              size="small"
                              className="shrink-0"
                              title="删除书籍"
                              aria-label="删除书籍"
                              icon={<DeleteOutlined />}
                              onClick={() => setDeleteTarget(book)}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {bookOpenError !== null && (
                <p className="mt-3 text-sm text-destructive">{bookOpenError}</p>
              )}
              <div className="mt-4 border-t border-border pt-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => setShowCreateForm((v) => !v)}
                  >
                    {showCreateForm ? "收起" : "新建一本…"}
                  </button>
                  {/* 拆解小说入口（卡 21.8）：导入式批量管线，不新增一级导航、不改左栏 */}
                  <Button onClick={() => setDecomposeOpen(true)}>拆解小说</Button>
                </div>
                {showCreateForm && renderCreateBookForm("mt-2 flex flex-col gap-2 text-left")}
              </div>
            </>
          ) : shelfError ? (
            /* 书架加载失败：卡内中性占位（错误块在上方提供重试；不显示「还没有书」误导） */
            <p className="py-6 text-center text-sm text-muted-foreground">
              书架加载失败，重试后可查看书籍或新建
            </p>
          ) : (
            /* 空书架：创建引导（「还没有书」仅此分支） */
            <>
              <p className="text-base font-semibold text-foreground">还没有书，先创建一本</p>
              <p className="mt-1 text-xs text-muted-foreground">
                每本书一个独立目录（books/书名/），写作数据互不干扰
              </p>
              {renderCreateBookForm("mx-auto mt-5 flex max-w-xs flex-col gap-2")}
              <p className="mt-2 text-center text-xs text-muted-foreground">
                创建于 创作根/books/书名/ 目录
              </p>
            </>
          )}

          {/* 打开其他路径（S1.4 保留能力，折叠；次级操作；不依赖书架，错误形态同样可用） */}
          <div className="mt-4 border-t border-border pt-3">
            <button
              type="button"
              className="rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setShowPathForm((v) => !v)}
            >
              {showPathForm ? "收起" : "打开其他路径…"}
            </button>
            {showPathForm && (
              <form onSubmit={handleOpenPath} className="mt-2 flex flex-col gap-2 text-left">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="/absolute/path/to/project（须含 project.json）"
                      disabled={submitting}
                    />
                  </div>
                  {/* 桌面版专属：原生目录选择框直接打开所选项目；浏览器形态无桥 → 不渲染 */}
                  {bridge !== null && (
                    <Button disabled={submitting} onClick={() => void handleBrowse()}>
                      浏览…
                    </Button>
                  )}
                </div>
                <div>
                  <Button htmlType="submit" disabled={submitting}>
                    打开
                  </Button>
                </div>
                {pathError && <p className="text-sm text-destructive">{pathError}</p>}
              </form>
            )}
          </div>
        </div>

        {/* 导入备份 Dialog（zip + 书名；同名二选一冲突态） */}
        <Dialog
          open={importOpen}
          onOpenChange={(v) => (v ? setImportOpen(true) : closeImportDialog())}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>导入书籍</DialogTitle>
              <DialogDescription>
                从备份 zip 导入；与书架已有书 id
                匹配时覆盖恢复，否则导入为新书（同名可重命名或保持原样并存）
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
                placeholder="书名（留空 = 使用备份里的书名）"
                maxLength={60}
                disabled={importing}
              />
              {importConflict && (
                <p className="text-sm text-primary">
                  书架已有同名书籍《{importConflictBase}
                  》——可重命名导入，或保持原样（服务端自动去重）
                </p>
              )}
              {importError && <p className="text-sm text-destructive">{importError}</p>}
            </form>
            <DialogFooter>
              <Button onClick={closeImportDialog} disabled={importing}>
                取消
              </Button>
              {importConflict ? (
                <>
                  <Button
                    onClick={() => void handleImportSubmit(importConflictBase)}
                    disabled={importing || importFile === null}
                  >
                    {importing ? "导入中…" : "保持原样导入"}
                  </Button>
                  <Button
                    type="primary"
                    onClick={() => void handleImportSubmit(importName)}
                    disabled={importing || importFile === null}
                  >
                    {importing ? "导入中…" : "重命名导入"}
                  </Button>
                </>
              ) : (
                <Button
                  type="primary"
                  htmlType="submit"
                  form="import-book-form"
                  disabled={importing || importFile === null}
                >
                  {importing ? "导入中…" : "导入"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 拆解小说对话框（三态：选文件 → 预览 → 填名开始） */}
        <DecomposeDialog open={decomposeOpen} onOpenChange={setDecomposeOpen} />

        {/* 删书确认框（行尾垃圾桶与当前书条「删除」共用同一实例；受控：deleteTarget） */}
        <BookDeleteDialog
          book={deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          onDeleted={(book) => void handleBookDeleted(book)}
        />
      </section>
    );
  }

  // ============ 项目概览（mode=overview，路由 #/overview；无项目 → 回书架引导卡） ============
  if (noProject) {
    return (
      <section className="mx-auto w-full max-w-xl px-4">
        <EmptyState
          padding="sm"
          className="mt-16"
          action={
            <Button href="#/" size="small">
              回到书架
            </Button>
          }
        >
          <span className="block text-base font-semibold text-foreground">还没有打开的书</span>
          <span className="mt-1 block">先到书架选择或创建一本</span>
        </EmptyState>
      </section>
    );
  }

  return (
    <section>
      <PageHeader title="项目概览" />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 区块 0：拆解任务（卡 21.9）——**有 job 时才渲染**（无 job 不渲染，不占位）；
            一行状态 + 进 #/decompose 的入口；状态文案与进度页同源（describeJobStatus） */}
        {decomposeJob !== null && (
          <SectionCard title="拆解任务" className="lg:col-span-2">
            <p className="text-sm text-foreground">{describeJobStatus(decomposeJob)}</p>
            <div className="mt-3">
              <Button href="#/decompose">查看进度</Button>
            </div>
          </SectionCard>
        )}

        {/* 区块 1：项目信息（数据 config，无失败态——项目已打开） */}
        <SectionCard title="项目信息">
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">名称</dt>
              <dd className="min-w-0 truncate font-medium text-foreground">{config?.name}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">语言</dt>
              <dd className="text-foreground">{config?.language === "zh" ? "中文" : "English"}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">阅读进度</dt>
              <dd className="min-w-0 flex-1 truncate">
                {config?.currentPosition != null ? (
                  <a href="#/outline" onClick={goOutline} className="text-primary hover:underline">
                    {positionTitle ?? config.currentPosition}
                  </a>
                ) : (
                  <span className="text-muted-foreground">未设置</span>
                )}
              </dd>
              <Button href="#/outline" onClick={goOutline} size="small">
                去大纲
              </Button>
            </div>
          </dl>
          {/* 项目提示词展示已移除：prompt 字段废弃不再返回——项目规则唯一事实源
              改为项目目录 AGENTS.md（设置页编辑，见 #/preferences） */}
        </SectionCard>

        {/* 区块 2：创作要素（四张计数卡；GET /entity/:type limit=1 取 total，并行） */}
        <SectionCard title="创作要素">
          {entitiesLoading && entityCounts === null ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={cn(skeletonClass, "h-20 rounded-lg")} />
              ))}
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {ENTITY_ORDER.map((t) => (
                  <a
                    key={t}
                    href={`#${entityListHost(t)}`}
                    className="group rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-muted"
                    title={`查看${TYPE_LABEL[t]}列表`}
                  >
                    <p className="text-xl font-semibold text-foreground">
                      {entityCounts?.[t] ?? "–"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                      {TYPE_LABEL[t]}
                    </p>
                  </a>
                ))}
              </div>
              {/* 单区块失败：区块内「加载失败 [重试]」，已成功的计数照常展示（不阻塞整体） */}
              {entitiesError !== null && (
                <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
                  {entitiesError}
                  <Button size="small" onClick={() => setEntitiesTick((t) => t + 1)}>
                    重试
                  </Button>
                </div>
              )}
            </>
          )}
        </SectionCard>

        {/* 区块 3：大纲概览（前端递归统计卷/章/场 + 最近更新 = 树最大 updatedAt） */}
        <SectionCard title="大纲概览" className="lg:col-span-2">
          {outline === null && (outlineLoading || !outlineAttempted) ? (
            /* 骨架：加载中或尚未尝试拉取（L2，oracle U4 审核：首帧不闪「加载失败」） */
            <div className="mt-3 space-y-2">
              <div className={cn(skeletonClass, "h-5 w-2/5")} />
              <div className={cn(skeletonClass, "h-4 w-1/3")} />
            </div>
          ) : outline === null ? (
            /* 加载失败（loadOutline 静默吞错，attempted 标记兜底呈现） */
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              大纲加载失败
              <Button size="small" onClick={() => setOutlineAttempted(false)}>
                重试
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-3 text-sm text-foreground">
                卷 {outlineSummary?.volumes ?? 0} · 章 {outlineSummary?.chapters ?? 0} · 场景{" "}
                {outlineSummary?.scenes ?? 0}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                最近更新:{" "}
                {outlineSummary?.updatedAt ? formatRelativeTime(outlineSummary.updatedAt) : "—"}
              </p>
              {outline.children.length === 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">大纲还是空的</p>
                  {/* M1（oracle U4 审核）：新项目空态（「空态」）——[先搭大纲] 主操作 +
                      [和 AI 聊聊设定] 次操作（setCurrentSession(null) 注入右栏新会话） */}
                  <Button size="small" onClick={() => setCurrentSession(null)}>
                    和 AI 聊聊设定
                  </Button>
                </div>
              )}
              <div className="mt-3">
                <Button href="#/outline" onClick={goOutline} size="small">
                  去大纲编辑
                </Button>
              </div>
            </>
          )}
        </SectionCard>

        {/* 区块 4：最近会话（chat store 前 5 条；点击 → 右栏恢复该会话） */}
        <SectionCard title="最近会话" className="lg:col-span-2">
          {sessions === null ? (
            sessionsError !== null ? (
              /* 加载失败：区块内重试（NO_PROJECT_OPEN 在概览形态不会出现，兜底走通用文案） */
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                会话加载失败
                <Button size="small" onClick={() => void loadSessions()}>
                  重试
                </Button>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className={cn(skeletonClass, "h-8 rounded-md")} />
                ))}
              </div>
            )
          ) : sessions.length === 0 ? (
            /* 空态：一句说明 + 主操作 */
            <div className="mt-3">
              <p className="text-sm text-muted-foreground">还没有会话，和 AI 聊聊设定吧</p>
              <Button className="mt-3" onClick={() => setCurrentSession(null)}>
                开始新对话
              </Button>
            </div>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                {sessions.slice(0, 5).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      title={s.lastMessage || "空会话"}
                      onClick={() => setCurrentSession(s.id)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted",
                        // 当前会话：primary 淡染面（同上）
                        currentSessionId === s.id && "bg-primary/10 ring-1 ring-primary/30 ring-inset",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {s.lastMessage || "（空会话）"}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {s.messageCount} 条消息
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(s.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Button onClick={() => setCurrentSession(null)}>开始新对话</Button>
              </div>
            </>
          )}
        </SectionCard>
      </div>
    </section>
  );
}
