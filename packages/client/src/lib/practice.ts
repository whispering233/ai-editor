// 文风仿写练习的领域口径（卡 9 / 卡 10 / 卡 4 改版）——**列表按作品分组 + 作品名兜底 + 样本状态徽标三态
// + 点评卡可渲染视图 + 点评帧刷新判定 + 稿件保存动作的唯一派生入口**。
//
// 契约：`docs/api/120-api-practice.md`「GET /practice/samples」的样本列表项字段
// （`workId` / `excerptLabel` / `hasDraft` / `hasFeedback`，列表不回正文与卡体）、
// 「GET /practice/samples/:id」的点评卡形状（内层恒 snake_case、读取侧只防「非对象」）、
// 「PUT /practice/samples/:id」（唯一的用户写稿入口）、
// `docs/ui/DESIGN.md` §作家文风练习区（列表分组顺序 / 样本行 `type-badge` 文案 =「未写稿」/「待点评」/「已点评」；
// 点评卡渲染）、`docs/design/60-practice.md` §3（作品清单封闭 + 「其他」兜底）。
//
// 优先级（先判卡再加稿）：有点评卡必然有稿（点评由 AI 读稿产出，见 `60-practice.md` §2），
// 故 `hasFeedback` 优先不会掩盖稿件状态；页面/组件不得各写一份 `hasFeedback ? … : hasDraft ? …`
// （同一形状三次复发是仓库登记过的类别——值改了、别的副本没改）。

import {
  PRACTICE_OTHER_WORK_LABEL,
  TOOL_DETAILS_TO_CLIENT,
  type AuthorEntry,
  type PracticeFeedbackCard,
  type PracticeSampleSummary,
} from "@whispering233/ai-editor-shared";
import { ApiError, CLIENT_NETWORK_ERROR, updatePracticeSampleDraft } from "./api";

/** 样本状态徽标文案（三态；列表行与将来的详情页共用同一份文案） */
export type PracticeSampleStatus = "未写稿" | "待点评" | "已点评";

/**
 * 样本列表项 → 状态徽标文案（三态，见文件头优先级说明）。
 * 入参只需两个布尔位（列表项与详情页都能给出），不绑死整个响应对象。
 */
export function practiceSampleStatus(
  sample: Pick<PracticeSampleSummary, "hasDraft" | "hasFeedback">,
): PracticeSampleStatus {
  if (sample.hasFeedback) return "已点评";
  if (sample.hasDraft) return "待点评";
  return "未写稿";
}

// ============ 作品（列表分组与详情页头的显示名） ============

/**
 * 作品显示名：预置作品清单内的作品名；`null`（其他）/ 未知 id（预置被移除）/ 作家未解析 → 「其他」。
 * 兜底文案的唯一定义 = shared `PRACTICE_OTHER_WORK_LABEL`（列表组标题、新建弹窗下拉、详情页头三处取它）。
 */
export function practiceWorkLabel(author: AuthorEntry | null, workId: string | null): string {
  if (workId === null || author === null) return PRACTICE_OTHER_WORK_LABEL;
  return author.works.find((work) => work.id === workId)?.name ?? PRACTICE_OTHER_WORK_LABEL;
}

/** 一个作品分组（`workId === null` = 末尾的「其他」组） */
export interface PracticeSampleGroup {
  workId: string | null;
  name: string;
  samples: PracticeSampleSummary[];
}

/**
 * 样本列表 → 按作品分组（列表页的**唯一**分组入口）：顺序 = 预置作品清单顺序 + 末尾「其他」组；
 * 无样本的组不出现在结果里；组内按 `updatedAt` 倒序（显式排一次——分组后不能再依赖
 * 「服务端整体已倒序」这个前提）。未知 `workId` 与 `null` 同归「其他」（`60-practice.md` §3）。
 */
export function practiceSampleGroups(
  author: AuthorEntry | null,
  samples: PracticeSampleSummary[],
): PracticeSampleGroup[] {
  const groups: PracticeSampleGroup[] = (author?.works ?? []).map((work) => ({
    workId: work.id,
    name: work.name,
    samples: [],
  }));
  const other: PracticeSampleGroup = {
    workId: null,
    name: PRACTICE_OTHER_WORK_LABEL,
    samples: [],
  };
  for (const sample of samples) {
    const group = groups.find((candidate) => candidate.workId === sample.workId) ?? other;
    group.samples.push(sample);
  }
  return [...groups, other]
    .filter((group) => group.samples.length > 0)
    .map((group) => ({
      ...group,
      samples: [...group.samples].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }));
}

