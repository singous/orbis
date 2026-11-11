import { reportError } from "../../shared/api/request-feedback";
import { Button } from "@orbis/ui/button";
import { Check, Copy } from "../../shared/ui/icons";
import { useEffect, useState } from "react";
import { showToast } from "../../shared/ui/Toast";

export const CODE_LANGUAGES: Record<string, string> = {
  text: "纯文本", bash: "Bash", curl: "cURL", javascript: "JavaScript", typescript: "TypeScript",
  python: "Python", json: "JSON", html: "HTML", css: "CSS", java: "Java", go: "Go", sql: "SQL", yaml: "YAML", http: "HTTP", markdown: "Markdown",
};

export function codeLanguageLabel(language: string): string {
  return CODE_LANGUAGES[language] || language || "纯文本";
}

export async function copyCode(source: string) {
  try {
    await navigator.clipboard.writeText(source);
    showToast({ title: "代码已复制", tone: "success" });
    return true;
  } catch {
    reportError("请选择代码后手动复制。");
    return false;
  }
}

export function CodeBlock({ source, language = "text" }: { source: string; language?: string }) {
  const [highlighted, setHighlighted] = useState<{ source: string; language: string; html: string } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  useEffect(() => {
    let active = true;
    void import("./code-highlight").then(({ highlightCode }) => {
      const html = highlightCode(source, language);
      if (active && html !== null) setHighlighted({ source, language, html });
    }).catch(() => { /* Plain text remains usable if the optional highlighter cannot load. */ });
    return () => { active = false; };
  }, [source, language]);
  useEffect(() => { setCopyState("idle"); }, [source, language]);
  async function copy() {
    if (await copyCode(source)) setCopyState("copied");
  }
  const html = highlighted?.source === source && highlighted.language === language ? highlighted.html : null;
  return <div className="content-code">
    <div className="content-code-toolbar flex items-center justify-between border-b border-border p-3 text-xs text-muted-foreground"><span>{codeLanguageLabel(language)}</span><Button variant="ghost" size="sm" type="button" aria-label="复制代码" onClick={() => void copy()}>{copyState === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}<span>{copyState === "copied" ? "已复制" : "复制"}</span></Button></div>
    <pre tabIndex={0} aria-label={codeLanguageLabel(language) + " 代码"}>{html === null ? <code>{source}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}</pre>
  </div>;
}
