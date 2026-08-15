// lib/timeline 纯函数测试（C3，决策 26）
// 覆盖：拖拽插入位计算（eventDropOrder，同 dropInsertOrder 语义）、标签收集/筛选/解析、
//       事件表单共享函数（eventFormFromDetail / buildEventDetailPatch——C3 编辑对话框与 C4 详情页共用，
//       原测试位于 timeline-detail.test.ts，随函数迁入本文件）
import { describe, expect, it } from "vitest";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import {
  buildEventDetailPatch,
  collectEventTags,
  eventDescription,
  eventDropOrder,
  eventFormFromDetail,
  eventTagsOf,
  eventTimeLabel,
  filterEventsByTag,
  groupDropOrders,
  groupEventsByTimeLabel,
  parseTagsInput,
  tagsToInput,
} from "./timeline";

/** 构造事件摘要（summary 关心 tags 与 time_label——F4 分组测试） */
function eventOf(id: string, tags?: string[], timeLabel?: string): EntitySummary {
  const summary: Record<string, unknown> = {};
  if (tags !== undefined) summary.tags = tags;
  if (timeLabel !== undefined) summary.time_label = timeLabel;
  return {
    id,
    type: "event",
    name: `事件${id}`,
    summary,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

describe("eventDropOrder（拖拽插入位 → order，C3）", () => {
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
});

describe("eventTagsOf / eventTimeLabel（事件行摘要防御提取，F3 垂直时间轴行渲染）", () => {
  it("eventTagsOf：tags 缺失/非数组 → 空数组；过滤非字符串成员", () => {
    expect(eventTagsOf(eventOf("a"))).toEqual([]);
    expect(eventTagsOf(eventOf("b", ["主线", 42 as unknown as string]))).toEqual(["主线"]);
  });

  it("eventTimeLabel：time_label 缺失/非字符串 → 空串（行内「未标注时间」）；正常值原样返回", () => {
    expect(eventTimeLabel(eventOf("a"))).toBe("");
    expect(eventTimeLabel({ ...eventOf("b"), summary: { time_label: 42 } })).toBe("");
    expect(eventTimeLabel({ ...eventOf("c"), summary: { time_label: "第二天黄昏" } })).toBe("第二天黄昏");
  });

  it("eventDescription：description 缺失/非字符串 → 空串（行内不渲染描述区）；正常值原样返回", () => {
    expect(eventDescription(eventOf("a"))).toBe("");
    expect(eventDescription({ ...eventOf("b"), summary: { description: 42 } })).toBe("");
    expect(eventDescription({ ...eventOf("c"), summary: { description: "拜入山门" } })).toBe("拜入山门");
  });
});

describe("collectEventTags（标签聚合，timeline.md 筛选器）", () => {
  it("去重 + 稳定序（按列表序首次出现）", () => {
    const tags = collectEventTags([eventOf("a", ["主线", "战争"]), eventOf("b", ["身世", "主线"]), eventOf("c", ["战争"])]);
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

describe("eventFormFromDetail（详情响应 → 表单初始值；C3 编辑预填/C4 详情页共用）", () => {
  it("name + data 三字段完整提取（tags 数组 → 逗号输入串）", () => {
    const form = eventFormFromDetail({
      name: "主角踏入宗门",
      data: { description: "拜入山门", time_label: "第二天黄昏", tags: ["主线", "战争"] },
    });
    expect(form).toEqual({
      name: "主角踏入宗门",
      description: "拜入山门",
      timeLabel: "第二天黄昏",
      tagsInput: "主线，战争",
    });
  });

  it("缺失/非字符串字段防御 → 空串；tags 非数组 → 空串", () => {
    const form = eventFormFromDetail({
      name: "无描述事件",
      data: { time_label: 42, tags: "主线" },
    });
    expect(form).toEqual({ name: "无描述事件", description: "", timeLabel: "", tagsInput: "" });
  });
});

describe("buildEventDetailPatch（保存 patch，C3 编辑对话框与 C4 详情页共用同一稀疏提交语义；清空语义：表单空且原值非空 → 提交空值显式清除）", () => {
  const original = {
    name: "主角踏入宗门",
    data: { description: "拜入山门", time_label: "第二天黄昏", tags: ["主线"] },
  };

  it("无变更 → null（「没有变更」）", () => {
    expect(
      buildEventDetailPatch(original, {
        name: "主角踏入宗门",
        description: "拜入山门",
        timeLabel: "第二天黄昏",
        tagsInput: "主线",
      }),
    ).toBeNull();
  });

  it("name 变化（trim 后比对）→ 仅提交 name", () => {
    const patch = buildEventDetailPatch(original, {
      name: "  主角踏入山门  ",
      description: "拜入山门",
      timeLabel: "第二天黄昏",
      tagsInput: "主线",
    });
    expect(patch).toEqual({ name: "主角踏入山门" });
  });

  it("description 变化 → 仅提交 data.description（其余未改字段不提交）", () => {
    const patch = buildEventDetailPatch(original, {
      name: "主角踏入宗门",
      description: "拜入山门，遇见师兄",
      timeLabel: "第二天黄昏",
      tagsInput: "主线",
    });
    expect(patch).toEqual({ data: { description: "拜入山门，遇见师兄" } });
  });

  it("tags 输入解析收敛后比对（多分隔符；与 parseTagsInput 同源）", () => {
    const patch = buildEventDetailPatch(original, {
      name: "主角踏入宗门",
      description: "拜入山门",
      timeLabel: "第二天黄昏",
      tagsInput: "主线， 战争 \n主线",
    });
    expect(patch).toEqual({ data: { tags: ["主线", "战争"] } });
  });

  it("time_label 变化 → 提交 data.time_label", () => {
    const patch = buildEventDetailPatch(original, {
      name: "主角踏入宗门",
      description: "拜入山门",
      timeLabel: "少年时",
      tagsInput: "主线",
    });
    expect(patch).toEqual({ data: { time_label: "少年时" } });
  });

  it("清空 description（原值「拜入山门」非空）→ 提交空串显式清除", () => {
    const patch = buildEventDetailPatch(original, {
      name: "主角踏入宗门",
      description: "",
      timeLabel: "第二天黄昏",
      tagsInput: "主线",
    });
    expect(patch).toEqual({ data: { description: "" } });
  });

  it("清空 time_label（原值「第二天黄昏」非空）→ 提交空串显式清除", () => {
    const patch = buildEventDetailPatch(original, {
      name: "主角踏入宗门",
      description: "拜入山门",
      timeLabel: "",
      tagsInput: "主线",
    });
    expect(patch).toEqual({ data: { time_label: "" } });
  });

  it("清空 tags（原值「主线」，tagsInput 空串）→ 提交空数组显式清除", () => {
    const patch = buildEventDetailPatch(original, {
      name: "主角踏入宗门",
      description: "拜入山门",
      timeLabel: "第二天黄昏",
      tagsInput: "",
    });
    expect(patch).toEqual({ data: { tags: [] } });
  });

  it("空表单 + 空 data → null（无字段可提交）", () => {
    expect(
      buildEventDetailPatch(
        { name: "空事件", data: {} },
        { name: "空事件", description: "", timeLabel: "", tagsInput: "" },
      ),
    ).toBeNull();
  });

  it("原值缺失（data 无 description 键）+ 表单有值 → 提交新值", () => {
    const patch = buildEventDetailPatch(
      { name: "X", data: { time_label: "第二天黄昏" } },
      { name: "X", description: "新描述", timeLabel: "第二天黄昏", tagsInput: "" },
    );
    expect(patch).toEqual({ data: { description: "新描述" } });
  });

  it("全空格输入（trim 后为空）→ 等价清空：提交空串显式清除", () => {
    const patch = buildEventDetailPatch(original, {
      name: "主角踏入宗门",
      description: "   ",
      timeLabel: "第二天黄昏",
      tagsInput: "主线",
    });
    expect(patch).toEqual({ data: { description: "" } });
  });

  it("幂等：原值已为空串/空数组 + 空表单 → null（清空后重复保存不产生多余 patch）", () => {
    // 仅 description 已清空（其余字段未变）→ 无变更
    expect(
      buildEventDetailPatch(
        { name: "X", data: { description: "", time_label: "第二天黄昏", tags: ["主线"] } },
        { name: "X", description: "", timeLabel: "第二天黄昏", tagsInput: "主线" },
      ),
    ).toBeNull();
    // 三字段全空原值 + 全空表单 → 无变更（重点：清空后再次保存不产生多余 patch）
    expect(
      buildEventDetailPatch(
        { name: "X", data: { description: "", time_label: "", tags: [] } },
        { name: "X", description: "", timeLabel: "", tagsInput: "" },
      ),
    ).toBeNull();
  });
});

describe("groupEventsByTimeLabel（时间点分组，F4 timeline.md 时间点分组线框）", () => {
  it("同 time_label 聚为一组；组序 = 组内最早事件的列表 index 序（sort_order 投影）", () => {
    // [a(黄昏), b(少年), c(黄昏)] → 黄昏组（a 先于 c）、少年组
    const groups = groupEventsByTimeLabel([
      eventOf("a", undefined, "第二天黄昏"),
      eventOf("b", undefined, "少年时"),
      eventOf("c", undefined, "第二天黄昏"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["第二天黄昏", "少年时"]);
    expect(groups[0].events.map((e) => e.id)).toEqual(["a", "c"]);
    expect(groups[1].events.map((e) => e.id)).toEqual(["b"]);
  });

  it("time_label trim 归一（' 第二天黄昏 ' 与 '第二天黄昏' 同组；label 为 trim 后值）", () => {
    const groups = groupEventsByTimeLabel([
      eventOf("a", undefined, "  第二天黄昏  "),
      eventOf("b", undefined, "第二天黄昏"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("第二天黄昏");
    expect(groups[0].label).toBe("第二天黄昏");
  });

  it("空标签（缺失/空串/非字符串）归兜底组（key ''），恒置末尾；组内按列表序平铺", () => {
    const groups = groupEventsByTimeLabel([
      eventOf("a", undefined, "第二天黄昏"),
      eventOf("b"), // 缺失 time_label
      eventOf("c", undefined, ""), // 空串
      eventOf("d", undefined, 42 as unknown as string), // 非字符串
      eventOf("e", undefined, "少年时"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["第二天黄昏", "少年时", ""]);
    expect(groups[2].events.map((e) => e.id)).toEqual(["b", "c", "d"]);
  });

  it("全部事件均有标签 → 无兜底组；空列表 → []", () => {
    expect(groupEventsByTimeLabel([eventOf("a", undefined, "黄昏"), eventOf("b", undefined, "少年")]).map((g) => g.key)).toEqual([
      "黄昏",
      "少年",
    ]);
    expect(groupEventsByTimeLabel([])).toEqual([]);
  });

  it("拖拽改序后分组随事件自然迁移（列表序即组序投影）", () => {
    // 把少年时事件移到最前 → 少年组成为第一组
    const groups = groupEventsByTimeLabel([
      eventOf("b", undefined, "少年时"),
      eventOf("a", undefined, "第二天黄昏"),
      eventOf("c", undefined, "第二天黄昏"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["少年时", "第二天黄昏"]);
  });
});

describe("groupDropOrders（组块拖拽插入位 → 组内各事件 move order，F4）", () => {
  const ids = ["ev-a", "ev-b", "ev-c", "ev-d", "ev-e"];

  it("多事件组移动到目标组之前：首个锚定插入位、后续跟随上一已移动事件", () => {
    // 拖组 [ev-c, ev-e] 到 ev-b 之前：c → before b = 1；e 跟随 c 后 → 2
    expect(groupDropOrders(ids, { kind: "before", id: "ev-b" }, ["ev-c", "ev-e"])).toEqual([1, 2]);
  });

  it("多事件组移动到目标组之后（首个 order = 锚点 index + 1；后续跟随）", () => {
    // 拖组 [ev-a, ev-b] 到 ev-d 之后：a → after d = 3；b 跟随 a → 3
    expect(groupDropOrders(ids, { kind: "after", id: "ev-d" }, ["ev-a", "ev-b"])).toEqual([3, 3]);
  });

  it("目标组在被拖组之后（剔除后锚点 index 修正——S13 同款防 1 位错位）", () => {
    // 拖组 [ev-a, ev-b] 到 ev-e 之后：a → after e = 4；b 跟随 a → 4
    expect(groupDropOrders(ids, { kind: "after", id: "ev-e" }, ["ev-a", "ev-b"])).toEqual([4, 4]);
  });

  it("end → 末尾（首个 = rest 长度；后续跟随）", () => {
    expect(groupDropOrders(ids, { kind: "end" }, ["ev-a", "ev-b"])).toEqual([4, 4]);
  });

  it("分散组（同标签事件在列表中不相邻）：逐个 move 后仍连续落在目标位", () => {
    // ids = [a, d, b, c, e]（a、b 分散），拖组 [a, b] 到 e 之后：
    // a → after e = 4；b 跟随 a → 4 → 最终 [d, c, e, a, b]（连续且保持组内序）
    expect(groupDropOrders(["ev-a", "ev-d", "ev-b", "ev-c", "ev-e"], { kind: "after", id: "ev-e" }, ["ev-a", "ev-b"])).toEqual([4, 4]);
  });

  it("单事件组与 eventDropOrder 等价（F3 行为完全一致）", () => {
    for (const insert of [
      { kind: "before", id: "ev-c" },
      { kind: "after", id: "ev-c" },
      { kind: "end" },
    ] as const) {
      expect(groupDropOrders(ids, insert, ["ev-a"])).toEqual([eventDropOrder(ids, insert, "ev-a")]);
    }
  });

  it("锚点不存在 → 末尾（防御；列表与拖拽态同源，理论不可达）", () => {
    expect(groupDropOrders(ids, { kind: "before", id: "ev-ghost" }, ["ev-a", "ev-b"])).toEqual([4, 4]);
  });

  it("空组 → 空序列（防御）", () => {
    expect(groupDropOrders(ids, { kind: "end" }, [])).toEqual([]);
  });
});
