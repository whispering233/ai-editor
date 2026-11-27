// `export-book-dialog`（DESIGN.md §书架主页 `export-book-dialog`）：导出类型选择——受控 `Dialog`，
// 复用 `components/ui/dialog.tsx`，不新造浮层。
//
// 形态：标题 `导出《书名》` + **竖排单选项**（antd `Radio.Group`，默认 `项目压缩文件`；
// 小说工作区三项，练习工作区只一项——`小说文档` / `纯文本` 是小说语义，服务端
// `export-novel` / `export-novel-txt` 对练习工作区返 400 `KIND_MISMATCH`，故 UI 按 kind 隐藏）；
// caption 排在选项下方，文案照 DESIGN.md 表格逐字；选中 `纯文本` 时在单选组**之外**多一个
// 「网文排版」勾选（默认不勾、不记忆、在途禁用）+ Footer `[取消]` / `[导出]`（primary；
// 在途 `loading` 与 `disabled`（防连点））。
// **本组件只上报所选类型与排版**（`onExport(kind, layout)`）：落盘下载、错误分流、toast、关框
// 都归调用方（书架页把三条产物接到同一 `<a download>` 管道）。
// 分层：容器 `ExportBookDialog`（自持选中态）+ 内容体 `ExportBookFormBody`（portal 不能在 SSR
// 渲染，仓内无 jsdom ⇒ 拆出本层供 `renderToString` 走查，同 `character-create-dialog` 先例）。
import { useEffect, useState } from "react";
import { useElapsedSeconds, longTaskElapsedLabel } from "../../hooks/use-elapsed-seconds";
import { Button, Checkbox, Radio } from "antd";
import type { NovelTxtLayout, WorkspaceKind } from "@whispering233/ai-editor-shared";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** 导出类型（三个产物互斥：三文件备份包 / markdown 小说文档 / 整本纯文本） */
export type ExportBookKind = "project" | "novel" | "txt";

/** 默认选中项 = 项目压缩文件（**无损**的那条不作默认是相反的错误——有损产物必须是用户的显式选择） */
export const DEFAULT_EXPORT_BOOK_KIND: ExportBookKind = "project";

/** 单选项（顺序 = 展示顺序，首项即默认）：label + caption 文案（`{书名}` 由调用方传入）；
 * `novel` / `txt` 项只对小说工作区可见（见 `exportBookOptions`） */
export const EXPORT_BOOK_OPTIONS: readonly {
  kind: ExportBookKind;
  label: string;
  caption: (name: string) => string;
}[] = [
  {
    kind: "project",
    label: "项目压缩文件",
    caption: (name) => `${name}.zip · 三文件 + 项目规则（若有）· 可再导入（无损）`,
  },
  {
    kind: "novel",
    label: "小说文档",
    caption: (name) => `${name}-小说文档.zip · 卷/章 markdown 目录树 · 有损`,
  },
  {
    kind: "txt",
    label: "纯文本",
    caption: (name) => `${name}.txt · 整本单文件 · UTF-8 · 有损`,
  },
];

/** 「纯文本」的排版勾选文案（DESIGN.md 逐字；只影响该次导出） */
export const WEBNOVEL_LAYOUT_LABEL = "网文排版（段首缩进、段间不空行；文件名加 -网文）";

/**
 * 该工作区可用的导出项：练习工作区只给 `项目压缩文件`——`小说文档` / `纯文本` 是小说语义
 * （服务端 `/project/export-novel` / `/project/export-novel-txt` 对练习工作区 400
 * `KIND_MISMATCH`，故 UI 不给这两个选项）。
 */
export function exportBookOptions(workspaceKind: WorkspaceKind) {
  return EXPORT_BOOK_OPTIONS.filter((option) => workspaceKind === "novel" || option.kind === "project");
}

/** 导出成功 toast（三种产物三句话；文案单一定义，调用点不手抄） */
export function exportBookToast(kind: ExportBookKind, name: string): string {
  if (kind === "novel") return `已导出《${name}》小说文档`;
  if (kind === "txt") return `已导出《${name}》纯文本`;
  return `已导出《${name}》备份`;
}

