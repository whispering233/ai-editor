// 人物详情双视图渲染走查（卡 3.2；卡 3.3 补：必填内联错误 / 位置失效提示；卡 6.2 改：档案网格 + 只读纯文本）。
// 仓内无 jsdom/@testing-library（既有纪律：不引新依赖），用 react-dom/server renderToString 直渲染展示层
// （`CharacterDetailView`——数据/副作用在容器，SSR 不跑 effect；且 SSR 读的是 store 的 server snapshot，
// 故阅读进度/大纲一律由 props 注入，不依赖 setState 播种）。
// 覆盖：页头壳（元信息行无「变更记录」入口）/ tab 行四 tab / 档案字段网格与顺序（**无分区标题**）/
//       `description` 必填内联错误 / 人物档案 tab 可编辑 / 阅读进度 tab 纯文本值（无输入控件）/
//       未设置与已失效两种提示 / 关系两个 tab（卡 6.3：人物关系网 + 其他关联 · N，各自独立内容）。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { CharacterDetailView } from "./character-detail";
import type { FlatNodeOption } from "../../lib/outline-tree";
import type { CharacterBasicsErrors, CharacterPositionState } from "../../lib/character-detail";
import type { EntityDetailRes, RelationSummaryItem } from "../../lib/api";

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

/** 字段顺序断言用：字符串首次出现位置（不存在 → -1） */
function orderOf(html: string, needles: readonly string[]): number[] {
  return needles.map((n) => html.indexOf(n));
}

/** 空值只读断言用：race 置空串（DETAIL 各字段均有值，借 detail.data 覆写；deltaCount=0 时只读值 = detail.data） */
function renderWithEmptyRace(): string {
  return renderWith({
    tab: "current",
    detail: { ...DETAIL, data: { ...DETAIL.data, race: "" } },
  });
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

  it("tab 行渲染四个 tab（人物档案 / 阅读进度 / 人物关系网 / 其他关联 · N）", () => {
    const html = render("initial");
    expect(html).toContain("人物档案");
    expect(html).toContain("阅读进度");
    expect(html).toContain("人物关系网");
    expect(html).toContain("其他关联 · 0"); // DETAIL.relations 为空
  });
});

/** 关系 tab 断言用：1 条人↔人（ally）+ 1 条其他关联（appears_in） */
const RELATIONS: RelationSummaryItem[] = [
  {
    id: "r1",
    sourceType: "character",
    sourceId: "char-1",
    sourceName: "张三",
    targetType: "character",
    targetId: "char-2",
    targetName: "李四",
    relationType: "ally",
    metadata: { label: "自幼相识" },
    createdAt: "2026-08-01T10:00:00Z",
  },
  {
    id: "r9",
    sourceType: "character",
    sourceId: "char-1",
    sourceName: "张三",
    targetType: "outline_node",
    targetId: "n-1",
    targetName: "第一章",
    relationType: "appears_in",
    createdAt: "2026-08-01T10:00:00Z",
  },
];

describe("CharacterDetailView（关系两个 tab：人物关系网 / 其他关联 · N）", () => {
  it("tab 标签常显其他关联条数（= other 分区行数，不可藏）", () => {
    const html = renderWith({ detail: { ...DETAIL, relations: RELATIONS } });
    expect(html).toContain("其他关联 · 1");
  });

  it("人物关系网 tab：关系行（对方姓名 + 方向 + 备注）+ 添加入口；不混入其他关联", () => {
    const html = renderWith({ tab: "relations", detail: { ...DETAIL, relations: RELATIONS } });
    expect(html).toContain("+ 添加人物关系");
    expect(html).toContain("盟友 · 1");
    expect(html).toContain("李四");
    expect(html).toContain("自幼相识");
    expect(html).not.toContain("第一章");
    expect(html).not.toContain("+ 添加关联");
  });

  it("其他关联 tab：行（类型 chip + 对方名）+ 添加入口；关系网内容不在本 tab 渲染", () => {
    const html = renderWith({ tab: "other", detail: { ...DETAIL, relations: RELATIONS } });
    expect(html).toContain("+ 添加关联");
    expect(html).toContain("第一章");
    expect(html).toContain("出现于");
    expect(html).not.toContain("李四");
  });

  it("关系 tab 不渲染字段网格（各自一个数据集）", () => {
    const html = renderWith({ tab: "relations", detail: { ...DETAIL, relations: RELATIONS } });
    expect(html).not.toContain("md:grid-cols-2");
    expect(html).not.toContain("角色定位");
  });
});

