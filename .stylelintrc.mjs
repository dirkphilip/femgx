export default {
  extends: ["stylelint-config-recommended"],
  ignoreFiles: ["dist/**", "dist-demo/**", "coverage/**", "node_modules/**"],
  rules: {
    // `clip` remains a compatibility fallback alongside clip-path for hidden
    // content in the workbench; selector ordering follows the component state
    // classes and is intentionally not a specificity policy.
    "property-no-deprecated": [true, { ignoreProperties: ["clip"] }],
    "no-descending-specificity": null,
  },
  overrides: [{ files: ["**/*.svelte"], customSyntax: "postcss-html" }],
};
