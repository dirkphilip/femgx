export default {
  "*.{ts,tsx,mts}": ["eslint --fix --max-warnings 0", "prettier --write"],
  "*.{js,jsx,mjs,cjs,json,jsonc,md,yml,yaml,html,css,scss}": ["prettier --write"],
};
