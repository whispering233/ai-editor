// 章历史抽屉（C2）：写作页页头「历史」入口打开。契约 = docs/api/110-api-manuscript.md「章级历史（快照 + 恢复）」、
// docs/ui/DESIGN.md §`writing-page`。抽屉姿势照 `components/outline-canvas/PlotEdgeDrawer.tsx`
// （右贴边 / zIndex 40 / `footer` 放主操作）。
//
// - **打开时右栏（AI 聊天）临时收起**：写 `ui` store 的瞬态标志（`chatPanelSuppressed`），外壳据此不渲染右栏，
//   正文列吸收宽度；关闭 / 卸载即还原，**不改用户的栏位偏好**（`ai-editor:panels` 一个字节都不动）。
// - 列表行 = 相对时间 + 绝对时间 + 字数 + 「比当前少/多 N 字」（文案全在 `lib/chapter-history`）；
//   点行 → 单份正文**只读预览**（`DocumentEditor readOnly` = BlockNote `editable={false}`，不另写 md 渲染）。
// - 恢复 = 二次确认 → 先把本地待存内容落盘（不 flush 的话它会被覆盖且进不了历史）→ `POST restore`
//   → `onRestored` 把正文 / 版本戳 / 字数交回章编辑器（换 key 重挂编辑器 ⇒ 正文立即刷新，不刷新页面）
//   → **重拉列表**（服务端在恢复前强压过当前内容 ⇒ 列表多出一项 = 恢复前那一版，可再退回去）。
// - 失败（404 / 409 / 网络）一律在抽屉内可见，不静默；404 SNAPSHOT_NOT_FOUND 同时刷新列表（该版已被裁剪）。
import { useCallback, useEffect, useState } from "react";
import { Button, Drawer } from "antd";
import {
  ApiError,
  getChapterSnapshot,
  listChapterSnapshots,
  restoreChapterSnapshot,
  type ChapterSnapshotSummary,
} from "../../lib/api";
import {
  chapterHistoryRows,
  describeCharDelta,
  formatSnapshotAbsolute,
  historyErrorText,
  HISTORY_EMPTY_TEXT,
  restoreErrorText,
  type ChapterHistoryRow,
} from "../../lib/chapter-history";
import { useUiStore } from "../../stores/ui";
import { cn } from "../../lib/utils";
import { DocumentEditor } from "../blocknote/document-editor";

/** 抽屉宽度（右栏；历史行四段文案在 360 下会换行，480 够一行放完） */
const DRAWER_WIDTH = 480;

/**
 * 历史列表（纯展示、导出供 SSR 走查）：空列表 → 空态文案（本卡选择的空态行为），有行 → 四段行文案。
 * 行是原生 `<button>`（键盘可达），不套 antd 组件（`.ant-btn` 会注入 `position: relative`，见 AGENTS）。
 */
