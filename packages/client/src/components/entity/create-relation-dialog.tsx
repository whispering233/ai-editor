// 建立关联对话框（U8 抽共用；契约 doc/ui/pages/entity-detail.md「新增关联」+ entity-list.md「关联 Tab」）
// 两模式：
// - 详情模式（source 非 null）：源固定为本端点——实体详情页「本实体：{name}」、大纲节点详情页（S12.2）
//   「本节点：{name}」（source.type 支持 outline_node，schema.md 端点类型），方向「本端点 → 关联对象」
// - 列表模式（source 为 null）：暴露源实体选择（类型下拉默认 character + 实体下拉 listEntities limit 100），方向「源 → 目标」
// 目标端类型支持四类实体 + 大纲节点（outline store 树，无需请求）；409 RELATION_EXISTS → 内联「这条关系已经存在」；
// 成功 → toast「已建立关系」→ onCreated() → onClose()。样式 token 类（layout.md §3）。
// 布局：左右三段式「源 -关系-> 目标」——grid-cols-[1fr_auto_1fr]（sm 起），窄屏垂直堆叠；
//   中列关系类型下拉 + 「→」箭头（mt-auto 沉底对齐两端实体下拉），三列各有小标题（源实体/关系类型/目标实体）。
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ENTITY_TYPES, RELATION_TYPES } from "@whispering233/ai-editor-shared";
import type { EntitySummary, EntityType } from "@whispering233/ai-editor-shared";
import { ApiError, createRelation, listEntities, type CreateRelationBody } from "../../lib/api";
import { relationTypeLabel } from "../../lib/entity-detail";
import { flattenTree } from "../../lib/outline-tree";
import { useProjectStore } from "../../stores/project";
import { useUiStore } from "../../stores/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const TYPE_LABEL: Record<EntityType, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
};

/** 下拉选择框样式（token 类，layout.md §3） */
const SELECT_CLASS =
  "w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** 源端点（详情模式传入；null = 列表模式自由选择源）。
 * 四类实体（EntityType）+ 大纲节点（outline_node，S12.2 节点详情页作为源建立关系——schema.md 端点类型） */
export interface RelationSource {
  type: EntityType | "outline_node";
  id: string;
  name: string;
}

export function CreateRelationDialog({
  source,
  onCreated,
  onClose,
}: {
  source: RelationSource | null;
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const outline = useProjectStore((s) => s.outline);
  // 列表模式源端（详情模式不用）
  const [sourceType, setSourceType] = useState<EntityType>("character");
  const [sourceEntities, setSourceEntities] = useState<EntitySummary[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  // 目标端（两模式共用；"outline_node" = 大纲节点，schema.md relation_records 端点类型）
  const [otherType, setOtherType] = useState<EntityType | "outline_node">("character");
  const [otherEntities, setOtherEntities] = useState<EntitySummary[] | null>(null);
  const [otherId, setOtherId] = useState("");
  const [relationType, setRelationType] = useState<string>(RELATION_TYPES[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 列表模式：源类型变化 → 拉实体列表
  useEffect(() => {
    if (source) return;
    setSourceId("");
    setSourceEntities(null);
    listEntities(sourceType, { limit: 100 })
      .then((res) => setSourceEntities(res.items))
      .catch(() => setSourceEntities([]));
  }, [source, sourceType]);

  // 目标端类型变化 → 拉实体列表（大纲节点用 outline store 的树，无需请求）
  useEffect(() => {
    setOtherId("");
    if (otherType === "outline_node") {
      setOtherEntities(null);
      return;
    }
    setOtherEntities(null);
    listEntities(otherType, { limit: 100 })
      .then((res) => setOtherEntities(res.items))
      .catch(() => setOtherEntities([]));
  }, [otherType]);

  const outlineOptions = flattenTree(outline?.children ?? []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!source && !sourceId) {
      setError("请选择源实体");
      return;
    }
    if (!otherId) {
      setError("请选择关联对象");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateRelationBody = {
        source_type: source ? source.type : sourceType,
        source_id: source ? source.id : sourceId,
        target_type: otherType,
        target_id: otherId,
        relation_type: relationType,
      };
      await createRelation(body);
      useUiStore.getState().showToast("已建立关系");
      await onCreated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "RELATION_EXISTS") {
        setError("这条关系已经存在");
      } else {
        setError(err instanceof ApiError ? err.message : "创建失败，请重试");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>新增关联</DialogTitle>
        </DialogHeader>
        <form id="create-relation-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* 左右布局：源 -关系-> 目标 一行三段式；窄屏（sm 以下）垂直堆叠 */}
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
            {/* 左列：源实体（详情模式固定本实体禁选卡片；列表模式自由选择） */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">源实体</p>
              {source ? (
                <div
                  title={source.name}
                  className="min-w-0 truncate rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-foreground"
                >
                  {source.type === "outline_node" ? "本节点" : "本实体"}：{source.name}
                </div>
              ) : (
                <>
                  <select
                    value={sourceType}
                    onChange={(e) => setSourceType(e.target.value as EntityType)}
                    className={SELECT_CLASS}
                  >
                    {ENTITY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={SELECT_CLASS}>
                    <option value="">选择{TYPE_LABEL[sourceType]}…</option>
                    {(sourceEntities ?? []).map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
            {/* 中列：关系类型 + 方向箭头（mt-auto 沉底与两端实体下拉对齐，表达「源 关系→ 目标」） */}
            <div className="flex flex-col gap-2 sm:w-44">
              <p className="text-sm font-medium text-foreground">关系类型</p>
              <select value={relationType} onChange={(e) => setRelationType(e.target.value)} className={SELECT_CLASS}>
                {RELATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {relationTypeLabel(t)}
                  </option>
                ))}
              </select>
              <span
                aria-hidden="true"
                className="mt-auto select-none pb-1 text-center text-xl leading-none text-muted-foreground"
              >
                →
              </span>
            </div>
            {/* 右列：目标实体（大纲节点用 outline store 树） */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">目标实体</p>
              <select
                value={otherType}
                onChange={(e) => setOtherType(e.target.value as EntityType | "outline_node")}
                className={SELECT_CLASS}
              >
                <option value="character">人物</option>
                <option value="setting">设定</option>
                <option value="location">地点</option>
                <option value="hook">伏笔</option>
                <option value="outline_node">大纲节点</option>
              </select>
              {otherType === "outline_node" ? (
                <select value={otherId} onChange={(e) => setOtherId(e.target.value)} className={SELECT_CLASS}>
                  <option value="">选择大纲节点…</option>
                  {outlineOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {"　".repeat(o.depth)}
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <select value={otherId} onChange={(e) => setOtherId(e.target.value)} className={SELECT_CLASS}>
                  <option value="">选择{TYPE_LABEL[otherType]}…</option>
                  {(otherEntities ?? []).map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="create-relation-form" disabled={submitting}>
            建立
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
