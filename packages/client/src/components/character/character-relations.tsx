// 人物关系网 + 其他关联分区（卡 3.6）
// 契约：`docs/ui/DESIGN.md` §数据展示 `character-relations`（行语言 = `data-row`；按 `relationType` 分组 +
//   条数；行 = 对方姓名（可点切选中该角色）+ 方向箭头 + `metadata` 备注副行 + `icon-button` 删除；
//   区头右侧 `button-default`「+ 添加人物关系」，目标端类型锁定 `character`；对称关系显示去重 + 「双向」徽标，
//   不自动建反边）与「其他关联（折叠区）」（标题行「其他关联 · N 条」+ chevron（`icon-button`）+
//   展开后「+ 添加关联」；默认收起；行语言同关系网、不分组、按类型序；涵盖 `appears_in`/`belongs_to`/
//   `owns`/`masters`——**收起但不可藏**，条数常显）。
// 分区/去重/排序口径全在 `lib/character-relations.ts`（纯函数，单测覆盖）；本文件只管渲染与副作用。
// 位置：在**两个 tab 之下**（关系不参与 `computeState`，与状态视图正交——见 `10-data-model.md` §14 分层表）。
// 只读语义：关系区的建/删与 tab 无关（两个视图共享），不随 tab 2 的只读态禁用——它不是状态计算的一部分。
import { useMemo, useState } from "react";
import { DeleteOutlined, DownOutlined, RightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { EntityDetailRes, RelationSummaryItem } from "../../lib/api";
import { deleteRelation } from "../../lib/api";
import {
  buildCharacterRelationGroups,
  buildOtherRelationRows,
  characterRelationDeleteDescription,
  INTER_CHARACTER_RELATION_TYPES,
  partitionCharacterRelations,
  relationEndpointHref,
  type CharacterRelationGroup,
  type CharacterRelationRow,
} from "../../lib/character-relations";
import { relationTypeLabel } from "../../lib/entity-detail";
import { CreateRelationDialog } from "../entity/create-relation-dialog";
import { ConfirmDialog } from "../outline/dialogs";
import { SectionCard } from "../ui/section-card";
import { useUiStore } from "../../stores/ui";

/** 方向 → 箭头（相对本角色：out = 我 → 对方；in = 对方 → 我；self = 自环；both 由徽标表达） */
function directionArrow(direction: CharacterRelationRow["direction"]): string {
  return direction === "in" ? "←" : "→";
}

/** 行副标题（`metadata` 备注；无内容不渲染） */
function RelationNote({ note }: { note: string | null }) {
  if (note === null) return null;
  return <p className="mt-0.5 truncate text-xs text-muted-foreground">{note}</p>;
}

/** 对方端点展示（已知类型 → 可点跳转；未知类型 → 纯文本） */
function RelationOtherName({ row }: { row: CharacterRelationRow }) {
  const href = relationEndpointHref(row.other.type, row.other.id);
  if (href === null) return <span className="truncate text-foreground">{row.other.name}</span>;
  return (
    <a href={href} title={`打开「${row.other.name}」`} className="truncate text-foreground hover:text-primary">
      {row.other.name}
    </a>
  );
}

/** 关系行（关系网与其他关联共用行语言；`withType` = 其他关联不分组，需自带类型 chip） */
function RelationRow({
  row,
  withType,
  onDelete,
}: {
  row: CharacterRelationRow;
  withType: boolean;
  onDelete: (row: CharacterRelationRow) => void;
}) {
  const label = relationTypeLabel(row.relationType);
  return (
    <li className="flex items-start gap-2 border-b border-border/50 py-2 text-sm last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <RelationOtherName row={row} />
          {withType ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {label} {directionArrow(row.direction)}
            </span>
          ) : row.direction === "both" ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              双向
            </span>
          ) : (
            <span
              title={row.direction === "in" ? "对方 → 本角色" : "本角色 → 对方"}
              className="shrink-0 text-xs text-muted-foreground"
            >
              {directionArrow(row.direction)}
            </span>
          )}
        </span>
        <RelationNote note={row.note} />
      </span>
      <Button
        danger
        color="danger"
        variant="text"
        size="small"
        className="shrink-0"
        title="删除关系"
        aria-label={`删除与「${row.other.name}」的${label}关系`}
        icon={<DeleteOutlined className="text-sm" />}
        onClick={() => onDelete(row)}
      />
    </li>
  );
}

export interface CharacterRelationsViewProps {
  /** 关系网（按类型分组，已去重） */
  groups: CharacterRelationGroup[];
  /** 其他关联行（未分组、未去重） */
  otherRows: CharacterRelationRow[];
  /** 「其他关联」折叠态（默认 false = 收起） */
  otherExpanded: boolean;
  onToggleOther: () => void;
  onAddCharacterRelation: () => void;
  onAddOtherRelation: () => void;
  onDeleteRow: (row: CharacterRelationRow) => void;
}

/**
 * 关系区展示层（与容器分离：便于 `react-dom/server` 走查——仓内无 jsdom，见既有纪律）。
 * 两个区块都是 `card` 容器（`SectionCard`）+ 标题行操作/箭头。
 */
