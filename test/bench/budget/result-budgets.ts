import { partResultBindings } from "@/renderer/resources/result-binding-layout";
import type { BudgetCase } from "./types";

const OCCURRENCE_COUNT = 50_000;
const OVERRIDE_STRIDE = 100;
const shared = new Float32Array(4);
const override = new Float32Array(4);
const source = new Map<number | string, Float32Array>([[1, shared]]);
const instanceSlots = new Map<string, number>();
for (let slot = 0; slot < OCCURRENCE_COUNT; slot += 1) {
  const id = `1/${slot}`;
  instanceSlots.set(id, slot);
  if (slot % OVERRIDE_STRIDE === 0) source.set(id, override);
}
const runtime = {
  sortedPartIds: new Uint32Array([1]),
  getInstanceSlot: (id: string) => instanceSlots.get(id),
  getPartId: () => 1,
} as never;
const layout = {
  slotPartLocal: Int32Array.from({ length: OCCURRENCE_COUNT }, (_, index) => index),
  partLocalSlots: new Map([
    [1, Int32Array.from({ length: OCCURRENCE_COUNT }, (_, index) => index)],
  ]),
};

export const resultBudgets: readonly BudgetCase[] = [
  {
    name: "occurrence result binding",
    description: "50k dense part-local slots with 500 overrides",
    budgetMs: 20,
    run: () => {
      const bindings = partResultBindings(source, runtime, layout);
      if (bindings[0]?.values.length !== OCCURRENCE_COUNT) {
        throw new Error("Occurrence result binding lost dense part-local slots");
      }
    },
  },
];
