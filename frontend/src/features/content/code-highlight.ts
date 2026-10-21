import highlight from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import http from "highlight.js/lib/languages/http";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

for (const [name, grammar] of Object.entries({ bash, css, go, http, java, javascript, json, markdown, python, sql, typescript, xml, yaml })) {
  highlight.registerLanguage(name, grammar);
}
const ALIASES: Record<string, string> = { sh: "bash", shell: "bash", zsh: "bash", curl: "bash", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", html: "xml", yml: "yaml", md: "markdown" };

export function highlightCode(source: string, language: string): string | null {
  const normalized = ALIASES[language.toLowerCase()] || language.toLowerCase();
  if (!highlight.getLanguage(normalized)) return null;
  // The highlighter escapes source before adding its own span markup.
  return highlight.highlight(source, { language: normalized, ignoreIllegals: true }).value;
}
