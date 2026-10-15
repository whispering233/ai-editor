// 作品介绍页（`#/works`）——预置作品清单，每部作品一张卡（作品名 + 介绍 markdown）。
//
// 契约：
// - 视觉 / 几何 = `docs/ui/DESIGN.md` §作家文风练习区「作品介绍」：页头常驻模板 + 每部作品一个
//   `card`（作品名 `section-title` + 介绍 markdown）；**无编辑入口、无「新建作品」**
// - 数据 = shared 常量（`docs/design/60-practice.md` §3：作品清单是**封闭集合**，不可增删改；
//   客户端的作品下拉与 AI 工具读同一份 `AUTHOR_CATALOG`）
// - 作家未解析（存量工作区 `author_id` 缺失 / 未知）→ 空态（不崩、不空白）
//
// 分层：`WorksBody` = 纯展示（无 effect、无请求，导出供 SSR 走查——仓内无 jsdom）；
// 默认导出 = 容器（从项目配置取当前工作区的作家 id）。
import { resolveAuthor, type AuthorEntry } from "@whispering233/ai-editor-shared";
import Markdown from "@ant-design/x-markdown";
import { AUTHOR_MISSING_HINT } from "../lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useProjectStore } from "../stores/project";

/** 作品卡列表（每部一张卡）；作家未解析 = 空态 */
export function WorksBody({ author }: { author: AuthorEntry | null }) {
  if (author === null) return <EmptyState padding="sm">{AUTHOR_MISSING_HINT}</EmptyState>;
  return (
    <div className="flex flex-col gap-4">
      {author.works.map((work) => (
        <SectionCard key={work.id} title={work.name}>
          <Markdown>{work.intro}</Markdown>
        </SectionCard>
      ))}
    </div>
  );
}

export default function Works() {
  const authorId = useProjectStore((s) => s.config?.authorId ?? null);
  return (
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader title="作品介绍" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <WorksBody author={resolveAuthor(authorId)} />
      </div>
    </section>
  );
}
