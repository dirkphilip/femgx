import type { AssemblyDefinition } from "@/entries/root";

/** The display name of a registered assembly, when it carries one. */
export function assemblyName(assembly: AssemblyDefinition | undefined): string | undefined {
  if (assembly === undefined) {
    return undefined;
  }
  return "name" in assembly && typeof assembly.name === "string" ? assembly.name : undefined;
}
