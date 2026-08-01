// 页面占位壳（T7.1 路由骨架；内容留 S3 切片卡，见 doc/ui/pages/entity-list.md）
// 路由：#/entities/:type?（type ∈ character|setting|location|hook，缺省 character）；
// 数据：GET /api/v1/entity/:type?q=&offset=&limit=&sort=&order=
export default function EntityList({ type }: { type: string }) {
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">EntityList 实体列表</h1>
      <p className="text-sm text-zinc-500">
        实体列表（人物/设定/地点/伏笔 切换 tab、搜索、排序、分页、新建）；当前类型: {type}
      </p>
    </section>
  );
}
