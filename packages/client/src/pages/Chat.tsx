// 页面占位壳（T7.1 路由骨架；内容留 S7 切片卡，见 doc/ui/pages/chat.md）
// 路由：#/chat；数据：POST /api/v1/chat（fetch + ReadableStream 自写 SSE，use-sse.ts，决策 20）、
// /chat/sessions、/proposal/:id/confirm|reject
export default function Chat() {
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">Chat 聊天</h1>
      <p className="text-sm text-zinc-500">AI 创作顾问对话：SSE 流式回复、工具调用折叠、提案确认卡片</p>
    </section>
  );
}
