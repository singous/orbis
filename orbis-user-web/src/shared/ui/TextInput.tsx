import type { InputHTMLAttributes } from "react";

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export function TextInput({ label, className = "", ...props }: TextInputProps) {
  const input = (
    <input
      className={[
        "h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3.5 text-sm text-[var(--text)]",
        "placeholder:text-[var(--muted-light)]",
        "focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]",
        className,
      ].join(" ")}
      {...props}
    />
  );

  if (!label) {
    return input;
  }

  return (
    <label className="grid gap-1.5 text-sm font-medium text-[var(--text)]">
      <span>{label}</span>
      {input}
    </label>
  );
}