// ============ 点评卡（卡 10） ============

/**
 * 点评卡的维度（读取侧归一）：字段名与卡体一致（内层恒 snake_case——`docs/api/120-api-practice.md`
 * 「嵌套对象内部字段按公共约定原样透传」，客户端不做 camelCase 改名，避免同一概念两种拼法）。
 */
export interface PracticeFeedbackDimension {
  name: string;
  sample_trait: string;
  draft_trait: string;
  sample_quotes: string[];
  draft_quotes: string[];
  advice: string;
}

/** 点评卡可渲染视图（`dimensions` 恒为数组、字段恒为字符串 —— 渲染层不再判类型） */
export interface PracticeFeedbackView {
  /** 一句话总评（空串 / 纯空白 → null，渲染层不画该行） */
  summary: string | null;
  dimensions: PracticeFeedbackDimension[];
}

/** 文本字段收窄：非字符串 / 空串 / 纯空白 → `""`（渲染层据此画空值） */
function cardText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 引用数组收窄：非数组 → `[]`；非字符串与纯空白项**逐条丢弃**（写入侧已丢一轮，这里只防手改库/旧值） */
function cardQuotes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((quote): quote is string => typeof quote === "string" && quote.trim() !== "");
}

/** 一个维度 → 视图（逐字段收窄；整体无内容 → null，调用方丢弃该维度） */
function feedbackDimension(raw: unknown): PracticeFeedbackDimension | null {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const dimension: PracticeFeedbackDimension = {
    name: cardText(record.name),
    sample_trait: cardText(record.sample_trait),
    draft_trait: cardText(record.draft_trait),
    sample_quotes: cardQuotes(record.sample_quotes),
    draft_quotes: cardQuotes(record.draft_quotes),
    advice: cardText(record.advice),
  };
  const hasContent =
    dimension.name !== "" ||
    dimension.sample_trait !== "" ||
    dimension.draft_trait !== "" ||
    dimension.advice !== "" ||
    dimension.sample_quotes.length > 0 ||
    dimension.draft_quotes.length > 0;
  return hasContent ? dimension : null;
}

/**
 * 点评卡（`GET /practice/samples/:id` 的 `feedback`）→ 可渲染视图；**无卡 / 卡里没有任何可展示内容 → null**
 * （调用方据此给一行 `caption-text` 空态，不出现空白卡面）。
 *
 * 为什么必须在渲染前收窄：读取侧**只防「非对象」**（非法 JSON / 数组 / 字符串 / `null` → null），
 * 合法 JSON 对象一律原样透传（`{}` 亦然）——卡内形状校验在**写入侧**（提交点评工具）
 * ⇒ 客户端**不得**对响应 schema 调 `.parse()`，只能逐字段防御读取。
 */
export function practiceFeedbackView(
  feedback: PracticeFeedbackCard | null,
): PracticeFeedbackView | null {
  if (feedback === null || typeof feedback !== "object" || Array.isArray(feedback)) return null;
  // SAFETY: 上面的非 null 对象判定后，卡体是「合法 JSON 对象但形状未知」（写入侧校验、读取侧透传）
  const record = feedback as unknown as Record<string, unknown>;
  const rawDimensions = Array.isArray(record.dimensions) ? record.dimensions : [];
  const dimensions = rawDimensions
    .map(feedbackDimension)
    .filter((dimension): dimension is PracticeFeedbackDimension => dimension !== null);
  const summary = cardText(record.summary);
  if (dimensions.length === 0 && summary === "") return null;
  return { summary: summary === "" ? null : summary, dimensions };
}

// ============ 稿件保存（卡 10） ============

/** 保存失败的形态（页面据此分流：`PRACTICE_NOT_FOUND` → 整页 404 态，其余 → 错误条 + 重试） */
export interface PracticeSaveFailure {
  code: string;
  message: string;
}

export interface PracticeSaveDeps {
  sampleId: string;
  draft: string;
  /** 写入成功：`updatedAt` = 服务端新版本戳（页面据此前移「已保存稿件」镜像，并给「已保存」反馈） */
  onSaved: (updatedAt: string) => void;
  /** 写入失败：码 + 可展示文案（不抛错——失败交回调用方做可见 UI） */
  onFailed: (failure: PracticeSaveFailure) => void;
}

