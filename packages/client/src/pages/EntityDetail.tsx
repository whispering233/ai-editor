// 页面占位壳（T7.1 路由骨架；内容留 S3 切片卡，见 doc/ui/pages/entity-detail.md）
// 路由：#/entities/:type/:id；数据：GET /api/v1/entity/:type/:id（含 relations、deltaCount）；编辑 PUT / 软删 DELETE
export default function EntityDetail({ type, id }: { type: string; id: string }) {
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">EntityDetail 实体详情</h1>
      <p className="text-sm text-zinc-500">
        实体详情（基础信息 data 表单 + 关联列表 + 变更记录）；类型: {type}，ID: {id}
      </p>
    </section>
  );
}
