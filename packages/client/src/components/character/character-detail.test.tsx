// 人物详情双视图渲染走查（卡 3.2）：仓内无 jsdom/@testing-library（既有纪律：不引新依赖），
// 用 react-dom/server renderToString 直渲染展示层（`CharacterDetailView`——数据/副作用在容器，SSR 不跑 effect；
// 且 SSR 读的是 store 的 server snapshot，故当前位置/大纲一律由 props 注入，不依赖 setState 播种）。
// 覆盖：页头壳（元信息行无「变更记录」入口）/ tab 行两 tab / tab 1 可编辑 / tab 2 只读（全部 disabled + caption）/
//       未设置当前位置的提示与「去大纲设位置」入口 / 关系区块保持既有能力。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { CharacterDetailView } from "./character-detail";
import type { FlatNodeOption } from "../../lib/outline-tree";
import type { EntityDetailRes } from "../../lib/api";

const DETAIL: EntityDetailRes = {
  id: "char-1",
  type: "character",
  name: "张三",
  data: {
    role: "主角",
    alias: "张铁柱",
    gender: "男",
    age: 18,
    personality: ["坚韧", "多疑"],
    motivation: "为父报仇",
  },
  relations: [],
  deltaCount: 0,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-02T10:00:00Z",
};

const FORM = { ...DETAIL.data };
const NODES: FlatNodeOption[] = [{ id: "ch-1", label: "第一章", depth: 1 }];

function render(
  tab: "initial" | "current",
  opts: {
    currentPosition?: string | null;
    outlineNodes?: FlatNodeOption[];
    outlineLoaded?: boolean;
    outlineLoading?: boolean;
  } = {},
): string {
  return renderToString(
    <CharacterDetailView
      detail={DETAIL}
      form={FORM}
      onFieldChange={() => {}}
      tab={tab}
      onTabChange={() => {}}
      saving={false}
      saveError={null}
      onSave={() => {}}
      onDelete={() => {}}
      onReload={() => {}}
      currentPosition={opts.currentPosition ?? null}
      outlineNodes={opts.outlineNodes ?? NODES}
      outlineLoaded={opts.outlineLoaded ?? true}
      outlineLoading={opts.outlineLoading ?? false}
      onLoadOutline={() => {}}
    />,
  );
}

/** 只读态断言用：SSR 输出里 antd 的禁用控件渲染为 `disabled=""` */
function countDisabled(html: string): number {
  return html.split('disabled=""').length - 1;
}

describe("CharacterDetailView（页头 + tab 行）", () => {
  it("页头保持：标题 + 保存/移入回收站 + 元信息行；元信息行的「变更记录 N 条」按钮已取消", () => {
    const html = render("initial");
    expect(html).toContain("张三");
    // antd 会给两个汉字的按钮文案插空格（autoInsertSpace）——按可含空格断言
    expect(html).toMatch(/保\s*存/);
    expect(html).toContain("移入回收站");
    expect(html).toContain("创建于");
    expect(html).toContain("更新于");
    // 被 tab 2 吸收的入口（原按钮 title）：不再渲染
    expect(html).not.toContain("展开状态预览");
  });

  it("tab 行渲染两个 tab（初始化数据 / 当前位置数据）", () => {
    const html = render("initial");
    expect(html).toContain("初始化数据");
    expect(html).toContain("当前位置数据");
  });

  it("关系区块保留既有能力（列表空态 + 新增关联入口）", () => {
    const html = render("initial");
    expect(html).toContain("关联");
    expect(html).toContain("+ 新增关联");
    expect(html).toContain("暂无关联，新增一个");
  });
});

describe("CharacterDetailView（tab 1 可编辑）", () => {
  it("初始化数据 tab：字段可编辑（无 disabled 控件）", () => {
    const html = render("initial");
    expect(html).toContain("基础信息");
    expect(html).toContain("角色定位");
    expect(html).toContain("假名");
    expect(countDisabled(html)).toBe(0);
  });
});

describe("CharacterDetailView（tab 2 只读）", () => {
  it("输入控件全部 disabled（不隐藏）+ 区首「由变更记录累积，只读」caption", () => {
    const html = render("current", { currentPosition: "ch-1" });
    expect(html).toContain("由变更记录累积，只读");
    expect(html).toContain("当前位置数据（只读）");
    // 字段仍在（结构不变、位置稳定），只是禁用
    expect(html).toContain("角色定位");
    expect(countDisabled(html)).toBeGreaterThan(0);
    // 计算节点选择器保留（可手选任意节点）
    expect(html).toContain("计算节点");
  });

  it("未设置当前位置 → 提示 + 「去大纲设位置」入口（#/outline）", () => {
    const html = render("current", { currentPosition: null });
    expect(html).toContain("未设置当前位置，显示初始数据");
    expect(html).toContain("#/outline");
  });

  it("已设置当前位置 → 不渲染「未设置」提示", () => {
    const html = render("current", { currentPosition: "ch-1" });
    expect(html).not.toContain("未设置当前位置");
  });

  it("无变更记录 → 轻量空态文案（当前状态即初始状态）", () => {
    const html = render("current", { currentPosition: "ch-1" });
    expect(html).toContain("暂无变更记录——当前状态即初始状态");
  });

  it("大纲未加载 → 给「加载大纲」入口（不静默失败）", () => {
    const html = render("current", { currentPosition: "ch-1", outlineLoaded: false });
    expect(html).toContain("大纲未加载");
    expect(html).toContain("加载大纲");
  });

  it("大纲在途加载 → 只给加载文案（不给重复按钮）", () => {
    const html = render("current", {
      currentPosition: "ch-1",
      outlineLoaded: false,
      outlineLoading: true,
    });
    expect(html).toContain("大纲加载中…");
    expect(html).not.toContain("加载大纲");
  });
});
