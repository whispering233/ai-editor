// 页面占位壳（T7.1 路由骨架；内容留切片卡，见 doc/ui/pages/trash.md）
// 路由：#/trash（回收站是跨实体/大纲的全局入口，侧栏底部，layout.md §2.2）；
// 数据：GET /api/v1/trash；还原 POST /trash/entity|outline/:id/restore、彻底删除 DELETE（决策 12 软删 + 回收站）
export default function Trash() {
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">Trash 回收站</h1>
      <p className="text-sm text-zinc-500">软删对象（实体 + 大纲节点）的还原与彻底删除（purge）</p>
    </section>
  );
}
