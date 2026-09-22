// 拆解 S2 批执行器（卡 21.6 / 分段并发）：段间并行、段内串行的批循环 + 项目数据快照 +
// 逐章对齐重试 + 取消通道（暂停 / 切书 / 重启归一）+ job 收口（批全部收口后跑 S3 归并与 S4 报告，
// 随后 job 置 `done`）与单批重跑入口。
//
// 契约：docs/design/60-decompose.md §2（S3/S4 在全部批完成后各跑一次）、§2.2（分段并发）、
// §4（批调度：组批 / 重试 / 并发快照 / 项目数据快照）、§4.1（两层快照：起始快照 + 段内滚动累积、
// 预算与丢弃顺序、名字集合只服务提示词渲染）、§5（抽取 schema 口径）、§7（状态机、续拆、单批重跑）；
// docs/api/120-api-decompose.md §pause / §resume / §rerun；状态不变式见 docs/db/schema.md「decompose 两表」
// （状态归一**只归一 job 行**）。本模块的口径：
// - **段划分 = 纯函数 `planSegments`（输入 = job 快照）**：段 = 沿批边界按累计字数均衡的连续批区间，
//   段数 = min(`decompose_jobs.concurrency`, 批数)；resume / 单批重跑用同一份输入重算 ⇒ 段身份稳定，
//   worker 会话（`decompose-<jobId>-w<k>`）跟着稳定；
// - **段内滚动、段间并集**（§9 不变式 14）：每段一份独立滚动累积，起始快照**各段共用**（一轮读库一次）；
//   续拆时每段按段内已完成批重建自己的累积；跨段一致性一律交 S3 全局归并；
// - **续跑取「段内第一个未完成批」**：`done` 之外的批（`pending` / `running` / `failed`）都算未完成——
//   服务端重启残留的 `running` 批由这里承接，不单独归一；
// - **单批重跑只重跑该批**（§7）：重新抽取该批 → S3 重算（`merge_written` 三路比对保幂等）→ S4 重建报告；
// - **S2 不写业务表**：批结果只落 `decompose_batches.result`（实体 / 关系 / 大纲 / 正文只由 S3/S4 写）；
// - **批跑完时 job 留在 `running`**，全部批收口后才由 S3+S4 推到 `done`（job.ts 的 `deriveStage` 据
//   「批是否全部收口」推出 `merge` / `report`）。
//
// 调用路径：`start`（首次）/ `continue`（续拆）/ `resume`（续跑）/ 单批 `rerun` 各起一轮（路由**不 await**：长任务是后台跑）；
// 建会话前先按 `DECOMPOSE_KEPT_SESSIONS` 清理超限的更早拆解会话（§7.2，告知不静默）。
// 暂停 / 切书 = 置 abort：**每段当前批跑完即停**（在途 ≤ 段数），已发出的模型调用不 abort
// （结果不浪费，批级幂等靠 `done` 跳过）。并发下补限流兜底：批级 429 / 限流按指数退避 + 抖动再试（§2.2）。
// 模型调用只经 pi 的 `ModelRuntime`（`getModelRuntime()` / `getSettingsManager()` 唯一入口）——
// 业务代码不自建 fetch / HTTP agent（出站行为统一由启动时装的全局 undici dispatcher 承担）。
// 阈值与提示词里的数字一律取自常量（提示词按常量插值生成，散文不复述数字）。

import { unlinkSync } from "node:fs";
import type { DecomposeBatchResult, OutlineFileTree } from "@whispering233/ai-editor-shared";
import { listProjectSessions } from "@whispering233/ai-editor-agent";
import {
  completeBatch,
  deriveChapterOrder,
  failBatch,
  findOutlineNode,
  getDecomposeJob,
  getDocumentTextLengths,
  getDocumentTexts,
  listDecomposeBatches,
  listDecomposeJobs,
  listRelations,
  nowIso,
  readOutlineFile,
  setJobError,
  startBatchAttempt,
  updateJobStatus,
  type ChapterOrderInfo,
  type DecomposeBatchRow,
  type DecomposeJobRow,
} from "@whispering233/ai-editor-db";
import type { ProjectContext } from "../middleware/project.js";
import {
  DECOMPOSE_CHAPTER_MAX_CHARACTERS,
  DECOMPOSE_CHAPTER_MAX_LOCATIONS,
  DECOMPOSE_CHAPTER_MAX_RELATIONS,
  DECOMPOSE_CHAPTER_MAX_SETTINGS,
  DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS,
  DECOMPOSE_DESCRIPTION_MAX_CHARS,
  DECOMPOSE_MOTIVATION_MAX_CHARS,
  DECOMPOSE_PERSONALITY_MAX_ITEMS,
  DECOMPOSE_RELATION_TYPES,
  normalizeExtraction,
} from "./extract.js";
import { doneBatchResults } from "./job.js";
import { planSegments } from "./batching.js";
import {
  decomposeSessionId,
  decomposeWorkerSessionPrefix,
  openDecomposeSession,
  parseModelJson,
  type DecomposeLlmDeps,
  type DecomposeSegmentRef,
  type DecomposeSession,
  type ModelRequest,
} from "./llm.js";
import { normalizeEntityName } from "./merge.js";
import { listAllLiveEntities, runDecomposeMerge } from "./merge-write.js";

/** 单批尝试上限（含首次）：缺章 → 整批重试；超上限标 `failed` 并继续后续批（不阻塞整个 job） */
export const DECOMPOSE_BATCH_MAX_ATTEMPTS = 3;
/** 限流退避的起始等待（§2.2 并发布补：429 / 限流指数退避 + 抖动；后台任务慢比失败好） */
export const DECOMPOSE_RATE_LIMIT_BASE_DELAY_MS = 2_000;
/** 限流退避的等待上限（封顶；退避只发生在批内重试之间，不增加 `DECOMPOSE_BATCH_MAX_ATTEMPTS`） */
export const DECOMPOSE_RATE_LIMIT_MAX_DELAY_MS = 30_000;
/** 限流退避倍率：第 k 次尝试失败后等待 = 起始 × 倍率^(k-1)（封顶后仍带抖动） */
export const DECOMPOSE_RATE_LIMIT_FACTOR = 2;
/** 抖动下界：实际等待 ∈ [下界 × 计算值, 计算值)（多段同时退避不齐步重试） */
export const DECOMPOSE_RATE_LIMIT_JITTER_MIN = 0.5;
/** 起始快照回溯的章数（§4.1：只取紧邻范围起点的连续若干章——续拆 / 有范围时的前置连续性） */
export const DECOMPOSE_SNAPSHOT_PREV_CHAPTERS = 3;
/** 项目数据快照长度上限（§4.1：起始快照 + 本轮累积的总预算）——`routes/decompose.ts` 的每批固定开销
 * 预估由它派生（改这里预估跟着变） */
