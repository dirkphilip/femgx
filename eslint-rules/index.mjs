import maxClassCallables from "./max-class-callables.mjs";
import maxImports from "./max-imports.mjs";
import maxInterfaceCallables from "./max-interface-callables.mjs";
import noBind from "./no-bind.mjs";

export default {
  rules: {
    "max-class-callables": maxClassCallables,
    "max-imports": maxImports,
    "max-interface-callables": maxInterfaceCallables,
    "no-bind": noBind,
  },
};
