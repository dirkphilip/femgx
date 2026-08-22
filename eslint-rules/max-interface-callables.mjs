import { memberName } from "./member-name.mjs";

function isFunctionProperty(member) {
  const annotation = member.typeAnnotation?.typeAnnotation;
  return annotation?.type === "TSFunctionType" || annotation?.type === "TSConstructorType";
}

function callableMember(member) {
  return (
    member.type === "TSMethodSignature" ||
    member.type === "TSCallSignatureDeclaration" ||
    member.type === "TSConstructSignatureDeclaration" ||
    (member.type === "TSPropertySignature" && isFunctionProperty(member))
  );
}

function countCallableMembers(declarations, sourceCode) {
  const names = new Set();
  for (const declaration of declarations) {
    for (const member of declaration.body.body) {
      if (!callableMember(member)) continue;
      const signatureKind =
        member.type === "TSCallSignatureDeclaration"
          ? "call-signature"
          : member.type === "TSConstructSignatureDeclaration"
            ? "construct-signature"
            : "member";
      const key =
        signatureKind === "member" ? memberName(member, sourceCode, signatureKind) : signatureKind;
      names.add(`${signatureKind}:${key}`);
    }
  }
  return names.size;
}

function interfaceScope(node, sourceCode) {
  return sourceCode
    .getAncestors(node)
    .filter((ancestor) => ancestor.type === "TSModuleDeclaration")
    .map((ancestor) => moduleName(ancestor, sourceCode))
    .join(".");
}

function moduleName(node, sourceCode) {
  const id = node.id;
  if (id.type === "Identifier") return id.name;
  if (id.type === "Literal") return String(id.value);
  return sourceCode.getText(id);
}

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Limit the callable surface of a TypeScript interface",
    },
    schema: [{ type: "integer", minimum: 1 }],
    messages: {
      limit: 'Interface "{{name}}" exposes {{count}} callable members (maximum {{max}}).',
    },
  },
  create(context) {
    const max = context.options[0] ?? 15;
    const declarations = new Map();
    return {
      TSInterfaceDeclaration(node) {
        const name = node.id.name;
        const key = `${interfaceScope(node, context.sourceCode)}:${name}`;
        const matching = declarations.get(key) ?? [];
        matching.push(node);
        declarations.set(key, matching);
      },
      "Program:exit"() {
        for (const matching of declarations.values()) {
          const count = countCallableMembers(matching, context.sourceCode);
          if (count <= max) continue;
          context.report({
            node: matching[0],
            messageId: "limit",
            data: { name: matching[0].id.name, count, max },
          });
        }
      },
    };
  },
};

export default rule;
