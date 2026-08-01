// 页面占位壳（T7.1 路由骨架；内容留 S1 切片卡，见 doc/ui/pages/dashboard.md）
// 路由：#/（默认落地页）；数据：GET /api/v1/project/config、/entity/:type×4、/outline、/chat/sessions
export default function Dashboard() {
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">Dashboard 首页</h1>
      <p className="text-sm text-zinc-500">
        项目概览：项目信息、四类要素统计（人物/设定/地点/伏笔）、大纲概览、最近会话
      </p>
    </section>
  );
}