export const DECOMPOSE_SNAPSHOT_MAX_CHARS = 2000;
/** 人物 `role` 的展示权重（§4.1：主角 → … → 龙套，词表外的 role 归末位）——同时是批提示词的建议词表 */
export const DECOMPOSE_ROLE_ORDER = ["主角", "主要配角", "配角", "反派", "龙套"] as const;
/** 拆解会话保留上限（§7.2）：按 job `created_at` 保留最近这么多**个 job 的全部拆解会话**
 * （主 + worker 合计），超出的在新一轮拆解创建会话之前清掉 */
export const DECOMPOSE_KEPT_SESSIONS = 5;

/** 拆解 runner 可注入依赖（测试注入内存运行时 + faux provider 离线跑通；缺省走 pi 单例） */
export type DecomposeRunnerDeps = DecomposeLlmDeps & {
  /** 限流退避的等待实现（测试注入 no-op / 记录时长；缺省 = 真 `setTimeout`） */
  sleep?: (ms: number) => Promise<void>;
};

/** 一批里的单章素材（章序 = 1-based 文件位置序；正文 = 服务端派生的 `content_text` 投影） */
interface BatchChapter {
  index: number;
  title: string;
  text: string;
}

// ============ 项目数据快照（§4.1）：起始快照（job 开始时读库一次）+ 本轮累积（跨批滚动） ============

/** 本轮累积：跨批携带「已出现的实体名 + 关系 + 上一批摘要」——**不带上文原文** */
export interface StoryBible {
  /** 人物 / 设定 / 地点的名字（按 `normalizeEntityName` 去重、保持出现顺序） */
  names: string[];
  /** 已出现的关系（`源→靶（类型）`，去重） */
  relations: string[];
  /** **上一批**各章摘要（整批替换：跨批只需最近一批，不占预算） */
  summaries: string[];
}

export function emptyStoryBible(): StoryBible {
  return { names: [], relations: [], summaries: [] };
}

/**
 * 归并一批抽取结果进本轮累积（纯函数，返回新对象）：名字与关系累计去重，摘要整批替换。
 * 名字 / 关系集合只服务提示词渲染（§4.1）——关系端点判据唯一在 S3 悬空过滤，抽取层不预丢。
 */
export function extendStoryBible(bible: StoryBible, result: DecomposeBatchResult): StoryBible {
  const seenNames = new Set(bible.names.map(normalizeEntityName));
  const names = [...bible.names];
  for (const chapter of result.chapters) {
    for (const entity of [...chapter.characters, ...chapter.settings, ...chapter.locations]) {
      const key = normalizeEntityName(entity.name);
      if (key === "" || seenNames.has(key)) continue;
      seenNames.add(key);
      names.push(entity.name);
    }
  }
  const relations = [...bible.relations];
  const seenRelations = new Set(relations);
  for (const chapter of result.chapters) {
    for (const relation of chapter.relations) {
      const line = `${relation.source}→${relation.target}（${relation.type}）`;
      if (seenRelations.has(line)) continue;
      seenRelations.add(line);
      relations.push(line);
    }
  }
  return { names, relations, summaries: result.chapters.map((chapter) => chapter.summary).filter((summary) => summary !== "") };
}

/**
 * 起始快照（§4.1 第 1 层）：**job 开始时读库一次**——已有实体名 / 已有关系 / 范围起点前的章摘要。
 * 与「本轮累积」合起来渲染成一份项目数据快照（`snapshotText`）。
 */
export interface DecomposeStartSnapshot {
  /** 已有的人物（带 `role`；顺序 = `DECOMPOSE_ROLE_ORDER` 权重） */
  characters: Array<{ name: string; role: string }>;
  /** 已有的设定名（§4.1：只给名字） */
  settings: string[];
  /** 已有的地点名（与设定同款只给名字；分列存是为了「快照组成」条目能报各自计数，渲染时仍合成一块） */
  locations: string[];
  /** 已有的关系（「源→靶（类型）」） */
  relations: string[];
  /** 范围起点前 `DECOMPOSE_SNAPSHOT_PREV_CHAPTERS` 章的摘要（紧邻起点者在最前；范围从第 1 章开始 → 空） */
  prevSummaries: Array<{ chapterNumber: number; summary: string }>;
}

/**
 * 起始快照读取（一轮一次，不随批刷新）：实体 / 关系走 db 查询层（禁止绕过 `queryDb`），
 * 前置章摘要走 `outline.json`（章序 = `deriveChapterOrder`，节点 `summary` = S3 回写的章摘要）。
 */
