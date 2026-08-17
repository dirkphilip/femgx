import { readFile, readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";

const root = process.cwd();
const markdownFiles = await collectMarkdownFiles(root);
const headings = new Map();
const aliases = new Map();
const errors = [];

for (const file of markdownFiles) {
  const source = stripCode(sourceFor(await readFile(file, "utf8")));
  headings.set(file, headingSlugs(source));
  for (const match of source.matchAll(/^\[#([^\]|]+)\|[^\]]+\]:\s*(\S+)/gm)) {
    const [aliasPath, aliasFragment] = splitTarget(match[2]);
    aliases.set(
      match[1],
      `${resolve(dirname(file), aliasPath)}${aliasFragment === undefined ? "" : `#${aliasFragment}`}`,
    );
  }
}

for (const file of markdownFiles) {
  const source = stripCode(sourceFor(await readFile(file, "utf8")));
  checkFoamLinks(file, source);
  checkMarkdownLinks(file, source);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${markdownFiles.length} Markdown files and their local links.`);
}

async function collectMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdownFiles(path)));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(path);
  }
  return files;
}

function sourceFor(source) {
  let fenced = false;
  return source
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    })
    .join("\n");
}

function stripCode(source) {
  return source.replace(/`[^`]*`/g, "");
}

function headingSlugs(source) {
  const slugs = new Set();
  for (const line of source.split("\n")) {
    const match = /^(#{1,6})[ \t]+(\S.*)$/.exec(line);
    if (match === null) continue;
    const base = slugify(match[2].trim().replace(/\s+#+$/u, ""));
    let slug = base;
    let suffix = 1;
    while (slugs.has(slug)) slug = `${base}-${suffix++}`;
    slugs.add(slug);
  }
  return slugs;
}

function checkFoamLinks(file, source) {
  for (const match of source.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const target = match[1].trim();
    const [pathPart, fragment] = splitTarget(target);
    const aliasTarget = pathPart === "" ? aliases.get(fragment) : undefined;
    const [aliasPath, aliasFragment] =
      aliasTarget === undefined ? [undefined, undefined] : splitTarget(aliasTarget);
    const resolvedPath = aliasPath === undefined ? undefined : resolve(root, aliasPath);
    const destination =
      resolvedPath ??
      (pathPart === ""
        ? file
        : resolve(pathPart.startsWith(".") ? dirname(file) : join(root, "wiki"), `${pathPart}.md`));
    checkDestination(file, target, destination, aliasFragment ?? fragment);
  }
}

function checkMarkdownLinks(file, source) {
  for (const match of source.matchAll(/(?<!!)\[[^\]]*\]\(([^)]*)\)/g)) {
    const target = match[1].trim().split(/\s+/u, 1)[0] ?? "";
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) {
      if (target.startsWith("#")) checkHeading(file, target.slice(1), target);
      continue;
    }
    const [pathPart, fragment] = splitTarget(decodeURIComponent(target));
    const destination = resolve(dirname(file), pathPart);
    checkDestination(file, target, destination, fragment);
  }
}

function splitTarget(target) {
  const separator = target.indexOf("#");
  return separator < 0
    ? [target, undefined]
    : [target.slice(0, separator), target.slice(separator + 1) || undefined];
}

function checkDestination(file, target, destination, fragment) {
  const normalizedDestination = normalize(destination);
  const markdownDestination =
    extname(normalizedDestination) === "" ? `${normalizedDestination}.md` : normalizedDestination;
  const resolvedDestination = existsSync(normalizedDestination)
    ? normalizedDestination
    : markdownDestination;
  if (!existsSync(resolvedDestination)) {
    errors.push(`${relative(root, file)}: missing local link ${target}`);
    return;
  }
  if (fragment !== undefined && !statSync(resolvedDestination).isDirectory()) {
    checkHeading(resolvedDestination, fragment, target);
  }
}

function checkHeading(file, fragment, target) {
  const slugs = headings.get(file);
  if (slugs !== undefined && !slugs.has(slugify(fragment))) {
    errors.push(`${relative(root, file)}: missing heading #${fragment} (${target})`);
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-");
}
