// 「写作设置」下拉（卡 13.2 起）：工具条右端（撤销 / 重做之后）——字体 / 字号 / 行高 / 纸张 / 纹理 / 段首缩进
// 六行档位切换。契约：docs/ui/DESIGN.md §Components「写作面（工具条 / 专注模式）」右侧顺序 +
// §Colors「写作面偏好」（档位数值与中文档位名的唯一定义 = hooks/use-writing-prefs.ts，本文件只消费，不复制任何档位）。
// - 数据（prefs / setPref）由 DocumentEditor 经 props 传入：**不在本组件再调一次 hook**
//   ——两处各持一份状态会互不同步（工具条按钮与编辑器容器显示不同档位）。
// - 触发器由工具条传入（库自带的工具条按钮，与撤销/重做同表皮）；点击打开（非 hover：
//   弹层里是可点控件）。浮层走 antd Popover 的 portal，不受工具条 sticky 盒裁切。
// - 样式纪律：只走 antd token 与 Tailwind 语义类——无硬编码色值 / 无 `!` 前缀类 / 无拼接类名
//   （守卫 design-discipline.test.ts 扫源码）。
import { Popover, Segmented } from "antd";
import type { ReactNode } from "react";
import {
  WRITING_FONT_OPTIONS,
  WRITING_FONT_SIZE_OPTIONS,
  WRITING_INDENT_OPTIONS,
  WRITING_LINE_HEIGHT_OPTIONS,
  WRITING_PAPER_OPTIONS,
  WRITING_PAPER_TEXTURE_OPTIONS,
  type WritingFont,
  type WritingFontSize,
  type WritingLineHeight,
  type WritingPaper,
  type WritingPaperTexture,
  type WritingPrefs,
} from "../../hooks/use-writing-prefs";

interface WritingSettingsProps {
  prefs: WritingPrefs;
  /** 单字段更新（类型收窄：`setPref("fontSize", 18)`），写入即持久化 */
  setPref: <K extends keyof WritingPrefs>(key: K, value: WritingPrefs[K]) => void;
  /** 触发器（工具条传入：与撤销/重做同表的库工具条按钮） */
  children: ReactNode;
}

/** 一行档位：定宽标签 + 档位组（标签宽度固定 ⇒ 六行档位组左缘对齐；`w-14` 装得下最长标签「段首缩进」） */
function PrefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function WritingSettings({ prefs, setPref, children }: WritingSettingsProps) {
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={
        <div className="flex flex-col gap-2">
          <PrefRow label="字体">
            <Segmented<WritingFont>
              size="small"
              value={prefs.font}
              options={WRITING_FONT_OPTIONS}
              onChange={(value) => setPref("font", value)}
            />
          </PrefRow>
          <PrefRow label="字号">
            <Segmented<WritingFontSize>
              size="small"
              value={prefs.fontSize}
              options={WRITING_FONT_SIZE_OPTIONS}
              onChange={(value) => setPref("fontSize", value)}
            />
          </PrefRow>
          <PrefRow label="行高">
            <Segmented<WritingLineHeight>
              size="small"
              value={prefs.lineHeight}
              options={WRITING_LINE_HEIGHT_OPTIONS}
              onChange={(value) => setPref("lineHeight", value)}
            />
          </PrefRow>
          <PrefRow label="纸张">
            <Segmented<WritingPaper>
              size="small"
              value={prefs.paper}
              options={WRITING_PAPER_OPTIONS}
              onChange={(value) => setPref("paper", value)}
            />
          </PrefRow>
          <PrefRow label="纹理">
            <Segmented<WritingPaperTexture>
              size="small"
              value={prefs.paperTexture}
              options={WRITING_PAPER_TEXTURE_OPTIONS}
              onChange={(value) => setPref("paperTexture", value)}
            />
          </PrefRow>
          <PrefRow label="段首缩进">
            <Segmented<boolean>
              size="small"
              value={prefs.indent}
              options={WRITING_INDENT_OPTIONS}
              onChange={(value) => setPref("indent", value)}
            />
          </PrefRow>
        </div>
      }
    >
      {children}
    </Popover>
  );
}
