import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const SOURCE_FILE = /\.ts$/u;
const EXCLUDED_DIRECTORIES = new Set(["node_modules"]);

const MEANINGLESS_PUNCTUATION = new Set([
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  ";",
  ":",
  ",",
  ".",
  "<",
  ">",
]);

function isStructuralChild(node) {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return true;
  if (!ts.isToken(node)) return true;
  const token = ts.tokenToString(node.kind);
  return token !== undefined && !MEANINGLESS_PUNCTUATION.has(token);
}

function childNodesOf(node) {
  const nodes = [];
  for (let index = 0; index < node.getChildCount(); index += 1) {
    const child = node.getChildAt(index);
    if (ts.isSyntaxList(child)) {
      for (let inner = 0; inner < child.getChildCount(); inner += 1) {
        const listChild = child.getChildAt(inner);
        if (isStructuralChild(listChild)) nodes.push(listChild);
      }
      continue;
    }
    if (isStructuralChild(child)) nodes.push(child);
  }
  return nodes;
}

/** Builds a rename-invariant structural fingerprint for executable code AST nodes. */
export function structuralFingerprint(node) {
  if (node === undefined) return "";

  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return "Id";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return `Str:${JSON.stringify(node.text)}`;
  }
  if (ts.isNumericLiteral(node)) return `Num:${node.text}`;
  if (ts.isRegularExpressionLiteral(node)) return "RegExp";

  if (ts.isTemplateExpression(node)) {
    const spans = node.templateSpans.map(
      (span) =>
        `Span[Str:${JSON.stringify(span.literal.text)}|${structuralFingerprint(span.expression)}]`,
    );
    return `Template[Str:${JSON.stringify(node.head.text)}|${spans.join("|")}]`;
  }

  if (ts.isToken(node)) return ts.tokenToString(node.kind) ?? `T${node.kind}`;

  const childParts = childNodesOf(node).map((child) => structuralFingerprint(child));
  return `${ts.SyntaxKind[node.kind]}[${childParts.join("|")}]`;
}

function typeReferenceName(typeName) {
  if (ts.isIdentifier(typeName)) return typeName.text;
  if (ts.isQualifiedName(typeName)) {
    return `${typeReferenceName(typeName.left)}.${typeName.right.text}`;
  }
  return "TypeName";
}

/** Fingerprints a type shape for duplicate-body checks on interfaces and type aliases. */
export function typeShapeFingerprint(node) {
  if (node === undefined) return "";

  if (ts.isPropertySignature(node)) {
    const typePart = node.type === undefined ? "implicit" : typeShapeFingerprint(node.type);
    return `Prop[${typePart}]`;
  }

  if (ts.isMethodSignature(node)) {
    const params = node.parameters
      .map((parameter) => {
        const name = parameter.name.getText();
        const typePart =
          parameter.type === undefined ? "implicit" : typeShapeFingerprint(parameter.type);
        return `Param[${name}:${typePart}]`;
      })
      .join("|");
    const returnPart = node.type === undefined ? "void" : typeShapeFingerprint(node.type);
    return `Method[${params}|${returnPart}]`;
  }

  if (ts.isIndexSignatureDeclaration(node)) {
    const parameter = node.parameters[0];
    const keyPart =
      parameter?.type === undefined ? "implicit" : typeShapeFingerprint(parameter.type);
    const valuePart = node.type === undefined ? "implicit" : typeShapeFingerprint(node.type);
    return `Index[${keyPart}|${valuePart}]`;
  }

  if (ts.isTypeReferenceNode(node)) {
    const args =
      node.typeArguments === undefined
        ? ""
        : node.typeArguments.map((argument) => typeShapeFingerprint(argument)).join("|");
    const name = typeReferenceName(node.typeName);
    return args.length === 0 ? `TypeRef[${name}]` : `TypeRef[${name}|${args}]`;
  }

  if (ts.isArrayTypeNode(node)) {
    return `Array[${typeShapeFingerprint(node.elementType)}]`;
  }

  if (ts.isUnionTypeNode(node)) {
    return node.types.map((type) => typeShapeFingerprint(type)).join("|Union|");
  }

  if (ts.isIntersectionTypeNode(node)) {
    return node.types.map((type) => typeShapeFingerprint(type)).join("|Intersect|");
  }

  if (ts.isLiteralTypeNode(node)) {
    return structuralFingerprint(node.literal);
  }

  if (ts.isTypeLiteralNode(node)) {
    return typeShapeFingerprintMembers(node.members);
  }

  if (ts.isTupleTypeNode(node)) {
    return node.elements.map((element) => typeShapeFingerprint(element)).join("|Tuple|");
  }

  if (ts.isTypeOperatorNode(node)) {
    return `TypeOp[${ts.tokenToString(node.operator)}|${typeShapeFingerprint(node.type)}]`;
  }

  if (ts.isIndexedAccessTypeNode(node)) {
    return `Indexed[${typeShapeFingerprint(node.objectType)}|${typeShapeFingerprint(node.indexType)}]`;
  }

  if (ts.isFunctionTypeNode(node)) {
    const params = node.parameters
      .map((parameter) => {
        const typePart =
          parameter.type === undefined ? "implicit" : typeShapeFingerprint(parameter.type);
        return `Param[${typePart}]`;
      })
      .join("|");
    const returnPart = typeShapeFingerprint(node.type);
    return `FnType[${params}|${returnPart}]`;
  }

  if (ts.isOptionalTypeNode(node)) {
    return `Optional[${typeShapeFingerprint(node.type)}]`;
  }

  if (ts.isParenthesizedTypeNode(node)) {
    return typeShapeFingerprint(node.type);
  }

  if (ts.isRestTypeNode(node)) {
    return `Rest[${typeShapeFingerprint(node.type)}]`;
  }

  const childParts = childNodesOf(node).map((child) => typeShapeFingerprint(child));
  return `${ts.SyntaxKind[node.kind]}[${childParts.join("|")}]`;
}

/** Fingerprints interface or type-literal members in source order. */
export function typeShapeFingerprintMembers(members) {
  const parts = [];
  for (let index = 0; index < members.length; index += 1) {
    parts.push(typeShapeFingerprint(members[index]));
  }
  return parts.join("|");
}

/** Fingerprints a consecutive statement or member list as one fragment. */
export function fingerprintNodes(nodes) {
  return nodes.map((node) => structuralFingerprint(node)).join("||");
}

/** Shortens a structural fingerprint to a stable identifier. */
export function digestFingerprint(fingerprint) {
  return createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
}

/** Parses a source file into a TypeScript AST for fingerprinting. */
export function parseSourceFile(sourcePath) {
  return ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

/** Walks a directory tree and returns every fingerprintable source file. */
export function collectSourceFiles(directory, sourceFiles = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(path, sourceFiles);
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
      sourceFiles.push(path);
    }
  }
  return sourceFiles;
}

/** Resolves the 1-based source line span covered by a statement window. */
export function lineSpan(sourceFile, startNode, endNode) {
  const start = sourceFile.getLineAndCharacterOfPosition(startNode.getStart(sourceFile)).line + 1;
  const end = sourceFile.getLineAndCharacterOfPosition(endNode.getEnd()).line + 1;
  return { startLine: start, endLine: end, lineCount: end - start + 1 };
}

/** Default scan root (`src/`) for CLIs in this folder. */
export function defaultScanRoot(importMetaDirname) {
  return join(importMetaDirname, "..", "..", "src");
}
