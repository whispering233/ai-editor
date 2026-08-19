// 聚焦上下文共享类型（决策 35，批次九：InfoBar「问 AI」入口 + 页面焦点上报）
// layout.md §4.2：任一页「问 AI」→ 注入右栏当前会话；POST /chat 请求体 context 字段。
// FocusContext 从 stores/chat.ts 提移至 lib（chat store 依赖 ui store 的 showToast——
// ui store 需读 currentFocus，提移避免 store 循环依赖）。chat.ts 重导出保持既有导入不破坏。
export interface FocusContext {
  focus_entity_type?: string;
  focus_entity_id?: string;
  focus_node_id?: string;
}