/**
 * 提交仿写稿（页内「保存」按钮与全站 `Ctrl/Cmd+S` 的同一入口）：**返回 `false` = 本次保存失败**。
 *
 * 为什么是布尔而不是抛错：快捷键流程只认两种失败信号——promise 拒绝与 handler 返回 `false`；
 * 而各页保存动作都在本地 catch 并给可见 UI（错误条 / 404 态）⇒ promise 恒 resolve，
 * **只有这个布尔能把「失败」传回去阻断存档**（否则失败后照旧生成一份旧内容备份，见
 * `lib/save-shortcut.ts` 的 `SaveHandler` 契约与 `use-save-archive` 的 toast）。
 * 错误码原样带出（不吞码）——页面按码分流，不在这里决定 UI。
 */
export async function savePracticeDraft(deps: PracticeSaveDeps): Promise<boolean> {
  try {
    const res = await updatePracticeSampleDraft(deps.sampleId, deps.draft);
    deps.onSaved(res.updatedAt);
    return true;
  } catch (err) {
    deps.onFailed({
      code: err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR,
      message: err instanceof ApiError ? err.message : "保存失败，请重试",
    });
    return false;
  }
}

// ============ 点评触发与刷新信号（卡 10） ============

/**
 * 触发点评的**用户可见**消息文案（`60-practice.md` §5：点评触发 = 一条真实的用户消息，
 * 透明可回溯、不引入隐藏语义）；**唯一定义处**——页面与测试同源，不两处各写一份字面量。
 */
export const PRACTICE_REVIEW_MESSAGE = "请点评我的仿写稿";

/**
 * 能否点「让 AI 点评」（**纯判定**）：有**已保存**的稿件，且输入框里的内容与服务端一致。
 * 为什么要求一致：AI 读的是库里的 `draft`（工具面只有只读工具）——输入框里有未保存的改动时，
 * 点评的对象是旧稿，与用户眼前看到的不是同一份。
 *
 * **两种练习共用一个谓词**（入参只需 `{ draft }`）：仿写稿与自由练习稿的可点性口径逐字相同，
 * 各留一份副本就是「同一形状两次复发」的漂移风险（本仓登记过的缺陷类别）。
 */
export function canRequestPracticeReview(
  detail: { draft: string },
  draft: string,
): boolean {
  return detail.draft.trim() !== "" && draft === detail.draft;
}

/**
 * 工具 `details` 帧归属的样本 id（取不到 = `null`）：
 * 帧本身只有写库结果（`{ saved, dimension_count, dropped_quotes }`）——**没有卡体，也没有样本 id**
 * ⇒ 要靠 `tool_execution_start` 帧的入参 `args.sample_id` 认领（聊天 store 把两者并进同一条记录）。
 * 工具名集合取自 shared `TOOL_DETAILS_TO_CLIENT`（什么工具的 details 会随帧下发，唯一出处），不手抄。
 */
export function practiceFeedbackSignalSampleId(
  frame: { tool: string; args?: unknown } | null,
): string | null {
  if (frame === null) return null;
  if (!(TOOL_DETAILS_TO_CLIENT as readonly string[]).includes(frame.tool)) return null;
  const args = frame.args;
  if (typeof args !== "object" || args === null) return null;
  const sampleId = (args as { sample_id?: unknown }).sample_id;
  return typeof sampleId === "string" ? sampleId : null;
}

/**
 * 是否该为本页样本重拉点评卡（**纯判定**；页面 effect 只负责「判完就重拉」）：
 * - 无帧 / 旧帧（序号未前进）→ false（同一个帧不得重复触发；页面重挂后 store 里仍有旧帧）
 * - 别的样本的帧 → false（点评帧会推到所有页面，本页只认自己这份）
 * 消费序号由调用方持有（页面 ref），本函数不持状态（同 `hooks/use-data-refresh` 的首帧守卫口径）。
 */
export function shouldRefreshPracticeCard(args: {
  /** 当前帧序号（无帧 = null） */
  seq: number | null;
  /** 已消费到的帧序号（null = 还没消费过任何帧） */
  consumedSeq: number | null;
  /** 帧归属的样本 id（= `practiceFeedbackSignalSampleId` 的结果） */
  signalSampleId: string | null;
  /** 本页样本 id */
  sampleId: string;
}): boolean {
  if (args.seq === null || args.seq === args.consumedSeq) return false;
  return args.signalSampleId !== null && args.signalSampleId === args.sampleId;
}