export function readStartSnapshot(input: {
  project: ProjectContext;
  scopeStart: number;
  chapterOrder: readonly ChapterOrderInfo[];
  tree: OutlineFileTree;
}): DecomposeStartSnapshot {
  const { project, scopeStart, chapterOrder, tree } = input;
  // 实体**分页取全**（`listAllLiveEntities`，与 S3 同名复用同一实现）：实体列表每页上限
  // `MAX_ENTITY_LIST_LIMIT`，早先按「单类型 ≤ 一页够用」这个刻度读首页——尺度失效点很明确：
  // 快照是提示词里实体名的唯一来源，只取首页会让模型看不到超出的角色与设定 / 地点名（§4.1）。
  // 故该刻度被移除：取全，不按页猜。
  // 关系无此问题：`listRelations` 不分页、单查询返回全部可见关系（不得为它另加 limit）。
  const characters = listAllLiveEntities(project.db, "character")
    .map((item) => ({ name: item.name, role: typeof item.summary.role === "string" ? item.summary.role : "" }))
    .sort((a, b) => roleRank(a.role) - roleRank(b.role)); // 稳定排序：同权重保持查询顺序
  const settings = listAllLiveEntities(project.db, "setting").map((item) => item.name);
  const locations = listAllLiveEntities(project.db, "location").map((item) => item.name);
  const relations = listRelations(project.db, {}, 1, project.root).relations.map(
    (relation) =>
      `${relation.sourceName ?? relation.sourceId}→${relation.targetName ?? relation.targetId}（${relation.relationType}）`,
  );
  // 范围起点在章序里的位置：找不到（范围章被删 / 移出）⇒ 不猜前置章，留空
  const scopeIndex = chapterOrder.findIndex((entry) => entry.chapterNumber === scopeStart);
  const prevSummaries = (scopeIndex <= 0 ? [] : chapterOrder.slice(Math.max(0, scopeIndex - DECOMPOSE_SNAPSHOT_PREV_CHAPTERS), scopeIndex))
    // 紧邻起点者在最前：预算不足时先丢最远的章（见 `snapshotBlocks`）
    .reverse()
    .flatMap((entry) => {
      const summary = findOutlineNode(tree, entry.chapterId)?.summary?.trim();
      return summary === undefined || summary === "" ? [] : [{ chapterNumber: entry.chapterNumber, summary }];
    });
  return { characters, settings, locations, relations, prevSummaries };
}

/** role 排序权重：词表内取下标，其余（含空串）排最后 */
function roleRank(role: string): number {
  const index = (DECOMPOSE_ROLE_ORDER as readonly string[]).indexOf(role.trim());
  return index === -1 ? DECOMPOSE_ROLE_ORDER.length : index;
}

/**
 * 快照块：`items` 顺序 = 保留顺序（尾部先丢）；被丢条目换成一行**显式告知**（§4.1 禁止静默截断）。
 */
interface SnapshotBlock {
  /** 块身份（`snapshotComposition` 按它取当轮规模，不靠数组下标） */
  key: "names" | "summaries" | "relations" | "places";
  /** 单行前缀（摘要块为空：该项自带标签） */
  prefix: string;
  /** 项分隔符 */
  separator: string;
  /** 告知文案的量词（「（已省略 N 个<量词>）」） */
  dropLabel: string;
  items: string[];
}

/**
 * 快照块（**定义顺序 = 填充优先级**：靠前先占预算、最后被丢）= §4.1 丢弃顺序的逆序
 * （设定 / 地点名 → 关系 → 前置摘要 → 人物名，人物最后丢——它同时是关系端点的关键）。
 * 两层合进同一批块：本轮累积的名字接在人物名之后（同在最后被丢的块）、上批摘要接在前置摘要之前
 * （同在摘要块；预算紧时先丢离本轮最远的上下文）。
 */
function snapshotBlocks(start: DecomposeStartSnapshot, bible: StoryBible): SnapshotBlock[] {
  const rendered = new Set(
    [...start.characters.map((character) => character.name), ...start.settings, ...start.locations].map(normalizeEntityName),
  );
  return [
    {
      key: "names",
      prefix: "名字：",
      separator: "、",
      dropLabel: "名字",
      items: [
        // 起始快照的人物带 role；本轮累积只知道名字（起始快照里已渲染过的去重：续拆时两边必然重叠）
        ...start.characters.map((character) =>
          character.role === "" ? character.name : `${character.name}（${character.role}）`,
        ),
        ...bible.names.filter((name) => !rendered.has(normalizeEntityName(name))),
      ],
    },
    {
      key: "summaries",
      prefix: "",
      separator: "\n",
      dropLabel: "摘要",
      items: [
        ...bible.summaries.map((summary) => `上一批摘要：${summary}`),
        ...start.prevSummaries.map((entry) => `第${entry.chapterNumber}章摘要：${entry.summary}`),
      ],
    },
    {
      key: "relations",
      prefix: "已有关系：",
      separator: "、",
      dropLabel: "关系",
      items: [...new Set([...start.relations, ...bible.relations])],
    },
    { key: "places", prefix: "设定 / 地点：", separator: "、", dropLabel: "设定 / 地点名", items: [...start.settings, ...start.locations] },
  ];
}

/**
 * 项目数据快照文本（§4.1：起始快照 + 本轮累积合并成一份；受 `DECOMPOSE_SNAPSHOT_MAX_CHARS` 约束）。
 * 超预算按块丢弃（顺序见 `snapshotBlocks`），**每次丢弃都在文本里显式告知**——
 * 静默截断会让模型以为自己看到了全部。空快照 → 空文本（提示词走「尚无上文」）。
 */
export function snapshotText(start: DecomposeStartSnapshot, bible: StoryBible): string {
  const blocks = snapshotBlocks(start, bible);
  return renderSnapshot(blocks, fitSnapshot(blocks));
}

/** 预算裁剪：返回各块保留数（尾部先丢；块顺序 = `snapshotBlocks` 定义顺序） */
function fitSnapshot(blocks: readonly SnapshotBlock[]): number[] {
  const keep = blocks.map((block) => block.items.length);
  let text = renderSnapshot(blocks, keep);
  for (let index = blocks.length - 1; index >= 0 && text.length > DECOMPOSE_SNAPSHOT_MAX_CHARS; index--) {
    while (keep[index] > 0 && text.length > DECOMPOSE_SNAPSHOT_MAX_CHARS) {
      keep[index]--;
      text = renderSnapshot(blocks, keep);
    }
  }
  return keep;
}

/** 快照组成（§8 拆解记录时间线：条目只报计数与省略告知，不塞全文） */
export interface SnapshotComposition {
  /** 起始快照（job 开始时读库一次）各块计数 = 条目文案的「人物 N / 设定 N / 地点 N / 关系 N / 前置摘要 N 条」 */
  start: { characters: number; settings: number; locations: number; relations: number; prevSummaries: number };
  /** 当轮快照规模（起始快照 + 本轮累积；= 提示词里实际渲染的那份的条数） */
  merged: { names: number; relations: number };
  /** 预算丢弃告知（与渲染同源；空数组 = 没丢） */
  omitted: string[];
}

