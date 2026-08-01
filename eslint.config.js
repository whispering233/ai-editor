// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/client-dist/**"],
  },
  tseslint.configs.recommended,
);
