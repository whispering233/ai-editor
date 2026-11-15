// 收起窄条（栏收起后替代主体渲染）：32px 窄条 + 展开按钮（点击恢复原宽）。
// 两族语义分层（DESIGN.md §Components `icon-button`）：
//   `chevron`（默认）= 整栏收起/展开，图标 = 与对应栏收起按钮同一族镜像对：左栏展开 = `»`、右栏展开 = `«`；
//   `grip` = 面板内子栏（写作页卷章栏），中线上一枚单箭头圆钮，与展开态的中缝圆钮同一形态。
// 唯一实现点：AppShell 左右栏与写作页卷章导航栏共用。
import { Button } from "antd";
import { DoubleLeftOutlined, DoubleRightOutlined, RightOutlined } from "@ant-design/icons";
import { cn } from "../../lib/utils";

export interface CollapseStripProps {
  /** 窄条所在侧（左栏 = 右边线，右栏 = 左边线） */
  side: "left" | "right";
  /** 展开按钮的无障碍名与 title，如「展开左栏」 */
  label: string;
  onExpand: () => void;
  /** 图标族：整栏双箭头镜像对（默认）/ 面板内子栏的中缝单箭头圆钮 */
  variant?: "chevron" | "grip";
}

export function CollapseStrip({
  side,
  label,
  onExpand,
  variant = "chevron",
}: CollapseStripProps) {
  const isLeft = side === "left";
  const borderClass = isLeft ? "border-r border-border" : "border-l border-border";

  // 面板内子栏：中线圆钮（展开 = 单箭头朝内容侧，与展开态圆钮同一表皮）
  if (variant === "grip") {
    return (
      <div
        className={cn(
          "flex h-full w-8 shrink-0 flex-col items-center justify-center bg-sidebar",
          borderClass,
        )}
      >
        <Button
          color="default" variant="outlined" shape="circle"
          size="small"
          onClick={onExpand}
          aria-label={label}
          title={label}
          icon={<RightOutlined className="text-xs" />}
        />
      </div>
    );
  }

  const ExpandIcon = isLeft ? DoubleRightOutlined : DoubleLeftOutlined;
  return (
    <div
      className={cn(
        "flex h-full w-8 shrink-0 flex-col items-center bg-sidebar",
        borderClass,
      )}
    >
      <Button
        color="default" variant="text"
        size="middle"
        className="mt-3"
        onClick={onExpand}
        aria-label={label}
        title={label}
        icon={<ExpandIcon className="text-base" />}
      />
    </div>
  );
}
