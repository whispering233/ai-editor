// 页面占位壳（T7.1 路由骨架；内容留 S1 切片卡，见 doc/ui/pages/settings.md）
// 路由：#/settings；数据：GET/PUT /api/v1/settings/llm（模型名 + API Key，key 存 ~/.ai-editor/config.json 或环境变量，不入项目文件）
export default function Settings() {
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">Settings 设置</h1>
      <p className="text-sm text-zinc-500">AI 模型名与 API Key 配置（key 不入项目文件，决策 8）</p>
    </section>
  );
}
