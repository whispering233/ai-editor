// 人物详情双视图渲染走查（卡 3.2；卡 3.3 补：分区结构 / 必填内联错误 / 位置失效提示）。
// 仓内无 jsdom/@testing-library（既有纪律：不引新依赖），用 react-dom/server renderToString 直渲染展示层
// （`CharacterDetailView`——数据/副作用在容器，SSR 不跑 effect；且 SSR 读的是 store 的 server snapshot，
// 故当前位置/大纲一律由 props 注入，不依赖 setState 播种）。
// 覆盖：页头壳（元信息行无「变更记录」入口）/ tab 行两 tab / 字段分区与归属 / 能力面板宿主 /
//       `description` 必填内联错误 / tab 1 可编辑 / tab 2 只读（全部 disabled + caption）/
//       未设置与已失效两种提示 / 关系区块保持既有能力。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { CharacterDetailView } from "./character-detail";
import type { FlatNodeOption } from "../../lib/outline-tree";
import type { CharacterBasicsErrors, CharacterPositionState } from "../../lib/character-detail";
import type { EntityDetailRes } from "../../lib/api";

const DETAIL: EntityDetailRes = {
  id: "char-1",
  type: "character",
  name: "张三",
  data: {
    role: "主角",
    description: "青云门弟子",
    alias: "张铁柱",
    gender: "男",
    age: 18,
    race: "人族",
    personality: ["坚韧", "多疑"],
    motivation: "为父报仇",
    ability_panel: [
      { name: "火系", children: [{ name: "等级", value: 3 }] },
    ],
  },
  relations: [],
  deltaCount: 0,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-02T10:00:00Z",
};

const FORM = { ...DETAIL.data };
const NO_ERRORS: CharacterBasicsErrors = { name: null, description: null };
const NODES: FlatNodeOption[] = [{ id: "ch-1", label: "第一章", depth: 1 }];

