import ts from "typescript";
import path from "node:path";

const geometryTokens = new Set(["available-width", "available-height", "anchor-width", "anchor-height", "transform-origin"]);
const standardThemeTokens = new Set([
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground",
  "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive",
  "border", "input", "ring", "radius", "radius-sm", "radius-md", "radius-lg", "radius-xl", "radius-2xl", "radius-3xl", "radius-4xl",
  "font-sans", "font-heading", "font-mono", "spacing", "ease-out",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
]);
const applicationRoleTokens = new Set([
  "status-success", "status-success-background", "status-success-foreground", "status-warning", "status-warning-background", "status-warning-foreground",
  "destructive-soft", "shadow-color",
]);
const brandSourceTokens = new Set(["color-green-300", "color-green-400", "color-green-600", "color-green-800", "color-amber-300", "color-amber-400", "color-amber-500", "color-amber-800", "text-xs", "text-sm"]);
const retiredUIPaths = new Set(["Button", "ActionButton", "IconButton", "TextInput", "SelectField", "Tag", "Dialog", "Tooltip"].map(name => `src/shared/ui/${name}`));
const nativeUIComponents = new Set(["button", "input", "textarea", "dialog", "select", "avatar", "badge", "spinner", "skeleton", "dropdown-menu", "popover", "tooltip", "radio-group", "tabs", "checkbox", "toggle", "sheet", "toast"]);
const retiredNativeProps = {
  Button: ["loading", "appearance", "isPending", "isDisabled", "onPress", "icon"],
  Select: ["label", "options", "description", "density", "wrapperClassName", "placeholder"],
  Badge: ["tone"],
  Dialog: ["dismissible", "dismissOnOutsidePress"],
  DialogContent: ["description", "portalContainer", "backdropClassName", "viewportClassName"],
  Tooltip: ["delayMs"],
  Spinner: ["size"],
  Skeleton: ["animationType"],
};

const modulePath = value => value.replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");

