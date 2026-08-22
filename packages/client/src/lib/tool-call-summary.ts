// 工具调用摘要渲染纯函数（决策 47，批次十四）：
// 把工具参数 args 渲染为人类可读摘要行——id 字段经 names/resolve 解析为名称（不暴露裸 id），
// 其余字段显示 label: value。契约来源：doc/design/decisions.md 决策 47、
//   doc/ui/pages/chat.md「工具调用记录行」、packages/shared/src/types/tool.ts 工具参数 schema。
// 设计要点：
// - 按工具名定义「行首动词短语 + 有序字段显示定义」（TOOL_DISPLAY_SPECS）——未知工具返回 null，
//   由调用方回退原始 JSON（不丢信息）
// - id 字段（id: true）：解析失败/为 null → 该字段省略（决策 47：解析失败字段省略不显示）
// - 对象值（patches/data/changes 等）→ 键名列表（避免整段 JSON 刷屏）
import type { ResolvedNames } from "./api";

/** 字段显示定义：label = 中文标签；id = true 时该字段值为 id 类（需 names/resolve 解析名称） */
interface FieldDisplaySpec {
  label: string;
  id?: boolean;
}

/** 工具显示定义：lead = 行首动词短语；fields = 字段显示映射（未收录字段不渲染） */
interface ToolDisplaySpec {
  lead: string;
  fields: Record<string, FieldDisplaySpec>;
}

