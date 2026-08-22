import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";
import regexp from "eslint-plugin-regexp";
import angularTemplate from "@angular-eslint/eslint-plugin-template";
import angularTemplateParser from "@angular-eslint/template-parser";
import composition from "./eslint-rules/index.mjs";

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
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...svelte.configs["flat/recommended"],
  regexp.configs["flat/recommended"],
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
      // Keep the regexp preset focused on correctness and accidental pattern
      // behavior; the style/optimization rules are too noisy for scripts.
      "regexp/no-dupe-characters-character-class": "off",
      "regexp/prefer-w": "off",
      "regexp/no-contradiction-with-assertion": "off",
      "regexp/no-useless-non-capturing-group": "off",
      "regexp/optimal-quantifier-concatenation": "off",
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
    files: ["angular/main.js"],
    languageOptions: {
      globals: { document: "readonly", HTMLElement: "readonly" },
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
    files: ["**/*.{ts,tsx,svelte}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?:\\.\\./){3,}src/",
              message:
                "Use the @/ source-root alias for imports that cross three or more directories into src.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["demo/workbench/**/*.{ts,svelte}"],
    rules: {
      // The workbench presentation has the same readability ceiling as library
      // modules. Svelte panels split by visible responsibility, not markup size.
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      // Slot state must have an explicit owner. The sole documented legacy
      // adapter suppresses this locally until its ownership refactor lands.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Object'][callee.property.name=/^definePropert(?:y|ies)$/]",
          message:
            "Do not install workbench state properties dynamically; give the owning state object an explicit surface instead.",
        },
        {
          selector:
            "CallExpression[callee.object.name='Reflect'][callee.property.name='defineProperty']",
          message:
            "Do not install workbench state properties dynamically; give the owning state object an explicit surface instead.",
        },
      ],
    },
  },
  {
    files: ["demo/angular/src/**/*.ts"],
    plugins: { composition },
    rules: {
      "composition/max-class-callables": "error",
      "composition/max-interface-callables": "error",
      "composition/max-imports": "error",
      "composition/no-bind": "error",
      "@typescript-eslint/no-extraneous-class": "off",
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Object'][callee.property.name=/^definePropert(?:y|ies)$/]",
          message:
            "Do not install Angular state properties dynamically; give the owning object an explicit surface instead.",
        },
        {
          selector:
            "CallExpression[callee.object.name='Reflect'][callee.property.name='defineProperty']",
          message:
            "Do not install Angular state properties dynamically; give the owning object an explicit surface instead.",
        },
        {
          selector: "CallExpression[callee.object.name='Object'][callee.property.name='assign']",
          message:
            "Do not merge Angular owner surfaces dynamically; compose an explicit owner instead.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@/",
              message: "Angular code must consume published package entries, not source aliases.",
            },
            {
              regex: "^(?:\\.\\.?/)+src/",
              message: "Angular code must not import library source internals.",
            },
            {
              regex: "^(?:\\.\\.?/)+demo/(?:workbench|devtools|benchmark)/",
              message: "Angular code must not depend on the legacy demo graph or tooling.",
            },
            {
              regex: "^(?:\\.\\.?/)+(?:test|e2e)/",
              message: "Angular production code must not import test or e2e helpers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.component.html"],
    languageOptions: {
      parser: angularTemplateParser,
      parserOptions: { project: false, projectService: false },
    },
    plugins: { "@angular-eslint/template": angularTemplate },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      ...Object.fromEntries(
        Object.keys(jsdoc.configs["flat/recommended-typescript-flavor"].rules).map((rule) => [
          rule,
          "off",
        ]),
      ),
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/consistent-type-exports": "off",
      "@angular-eslint/template/alt-text": "error",
      "@angular-eslint/template/button-has-type": "error",
      "@angular-eslint/template/click-events-have-key-events": "error",
      "@angular-eslint/template/elements-content": "error",
      "@angular-eslint/template/interactive-supports-focus": "error",
      "@angular-eslint/template/label-has-associated-control": "error",
      "@angular-eslint/template/mouse-events-have-key-events": "error",
      "@angular-eslint/template/no-autofocus": "error",
      "@angular-eslint/template/no-inline-styles": "error",
      "@angular-eslint/template/role-has-required-aria": "error",
      "@angular-eslint/template/valid-aria": "error",
    },
  },
  {
    files: ["test/**/*.ts", "e2e/**/*.ts"],
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["test/**/*.test.ts", "test/**/*.spec.ts", "e2e/**/*.test.ts", "e2e/**/*.spec.ts"],
    rules: {
      // Suite callbacks describe behavioral contracts; helper functions in
      // support modules remain subject to the short-function ceiling above.
      "max-lines-per-function": "off",
    },
  },
);
