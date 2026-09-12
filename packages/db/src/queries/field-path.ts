// @whispering233/ai-editor-db 字段路径解析（卡片 2.4）——computeState 的「点分嵌套路径」定位。
//
// 契约（唯一事实来源 = docs/db/schema.md 的 delta_records「字段路径」+「面板路径解析口径」+「解析步骤」）：
// ① **顶层精确键优先**：`Object.hasOwn(state, field)` 命中 → 按顶层字段处理
//    （向后兼容含字面 `.` 的顶层键，如自定义字段名 `"a.b"`）；
//    **无分隔符的字段不要求键已存在**（顶层字段保持历史语义：`set` 可新建、`update` 读到 undefined）；
// ② 未命中且字段含 `.` → 逐段下钻：**对象段按键**、**数组段按同层 `name` 匹配取先序第一个**；
//    含 `.` 的字段**逐段必须已存在**（含末段对象键）——「只有已存在的字段/叶子可被 Delta 改」；
// ③ **中途段不存在 → 未命中**（调用方按「跳过 + skipped/conflicts 标注」处理，不抛错）；
// ④ `add`/`remove` 不走本模块（数组语义仅顶层字段，见 compute-state.ts）。
//
// 面板形状（`character.data.ability_panel`）：`[{ name, value?, children? }]`——数组段匹配
// 节点 `name` 后，若还有后续段则继续在该节点的 `children` 里下钻；匹配到**分支**（非空 children）
// 且已到最后一段 → 未命中（分支不可赋值，交调用方标注冲突，不静默写坏结构）。
//
// 歧义（已知，见 docs/db/schema.md）：名字含 `.` 或同层重名 → 都按先序第一个匹配；解析侧不拒绝。

/** 字段路径定位结果（可读写位置；`key` 同时承载「顶层精确键」与「对象段键」——两者仅优先级不同） */
type FieldLocation =
 /** 对象容器上的键（顶层 = container 为 state 本身，由 ① 优先命中） */
  | { kind: "key"; container: Record<string, unknown>; key: string }
 /** 数组段匹配到的叶子节点（写 `node.value`；叶子可能尚无 value 键） */
  | { kind: "node-value"; node: Record<string, unknown> };

/** 字段路径读取结果（供调用方一次性拿到「是否命中 + 当前值」） */
export interface FieldPathResolution {
  found: boolean;
  /** 命中时的当前值（叶子无 value 键 → undefined）；未命中 → undefined */
  value: unknown;
}

/** 纯对象判定（排除 null / 数组） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 数组段匹配：同层按 `name` 取**先序第一个**对象元素（宽校验：坏元素跳过） */
function matchNodeByName(nodes: readonly unknown[], name: string): Record<string, unknown> | null {
  for (const item of nodes) {
    if (isPlainObject(item) && item.name === name) return item;
  }
  return null;
}

/** 分支判定（非空 children 数组——与 shared `isAbilityBranch` 同口径） */
function hasChildren(node: Record<string, unknown>): boolean {
  const children = node.children;
  return Array.isArray(children) && children.length > 0;
}

/**
 * 定位字段路径（①～③；只解析，不读写）。
 * @returns 定位结果；未命中（中途段缺失 / 末段命中分支 / 无点的非顶层字段）→ null
 */
function locateFieldPath(state: Record<string, unknown>, field: string): FieldLocation | null {
 // ① 顶层精确键优先（先于任何点分解析）
  if (Object.hasOwn(state, field)) return { kind: "key", container: state, key: field };
 // 无分隔符的字段 = 顶层字段：**不要求键已存在**（`set` 可新建、`update` 读到 undefined——与历史语义一致）；
 // 含 `.` 的字段才走点分下钻（逐段必须已存在，缺失 → 未命中 → 冲突标注）
  if (!field.includes(".")) return { kind: "key", container: state, key: field };

  const segments = field.split(".");
  let container: unknown = state;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;

    if (Array.isArray(container)) {
 // ② 数组段：按同层 name 匹配取先序第一个
      const node = matchNodeByName(container, segment);
      if (node === null) return null;
      if (isLast) {
 // 末段命中分支 → 分支不可赋值（不写坏结构，交调用方标注冲突）
        return hasChildren(node) ? null : { kind: "node-value", node };
      }
 // 非末段：继续在该节点的 children 里下钻（叶子节点无 children → 路径不可达）
      if (!hasChildren(node)) return null;
      container = node.children;
      continue;
    }

    if (isPlainObject(container)) {
 // ② 对象段：按键（末段同样要求键已存在——「只有已存在的字段可被 Delta 改」）
      if (!Object.hasOwn(container, segment)) return null;
      if (isLast) return { kind: "key", container, key: segment };
      container = container[segment];
      continue;
    }

 // 中途段落在标量上（string/number/null/undefined）→ 不可达
    return null;
  }
  return null; // 防御：循环内必返回（保留以满足穷尽性检查）
}

/** 读定位结果当前值 */
function readLocated(location: FieldLocation): unknown {
  return location.kind === "key" ? location.container[location.key] : location.node.value;
}

/** 写定位结果当前值（顶层键 / 对象键 / 叶子 value） */
function writeLocated(location: FieldLocation, value: unknown): void {
  if (location.kind === "key") {
    location.container[location.key] = value;
    return;
  }
  location.node.value = value;
}

/**
 * 读取字段路径当前值（**纯读**，不修改 state）。
 * @returns `{ found, value }`；未命中 → `{ found: false, value: undefined }`
 */
export function readFieldPath(state: Record<string, unknown>, field: string): FieldPathResolution {
  const location = locateFieldPath(state, field);
  if (location === null) return { found: false, value: undefined };
  return { found: true, value: readLocated(location) };
}

/**
 * 按字段路径写入值。
 * @returns 命中并写入 → true；未命中（中途段缺失 / 末段是分支）→ false（**不改动 state**）
 */
export function writeFieldPath(
  state: Record<string, unknown>,
  field: string,
  value: unknown,
): boolean {
  const location = locateFieldPath(state, field);
  if (location === null) return false;
  writeLocated(location, value);
  return true;
}
