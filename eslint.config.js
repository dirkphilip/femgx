import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

export default tseslint.config(
  {
    // Ignore generated, dependency, cache, and local-state paths explicitly so
    // repository-owned hidden modules still receive the JavaScript rules below.
    ignores: [
      "dist",
      "dist-demo",
      "coverage",
      "node_modules",
      ".cache",
      ".vite",
      "playwright-report",
      "test-results",
      ".supervisor/run",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...svelte.configs["flat/recommended"],
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
      "@typescript-eslint/switch-exhaustiveness-check": "error",
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
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { project: false, projectService: false },
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
      },
    },
    rules: {
      // Svelte event attributes intentionally consume void-returning handlers;
      // the shorthand restriction adds markup noise without a type-safety gain.
      "@typescript-eslint/no-confusing-void-expression": "off",
      "jsdoc/require-jsdoc": "off",
      "svelte/button-has-type": "error",
      "svelte/no-conflicting-module-names": "error",
      "svelte/no-ignored-unsubscribe": "error",
      "svelte/no-target-blank": "error",
      "svelte/valid-compile": "error",
      "svelte/valid-style-parse": "error",
    },
  },
  {
    files: ["src/**/*.ts", "demo/**/*.{ts,svelte}"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "as",
          objectLiteralTypeAssertions: "never",
          arrayLiteralTypeAssertions: "never",
        },
      ],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      // 300 lines is a design-review threshold; 400 is the hard ceiling so
      // cohesive orchestration modules are not split solely to satisfy lint.
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["demo/workbench/**/*.ts"],
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
);
