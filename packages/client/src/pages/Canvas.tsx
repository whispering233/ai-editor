// 页面占位壳（T7.1 路由骨架；内容留 S6 切片卡，见 doc/ui/pages/canvas.md）
// 路由：#/canvas；数据：GET /api/v1/outline + /relation（plot_edge）；布局存 localStorage（决策 10，key 按 project_id 隔离）
export default function Canvas() {
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">Canvas 画布</h1>
      <p className="text-sm text-zinc-500">
        大纲树投影 + 剧情连线（plot_edge）推演；节点坐标/缩放存浏览器 localStorage（决策 10）
      </p>
    </section>
  );
}
