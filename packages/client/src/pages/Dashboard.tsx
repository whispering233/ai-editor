// 概览页（U4，2026-08 修订版契约 doc/ui/pages/dashboard.md；S13.4 引导形态修复）：中栏默认 tab（#/）
// 两种形态：
//   - 引导形态（无项目，config === null && !configLoading）：按书架状态分派——**有书 → 卡内列出书籍
//     可直接打开**（+ 新建次级折叠 + 打开其他路径折叠）；空书架 → 创建引导（原样）；加载中 → 骨架
//     （防「还没有书」误闪）；加载失败 → 错误块 + 卡内中性占位。修复：书架有书未打开时不再显示误导性
//     「还没有书，先创建一本」（books 列表此前只展示在左栏 Sidebar，本页无条件渲染空态卡）
//   - 概览形态（项目已打开）：四个区块——项目信息（config）/ 创作要素（GET /entity/:type ×4 并行取 total）/
//     大纲概览（GET /outline 前端递归统计卷章场 + 最近更新）/ 最近会话（chat store 前 5 条，点击注入右栏）
// 交互：当前位置/去大纲 → #/outline 并定位节点（ui store focusOutlineNodeId，方案 A 跨页传参）；
//   会话行 → chat store setCurrentSession(id)（右栏恢复会话）；[开始新对话] → setCurrentSession(null)
// 错误/加载/空态按 layout.md §4.3：区块级骨架、区块内「加载失败 [重试]」、空态一句说明 + 主操作
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { formatRelativeTime } from "@whispering233/ai-editor-shared";
import type { EntityType, OutlineNode } from "@whispering233/ai-editor-shared";
import { BookOpen } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, CLIENT_NETWORK_ERROR, listEntities } from "../lib/api";
import { validateBookName } from "../lib/book-name";
import { describeOpenError } from "../lib/error-messages";
import { cn } from "../lib/utils";
import { buildBookPath, findOutlineNodeTitle, useProjectStore } from "../stores/project";
import { useChatStore } from "../stores/chat";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useUiStore } from "../stores/ui";

/** 创作要素卡类型中文名（与 EntityList 本地映射一致；四卡顺序 = 统计请求顺序） */
const TYPE_LABEL: Record<EntityType, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  // C1 类型补全（决策 26 event 时间轴事件；概览卡仍为四卡，时间轴专属 UI 由 C2 实现）
  event: "事件",
};
const ENTITY_ORDER: EntityType[] = ["character", "setting", "location", "hook"];

/** 大纲概览统计结果（dashboard.md「信息层级」：无现成汇总字段，前端自算） */
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

