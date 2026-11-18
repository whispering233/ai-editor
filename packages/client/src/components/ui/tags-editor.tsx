// 标签列表编辑器（实体属性 `personality` / `tags` / `rules` 等字符串数组字段）：拖拽排序 + 回车续行。
// 交互决策全在 `lib/tags-editor.ts`（enterBehavior / moveArrayItem），本组件只是薄封装。
// suggestions 提供时绑定 datalist（J2：浏览器原生自动完成——输入时弹出已有标签候选）；
// quickTags 提供时渲染「已有标签」快捷选择 chips（K2：点击追加到列表，已选的隐藏）。
import { useRef, useState } from "react";
import { HolderOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import type { InputRef } from "antd";
import { enterBehavior, moveArrayItem } from "@/lib/tags-editor";
import { cn } from "@/lib/utils";
import { SuggestionDatalist } from "./suggestion-datalist";

const SUGGESTIONS_LIST_ID = "entity-tags-suggestions";

export interface TagsEditorProps {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  /** datalist 候选（缺省 = 不绑定自动完成） */
  suggestions?: readonly string[];
  /** 「已有标签」快捷 chips（缺省 = 不渲染该行；已选的隐藏） */
  quickTags?: readonly string[];
}

export function TagsEditor({ values, onChange, placeholder, suggestions, quickTags }: TagsEditorProps) {
  // 输入框 ref 表（M1：回车后聚焦下一行/新行；下标即行号，追加行在渲染后经 rAF 聚焦）
  const inputRefs = useRef<Array<InputRef | null>>([]);
  // 拖拽排序态（M3）：dragIndex = 被拖行；dragOverIndex = 当前悬停目标行（高亮提示）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      {values.map((v, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-0.5 py-0.5 transition-colors",
            dragIndex === i && "opacity-40",
            dragOverIndex === i &&
              dragIndex !== null &&
              dragIndex !== i &&
              "bg-muted/60 ring-1 ring-ring",
          )}
          onDragOver={(e) => {
            // 仅自身拖拽进行中响应（dragIndex 非空）——不 preventDefault 时保留浏览器默认
            // 行为（输入框内文本拖选/拖入照常），不干扰文本编辑
            if (dragIndex === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragOverIndex !== i) setDragOverIndex(i);
          }}
          onDrop={(e) => {
            if (dragIndex === null) return;
            e.preventDefault();
            if (dragIndex !== i) onChange(moveArrayItem(values, dragIndex, i));
            setDragIndex(null);
            setDragOverIndex(null);
          }}
        >
          {/* 拖拽手柄（M3：HTML5 原生 DnD，零依赖；draggable 仅手柄——输入框内文本选择不受影响） */}
          <span className="flex shrink-0 cursor-grab active:cursor-grabbing">
            <Button
              color="default"
              variant="text"
              size="small"
              draggable
              title="拖拽排序"
              aria-label="拖拽排序"
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = "move";
                // Firefox 需 setData 才启动拖拽（types 含 text/plain 亦可作自识别标记）
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              icon={<HolderOutlined className="text-base" />}
            />
          </span>
          <Input
            value={v}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            onKeyDown={(e) => {
              // M1（2026-08 用户反馈）：「输入后回车添加下一项」——回车 = 非末行聚焦下一行 /
              // 末行非空追加空行并聚焦 / 末行空无操作（决策纯函数 enterBehavior）
              if (e.key !== "Enter") return;
              e.preventDefault();
              const b = enterBehavior(values, i);
              if (!b) return;
              if (b.append) onChange([...values, ""]);
              // 追加行渲染完成后聚焦（rAF 确保新输入框已挂载）
              requestAnimationFrame(() => inputRefs.current[b.focusIndex]?.focus());
            }}
            placeholder={placeholder}
            list={suggestions && suggestions.length > 0 ? SUGGESTIONS_LIST_ID : undefined}
            className="flex-1"
          />
          <Button onClick={() => onChange(values.filter((_, j) => j !== i))}>删除</Button>
        </div>
      ))}
      <Button className="self-start" onClick={() => onChange([...values, ""])}>
        + 添加
      </Button>
      {/* 快捷选择既有标签（K2：点击追加，去重——已选的不再展示） */}
      {quickTags && quickTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">已有标签：</span>
          {quickTags
            .filter((t) => !values.includes(t))
            .map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChange([...values, t])}
                className="rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground hover:bg-muted hover:text-foreground"
              >
                {t}
              </button>
            ))}
        </div>
      )}
      {suggestions && suggestions.length > 0 && (
        <SuggestionDatalist id={SUGGESTIONS_LIST_ID} options={suggestions} />
      )}
    </div>
  );
}
