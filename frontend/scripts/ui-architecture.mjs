import ts from "typescript";
import path from "node:path";

const geometryTokens = new Set(["var(--available-width)", "var(--available-height)", "var(--anchor-width)", "var(--anchor-height)", "var(--transform-origin)"]);

export const isProduction = file => !/(?:\.(?:test|spec|stories)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|tests)\/)/.test(file);

export function analyzeUI(sources, exports) {
  const findings = [];
  const consumers = new Set();
  const add = (file, rule, detail) => findings.push({ file, rule, detail });
  for (const [file, text] of sources) {
    if (!isProduction(file)) continue;
    const inPackage = file.startsWith("packages/ui/src/");
    if (/packages\/ui\/src\/index\.tsx?$/.test(file)) add(file, "root-barrel", "Use public component subpaths");
    if (file.endsWith(".css")) {
      const stylesheet = text.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of stylesheet.matchAll(/@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)|"([^"]+)"|'([^']+)')/g)) {
        const name = match.slice(1).find(Boolean);
        if (name.startsWith("@heroui/")) add(file, "legacy-heroui", name);
      }
      if (!["packages/ui/src/styles/tokens.css", "src/styles/brand-tokens.css"].includes(file)) {
        for (const match of text.matchAll(/#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\([^)]*\)/gi)) add(file, "raw-color", match[0]);
      }
      if (inPackage) for (const match of text.matchAll(/var\(--(?!ob-)[\w-]+\)/g)) if (!geometryTokens.has(match[0])) add(file, "foreign-token", match[0]);
      continue;
    }
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function inspect(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier)) {
        const name = specifier.text;
        const resolved = name.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) : name.startsWith("@/") ? `src/${name.slice(2)}` : name;
        if (name.startsWith("@heroui/")) add(file, "legacy-heroui", name);
        if (/^(?:@radix-ui\/|radix-ui(?:\/|$)|sonner(?:\/|$)|cmdk(?:\/|$))/.test(name)) add(file, "foreign-primitive", name);
        if (name === "react-colorful" && file !== "packages/ui/src/color-picker/index.tsx") add(file, "primitive-boundary", name);
        if (name.startsWith("@base-ui/") && !/^packages\/ui\/src\/[^/]+\/index\.tsx$/.test(file)) add(file, "primitive-boundary", name);
        if (name === "lucide-react" && !["src/shared/ui/icons.tsx", "packages/ui/src/icons/index.tsx"].includes(file)) add(file, "icon-boundary", name);
        if (inPackage && (/^(?:src\/|@\/|react-router|@tanstack\/react-query|zustand)/.test(resolved))) add(file, "package-boundary", name);
        if (!inPackage && (resolved.startsWith("packages/ui/") || name.startsWith("@orbis-ui-src/"))) add(file, "private-import", name);
        if (name === "@orbis/ui" || name.startsWith("@orbis/ui/")) {
          const subpath = `.${name.slice("@orbis/ui".length)}`;
          if (!Object.hasOwn(exports, subpath)) add(file, "private-import", name);
          else consumers.add(subpath);
        }
        if (name.endsWith(".css")) add(file, "css-import", name);
      }
      if (inPackage && ts.isExportDeclaration(node) && !node.exportClause) add(file, "wildcard-export", node.getText(source));
      ts.forEachChild(node, inspect);
    }
    inspect(source);
    for (const match of text.matchAll(/#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\([^)]*\)/gi)) add(file, "raw-color", match[0]);
    if (inPackage) for (const match of text.matchAll(/var\(--(?!ob-)[\w-]+\)/g)) if (!geometryTokens.has(match[0])) add(file, "foreign-token", match[0]);
  }
  if (Object.hasOwn(exports, ".")) add("packages/ui/package.json", "root-barrel", ".");
  for (const file of sources.keys()) {
    const component = /^packages\/ui\/src\/([^/]+)\/index\.tsx$/.exec(file)?.[1];
    if (!component) continue;
    if (exports[`./${component}`] !== `./src/${component}/index.tsx`) add(file, "missing-export", component);
    if (!sources.has(`packages/ui/src/${component}/index.stories.tsx`)) add(file, "missing-story", component);
    if (!consumers.has(`./${component}`)) add(file, "unused-component", component);
  }
  for (const [name, target] of Object.entries(exports)) {
    if (!sources.has(`packages/ui/${target.replace(/^\.\//, "")}`)) add("packages/ui/package.json", "missing-target", name);
  }
  return findings;
}