/**
 * 快照组成**与 `snapshotText` 共用同一份分块 + 预算**（`fitSnapshot`）——所以条目里的「已省略」
 * 与提示词里模型看到的告知逐字一致；两处各算一遍必然漂移（数值单源）。
 */
export function snapshotComposition(start: DecomposeStartSnapshot, bible: StoryBible): SnapshotComposition {
  const blocks = snapshotBlocks(start, bible);
  const keep = fitSnapshot(blocks);
  const itemsOf = (key: SnapshotBlock["key"]): number => blocks.find((block) => block.key === key)?.items.length ?? 0;
  return {
    start: {
      characters: start.characters.length,
      settings: start.settings.length,
      locations: start.locations.length,
      relations: start.relations.length,
      prevSummaries: start.prevSummaries.length,
    },
    merged: { names: itemsOf("names"), relations: itemsOf("relations") },
    omitted: blocks.flatMap((block, index) => {
      const dropped = block.items.length - keep[index];
      return dropped === 0 ? [] : [`${dropped} 个${block.dropLabel}`];
    }),
  };
}

/** 快照组成条目文案（§8；调用方不拼字符串，避免两处各写一份格式） */
function snapshotLogText(composition: SnapshotComposition): string {
  const { characters, settings, locations, relations, prevSummaries } = composition.start;
  const head = `快照：人物 ${characters} / 设定 ${settings} / 地点 ${locations} / 关系 ${relations} / 前置摘要 ${prevSummaries} 条`;
  return composition.omitted.length === 0 ? head : `${head}（已省略 ${composition.omitted.join("、")}）`;
}

/** 渲染快照（`keep[index]` = 保留块 index 的前 N 项；被丢条目换成一行告知文案） */
function renderSnapshot(blocks: readonly SnapshotBlock[], keep: readonly number[]): string {
  return blocks
    .flatMap((block, index) => {
      const kept = block.items.slice(0, keep[index]);
      const dropped = block.items.length - kept.length;
      return [
        ...(kept.length === 0 ? [] : [block.prefix + kept.join(block.separator)]),
        ...(dropped === 0 ? [] : [`（已省略 ${dropped} 个${block.dropLabel}）`]),
      ];
    })
    .join("\n");
}

// ============ 提示词（数值一律由常量插值，不在散文里复述） ============

/**
 * 批提示词：系统提示 = 角色 + 输出契约 + 各上限；用户消息 = 项目数据快照 + 本批各章正文。
 * 输出契约即 `normalizeExtraction` 的输入形状（逐章对齐；缺章 → 整批重试）。
 */
function buildBatchPrompt(input: { chapters: readonly BatchChapter[]; snapshotText: string }): ModelRequest {
  const snapshot = input.snapshotText === "" ? "（本批是首批，尚无上文）" : input.snapshotText;
  const body = input.chapters.map((chapter) => `### 第${chapter.index}章 ${chapter.title}\n${chapter.text}`).join("\n\n");
  return {
    system: [
      "你是小说拆解流水线的逐章抽取员。输入是长篇小说的其中若干章，输出必须是 JSON。",
      "每章产出一个条目（chapterIndex = 输入里的章序），不得合并章节、不得遗漏——漏章会让整批重跑。",
      "只输出 JSON（可以放 ```json 围栏），不要写解释文字。",
      "",
      '输出结构：{"chapters":[{"chapterIndex":1,"chapterTitle":"…","summary":"…","characters":[…],"settings":[…],"locations":[…],"relations":[…]}]}',
      "",
      "字段口径：",
      `- summary：本章剧情摘要，不超过 ${DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS} 字；`,
      "- characters[]：{name, role, description, alias, gender, age, race, personality, motivation}",
      `- name 必填；role 建议用：${DECOMPOSE_ROLE_ORDER.join(" / ")}；`,
      `- description 必填且不超过 ${DECOMPOSE_DESCRIPTION_MAX_CHARS} 字；alias 只填一个最常用的别称，其余别名写进 description 的「（又称：X、Y）」；`,
      `- gender / age / race 只在文中明确时填；personality 不超过 ${DECOMPOSE_PERSONALITY_MAX_ITEMS} 条；motivation 不超过 ${DECOMPOSE_MOTIVATION_MAX_CHARS} 字；`,
      `- 不要输出 ability_panel 与 custom_fields；每章人物不超过 ${DECOMPOSE_CHAPTER_MAX_CHARACTERS} 条；`,
      `- settings[]：{name, description, tags, rules}——只抽对剧情有影响的设定；tags 写短标签、rules 写短句、description 不超过 ${DECOMPOSE_DESCRIPTION_MAX_CHARS} 字；每章不超过 ${DECOMPOSE_CHAPTER_MAX_SETTINGS} 条；`,
      `- locations[]：{name, type, description}——不输出上级地点；description 不超过 ${DECOMPOSE_DESCRIPTION_MAX_CHARS} 字；每章不超过 ${DECOMPOSE_CHAPTER_MAX_LOCATIONS} 条；`,
      // 端点措辞与 §4.1 对齐（**不设端点白名单**）：分段并发下「上文」只含本段，说死「必须是上文出现过的名字」
      // 会让模型主动丢掉跨段关系；端点存在性不在 S2 判定（唯一判据 = S3 悬空过滤）
      `- relations[]：{source, target, type, evidence}——type 只能取 ${DECOMPOSE_RELATION_TYPES.join(" / ")}；source / target 用文中（本章或更早章节）出现过的名字，跨章 / 跨段的人物设定照写、不必等它先在本段出现；每章不超过 ${DECOMPOSE_CHAPTER_MAX_RELATIONS} 条。`,
    ].join("\n"),
    user: [`【项目数据快照】${snapshot}`, "", "【本批正文】", body].join("\n"),
  };
}

