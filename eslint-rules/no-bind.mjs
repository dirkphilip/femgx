const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow Function.prototype.bind in composition code",
    },
    schema: [],
    messages: {
      bind: "Do not bind methods into an owner-shaped surface; expose the owning collaborator or a cohesive command directly.",
    },
  },
  create(context) {
    return {
      "CallExpression[callee.type='MemberExpression'][callee.property.name='bind']"(node) {
        context.report({ node, messageId: "bind" });
      },
    };
  },
};

export default rule;