function render(
  tab: "initial" | "current",
  opts: {
    currentPosition?: string | null;
    positionState?: CharacterPositionState;
    outlineNodes?: FlatNodeOption[];
    outlineLoaded?: boolean;
    outlineLoading?: boolean;
    name?: string;
    basicsErrors?: CharacterBasicsErrors;
  } = {},
): string {
  return renderToString(
    <CharacterDetailView
      detail={DETAIL}
      name={opts.name ?? DETAIL.name}
      onNameChange={() => {}}
      form={FORM}
      onFieldChange={() => {}}
      tab={tab}
      onTabChange={() => {}}
      basicsErrors={opts.basicsErrors ?? NO_ERRORS}
      saving={false}
      saveError={null}
      onSave={() => {}}
      onDelete={() => {}}
      onReload={() => {}}
      currentPosition={opts.currentPosition ?? null}
      positionState={opts.positionState ?? (opts.currentPosition ? "ok" : "unset")}
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

describe("CharacterDetailView（字段三分：两分区与归属）", () => {
  it("tab 1 渲染两个分区标题（card + section-title）", () => {
    const html = render("initial");
    expect(html).toContain("基础信息");
    expect(html).toContain("可变数据");
  });

  it("基础信息区 = 姓名 / 角色定位 / 描述", () => {
    const html = render("initial");
    const basics = html.slice(html.indexOf("基础信息"), html.indexOf("可变数据"));
    expect(basics).toContain("姓名");
    expect(basics).toContain("角色定位");
    expect(basics).toContain("描述");
    // 姓名 input 带当前值（entities.name）
    expect(basics).toContain('value="张三"');
  });

  it("可变数据区 = 假名 / 性别 / 年龄 / 种族 / 动机 / 性格（且不含基础信息区字段）", () => {
    const html = render("initial");
    const mutable = html.slice(html.indexOf("可变数据"));
    for (const label of ["假名", "性别", "年龄", "种族", "动机", "性格"]) {
      expect(mutable).toContain(label);
    }
    expect(mutable).not.toContain("角色定位");
    expect(mutable).not.toContain("已废弃的旧能力标签");
  });

  it("能力面板宿主区块在可变数据区（叶子路径 + 值；能力面板标题）", () => {
    const html = render("initial");
    expect(html).toContain("能力面板");
    expect(html).toContain("火系.等级");
    expect(html).toContain(">3<");
  });

  it("无面板数据 → 一行空态说明", () => {
    const html = renderToString(
      <CharacterDetailView
        detail={{ ...DETAIL, data: { ...DETAIL.data, ability_panel: undefined } }}
        name={DETAIL.name}
        onNameChange={() => {}}
        form={{ ...FORM, ability_panel: undefined }}
        onFieldChange={() => {}}
        tab="initial"
        onTabChange={() => {}}
        basicsErrors={NO_ERRORS}
        saving={false}
        saveError={null}
        onSave={() => {}}
        onDelete={() => {}}
        onReload={() => {}}
        currentPosition={null}
        positionState="unset"
        outlineNodes={NODES}
        outlineLoaded
        outlineLoading={false}
        onLoadOutline={() => {}}
      />,
    );
    expect(html).toContain("暂无面板字段");
  });
});

describe("CharacterDetailView（description 必填内联错误）", () => {
  it("无错误时不渲染错误文案", () => {
    const html = render("initial");
    expect(html).not.toContain("描述不能为空");
    expect(html).not.toContain("姓名不能为空");
  });

  it("错误态 → 描述/姓名各自内联文案（在对应分区内）", () => {
    const html = render("initial", {
      basicsErrors: { name: "姓名不能为空", description: "描述不能为空" },
    });
    expect(html).toContain("姓名不能为空");
    expect(html).toContain("描述不能为空");
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
  it("输入控件全部 disabled（不隐藏）+ 区首「由变更记录累积，只读」caption + 两分区仍在", () => {
    const html = render("current", { currentPosition: "ch-1" });
    expect(html).toContain("由变更记录累积，只读");
    // 分区结构不变（基础信息 + 可变数据），只是禁用
    expect(html).toContain("基础信息");
    expect(html).toContain("可变数据");
    expect(html).toContain("角色定位");
    expect(countDisabled(html)).toBeGreaterThan(0);
    // 计算节点选择器保留（可手选任意节点）
    expect(html).toContain("计算节点");
  });

  it("未设置当前位置（已确认）→ 提示 + 「去大纲设位置」入口（#/outline）", () => {
    const html = render("current", { currentPosition: null, positionState: "unset" });
    expect(html).toContain("未设置当前位置，显示初始数据");
    expect(html).toContain("#/outline");
  });

  it("已设置当前位置 → 不渲染「未设置」提示", () => {
    const html = render("current", { currentPosition: "ch-1", positionState: "ok" });
    expect(html).not.toContain("未设置当前位置");
  });

  it("配置尚未加载（pending）→ 不渲染「未设置」提示（不得瞬时误判）", () => {
    const html = render("current", {
      currentPosition: null,
      positionState: "pending",
      outlineLoaded: false,
    });
    expect(html).not.toContain("未设置当前位置");
    expect(html).not.toContain("当前位置已失效");
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

describe("CharacterDetailView（当前位置已失效）", () => {
  it("失效 → tab 行之上给提示 + 「去大纲重设」入口（两个 tab 都可见）", () => {
    const html = render("initial", { currentPosition: "ch-9", positionState: "invalid" });
    expect(html).toContain("当前位置已失效");
    expect(html).toContain("去大纲重设");
    expect(html).toContain("#/outline");
  });

  it("失效态下的 tab 2 也给失效文案（不是「未设置」）", () => {
    const html = render("current", { currentPosition: "ch-9", positionState: "invalid" });
    expect(html).toContain("当前位置已失效（节点已删除），显示初始数据");
    expect(html).not.toContain("未设置当前位置");
  });
});