export interface ExportBookFormBodyProps {
  /** 书名（进标题与三处 caption） */
  name: string;
  /** 当前工作区类型（决定可选导出项：练习工作区只留「项目压缩文件」） */
  workspaceKind: WorkspaceKind;
  /** 所选导出类型（受控） */
  kind: ExportBookKind;
  onKindChange: (kind: ExportBookKind) => void;
  /** 「网文排版」勾选（受控；只在 `纯文本` 选中时渲染，默认不勾、不记忆） */
  webnovel: boolean;
  onWebnovelChange: (webnovel: boolean) => void;
  /** 导出在途：单选项与 `[取消]` 禁用、`[导出]` loading（防连点） */
  exporting: boolean;
  /** 已用时文案（容器派生；阀值之前为 null = 不渲染） */
  elapsedHint?: string | null;
  onExport: () => void;
  onCancel: () => void;
}

/** 导出类型框内容体（纯展示：无 effect、无请求——SSR 可直渲染） */
export function ExportBookFormBody({
  name,
  workspaceKind,
  kind,
  onKindChange,
  webnovel,
  onWebnovelChange,
  exporting,
  elapsedHint = null,
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
        {exportBookOptions(workspaceKind).map((option) => (
          /* 每项独占一行 ⇒ 竖排（不在 `Radio.Group` 根元素上写布局类：antd 无层 CSS 会压掉） */
          <div key={option.kind} className="flex flex-col gap-0.5 py-1">
            <Radio value={option.kind}>{option.label}</Radio>
            <span className="pl-6 text-xs text-muted-foreground">{option.caption(name)}</span>
          </div>
        ))}
      </Radio.Group>
      {/* 排版勾选放在 `Radio.Group` **之外**（它不是第三种产物，只是纯文本的排版开关） */}
      {kind === "txt" && (
        <Checkbox
          checked={webnovel}
          onChange={(e) => onWebnovelChange(e.target.checked)}
          disabled={exporting}
        >
          {WEBNOVEL_LAYOUT_LABEL}
        </Checkbox>
      )}
      <DialogFooter>
        {exporting && (
          <p className="mr-auto text-xs text-muted-foreground tabular-nums">
            正在导出《{name}》…{elapsedHint !== null ? ` ${elapsedHint}` : ""}
          </p>
        )}
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
  /** 当前工作区类型（决定可选导出项：练习工作区只留「项目压缩文件」） */
  workspaceKind: WorkspaceKind;
  /** 导出在途（调用方持有） */
  exporting: boolean;
  /** 只上报所选类型与排版——下载/错误提示由调用方负责 */
  onExport: (kind: ExportBookKind, layout: NovelTxtLayout) => void;
  onOpenChange: (open: boolean) => void;
}

/** 导出类型框容器：自持选中态（每次打开重置回默认项） */
export function ExportBookDialog({
  open,
  name,
  workspaceKind,
  exporting,
  onExport,
  onOpenChange,
}: ExportBookDialogProps) {
  const [kind, setKind] = useState<ExportBookKind>(DEFAULT_EXPORT_BOOK_KIND);
  const [webnovel, setWebnovel] = useState(false);
  // 长任务反馈：只给「在跑 + 跑了多久」（无服务端进度，不编阶段与百分比）
  const elapsedHint = longTaskElapsedLabel(useElapsedSeconds(exporting));

  // 打开即重置（上次选的类型与排版勾选都不带到下一次）
  useEffect(() => {
    if (!open) return;
    setKind(DEFAULT_EXPORT_BOOK_KIND);
    setWebnovel(false);
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
      <DialogContent width="md">
        <ExportBookFormBody
          name={name}
          workspaceKind={workspaceKind}
          kind={kind}
          onKindChange={setKind}
          webnovel={webnovel}
          onWebnovelChange={setWebnovel}
          exporting={exporting}
          elapsedHint={elapsedHint}
          onExport={() => onExport(kind, kind === "txt" && webnovel ? "webnovel" : "preserve")}
          onCancel={close}
        />
      </DialogContent>
    </Dialog>
  );
}
