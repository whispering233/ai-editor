// 拆解小说的展示口径纯函数（卡 21.8 预览 + 卡 21.9 进度面）
//
// 契约：docs/ui/DESIGN.md §拆解小说（预览统计行 / 警告行 / 预估行；进度页阶段条 / 进度文案 / 批列表 /
// 完成总结 / 书架徽标）+ docs/api/120-api-decompose.md §analyze … §rerun（响应字段语义）。
// 对话框与进度页只做渲染与请求副作用（仓内无 jsdom，渲染走 SSR 直渲染 presenter），
// 凡是「文案里出现哪个数、不出现哪个数」的口径都收在这里，逐条可单测。
import type {
  DecomposeAnalyzeRes,
  DecomposeBatchRes,
  DecomposeBatchResult,
  DecomposeJobRes,
} from "@whispering233/ai-editor-shared";
import { relationTypeLabel } from "./entity-detail";

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

// ============ 进度面（卡 21.9：进度页 + 概览卡片 + 书架徽标） ============

/** 批状态（`GET /decompose/job` 的 batches[].status 与 `batches/:seq` 同集） */
export type DecomposeBatchStatus = DecomposeBatchRes["status"];

/** 阶段条 5 段（DESIGN.md §拆解小说 = docs/design/60-decompose.md §2 的 S0–S4） */
export const DECOMPOSE_STAGE_LABELS = ["解析", "建档", "逐章抽取", "归并", "报告"] as const;

/**
 * 服务端 `stage` → 阶段条状态（`completed` = 已完成段数，`current` = 当前段下标，null = 无当前段）。
 *
 * 为什么 `ingest` 是「解析已完成 / 建档为当前段」：服务端把 S0（解析）与 S1（建档）合成一个 `ingest`
 * （`deriveStage` 只在 job `pending` 时给该值，即 S0 已出切分、S1 尚未落完），段条上没有任何单独信号能
 * 把这两段分开——按「解析已出结果、建档进行中」呈现比把两段都标未开始更贴近事实。`done` = 5 段全完成。
 */
export function stageProgress(stage: DecomposeJobRes["stage"]): {
  completed: number;
  current: number | null;
} {
  switch (stage) {
    case "ingest":
      return { completed: 1, current: 1 };
    case "extract":
      return { completed: 2, current: 2 };
    case "merge":
      return { completed: 3, current: 3 };
    case "report":
      return { completed: 4, current: 4 };
    case "done":
      return { completed: DECOMPOSE_STAGE_LABELS.length, current: null };
  }
}

/** 进度条百分比（0–100 整数；total = 0（范围为空）→ 0，不出现 NaN） */
export function batchPercent(progress: { done: number; total: number }): number {
  return progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
}

/** 进度文案（`caption-text`，进度条右侧）：「已完成 N/M 批」 */
export function formatBatchProgress(progress: { done: number; total: number }): string {
  return `已完成 ${progress.done}/${progress.total} 批`;
}

/** 批状态徽标文案（`type-badge`，中性——状态不参与 tint；DESIGN.md §拆解小说 批次列表列口径） */
export function batchStatusLabel(status: DecomposeBatchStatus): string {
  switch (status) {
    case "pending":
      return "待抽取";
    case "running":
      return "抽取中";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
  }
}

/** 覆盖章范围文案（章序 = 文件位置序，与大纲页同源）：单章「第 3 章」/ 多章「第 1–5 章」/
 * 空（该批的章已被物理删）→「—」 */
export function formatBatchChapters(chapterIndexes: readonly number[]): string {
  if (chapterIndexes.length === 0) return "—";
  const first = chapterIndexes[0]!;
  const last = chapterIndexes[chapterIndexes.length - 1]!;
  return first === last ? `第 ${first} 章` : `第 ${first}–${last} 章`;
}

/** 拆解范围文案（`job.scopeStart` / `scopeEnd`；范围为空 = start > end，服务端照样起 job） */
export function formatJobScope(scopeStart: number, scopeEnd: number): string {
  if (scopeStart > scopeEnd) return "范围为空";
  return scopeStart === scopeEnd ? `第 ${scopeStart} 章` : `第 ${scopeStart}–${scopeEnd} 章`;
}

/**
 * 页头元信息行（书名 · 范围 · 当前模型）。
 *
 * **模型口径 = `GET /settings/llm` 的当前激活模型**（不是该 job 的审计模型——`decompose_jobs.model`
 * 只是 start 时的记账值，resume / rerun 实际用的都是当下激活模型；job 响应也不含该字段）。
 * 取不到（未配置 / 请求失败）时 `model = null` ⇒ **该段不渲染**，不留空占位。
 */
