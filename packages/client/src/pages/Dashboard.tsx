// Dashboard 首页（S1.5：书架形态 + 无项目引导；概览统计留后续卡）
// 路由：#/（默认落地页）
// 两种形态：
//   - 书架形态（无项目打开，loadError=NO_PROJECT_OPEN）：书籍列表（GET /project/list 扫描
//     创作根/books/）+ 新建书籍（书名 → 创作根/books/<书名>/）+ 打开其他路径（保留 S1.4 能力）
//   - 概览形态（项目已打开）：占位（完整统计见 doc/ui/pages/dashboard.md，后续卡实现）
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ApiError, CLIENT_NETWORK_ERROR } from "../lib/api";
import { describeOpenError } from "../lib/error-messages";
import { buildBookPath, useProjectStore } from "../stores/project";
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

  // 新建书籍表单
  const [bookName, setBookName] = useState("");
  const [bookError, setBookError] = useState<string | null>(null);
  // 书籍行「打开」失败（独立于折叠区 pathError：打开失败需在列表区立即可见）
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
   * 失败错误渲染在书籍列表区（bookOpenError），不藏在「打开其他路径」折叠区 */
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

  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">Dashboard 首页</h1>

      {configLoading && <p className="text-sm text-zinc-500">加载中…</p>}

      {/* 无项目：书架形态；list 失败（网络或其他错误）统一渲染错误 + 重试 */}
      {noProject && bookshelfError !== null && (
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

      {noProject && bookshelfError === null && (
        <div className="mt-4 max-w-lg rounded-md border border-zinc-200 p-4">
          <h2 className="mb-1 text-base font-semibold">书架</h2>
          <p className="mb-3 text-sm text-zinc-500">创作根下的书籍（每本书一个目录：books/&lt;书名&gt;/）</p>

          {/* 书籍列表 */}
          {bookshelfLoading && bookshelf === null ? (
            <p className="text-sm text-zinc-500">加载中…</p>
          ) : bookshelf && bookshelf.books.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-3 py-4 text-center text-sm text-zinc-500">
              还没有书，先创建一本
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
              {bookshelf?.books.map((book) => (
                <li key={book.path} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-800">{book.name}</span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {formatTimestamp(book.updatedAt)}
                  </span>
                  <Button
                    variant="outline"
                    disabled={submitting}
                    type="button"
                    onClick={() => void handleOpenBook(book.path)}
                  >
                    打开
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* 书籍行打开失败：列表区立即可见（不藏在「打开其他路径」折叠区） */}
          {bookOpenError && <p className="mt-2 text-sm text-red-600">{bookOpenError}</p>}

          {/* 新建书籍 */}
          <form onSubmit={handleCreateBook} className="mt-4 flex flex-col gap-2">
            <p className="text-sm font-medium text-zinc-700">新建书籍</p>
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
            {bookError && <p className="text-sm text-red-600">{bookError}</p>}
          </form>

          {/* 打开其他路径（S1.4 保留能力，折叠） */}
          <div className="mt-4 border-t border-zinc-100 pt-3">
            <button
              type="button"
              className="text-sm text-zinc-500 hover:text-zinc-700"
              onClick={() => setShowPathForm((v) => !v)}
            >
              {showPathForm ? "收起" : "打开其他路径…"}
            </button>
            {showPathForm && (
              <form onSubmit={handleOpenPath} className="mt-2 flex flex-col gap-2">
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
        </div>
      )}

      {/* 有项目：概览占位（书架切换入口后置，完整统计后续卡实现） */}
      {config !== null && (
        <p className="text-sm text-zinc-500">
          项目概览：项目信息、四类要素统计、大纲概览、最近会话（后续卡实现）
        </p>
      )}
    </section>
  );
}