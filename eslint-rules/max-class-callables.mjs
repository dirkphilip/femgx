import { memberName } from "./member-name.mjs";

function isCallableProperty(member) {
  const annotation = member.typeAnnotation?.typeAnnotation;
  return (
    member.type === "PropertyDefinition" &&
    (member.value?.type === "ArrowFunctionExpression" ||
      member.value?.type === "FunctionExpression" ||
      annotation?.type === "TSFunctionType")
  );
}

function isCallable(member) {
  if (member.kind === "constructor") return false;
  return member.type === "MethodDefinition" || isCallableProperty(member);
}

function callableMembers(node, sourceCode, publicOnly) {
  const names = new Set();
  for (const member of node.body.body) {
    if (!isCallable(member)) continue;
    if (
      publicOnly &&
      (member.accessibility === "private" ||
        member.accessibility === "protected" ||
        member.key?.type === "PrivateIdentifier")
    ) {
      continue;
    }
    const scope = member.static ? "static" : "instance";
    names.add(`${scope}:${memberName(member, sourceCode, "class-member")}`);
  }
  return names.size;
}

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Limit public and total callable behavior declared by one class",
    },
    schema: [
      {
        type: "object",
        properties: {
          maxPublic: { type: "integer", minimum: 1 },
          maxTotal: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      publicLimit: 'Class "{{name}}" declares {{count}} public callable members (maximum {{max}}).',
      totalLimit: 'Class "{{name}}" declares {{count}} callable members (maximum {{max}}).',
    },
  },
  create(context) {
    const options = { maxPublic: 20, maxTotal: 25, ...(context.options[0] ?? {}) };
    const sourceCode = context.sourceCode;
    const checkClass = (node) => {
      const name = node.id?.name ?? "<anonymous>";
      const publicCount = callableMembers(node, sourceCode, true);
      const totalCount = callableMembers(node, sourceCode, false);
      if (publicCount > options.maxPublic) {
        context.report({
          node,
          messageId: "publicLimit",
          data: { name, count: publicCount, max: options.maxPublic },
        });
      }
      if (totalCount > options.maxTotal) {
        context.report({
          node,
          messageId: "totalLimit",
          data: { name, count: totalCount, max: options.maxTotal },
        });
      }
    };
    return {
      ClassDeclaration: checkClass,
      ClassExpression: checkClass,
    };
  },
};

export default rule;