// ============ 模型调用（唯一入口 = pi ModelRuntime 单例；实现在 llm.ts） ============

// ============ 批执行 ============

interface BatchOutcome {
  /** 已落库的批结果（失败 / 取消 → null） */
  result: DecomposeBatchResult | null;
  /** 本轮是否已把该批标 `failed` */
  failed: boolean;
}

interface BatchRunInput {
  project: ProjectContext;
  jobId: string;
  batch: DecomposeBatchRow;
  chapters: readonly BatchChapter[];
  /** 项目数据快照文本（起始快照 + 段内滚动累积；受 `DECOMPOSE_SNAPSHOT_MAX_CHARS` 约束） */
  snapshotText: string;
  /** 当轮快照规模（§8 批开始条目的「名字 N / 关系 M」；与 `snapshotText` 同源，不塞全文） */
  snapshotSize: string;
  /** 本段（或主会话）的拆解会话：S2 各批写本段 worker、S3 归并 + S4 报告写主会话 */
  session: DecomposeSession;
  /** 段身份（§8 时间线：`batch_start` 条目带段号） */
  segment: DecomposeSegmentRef;
  /** 限流退避的等待实现（注入点，见 `DecomposeRunnerDeps.sleep`） */
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

/**
 * 一批的执行：整批重试（≤ `DECOMPOSE_BATCH_MAX_ATTEMPTS`，含首次）——缺章是最常见的败因，
 * 重试代价 = 一批 token，而缺章的产出本来就不完整；超上限 → 标 `failed` 并继续后续批。
 * 取消（暂停 / 切书）时不再重试：批留在未完成状态，由续拆承接（`schema.md`「状态归一」不变式）。
 * 并发下另补一层：错误判定为 429 / 限流时，重试之前按指数退避 + 抖动等一段（§2.2；慢比失败好）。
 */
async function runBatch(input: BatchRunInput): Promise<BatchOutcome> {
  let lastError = "批未完成";
  input.session.log({
    kind: "batch_start",
    batchSeq: input.batch.seq,
    text: `批 ${input.batch.seq} 开始（段 ${input.segment.index}/${input.segment.total}；${input.chapters.length} 章；快照 ${input.snapshotSize}）`,
  });
  for (let attempt = 1; attempt <= DECOMPOSE_BATCH_MAX_ATTEMPTS; attempt++) {
    if (input.signal.aborted) return { result: null, failed: false };
    if (startBatchAttempt(input.project.db, input.jobId, input.batch.seq, nowIso()) === null) {
      throw new Error(`拆解批不存在：job ${input.jobId} 批 ${input.batch.seq}`);
    }
    try {
      const completion = await input.session.complete(
        buildBatchPrompt({ chapters: input.chapters, snapshotText: input.snapshotText }),
      );
      const normalized = normalizeExtraction(
        parseModelJson(completion.text),
        input.chapters.map((chapter) => chapter.index),
      );
      if (normalized.discarded.length > 0) {
        console.warn(`[decompose] job ${input.jobId} 批 ${input.batch.seq} 归一丢弃：${normalized.discarded.join("；")}`);
      }
      completeBatch(input.project.db, { jobId: input.jobId, seq: input.batch.seq, result: normalized.result, now: nowIso() });
      input.session.log({
        kind: "batch_done",
        batchSeq: input.batch.seq,
        text: `批 ${input.batch.seq} 完成：${batchCountsText(normalized.result)}；本次用量 输入 ${completion.usage.input} token / 输出 ${completion.usage.output} token`,
      });
      return { result: normalized.result, failed: false };
    } catch (err) {
      lastError = errorMessage(err);
      // 退避只在还有下一次尝试、且错因像限流时发生（缺章一类失败立即重试，退避对它没有意义）
      const backoffMs =
        isRateLimitError(err) && attempt < DECOMPOSE_BATCH_MAX_ATTEMPTS
          ? decomposeRateLimitDelayMs(attempt, Math.random())
          : 0;
      input.session.log({
        kind: "attempt_failed",
        batchSeq: input.batch.seq,
        text: `批 ${input.batch.seq} 第 ${attempt} 次尝试失败：${lastError}${backoffMs === 0 ? "" : `；限流退避 ${backoffMs} 毫秒后重试`}`,
      });
      console.warn(
        `[decompose] job ${input.jobId} 批 ${input.batch.seq} 第 ${attempt} 次尝试失败：${lastError}${backoffMs === 0 ? "" : `（限流退避 ${backoffMs} 毫秒后重试）`}`,
      );
      if (backoffMs > 0) await input.sleep(backoffMs);
    }
  }
  failBatch(input.project.db, { jobId: input.jobId, seq: input.batch.seq, error: lastError, now: nowIso() });
  return { result: null, failed: true };
}

/**
 * 429 / 限流判定（错误文案跨 provider 不一，只看关键字）：判定为真只影响**退避**，
 * 不改重试上限（真·持续限流的批仍会在用满 `DECOMPOSE_BATCH_MAX_ATTEMPTS` 后标 `failed`）。
 */
export function isRateLimitError(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return /\b429\b|rate[ _-]?limit|too many requests|限流|请求(过于)?频繁/.test(message);
}

/**
 * 限流退避时长（纯函数，便于断言边界）：`attempt` = 第几次尝试失败（1-based），
 * `random` ∈ [0, 1) 为抖动源（生产传 `Math.random()`；测试传固定值）。
 */
export function decomposeRateLimitDelayMs(attempt: number, random: number): number {
  const capped = Math.min(
    DECOMPOSE_RATE_LIMIT_BASE_DELAY_MS * DECOMPOSE_RATE_LIMIT_FACTOR ** (attempt - 1),
    DECOMPOSE_RATE_LIMIT_MAX_DELAY_MS,
  );
  return Math.round(capped * (DECOMPOSE_RATE_LIMIT_JITTER_MIN + random * (1 - DECOMPOSE_RATE_LIMIT_JITTER_MIN)));
}

/** 一批的抽取计数（过程条目的「批完成」文案：各分组条数，不含原文与批结果本身） */
function batchCountsText(result: DecomposeBatchResult): string {
  const totals = result.chapters.reduce(
    (sum, chapter) => ({
      characters: sum.characters + chapter.characters.length,
      settings: sum.settings + chapter.settings.length,
      locations: sum.locations + chapter.locations.length,
      relations: sum.relations + chapter.relations.length,
    }),
    { characters: 0, settings: 0, locations: 0, relations: 0 },
  );
  return `人物 ${totals.characters} / 设定 ${totals.settings} / 地点 ${totals.locations} / 关系 ${totals.relations}`;
}

/** 一批的素材：章序 / 标题来自大纲（章序 = 文件位置序），正文一次批量取投影（勿逐章查） */
function batchChapters(
  project: ProjectContext,
  batch: DecomposeBatchRow,
  tree: OutlineFileTree,
  chapterNumberById: ReadonlyMap<string, number>,
): BatchChapter[] {
  const texts = getDocumentTexts(project.db, "chapter", batch.chapter_ids);
  return batch.chapter_ids.flatMap((chapterId) => {
    const index = chapterNumberById.get(chapterId);
    // 章被物理删（回收站清除）后批行仍留旧 id：正文与章序都没了 ⇒ 从本批素材剔除，
    // 否则「缺章」判据会把整批判死（进度页同样跳过这些 id，见 job.ts 的 buildJobResponse）
    if (index === undefined) return [];
    return [{ index, title: findOutlineNode(tree, chapterId)?.title ?? "", text: texts.get(chapterId) ?? "" }];
  });
}

/**
 * 已完成批的抽取结果读取（续拆 / 单批重跑时重建**本轮累积**）：实现在 `job.ts`——S3 归并读同一份
 * （不重建的话上文的名字与关系全丢）。
 */

/** 一轮批执行的入参（对象字段，便于后续扩展不破签名） */
interface ExecuteRunInput {
  project: ProjectContext;
  job: DecomposeJobRow;
  signal: AbortSignal;
  /** 单批重跑：该批即使已 `done` 也重跑一次（其余 `done` 批不动）；其旧结果不入本轮累积（已知的过期输入） */
  rerunSeq?: number;
  /** 开一段的 worker 会话（该段的批次与快照条目都写它）；段数由本函数按 job 快照算出 */
  openWorkerSession: (segment: DecomposeSegmentRef) => Promise<DecomposeSession>;
  /** 限流退避的等待实现（注入点，见 `DecomposeRunnerDeps.sleep`） */
  sleep: (ms: number) => Promise<void>;
}

/**
 * 一轮批执行（S2）：**段间并行、段内串行**（§2.2），结果只写 `decompose_batches.result`。
 * 段划分与段数取 job 快照（批规划 + `concurrency`）⇒ resume / 重跑重算结果一致、worker 会话稳定。
 * 每段一份独立滚动累积（起始快照同源 = 一轮读库一次）；段首按段内已完成批重建累积（续拆 / 重跑）。
 */
async function executeRun(input: ExecuteRunInput): Promise<void> {
  const { project, job, signal } = input;
  const batches = listDecomposeBatches(project.db, job.id);
  const tree = readOutlineFile(project.root); // 一轮一份大纲快照（长任务里用户可能改标题）
  const chapterOrder = deriveChapterOrder(project.root);
  const chapterNumberById = new Map(chapterOrder.map((entry) => [entry.chapterId, entry.chapterNumber]));
  // 起始快照：一轮开头读库一次（不随批刷新）；**各段共用这一份**（§4.1 起始快照层）；
  // 前置章摘要取本 job 范围起点之前的连续若干章
  const startSnapshot = readStartSnapshot({ project, scopeStart: job.scope_start, chapterOrder, tree });
  // 段划分：字数取正文投影长度（与进度页 / 快照同口径）；批被物理删章后字数按剩余章算，不影响可重算性。
  // 注意：字数取自**当时的**正文投影 ⇒ 正文被用户编辑后，段边界可漂移，不承诺与上一轮同构
  // （resume / 重跑一律按当时字数重算；段身份只在「正文未变」时稳定，见 §2.2）
  const textLengthById = getDocumentTextLengths(project.db, "chapter", batches.flatMap((batch) => batch.chapter_ids));
  const segments = planSegments(
    batches.map((batch) => ({
      seq: batch.seq,
      charCount: batch.chapter_ids.reduce((sum, chapterId) => sum + (textLengthById.get(chapterId) ?? 0), 0),
    })),
    job.concurrency,
  );
  const segmentRefs: DecomposeSegmentRef[] = segments.map((_, position) => ({
    index: position + 1,
    total: segments.length,
  }));
  const segmentBatches = (batchSeqs: readonly number[]): DecomposeBatchRow[] =>
    batchSeqs.map((seq) => batches.find((batch) => batch.seq === seq) as DecomposeBatchRow); // 段由 batches 派生 ⇒ 必命中
  // 段内串行：`done` 批跳过（单批重跑时该批例外）⇒ 无事可做的段（resume / 重跑后批已全完成）
  // 不开 worker 会话、也不记快照条目（省一次开会话，且不产生空会话文件）
  const activeSegments = segments
    .map((batchSeqs, position) => ({ segment: segmentRefs[position]!, batches: segmentBatches(batchSeqs) }))
    .filter(({ batches: rows }) => rows.some((batch) => batch.status !== "done" || batch.seq === input.rerunSeq));
  // worker 会话先全部开好再开跑：任一段开会话失败（缺模型 / 凭据 / 目录不可写）不留「前几段已跑」的半成品
  const workerSessions = await Promise.all(activeSegments.map(({ segment }) => input.openWorkerSession(segment)));

  let executed = 0;
  let failed = 0;
  // 段间并行但**全部段落定后才上报错误**（`allSettled` 而非 `all`）：任一段 rejection 时兄弟段仍在写库，
  // 提前抛出会让调用方的 catch 立刻 `failJob` + 注销 `activeRuns` ⇒ job 已 `failed` 仍被残留段写、
  // 删除守卫与单批重跑也可能与残留段重叠。取消走既有 `signal`（暂停 / 切书），不为此另加机制。
  const settled = await Promise.allSettled(
    activeSegments.map(async ({ segment, batches: rows }, position) => {
      const session = workerSessions[position]!;
      // 段内滚动累积：按段内已完成批重建（续拆 / 单批重跑；单批重跑的旧结果不入累积）
      let bible = doneBatchResults(
        project.db,
        job.id,
        rows.filter((batch) => batch.status === "done" && batch.seq !== input.rerunSeq).map((batch) => batch.seq),
      ).reduce(extendStoryBible, emptyStoryBible());
      // 快照组成条目（§8）：每段一条，报该段起点的规模与预算省略（不塞全文；模型看不到这行）
      session.log({ kind: "snapshot", text: snapshotLogText(snapshotComposition(startSnapshot, bible)) });
      for (const batch of rows) {
        // 暂停 / 切书：每段当前批跑完即停（在途 ≤ 段数；已发出的调用不 abort，结果不浪费）
        if (signal.aborted) return;
        if (batch.status === "done" && batch.seq !== input.rerunSeq) continue; // 段内串行：done 批跳过
        const composition = snapshotComposition(startSnapshot, bible); // 每批重算：段内累积随批增长
        const outcome = await runBatch({
          project,
          jobId: job.id,
          batch,
          chapters: batchChapters(project, batch, tree, chapterNumberById),
          snapshotText: snapshotText(startSnapshot, bible),
          snapshotSize: `名字 ${composition.merged.names} / 关系 ${composition.merged.relations}`,
          session,
          segment,
          sleep: input.sleep,
          signal,
        });
        executed++;
        if (outcome.failed) failed++;
        if (outcome.result !== null) bible = extendStoryBible(bible, outcome.result);
      }
    }),
  );
  // 全部段落定后才上报第一个 rejection（错误不吞：保留原错误对象与消息）
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure !== undefined) throw failure.reason;
  console.log(
    `[decompose] job ${job.id} 批执行收尾：段 ${segments.length}（在跑 ${activeSegments.length}）/ 执行 ${executed} 批 / 失败 ${failed} 批${signal.aborted ? "（已暂停）" : ""}`,
  );
}

