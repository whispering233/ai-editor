// 卡 21.7 拆解 S3 落库 + S4 报告测试（faux provider 离线跑，不触网、不调真实模型）。
//
// 契约：docs/design/60-decompose.md §6.1（三路比对与重跑幂等）/ §6.2（报告六段与落点）/ §5（章摘要回写）。
// 覆盖：幂等回归（同一份批结果跑两遍 → 实体/关系数量与 id 全同、报告不重复建）/ 别名组与 description 的
// 「（又称：…）」/ `data.alias` 单值 / 章摘要回写（只写 summary、不动标题）/ 报告六段落库 /
// 用户编辑过的行重跑不覆盖、消失也不软删（keep-and-report）/ 消失实体软删（回收站可还原）/
// 消失关系物理删且重现时重建。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentText, fauxAssistantMessage, fauxProvider, InMemoryCredentialStore, type Context } from "@earendil-works/pi-ai";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { blocksToPlainMd } from "@whispering233/ai-editor-shared";
import type { DecomposeBatchResult, DecomposeExtractedChapter } from "@whispering233/ai-editor-shared";
import {
  completeBatch,
  deriveChapterOrder,
  findOutlineNode,
  getDecomposeJob,
  getDocument,
  getEntity,
  listDeletedEntities,
  listEntities,
  listRelations,
  nowIso,
  readOutlineFile,
  restoreEntity,
  updateEntity,
  updateRelationMetadata,
  type Db,
} from "@whispering233/ai-editor-db";
import {
  closeProject,
  getCurrentProject,
  initProject,
  setCurrentProject,
  type ProjectContext,
} from "../middleware/project.js";
import { resetModelRuntime } from "../model-runtime.js";
import { setProjectRoot } from "../routes/project.js";
import { ingestDecomposeProject } from "./job.js";
import type { DecomposeLlmDeps } from "./llm.js";
import { DECOMPOSE_ALIAS_GROUP_MAX, DECOMPOSE_ALIAS_GROUP_MIN_NAMES } from "./merge.js";
import { DECOMPOSE_MERGE_RELATION_TYPE, runDecomposeMerge, type DecomposeMergeSummary } from "./merge-write.js";
import { DECOMPOSE_REPORT_KIND, DECOMPOSE_REPORT_SECTIONS } from "./report.js";
import { splitNovelWithSlices } from "./split.js";

// ============ 夹具：真项目（tmp 目录）+ faux provider ============

const BOOK_NAME = "测试书";

function bookDir(name: string): string {
  return join(tmpRoot, "books", name);
}

/** 样本单章原文：标题行 + 正文（正文长于切分的最短段阈值 ⇒ 走正常切分路径；大纲标题 = 「标题N」） */
function chapterSource(position: number): string {
  return `第${position}章 标题${position}\n${"正文".repeat(150)}`;
}

function novelText(chapterCount: number): string {
  return Array.from({ length: chapterCount }, (_, position) => chapterSource(position + 1)).join("\n");
}

/** 建项目 + S1 建档（大纲 / 正文 / job 与批行），返回项目与 jobId */
function projectFixture(chapterCount = 6): { project: ProjectContext; jobId: string } {
  const project = initProject(bookDir(BOOK_NAME), { name: BOOK_NAME });
  setCurrentProject(project);
  const split = splitNovelWithSlices(new TextEncoder().encode(novelText(chapterCount)));
  const { jobId } = ingestDecomposeProject({
    project,
    split,
    scopedChapters: split.result.chapters,
    scopeStart: 1,
    scopeEnd: chapterCount,
    model: null,
    now: nowIso(),
  });
  return { project, jobId };
}

interface CharacterSpec {
  name: string;
  description?: string;
  alias?: string;
  role?: string;
}

interface ChapterSpec {
  summary: string;
  characters?: readonly CharacterSpec[];
  settings?: readonly { name: string; description?: string; tags?: string[] }[];
  locations?: readonly { name: string; type?: string }[];
  relations?: readonly { source: string; target: string; type: string }[];
}

