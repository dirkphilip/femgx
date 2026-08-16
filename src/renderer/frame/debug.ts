/** Uses capture debug groups when the host's pass implementation supports them. */
export function pushDebugGroup(pass: GPURenderPassEncoder, label: string): void {
  const push = Reflect.get(pass, "pushDebugGroup");
  if (typeof push === "function") Reflect.apply(push, pass, [label]);
}

/** Closes a capture debug group when the host's pass implementation supports it. */
export function popDebugGroup(pass: GPURenderPassEncoder): void {
  const pop = Reflect.get(pass, "popDebugGroup");
  if (typeof pop === "function") Reflect.apply(pop, pass, []);
}