export function ChapterHistoryList({
  rows,
  selectedSeq,
  onSelect,
}: {
  rows: ChapterHistoryRow[];
  /** 当前预览的 seq（行加深底；无预览 = null） */
  selectedSeq: number | null;
  onSelect: (seq: number) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{HISTORY_EMPTY_TEXT}</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <li key={row.seq}>
          <button
            type="button"
            aria-current={row.seq === selectedSeq ? "true" : undefined}
            onClick={() => onSelect(row.seq)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
              row.seq === selectedSeq ? "bg-accent" : "hover:bg-accent",
            )}
          >
            <span className="shrink-0 tabular-nums">{row.relative}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
              {row.absolute}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {row.charCountText}
            </span>
            <span className="shrink-0 text-xs tabular-nums">{row.deltaText}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface ChapterHistoryDrawerProps {
  chapterId: string;
  /** 当前正文字数（「比当前少/多 N 字」的比较基准） */
  currentCharCount: number;
  /** 恢复前把编辑器待存内容落盘（章编辑器的 autosave.flush） */
  flushPending: () => Promise<void>;
  /** 恢复成功：目标内容 + 服务端新版本戳 + 字数（章编辑器据此重挂编辑器、前移基准） */
  onRestored: (info: { content: string; updatedAt: string; charCount: number }) => void;
  onClose: () => void;
}

export function ChapterHistoryDrawer({
  chapterId,
  currentCharCount,
  flushPending,
  onRestored,
  onClose,
}: ChapterHistoryDrawerProps) {
  /** 列表（null = 首次加载中；[] = 空历史）；顺序沿用服务端 seq 降序 */
  const [snapshots, setSnapshots] = useState<ChapterSnapshotSummary[] | null>(null);
  /** 预览中的那份（含正文）；null = 列表视图 */
  const [preview, setPreview] = useState<{
    seq: number;
    createdAt: string;
    charCount: number;
    content: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const setChatPanelSuppressed = useUiStore((s) => s.setChatPanelSuppressed);

  // 右栏临时收起（瞬态）：卸载 = 抽屉关闭 / 换章 / 离开写作页，一律还原用户的栏位偏好
  useEffect(() => {
    setChatPanelSuppressed(true);
    return () => useUiStore.getState().setChatPanelSuppressed(false);
  }, [setChatPanelSuppressed]);

  /** 拉列表（打开时 + 恢复成功后；服务端已按 seq 降序排好，客户端不重排） */
  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await listChapterSnapshots(chapterId);
      setSnapshots(res.snapshots);
      setError(null);
    } catch (err) {
      setSnapshots([]);
      setError(historyErrorText(err));
    }
  }, [chapterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 点行 → 取单份正文做只读预览（404 = 该版已被裁剪 ⇒ 刷新列表后可见错误） */
  async function selectSnapshot(seq: number): Promise<void> {
    setPreviewing(true);
    setError(null);
    try {
      const detail = await getChapterSnapshot(chapterId, seq);
      setPreview(detail);
    } catch (err) {
      setError(historyErrorText(err));
      await reload();
    } finally {
      setPreviewing(false);
    }
  }

  /** 恢复：二次确认 → flush 待存 → POST restore → 正文立即刷新 → 重拉列表（多出恢复前那一版） */
  async function restore(): Promise<void> {
    if (preview === null) return;
    const ok = await useUiStore.getState().confirm({
      title: "恢复到此版本",
      description: `将用 ${formatSnapshotAbsolute(
        preview.createdAt,
      )} 的版本覆盖当前正文。恢复前会自动留存当前正文，之后仍可退回。`,
    });
    if (!ok) return;
    setRestoring(true);
    setError(null);
    try {
      await flushPending(); // 待存内容先落盘：否则它会被这次恢复覆盖，且进不了历史
      const res = await restoreChapterSnapshot(chapterId, preview.seq);
      onRestored({ content: preview.content, ...res });
      useUiStore.getState().showToast("已恢复到该版本");
      setPreview(null);
      await reload(); // 列表多出一项 = 恢复前那一版（可再退回去）
    } catch (err) {
      setError(restoreErrorText(err));
      if (err instanceof ApiError && err.code === "SNAPSHOT_NOT_FOUND") {
        setPreview(null);
        await reload();
      }
    } finally {
      setRestoring(false);
    }
  }

  const rows =
    snapshots === null ? [] : chapterHistoryRows(snapshots, currentCharCount, Date.now());

  return (
    <Drawer
      open
      placement="right"
      size={DRAWER_WIDTH}
      zIndex={40}
      /* **无遮罩**（与 PlotEdgeDrawer 的模态抽屉有意不同）：历史抽屉打开时正文仍要看得见、点得动
         （对照旧版与当前正文），右栏已临时收起让出宽度；遮罩会把正文压暗并挡住点击 */
      mask={false}
      title="历史版本"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">恢复前会自动留存当前正文</span>
          <Button
            type="primary"
            disabled={preview === null}
            loading={restoring}
            onClick={() => void restore()}
          >
            恢复到此版本
          </Button>
        </div>
      }
    >
      {/* 失败可见（不静默）：列表 / 预览 / 恢复三种失败共用这一行文案 */}
      {error !== null && (
        <p className="mb-3 rounded-md border border-border px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {preview === null ? (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            点一条查看该版本内容；保存时服务端自动留存被覆盖的正文。
          </p>
          {snapshots === null ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : (
            <ChapterHistoryList
              rows={rows}
              selectedSeq={null}
              onSelect={(seq) => void selectSnapshot(seq)}
            />
          )}
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2">
            <Button
              color="default"
              variant="text"
              size="small"
              disabled={previewing}
              onClick={() => setPreview(null)}
            >
              返回列表
            </Button>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
              {formatSnapshotAbsolute(preview.createdAt)} ·{" "}
              {describeCharDelta(preview.charCount, currentCharCount)}
            </span>
          </div>
          {/* 只读预览：固定高度让块编辑器自己有滚动区（写作面高度链在抽屉里不成立） */}
          <div className="flex h-[60vh] min-h-0 flex-col overflow-y-auto rounded-md border border-border p-3">
            <DocumentEditor key={preview.seq} initialContent={preview.content} readOnly />
          </div>
        </>
      )}
    </Drawer>
  );
}