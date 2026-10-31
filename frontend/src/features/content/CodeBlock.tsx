import { reportError } from "../../shared/api/request-feedback";
import { ActionButton } from "../../shared/ui/ActionButton";
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
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(source);
      setCopyState("copied");
      showToast({ title: "代码已复制", tone: "success" });
    } catch {
      reportError("请选择代码后手动复制。");
    }
  }
  const html = highlighted?.source === source && highlighted.language === language ? highlighted.html : null;
  return <div className="content-code">
    <div className="content-code-toolbar"><span>{codeLanguageLabel(language)}</span><ActionButton type="button" aria-label="复制代码" onClick={() => void copy()}>{copyState === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}<span>{copyState === "copied" ? "已复制" : "复制"}</span></ActionButton></div>
    <pre tabIndex={0} aria-label={codeLanguageLabel(language) + " 代码"}>{html === null ? <code>{source}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}</pre>
  </div>;
}
