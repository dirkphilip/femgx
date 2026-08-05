import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "node_modules", ".supervisor"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  jsdoc.configs["flat/recommended-typescript-flavor"],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-confusing-void-expression": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, ClassDeclaration: true },
        },
      ],
      "jsdoc/check-types": "error",
      "jsdoc/no-defaults": "error",
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "max-depth": ["error", 4],
      "max-params": ["error", 5],
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["src/index.ts"],
    rules: {
      // The public API barrel is an aggregation of re-exports, not an
      // implementation module; exempt it from the per-file size cap.
      "max-lines": "off",
    },
  },
);