// ============ 进程内运行登记：取消通道 + 排队 ============
//
// job 是长任务：路由返回后由本模块继续跑。登记表两个用途：
// 1. **取消通道**：pause 路由与 `setCurrentProject`（切书 / 关项目）按 jobId 置 abort —— 当前批跑完即停；
// 2. **排队**：同一 job 上一轮尚未收尾（pause 后当前批仍在飞）时，新一轮先等它收尾再开——
//    否则两轮会取到同一个未完成批，重复计 attempts 与重复付费。

interface ActiveRun {
  controller: AbortController;
  done: Promise<void>;
}

const activeRuns = new Map<string, ActiveRun>();

/**
 * 中止一个 job 的在跑轮次（pause 路由用）：当前批跑完即停，**已发出的模型调用不 abort**。
 * 状态写入归调用方（pause 路由 / `setCurrentProject` 的归一）。
 * @returns 是否有在跑的一轮
 */
export function pauseDecomposeJob(jobId: string): boolean {
  const run = activeRuns.get(jobId);
  run?.controller.abort();
  return run !== undefined;
}

/** 中止全部在跑轮次（切书 / 关项目挂点：不做跨书后台跑） */
export function cancelRunningDecomposeJobs(): void {
  for (const run of activeRuns.values()) run.controller.abort();
}

