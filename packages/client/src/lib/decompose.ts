// 拆解小说预览的展示口径纯函数（卡 21.8）
//
// 契约：docs/ui/DESIGN.md §拆解小说（统计行 / 警告行 / 预估行口径）+
// docs/api/120-api-decompose.md §analyze（响应字段语义）。对话框三态与请求副作用在
// `components/decompose/decompose-dialog.tsx`（仓内无 jsdom，渲染走 SSR 直渲染 presenter），
// 凡是「文案里出现哪个数、不出现哪个数」的口径都收在这里，逐条可单测。
import type { DecomposeAnalyzeRes } from "@whispering233/ai-editor-shared";

/** 范围预估（`analyze` 响应里的一段；shared 只导出响应整体类型，故按字段取） */
type DecomposeEstimate = DecomposeAnalyzeRes["estimate"];

/** 千分位（确定性实现，不依赖 host locale / ICU 数据——测试与浏览器同口径） */
export function formatCharCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 文件名 → 默认书名：去目录、去最后一个扩展名、trim；去完为空则回退原名。
 * 与服务端 `routes/decompose.ts` 的 `defaultBookName` 同口径——服务端返回的 `defaultName`
 * 才是权威值（analyze 响应里回填），此处只在文件选定那一刻先给一个立即可见的默认值。
 * 合法性不在这里判：走 `lib/book-name.ts` 的 `validateBookName`（客户端单一书名校验）。
 */
export function defaultBookNameFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  const stripped = (dot <= 0 ? base : base.slice(0, dot)).trim();
  return stripped === "" ? base : stripped;
}

/** 编码探测结果的中文标签（探测本身由服务端做，客户端只展示） */
const ENCODING_LABELS: Record<DecomposeAnalyzeRes["encoding"], string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 (BOM)",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  gb18030: "GB18030",
};

/**
 * 统计行：编码 / 总字数 / 章数 / 卷数 / 单章字数分布。
 * **只展示 `totalChars` 一个总数字段**——各章字数之和不等于它（卷标题、目录页丢弃、空行等都不计），
 * 两个总数并排显示会被读成「丢字了」（DESIGN §拆解小说 预览口径）。
 */
export function formatPreviewStats(preview: DecomposeAnalyzeRes): string {
  const { stats } = preview;
  return [
    `编码 ${ENCODING_LABELS[preview.encoding]}`,
    `总字数 ${formatCharCount(preview.totalChars)}`,
    `章数 ${formatCharCount(preview.chapters.length)}`,
    `卷数 ${formatCharCount(preview.volumes.length)}`,
    `单章字数 最少 ${formatCharCount(stats.min)} / 中位 ${formatCharCount(stats.median)} / 最多 ${formatCharCount(stats.max)}`,
  ].join(" · ");
}

/**
 * 费用档：`costApprox` 来自 pi 模型目录费率（USD/百万 token，服务端唯一口径）。
 * 未配置模型/凭据 → `null`，**必须说「算不出」而不是显示 $0**（$0 会被读成免费）；
 * 极小费用显示 `$0.00` 同理——四舍五入到分以下就说「小于 $0.01」。
 */
function formatCost(cost: number | null): string {
  if (cost === null) return "粗估费用未知（未配置模型或凭据）";
  if (cost < 0.01) return "粗估费用 小于 $0.01";
  return `粗估费用 ≈ $${cost.toFixed(2)}`;
}

/** 预估行：批次数 / 调用次数 / 粗估费用（DESIGN §拆解小说 预估行口径） */
export function formatEstimate(estimate: DecomposeEstimate): string {
  return [
    `预计 ${formatCharCount(estimate.batchCount)} 批`,
    `${formatCharCount(estimate.llmCalls)} 次调用`,
    formatCost(estimate.costApprox),
  ].join(" · ");
}

/**
 * 范围输入（两个文本框，空 = 缺省）→ analyze / start 的 query 参数。
 * 非正整数一律当未填（缺省语义 = 起始 1 / 结束到末章）——越界由服务端夹取，客户端不预判。
 */
export function parseScopeInput(
  start: string,
  end: string,
): {
  scopeStart?: number;
  scopeEnd?: number;
} {
  const parse = (raw: string): number | undefined => {
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isInteger(n) && n >= 1 ? n : undefined;
  };
  const scopeStart = parse(start);
  const scopeEnd = parse(end);
  return {
    ...(scopeStart !== undefined ? { scopeStart } : {}),
    ...(scopeEnd !== undefined ? { scopeEnd } : {}),
  };
}
