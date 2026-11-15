// 栏间拖拽手柄（桌面态、对应栏展开时渲染）：6px 垂直细条，hover 高亮 + GripVertical 提示；
// pointer capture 实现拖拽——down 捕获指针后 move/up 持续由本手柄接收（移出窗口也不丢事件）。
// 唯一实现点：AppShell 左右栏与写作页卷章导航栏共用（视觉 / 行为单源）。
// 手柄不画线，分栏线归面板（DESIGN.md §Layout「分栏边线单所有权」）。
import { HolderOutlined } from "@ant-design/icons";
import { cn } from "../../lib/utils";

export interface ResizeHandleProps {
  /** 无障碍名（同时作 title），如「调整左栏宽度」 */
  label: string;
  /** 当前拖拽是否发生在本手柄（决定拖拽态高亮） */
  active: boolean;
  onStart: (clientX: number) => void;
  onMove: (clientX: number) => void;
  onEnd: () => void;
}

export function ResizeHandle({ label, active, onStart, onMove, onEnd }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        // preventDefault 防文本选择起点；capture 保证拖出窗口后指针事件仍路由到手柄
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onStart(e.clientX);
      }}
      onPointerMove={(e) => onMove(e.clientX)}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      className={cn(
        "group relative z-10 h-full w-1.5 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-border",
        active && "bg-border",
      )}
    >
      <HolderOutlined className="absolute inset-y-0 left-1/2 text-base -translate-x-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}