/**
 * 该 job 是否有在跑（或排队）的一轮（chat 侧的删除守卫用）：
 * **暂停后当前批仍在飞**——job 行已是 `paused`，但会话文件还会被这轮原地重建，同样不能删（§7.2）。
 */
export function isDecomposeJobActive(jobId: string): boolean {
  return activeRuns.has(jobId);
}

/**
 * 清理超出保留上限的拆解会话（§7.2）：按 job `created_at` 保留最近 `DECOMPOSE_KEPT_SESSIONS` 个 job 的
 * **全部会话（主 + worker）**（`job-<nanoid>` 里没有可解析时间 ⇒ 排序依据只能是 job 行，不是文件名），
 * 更早的会话文件物理删除（与 `DELETE /chat/sessions/:id` 同款：pi 磁盘发现拿路径 → `unlinkSync`）。
 *
 * - **只碰会话 id 为 `decompose-` 前缀的记录**：候选集 = 历史 job 行；主会话按**精确 id**
 *   （`decompose-<jobId>`）、worker 按 **`decompose-<jobId>-w` 前缀**命中，查找走 pi 的磁盘发现
 *   （文件名带时间戳前缀，**不得**按文件名 glob）⇒ chat 会话结构上不可能参与（用户资产）；
 * - **在跑的一律不删**：job 行 `pending` / `running`，或进程内有在跑轮次（暂停后当前批仍在飞，
 *   删了会被这轮原地重建）；
 * - 单个文件删不掉只记日志（同 `pruneBackups` 口径），整段失败也不阻塞拆解。
 *
 * @returns 实际删除的会话枚数（主 + worker 合计；无需清理 / 失败 → 0）
 */
export async function pruneDecomposeSessions(project: ProjectContext): Promise<number> {
  try {
    const jobs = listDecomposeJobs(project.db); // created_at 升序
    const extras = jobs.slice(0, Math.max(0, jobs.length - DECOMPOSE_KEPT_SESSIONS));
    if (extras.length === 0) return 0;
    // 磁盘发现一次（按会话 id 命中路径；主 + worker 共用同一份清单，避免逐 job 重扫会话目录）
    const sessions = await listProjectSessions(project.root);
    let pruned = 0;
    for (const job of extras) {
      if (job.status === "pending" || job.status === "running" || isDecomposeJobActive(job.id)) continue;
      const mainId = decomposeSessionId(job.id);
      const workerPrefix = decomposeWorkerSessionPrefix(job.id);
      for (const info of sessions) {
        if (info.id !== mainId && !info.id.startsWith(workerPrefix)) continue;
        try {
          unlinkSync(info.path);
          pruned++;
        } catch (err) {
          console.error(`[decompose] 清理旧拆解会话失败（跳过，不阻塞）: ${info.id}`, err);
        }
      }
    }
    return pruned;
  } catch (err) {
    console.error("[decompose] 清理旧拆解会话失败（跳过，不阻塞）:", err);
    return 0;
  }
}

