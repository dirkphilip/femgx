/** Returns a stable key for a class or interface member. */
export function memberName(member, sourceCode, fallback) {
  const key = member.key;
  if (key?.type === "Identifier" || key?.type === "PrivateIdentifier") return key.name;
  if (key?.type === "Literal") return String(key.value);
  return `${fallback}:${sourceCode.getText(key ?? member)}`;
}