/** 批结果（`chapterTitle` 写成「回声N」：与大纲标题不同 ⇒ 回写若写标题必报红） */
function batchResult(specs: readonly ChapterSpec[]): DecomposeBatchResult {
  const chapters: DecomposeExtractedChapter[] = specs.map((spec, position) => ({
    chapterIndex: position + 1,
    chapterTitle: `回声${position + 1}`,
    summary: spec.summary,
    characters: (spec.characters ?? []).map((character) => ({
      name: character.name,
      ...(character.role === undefined ? {} : { role: character.role }),
      ...(character.description === undefined ? {} : { description: character.description }),
      ...(character.alias === undefined ? {} : { alias: character.alias }),
    })),
    settings: (spec.settings ?? []).map((setting) => ({
      name: setting.name,
      ...(setting.description === undefined ? {} : { description: setting.description }),
      ...(setting.tags === undefined ? {} : { tags: setting.tags }),
    })),
    locations: (spec.locations ?? []).map((location) => ({
      name: location.name,
      ...(location.type === undefined ? {} : { type: location.type }),
    })),
    relations: (spec.relations ?? []).map((relation) => ({ ...relation })),
  }));
  return { chapters };
}

/** 基准素材：张三（6 章）/三哥（2 章，别名组成员）/李四（2 章）/设定「功法」/地点「山谷」/关系「张三→李四（ally）」 */
function baseSpecs(): ChapterSpec[] {
  const ally = { source: "张三", target: "李四", type: "ally" };
  return [
    {
      summary: "摘要1",
      characters: [
        { name: "张三", role: "主角", description: "张三的描述", alias: "小张" },
        { name: "李四", role: "配角", description: "李四的描述" },
      ],
      settings: [{ name: "功法", description: "功法描述", tags: ["武学"] }],
      locations: [{ name: "山谷", type: "野外" }],
      relations: [ally],
    },
    { summary: "摘要2", characters: [{ name: "张三" }, { name: "李四" }], relations: [ally] },
    { summary: "摘要3", characters: [{ name: "张三" }, { name: "三哥", description: "三哥的描述（较完整的一条）" }] },
    { summary: "摘要4", characters: [{ name: "张三" }, { name: "三哥", description: "三哥" }] },
    { summary: "摘要5", characters: [{ name: "张三" }] },
    { summary: "摘要6", characters: [{ name: "张三" }] },
  ];
}

/** 产物里去掉「李四」与全部关系（消失行测试用） */
function specsWithoutLiSi(): ChapterSpec[] {
  return baseSpecs().map((spec) => ({
    ...spec,
    characters: spec.characters?.filter((character) => character.name !== "李四"),
    relations: [],
  }));
}

function writeBatch(db: Db, jobId: string, seq: number, result: DecomposeBatchResult): void {
  completeBatch(db, { jobId, seq, result, now: nowIso() });
}

interface FakeModel {
  deps: DecomposeLlmDeps;
  /** 排队下一次 S3 / S4 的模型回复（[别名归并 JSON, 报告正文]） */
  script(steps: readonly string[]): void;
  /** 已发出的调用提示词（用户消息，按调用顺序） */
  prompts: string[];
  /** 已发出的调用系统提示（按调用顺序） */
  systems: string[];
}

async function fakeModel(): Promise<FakeModel> {
  const faux = fauxProvider({ models: [{ id: "faux-a", name: "Faux A", contextWindow: 128_000, maxTokens: 8192 }] });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "faux-key" }));
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  const model: FakeModel = {
    deps: { runtime, settings: SettingsManager.inMemory({}) },
    prompts: [],
    systems: [],
    script: (steps) => {
      faux.setResponses(
        steps.map((step) => async (context: Context) => {
          const content = context.messages[0].content;
          model.prompts.push(typeof content === "string" ? content : contentText(content));
          model.systems.push(context.systemPrompt ?? "");
          return fauxAssistantMessage(step);
        }),
      );
    },
  };
  return model;
}

