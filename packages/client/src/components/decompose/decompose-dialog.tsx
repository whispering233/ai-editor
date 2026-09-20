// 拆解小说对话框（卡 21.8）：书架「新建一本…」行入口 → **三态 = 选文件 → 预览 → 填名开始**。
//
// 契约：docs/ui/DESIGN.md §拆解小说（入口形态 / 预览口径 / 不新增色值·字号·圆角）；
// 接口 docs/api/120-api-decompose.md §analyze / §start（请求体 = 文件原始字节，范围变更 = 重传）。
//
// 分层：容器 `DecomposeDialog`（状态 + 请求副作用）+ presenter `DecomposeDialogView`（纯渲染）。
// 为什么拆：仓内无 jsdom，presenter 用 react-dom/server 直渲染走查三态文案与入口形状
// （同 `components/outline/chapter-view.tsx` 惯例）；对话框壳复用受控 `components/ui/dialog.tsx`。
// 选文件走原生 `<input type="file">`：**浏览器与桌面同一路径，不新增 preload 能力**。
import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Button, Input, Typography } from "antd";
import type { DecomposeAnalyzeRes } from "@whispering233/ai-editor-shared";
import { ApiError, analyzeDecompose, startDecompose } from "../../lib/api";
import { validateBookName } from "../../lib/book-name";
import {
  defaultBookNameFromFileName,
  formatCharCount,
  formatEstimate,
  formatPreviewStats,
  parseScopeInput,
} from "../../lib/decompose";
import { describeDecomposeError } from "../../lib/error-messages";
import { navigate } from "../../hooks/use-route";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/** 文件框样式（同 Dashboard 导入备份框：原生 `input` 无 antd token，走语义类） */
const FILE_INPUT_CLASS =
  "block w-full cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:text-muted-foreground disabled:opacity-50";

export interface DecomposeViewHandlers {
  onPickFile: (file: File) => void;
  onScopeStartChange: (value: string) => void;
  onScopeEndChange: (value: string) => void;
  /** 范围输入落定（blur / 回车）——变了才重新 analyze */
  onScopeCommit: () => void;
  onNameChange: (value: string) => void;
  onStart: () => void;
  onClose: () => void;
}

export interface DecomposeViewProps {
  /** 切分预览（null = 还没出结果 ⇒ 渲染选文件态） */
  preview: DecomposeAnalyzeRes | null;
  analyzing: boolean;
  scopeStart: string;
  scopeEnd: string;
  name: string;
  /** 书名校验结果（`validateBookName` 单一来源；非 null 时禁止开始） */
  nameError: string | null;
  /** 框内错误文案（analyze / start 失败） */
  error: string | null;
  starting: boolean;
  handlers: DecomposeViewHandlers;
}

