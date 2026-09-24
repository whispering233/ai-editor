// 推演节点标记的提交实现与派生文案——形态对齐 lib/current-position.ts：
// 纯函数（可单测）+ 收敛 toast 的提交入口，供各入口共用（大纲树右键菜单 / 节点详情页页头按钮 /
// 大纲页页头「清除推演标记」）。
//
// 语义：PUT /project/config { deduction_nodes }——**全量替换**（服务端去重 + 按可见章先序归一），
// store updateConfig 成功后自动重拉 config，联动大纲树与章视图行尾徽标、详情页元信息行。
// 服务端只接受**可见的章节点**（卷/场景/软删 → 400）；调用方负责入口可见性（仅章行/章页给入口）。
// 徽标文案与章号**一律来自 shared `buildDeductionMarks`**（唯一编号口径，见 `10-data-model.md` §15），
// 本模块只做 title 组装与菜单文案，不手抄任何标签或章号。
import type { DeductionMark } from "@whispering233/ai-editor-shared";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";
import type { OutlineNodeType } from "./api";

/**
 * 节点层级是否可承载推演标记（§15 不变式 1：**仅章**——卷太粗（区间内任何推演都对得上）、
 * 场景太碎（区间跨度会混层级））。大纲树菜单项与详情页按钮共用本判据，
 * 与服务端 `PUT /project/config` 校验同口径（UI 同向收窄，不留必定 400 的入口）。
 */
export function isDeductionMarkHost(nodeType: OutlineNodeType): boolean {
  return nodeType === "chapter";
}

/**
 * 切换一个节点的标记（纯函数）：未标记 → 追加（数组顺序只是集合输入，服务端会归一为可见章先序）；
 * 已标记 → 移除（其余元素顺序不变）。
 */
export function nextDeductionNodes(current: readonly string[], nodeId: string): string[] {
  return current.includes(nodeId)
    ? current.filter((id) => id !== nodeId)
    : [...current, nodeId];
}

/**
 * 切换提交的**基底** = **可见标记 id**（由 shared `buildDeductionMarks` 派生），不是 raw `config.deductionNodes`。
 *
 * 为什么不能拿 raw 当基底：软删 / purge 后失效 id 会**留在盘上**（读侧原样返回、不自动清理，§15 不变式 6），
 * 而 `PUT /project/config` 对任一失效 id 严格 400 ⇒ 拿 raw 回传会让该书**任何标记操作永久 400**
 * （失效章无徽标也无入口，用户无从把 id 移出数组）。基底换成可见标记后，下一次全量写入只含可见 id，
 * 盘上自然收敛——这正是不变式 6 「全量写入自然收敛」的实现前提。
 */
export function toggledDeductionNodes(
  marks: readonly DeductionMark[],
  nodeId: string,
): string[] {
  return nextDeductionNodes(
    marks.map((mark) => mark.nodeId),
    nodeId,
  );
}

/** 标记入口文案（未标记 = 标记为推演节点 / 已标记 = 移出推演节点；**不置灰**，点即切换） */
export function deductionMenuLabel(marked: boolean): string {
  return marked ? "移出推演节点" : "标记为推演节点";
}

/**
 * 徽标 hover 提示（DESIGN.md「`推演节点` 徽标」）：完整语义 = `推演起点（第3章）`，
 * 多标记再附「第 k / 共 N 个推演节点」（k = 标记序号，不是章号）。
 */
export function deductionMarkTitle(mark: DeductionMark, total: number): string {
  const base = `${mark.label}（第${mark.chapterNumber}章）`;
  return total > 1 ? `${base} · 第 ${mark.index} / 共 ${total} 个推演节点` : base;
}

/**
 * 一键清空全部推演标记（大纲页页头入口，两视图共用）。
 *
 * **写 `[]`（不是「当前可见标记数组」）**：`PUT /project/config` 是**全量替换**，`[]` 是唯一能同时
 * 收敛「全部可见标记」与「盘上失效 id」的写法——传可见标记数组等于什么都没清，且软删 / purge 后
 * 留在盘上的失效 id 仍在（§15 不变式 6：读侧过滤、不自动清理，靠下一次全量写入自然收敛）。
 *
 * 不复用 `submitDeductionMarks`：其失败文案（「该节点可能已删除或不可见」）对清空是假话。
 * 返回 boolean 供调用方决定后续。
 */
export async function clearDeductionMarks(): Promise<boolean> {
  try {
    await useProjectStore.getState().updateConfig({ deduction_nodes: [] });
    useUiStore.getState().showToast("已清除全部推演节点标记");
    return true;
  } catch {
    useUiStore.getState().showToast("清除失败，请重试", "error");
    return false;
  }
}

/**
 * 提交标记集合（全量数组 + 一次 updateConfig）。成功文案按「当前 store 里的标记数 vs next 长度」判定——
 * 切换恒 ±1（`nextDeductionNodes`），故长度变小即移出；失败 → 泛化提示（节点已删/不可见/网络）。
 * 返回 boolean 供调用方决定后续（当前无用例分支，保留可判定结果）。
 */
export async function submitDeductionMarks(next: string[]): Promise<boolean> {
  const current = useProjectStore.getState().config?.deductionNodes ?? [];
  try {
    await useProjectStore.getState().updateConfig({ deduction_nodes: next });
    useUiStore
      .getState()
      .showToast(next.length < current.length ? "已移出推演节点" : "已标记为推演节点");
    return true;
  } catch {
    useUiStore
      .getState()
      .showToast("标记失败：该节点可能已删除或不可见，无法标记为推演节点", "error");
    return false;
  }
}