/** 别名归并回复（规范名 + 别名 + 依据） */
function aliasResponse(canonical: string, aliases: readonly string[], reason = "同一人"): string {
  return JSON.stringify({ groups: [{ canonical, aliases, reason }] });
}

function noAliases(): string {
  return JSON.stringify({ groups: [] });
}

/** 跑一轮 S3 + S4（调用方先 script 好模型回复） */
function runMerge(input: { project: ProjectContext; jobId: string; deps: DecomposeLlmDeps }): Promise<DecomposeMergeSummary> {
  return runDecomposeMerge({ ...input, now: nowIso() });
}

/** 库内实体计数（按类型；只计未软删） */
function entityCounts(db: Db): Record<string, number> {
  return {
    character: listEntities(db, { type: "character" }).total,
    setting: listEntities(db, { type: "setting" }).total,
    location: listEntities(db, { type: "location" }).total,
    reference: listEntities(db, { type: "reference" }).total,
  };
}

function characterIds(db: Db): string[] {
  return listEntities(db, { type: "character" }).items
    .map((item) => item.id)
    .sort();
}

function characterIdByName(db: Db, name: string): string {
  const item = listEntities(db, { type: "character", q: name }).items.find((candidate) => candidate.name === name);
  if (item === undefined) throw new Error(`人物不存在：${name}`);
  return item.id;
}

/** 大纲侧章摘要（回写的读取面；章序 = 文件位置序） */
function chapterNodes(project: ProjectContext): Array<{ title: string; summary?: string }> {
  const tree = readOutlineFile(project.root);
  return deriveChapterOrder(project.root).map((entry) => {
    const node = findOutlineNode(tree, entry.chapterId);
    return { title: node?.title ?? "", summary: node?.summary };
  });
}

/** 报告文档读取面（块数组 + 投影 + 文本） */
function reportDocument(project: ProjectContext): {
  doc: { content: string; content_text: string };
  blocks: Array<{ type: string; content: Array<{ text: string }> }>;
  text: string;
} {
  const report = listEntities(project.db, { type: "reference" }).items[0];
  const doc = getDocument(project.db, "reference", report.id);
  if (doc === null) throw new Error("报告文档不存在");
  const blocks = JSON.parse(doc.content) as Array<{ type: string; content: Array<{ text: string }> }>;
  const text = blocks.map((block) => block.content.map((part) => part.text).join("")).join("\n");
  return { doc, blocks, text };
}

function sleep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

// ============ 环境隔离（HOME + 凭据环境变量；与 runner.test.ts 同款） ============

let tmpRoot: string;
let originalHome: string | undefined;
const credentialEnv: Array<[string, string]> = [];

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-decompose-merge-"));
  setCurrentProject(null);
  setProjectRoot(tmpRoot);
  originalHome = process.env.HOME;
  process.env.HOME = tmpRoot;
  for (const key of Object.keys(process.env)) {
    if (!/(API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key)) continue;
    credentialEnv.push([key, process.env[key]!]);
    delete process.env[key];
  }
  resetModelRuntime();
});

