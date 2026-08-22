import { RuleTester, type Rule } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
// @ts-expect-error -- The local runtime plugin intentionally has no published type package.
import untypedComposition from "../../eslint-rules/index.mjs";

interface CompositionPlugin {
  readonly rules: {
    readonly "max-class-callables": Rule.RuleModule;
    readonly "max-imports": Rule.RuleModule;
    readonly "max-interface-callables": Rule.RuleModule;
    readonly "no-bind": Rule.RuleModule;
  };
}

const composition = untypedComposition as unknown as CompositionPlugin;

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  },
});

const methods = (count: number, visibility = "", prefix = "method"): string =>
  Array.from({ length: count }, (_, index) => `${visibility} ${prefix}${index}(): void {}`).join(
    "\n",
  );

const signatures = (count: number, prefix = "method"): string =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}(): void;`).join("\n");

describe("composition ESLint rules", () => {
  tester.run("max-class-callables", composition.rules["max-class-callables"], {
    valid: [
      {
        code: `class Focused {
          ${methods(18)}
          run(value: string): void;
          run(value: number): void;
          run(value: string | number): void {}
          private helper(): void {}
          get ready(): boolean { return true; }
          set ready(value: boolean) { void value; }
          data = 1;
        }`,
      },
    ],
    invalid: [
      {
        code: `class PublicGod { ${methods(20)} callback: () => void; }`,
        errors: [{ messageId: "publicLimit", data: { name: "PublicGod", count: 21, max: 20 } }],
      },
      {
        code: `const PublicGod = class { ${methods(21)} };`,
        errors: [{ messageId: "publicLimit", data: { name: "<anonymous>", count: 21, max: 20 } }],
      },
      {
        code: `class HiddenGod { ${methods(19)} ${methods(7, "private", "helper")} }`,
        errors: [{ messageId: "totalLimit", data: { name: "HiddenGod", count: 26, max: 25 } }],
      },
    ],
  });

  tester.run("max-interface-callables", composition.rules["max-interface-callables"], {
    valid: [
      {
        code: `interface FocusedPort {
          ${signatures(13)}
          callback: () => void;
          get ready(): boolean;
          set ready(value: boolean);
          data: string;
        }`,
      },
      {
        code: `interface OverloadedPort {
          (value: string): void;
          (value: number): void;
          new (value: string): object;
          new (value: number): object;
        }`,
        options: [2],
      },
    ],
    invalid: [
      {
        code: `interface GodPort { ${signatures(15)} callback: () => void; }`,
        errors: [{ messageId: "limit", data: { name: "GodPort", count: 16, max: 15 } }],
      },
      {
        code: `interface SignaturePort {
          (): void;
          call: () => void;
          new (): object;
          construct: () => object;
        }`,
        options: [3],
        errors: [{ messageId: "limit", data: { name: "SignaturePort", count: 4, max: 3 } }],
      },
      {
        code: `interface MergedPort { first(): void; }
          interface MergedPort { second(): void; }`,
        options: [1],
        errors: [{ messageId: "limit", data: { name: "MergedPort", count: 2, max: 1 } }],
      },
    ],
  });

  tester.run(
    "max-interface-callables namespace scopes",
    composition.rules["max-interface-callables"],
    {
      valid: [
        {
          code: `namespace First {
          interface Port { ${signatures(15, "first")} }
        }
        namespace Second {
          interface Port { ${signatures(15, "second")} }
        }`,
        },
      ],
      invalid: [
        {
          code: `namespace First {
            interface Port { ${signatures(16, "first")} }
          }`,
          errors: [{ messageId: "limit", data: { name: "Port", count: 16, max: 15 } }],
        },
      ],
    },
  );

  tester.run("max-imports", composition.rules["max-imports"], {
    valid: [{ code: 'import "one"; import "two";', options: [2] }],
    invalid: [
      {
        code: 'import "one"; import "two"; import "three";',
        options: [2],
        errors: [{ messageId: "limit", data: { count: 3, max: 2 } }],
      },
    ],
  });

  tester.run("no-bind", composition.rules["no-bind"], {
    valid: [{ code: "const command = () => owner.render();" }],
    invalid: [
      {
        code: "const command = owner.render.bind(owner);",
        errors: [{ messageId: "bind" }],
      },
    ],
  });
});
