// Dashboard 首页（S1.6：书架卡片网格 + 封面占位 + 回到书架入口；概览统计留后续卡）
// 路由：#/（默认落地页）
// 两种形态：
//   - 书架形态（无项目打开）：卡片网格（GET /project/list）+ 封面占位（书名 hash 派生色相，
//     lib/book-cover.ts）+ 新建书籍 + 打开其他路径（S1.4 保留）。设计契约见 doc/ui/pages/dashboard.md 书架章节
//   - 概览形态（项目已打开）：占位 + [回到书架] 入口（closeProject → 回书架形态，S1.6 补齐切换缺口）
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ApiError, CLIENT_NETWORK_ERROR } from "../lib/api";
import { bookCoverHue, bookCoverStyle } from "../lib/book-cover";
import { describeOpenError } from "../lib/error-messages";
import { buildBookPath, useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";
import { formatTimestamp } from "@ai-editor/shared";

/** 从任意错误提取错误码（ApiError → 服务端/客户端码；未知 → null 走兜底文案） */
function openErrorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

export default function Dashboard() {
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const bookshelf = useProjectStore((s) => s.bookshelf);
  const bookshelfLoading = useProjectStore((s) => s.bookshelfLoading);
  const bookshelfError = useProjectStore((s) => s.bookshelfError);
  const loadBookshelf = useProjectStore((s) => s.loadBookshelf);
  const openProjectAt = useProjectStore((s) => s.openProjectAt);
  const createProjectAt = useProjectStore((s) => s.createProjectAt);
  const closeProject = useProjectStore((s) => s.closeProject);

  // 新建书籍表单
  const [bookName, setBookName] = useState("");
  const [bookError, setBookError] = useState<string | null>(null);
  // 书籍卡片「打开」失败（独立于折叠区 pathError：打开失败需在列表区立即可见，S1.6 移至网格上方）
  const [bookOpenError, setBookOpenError] = useState<string | null>(null);
  // 打开其他路径（折叠区）
  const [showPathForm, setShowPathForm] = useState(false);
  const [path, setPath] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const noProject = config === null && !configLoading;

  // 无项目时自动加载书架（list 失败由 bookshelfError 呈现 + 重试）
  useEffect(() => {
    if (noProject && !bookshelfLoading && bookshelf === null && bookshelfError === null) {
      void loadBookshelf();
    }
  }, [noProject, bookshelfLoading, bookshelf, bookshelfError, loadBookshelf]);

  /** 新建书籍：书名 → 创作根/books/<书名>/，create（不打开）→ open 进入新书 */
  async function handleCreateBook(e: FormEvent) {
    e.preventDefault();
    const name = bookName.trim();
    if (!name) {
      setBookError("请输入书名");
      return;
    }
    if (!bookshelf) {
      setBookError("书架未加载，请稍后重试");
      return;
    }
    setSubmitting(true);
    setBookError(null);
    try {
      const bookPath = buildBookPath(bookshelf.rootPath, name);
      await createProjectAt(bookPath, { name, language: "zh" });
      // 成功后书架需要刷新（新书出现在列表）；config 已由 openProjectAt 刷新
      await loadBookshelf();
      setBookName("");
    } catch (err) {
      setBookError(describeOpenError(openErrorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  /** 打开书籍（走现有 openProjectAt：刷新 config/outline；rebuilt 时 store 内 toast）；
   * 失败错误渲染在网格上方（bookOpenError），不藏在「打开其他路径」折叠区 */
  async function handleOpenBook(bookPath: string) {
    setSubmitting(true);
    setBookOpenError(null);
    try {
      await openProjectAt(bookPath);
    } catch (err) {
      setBookOpenError(describeOpenError(openErrorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  /** 打开其他路径（S1.4 保留能力） */
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

  /** 回到书架（概览形态 → 书架形态，S1.6 补齐切换缺口）：
   * closeProject 清空 config → 本页进入书架形态；书架数据可能陈旧（updatedAt 只在配置变更时刷新），
   * 显式 loadBookshelf 刷新（失败由 bookshelfError 呈现，不阻塞形态切换）；
   * 同时清空打开失败横幅（打开失败 → 回书架后旧错误不应残留在网格上方） */
  async function handleBackToShelf() {
    setSubmitting(true);
    setBookOpenError(null);
    try {
      await closeProject();
      await loadBookshelf();
    } catch {
      useUiStore.getState().showToast("回到书架失败，请重试", "error");
    } finally {
      setSubmitting(false);
    }
  }

  /** 新建表单（空态引导卡与有书操作区共用；S1.6 空态时表单上升为页面主操作） */
  const createBookForm = (
    <form onSubmit={handleCreateBook} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={bookName}
          onChange={(e) => setBookName(e.target.value)}
          placeholder="书名（创建于 books/书名/ 目录）"
        />
        <Button type="submit" disabled={submitting || bookshelf === null}>
          新建
        </Button>
      </div>
      {bookError && <p className="text-left text-sm text-red-600">{bookError}</p>}
    </form>
  );

  return (
    <section>
      {/* 有项目：概览占位 + 回到书架入口（完整统计后续卡实现） */}
      {config !== null && (
        <div className="mt-2 flex items-center justify-between gap-4 rounded-md border border-zinc-200 p-4">
          <p className="text-sm text-zinc-500">
            项目概览：项目信息、四类要素统计、大纲概览、最近会话（后续卡实现）
          </p>
          <Button
            variant="outline"
            type="button"
            disabled={submitting}
            onClick={() => void handleBackToShelf()}
          >
            回到书架
          </Button>
        </div>
      )}

      {configLoading && <p className="mt-4 text-sm text-zinc-500">加载中…</p>}

      {/* 无项目：书架形态；list 失败（网络或其他错误）统一渲染错误 + 重试 */}
      {noProject && (
        <div className="mt-2">
          {/* 标题区：大标题 + 创作根路径（bookshelf.rootPath，S1.6 新增展示） */}
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-xl font-semibold">书架</h1>
            {bookshelf && (
              <p className="min-w-0 truncate text-sm text-zinc-400" title={bookshelf.rootPath}>
                创作根: {bookshelf.rootPath}
              </p>
            )}
          </div>

          {bookshelfError !== null && (
            <div className="mt-4 max-w-md rounded-md border border-zinc-200 p-4">
              <p className="text-sm text-zinc-700">
                {bookshelfError === CLIENT_NETWORK_ERROR
                  ? "无法连接服务，请确认 ai-editor 服务已启动后重试。"
                  : "书架加载失败，请重试。"}
              </p>
              <Button className="mt-3" onClick={() => void loadBookshelf()} type="button">
                重试
              </Button>
            </div>
          )}

          {bookshelfError === null && (
            <>
              {/* 列表区：加载骨架 / 空态引导卡 / 卡片网格 */}
              {bookshelfLoading && bookshelf === null ? (
                <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="overflow-hidden rounded-lg border border-zinc-200">
                      <div className="aspect-[4/3] animate-pulse bg-zinc-100" />
                      <div className="space-y-2 px-3 py-2">
                        <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-100" />
                        <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-100" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : bookshelf && bookshelf.books.length === 0 ? (
                /* 空态：引导卡 + 新建表单突出（页面主操作）+ 打开其他路径次级 */
                <div className="mt-6 rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center">
                  <p className="text-sm text-zinc-600">还没有书，先创建一本</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    每本书一个独立目录（books/书名/），写作数据互不干扰
                  </p>
                  <div className="mx-auto mt-5 max-w-md">{createBookForm}</div>
                </div>
              ) : (
                bookshelf && (
                  <>
                    {/* 打开失败横幅：网格上方立即可见（S1.6 从列表下方调整至此） */}
                    {bookOpenError && (
                      <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {bookOpenError}
                      </p>
                    )}
                    {/* 卡片网格：整卡可点，hover 提亮 + 封面「打开」浮现（设计文档「关键交互」） */}
                    <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {bookshelf.books.map((book) => {
                        const hue = bookCoverHue(book.name);
                        return (
                          <li key={book.path}>
                            <button
                              type="button"
                              disabled={submitting}
                              title={`打开《${book.name}》`}
                              onClick={() => void handleOpenBook(book.path)}
                              className="group w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-60"
                            >
                              {/* 封面占位：渐变底（书名 hash 派生色相，同书同色）+ 书名首字 */}
                              <div className="relative aspect-[4/3] w-full" style={bookCoverStyle(hue)}>
                                <span className="absolute inset-0 flex items-center justify-center text-3xl font-semibold">
                                  {book.name.charAt(0)}
                                </span>
                                {/* hover 浮现「打开」遮罩 */}
                                <span className="absolute inset-0 flex items-center justify-center bg-zinc-900/45 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                                  打开
                                </span>
                              </div>
                              <div className="px-3 py-2">
                                <p className="truncate text-sm font-medium text-zinc-800">{book.name}</p>
                                <p className="mt-0.5 text-xs text-zinc-400">
                                  {formatTimestamp(book.updatedAt)}
                                </p>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )
              )}

              {/* 操作区：有书时新建表单在列表下方（空态时表单已在引导卡内，不重复） */}
              {bookshelf && bookshelf.books.length > 0 && (
                <div className="mt-6 max-w-lg border-t border-zinc-100 pt-4">
                  <p className="mb-2 text-sm font-medium text-zinc-700">新建书籍</p>
                  {createBookForm}
                </div>
              )}

              {/* 打开其他路径（S1.4 保留能力，折叠；空态时作为次级操作同样可用） */}
              <div className="mt-4 border-t border-zinc-100 pt-3">
                <button
                  type="button"
                  className="text-sm text-zinc-500 hover:text-zinc-700"
                  onClick={() => setShowPathForm((v) => !v)}
                >
                  {showPathForm ? "收起" : "打开其他路径…"}
                </button>
                {showPathForm && (
                  <form onSubmit={handleOpenPath} className="mt-2 flex max-w-lg flex-col gap-2">
                    <Input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="/absolute/path/to/project（须含 project.json）"
                    />
                    <div>
                      <Button type="submit" variant="outline" disabled={submitting}>
                        打开
                      </Button>
                    </div>
                    {pathError && <p className="text-sm text-red-600">{pathError}</p>}
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