afterEach(() => {
  resetModelRuntime();
  const project = getCurrentProject();
  if (project !== null) closeProject(project);
  setCurrentProject(null);
  setProjectRoot(null);
  for (const [key, value] of credentialEnv.splice(0)) process.env[key] = value;
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ============ S3 落库 ============

describe("S3 落库（§6 三层归并 → 实体/关系/章摘要）", () => {
  it("跨章阈值生效、别名组进「（又称：…）」、data.alias 单值、章摘要只写 summary", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));
    model.script([aliasResponse("张三", ["三哥"]), "全书剧情摘要正文。"]);

    const summary = await runMerge({ project, jobId, deps: model.deps });

    // 人物：张三（4 章）+ 李四（2 章），三哥被并进张三 ⇒ 2 位；设定 1 / 地点 1（不设阈值）；报告 1 条 reference
    expect(entityCounts(project.db)).toEqual({ character: 2, setting: 1, location: 1, reference: 1 });
    expect(summary).toMatchObject({ entities: 4, relations: 1, aliasGroups: 1 });
    expect(listEntities(project.db, { type: "character", q: "三哥" }).total).toBe(0); // 别名不单独落库

    const 张三 = getEntity(project.db, characterIdByName(project.db, "张三"))!;
    expect(张三.data).toMatchObject({ role: "主角", alias: "小张" });
    expect(张三.data.description).toBe("张三的描述（又称：三哥）"); // 别名进来路：description（不动 schema）
    expect(typeof 张三.data.alias).toBe("string"); // 单值

    // 关系：张三→李四（ally，出现 2 章过阈值）两端解析为实体 id
    const relations = listRelations(project.db, {}, 1, project.root).relations;
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ relationType: "ally", sourceName: "张三", targetName: "李四" });

    // 章摘要回写：只写 summary；章标题仍是大纲标题（批结果里的「回声N」不得进大纲）
    expect(chapterNodes(project).map((chapter) => chapter.summary)).toEqual(baseSpecs().map((spec) => spec.summary));
    expect(chapterNodes(project).map((chapter) => chapter.title)).toEqual(["标题1", "标题2", "标题3", "标题4", "标题5", "标题6"]);

    // 设定/地点不设阈值：单章出现也落库
    expect(listEntities(project.db, { type: "setting" }).items[0]).toMatchObject({ name: "功法" });
    expect(listEntities(project.db, { type: "location" }).items[0]).toMatchObject({ name: "山谷" });
  });

  it("阈值与悬空过滤的产物进报告第 6 段（单章路人不出现在实体表）", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    const specs = baseSpecs();
    specs[3] = { ...specs[3], characters: [{ name: "张三" }, { name: "路人甲", description: "只出现一次" }] };
    writeBatch(project.db, jobId, 1, batchResult(specs));
    model.script([noAliases(), "剧情摘要。"]);

    await runMerge({ project, jobId, deps: model.deps });

    expect(listEntities(project.db, { type: "character", q: "路人甲" }).total).toBe(0);
    const report = reportDocument(project);
    expect(report.text).toContain("六、被阈值滤掉的单章线索");
    expect(report.text).toContain("路人甲");
  });
});

// ============ 别名组硬校验（§6 第 2 层） ============

describe("别名组硬校验（§6 第 2 层保守原则）", () => {
  it("发明出来的名字 / 缺依据的组一律丢弃（只把 accepted 传进 applyAliasGroups）", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));

    // ① 规范名「李四二」不在候选清单里：整组丢弃（否则会把张三改名成发明的名字）
    model.script([aliasResponse("李四二", ["张三"]), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });
    expect(listEntities(project.db, { type: "character", q: "李四二" }).total).toBe(0);
    expect(getEntity(project.db, characterIdByName(project.db, "张三"))!.name).toBe("张三");

    // ② 缺依据（无 reason）：按保守原则丢弃，宁可留重复
    model.script([JSON.stringify({ groups: [{ canonical: "张三", aliases: ["三哥"] }] }), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });
    expect(getEntity(project.db, characterIdByName(project.db, "张三"))!.data.description).toBe("张三的描述"); // 未合并
    expect(listEntities(project.db, { type: "character", q: "三哥" }).total).toBe(1); // 仍是独立实体
  });
});

// ============ 幂等（§6.1） ============

