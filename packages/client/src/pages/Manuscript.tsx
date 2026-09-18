// 章正文页（卡 12.5）：路由 #/manuscript/:chapterId（入口 = 大纲页章视图行「写正文」、
// #/outline/:ch-* 详情页「写正文」）。契约：docs/api/110-api-manuscript.md（GET/PUT 端点）、
// docs/ui/DESIGN.md §Colors「块编辑器（--bn-*）」。设计语义见 design/10-data-model.md §13。
//
// 数据：GET /manuscript/:chapterId（正文 + 版本戳 base + charCount）；标题与上下章取自大纲树
// （store 已缓存时不再请求；本页不展示字数统计，故不带 with_metadata）。
// 保存：**自动保存**——编辑器内容变化 → 空闲 1500ms 落盘（lib/manuscript 的 createAutosave），
// 卸载 / 切路由前 flush（useEffect cleanup）；保存失败必须可见（顶部错误条 + 重试，不静默）。
// 冲突（409 DOCUMENT_STALE）：对话框二选一——「重新加载（丢弃本地）」重拉服务端版本并换 key 重挂
// 编辑器，「覆盖保存」重发且**不带 base_updated_at**（服务端据此跳过冲突检查）。
// 章节不存在 / 已软删（404 OUTLINE_NODE_NOT_FOUND）→ 页面 404 态（写法同 OutlineDetail）。
// 样式纪律：颜色只走 token / 语义变量；块编辑器的改色只在 components/blocknote/blocknote.css。
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "antd";
import { PageHeader } from "@/components/ui/page-header";
import { DocumentEditor } from "../components/blocknote/document-editor";
import { ManuscriptLoadFailure, ManuscriptMissing } from "../components/blocknote/manuscript-states";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, getManuscript, saveManuscript } from "../lib/api";
import {
  AUTOSAVE_DELAY_MS,
  chapterNeighbors,
  createAutosave,
  formatTextLength,
  manuscriptErrorAction,
} from "../lib/manuscript";
import { findNode } from "../lib/outline-tree";
import { errorBannerClass, skeletonClass } from "../lib/styles";
import { navigate } from "../hooks/use-route";
import { useOutlineLoader } from "../hooks/use-outline-loader";
import { useProjectStore } from "../stores/project";
import { cn } from "../lib/utils";

type SaveState = "idle" | "saving" | "saved";

/** 加载失败形态（错误码 + 文案）：正文端点的加载/保存两条路径共用 */
interface LoadFailure {
  code: string;
  message: string;
}

/** ApiError → { code, message }（网络层失败归为 CLIENT_NETWORK_ERROR） */
function toLoadFailure(err: unknown): LoadFailure {
  return err instanceof ApiError
    ? { code: err.code, message: err.message }
    : { code: "CLIENT_NETWORK_ERROR", message: "网络请求失败" };
}

