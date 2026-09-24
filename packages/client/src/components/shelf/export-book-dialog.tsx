// `export-book-dialog`（DESIGN.md §书架主页 `export-book-dialog`）：导出类型二选一——受控 `Dialog`，
// 复用 `components/ui/dialog.tsx`，不新造浮层。
//
// 形态：标题 `导出《书名》` + **竖排两个单选项**（antd `Radio.Group`，默认 `项目压缩文件`；
// caption 排在选项下方，文案照 DESIGN.md 表格逐字）+ Footer `[取消]` / `[导出]`（primary；
// 在途 `loading`（第一项）与 `disabled`（防连点））。
// **本组件只上报所选类型**（`onExport(kind)`）：落盘下载、错误分流、toast、关框都归调用方
// （书架页把两条产物接到同一 `<a download>` 管道）。
// 分层：容器 `ExportBookDialog`（自持选中态）+ 内容体 `ExportBookFormBody`（portal 不能在 SSR
// 渲染，仓内无 jsdom ⇒ 拆出本层供 `renderToString` 走查，同 `character-create-dialog` 先例）。
import { useEffect, useState } from "react";
import { Button, Radio } from "antd";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** 导出类型（两个产物互斥：三文件备份包 / markdown 小说文档） */
export type ExportBookKind = "project" | "novel";

/** 默认选中项 = 项目压缩文件（**无损**的那条不作默认是相反的错误——有损产物必须是用户的显式选择） */
export const DEFAULT_EXPORT_BOOK_KIND: ExportBookKind = "project";

/** 单选项（顺序 = 展示顺序，首项即默认）：label + caption 文案（`{书名}` 由调用方传入） */
export const EXPORT_BOOK_OPTIONS: readonly {
  kind: ExportBookKind;
  label: string;
  caption: (name: string) => string;
}[] = [
  {
    kind: "project",
    label: "项目压缩文件",
    caption: (name) => `${name}.zip · 三文件 · 可再导入（无损）`,
  },
  {
    kind: "novel",
    label: "小说文档",
    caption: (name) => `${name}-小说文档.zip · 卷/章 markdown 目录树 · 有损`,
  },
];

/** 导出成功 toast（两种产物两句话；文案单一定义，调用点不手抄） */
export function exportBookToast(kind: ExportBookKind, name: string): string {
  return kind === "novel" ? `已导出《${name}》小说文档` : `已导出《${name}》备份`;
}

export interface ExportBookFormBodyProps {
  /** 书名（进标题与两条 caption） */
  name: string;
  /** 所选导出类型（受控） */
  kind: ExportBookKind;
  onKindChange: (kind: ExportBookKind) => void;
  /** 导出在途：单选项与 `[取消]` 禁用、`[导出]` loading（防连点） */
  exporting: boolean;
  onExport: () => void;
  onCancel: () => void;
}

/** 导出类型框内容体（纯展示：无 effect、无请求——SSR 可直渲染） */
export function ExportBookFormBody({
  name,
  kind,
  onKindChange,
  exporting,
  onExport,
  onCancel,
}: ExportBookFormBodyProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>导出《{name}》</DialogTitle>
      </DialogHeader>
      <Radio.Group
        value={kind}
        onChange={(e) => onKindChange(e.target.value as ExportBookKind)}
        disabled={exporting}
        aria-label="导出类型"
      >
        {EXPORT_BOOK_OPTIONS.map((option) => (
          /* 每项独占一行 ⇒ 竖排（不在 `Radio.Group` 根元素上写布局类：antd 无层 CSS 会压掉） */
          <div key={option.kind} className="flex flex-col gap-0.5 py-1">
            <Radio value={option.kind}>{option.label}</Radio>
            <span className="pl-6 text-xs text-muted-foreground">{option.caption(name)}</span>
          </div>
        ))}
      </Radio.Group>
      <DialogFooter>
        <Button onClick={onCancel} disabled={exporting}>
          取消
        </Button>
        <Button type="primary" loading={exporting} disabled={exporting} onClick={onExport}>
          导出
        </Button>
      </DialogFooter>
    </>
  );
}

export interface ExportBookDialogProps {
  /** 受控开合（调用方持有：导出成功才关框，失败留框） */
  open: boolean;
  /** 当前书名 */
  name: string;
  /** 导出在途（调用方持有） */
  exporting: boolean;
  /** 只上报所选类型——下载/错误提示由调用方负责 */
  onExport: (kind: ExportBookKind) => void;
  onOpenChange: (open: boolean) => void;
}

/** 导出类型框容器：自持选中态（每次打开重置回默认项） */
export function ExportBookDialog({
  open,
  name,
  exporting,
  onExport,
  onOpenChange,
}: ExportBookDialogProps) {
  const [kind, setKind] = useState<ExportBookKind>(DEFAULT_EXPORT_BOOK_KIND);

  // 打开即重置（上次选的类型不带到下一次）
  useEffect(() => {
    if (open) setKind(DEFAULT_EXPORT_BOOK_KIND);
  }, [open]);

  /** 关闭路径（Esc / 遮罩 / X / `[取消]`）；在途不许关（关框与请求错位会让 toast 落到看不见的框上） */
  function close() {
    if (exporting) return;
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <ExportBookFormBody
          name={name}
          kind={kind}
          onKindChange={setKind}
          exporting={exporting}
          onExport={() => onExport(kind)}
          onCancel={close}
        />
      </DialogContent>
    </Dialog>
  );
}
