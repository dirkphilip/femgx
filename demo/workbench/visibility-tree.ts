import type { Assembly } from "../../src/index";

/** The display name of a registered assembly, when it carries one. */
export function assemblyName(assembly: Assembly | undefined): string | undefined {
  if (assembly === undefined) {
    return undefined;
  }
  return (assembly as { readonly name?: string }).name;
}
