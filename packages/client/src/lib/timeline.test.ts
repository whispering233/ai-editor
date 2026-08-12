// lib/timeline 纯函数测试（C3，决策 26）
// 覆盖：拖拽插入位计算（eventDropOrder，同 dropInsertOrder 语义）、标签收集/筛选/解析、
//       事件表单共享函数（eventFormFromDetail / buildEventDetailPatch——C3 编辑对话框与 C4 详情页共用，
//       原测试位于 timeline-detail.test.ts，随函数迁入本文件）
import { describe, expect, it } from "vitest";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import {
  buildEventDetailPatch,
  collectEventTags,
  eventDropOrder,
  eventFormFromDetail,
  filterEventsByTag,
  parseTagsInput,
  tagsToInput,
} from "./timeline";

/** 构造事件摘要（summary 只关心 tags） */
function eventOf(id: string, tags?: string[]): EntitySummary {
  return {
    id,
    type: "event",
    name: `事件${id}`,
    summary: tags === undefined ? {} : { tags },
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

describe("buildEventDetailPatch（保存 patch，C3 编辑对话框与 C4 详情页共用同一稀疏提交语义）", () => {
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

  it("清空某字段 → 该键不提交（稀疏语义：undefined 序列化被丢弃，data 为空对象 = 服务端无操作）", () => {
    const patch = buildEventDetailPatch(original, {
      name: "主角踏入宗门",
      description: "",
      timeLabel: "第二天黄昏",
      tagsInput: "主线",
    });
    expect(patch).not.toBeNull();
    // 与 C3 handleEditSave 同款：changed[description] = undefined，JSON 序列化后 data 为空对象
    expect(JSON.parse(JSON.stringify(patch))).toEqual({ data: {} });
  });

  it("空表单 + 空 data → null（无字段可提交）", () => {
    expect(
      buildEventDetailPatch(
        { name: "空事件", data: {} },
        { name: "空事件", description: "", timeLabel: "", tagsInput: "" },
      ),
    ).toBeNull();
  });
});