export function findingCounts(findings) {
  const counts = {};
  for (const finding of findings) {
    const key = JSON.stringify([finding.file, finding.rule, finding.detail]);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function newFindings(findings, baseline) {
  return Object.entries(findingCounts(findings)).flatMap(([key, count]) => count > (baseline[key] ?? 0) ? [`${key}: ${count} occurrences (allowed ${baseline[key] ?? 0})`] : []);
}

export function applyColorDataAllowlist(findings, entries) {
  const remaining = new Map(entries.map(entry => {
    if (!entry.reason || !Number.isInteger(entry.maxOccurrences) || entry.maxOccurrences < 1) throw new Error(`Invalid color-data allowlist entry: ${entry.file}`);
    return [JSON.stringify([entry.file, entry.detail]), entry.maxOccurrences];
  }));
  return findings.filter(finding => {
    if (finding.rule !== "raw-color") return true;
    const key = JSON.stringify([finding.file, finding.detail]);
    const allowed = remaining.get(key) ?? 0;
    if (!allowed) return true;
    remaining.set(key, allowed - 1);
    return false;
  });
}

export function applyDomainStylesAllowlist(findings, entries, sources) {
  const scopeFindings = [];
  const remaining = new Map(entries.map(entry => {
    if (!entry.reason || !/^\.[\w-]+$/.test(entry.scope ?? "") || (entry.contentScope !== undefined && !/^\.[\w-]+$/.test(entry.contentScope)) || !entry.detail.endsWith(".css") || !Number.isInteger(entry.maxOccurrences) || entry.maxOccurrences < 1) throw new Error(`Invalid domain stylesheet entry: ${entry.file}`);
    const file = path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), entry.detail));
    const stylesheet = sources.get(file);
    if (stylesheet === undefined) throw new Error(`Domain stylesheet is missing: ${file}`);
    const boundary = new RegExp(`^\\${entry.scope}(?=$|[\\s:.>#\\[])`);
    const contentBoundary = entry.contentScope ? new RegExp(`^\\${entry.scope}\\s+\\${entry.contentScope}(?=$|[\\s:.>#\\[])`) : undefined;
    const normalized = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of normalized.matchAll(/([^{}]+)\{/g)) {
      const rule = match[1].trim();
      if (/^@(?:media|supports)\b/.test(rule)) continue;
      for (const selector of rule.split(",")) {
        const scoped = selector.trim().replace(`:where(${entry.scope})`, entry.scope);
        if (!boundary.test(scoped) || (contentBoundary && !contentBoundary.test(scoped))) scopeFindings.push({ file, rule: "domain-style-scope", detail: selector.trim() });
      }
    }
    if (entry.variablesOnly) for (const body of normalized.matchAll(/\{([^{}]*)\}/g)) {
      for (const declaration of body[1].split(";").map(item => item.trim()).filter(Boolean)) if (!declaration.startsWith("--")) scopeFindings.push({ file, rule: "domain-theme-property", detail: declaration.split(":")[0] });
    }
    return [JSON.stringify([entry.file, entry.detail]), entry.maxOccurrences];
  }));
  return [...findings.filter(finding => {
    if (finding.rule !== "css-import") return true;
    const key = JSON.stringify([finding.file, finding.detail]);
    const allowed = remaining.get(key) ?? 0;
    if (!allowed) return true;
    remaining.set(key, allowed - 1);
    return false;
  }), ...scopeFindings];
}
