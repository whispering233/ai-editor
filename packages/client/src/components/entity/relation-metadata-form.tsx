// 关系说明表单（受控）：短标签 + 说明。关联页编辑对话框与画布连线抽屉**共用这一份**，
// 所以字段不写进任何对话框。上限 = `lib/relation-metadata.ts` 的常量；字数由 antd `showCount` 显示。
import { Input } from "antd";
import {
  RELATION_DESCRIPTION_MAX,
  RELATION_LABEL_MAX,
  type RelationMetadataDraft,
} from "../../lib/relation-metadata";

/** 字段块（标签 + 控件；间距由容器 gap 给） */
const FIELD_CLASS = "flex flex-col gap-1";
/** 字段标签 */
const FIELD_LABEL_CLASS = "text-sm font-medium text-foreground";

export function RelationMetadataForm({
  value,
  onChange,
}: {
  value: RelationMetadataDraft;
  onChange: (value: RelationMetadataDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className={FIELD_CLASS}>
        <p className={FIELD_LABEL_CLASS}>短标签</p>
        <Input
          aria-label="短标签"
          value={value.label}
          maxLength={RELATION_LABEL_MAX}
          showCount
          placeholder="画布连线上显示，可留空"
          onChange={(e) => onChange({ ...value, label: e.target.value })}
        />
      </div>
      <div className={FIELD_CLASS}>
        <p className={FIELD_LABEL_CLASS}>说明</p>
        <Input.TextArea
          aria-label="说明"
          rows={4}
          value={value.description}
          maxLength={RELATION_DESCRIPTION_MAX}
          showCount
          placeholder="这段关系的来龙去脉，可留空"
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </div>
    </div>
  );
}