describe("重跑幂等（§6.1 三路比对）", () => {
  it("同一份批结果跑两遍 S3：实体/关系数量与 id 全同，merge_written 稳定，报告不重复建", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));
    model.script([aliasResponse("张三", ["三哥"]), "第一遍剧情摘要。"]);
    const first = await runMerge({ project, jobId, deps: model.deps });

    const countsAfterFirst = entityCounts(project.db);
    const idsAfterFirst = characterIds(project.db);
    const entriesAfterFirst = getDecomposeJob(project.db)!.merge_written;
    expect(countsAfterFirst).toEqual({ character: 2, setting: 1, location: 1, reference: 1 });

    model.script([aliasResponse("张三", ["三哥"]), "第二遍剧情摘要。"]);
    const second = await runMerge({ project, jobId, deps: model.deps });

    expect(entityCounts(project.db)).toEqual(countsAfterFirst); // 数量不变（幂等回归的硬判据）
    expect(characterIds(project.db)).toEqual(idsAfterFirst); // 复用同一批行（不重建）
    expect(getDecomposeJob(project.db)!.merge_written).toEqual(entriesAfterFirst); // 清单逐字不变
    expect(second.reportId).toBe(first.reportId); // 报告不重复建：更新同一条
    expect(listRelations(project.db, {}, 1, project.root).relations).toHaveLength(1);
    expect(reportDocument(project).text).toContain("第二遍剧情摘要。"); // 报告正文被重建
  });

  it("清单条目覆盖实体 + 关系 + 报告（type 分别用实体类型 / relation / reference）", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);

    await runMerge({ project, jobId, deps: model.deps });

    const types = getDecomposeJob(project.db)!.merge_written.map((entry) => entry.type);
    expect(types.filter((type) => type === "character")).toHaveLength(2);
    expect(types).toContain("setting");
    expect(types).toContain("location");
    expect(types.filter((type) => type === DECOMPOSE_MERGE_RELATION_TYPE)).toHaveLength(1);
    expect(types.filter((type) => type === "reference")).toHaveLength(1);
  });
});

// ============ 用户编辑优先 / 消失行（§6.1） ============

describe("用户编辑优先与消失行（§6.1）", () => {
  it("updated_at 变过的实体：重跑不覆盖；产物里消失也不软删（报告提示保留）", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });

    const 李四 = characterIdByName(project.db, "李四");
    await sleep(); // updated_at 精度到毫秒：睡过同一毫秒才能造出「用户改过」的版本戳
    updateEntity(project.db, 李四, { data: { role: "用户改过的定位" } });

    writeBatch(project.db, jobId, 1, batchResult(specsWithoutLiSi()));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });

    expect(listEntities(project.db, { type: "character" }).items.map((item) => item.id)).toContain(李四); // 未被软删
    expect(getEntity(project.db, 李四)!.data.role).toBe("用户改过的定位"); // 用户编辑未被覆盖
    expect(listDeletedEntities(project.db).map((item) => item.id)).not.toContain(李四);
    expect(reportDocument(project).text).toContain("未改动（用户手工编辑过，重跑不覆盖）：李四（character）");
  });

  it("产物里消失的实体：软删进回收站（可还原），清单条目随之清除", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });

    const 李四 = characterIdByName(project.db, "李四");
    writeBatch(project.db, jobId, 1, batchResult(specsWithoutLiSi()));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });

    expect(listEntities(project.db, { type: "character", q: "李四" }).total).toBe(0);
    expect(listDeletedEntities(project.db)).toEqual([expect.objectContaining({ id: 李四, type: "character" })]);
    expect(getDecomposeJob(project.db)!.merge_written.map((entry) => entry.id)).not.toContain(李四);

    // 回收站可还原（软删而非物理删）
    expect(restoreEntity(project.db, "character", 李四)).not.toBeNull();
    expect(listEntities(project.db, { type: "character", q: "李四" }).total).toBe(1);
  });

  it("产物里消失的关系：物理删（本仓关系无回收站）；产物重现时重建（幂等不被物理删破坏）", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });
    const before = listRelations(project.db, {}, 1, project.root).relations[0].id;

    const withoutRelations = baseSpecs().map((spec) => ({ ...spec, relations: [] }));
    writeBatch(project.db, jobId, 1, batchResult(withoutRelations));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });
    expect(listRelations(project.db, {}, 1, project.root).relations).toHaveLength(0); // 物理删

    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });
    const after = listRelations(project.db, {}, 1, project.root).relations;
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(before); // 重建 = 新行（不复活旧行）
  });

  it("用户改过的关系（updated_at 变了）：产物消失也保留，报告提示", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });

    const relationId = listRelations(project.db, {}, 1, project.root).relations[0].id;
    await sleep();
    updateRelationMetadata(project.db, relationId, { label: "用户加的标签" }, nowIso());

    const withoutRelations = baseSpecs().map((spec) => ({ ...spec, relations: [] }));
    writeBatch(project.db, jobId, 1, batchResult(withoutRelations));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);
    await runMerge({ project, jobId, deps: model.deps });

    expect(listRelations(project.db, {}, 1, project.root).relations.map((relation) => relation.id)).toEqual([relationId]);
    expect(reportDocument(project).text).toContain("未改动（用户手工编辑过，重跑不覆盖）：张三→李四（ally）");
  });
});