/** 工具 → 显示定义（key 与 tools.md/registry 工具名一致；未知工具 → 无定义 → 回退 JSON） */
const TOOL_DISPLAY_SPECS: Record<string, ToolDisplaySpec> = {
  // —— 查询类（tools.md「查询类（自动）」） ——
  get_entity: {
    lead: "查询实体",
    fields: { id: { label: "实体", id: true }, type: { label: "类型" } },
  },
  search_entities: {
    lead: "搜索实体",
    fields: { type: { label: "类型" }, query: { label: "关键词" } },
  },
  query_relationships: {
    lead: "查询关系",
    fields: {
      source_id: { label: "源", id: true },
      target_id: { label: "目标", id: true },
      relation_type: { label: "关系类型" },
      depth: { label: "深度" },
    },
  },
  get_outline: { lead: "读取大纲", fields: {} },
  get_outline_path: { lead: "读取节点路径", fields: { node_id: { label: "节点", id: true } } },
  compute_state: {
    lead: "计算状态",
    fields: { target_id: { label: "目标", id: true }, at_node_id: { label: "锚定节点", id: true } },
  },
  get_delta_history: { lead: "查询变更历史", fields: { target_id: { label: "目标", id: true } } },
  get_entity_summary: { lead: "读取实体统计", fields: { type: { label: "类型" } } },
  search_references: {
    lead: "搜索参考资料",
    fields: { query: { label: "关键词" }, type: { label: "分类" }, tags: { label: "标签" } },
  },
  // —— 分析类（tools.md「分析类（自动）」） ——
  analyze_consistency: { lead: "一致性分析", fields: { entity_id: { label: "实体", id: true } } },
  detect_conflicts: { lead: "跨实体矛盾检测", fields: {} },
  trace_plot_paths: {
    lead: "剧情路径推演",
    fields: { from_node_id: { label: "起点", id: true }, to_node_id: { label: "终点", id: true } },
  },
  find_orphan_elements: { lead: "孤立元素诊断", fields: {} },
  suggest_connections: { lead: "关系发现", fields: { entity_id: { label: "实体", id: true } } },
  analyze_hook_health: { lead: "伏笔健康分析", fields: {} },
  trace_hook_lifecycle: {
    lead: "伏笔生命周期追踪",
    fields: { hook_id: { label: "伏笔", id: true } },
  },
  suggest_hook_payoff: { lead: "伏笔回收建议", fields: { hook_id: { label: "伏笔", id: true } } },
  find_hook_opportunities: {
    lead: "伏笔埋设机会",
    fields: { outline_node_id: { label: "节点", id: true } },
  },
  detect_hook_conflicts: { lead: "伏笔矛盾检测", fields: {} },
  // —— 提案类（tools.md「提案类（需确认）」；preview 的 args 走同一摘要） ——
  propose_create_entity: {
    lead: "新建实体",
    fields: { name: { label: "名称" }, type: { label: "类型" }, data: { label: "字段" } },
  },
  propose_update_entity: {
    lead: "更新实体",
    fields: { entity_id: { label: "实体", id: true }, patches: { label: "变更字段" } },
  },
  propose_delete_entity: { lead: "删除实体", fields: { entity_id: { label: "实体", id: true } } },
  propose_add_relation: {
    lead: "新增关系",
    fields: {
      source: { label: "源", id: true },
      target: { label: "目标", id: true },
      type: { label: "关系类型" },
    },
  },
  propose_remove_relation: { lead: "移除关系", fields: {} },
  propose_add_delta: {
    lead: "追加变更",
    fields: { target: { label: "目标", id: true }, changes: { label: "变更条数" } },
  },
  propose_outline_node: {
    lead: "新建大纲节点",
    fields: {
      title: { label: "标题" },
      type: { label: "层级" },
      parent_id: { label: "上级", id: true },
    },
  },
  propose_move_node: {
    lead: "移动大纲节点",
    fields: {
      node_id: { label: "节点", id: true },
      parent_id: { label: "上级", id: true },
      order: { label: "位置" },
    },
  },
  propose_delete_node: { lead: "删除大纲节点", fields: { node_id: { label: "节点", id: true } } },
  propose_create_hook: {
    lead: "新建伏笔",
    fields: { name: { label: "名称" }, plant_at_node_id: { label: "埋设节点", id: true } },
  },
  propose_update_hook: {
    lead: "更新伏笔",
    fields: { hook_id: { label: "伏笔", id: true }, patches: { label: "变更字段" } },
  },
  propose_advance_hook: {
    lead: "推进伏笔",
    fields: { hook_id: { label: "伏笔", id: true }, node_id: { label: "节点", id: true } },
  },
  propose_resolve_hook: {
    lead: "回收伏笔",
    fields: { hook_id: { label: "伏笔", id: true }, node_id: { label: "节点", id: true } },
  },
  propose_abandon_hook: { lead: "废弃伏笔", fields: { hook_id: { label: "伏笔", id: true } } },
  // 重排时间点的可读描述由 preview.changes 承载（服务端已解析名称，tools proposal/reorder-timepoints.ts）
  propose_reorder_timepoints: { lead: "重排时间点", fields: {} },
  propose_create_reference: {
    lead: "新建参考资料",
    fields: { name: { label: "标题" }, type: { label: "分类" } },
  },
};

/** 值 → 展示文本：字符串原样；数字/布尔 String；数组 join；对象 → 键名列表（避免整段 JSON） */
export function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => String(x)).join("、");
  if (typeof v === "object" && v !== null) return Object.keys(v).join("、");
  return String(v);
}

/** 单字段渲染：id 字段解析失败 → null（省略该字段，决策 47）；无值 → null */
function renderField(
  spec: FieldDisplaySpec,
  value: unknown,
  names: ResolvedNames | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  if (spec.id === true) {
    if (typeof value !== "string") return null;
    const resolved = names?.[value];
    return resolved === null || resolved === undefined ? null : `${spec.label}「${resolved.name}」`;
  }
  const text = formatValue(value);
  return text === "" ? null : `${spec.label}：${text}`;
}

/**
 * 工具调用摘要（决策 47）：返回人类可读摘要行数组。
 * - 未知工具（无显示定义）→ null（调用方回退原始 JSON）
 * - 首行 = `{动词短语}：{主参}`，其余字段逐行
 * - id 字段解析失败 → 省略；全部字段省略 → 仅动词短语行
 * @param args 工具参数（LLM 产出形态，Record<string, unknown> | null）
 * @param names names/resolve 批量解析结果（id → 名称）；未解析（null/undefined）时 id 字段省略
 */
