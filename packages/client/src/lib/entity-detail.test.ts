// entity-detail 纯函数与配置测试（S3.6 + I3b）：按类型字段配置、关系类型中文映射、表单 diff、
// 设定层级分区（parent_id 废弃改为 belongs_to 关系表达）
import { describe, expect, it } from "vitest";
import { CHARACTER_PRIORITIES, CHARACTER_PRIORITY_LABELS, RELATION_TYPES } from "@whispering233/ai-editor-shared";
import {
  detailFieldsForType,
  diffData,
  relationTypeLabel,
  settingHierarchyFromRelations,
} from "./entity-detail";

describe("detailFieldsForType", () => {
  it("character：role/priority/description/alias/gender/age/race/personality/motivation（2026-09：abilities 与 status 均已移除）", () => {
    const fields = detailFieldsForType("character");
    expect(fields.map((f) => f.key)).toEqual([
      "role",
      "priority",
      "description",
      "alias",
      "gender",
      "age",
      "race",
      "personality",
      "motivation",
    ]);
 // 优先级档：选项/标签与 shared 常量同源（禁止手抄），未分级 = 值缺失（清除 = null）
    const priority = fields.find((f) => f.key === "priority")!;
    expect(priority.control).toBe("select");
    expect(priority.options).toEqual([...CHARACTER_PRIORITIES]);
    expect(priority.optionsLabels).toEqual(CHARACTER_PRIORITY_LABELS);
    expect(fields.find((f) => f.key === "age")?.control).toBe("number");
    expect(fields.find((f) => f.key === "personality")?.control).toBe("tags");
    expect(fields.find((f) => f.key === "motivation")?.control).toBe("textarea");
    expect(fields.find((f) => f.key === "description")?.control).toBe("textarea");
 // 能力面板（ability_panel）不走标签编辑器——面板编辑 UI 属批次 3.4
    expect(fields.some((f) => f.key === "abilities" || f.key === "ability_panel")).toBe(false);
  });

  it("setting（K2）：description/tags（分类）/rules（规则条款）；location 保留 parent_id 文本", () => {
    expect(detailFieldsForType("setting").map((f) => f.key)).toEqual([
      "description",
      "tags",
      "rules",
    ]);
    expect(detailFieldsForType("location").map((f) => f.key)).toEqual([
      "type",
      "parent_id",
      "description",
    ]);
  });

  it("hook：status/payoff_timing 受控枚举下拉，expected_resolve_node_id 大纲节点选择器，is_core 开关", () => {
    const fields = detailFieldsForType("hook");
    const status = fields.find((f) => f.key === "status")!;
    expect(status.control).toBe("select");
    expect(status.options).toEqual(["planted", "progressing", "resolved", "abandoned"]);
    expect(fields.find((f) => f.key === "payoff_timing")?.options).toEqual([
      "immediate",
      "near_term",
      "mid_arc",
      "slow_burn",
      "endgame",
    ]);
    expect(fields.find((f) => f.key === "expected_resolve_node_id")?.control).toBe("outline-node");
    expect(fields.find((f) => f.key === "is_core")?.control).toBe("toggle");
    expect(fields.find((f) => f.key === "half_life")?.control).toBe("number");
  });

  it("event：description/tags——G2 移除 time_label（时间标签 = 时间点挂载）", () => {
    expect(detailFieldsForType("event").map((f) => f.key)).toEqual(["description", "tags"]);
  });

  it("timepoint（G2 时间标签点）：data 空——无字段配置（名称 = 时间标签文本，仅名称可编辑）", () => {
    expect(detailFieldsForType("timepoint")).toEqual([]);
  });
});

describe("relationTypeLabel（注册表驱动：预定义取 RELATION_TYPE_META，未知值回退原文）", () => {
  it("已知映射抽样：mentor→师徒、appears_in→出现于、masters→掌握、ally→盟友、plot_edge→剧情连线、plants→埋设", () => {
    expect(relationTypeLabel("mentor")).toBe("师徒");
    expect(relationTypeLabel("appears_in")).toBe("出现于");
    expect(relationTypeLabel("masters")).toBe("掌握");
    expect(relationTypeLabel("ally")).toBe("盟友");
    expect(relationTypeLabel("plot_edge")).toBe("剧情连线");
    expect(relationTypeLabel("plants")).toBe("埋设");
  });

  it("occurs_in（I1）→锚定于，与 occurs_at 发生于区分", () => {
    expect(relationTypeLabel("occurs_in")).toBe("锚定于");
    expect(relationTypeLabel("occurs_at")).toBe("发生于");
  });

  it("每个预定义类型都有标签（不落回原文）——清单完整性由 shared 注册表测试锁定", () => {
    for (const t of RELATION_TYPES) {
      expect(relationTypeLabel(t)).not.toBe(t);
      expect(relationTypeLabel(t).trim().length).toBeGreaterThan(0);
    }
  });

  it("未知类型原样显示（不崩溃）", () => {
    expect(relationTypeLabel("custom_rel")).toBe("custom_rel");
  });
});

