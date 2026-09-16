import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export const CODE_LANGUAGES: Record<string, string> = {
  text: "纯文本", bash: "Bash", curl: "cURL", javascript: "JavaScript", typescript: "TypeScript",
  python: "Python", json: "JSON", html: "HTML", css: "CSS", java: "Java", go: "Go", sql: "SQL", yaml: "YAML", http: "HTTP", markdown: "Markdown",
};

export function codeLanguageLabel(language: string): string {
  return CODE_LANGUAGES[language] || language || "纯文本";
}

export function CodeBlock({ source, language = "text" }: { source: string; language?: string }) {
  const [highlighted, setHighlighted] = useState<{ source: string; language: string; html: string } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
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
    } catch { setCopyState("failed"); }
  }
  const html = highlighted?.source === source && highlighted.language === language ? highlighted.html : null;
  return <div className="content-code">
    <div className="content-code-toolbar"><span>{codeLanguageLabel(language)}</span><button type="button" aria-label="复制代码" onClick={() => void copy()}>{copyState === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}<span>{copyState === "copied" ? "已复制" : "复制"}</span></button></div>
    <pre tabIndex={0} aria-label={codeLanguageLabel(language) + " 代码"}>{html === null ? <code>{source}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}</pre>
    {copyState === "failed" ? <p className="content-copy-feedback" role="status">复制失败，请选择代码后手动复制。</p> : null}
  </div>;
}
