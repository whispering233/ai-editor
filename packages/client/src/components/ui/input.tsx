import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({ className, type, autoComplete = "off", ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      // 2026-08 用户反馈：禁浏览器表单历史建议（autoComplete="off"）——输入提示完全由
      // datalist 候选/代码控制，避免 Chrome 历史值幽灵提示（如「龙隐洞天」）；
      // 显式传入 autoComplete 可覆盖（本应用无登录/地址等需浏览器填充的场景）
      autoComplete={autoComplete}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