describe("settingHierarchyFromRelations（层级边分区——belongs_to 且两端均为 setting）", () => {
  const rel = (
    id: string,
    src: string,
    tgt: string,
    srcType = "setting",
    tgtType = "setting",
    type = "belongs_to",
  ) => ({
    id,
    sourceType: srcType,
    sourceId: src,
    sourceName: srcType === "setting" ? `设定${src}` : `人${src}`,
    targetType: tgtType,
    targetId: tgt,
    targetName: tgtType === "setting" ? `设定${tgt}` : `人${tgt}`,
    relationType: type,
  });

  it("分区：父（target 端为本实体）与子（source 端为本实体）", () => {
    const self = "set-1";
    const relations = [
      rel("rel-1", self, "set-2"), // 子：set-1 → set-2（set-1 是 set-2 的子？方向：child→parent，source=self target=set-2 → set-2 是 set-1 的父）
      rel("rel-2", "set-3", self), // 子：set-3 → set-1（set-1 是 set-3 的父）
      rel("rel-3", "set-4", self), // 子：set-4 → set-1
      rel("rel-4", "char-9", self, "character"), // 人物→设定 belongs_to：非层级边，忽略
      rel("rel-5", self, "sc-node", "setting", "outline_node", "appears_in"), // 非 belongs_to：忽略
      rel("rel-6", self, "char-2", "setting", "character"), // setting→character belongs_to：非层级，忽略
    ];
    const { parent, children } = settingHierarchyFromRelations(relations, self);
 // rel-1：source=self → self 是子，parent = set-2（target 端）
    expect(parent).toEqual({
      relationId: "rel-1",
      parentId: "set-2",
      parentName: "设定set-2",
      childId: self,
      childName: "设定set-1",
    });
    expect(children).toEqual([
      {
        relationId: "rel-2",
        parentId: self,
        parentName: "设定set-1",
        childId: "set-3",
        childName: "设定set-3",
      },
      {
        relationId: "rel-3",
        parentId: self,
        parentName: "设定set-1",
        childId: "set-4",
        childName: "设定set-4",
      },
    ]);
  });

  it("多父取首条（一设定一父语义：UI 只展示第一个）", () => {
    const self = "set-1";
    const { parent } = settingHierarchyFromRelations(
      [rel("r1", self, "set-a"), rel("r2", self, "set-b")],
      self,
    );
    expect(parent?.relationId).toBe("r1");
  });

  it("无层级边 → parent null + children 空", () => {
    const self = "set-1";
    expect(
      settingHierarchyFromRelations([rel("r1", self, "char-2", "setting", "character")], self),
    ).toEqual({
      parent: null,
      children: [],
    });
  });
});

describe("diffData（表单 partial 提交——只返回变更字段）", () => {
 // 2026-09（卡片 2.1）：样例改用现行 character 字段（abilities/status 均已移除；diffData 本身与字段名无关）
  const original = { role: "主角", age: 16, personality: ["坚韧"], alias: "阿九" };

  it("无变更 → null（不发请求）", () => {
    expect(diffData(original, { ...original })).toBeNull();
  });

  it("单字段变更 → 只含该字段", () => {
    expect(diffData(original, { ...original, alias: "九哥" })).toEqual({ alias: "九哥" });
  });

  it("数组字段比较（JSON 深度比较）：增删元素识别为变更", () => {
    expect(diffData(original, { ...original, personality: ["坚韧", "孤僻"] })).toEqual({
      personality: ["坚韧", "孤僻"],
    });
    expect(diffData(original, { ...original, personality: [] })).toEqual({ personality: [] });
  });

  it("空值规约：空串/空数组与缺失等价（清空字段不产生无意义提交）", () => {
    expect(diffData(original, { ...original, role: "" })).toEqual({ role: "" });
 // 原值已是空串时，清空不提交
    expect(diffData({ role: "" }, { role: "" })).toBeNull();
    expect(diffData({ personality: [] }, { personality: [] })).toBeNull();
  });

  it("新增字段识别（form 含 original 没有的键）", () => {
    expect(diffData({ role: "主角" }, { role: "主角", gender: "男" })).toEqual({ gender: "男" });
  });

  it("数字与字符串区分：age 数字 vs 字符串视为变更", () => {
    expect(diffData(original, { ...original, age: "16" })).toEqual({ age: "16" });
  });

  it("form 值为 undefined 的键跳过不提交（数字控件清空——age/half_life 不产生 age:null 导致 400）", () => {
 // 清空数字：undefined 键被跳过，diff 结果为 null（保留服务端原值）
    expect(diffData({ age: 16 }, { age: undefined })).toBeNull();
    expect(diffData(original, { ...original, age: undefined })).toBeNull();
 // 其他字段的变更不受影响（undefined 键被排除，不混入提交）
    expect(diffData(original, { ...original, age: undefined, status: "退场" })).toEqual({
      status: "退场",
    });
  });

  it("null 正常提交（expected_resolve_node_id 清空——「未设置」存 null 而非空串）", () => {
 // 原值有节点 → 清空 → 提交 null（服务端 z.string.nullable 接受）
    expect(
      diffData({ expected_resolve_node_id: "sc-1" }, { expected_resolve_node_id: null }),
    ).toEqual({
      expected_resolve_node_id: null,
    });
 // 原值本就无该键 + null → 无变更
    expect(diffData({}, { expected_resolve_node_id: null })).toBeNull();
 // 空串与 null 比较等价（同「未设置」语义）——旧值空串清空不产生提交
    expect(
      diffData({ expected_resolve_node_id: "" }, { expected_resolve_node_id: null }),
    ).toBeNull();
  });

  it("priority（角色优先级）：已分级 → null 进 PUT 载荷；原本未分级 + null → 不产生字段", () => {
 // 清回未分级 = 提交 null（服务端枚举字段例外，见 docs/api/30-api-entity.md）
    expect(diffData({ priority: "protagonist" }, { priority: null })).toEqual({ priority: null });
 // 未分级（键缺失）本就不下发该键：null 不再产生无意义提交
    expect(diffData({}, { priority: null })).toBeNull();
  });
});