export default function Dashboard() {
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
  // 跨页定位（方案 A）：点击当前位置/去大纲 → 设置 transient 目标后跳 #/outline，Outline 页消费
  const setFocusOutlineNode = useUiStore((s) => s.setFocusOutlineNode);

  // 引导表单状态
  const [bookName, setBookName] = useState("");
  const [bookError, setBookError] = useState<string | null>(null);
  /** 有书形态下书籍点击打开失败的行内错误（S13.4；describeOpenError 映射，同 pathError 模式） */
  const [bookOpenError, setBookOpenError] = useState<string | null>(null);
  /** 有书形态「新建一本…」折叠表单展开态 */
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showPathForm, setShowPathForm] = useState(false);
  const [path, setPath] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 创作要素统计状态（四类型并行；任一失败 → 区块内「加载失败 [重试]」，不阻塞其他区块）
  const [entityCounts, setEntityCounts] = useState<Partial<Record<EntityType, number>> | null>(null);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entitiesError, setEntitiesError] = useState<string | null>(null);
  const [entitiesTick, setEntitiesTick] = useState(0);

  // 大纲概览：outline 已在 project store（openProjectAt 会加载）；未加载则补拉，
  // 失败用本地 attempted 标记呈现「加载失败 [重试]」（store 的 loadOutline 静默吞错）
  const [outlineAttempted, setOutlineAttempted] = useState(false);

  const noProject = config === null && !configLoading;
  const outlineSummary = outline ? summarizeOutline(outline.children) : null;
  // 当前位置标题（id→title 映射；outline 未加载时回退 id 占位，与 InfoBar 同语义）
  const positionTitle =
    config?.currentPosition != null
      ? (findOutlineNodeTitle(outline, config.currentPosition) ?? config.currentPosition)
      : null;

  // 无项目时自动加载书架（Sidebar 常驻也会加载，此处兜底；失败由 bookshelfError 呈现 + 重试）
  useEffect(() => {
    if (noProject && !bookshelfLoading && bookshelf === null && bookshelfError === null) {
      void loadBookshelf();
    }
  }, [noProject, bookshelfLoading, bookshelf, bookshelfError, loadBookshelf]);

  // 项目切换（同页不卸载场景：Sidebar 开新项目）时重置大纲加载标记，使新项目树重新拉取
  useEffect(() => {
    setOutlineAttempted(false);
  }, [config?.id]);

  // 数据变更信号（问题 1）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉各区块
  // （要素计数 + 大纲概览 + 最近会话；书架与 AI 无关不刷新；ref 守卫防首帧重复拉）
  useDataRefresh(() => {
    setEntitiesTick((t) => t + 1);
    void loadOutline();
    void loadSessions();
  });

  // 项目切换同样清除书籍打开错误（防下次进入引导形态时残留上次失败文案）
  useEffect(() => {
    setBookOpenError(null);
  }, [config?.id]);

  // 概览态：大纲树未加载则补拉（outlineLoading 由 store 管理；attempted 防重复）
  useEffect(() => {
    if (config === null) return;
    if (outline === null && !outlineLoading && !outlineAttempted) {
      setOutlineAttempted(true);
      void loadOutline();
    }
  }, [config, outline, outlineLoading, outlineAttempted, loadOutline]);

  // 概览态：创作要素四类型并行统计（limit=1 仅取 total，dashboard.md「各取 total」）；
  // entitiesTick 变化 = 区块内重试；任一失败记录 entitiesError，成功类型照常展示
  useEffect(() => {
    if (config === null) return;
    let cancelled = false;
    setEntityCounts(null);
    setEntitiesLoading(true);
    setEntitiesError(null);
    Promise.allSettled(
      ENTITY_ORDER.map(async (type) => ({ type, total: (await listEntities(type, { limit: 1 })).total })),
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
  }, [config, entitiesTick]);

  // 概览态：会话列表补拉（chat store 订阅项目切换已自动加载；此处兜底「未尝试过」的场景）
  useEffect(() => {
    if (config === null) return;
    if (sessions === null && !sessionsLoading && sessionsError === null) {
      void loadSessions();
    }
  }, [config, sessions, sessionsLoading, sessionsError, loadSessions]);

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
    } catch (err) {
      setPathError(describeOpenError(openErrorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  /** 打开书籍（S13.4 引导卡书籍行；openProjectAt → store 刷新 config/outline，本页切概览形态；
   * 失败行内展示 describeOpenError（同 handleOpenPath 模式——侧栏用 toast，页内表单区用行内） */
  async function handleOpenBook(path: string) {
    setBookOpenError(null);
    try {
      await openProjectAt(path);
    } catch (err) {
      setBookOpenError(describeOpenError(openErrorCode(err)));
    }
  }

  /** 跳大纲并定位当前位置节点（当前位置未设置时仅跳转；dashboard.md「操作流」） */
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

  // ============ 引导形态（无项目：按书架状态分派——有书列出书籍 / 空书架创建引导 / 加载中骨架 / 失败占位） ============
  if (noProject) {
    const shelfLoading = bookshelf === null && bookshelfLoading;
    const shelfError = bookshelfError !== null;
    const shelfHasBooks = bookshelf !== null && bookshelf.books.length > 0;

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
            <Button type="submit" disabled={submitting || bookshelf === null}>
              新建
            </Button>
          </div>
          {bookError && <p className="text-left text-sm text-destructive">{bookError}</p>}
        </form>
      );
    }

    return (
      <section>
        {bookshelfError !== null && (
          <div className="mx-auto mt-2 max-w-md rounded-md border border-border bg-card p-3">
            <p className="text-sm text-muted-foreground">
              {bookshelfError === CLIENT_NETWORK_ERROR
                ? "无法连接服务，请确认 ai-editor 服务已启动后重试。"
                : "书架加载失败，请重试。"}
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void loadBookshelf()} type="button">
              重试
            </Button>
          </div>
        )}

        <div className="mx-auto mt-10 max-w-md rounded-2xl border border-dashed border-border bg-card px-6 py-8 text-center">
          {shelfLoading ? (
            /* 加载中骨架（防「还没有书」误闪——bookshelf 未就绪前不渲染任何文案分支） */
            <div className="py-2">
              <div className="mx-auto h-6 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mx-auto mt-2 h-4 w-1/2 animate-pulse rounded bg-muted" />
              <div className="mt-5 space-y-2">
                <div className="h-10 animate-pulse rounded-lg bg-muted" />
                <div className="h-10 animate-pulse rounded-lg bg-muted" />
              </div>
            </div>
          ) : (
            <>
              {shelfHasBooks ? (
                /* 有书：卡内列出书籍（点击打开；「还没有书」语义仅剩空书架分支） */
                <>
                  <h1 className="font-serif text-lg text-foreground">书架里有书，打开即可写作</h1>
                  <p className="mt-1 text-xs text-muted-foreground">选择一本书打开，或新建一本</p>
                  <ul className="mt-5 divide-y divide-border overflow-hidden rounded-lg border border-border text-left">
                    {bookshelf.books.map((book) => (
                      <li key={book.path}>
                        <button
                          type="button"
                          title={`打开《${book.name}》`}
                          onClick={() => void handleOpenBook(book.path)}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted"
                        >
                          <BookOpen className="size-4 shrink-0 text-muted-foreground/60" />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{book.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatRelativeTime(book.updatedAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {bookOpenError !== null && <p className="mt-3 text-left text-sm text-destructive">{bookOpenError}</p>}
                  {/* 新建次级入口（折叠表单，不删创建能力） */}
                  <div className="mt-4 border-t border-border pt-3">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => setShowCreateForm((v) => !v)}
                    >
                      {showCreateForm ? "收起" : "新建一本…"}
                    </button>
                    {showCreateForm && renderCreateBookForm("mt-2 flex flex-col gap-2 text-left")}
                  </div>
                </>
              ) : shelfError ? (
                /* 书架加载失败：卡内中性占位（错误块在上方提供重试；不显示「还没有书」误导） */
                <p className="py-6 text-sm text-muted-foreground">
                  书架加载失败，重试后可查看书籍或新建
                </p>
              ) : (
                /* 空书架：创建引导（原样保留；「还没有书」仅此分支） */
                <>
                  <h1 className="font-serif text-lg text-foreground">还没有书，先创建一本</h1>
                  <p className="mt-1 text-xs text-muted-foreground">
                    每本书一个独立目录（books/书名/），写作数据互不干扰
                  </p>
                  {renderCreateBookForm("mx-auto mt-5 flex flex-col gap-2")}
                  <p className="mt-2 text-xs text-muted-foreground">创建于 创作根/books/书名/ 目录</p>
                </>
              )}

              {/* 打开其他路径（S1.4 保留能力，折叠；次级操作；不依赖书架，错误形态同样可用） */}
              <div className="mt-4 border-t border-border pt-3">
                <button
                  type="button"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setShowPathForm((v) => !v)}
                >
                  {showPathForm ? "收起" : "打开其他路径…"}
                </button>
                {showPathForm && (
                  <form onSubmit={handleOpenPath} className="mt-2 flex flex-col gap-2 text-left">
                    <Input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="/absolute/path/to/project（须含 project.json）"
                      disabled={submitting}
                    />
                    <div>
                      <Button type="submit" variant="outline" disabled={submitting}>
                        打开
                      </Button>
                    </div>
                    {pathError && <p className="text-sm text-destructive">{pathError}</p>}
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  // ============ 概览形态（项目已打开） ============
  return (
    <section>
      <div className="mb-4">
        <h1 className="font-serif text-xl font-medium text-foreground">项目概览</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 区块 1：项目信息（数据 config，无失败态——项目已打开） */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-serif text-base text-foreground">项目信息</h2>
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
              <dt className="w-16 shrink-0 text-muted-foreground">当前位置</dt>
              <dd className="min-w-0 flex-1 truncate">
                {config?.currentPosition != null ? (
                  <a href="#/outline" onClick={goOutline} className="text-primary hover:underline">
                    {positionTitle ?? config.currentPosition}
                  </a>
                ) : (
                  <span className="text-muted-foreground">未设置</span>
                )}
              </dd>
              <a href="#/outline" onClick={goOutline} className={buttonVariants({ variant: "outline", size: "xs" })}>
                去大纲
              </a>
            </div>
          </dl>
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">项目提示词</p>
            {/* 截断 2 行（dashboard.md「信息层级」） */}
            <p className="mt-1 line-clamp-2 text-sm text-foreground/90">{config?.prompt || "（未设置）"}</p>
          </div>
        </section>

        {/* 区块 2：创作要素（四张计数卡；GET /entity/:type limit=1 取 total，并行） */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-serif text-base text-foreground">创作要素</h2>
          {entitiesLoading && entityCounts === null ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {ENTITY_ORDER.map((t) => (
                  <a
                    key={t}
                    href={`#/entities/${t}`}
                    className="group rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-muted"
                    title={`查看${TYPE_LABEL[t]}列表`}
                  >
                    <p className="font-serif text-2xl font-semibold text-foreground">
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
                  <Button variant="outline" size="xs" type="button" onClick={() => setEntitiesTick((t) => t + 1)}>
                    重试
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        {/* 区块 3：大纲概览（前端递归统计卷/章/场 + 最近更新 = 树最大 updatedAt） */}
        <section className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h2 className="font-serif text-base text-foreground">大纲概览</h2>
          {outline === null && (outlineLoading || !outlineAttempted) ? (
            /* 骨架：加载中或尚未尝试拉取（L2，oracle U4 审核：首帧不闪「加载失败」） */
            <div className="mt-3 space-y-2">
              <div className="h-5 w-2/5 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          ) : outline === null ? (
            /* 加载失败（loadOutline 静默吞错，attempted 标记兜底呈现） */
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              大纲加载失败
              <Button variant="outline" size="xs" type="button" onClick={() => setOutlineAttempted(false)}>
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
                最近更新: {outlineSummary?.updatedAt ? formatRelativeTime(outlineSummary.updatedAt) : "—"}
              </p>
              {outline.children.length === 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">大纲还是空的</p>
                  {/* M1（oracle U4 审核）：新项目空态契约（dashboard.md「空态」）——[先搭大纲] 主操作 +
                      [和 AI 聊聊设定] 次操作（setCurrentSession(null) 注入右栏新会话） */}
                  <Button variant="ghost" size="xs" type="button" onClick={() => setCurrentSession(null)}>
                    和 AI 聊聊设定
                  </Button>
                </div>
              )}
              <div className="mt-3">
                <a
                  href="#/outline"
                  onClick={goOutline}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  去大纲编辑
                </a>
              </div>
            </>
          )}
        </section>

        {/* 区块 4：最近会话（chat store 前 5 条；点击 → 右栏恢复该会话） */}
        <section className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h2 className="font-serif text-base text-foreground">最近会话</h2>
          {sessions === null ? (
            sessionsError !== null ? (
              /* 加载失败：区块内重试（NO_PROJECT_OPEN 在概览形态不会出现，兜底走通用文案） */
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                会话加载失败
                <Button variant="outline" size="xs" type="button" onClick={() => void loadSessions()}>
                  重试
                </Button>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
            )
          ) : sessions.length === 0 ? (
            /* 空态：一句说明 + 主操作 */
            <div className="mt-3">
              <p className="text-sm text-muted-foreground">还没有会话，和 AI 聊聊设定吧</p>
              <Button variant="outline" size="sm" className="mt-3" type="button" onClick={() => setCurrentSession(null)}>
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
                        currentSessionId === s.id && "bg-accent/40 hover:bg-accent/40",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {s.lastMessage || "（空会话）"}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{s.messageCount} 条消息</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(s.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Button variant="outline" size="sm" type="button" onClick={() => setCurrentSession(null)}>
                  开始新对话
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
