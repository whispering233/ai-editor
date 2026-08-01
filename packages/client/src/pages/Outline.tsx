// 页面占位壳（T7.1 路由骨架；内容留 S2 切片卡，见 doc/ui/pages/outline.md）
// 路由：#/outline；数据：GET /api/v1/outline（整树）；操作：POST/PUT/DELETE /outline、PUT /project/config（设当前位置）
export default function Outline() {
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">Outline 大纲</h1>
      <p className="text-sm text-zinc-500">大纲树（卷→章→场景 三层）：新建/编辑/移动节点、设为当前位置</p>
    </section>
  );
}
