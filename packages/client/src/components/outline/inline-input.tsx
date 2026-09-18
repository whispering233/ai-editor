// 大纲页就地输入行（标题 / 摘要 / 顶层新建卷 / 树行建子级 / 章视图改名 共用）——**唯一实现**：
// 原先树视图的闭包 helper `inlineInput()` 与章视图各写一份同样的 antd Input（maxLength / size / 尺寸类
// 两处漂移风险），2026-09 抽成本组件（两处同名同参，抽后无行为变化）。
// 尺寸口径：antd `Input` small 档 = 24px（`controlHeightSM`），与行高对齐——见 `docs/ui/DESIGN.md` 行结构条目。
import { Input } from "antd";
import type { KeyboardEvent } from "react";

export interface InlineInputProps {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** 失焦提交 / 取消（Enter 与 Esc 由 `onKeyDown` 决定） */
  onBlur: () => void;
  placeholder: string;
}

export function InlineInput({
  value,
  onChange,
  onKeyDown,
  onBlur,
  placeholder,
}: InlineInputProps) {
  return (
    <Input
      size="small"
      className="min-w-0 flex-1"
      autoComplete="off"
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      maxLength={200}
      placeholder={placeholder}
    />
  );
}