/** 单批重跑选项（§7：`done` 与 `failed` 都可重跑，跑完重建 S3/S4） */
export interface DecomposeRunOptions {
  rerunSeq?: number;
}

/**
 * 启动 job 的批执行（**调用方不 await**：长任务）。状态前置校验归调用方（start / resume / rerun 各自置 `running`）。
 * 同一 job 已有在跑或排队的一轮时，本轮排在它后面（见上方「排队」）；批全部收口后接 S3 + S4 并把 job 置 `done`。
 * @returns 本轮收尾的 promise（调用方不 await；测试可 await）
 */
export function startDecomposeJob(
  project: ProjectContext,
  deps: DecomposeRunnerDeps = {},
  options: DecomposeRunOptions = {},
): Promise<void> {
  const job = getDecomposeJob(project.db); // 一项目一 job：取最新一行（db helper 口径）
  if (job === null || job.status !== "running") return Promise.resolve();
  const controller = new AbortController();
  const previous = activeRuns.get(job.id);
  const run: ActiveRun = { controller, done: Promise.resolve() };
  activeRuns.set(job.id, run);
  const sleep = deps.sleep ?? defaultSleep;
  run.done = (async () => {
    try {
      await previous?.done; // 上一轮先收尾（含它正在飞的批落库）
      if (controller.signal.aborted) return;
      // §7.2：清理超限的更早拆解会话——**必须在创建本轮会话之前**（幂等；失败只记日志，不阻塞拆解）
      const pruned = await pruneDecomposeSessions(project);
      if (pruned > 0) {
        // 删除不静默（§9 不变式 9）：日志必须赶在开会话**之前**——开会话抛错（缺模型 / 凭据 / 会话目录不可写）
        // 时只有这条落得下；下面的过程条目依赖新会话，只能留在原地。枚数由常量插值，散文不复述数字
        console.log(`[decompose] 已清理 ${pruned} 份更早的拆解会话（保留最近 ${DECOMPOSE_KEPT_SESSIONS} 个 job 的全部会话）`);
      }
      // 主会话（落盘 + 过程条目）一轮一枚：计划留档 + 汇总 + S3 归并 + S4 报告都写进它
      // （deps 缺模型/凭据 → 抛错 → job 标失败）；S2 各段另开 worker 会话（executeRun 内按段数开）
      const session = await openDecomposeSession(deps, {
        projectRoot: project.root,
        jobId: job.id,
        bookName: project.config.name,
      });
      if (pruned > 0) {
        // 删除不静默：本轮会话的过程条目（`#/decompose` 时间线可见）
        session.log({
          kind: "session_pruned",
          text: `已清理 ${pruned} 份更早的拆解记录（保留最近 ${DECOMPOSE_KEPT_SESSIONS} 个 job 的全部会话）`,
        });
      }
      await executeRun({
        project,
        job,
        signal: controller.signal,
        rerunSeq: options.rerunSeq,
        openWorkerSession: (segment) =>
          openDecomposeSession(deps, { projectRoot: project.root, jobId: job.id, bookName: project.config.name, segment }),
        sleep,
      });
      if (controller.signal.aborted) return; // 暂停 / 切书：不跑 S3/S4（状态归暂停与续拆路径）
      await finishJob(project, job, session);
    } catch (err) {
      failJob(project, job, controller.signal, err);
    } finally {
      if (activeRuns.get(job.id) === run) activeRuns.delete(job.id);
    }
  })();
  return run.done;
}

/** 缺省等待实现（限流退避用；测试经 `DecomposeRunnerDeps.sleep` 注入） */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * job 收口（§2「S3 只在全部批完成后跑一次」）：批全部收口 → S3 归并 + S4 报告 → job 置 `done`。
 * 有未收口批（暂停 / 崩溃残留）→ 什么都不做（状态归暂停与续拆路径）。
 * 状态回写前重读 job 行：S3/S4 期间可能被暂停 / 切书（长调用），不能盖掉那次状态。
 */
async function finishJob(project: ProjectContext, job: DecomposeJobRow, session: DecomposeSession): Promise<void> {
  const settled = listDecomposeBatches(project.db, job.id).every(
    (batch) => batch.status === "done" || batch.status === "failed",
  );
  if (!settled) return;
  const summary = await runDecomposeMerge({ project, jobId: job.id, session, now: nowIso() });
  console.log(
    `[decompose] job ${job.id} 归并与报告收尾：实体 ${summary.entities} / 关系 ${summary.relations} / 别名组 ${summary.aliasGroups} / 报告 ${summary.reportId}`,
  );
  if (getDecomposeJob(project.db)?.status !== "running") return;
  updateJobStatus(project.db, job.id, "done", nowIso());
}

/**
 * job 级失败（批级失败不阻塞整个 job，故只在此处把 job 标 `failed`）：写错误摘要 + 状态。
 * 已取消（暂停 / 切书，含被 resume 顶替的旧轮）时不改状态——状态归暂停与续拆路径，
 * 否则旧轮的 `failed` 会盖掉新一轮刚写的 `running`。
 */
function failJob(project: ProjectContext, job: DecomposeJobRow, signal: AbortSignal, err: unknown): void {
  const message = errorMessage(err);
  console.error(`[decompose] job ${job.id} 执行失败：${message}`, err);
  try {
    setJobError(project.db, job.id, message, nowIso());
    if (!signal.aborted) updateJobStatus(project.db, job.id, "failed", nowIso());
  } catch (writeErr) {
    // 切书会先关旧库连接（start / open 路由的切换顺序）⇒ 写不进去是预期形态：
    // 该 job 行由「下次打开这本书时的归一」接管
    console.error(`[decompose] job ${job.id} 失败状态写入失败（库可能已关闭）`, writeErr);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