export function summarizeToolCall(
  tool: string,
  args: Record<string, unknown> | null | undefined,
  names: ResolvedNames | null | undefined,
): string[] | null {
  const spec = TOOL_DISPLAY_SPECS[tool];
  if (spec === undefined) return null;
  if (typeof args !== "object" || args === null) return [spec.lead];
  // 按 args 字段顺序收集可渲染行（id 字段优先作主参——LLM 生成的字段顺序不可控，
  // type 等前置字段不应抢走「查询实体：实体「名称」」的主位）
  const rows: Array<{ isId: boolean; text: string }> = [];
  for (const [key, value] of Object.entries(args)) {
    const field = spec.fields[key];
    if (field === undefined) continue; // 未收录字段不渲染（避免裸 id 泄漏）
    const rendered = renderField(field, value, names);
    if (rendered === null) continue;
    rows.push({ isId: field.id === true, text: rendered });
  }
  if (rows.length === 0) return [spec.lead];
  const primary = rows.find((r) => r.isId) ?? rows[0];
  const rest = rows.filter((r) => r !== primary);
  return [`${spec.lead}：${primary.text}`, ...rest.map((r) => r.text)];
}

/** 从工具参数中收集 id 候选（字符串值 + 数组内字符串元素；timepoint_ids 等数组字段） */
export function collectIdCandidates(args: unknown): string[] {
  if (typeof args !== "object" || args === null) return [];
  const out: string[] = [];
  for (const value of Object.values(args as Record<string, unknown>)) {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") out.push(item);
      }
    }
  }
  return out;
}

/**
 * 提案卡 preview 摘要化（决策 47）：不再 JSON dump。
 * 渲染顺序：summary（回退形态 { type, summary, args } 只显示摘要）→ changes（服务端已解析名称的
 * 字符串数组，如 propose_reorder_timepoints 的「「黄昏」从第 3 位移到第 2 位」；对象项按 id 解析）
 * → args（走 summarizeToolCall）→ 其余字段键值行。无可渲染内容 → null。
 * @param type 提案工具名（propose_*）
 */
export function summarizePreview(
  type: string,
  preview: unknown,
  names: ResolvedNames | null | undefined,
): string[] | null {
  if (preview === undefined || preview === null) return null;
  if (typeof preview === "string") return [preview];
  if (typeof preview !== "object") return null;
  const obj = preview as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof obj.summary === "string" && obj.summary !== "") lines.push(obj.summary);
  if (Array.isArray(obj.changes)) {
    for (const c of obj.changes) {
      if (typeof c === "string") {
        lines.push(c); // 服务端已解析名称（propose_reorder_timepoints，tools proposal/reorder-timepoints.ts）
      } else if (typeof c === "object" && c !== null) {
        const ch = c as { id?: unknown; order?: unknown; name?: unknown };
        const resolved = typeof ch.id === "string" ? names?.[ch.id] : undefined;
        const name =
          typeof ch.name === "string" && ch.name !== ""
            ? ch.name
            : resolved === null || resolved === undefined
              ? undefined
              : resolved.name;
        lines.push(name === undefined ? "调整位置" : `「${name}」→ 位置 ${String(ch.order ?? "")}`);
      }
    }
  }
  if (typeof obj.args === "object" && obj.args !== null) {
    const sub = summarizeToolCall(type, obj.args as Record<string, unknown>, names);
    if (sub !== null) lines.push(...sub);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "summary" || k === "changes" || k === "args" || k === "type") continue;
    if (v === undefined || v === null) continue;
    lines.push(`${k}：${formatValue(v)}`);
  }
  return lines.length > 0 ? lines : null;
}
