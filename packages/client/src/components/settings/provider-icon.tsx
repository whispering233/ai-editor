// 供应商品牌 logo（DESIGN.md §Components `provider-icon`）：
// `<use href="/provider-icons.svg#symbol">` 引 `public/` 精灵（vite 自动托管 + 构建复制到 dist，
// 服务端 SPA 静态托管直接命中）；无对应 symbol 的自定义 provider 回退 antd `ApiOutlined`。
//
// 色纪律：自带品牌色的 logo（DeepSeek 蓝、Google 四色…）原样呈现——品牌资产不参与界面取色
// （DESIGN.md 登记的例外）；无线品牌色的 logo 用 `currentColor`（字色类给 `text-muted-foreground`）。
import { ApiOutlined } from "@ant-design/icons";
import { providerIcon } from "../../lib/llm-providers";

export function ProviderIcon({ id, size = 16 }: { id: string; size?: number }) {
  const icon = providerIcon(id);
  if (icon === null) {
    // 自定义 provider（models.json）：通用图标 + 无品牌语义
    return <ApiOutlined className="text-muted-foreground" aria-hidden="true" />;
  }
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={icon.color ? undefined : "currentColor"}
      className={icon.color ? undefined : "text-muted-foreground"}
    >
      <use href={`/provider-icons.svg#${icon.symbol}`} />
    </svg>
  );
}
