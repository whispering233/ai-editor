// 聚焦上下文共享类型（跨页「问 AI」入口 + 页面焦点上报；入口迁中栏右下悬浮按钮）
// 任一页「问 AI」→ 注入右栏当前会话；POST /chat 请求体 context 字段。
// FocusContext 从 stores/chat.ts 提移至 lib（chat store 依赖 ui store 的 showToast——
// ui store 需读 currentFocus，提移避免 store 循环依赖）。chat.ts 重导出保持既有导入不破坏。
export interface FocusContext {
  focus_entity_type?: string;
  focus_entity_id?: string;
  focus_node_id?: string;
  /** 推演节点集合（大纲组页面悬浮「问 AI」，见 `docs/design/10-data-model.md` §15）：
   * **只发布尔**——服务端现读 `project.json` 的 `deduction_nodes` 展开，客户端不传 id 数组
   * （避免第二份可漂移的事实源；客户端过期/伪造 id 不进来，见 `docs/api/80-api-chat.md`） */
  focus_deduction?: boolean;
}