export function CharacterRelationsView({
  groups,
  otherRows,
  otherExpanded,
  onToggleOther,
  onAddCharacterRelation,
  onAddOtherRelation,
  onDeleteRow,
}: CharacterRelationsViewProps) {
  return (
    <>
      <SectionCard
        className="mt-4"
        title="人物关系网"
        action={<Button onClick={onAddCharacterRelation}>+ 添加人物关系</Button>}
      >
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground/70">
            还没有人物关系，添加一条
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.relationType}>
              <p className="mt-3 mb-1 text-xs text-muted-foreground first:mt-0">
                {`${relationTypeLabel(group.relationType)} · ${group.rows.length}`}
              </p>
              <ul>
                {group.rows.map((row) => (
                  <RelationRow key={row.key} row={row} withType={false} onDelete={onDeleteRow} />
                ))}
              </ul>
            </div>
          ))
        )}
      </SectionCard>

      <SectionCard
        className="mt-4"
        title={
          <span className="flex items-center gap-1">
            {`其他关联 · ${otherRows.length} 条`}
            <Button
              color="default"
              variant="text"
              size="small"
              title={otherExpanded ? "收起其他关联" : "展开其他关联"}
              aria-label={otherExpanded ? "收起其他关联" : "展开其他关联"}
              aria-expanded={otherExpanded}
              icon={
                otherExpanded ? (
                  <DownOutlined className="text-sm" />
                ) : (
                  <RightOutlined className="text-sm" />
                )
              }
              onClick={onToggleOther}
            />
          </span>
        }
        action={otherExpanded ? <Button onClick={onAddOtherRelation}>+ 添加关联</Button> : undefined}
      >
        {otherExpanded &&
          (otherRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground/70">
              暂无其他关联（出现于 / 所属 / 拥有 / 掌握…）
            </p>
          ) : (
            <ul>
              {otherRows.map((row) => (
                <RelationRow key={row.key} row={row} withType onDelete={onDeleteRow} />
              ))}
            </ul>
          ))}
      </SectionCard>
    </>
  );
}

/**
 * 关系区容器（数据整形 + 建/删副作用）。
 * 建关联：关系网区目标端类型锁 `character` 且关系类型收窄为人↔人 5 类；其他关联区走通用对话框（全类型端）。
 * 删除：物理删（`DELETE /relation`）——确认文案列出被删那条边（合并行额外声明只删一条）。
 */
export function CharacterRelations({
  detail,
  onChanged,
}: {
  detail: EntityDetailRes;
  onChanged: () => void;
}) {
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [otherDialogOpen, setOtherDialogOpen] = useState(false);
  const [otherExpanded, setOtherExpanded] = useState(false);
  const [deleteRow, setDeleteRow] = useState<CharacterRelationRow | null>(null);

  const self = useMemo(
    () => ({ selfId: detail.id, selfName: detail.name }),
    [detail.id, detail.name],
  );
  const relations: readonly RelationSummaryItem[] = detail.relations;
  const partition = useMemo(
    () => partitionCharacterRelations(relations, self),
    [relations, self],
  );
  const groups = useMemo(
    () => buildCharacterRelationGroups(partition.network, self),
    [partition.network, self],
  );
  const otherRows = useMemo(
    () => buildOtherRelationRows(partition.other, self),
    [partition.other, self],
  );

  async function handleDelete() {
    if (deleteRow === null) return;
    await deleteRelation(deleteRow.relationId);
    useUiStore.getState().showToast("已删除关系");
    setDeleteRow(null);
    onChanged();
  }

  return (
    <>
      <CharacterRelationsView
        groups={groups}
        otherRows={otherRows}
        otherExpanded={otherExpanded}
        onToggleOther={() => setOtherExpanded((v) => !v)}
        onAddCharacterRelation={() => setNetworkDialogOpen(true)}
        onAddOtherRelation={() => setOtherDialogOpen(true)}
        onDeleteRow={setDeleteRow}
      />

      {networkDialogOpen && (
        <CreateRelationDialog
          source={{ type: "character", id: detail.id, name: detail.name }}
          lockTargetType="character"
          relationTypes={INTER_CHARACTER_RELATION_TYPES}
          onCreated={() => {
            setNetworkDialogOpen(false);
            onChanged();
          }}
          onClose={() => setNetworkDialogOpen(false)}
        />
      )}

      {otherDialogOpen && (
        <CreateRelationDialog
          source={{ type: "character", id: detail.id, name: detail.name }}
          onCreated={() => {
            setOtherDialogOpen(false);
            onChanged();
          }}
          onClose={() => setOtherDialogOpen(false)}
        />
      )}

      {deleteRow !== null && (
        <ConfirmDialog
          title="删除关系"
          description={characterRelationDeleteDescription(deleteRow, detail.name)}
          confirmLabel="删除"
          danger
          onConfirm={handleDelete}
          onClose={() => setDeleteRow(null)}
        />
      )}
    </>
  );
}
