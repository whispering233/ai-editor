// 章正文页（卡 12.5）：路由 #/manuscript/:chapterId（入口 = 大纲页章视图行「写正文」、
// #/outline/:ch-* 详情页「写正文」）。契约：docs/api/110-api-manuscript.md（GET/PUT 端点）、
// docs/ui/DESIGN.md §Colors「块编辑器（--bn-*）」。设计语义见 design/10-data-model.md §13。
//
// 数据：GET /manuscript/:chapterId（正文 + 版本戳 base + charCount）；标题与上下章取自大纲树
// （store 已缓存时不再请求；本页不展示字数统计，故不带 with_metadata）。
// 保存：**自动保存**——编辑器内容变化 → 空闲 1500ms 落盘（lib/manuscript 的 createAutosave），
// 卸载 / 切路由前 flush（useEffect cleanup）；保存失败必须可见（顶部错误条 + 重试，不静默）。
// 手动「保存」（卡 14.1）：工具条右端按钮**恒发一次 PUT**（即使无待存内容也重发，保证点击必有
// 可见反应）——是用户侧保底入口，**不是**关页面/退出桌面版的自动兜底（已登记 backlog）。
// 冲突（409 DOCUMENT_STALE）：对话框二选一——「重新加载（丢弃本地）」重拉服务端版本并换 key 重挂
// 编辑器，「覆盖保存」重发且**不带 base_updated_at**（服务端据此跳过冲突检查）。
// 章节不存在 / 已软删（404 OUTLINE_NODE_NOT_FOUND）→ 页面 404 态（写法同 OutlineDetail）。
// 导入导出（卡 12.6，契约 docs/api/110-api-manuscript.md「导入导出（无端点）」）：纯客户端——导出 md（**先确认有损**）
// / 块 JSON（无损），导入 md（往返比对，有损时必须用户确认后才覆盖）/ 块 JSON（浅校验失败即可见错误）。
// 判定与文件名规则在 lib/document-io（node 可测）；对话框与下载走既有全局 confirm / 临时 <a download>。
// 导入落地必须换 key 重挂编辑器（BlockNote 非受控），再把新内容交给自动保存落盘。
// 样式纪律：颜色只走 token / 语义变量；块编辑器的改色只在 components/blocknote/blocknote.css。
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dropdown } from "antd";
import { DownOutlined, ExportOutlined, ImportOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/ui/page-header";
import {
  DocumentEditor,
  type DocumentEditorApi,
} from "../components/blocknote/document-editor";
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
  formatSavedAt,
  formatTextLength,
  hasVisibleOverlay,
  manuscriptErrorAction,
} from "../lib/manuscript";
import {
  downloadTextFile,
  exportDocumentJson,
  exportDocumentMarkdown,
  MARKDOWN_LOSSY_NOTICE,
  markdownImportConfirmMessage,
  planDocumentImport,
  readTextFile,
} from "../lib/document-io";
import { findNode } from "../lib/outline-tree";
import { errorBannerClass, skeletonClass } from "../lib/styles";
import { navigate } from "../hooks/use-route";
import { useOutlineLoader } from "../hooks/use-outline-loader";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";
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
  // 导入导出的入口（卡 12.6）：md 互转要有编辑器实例 → 实例就绪后回调拿到能力出口；null = 编辑器未挂载
  const [editorApi, setEditorApi] = useState<DocumentEditorApi | null>(null);
  /** 隐藏的文件选择框（导入入口；桌面形态不加原生能力，同一套 <input type="file">） */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  /** 最近一次保存**完成**的本地时刻（卡 13.6）：瞬态，不持久化；null = 本页尚未保存过（无时间戳） */
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  // 专注模式（卡 13.4）：**瞬态**全局标志（不持久化，路由变化由 MainPanel 的守卫归零）
  const focusMode = useUiStore((s) => s.focusMode);
  const setFocusMode = useUiStore((s) => s.setFocusMode);

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
      setSavedAt(null); // 重新加载（含切章重挂）后不显示旧时间戳
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
      setSavedAt(new Date()); // 「已保存 · HH:MM」的时刻基准 = 这次保存完成的时刻
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

  // Esc 退出专注（DESIGN.md §Components「专注模式入口」：退出 = 同一按钮或 Esc；不新增全局快捷键）。
  // - **捕获阶段**监听：开层守卫必须先于浮层自己的关闭动作看到 DOM——antd/ariakit 的 Esc 在冒泡阶段，
  //   而 React 离散事件会同步刷 DOM ⇒ 等冒泡到 window 时下拉已经关了，守卫就形同虚设。
  // - 有可见浮层在场 ⇒ 这次 Esc 归它（否则「关写作设置下拉」会顺手把专注模式也退掉）。
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || hasVisibleOverlay()) return;
      setFocusMode(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focusMode, setFocusMode]);

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

  // ============ 导入导出（卡 12.6） ============

  /** 本章文件名基名（章标题；大纲未加载时回落「正文」，与页头标题同口径） */
  function documentTitle(): string {
    return chapterTitle ?? "正文";
  }

  /** 导出块 JSON（无损，可再导入） */
  function exportBlocksJson(): void {
    const file = exportDocumentJson(latestRef.current ?? "", documentTitle());
    downloadTextFile(file);
    useUiStore.getState().showToast(`已导出 ${file.fileName}`);
  }

  /** 导出 markdown：**md 有损**（颜色/对齐/嵌套/媒体无表达）——下载前必须先让用户确认 */
  async function exportMarkdown(): Promise<void> {
    if (editorApi === null) return;
    const content = latestRef.current ?? "";
    const ok = await useUiStore.getState().confirm({
      title: "导出 markdown（有损）",
      description: `${MARKDOWN_LOSSY_NOTICE}。需要无损（可再导入）请改用「导出块 JSON」。`,
    });
    if (!ok) return;
    const file = exportDocumentMarkdown(content, documentTitle(), (text) =>
      editorApi.toMarkdown(text),
    );
    downloadTextFile(file);
    useUiStore.getState().showToast(`已导出 ${file.fileName}（有损）`);
  }

  /**
   * 导入落地的唯一路径：**换 key 重挂编辑器**换内容（BlockNote 非受控，外部改写只能重挂），
   * 再把新内容交给自动保存落盘（导入 = 一次用户编辑，不新增端点）。
   */
  function applyImportedContent(next: string): void {
    latestRef.current = next;
    setContent(next);
    setEditorEpoch((epoch) => epoch + 1);
    autosave.schedule(next);
  }

  /** 导入（按扩展名分派；有损 md 必须先确认——判定在 lib/document-io，对话框用全局 confirm） */
  async function importFile(file: File): Promise<void> {
    if (editorApi === null) return;
    let text: string;
    try {
      text = await readTextFile(file);
    } catch {
      useUiStore.getState().showToast("导入失败：文件读取异常", "error");
      return;
    }
    const plan = planDocumentImport(file.name, text, (markdown) =>
      editorApi.parseMarkdown(markdown),
    );
    switch (plan.action) {
      case "error":
        useUiStore.getState().showToast(plan.message, "error");
        return;
      case "confirm-lossy": {
        const ok = await useUiStore.getState().confirm({
          title: "导入 markdown（有损）",
          description: `${markdownImportConfirmMessage(
            plan.unsupportedCount,
          )}；继续将用文件内容覆盖本章。需要无损请改用块 JSON。`,
        });
        if (!ok) return;
        break;
      }
      case "apply":
        break;
    }
    applyImportedContent(plan.content);
    useUiStore.getState().showToast(`已用 ${file.name} 覆盖本章正文`);
  }

  const notFound = loadError?.code === "OUTLINE_NODE_NOT_FOUND";

  /**
   * 「字数 · 保存态（含保存时刻）」文案（**唯一份**）：常规布局在页头说明行，专注模式在工具条右端——
   * 两处不同时显示（任务约定），文案与时间字符串只有这一处定义（专注态复用同一 JSX，不另算时间）。
   */
  const statusText = (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="tabular-nums">{formatTextLength(charCount) ?? "0 字"}</span>
      {saveState === "saving" && <span>保存中…</span>}
      {saveState === "saved" && savedAt !== null && (
        <span className="tabular-nums">已保存 · {formatSavedAt(savedAt)}</span>
      )}
    </div>
  );

  if (notFound) return <ManuscriptMissing />;

  if (loadError !== null && content === null) {
    return <ManuscriptLoadFailure message={loadError.message} onRetry={() => void load()} />;
  }

  return (
    <section>
      {/* 页头：章标题 + 字数/保存态（说明行）+ 上/下一章（阅读序相邻章，无则禁用）+ 导入/导出。
          专注模式下整没（契约 DESIGN.md §Layout「专注模式」）——字号/保存态改由工具条右端承载；
          下面是**保存失败错误条**，不受专注模式影响（失败必须可见，不静默） */}
      {!focusMode && (
        <PageHeader
          title={chapterTitle ?? "正文"}
          truncateTitle
          action={
            <>
              {/* 导入入口：隐藏文件框（浏览器与桌面同一套；按钮触发，选完清空 value 以便重复选同一文件） */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.json,.txt,text/markdown,application/json,text/plain"
                className="hidden"
                aria-label="选择要导入的正文文件"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file !== undefined) void importFile(file);
                }}
              />
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
              <Button
                disabled={editorApi === null}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImportOutlined className="text-sm" />
                导入
              </Button>
              <Dropdown
                disabled={editorApi === null}
                trigger={["click"]}
                menu={{
                  items: [
                    { key: "json", label: "导出块 JSON（无损）" },
                    { key: "markdown", label: "导出 markdown（有损）" },
                  ],
                  onClick: ({ key }) => {
                    if (key === "json") exportBlocksJson();
                    else void exportMarkdown();
                  },
                }}
              >
                <Button disabled={editorApi === null}>
                  <ExportOutlined className="text-sm" />
                  导出
                  <DownOutlined className="text-xs" />
                </Button>
              </Dropdown>
            </>
          }
          description={statusText}
        />
      )}

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
        <DocumentEditor
          key={editorEpoch}
          initialContent={content}
          onChange={handleChange}
          onReady={setEditorApi}
          /* 字数 · 保存态（含保存时刻）：专注模式下页头已隐藏 ⇒ 改由工具条右端承载同一份 statusText
             （非专注时仍在页头，不同时显示；时间字符串不在工具条另算） */
          status={focusMode ? statusText : undefined}
          /* 专注入口：唯一入口就在工具条右端（DESIGN.md §Components「专注模式入口」） */
          focus={{ active: focusMode, onToggle: () => setFocusMode(!focusMode) }}
          /* 手动保存（卡 14.1）：恒发一次 PUT（不先 flush——会双发）；saving 期间禁用防连点。
             口径见 DESIGN.md §Components「为什么手动「保存」放在工具条而不是页头」 */
          save={{
            onSave: () => void saveContent(latestRef.current ?? ""),
            saving: saveState === "saving",
          }}
        />
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
