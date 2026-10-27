import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "coverage/**"] },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ["**/*.ts"] })),
];
