import ts from "typescript";
import path from "node:path";

const sourceExtensions = [".ts", ".tsx", "/index.ts", "/index.tsx"];
const isTest = file => /\.(?:test|spec)\.tsx?$/.test(file);

/** Inspect source syntax instead of matching import text in comments or strings. */
export function analyzeArchitecture(sources) {
  const files = new Map([...sources].map(([file, text]) => [path.posix.normalize(file), text]));
  const graph = new Map();
  const violations = [];
  for (const [file, text] of files) {
    if (isTest(file)) continue;
    const dependencies = [];
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function inspect(node) {
      let specifier;
      let runtime = true;
      if (ts.isImportDeclaration(node)) {
        specifier = node.moduleSpecifier;
        const clause = node.importClause;
        runtime = !clause?.isTypeOnly;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.name) {
          runtime &&= clause.namedBindings.elements.length === 0 || clause.namedBindings.elements.some(element => !element.isTypeOnly);
        }
      } else if (ts.isExportDeclaration(node)) {
        specifier = node.moduleSpecifier;
        runtime = !node.isTypeOnly;
        if (node.exportClause && ts.isNamedExports(node.exportClause)) runtime &&= node.exportClause.elements.length === 0 || node.exportClause.elements.some(element => !element.isTypeOnly);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        specifier = node.argument.literal;
        runtime = false;
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        specifier = node.arguments[0];
        runtime = false; // Lazy editor composition is a boundary, not an eager module cycle.
      }
      if (specifier && ts.isStringLiteral(specifier)) {
        const name = specifier.text;
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
        const target = name.startsWith(".") ? [base, ...sourceExtensions.map(extension => base + extension)].find(candidate => files.has(candidate)) : undefined;
        if (target) {
          if (file.startsWith("shared/") && !target.startsWith("shared/")) violations.push(`${file}: shared code imports ${target}`);
          if (file.startsWith("features/") && target.startsWith("app/")) violations.push(`${file}: feature code imports application composition ${target}`);
          if (file.startsWith("features/content/model/") && target.startsWith("features/content/") && !target.startsWith("features/content/model/")) violations.push(`${file}: content model imports format composition ${target}`);
          if (isTest(target)) violations.push(`${file}: production code imports test ${target}`);
          if (runtime) dependencies.push(target);
        }
        if (file.startsWith("features/content/model/") && (name === "react" || name === "react-dom" || name.startsWith("@tiptap/") || name === "konva")) {
          violations.push(`${file}: content contracts import renderer ${name}`);
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
    graph.set(file, dependencies);
  }
  const visited = new Set();
  const active = new Set();
  const stack = [];
  function visit(file) {
    if (active.has(file)) { violations.push(`Static dependency cycle: ${[...stack.slice(stack.indexOf(file)), file].join(" -> ")}`); return; }
    if (visited.has(file)) return;
    visited.add(file);
    active.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    stack.pop();
    active.delete(file);
  }
  for (const file of graph.keys()) visit(file);
  return { files: graph.size, violations };
}
