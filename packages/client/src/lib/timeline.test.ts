// lib/timeline 纯函数测试（C3，决策 26；G2.3 修订）
// 覆盖：拖拽插入位计算（eventDropOrder，双轨共用）、G2 双实体模型（buildTimelineModel——
//   时间点组块 + 事件挂载 + 未挂载兜底区）、事件拖入组块 order（eventOrderIntoGroup）、
//   标签收集/筛选/解析、事件表单共享函数（eventFormFromDetail / buildEventDetailPatch——
//   C3 编辑对话框与 C4 详情页共用，原测试位于 timeline-detail.test.ts，随函数迁入本文件）
import { describe, expect, it } from "vitest";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import type { RelationSummaryItem } from "./api";
import {
  applyTagSuggestion,
  buildEventDetailPatch,
  buildTimelineModel,
  collectEventTags,
  eventDescription,
  eventDropOrder,
  eventFormFromDetail,
  eventOrderIntoGroup,
  eventTagsOf,
  filterEventsByTag,
  parseTagsInput,
  suggestTags,
  tagsToInput,
} from "./timeline";

/** 构造事件摘要（summary 关心 tags 与 description——G2 无 time_label） */
function eventOf(id: string, tags?: string[], description?: string): EntitySummary {
  const summary: Record<string, unknown> = {};
  if (tags !== undefined) summary.tags = tags;
  if (description !== undefined) summary.description = description;
  return {
    id,
    type: "event",
    name: `事件${id}`,
    summary,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

/** 构造时间点摘要（name = 时间标签文本） */
function timepointOf(id: string, name: string): EntitySummary {
  return {
    id,
    type: "timepoint",
    name,
    summary: {},
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

/** 构造 occurs_at 挂载边（timepoint → event，G2 方向约定） */
function mountOf(timepointId: string, eventId: string): RelationSummaryItem {
  return {
    id: `rel-${timepointId}-${eventId}`,
    sourceType: "timepoint",
    sourceId: timepointId,
    targetType: "event",
    targetId: eventId,
    relationType: "occurs_at",
    createdAt: "2026-08-01T00:00:00Z",
  };
}

describe("eventDropOrder（拖拽插入位 → order，C3；G2 双轨共用——事件/时间点各自调用）", () => {
  const ids = ["ev-a", "ev-b", "ev-c"];

  it("before → 锚点 index；after → index+1；end → 长度（同 dropInsertOrder 语义）", () => {
    expect(eventDropOrder(ids, { kind: "before", id: "ev-b" })).toBe(1);
    expect(eventDropOrder(ids, { kind: "after", id: "ev-b" })).toBe(2);
    expect(eventDropOrder(ids, { kind: "end" })).toBe(3);
  });

  it("剔除拖拽项：锚点在拖拽项下方时修正 1 位错位（S13 同款语义）", () => {
    // 拖 ev-a 到 ev-c 之后：剔除 ev-a 后 [ev-b, ev-c]，after ev-c → 2（真实位移 ev-a → 末尾）
    expect(eventDropOrder(ids, { kind: "after", id: "ev-c" }, "ev-a")).toBe(2);
    // 拖 ev-c 到 ev-a 之前：剔除 ev-c 后 [ev-a, ev-b]，before ev-a → 0
    expect(eventDropOrder(ids, { kind: "before", id: "ev-a" }, "ev-c")).toBe(0);
  });

  it("锚点不存在 → 末尾（防御；列表与拖拽态同源，理论不可达）", () => {
    expect(eventDropOrder(ids, { kind: "after", id: "ev-ghost" }, "ev-a")).toBe(2);
    expect(eventDropOrder(ids, { kind: "before", id: "ev-ghost" })).toBe(3);
  });

  it("时间点列表同款调用（全局时间点线性序，G2 双独立线性序）", () => {
    const tpIds = ["tp-a", "tp-b", "tp-c"];
    expect(eventDropOrder(tpIds, { kind: "after", id: "tp-b" }, "tp-a")).toBe(1);
  });
});

describe("eventTagsOf / eventDescription（事件行摘要防御提取，F3 垂直时间轴行渲染）", () => {
  it("eventTagsOf：tags 缺失/非数组 → 空数组；过滤非字符串成员", () => {
    expect(eventTagsOf(eventOf("a"))).toEqual([]);
    expect(eventTagsOf(eventOf("b", ["主线", 42 as unknown as string]))).toEqual(["主线"]);
  });

  it("eventDescription：description 缺失/非字符串 → 空串（行内不渲染描述区）；正常值原样返回", () => {
    expect(eventDescription(eventOf("a"))).toBe("");
    expect(eventDescription({ ...eventOf("b"), summary: { description: 42 } })).toBe("");
    expect(eventDescription({ ...eventOf("c"), summary: { description: "拜入山门" } })).toBe(
      "拜入山门",
    );
  });
});

describe("buildTimelineModel（G2 双实体模型：时间点组块 + 事件挂载 + 未挂载兜底区）", () => {
  const tps = [timepointOf("tp-a", "第二天黄昏"), timepointOf("tp-b", "少年时")];

  it("组序 = timepoints 传入序（timepoint.sort_order 投影）；组内事件 = 事件传入序投影；未挂载独立", () => {
    const model = buildTimelineModel(
      tps,
      [eventOf("e1"), eventOf("e2"), eventOf("e3")],
      [mountOf("tp-a", "e2"), mountOf("tp-b", "e3")],
    );
    expect(model.groups.map((g) => g.timepoint.id)).toEqual(["tp-a", "tp-b"]);
    expect(model.groups[0].events.map((e) => e.id)).toEqual(["e2"]);
    expect(model.groups[1].events.map((e) => e.id)).toEqual(["e3"]);
    expect(model.ungrouped.map((e) => e.id)).toEqual(["e1"]);
  });

  it("空时间点组保留（时间点是真实实体——空组仍渲染，可后续拖入事件）", () => {
    const model = buildTimelineModel([timepointOf("tp-empty", "空组")], [], []);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].events).toEqual([]);
    expect(model.ungrouped).toEqual([]);
  });

  it("非 occurs_at / 非 timepoint 源的边不参与挂载（防御：occurs_at 双语义——appears_in 等不入映射）", () => {
    const model = buildTimelineModel(
      tps,
      [eventOf("e1")],
      [
        mountOf("tp-a", "e1"),
        { ...mountOf("tp-b", "e1"), relationType: "occurs_in" },
        { ...mountOf("tp-b", "e1"), sourceType: "outline_node" },
      ],
    );
    expect(model.groups[0].events.map((e) => e.id)).toEqual(["e1"]);
    expect(model.groups[1].events).toEqual([]);
    expect(model.ungrouped).toEqual([]);
  });

  it("挂载点不在时间点列表 → 事件归未挂载（防御：服务端级联软删保证 occurs_at 端点存活）", () => {
    const model = buildTimelineModel(tps, [eventOf("e1")], [mountOf("tp-ghost", "e1")]);
    expect(model.ungrouped.map((e) => e.id)).toEqual(["e1"]);
  });

  it("单事件多条挂载边 → 首次出现者胜（防御：服务端 1:n 校验，理论不可达）", () => {
    const model = buildTimelineModel(
      tps,
      [eventOf("e1")],
      [mountOf("tp-a", "e1"), mountOf("tp-b", "e1")],
    );
    expect(model.groups[0].events.map((e) => e.id)).toEqual(["e1"]);
    expect(model.groups[1].events).toEqual([]);
  });

  it("空输入 → 空模型（无时间点、无事件、无边）", () => {
    const model = buildTimelineModel([], [], []);
    expect(model.groups).toEqual([]);
    expect(model.ungrouped).toEqual([]);
  });
});

describe("eventOrderIntoGroup（事件拖入组块的插入位 order，G2 双轨拖拽）", () => {
  // 模型：tp-a 组 [e1, e2]、tp-b 组 [e3]、tp-c 空组；未挂载 [u1, u2]
  const tps = [timepointOf("tp-a", "A"), timepointOf("tp-b", "B"), timepointOf("tp-c", "C")];
  const events = [eventOf("e1"), eventOf("e2"), eventOf("e3"), eventOf("u1"), eventOf("u2")];
  const edges = [mountOf("tp-a", "e1"), mountOf("tp-a", "e2"), mountOf("tp-b", "e3")];
  const model = buildTimelineModel(tps, events, edges);
  // 投影序：e1, e2, e3, u1, u2（组块序 + 未挂载区序）

  it("组内 before/after：锚定组首/末事件（剔除拖拽项后 index）", () => {
    // 拖 e3 到 tp-a 组前（before）→ 剔除 e3 后 [e1, e2, u1, u2]，before e1 → 0
    expect(eventOrderIntoGroup(model.groups, model.ungrouped, 0, "before", "e3")).toBe(0);
    // 拖 u1 到 tp-b 组后（after）→ 剔除 u1 后 [e1, e2, e3, u2]，after e3 → 3
    expect(eventOrderIntoGroup(model.groups, model.ungrouped, 1, "after", "u1")).toBe(3);
  });

  it("未挂载区 before/after：锚定未挂载首/末事件", () => {
    // 拖 e1 到未挂载区前（before）→ 剔除 e1 后 [e2, e3, u1, u2]，before u1 → 2
    expect(eventOrderIntoGroup(model.groups, model.ungrouped, -1, "before", "e1")).toBe(2);
    // 拖 e1 到未挂载区后（after）→ 剔除 e1 后 [e2, e3, u1, u2]，after u2 → 4
    expect(eventOrderIntoGroup(model.groups, model.ungrouped, -1, "after", "e1")).toBe(4);
  });

  it("空组：before → 其后最近非空组首事件前；after → 其前最近非空组末事件后（空组无锚点事件）", () => {
    // tp-c 空组：before → 其后无非空组 → 兜底首事件前 = 0；after → 其前最近非空组 = tp-b 末事件 e3 后
    expect(eventOrderIntoGroup(model.groups, model.ungrouped, 2, "before", "u1")).toBe(0);
    // 剔除 u1 后 [e1, e2, e3, u2]，after e3 → 3
    expect(eventOrderIntoGroup(model.groups, model.ungrouped, 2, "after", "u1")).toBe(3);
  });

  it("空未挂载区（无任何事件）：兜底 → 首位 0（防御分支）", () => {
    const empty = buildTimelineModel(tps, [], []);
    expect(eventOrderIntoGroup(empty.groups, empty.ungrouped, -1, "before", "e-new")).toBe(0);
    expect(eventOrderIntoGroup(empty.groups, empty.ungrouped, -1, "after", "e-new")).toBe(0);
  });

  it("拖拽事件在目标组内（剔除自身后锚点 index 修正——S13 同款防 1 位错位）", () => {
    // 拖 e1（tp-a 组内）到同组 e2 之后：剔除 e1 后 [e2, e3, u1, u2]，after e2 → 1
    expect(eventOrderIntoGroup(model.groups, model.ungrouped, 0, "after", "e1")).toBe(1);
  });
});

describe("collectEventTags（标签聚合，timeline.md 筛选器）", () => {
  it("去重 + 稳定序（按列表序首次出现）", () => {
    const tags = collectEventTags([
      eventOf("a", ["主线", "战争"]),
      eventOf("b", ["身世", "主线"]),
      eventOf("c", ["战争"]),
    ]);
    expect(tags).toEqual(["主线", "战争", "身世"]);
  });

  it("空串与非法成员防御（非字符串数组成员忽略；tags 缺失/非数组 → 无贡献）", () => {
    const bad = eventOf("bad", ["ok", "", 42 as unknown as string]);
    expect(collectEventTags([bad, eventOf("none")])).toEqual(["ok"]);
    expect(collectEventTags([])).toEqual([]);
  });
});

describe("filterEventsByTag（标签筛选）", () => {
  const items = [eventOf("a", ["主线"]), eventOf("b", ["战争"]), eventOf("c")];

  it("null/空串 → 全部；命中 → 仅含该 tag 的事件", () => {
    expect(filterEventsByTag(items, null)).toHaveLength(3);
    expect(filterEventsByTag(items, "")).toHaveLength(3);
    expect(filterEventsByTag(items, "主线").map((i) => i.id)).toEqual(["a"]);
  });

  it("无匹配 → 空数组（「没有匹配」态）；再次点击取消由调用方传 null", () => {
    expect(filterEventsByTag(items, "不存在")).toEqual([]);
  });
});

describe("suggestTags / applyTagSuggestion（标签输入建议，F8 timeline.md 标签输入建议节）", () => {
  const pool = ["主线", "战争", "身世", "主线暗线", "宫廷线"];

  it("最后一段包含匹配（大小写不敏感）+ 稳定序（按 allTags 顺序）", () => {
    expect(suggestTags("主", pool)).toEqual(["主线", "主线暗线"]);
    expect(suggestTags("MAIN", ["Main", "main2", "Other"])).toEqual(["Main", "main2"]);
  });

  it("排除已选标签（前面各段已含的不再建议；最后一段与已选相同 → 无建议）", () => {
    expect(suggestTags("主线，主", pool)).toEqual(["主线暗线"]);
    expect(suggestTags("主线，主线", pool)).toEqual(["主线暗线"]);
  });

  it("最后一段为空（整串空 / 以分隔符结尾）→ 无建议", () => {
    expect(suggestTags("", pool)).toEqual([]);
    expect(suggestTags("主线，", pool)).toEqual([]);
    expect(suggestTags("主线、\n", pool)).toEqual([]);
  });

  it("limit 默认 5、可自定义；无匹配 → []；allTags 重复去重", () => {
    // 池内含「线」的仅 3 个（主线/主线暗线/宫廷线）——limit 默认 5 不截断，验证用超 5 匹配的池
    expect(suggestTags("线", pool)).toHaveLength(3);
    const many = ["线1", "线2", "线3", "线4", "线5", "线6"];
    expect(suggestTags("线", many)).toHaveLength(5);
    expect(suggestTags("线", many, 2)).toEqual(["线1", "线2"]);
    expect(suggestTags("不存在", pool)).toEqual([]);
    expect(suggestTags("主", ["主线", "主线", "主线2"])).toEqual(["主线", "主线2"]);
  });

  it("applyTagSuggestion：最后一段替换为所选标签 + 追加逗号（多分隔符输入统一收敛为中文逗号）", () => {
    expect(applyTagSuggestion("主", "主线")).toBe("主线，");
    expect(applyTagSuggestion("主线，主", "主线2")).toBe("主线，主线2，");
    expect(applyTagSuggestion("主线、战", "战争")).toBe("主线，战争，");
    // 替换后最后一段为空 → 建议区消失（suggestTags 空段不匹配）
    expect(suggestTags(applyTagSuggestion("主", "主线"), pool)).toEqual([]);
  });
});

describe("parseTagsInput / tagsToInput（标签输入解析，新建/编辑表单）", () => {
  it("逗号（中英文）/顿号/换行分隔；trim + 去重 + 过滤空串", () => {
    expect(parseTagsInput("主线,战争")).toEqual(["主线", "战争"]);
    expect(parseTagsInput("主线，战争、 身世 \n主线")).toEqual(["主线", "战争", "身世"]);
    expect(parseTagsInput("  , ，\n")).toEqual([]);
  });

  it("tagsToInput：数组 → 中文逗号串（与 parseTagsInput 互逆）；非数组/缺失 → 空串", () => {
    expect(tagsToInput(["主线", "战争"])).toBe("主线，战争");
    expect(tagsToInput("主线")).toBe("");
    expect(tagsToInput(undefined)).toBe("");
  });

  it("往返一致：parseTagsInput(tagsToInput(tags)) 还原数组（去重后）", () => {
    expect(parseTagsInput(tagsToInput(["主线", "战争", "主线"]))).toEqual(["主线", "战争"]);
  });
});

describe("eventFormFromDetail（详情响应 → 表单初始值；C3 编辑预填/C4 详情页共用；G2 无 time_label）", () => {
  it("name + data 两字段完整提取（tags 数组 → 逗号输入串）", () => {
    const form = eventFormFromDetail({
      name: "主角踏入宗门",
      data: { description: "拜入山门", tags: ["主线", "战争"] },
    });
    expect(form).toEqual({
      name: "主角踏入宗门",
      description: "拜入山门",
      tagsInput: "主线，战争",
    });
  });

  it("缺失/非字符串字段防御 → 空串；tags 非数组 → 空串", () => {
    const form = eventFormFromDetail({
      name: "无描述事件",
      data: { tags: "主线" },
    });
    expect(form).toEqual({ name: "无描述事件", description: "", tagsInput: "" });
  });
});

describe("buildEventDetailPatch（保存 patch，稀疏提交 + 清空语义；G2：仅 description/tags）", () => {
  const original = {
    name: "主角踏入宗门",
    data: { description: "拜入山门", tags: ["主线"] },
  };
  const baseForm = { name: "主角踏入宗门", description: "拜入山门", tagsInput: "主线" };

  it("无变更 → null（「没有变更」）", () => {
    expect(buildEventDetailPatch(original, baseForm)).toBeNull();
  });

  it("name 变化（trim 后比对）→ 仅提交 name", () => {
    const patch = buildEventDetailPatch(original, { ...baseForm, name: "  主角踏入山门  " });
    expect(patch).toEqual({ name: "主角踏入山门" });
  });

  it("description 变化 → 仅提交 data.description（其余未改字段不提交）", () => {
    const patch = buildEventDetailPatch(original, {
      ...baseForm,
      description: "拜入山门，遇见师兄",
    });
    expect(patch).toEqual({ data: { description: "拜入山门，遇见师兄" } });
  });

  it("tags 输入解析收敛后比对（多分隔符；与 parseTagsInput 同源）", () => {
    const patch = buildEventDetailPatch(original, { ...baseForm, tagsInput: "主线， 战争 \n主线" });
    expect(patch).toEqual({ data: { tags: ["主线", "战争"] } });
  });

  it("清空 description（原值「拜入山门」非空）→ 提交空串显式清除", () => {
    const patch = buildEventDetailPatch(original, { ...baseForm, description: "" });
    expect(patch).toEqual({ data: { description: "" } });
  });

  it("清空 tags（原值「主线」，tagsInput 空串）→ 提交空数组显式清除", () => {
    const patch = buildEventDetailPatch(original, { ...baseForm, tagsInput: "" });
    expect(patch).toEqual({ data: { tags: [] } });
  });

  it("空表单 + 空 data → null（无字段可提交）", () => {
    expect(
      buildEventDetailPatch(
        { name: "空事件", data: {} },
        { name: "空事件", description: "", tagsInput: "" },
      ),
    ).toBeNull();
  });

  it("原值缺失（data 无 description 键）+ 表单有值 → 提交新值", () => {
    const patch = buildEventDetailPatch(
      { name: "X", data: {} },
      { name: "X", description: "新描述", tagsInput: "" },
    );
    expect(patch).toEqual({ data: { description: "新描述" } });
  });

  it("全空格输入（trim 后为空）→ 等价清空：提交空串显式清除", () => {
    const patch = buildEventDetailPatch(original, { ...baseForm, description: "   " });
    expect(patch).toEqual({ data: { description: "" } });
  });

  it("幂等：原值已为空串/空数组 + 空表单 → null（清空后重复保存不产生多余 patch）", () => {
    // 仅 description 已清空（其余字段未变）→ 无变更
    expect(
      buildEventDetailPatch(
        { name: "X", data: { description: "", tags: ["主线"] } },
        { name: "X", description: "", tagsInput: "主线" },
      ),
    ).toBeNull();
    // 两字段全空原值 + 全空表单 → 无变更（重点：清空后再次保存不产生多余 patch）
    expect(
      buildEventDetailPatch(
        { name: "X", data: { description: "", tags: [] } },
        { name: "X", description: "", tagsInput: "" },
      ),
    ).toBeNull();
  });
});
