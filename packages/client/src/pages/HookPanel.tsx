// 页面占位壳（T7.1 路由骨架；内容留 S5 切片卡，见 doc/ui/pages/hook-panel.md）
// 路由：#/hooks；数据：GET /api/v1/entity/hook（列表）+ /hook/:id（relations plants/advances/resolves/depends_on/involves）
// MVP 简化：不展示健康指标徽标与章节序（backlog #13）
export default function HookPanel() {
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">HookPanel 伏笔面板</h1>
      <p className="text-sm text-zinc-500">伏笔池（按状态分组）：新建伏笔、推进/回收、废弃、软删（MVP 不展示健康指标）</p>
    </section>
  );
}
