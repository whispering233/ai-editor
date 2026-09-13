// 人物关系网 + 其他关联（卡 3.6 建；卡 6.3 改为彼此独立的 tab 内容）
// 契约：`docs/ui/DESIGN.md` §数据展示 `character-relations`（行语言 = `data-row`；按 `relationType` 分组 +
//   条数；行 = 对方姓名（可点切选中该角色）+ 方向箭头 + `metadata` 备注副行 + `icon-button` 删除；
//   区头操作区右侧 `button-default`「+ 添加人物关系」，目标端类型锁定 `character`；对称关系显示去重 + 「双向」徽标，
//   不自动建反边）与「其他关联（tab）」（tab 标签常显 `· N` = 不藏；tab 内 `button-default`「+ 添加关联」；
//   行语言同关系网、不分组、按类型序；涵盖 `appears_in`/`belongs_to`/`owns`/`masters`）。
// 分区/去重/排序口径全在 `lib/character-relations.ts`（纯函数，单测覆盖）；本文件只管渲染与副作用。
// 位置：两个数据集与两个字段 tab **平级**（关系不参与 `computeState`，与状态视图正交——见 `10-data-model.md` §14 分层表）。
// 只读语义：关系区的建/删与字段视图无关（各 tab 独立），不随阅读进度视图只读——它不是状态计算的一部分。
import { useMemo, useState } from "react";
import { DeleteOutlined } from "@ant-design/icons";
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
import { TypeChip } from "../ui/tag-chip";
import { useUiStore } from "../../stores/ui";

/** 关系区的两个 pane（= 两个 tab 内容：人↔人关系网 / 其他关联） */
export type CharacterRelationsPane = "network" | "other";

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
            <TypeChip className="shrink-0">
              {label} {directionArrow(row.direction)}
            </TypeChip>
          ) : row.direction === "both" ? (
            <TypeChip className="shrink-0">双向</TypeChip>
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
  /** 只渲染哪个 pane（tab 内容）——两个 tab 各自独立挂载，不共享折叠态 */
  pane: CharacterRelationsPane;
  /** 关系网（按类型分组，已去重） */
  groups: CharacterRelationGroup[];
  /** 其他关联行（未分组、未去重） */
  otherRows: CharacterRelationRow[];
  onAddCharacterRelation: () => void;
  onAddOtherRelation: () => void;
  onDeleteRow: (row: CharacterRelationRow) => void;
}

/**
 * 关系区展示层（与容器分离：便于 `react-dom/server` 走查——仓内无 jsdom，见既有纪律）。
 * 每个 pane = 一张 `card`：一行操作区（右对齐的添加入口）+ 行列表/空态。
 * **不放区标题**：tab 标签已是区名（`其他关联` 的条数也常显在标签上），再画标题就是重复。
 */
export function CharacterRelationsView({
  pane,
  groups,
  otherRows,
  onAddCharacterRelation,
  onAddOtherRelation,
  onDeleteRow,
}: CharacterRelationsViewProps) {
  if (pane === "network") {
    return (
      <SectionCard>
        <div className="mb-1 flex justify-end">
          <Button onClick={onAddCharacterRelation}>+ 添加人物关系</Button>
        </div>
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
    );
  }

  return (
    <SectionCard>
      <div className="mb-1 flex justify-end">
        <Button onClick={onAddOtherRelation}>+ 添加关联</Button>
      </div>
      {otherRows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground/70">
          暂无其他关联（出现于 / 所属 / 拥有 / 掌握…）
        </p>
      ) : (
        <ul>
          {otherRows.map((row) => (
            <RelationRow key={row.key} row={row} withType onDelete={onDeleteRow} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * 关系区容器（数据整形 + 建/删副作用）：`pane` 决定渲染哪张卡，两个 pane 各自挂载（同一 tab 集内）。
 * 建关联：关系网 pane 目标端类型锁 `character` 且关系类型收窄为人↔人 5 类；其他关联 pane 走通用对话框（全类型端）。
 * 删除：物理删（`DELETE /relation`）——确认文案列出被删那条边（合并行额外声明只删一条）。
 */
export function CharacterRelations({
  detail,
  onChanged,
  pane,
}: {
  detail: EntityDetailRes;
  onChanged: () => void;
  pane: CharacterRelationsPane;
}) {
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [otherDialogOpen, setOtherDialogOpen] = useState(false);
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
        pane={pane}
        groups={groups}
        otherRows={otherRows}
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
