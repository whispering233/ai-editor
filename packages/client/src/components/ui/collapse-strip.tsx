// 收起窄条（栏收起后替代主体渲染）：32px 窄条 + 展开按钮（点击恢复原宽）。
// 图标 = 与对应栏收起按钮同一族镜像对（DESIGN.md `icon-button`）：左栏展开 = `»`、右栏展开 = `«`。
// 唯一实现点：AppShell 左右栏与写作页卷章导航栏共用。
import { Button } from "antd";
import { DoubleLeftOutlined, DoubleRightOutlined } from "@ant-design/icons";
import { cn } from "../../lib/utils";

export interface CollapseStripProps {
  /** 窄条所在侧（左栏 = 右边线，右栏 = 左边线） */
  side: "left" | "right";
  /** 展开按钮的无障碍名与 title，如「展开左栏」 */
  label: string;
  onExpand: () => void;
}

export function CollapseStrip({ side, label, onExpand }: CollapseStripProps) {
  const isLeft = side === "left";
  const ExpandIcon = isLeft ? DoubleRightOutlined : DoubleLeftOutlined;
  return (
    <div
      className={cn(
        "flex h-full w-8 shrink-0 flex-col items-center bg-sidebar",
        isLeft ? "border-r border-border" : "border-l border-border",
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