export function formatJobMeta(input: {
  name: string | null;
  scopeStart: number;
  scopeEnd: number;
  model: string | null;
}): string {
  return [
    input.name ?? "",
    formatJobScope(input.scopeStart, input.scopeEnd),
    input.model === null ? "" : `当前模型 ${input.model}`,
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** `GET /settings/llm` → 「当前模型」段（provider / model 任一为空 = 未配置 → null 不显示） */
export function activeModelLabel(llm: { provider: string; model: string }): string | null {
  if (llm.provider === "" || llm.model === "") return null;
  return `${llm.provider}/${llm.model}`;
}

/**
 * 状态一行（进度页与概览卡片共用同一口径）：运行中 N/M 批 / 已暂停 · 可续拆 /
 * 上次拆解中断，可续拆 / 拆解完成 / 拆解失败。
 *
 * 「中断」判定 = job `paused` 且仍有 `running` 批：服务端**只归一 job 行**，残留的 `running` 批由
 * 续拆取批承接（docs/db/schema.md「状态归一」）——它不会自己结束，故该组合只来自服务端重启 /
 * 切书中断。已知代价：用户点「中止」后的那一次轮询窗口内当前批仍在跑，文案会短暂显示「中断」。
 */
export function describeJobStatus(job: DecomposeJobRes): string {
  switch (job.status) {
    case "pending":
    case "running":
      return `运行中 ${job.progress.done}/${job.progress.total} 批`;
    case "paused":
      return job.batches.some((batch) => batch.status === "running")
        ? "上次拆解中断，可续拆"
        : "已暂停 · 可续拆";
    case "done":
      return "拆解完成";
    case "failed":
      return "拆解失败";
  }
}

/** 书架当前书行徽标（`type-badge`）：运行 / 待运行 → 「拆解中 N/M」；已暂停 → 「已暂停 N/M」
 * （DESIGN.md §拆解小说 书架行徽标——暂停还写「拆解中」是文案不准；终态无徽标由 `isTerminalJobStatus` 收窄） */
export function formatShelfBadge(job: Pick<DecomposeJobRes, "status" | "progress">): string {
  const { done, total } = job.progress;
  return `${job.status === "paused" ? "已暂停" : "拆解中"} ${done}/${total}`;
}

/** 终态判定（轮询的停止条件 + 书架徽标是否显示，同一判定只此一处）：`done` / `failed` 不再变；
 * `paused` **不是**终态（可续拆，续拆后还会跑） */
export function isTerminalJobStatus(status: DecomposeJobRes["status"]): boolean {
  return status === "done" || status === "failed";
}

/**
 * 页头操作（按状态**显示其一**）：`paused` → 续拆；`running` / `pending` → 中止；
 * 终态（done / failed）→ 无操作（done 没什么可做；failed 的补救是逐批重跑，不是续拆）。
 */
export function jobActionFor(status: DecomposeJobRes["status"]): "pause" | "resume" | null {
  if (status === "paused") return "resume";
  return isTerminalJobStatus(status) ? null : "pause";
}

/**
 * 「重跑」按钮的出现条件：服务端只接 `done` / `failed` job 上的 `done` / `failed` 批
 * （`POST /job/batches/:seq/rerun` 其余组合一律 409 DECOMPOSE_JOB_STATE）。
 * 界面按同一口径收窄 ⇒ 不留「点了必定 409」的死胡同。
 */
export function canRerunBatch(
  jobStatus: DecomposeJobRes["status"],
  batchStatus: DecomposeBatchStatus,
): boolean {
  const jobSettled = jobStatus === "done" || jobStatus === "failed";
  const batchSettled = batchStatus === "done" || batchStatus === "failed";
  return jobSettled && batchSettled;
}

/** 展开区的分组文字列表（人物 / 设定 / 地点 / 关系）——关系类型走 shared 中文标签 */
export interface BatchResultGroup {
  label: string;
  names: string[];
}

/**
 * 形状守卫：`result` 是服务端 JSON 反序列化值，章内子数组可能缺失/非数组（老库、手工改库、
 * 契约漂移）——一律当空数组，**不得抛**：展开区抛错会把整页（含左栏/聊天）交给 ErrorBoundary 换掉
 * （页面只有顶层 `result.chapters` 一层守卫，深一层只能在这里兜）。
 */
function arrayOrEmpty<T>(value: readonly T[] | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 批抽取结果 → 分组摘要（展开区；**只出名字清单，不倾倒原始 JSON**）。
 * 跨章同名去重（同一批内先出现的顺序保留），四个分组恒在（空组由调用方渲染「—」）。
 */
export function batchResultGroups(result: DecomposeBatchResult): BatchResultGroup[] {
  const characters = new Set<string>();
  const settings = new Set<string>();
  const locations = new Set<string>();
  const relations = new Set<string>();
  for (const chapter of result.chapters) {
    for (const character of arrayOrEmpty(chapter.characters)) characters.add(character.name);
    for (const setting of arrayOrEmpty(chapter.settings)) settings.add(setting.name);
    for (const location of arrayOrEmpty(chapter.locations)) locations.add(location.name);
    for (const relation of arrayOrEmpty(chapter.relations)) {
      relations.add(`${relation.source} → ${relation.target}（${relationTypeLabel(relation.type)}）`);
    }
  }
  return [
    { label: "人物", names: [...characters] },
    { label: "设定", names: [...settings] },
    { label: "地点", names: [...locations] },
    { label: "关系", names: [...relations] },
  ];
}

/** 完成总结的四项计数（null = 该项取数失败/未加载，渲染占位「–」而**不是 0**——0 是「真的没有」） */
export interface CompletionCounts {
  character: number | null;
  setting: number | null;
  location: number | null;
  relation: number | null;
}

/**
 * 完成总结计数文案（拆解完成卡的正文一行）。
 * 口径 = **库内当前计数**（人物/设定/地点取 `GET /entity/:type?limit=1` 的 total，关系取
 * `GET /relation?depth=1` 的行数），与概览页「创作要素」同源——**不解析报告正文**：报告是自然语言，
 * 提示词一改就漂，数字必须来自库。
 */
export function formatCompletionCounts(counts: CompletionCounts): string {
  return [
    `人物 ${counts.character ?? "–"}`,
    `设定 ${counts.setting ?? "–"}`,
    `地点 ${counts.location ?? "–"}`,
    `关系 ${counts.relation ?? "–"}`,
  ].join(" · ");
}
