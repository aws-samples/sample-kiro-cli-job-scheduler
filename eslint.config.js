const tseslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");

/**
 * ESLint 9 flat config for the monorepo (TypeScript + TSX).
 * Applied to all workspace packages via `eslint <dir>`.
 */
module.exports = [
  {
    ignores: [
      "**/dist/**",
      "**/cdk.out/**",
      "**/.next/**",
      "**/out/**",
      "**/node_modules/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
];
