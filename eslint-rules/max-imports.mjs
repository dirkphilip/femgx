const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Limit static module dependencies as a composition smell",
    },
    schema: [{ type: "integer", minimum: 1 }],
    messages: {
      limit: "Module declares {{count}} imports (maximum {{max}}).",
    },
  },
  create(context) {
    const max = context.options[0] ?? 20;
    return {
      "Program:exit"(node) {
        const count = node.body.filter(
          (statement) => statement.type === "ImportDeclaration",
        ).length;
        if (count <= max) return;
        context.report({ node, messageId: "limit", data: { count, max } });
      },
    };
  },
};

export default rule;
