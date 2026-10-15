// 作家介绍页（`#/author`）——预置作家介绍的只读 markdown。
//
// 契约：
// - 视觉 / 几何 = `docs/ui/DESIGN.md` §作家文风练习区「作家介绍」：页头常驻模板
//   （`section: h-full min-h-0 flex flex-col` + 内容进内层 `flex min-h-0 flex-1 flex-col
//   overflow-y-auto`）+ `card` 面 markdown 渲染（`@ant-design/x-markdown`，**只读**、无编辑入口）
// - 数据 = shared 常量（`docs/design/60-practice.md` §3：作家介绍是产品预置文本，**没有端点**，
//   客户端与 AI 工具读同一份 `AUTHOR_CATALOG`）
// - 作家未解析（存量工作区 `author_id` 缺失 / 未知）→ 空态（不崩、不空白）
//
// 分层：`AuthorIntroBody` = 纯展示（无 effect、无请求，导出供 SSR 走查——仓内无 jsdom）；
// 默认导出 = 容器（从项目配置取当前工作区的作家 id）。
import { resolveAuthor, type AuthorEntry } from "@whispering233/ai-editor-shared";
import Markdown from "@ant-design/x-markdown";
import { AUTHOR_MISSING_HINT } from "../lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useProjectStore } from "../stores/project";

/** 卡片面（作家名 + 介绍 markdown）；作家未解析 = 空态 */
export function AuthorIntroBody({ author }: { author: AuthorEntry | null }) {
  if (author === null) return <EmptyState padding="sm">{AUTHOR_MISSING_HINT}</EmptyState>;
  return (
    <SectionCard title={author.name}>
      <Markdown>{author.intro}</Markdown>
    </SectionCard>
  );
}

export default function AuthorIntro() {
  const authorId = useProjectStore((s) => s.config?.authorId ?? null);
  return (
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader title="作家介绍" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AuthorIntroBody author={resolveAuthor(authorId)} />
      </div>
    </section>
  );
}
