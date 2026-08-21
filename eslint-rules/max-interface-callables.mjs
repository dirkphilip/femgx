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
      const fallback = member.type === "TSCallSignatureDeclaration" ? "call" : "construct";
      names.add(memberName(member, sourceCode, fallback));
    }
  }
  return names.size;
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
        const matching = declarations.get(name) ?? [];
        matching.push(node);
        declarations.set(name, matching);
      },
      "Program:exit"() {
        for (const [name, matching] of declarations) {
          const count = countCallableMembers(matching, context.sourceCode);
          if (count <= max) continue;
          context.report({
            node: matching[0],
            messageId: "limit",
            data: { name, count, max },
          });
        }
      },
    };
  },
};

export default rule;
