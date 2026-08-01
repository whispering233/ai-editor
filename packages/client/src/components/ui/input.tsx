// 基础 Input（shadcn/ui 风格，手动实现）
import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500",
        className,
      )}
      {...props}
    />
  );
}
