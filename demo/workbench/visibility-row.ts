/** Creates the semantic checkbox/label content shared by tree row kinds. */
export function visibilityRowLabel(
  kind: "part" | "assembly-occurrence" | "instance",
  id: string | number,
  name: string,
  badgeText?: "Part",
  testId = id,
): HTMLLabelElement {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  if (kind === "part") {
    input.dataset["partId"] = String(id);
    input.dataset["testid"] = `part-vis-${id}`;
  } else if (kind === "assembly-occurrence") {
    input.dataset["assemblyOccurrenceId"] = String(id);
    input.dataset["testid"] = `assembly-occurrence-vis-${testId}`;
  } else {
    input.dataset["instanceId"] = String(id);
    input.dataset["testid"] = `instance-vis-${testId}`;
  }
  label.append(input);
  const badge = document.createElement("span");
  badge.className = "visibility-kind";
  badge.textContent =
    badgeText ??
    (kind === "part" ? "Part" : kind === "assembly-occurrence" ? "Assembly" : "Instance");
  label.append(badge);
  const text = document.createElement("span");
  text.className = "visibility-label";
  text.textContent = name;
  label.append(text);
  return label;
}