function hasOwnedToken(token, text) {
  const name = /^var\(--([\w-]+)/.exec(token)?.[1];
  return name && (geometryTokens.has(name) || standardThemeTokens.has(name) || applicationRoleTokens.has(name) || name.startsWith("toast-") || new RegExp(`--${name}\\s*:`).test(text));
}

function inspectNativeProps(file, source, add) {
  const imports = source.statements.filter(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith("@orbis/ui/") && nativeUIComponents.has(node.moduleSpecifier.text.slice("@orbis/ui/".length)));
  if (!imports.length) return;
  // 只绑定当前文件的导入符号；不解析依赖或分析业务类型，避免误报同名的局部组件。
  const host = { ...ts.createCompilerHost({}), getCurrentDirectory: () => "", getSourceFile: name => name === file ? source : undefined, fileExists: name => name === file, readFile: name => name === file ? source.text : undefined };
  const checker = ts.createProgram([file], { noLib: true, noResolve: true, types: [] }, host).getTypeChecker();
  const bindings = new Map();
  for (const node of imports) {
    const names = node.importClause?.namedBindings;
    if (names && ts.isNamedImports(names)) for (const item of names.elements) bindings.set(checker.getSymbolAtLocation(item.name), item.propertyName?.text ?? item.name.text);
    if (names && ts.isNamespaceImport(names)) bindings.set(checker.getSymbolAtLocation(names.name), "*");
  }
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      const component = ts.isIdentifier(tag) ? bindings.get(checker.getSymbolAtLocation(tag)) : ts.isPropertyAccessExpression(tag) && bindings.get(checker.getSymbolAtLocation(tag.expression)) === "*" ? tag.name.text : undefined;
      if (component && component !== "*") for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(source);
        if (name === "asChild" || retiredNativeProps[component]?.includes(name)) add(file, "retired-native-prop", `${component}.${name}`);
        if (component === "Button" && attribute.initializer && ts.isStringLiteral(attribute.initializer)) {
          const value = attribute.initializer.text;
          if ((name === "variant" && ["primary", "danger"].includes(value)) || (name === "size" && value === "md")) add(file, "retired-native-prop", `Button.${name}=${value}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

export const isProduction = file => !/(?:\.(?:test|spec|stories)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|tests)\/)/.test(file);

export function analyzeUI(sources, exports) {
  const findings = [];
  const consumers = new Set();
  const add = (file, rule, detail) => findings.push({ file, rule, detail });
  for (const [file, text] of sources) {
    if (retiredUIPaths.has(modulePath(file))) add(file, "legacy-ui-definition", modulePath(file));
    if (!isProduction(file)) continue;
    const inPackage = file.startsWith("packages/ui/src/");
    if (/packages\/ui\/src\/index\.tsx?$/.test(file)) add(file, "root-barrel", "Use public component subpaths");
    if (file.endsWith(".css")) {
      const stylesheet = text.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const name of globalCSSImports(stylesheet)) {
        if (name.startsWith("@heroui/")) add(file, "legacy-heroui", name);
        add(file, "css-import", name);
      }
      if (!["packages/ui/src/styles/tokens.css", "src/styles/brand-tokens.css"].includes(file)) {
        for (const match of text.matchAll(/#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\([^)]*\)/gi)) add(file, "raw-color", match[0]);
      }
      if (inPackage) for (const match of text.matchAll(/var\(--(?!ob-)[\w-]+\)?/g)) if (!hasOwnedToken(match[0], text)) add(file, "foreign-token", match[0]);
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
        if (retiredUIPaths.has(modulePath(resolved))) add(file, "legacy-ui-import", name);
        if (name.startsWith("@heroui/")) add(file, "legacy-heroui", name);
        if (/^(?:@radix-ui\/|radix-ui(?:\/|$)|sonner(?:\/|$)|cmdk(?:\/|$))/.test(name)) add(file, "foreign-primitive", name);
        if (name === "react-colorful" && file !== "packages/ui/src/color-picker/index.tsx") add(file, "primitive-boundary", name);
        if (name.startsWith("@base-ui/") && !/^packages\/ui\/src\/[^/]+\/index\.tsx$/.test(file)) add(file, "primitive-boundary", name);
        if (name === "lucide-react" && !inPackage && file !== "src/shared/ui/icons.tsx") add(file, "icon-boundary", name);
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
    inspectNativeProps(file, source, add);
    for (const match of text.matchAll(/#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\([^)]*\)/gi)) add(file, "raw-color", match[0]);
    if (inPackage) for (const match of text.matchAll(/var\(--(?!ob-)[\w-]+\)?/g)) if (!hasOwnedToken(match[0], text)) add(file, "foreign-token", match[0]);
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

function splitCSSSelectors(source) {
  const selectors = [];
  let start = 0, depth = 0, quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") { index += 1; continue; }
    if (quote) { if (character === quote) quote = ""; continue; }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (character === "," && depth === 0) { selectors.push(source.slice(start, index).trim()); start = index + 1; }
  }
  selectors.push(source.slice(start).trim());
  return selectors;
}

const globalStyleFiles = {
  globals: "src/styles/globals.css",
  motion: "src/styles/motion.css",
  scrollbars: "src/styles/scrollbars.css",
  tokens: "src/styles/brand-tokens.css",
};
const globalStyleImports = ["tailwindcss", "@fontsource-variable/inter", "@orbis/ui/styles.css", "./brand-tokens.css", "./motion.css", "./scrollbars.css"];
const packageStyleImports = {
  "packages/ui/src/styles/styles.css": ["./tokens.css", "./utilities.css", "../color-picker/styles.css"],
  "packages/ui/src/styles/tokens.css": ["tw-animate-css", "shadcn/tailwind.css", "@fontsource-variable/geist"],
};
const globalStyleSources = ["../../packages/ui/src", "not ../../packages/ui/src/**/*.stories.tsx", "not ../../packages/ui/src/**/__tests__/**"];
const scrollbarRoot = ":where(html, body, body *)";
const scrollbarNone = ':where([data-scrollbar="none"], [data-scrollbar="none"] *, .scrollbar-none)';
const scrollbarDefault = ':where([data-scrollbar="default"], [data-scrollbar="default"] *, .scrollbar-default)';
const globalStyleRules = {
  globals: [
    ["", [":root"], ["font-family", "font-size"]],
    ["", ["*"], ["box-sizing"]],
    ["", ["body"], ["margin", "min-width", "background", "color", "font-size", "-webkit-font-smoothing", "line-height"]],
    ["", ['[data-slot="toast-viewport"]'], ["z-index"]],
    ["", [":where(button, input, textarea, a[href], [tabindex]):focus-visible"], ["outline", "outline-offset"]],
    ["@media (forced-colors: active)", [":where(button, input, textarea, a[href], [tabindex]):focus-visible"], ["outline-color"]],
    ["", ["::selection"], ["background"]],
    ["@layer base", ["*", "::before", "::after", "::backdrop", "::file-selector-button"], ["border-color"]],
    ["@media (prefers-reduced-motion: reduce)", ["*", "*::before", "*::after"], ["scroll-behavior", "transition-property", "transition-duration", "animation-name", "animation-duration", "animation-iteration-count"]],
    ["@media (pointer: coarse)", [":is(input, textarea):not(.editor-title)"], ["font-size"]],
  ],
  scrollbars: [
    ["", [":root"], ["--ob-scrollbar-size"]],
    ["", [scrollbarRoot], ["--ob-scrollbar-ink", "--ob-scrollbar-thumb", "scrollbar-width", "scrollbar-color"]],
    ["@supports selector(::-webkit-scrollbar)", [scrollbarRoot], ["scrollbar-width", "scrollbar-color"]],
    ["@supports selector(::-webkit-scrollbar)", [`${scrollbarRoot}::-webkit-scrollbar`], ["width", "height"]],
    ["@supports selector(::-webkit-scrollbar)", [`${scrollbarRoot}::-webkit-scrollbar-track`, `${scrollbarRoot}::-webkit-scrollbar-corner`], ["background"]],
    ["@supports selector(::-webkit-scrollbar)", [`${scrollbarRoot}::-webkit-scrollbar-thumb`], ["min-height", "min-width", "border", "border-radius", "background", "background-clip"]],
    ["@supports selector(::-webkit-scrollbar)", [`${scrollbarRoot}::-webkit-scrollbar-thumb:hover`, `${scrollbarRoot}::-webkit-scrollbar-thumb:active`], ["background-color"]],
    ["@supports selector(::-webkit-scrollbar)", [`${scrollbarRoot}::-webkit-scrollbar-button`], ["display", "width", "height"]],
    ["", [scrollbarNone], ["scrollbar-width"]],
    ["", [`${scrollbarNone}::-webkit-scrollbar`], ["display"]],
    ["", [scrollbarDefault], ["scrollbar-width", "scrollbar-color"]],
    ["", ["", "-thumb", "-track", "-button"].map(part => `${scrollbarDefault}::-webkit-scrollbar${part}`), ["all"]],
    ["@media (forced-colors: active)", [scrollbarRoot], ["scrollbar-width", "scrollbar-color"]],
    ["@media (forced-colors: active)", [`${scrollbarRoot}::-webkit-scrollbar-thumb`], ["background-color"]],
    ["", ['html:has(.site-reader[data-theme="light"])', 'html:has(.site-reader[data-theme="dark"])'], ["color-scheme", "background-color"]],
    ["", [':is(html, body):has(.site-reader:is([data-theme="light"], [data-theme="dark"]))'], ["--ob-scrollbar-ink"]],
  ],
};

const normalizeCSSRule = value => value.trim().replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1");
const stripGlobalCSSComments = value => value.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\//g, token => token.startsWith("/*") ? "" : token);

// 只读取本地全局样式使用的块和分号声明；选择器逗号仍由上面的平衡拆分器处理。
function globalCSSBlocks(stylesheet) {
  const root = { header: "", declarations: [], rules: [] };
  const stack = [root];
  let statement = "";
  const tokens = stripGlobalCSSComments(stylesheet).match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^{};"']+/g) ?? [];
  for (const token of tokens) {
    if (token === "{") {
      const rule = { header: statement.trim(), declarations: [], rules: [] };
      stack.at(-1).rules.push(rule);
      stack.push(rule);
      statement = "";
    } else if (token === ";" || token === "}") {
      if (statement.trim()) stack.at(-1).declarations.push(statement.trim());
      statement = "";
      if (token === "}") stack.pop();
    } else statement += token;
  }
  if (statement.trim()) root.declarations.push(statement.trim());
  return root;
}

function globalCSSImports(stylesheet) {
  const imports = [];
  function visit(node) {
    for (const declaration of node.declarations) {
      const match = /^@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)|"([^"]+)"|'([^']+)')/.exec(declaration);
      if (match) imports.push(match.slice(1).find(Boolean));
    }
    for (const rule of node.rules) visit(rule);
  }
  visit(globalCSSBlocks(stylesheet));
  return imports;
}

export function applyGlobalStylesPolicy(findings, sources) {
  const violations = [];
  const add = (file, rule, detail) => violations.push({ file, rule, detail });
  const entry = { file: "src/main.tsx", detail: "./styles/globals.css" };
  const entries = findings.filter(item => item.rule === "css-import" && item.file === entry.file && item.detail === entry.detail);
  if (entries.length !== 1) add(entry.file, "global-style-entry", `${entry.detail}: expected 1 import, found ${entries.length}`);
  const edges = findings.filter(item => item.rule === "css-import").map(({ file, detail }) => ({ file, detail }));
  for (const { file, detail } of edges) {
    const target = detail.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), detail)) : detail.startsWith("@/") ? `src/${detail.slice(2)}` : detail;
    if (!Object.values(globalStyleFiles).includes(target)) continue;
    const owned = target === globalStyleFiles.globals ? file === entry.file && detail === entry.detail : file === globalStyleFiles.globals && globalStyleImports.includes(detail);
    if (!owned) add(file, "global-style-owner", detail);
  }
  for (const [kind, file] of Object.entries(globalStyleFiles)) {
    const stylesheet = sources.get(file);
    if (stylesheet === undefined) { add(file, "global-style-missing", "Required global stylesheet is missing"); continue; }
    const root = globalCSSBlocks(stylesheet);
    for (const match of stripGlobalCSSComments(stylesheet).matchAll(/var\(--(?!ob-)([\w-]+)/g)) {
      const name = match[1];
      if (!standardThemeTokens.has(name) && !applicationRoleTokens.has(name) && !(kind === "tokens" && brandSourceTokens.has(name))) add(file, "global-style-token", match[0]);
    }
    if (kind === "globals") {
      const imports = globalCSSImports(stylesheet);
      for (const detail of new Set([...globalStyleImports, ...imports])) {
        const count = imports.filter(name => name === detail).length;
        if (!globalStyleImports.includes(detail) || count !== 1) add(file, "global-style-import", `${detail}: expected ${globalStyleImports.includes(detail) ? 1 : 0}, found ${count}`);
      }
      const sourcePaths = root.declarations.flatMap(value => {
        const match = /^@source\s+(not\s+)?(["'])([^"']+)\2$/.exec(value);
        return match ? [`${match[1] ? "not " : ""}${match[3]}`] : [];
      });
      for (const declaration of root.declarations) {
        const imported = /^@import\s+(?:url\(\s*(?:"[^"]+"|'[^']+'|[^\s)]+)\s*\)|"[^"]+"|'[^']+')$/.test(declaration);
        const source = /^@source\s+(?:not\s+)?(["'])[^"']+\1$/.test(declaration);
        if (!imported && !source) add(file, "global-style-declaration", declaration);
      }
      for (const detail of new Set([...globalStyleSources, ...sourcePaths])) {
        const count = sourcePaths.filter(name => name === detail).length;
        if (!globalStyleSources.includes(detail) || count !== 1) add(file, "global-style-source", `${detail}: expected ${globalStyleSources.includes(detail) ? 1 : 0}, found ${count}`);
      }
    } else for (const declaration of root.declarations) add(file, "global-style-declaration", declaration);
    function visit(node, context = "") {
      for (const rule of node.rules) {
        const header = normalizeCSSRule(rule.header);
        if (header.startsWith("@")) {
          const wrapper = context === "" && ((globalStyleRules[kind]?.some(([allowed]) => normalizeCSSRule(allowed) === header)) || (kind === "motion" && header === "@theme") || (kind === "tokens" && header === "@theme inline"));
          const keyframes = kind === "motion" && context === "@theme" && /^@keyframes [\w-]+$/.test(header);
          if (!wrapper && !keyframes) { add(file, "global-style-rule", rule.header); continue; }
          for (const declaration of rule.declarations) {
            const property = declaration.slice(0, declaration.indexOf(":")).trim();
            const name = property.replace(/^--color-/, "");
            const allowed = kind === "motion" && header === "@theme" ? /^--animate-ob-[\w-]+$/.test(property) : kind === "tokens" && header === "@theme inline" && (/^--(?:color|shadow)-ob-[\w-]+$/.test(property) || (property.startsWith("--color-") && (standardThemeTokens.has(name) || applicationRoleTokens.has(name))));
            if (!allowed) add(file, "global-style-declaration", declaration);
          }
          visit(rule, header);
          continue;
        }
        for (const selector of splitCSSSelectors(rule.header)) {
          const allowed = globalStyleRules[kind]?.find(([ancestor, selectors]) => normalizeCSSRule(ancestor) === context && selectors.some(value => normalizeCSSRule(value) === normalizeCSSRule(selector)))?.[2];
          const frame = kind === "motion" && context.startsWith("@keyframes ") && /^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector);
          if (!allowed && !frame && kind !== "tokens") add(file, "global-style-selector", selector);
          for (const declaration of rule.declarations) {
            const property = declaration.slice(0, declaration.indexOf(":")).trim();
            if (kind === "tokens" ? !(/^--ob-[\w-]+$/.test(property) || standardThemeTokens.has(property.slice(2)) || applicationRoleTokens.has(property.slice(2))) : frame ? !["opacity", "transform"].includes(property) : allowed && !allowed.includes(property)) add(file, "global-style-property", `${selector}: ${property}`);
          }
        }
        if (rule.rules.length) { add(file, "global-style-rule", `${rule.header}: nested rules are not admitted`); }
      }
    }
    visit(root);
  }
  const admittedImports = new Map([[JSON.stringify([entry.file, entry.detail]), 1]]);
  for (const [file, imports] of Object.entries({ [globalStyleFiles.globals]: globalStyleImports, ...packageStyleImports })) for (const detail of imports) admittedImports.set(JSON.stringify([file, detail]), 1);
  return [...findings.filter(item => {
    if (item.rule !== "css-import") return true;
    const key = JSON.stringify([item.file, item.detail]);
    const allowed = admittedImports.get(key) ?? 0;
    if (!allowed) return true;
    admittedImports.set(key, allowed - 1);
    return false;
  }), ...violations];
}

export function applyDomainStylesAllowlist(findings, entries, sources) {
  const scopeFindings = [];
  const remaining = new Map(entries.map(entry => {
    if (!entry.reason || !/^\.[\w-]+$/.test(entry.scope ?? "") || (entry.contentScope !== undefined && !/^\.[\w-]+$/.test(entry.contentScope)) || !entry.detail.endsWith(".css") || !Number.isInteger(entry.maxOccurrences) || entry.maxOccurrences < 1) throw new Error(`Invalid domain stylesheet entry: ${entry.file}`);
    const file = path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), entry.detail));
    const stylesheet = sources.get(file);
    if (stylesheet === undefined) throw new Error(`Domain stylesheet is missing: ${file}`);
    const boundary = new RegExp(`^\\${entry.scope}(?=$|[\\s:.>#\\[])`);
    const contentBoundary = entry.contentScope ? new RegExp(`^\\${entry.scope}(?:\\[[^\\]]+\\])*\\s+\\${entry.contentScope}(?=$|[\\s:.>#\\[])`) : undefined;
    const normalized = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of normalized.matchAll(/([^{}]+)\{/g)) {
      const rule = match[1].trim();
      if (/^@(?:media|supports)\b/.test(rule)) continue;
      for (const selector of splitCSSSelectors(rule)) {
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