// ============ S4 报告（§6.2） ============

describe("S4 报告（§6.2 六段）", () => {
  it("报告落点：一条 reference + 六段段落块；重跑更新同一条", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));
    model.script([aliasResponse("张三", ["三哥"]), "全书剧情摘要正文。"]);
    const first = await runMerge({ project, jobId, deps: model.deps });

    const entity = getEntity(project.db, first.reportId)!;
    expect(entity).toMatchObject({ type: "reference", name: `《${BOOK_NAME}》${DECOMPOSE_REPORT_KIND}` });
    expect(entity.data).toMatchObject({ type: DECOMPOSE_REPORT_KIND, tags: [DECOMPOSE_REPORT_KIND] });
    expect(getDecomposeJob(project.db)!.merge_written.some((entry) => entry.id === first.reportId)).toBe(true);

    const report = reportDocument(project);
    for (const section of DECOMPOSE_REPORT_SECTIONS) expect(report.text).toContain(section);
    expect(report.text).toContain("全书剧情摘要正文。");
    expect(report.text).toContain("张三（主角）：张三的描述");
    expect(report.text).toContain("- 张三 ← 三哥（依据：同一人）");
    expect(report.text).toContain("批数 1 批");
    // 正文 = 按行拆段落块（不做 markdown 语义转换）；投影由块重算（不等于提交文本的拼装）
    expect(report.blocks.length).toBe(report.text.split("\n").length);
    expect(report.blocks[0]).toMatchObject({ type: "paragraph" });
    expect(report.doc.content_text).toBe(blocksToPlainMd(JSON.parse(report.doc.content)));

    model.script([aliasResponse("张三", ["三哥"]), "第二遍剧情摘要。"]);
    const second = await runMerge({ project, jobId, deps: model.deps });
    expect(second.reportId).toBe(first.reportId);
    expect(listEntities(project.db, { type: "reference" }).total).toBe(1);
  });

  it("提示词：别名归并只看候选清单（名字 + 出现章数 + 首见章 + 短摘要），报告只看章摘要", async () => {
    const model = await fakeModel();
    const { project, jobId } = projectFixture();
    writeBatch(project.db, jobId, 1, batchResult(baseSpecs()));
    model.script([aliasResponse("张三", ["三哥"]), "剧情摘要。"]);

    await runMerge({ project, jobId, deps: model.deps });

    expect(model.prompts).toHaveLength(2); // S3 一次 + S4 一次
    expect(model.prompts[0]).toContain("张三（出现 6 章，首见第 1 章）：张三的描述");
    expect(model.prompts[0]).toContain("三哥（出现 2 章，首见第 3 章）：三哥的描述（较完整的一条）");
    expect(model.systems[0]).toContain(
      `每组名字数（含规范名）在 ${DECOMPOSE_ALIAS_GROUP_MIN_NAMES} 到 ${DECOMPOSE_ALIAS_GROUP_MAX} 之间`,
    );
    expect(model.prompts[0]).not.toContain("正文正文"); // 不把原文喂给归并调用
    expect(model.prompts[1]).toContain("第1章 标题1：摘要1");
    expect(model.prompts[1]).not.toContain("正文正文"); // 报告只看章摘要
  });
});