export default function Manuscript({ chapterId }: { chapterId: string }) {
  const outline = useProjectStore((s) => s.outline);
  // 大纲树（标题 + 上下章）：本页不展示章字数，故不需要联表统计（withMetadata: false）
  const { retry } = useOutlineLoader({ withMetadata: false });

  // 正文：content 为 null = 尚未取到（加载中 / 加载失败）；loadError 非 null = 加载失败（码 + 文案）
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [charCount, setCharCount] = useState(0);
  // 编辑器重挂信号（BlockNote 非受控：重新加载 / 丢弃本地改动后必须换 key 重挂）
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  /** 版本戳基准（保存时回传 base_updated_at）；null = 服务端从未写过 */
  const baseRef = useRef<string | null>(null);
  /** 编辑器最新内容——覆盖保存 / 重试 / 卸载 flush 都取它，避免闭包里的旧值 */
  const latestRef = useRef<string | null>(null);

  const node = outline === null ? null : findNode(outline.children, chapterId);
  const chapterTitle = node !== null && node.type === "chapter" ? node.title : null;
  const neighbors = useMemo(() => chapterNeighbors(outline, chapterId), [outline, chapterId]);

  /** 拉取正文（首拉 / 重新加载）；失败按错误码分流（404 → 页面 404 态，其余 → 加载失败 + 重试） */
  async function load(): Promise<void> {
    try {
      const res = await getManuscript(chapterId);
      baseRef.current = res.updatedAt;
      latestRef.current = res.content;
      setContent(res.content);
      setCharCount(res.charCount);
      setLoadError(null);
      setSaveError(null);
      setSaveState("idle");
      setEditorEpoch((epoch) => epoch + 1);
    } catch (err) {
      setLoadError(toLoadFailure(err));
    }
  }

  useEffect(() => {
    void load();
    // 只随 chapterId 重拉：换章 = 路由 key 变化 → 组件重挂（effect 顺带覆盖 StrictMode 的重复挂载）
  }, [chapterId]);

  /**
   * 提交保存（自动保存落盘 / 错误条重试 / 覆盖保存三处共用）：
   * - `force` = 覆盖保存：**不带 base_updated_at**（服务端跳过冲突检查）
   * - base 为 null（本章从未写过）时同样不带：契约的 base_updated_at 无法表达「期望 null」，
   *   且此时不存在可被覆盖的他人写入
   */
  async function saveContent(text: string, options: { force?: boolean } = {}): Promise<void> {
    setSaveState("saving");
    const base = options.force === true ? null : baseRef.current;
    try {
      const res = await saveManuscript(chapterId, {
        content: text,
        ...(base !== null ? { baseUpdatedAt: base } : {}),
      });
      baseRef.current = res.updatedAt; // 本地基准前移（后续保存以新版本戳比对）
      setCharCount(res.charCount);
      setSaveError(null);
      setSaveState("saved");
    } catch (err) {
      const failure = toLoadFailure(err);
      setSaveState("idle");
      switch (manuscriptErrorAction(failure.code)) {
        case "conflict":
          // 另一标签页/窗口写过：交给对话框二选一，不静默覆盖也不静默丢弃
          setConflictOpen(true);
          break;
        case "missing":
          // 章已不存在/已软删：正文无从保存 → 落到页面 404 态
          setContent(null);
          setLoadError(failure);
          break;
        default:
          setSaveError(failure.message);
      }
    }
  }

  // 自动保存调度器（跨渲染稳定；save 实现经 ref 取最新闭包，避免持有首帧状态）
  const saveRef = useRef(saveContent);
  useEffect(() => {
    saveRef.current = saveContent;
  });
  const autosave = useMemo(
    () => createAutosave({ delayMs: AUTOSAVE_DELAY_MS, save: (text) => saveRef.current(text) }),
    [],
  );

  // 卸载 / 切路由前 flush：在途内容立刻落盘，不依赖组件存活（cleanup 内不 await）
  useEffect(() => () => void autosave.flush(), [autosave]);

  /** 编辑器内容变化：记录最新内容 + 排入自动保存 */
  function handleChange(text: string): void {
    latestRef.current = text;
    autosave.schedule(text);
  }

  /** 冲突「重新加载（丢弃本地）」：丢弃待存内容 → 重拉服务端版本（load 内换 key 重挂编辑器） */
  async function discardLocalAndReload(): Promise<void> {
    setConflictOpen(false);
    autosave.reset();
    await load();
  }

  /** 冲突「覆盖保存」：以本地最新内容重发（不带 base_updated_at） */
  async function overwriteRemote(): Promise<void> {
    setConflictOpen(false);
    await saveContent(latestRef.current ?? "", { force: true });
  }

  const notFound = loadError?.code === "OUTLINE_NODE_NOT_FOUND";

  if (notFound) return <ManuscriptMissing />;

  if (loadError !== null && content === null) {
    return <ManuscriptLoadFailure message={loadError.message} onRetry={() => void load()} />;
  }

  return (
    <section>
      {/* 页头：章标题 + 字数/保存态（说明行）+ 上/下一章（阅读序相邻章，无则禁用） */}
      <PageHeader
        title={chapterTitle ?? "正文"}
        truncateTitle
        action={
          <>
            <Button
              disabled={neighbors.prev === null}
              title={neighbors.prev?.chapter.title}
              onClick={() =>
                neighbors.prev !== null && navigate(`/manuscript/${neighbors.prev.chapter.id}`)
              }
            >
              上一章
            </Button>
            <Button
              disabled={neighbors.next === null}
              title={neighbors.next?.chapter.title}
              onClick={() =>
                neighbors.next !== null && navigate(`/manuscript/${neighbors.next.chapter.id}`)
              }
            >
              下一章
            </Button>
          </>
        }
        description={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{formatTextLength(charCount) ?? "0 字"}</span>
            {saveState === "saving" && <span>保存中…</span>}
            {saveState === "saved" && <span>已保存</span>}
          </div>
        }
      />

      {/* 保存失败（可见、不静默）：错误条 + 重试（重发失败内容） */}
      {saveError !== null && (
        <div className={cn(errorBannerClass, "mb-3 flex items-center gap-3")}>
          <span className="min-w-0 flex-1">{saveError}</span>
          <Button size="small" onClick={() => void saveContent(latestRef.current ?? "")}>
            重试
          </Button>
        </div>
      )}

      {content === null ? (
        /* 正文加载骨架（大纲未加载不影响正文：标题回落到「正文」） */
        <div className="space-y-2 rounded-md border border-border p-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={cn(skeletonClass, "h-5")} style={{ width: `${92 - i * 12}%` }} />
          ))}
        </div>
      ) : (
        <DocumentEditor key={editorEpoch} initialContent={content} onChange={handleChange} />
      )}

      {/* 大纲树兜底：只有标题/上下章依赖它，正文本身不受影响（失败时点重试再拉） */}
      {outline === null && (
        <p className="mt-3 text-xs text-muted-foreground">
          大纲未加载，章标题与上下章暂不可用
          <Button className="ml-2" size="small" onClick={retry}>
            重试
          </Button>
        </p>
      )}

      {/* 409 冲突（仅携带 base_updated_at 保存时可能）：二选一，不自动决定 */}
      <Dialog open={conflictOpen} onOpenChange={(open) => !open && setConflictOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>正文已被其他窗口修改</DialogTitle>
          </DialogHeader>
          <DialogDescription>
            另一标签页/窗口已保存过这一章。「重新加载」丢弃本页未保存的改动，
            「覆盖保存」用本页内容覆盖服务端版本。
          </DialogDescription>
          <DialogFooter>
            <Button onClick={() => void discardLocalAndReload()}>重新加载（丢弃本地）</Button>
            <Button type="primary" onClick={() => void overwriteRemote()}>
              覆盖保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