/** presenter：三态 = 选文件（无 preview）/ 解析中（无 preview + analyzing）/ 预览 + 填名开始 */
export function DecomposeDialogView({
  preview,
  analyzing,
  scopeStart,
  scopeEnd,
  name,
  nameError,
  error,
  starting,
  handlers,
}: DecomposeViewProps) {
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    // 清空 value：同一个文件重选时 change 才会再次触发（失败重试路径）
    event.target.value = "";
    if (picked !== null) handlers.onPickFile(picked);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>拆解小说</DialogTitle>
        <DialogDescription>
          导入一本 txt 小说：先预览切分与预估，确认后开始拆解（正文全量导入，范围只影响 AI 抽取）
        </DialogDescription>
      </DialogHeader>

      <input
        type="file"
        accept=".txt"
        onChange={handleFileChange}
        disabled={analyzing || starting}
        aria-label="选择小说文件"
        className={FILE_INPUT_CLASS}
      />

      {preview === null ? (
        <>
          <p className="text-xs text-muted-foreground">
            编码自动探测（UTF-8 / UTF-16 / GB18030），文件由本机服务解析
          </p>
          {analyzing && <p className="text-sm text-muted-foreground">正在解析文件…</p>}
        </>
      ) : (
        <>
          {/* 统计行：只展示 totalChars 一个总数字段（章字数和不等于它，并排会被读成丢字） */}
          <p className="text-xs text-muted-foreground">{formatPreviewStats(preview)}</p>

          {/* 警告行：编号重启 / 疑似合并章 / 目录页丢弃 / 退化等分（文案由服务端给，客户端不映射代码） */}
          {preview.warnings.map((warning, index) => (
            <Typography.Text
              key={`${warning.code}-${index}`}
              type="warning"
              className="block"
            >
              {warning.message}
            </Typography.Text>
          ))}

          {/* 章列表：全量渲染（数百行不引虚拟滚动），列 = 序号 / 标题 / 字数 */}
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            <ul className="divide-y divide-border">
              {preview.chapters.map((chapter) => (
                <li key={chapter.index} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <span className="w-10 shrink-0 text-muted-foreground tabular-nums">
                    {chapter.index}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={chapter.title}>
                    {chapter.title}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatCharCount(chapter.charCount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* 范围选择：留空 = 全书；输入框不挂布局类（antd 根元素无层 CSS 会压掉工具类） */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">拆解范围</span>
            <div className="w-20 shrink-0">
              <Input
                type="number"
                min={1}
                value={scopeStart}
                placeholder="起始"
                aria-label="起始章"
                onChange={(e) => handlers.onScopeStartChange(e.target.value)}
                onBlur={handlers.onScopeCommit}
                onPressEnter={handlers.onScopeCommit}
              />
            </div>
            <span className="shrink-0 text-sm text-muted-foreground">至</span>
            <div className="w-20 shrink-0">
              <Input
                type="number"
                min={1}
                value={scopeEnd}
                placeholder="结束"
                aria-label="结束章"
                onChange={(e) => handlers.onScopeEndChange(e.target.value)}
                onBlur={handlers.onScopeCommit}
                onPressEnter={handlers.onScopeCommit}
              />
            </div>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              留空 = 全书（正文全量导入）
            </span>
          </div>

          {/* 预估行 + 书名（默认取文件名去扩展名，校验复用书名校验） */}
          <p className="text-sm">
            {formatEstimate(preview.estimate)}
            {analyzing && (
              <span className="text-xs text-muted-foreground"> · 正在按新范围重估…</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">书名</span>
            <div className="min-w-0 flex-1">
              <Input
                value={name}
                maxLength={60}
                aria-label="书名"
                disabled={starting}
                onChange={(e) => handlers.onNameChange(e.target.value)}
              />
            </div>
          </div>
          {nameError !== null && <p className="text-sm text-destructive">{nameError}</p>}
        </>
      )}

      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button onClick={handlers.onClose} disabled={starting}>
          取消
        </Button>
        {/* 主操作只在预览（+ 填名）态出现——还没出预览时「开始拆解」无处可拆 */}
        {preview !== null && (
          <Button
            type="primary"
            onClick={handlers.onStart}
            loading={starting}
            disabled={starting || nameError !== null}
          >
            开始拆解
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

export interface DecomposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 容器：状态机 + analyze / start 请求（presenter 只收展示值与回调） */
export function DecomposeDialog({ open, onOpenChange }: DecomposeDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DecomposeAnalyzeRes | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [scopeStart, setScopeStart] = useState("");
  const [scopeEnd, setScopeEnd] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** 请求序号：旧 analyze 响应迟到不得覆盖新一次的文件/范围结果（事件级流身份守卫） */
  const seq = useRef(0);
  /** 已出预览的范围（`start|end`）：blur 时范围没变就不重传字节 */
  const analyzedScope = useRef<string | null>(null);
  /** 书名是否被用户改过：改过就不再被默认名（含服务端 defaultName）覆盖 */
  const nameTouched = useRef(false);

  const nameError = validateBookName(name);

  async function runAnalyze(target: File, start: string, end: string) {
    const mine = ++seq.current;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await analyzeDecompose(target, parseScopeInput(start, end));
      if (mine !== seq.current) return;
      setPreview(res);
      if (!nameTouched.current) setName(res.defaultName);
      analyzedScope.current = `${start}|${end}`;
    } catch (err) {
      if (mine !== seq.current) return;
      setPreview(null);
      analyzedScope.current = null;
      setError(describeDecomposeError(codeOf(err), messageOf(err)));
    } finally {
      if (mine === seq.current) setAnalyzing(false);
    }
  }

  function handlePickFile(picked: File) {
    setFile(picked);
    setName(defaultBookNameFromFileName(picked.name));
    nameTouched.current = false;
    setScopeStart("");
    setScopeEnd("");
    void runAnalyze(picked, "", "");
  }

  function handleScopeCommit() {
    if (file === null) return;
    if (analyzedScope.current === `${scopeStart}|${scopeEnd}`) return;
    void runAnalyze(file, scopeStart, scopeEnd);
  }

  async function handleStart() {
    if (file === null || nameError !== null) return;
    setStarting(true);
    setError(null);
    try {
      await startDecompose(file, { name: name.trim(), ...parseScopeInput(scopeStart, scopeEnd) });
      // start 已把新项目打开（服务端 S1 同步完成）→ 去进度页（路由由卡 21.9 建）
      handleOpenChange(false);
      navigate("/decompose");
    } catch (err) {
      setError(describeDecomposeError(codeOf(err), messageOf(err)));
      setStarting(false);
    }
  }

  /** 关闭 = 复位：下次打开从「选文件」开始（已上传的字节不缓存，服务端也不留临时文件） */
  function handleOpenChange(next: boolean) {
    if (next) {
      onOpenChange(true);
      return;
    }
    seq.current += 1; // 在途 analyze 的迟到响应作废
    setFile(null);
    setPreview(null);
    setAnalyzing(false);
    setScopeStart("");
    setScopeEnd("");
    setName("");
    setError(null);
    setStarting(false);
    analyzedScope.current = null;
    nameTouched.current = false;
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DecomposeDialogView
          preview={preview}
          analyzing={analyzing}
          scopeStart={scopeStart}
          scopeEnd={scopeEnd}
          name={name}
          nameError={nameError}
          error={error}
          starting={starting}
          handlers={{
            onPickFile: handlePickFile,
            onScopeStartChange: setScopeStart,
            onScopeEndChange: setScopeEnd,
            onScopeCommit: handleScopeCommit,
            onNameChange: (value) => {
              nameTouched.current = true;
              setName(value);
            },
            onStart: () => void handleStart(),
            onClose: () => handleOpenChange(false),
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** ApiError → 错误码（非 ApiError 视为未知码，走兜底文案） */
function codeOf(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "";
}