describe("CharacterDetailView（档案字段网格：单一 card、无分区标题）", () => {
  it("不再渲染「基础信息 / 可变数据」分区标题（数据层分层不进 UI）", () => {
    const html = render("initial");
    expect(html).not.toContain("基础信息");
    expect(html).not.toContain("可变数据");
  });

  it("两列网格 + 全部字段按单一清单顺序出现", () => {
    const html = render("initial");
    expect(html).toContain("md:grid-cols-2");
    const [name, role, alias, gender, age, race, description, personality, motivation] = orderOf(
      html,
      ["姓名", "角色定位", "假名", "性别", "年龄", "种族", "描述", "性格", "动机"],
    );
    for (const pos of [name, role, alias, gender, age, race, description, personality, motivation]) {
      expect(pos).toBeGreaterThan(-1);
    }
    expect(name).toBeLessThan(role);
    expect(role).toBeLessThan(alias);
    expect(alias).toBeLessThan(gender);
    expect(gender).toBeLessThan(age);
    expect(age).toBeLessThan(race);
    expect(race).toBeLessThan(description);
    expect(description).toBeLessThan(personality);
    expect(personality).toBeLessThan(motivation);
    // 姓名 input 带当前值（entities.name）
    expect(html).toContain('value="张三"');
  });

  it("能力面板与自定义字段在网格之下仍各自成块（网格下出标题行）", () => {
    const html = render("initial");
    expect(html).toContain("能力面板");
    // 分支行与叶子行分别渲染（不再是只读的点分路径文本）
    expect(html).toContain(">火系</button>");
    expect(html).toContain(">等级</button>");
    expect(html).toContain('value="3"'); // 叶子值
    // 工具条：新增分组 / 应用模板 / 从角色复制（卡片 3.4 的模板与派生入口）
    expect(html).toContain("+ 新增分组");
    expect(html).toContain("应用模板");
    expect(html).toContain("从角色复制");
    // 可编辑态：行可拖拽（结构编辑 = 人工编辑，不产生 Delta）
    expect(html).toContain('draggable="true"');
  });

  it("默认无拖拽反馈（非法落点不显插入线/高亮；拒绝型落点同样无高亮）", () => {
    const html = render("initial");
    const panel = html.slice(html.indexOf("能力面板"));
    // DropIndicator（插入线）与拖拽目标行高亮都是「合法落点」专属的临时态
    expect(panel).not.toContain("ring-primary/30"); // 目标行高亮
    expect(panel).not.toContain("bg-primary/10"); // 目标行淡染面
    // 插入线 = DropIndicator 的绝对定位横线（aria-hidden 小圆点 + 横条）
    expect(panel).not.toContain("-top-[3px]");
    expect(panel).not.toContain("-bottom-[3px]");
    expect(panel).not.toContain("bg-primary");
  });

  it("名字含「.」/同层重名 → 行内警告（不静默改写数据）", () => {
    const html = renderToString(
      <CharacterDetailView
        detail={{ ...DETAIL, data: { ...DETAIL.data, ability_panel: undefined } }}
        name={DETAIL.name}
        onNameChange={() => {}}
        form={{
          ...FORM,
          ability_panel: [{ name: "火.系" }, { name: "同名" }, { name: "同名" }],
        }}
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
    expect(html).toContain("名字含「.」：变更记录无法定位该节点");
    expect(html).toContain("同层重名：变更记录只命中先序第一个");
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

describe("CharacterDetailView（人物档案 tab 可编辑）", () => {
  it("人物档案 tab：字段可编辑（无 disabled 控件），字段 label 全部出现", () => {
    const html = render("initial");
    for (const label of ["角色定位", "假名", "性别", "年龄", "种族", "描述", "性格", "动机"]) {
      expect(html).toContain(label);
    }
    expect(countDisabled(html)).toBe(0);
  });
});

describe("CharacterDetailView（阅读进度 tab 只读：纯文本值）", () => {
  it("caption 在 + 字段 label/网格位与档案 tab 一致（只读不靠 disabled）", () => {
    const html = render("current", { currentPosition: "ch-1" });
    expect(html).toContain("由变更记录累积，只读");
    expect(html).toContain("md:grid-cols-2");
    for (const label of ["姓名", "角色定位", "假名", "性别", "年龄", "种族", "描述", "性格", "动机"]) {
      expect(html).toContain(label);
    }
    // 只读画的是文本值（不再是灰底 disabled 输入框）：字段区无禁用控件
    expect(countDisabled(html)).toBe(0);
    // 计算节点选择器保留（可手选任意节点）
    expect(html).toContain("进度节点");
  });

  it("只读值 = 文本（字符串原样 / 数组「、」连接 / 空值给 —）", () => {
    const html = render("current", { currentPosition: "ch-1" });
    expect(html).toContain("青云门弟子"); // 描述
    expect(html).toContain("坚韧、多疑"); // personality[] 连接展示
    expect(html).toContain(">18<"); // 数字字段
    const empty = renderWithEmptyRace();
    expect(empty).toContain(">—<");
  });

  it("阅读进度 tab：面板树只读（无输入框/工具条/行操作/拖拽，但名称与值文本仍在）", () => {
    const html = render("current", { currentPosition: "ch-1" });
    const panel = html.slice(html.indexOf("能力面板"));
    expect(panel).not.toContain('draggable="true"');
    expect(panel).not.toContain("+ 新增分组");
    expect(panel).not.toContain("应用模板");
    expect(panel).not.toContain("从角色复制");
    expect(panel).not.toContain('aria-label="字段值"');
    expect(panel).toContain("火系"); // 分组名
    expect(panel).toContain("等级"); // 叶子名
    expect(panel).toContain(">3<"); // 叶子值（文本）
  });

  it("未设置当前位置（已确认）→ 提示 + 「去大纲设进度」入口（#/outline）", () => {
    const html = render("current", { currentPosition: null, positionState: "unset" });
    expect(html).toContain("未设置阅读进度，显示人物档案初始值");
    expect(html).toContain("#/outline");
  });

  it("已设置当前位置 → 不渲染「未设置」提示", () => {
    const html = render("current", { currentPosition: "ch-1", positionState: "ok" });
    expect(html).not.toContain("未设置阅读进度");
  });

  it("配置尚未加载（pending）→ 不渲染「未设置」提示（不得瞬时误判）", () => {
    const html = render("current", {
      currentPosition: null,
      positionState: "pending",
      outlineLoaded: false,
    });
    expect(html).not.toContain("未设置阅读进度");
    expect(html).not.toContain("阅读进度已失效");
  });

  it("无变更记录 → 轻量空态文案（当前状态即人物档案初始值）", () => {
    const html = render("current", { currentPosition: "ch-1" });
    expect(html).toContain("暂无变更记录——当前状态即人物档案初始值");
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

describe("CharacterDetailView（阅读进度已失效）", () => {
  it("失效 → tab 行之上给提示 + 「去大纲重设」入口（四个 tab 都可见）", () => {
    const html = render("initial", { currentPosition: "ch-9", positionState: "invalid" });
    expect(html).toContain("阅读进度已失效");
    expect(html).toContain("去大纲重设");
    expect(html).toContain("#/outline");
  });

  it("失效态下的 阅读进度 tab 也给失效文案（不是「未设置」）", () => {
    const html = render("current", { currentPosition: "ch-9", positionState: "invalid" });
    expect(html).toContain("阅读进度已失效（节点已删除），显示人物档案初始值");
    expect(html).not.toContain("未设置阅读进度");
  });
});

// ============ 卡 3.3 修复轮（oracle 三条打磨） ============

/** 修复轮断言用：可覆盖 form / tab 的直渲染（harness `render` 用模块级 FORM 常量） */
function renderWith(opts: {
  tab?: "initial" | "current" | "relations" | "other";
  form?: Record<string, unknown>;
  detail?: EntityDetailRes;
  outlineLoaded?: boolean;
  outlineLoading?: boolean;
}): string {
  return renderToString(
    <CharacterDetailView
      detail={opts.detail ?? DETAIL}
      name={DETAIL.name}
      onNameChange={() => {}}
      form={opts.form ?? FORM}
      onFieldChange={() => {}}
      tab={opts.tab ?? "initial"}
      onTabChange={() => {}}
      basicsErrors={NO_ERRORS}
      saving={false}
      saveError={null}
      onSave={() => {}}
      onDelete={() => {}}
      onReload={() => {}}
      currentPosition="ch-1"
      positionState="ok"
      outlineNodes={NODES}
      outlineLoaded={opts.outlineLoaded ?? true}
      outlineLoading={opts.outlineLoading ?? false}
      onLoadOutline={() => {}}
    />,
  );
}

describe("CharacterDetailView（修复轮①：描述为空提示）", () => {
  it("描述为空 + 可编辑态 → 档案网格里给「保存前需填写」提示（解释为何保存被拒）", () => {
    const html = renderWith({ form: { ...FORM, description: "" } });
    const description = html.slice(html.indexOf("描述"), html.indexOf("性格"));
    expect(description).toContain("描述为空，保存前需填写");
  });

  it("描述有值 → 不渲染提示", () => {
    const html = renderWith({});
    expect(html).not.toContain("描述为空，保存前需填写");
  });

  it("纯空白描述同样算空（trim 口径）", () => {
    const html = renderWith({ form: { ...FORM, description: "   " } });
    expect(html).toContain("描述为空，保存前需填写");
  });

  it("阅读进度 tab 只读态 → 不给提示（无保存动作，提示无意义）", () => {
    const html = renderWith({ tab: "current", form: { ...FORM, description: "" } });
    expect(html).not.toContain("描述为空，保存前需填写");
  });
});

describe("CharacterDetailView（修复轮②：大纲在途加载时 阅读进度 tab 的位置提示）", () => {
  it("位置有效 + 大纲在途加载 → 位置提示位复用同一句加载文案（不只是选择器里那句）", () => {
    const html = renderWith({ tab: "current", outlineLoaded: false, outlineLoading: true });
    const afterCaption = html.slice(html.indexOf("由变更记录累积，只读"));
    expect(afterCaption).toContain("大纲加载中…");
  });

  it("大纲已加载 → 位置提示位不出现加载文案", () => {
    const html = renderWith({ tab: "current" });
    const afterCaption = html.slice(html.indexOf("由变更记录累积，只读"));
    expect(afterCaption).not.toContain("大纲加载中…");
  });

  it("位置未设置（unset）→ 仍是「未设置」文案，不混入加载文案", () => {
    const html = renderToString(
      <CharacterDetailView
        detail={DETAIL}
        name={DETAIL.name}
        onNameChange={() => {}}
        form={FORM}
        onFieldChange={() => {}}
        tab="current"
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
        outlineLoaded={false}
        outlineLoading
        onLoadOutline={() => {}}
      />,
    );
    expect(html).toContain("未设置阅读进度，显示人物档案初始值");
  });
});

describe("CharacterDetailView（修复轮③：对象值只读渲染）", () => {
  it("tab 2 的 custom_fields 嵌套对象 → 紧凑 JSON 展示（不再 [object Object]）", () => {
    const detail: EntityDetailRes = {
      ...DETAIL,
      data: { ...DETAIL.data, custom_fields: { 门派: { name: "青云门", rank: 1 } } },
    };
    const html = renderWith({ tab: "current", detail });
    expect(html).not.toContain("[object Object]");
    // 键与值都在（React 会把 JSON 里的引号转义，故按内容片段断言）
    expect(html).toMatch(/门派[\s\S]{0,120}青云门/);
    expect(html).toMatch(/rank/);
  });

  it("tab 1 的 custom_fields 编辑器仍走可编辑控件（提示改动不波及编辑态）", () => {
    const detail: EntityDetailRes = {
      ...DETAIL,
      data: { ...DETAIL.data, custom_fields: { 门派: "青云门" } },
    };
    const html = renderWith({ tab: "initial", detail, form: { ...FORM, custom_fields: { 门派: "青云门" } } });
    expect(countDisabled(html)).toBe(0);
  });
});
