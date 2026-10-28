import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../../shared/api/api-client";
import { reportError } from "../../shared/api/request-feedback";
import { newUUID } from "../../shared/ids";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ValueEditor } from "./Cell";
import { readPublicForm, submitPublicForm, uploadPublicFormFile } from "./api";
import type { Value } from "./model";
import "./sheets.css";

export function PublicSheetForm() {
  const { token = "" } = useParams();
  return <PublicSheetFormSession key={token} token={token} />;
}

/** Each public link owns its answers, submission receipt and completion state. */
function PublicSheetFormSession({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ["public-sheet-form", token],
    queryFn: ({ signal }) => readPublicForm(token, signal),
    retry: false,
  });
  const [values, setValues] = useState<Record<string, Value>>({}),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const pending = useRef<{
    operation_id: string;
    version: number;
    values: Record<string, Value>;
  } | null>(null);
  const submissionKey = `orbis.sheet-submission:${token}`;
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(submissionKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (
          saved &&
          typeof saved.operation_id === "string" &&
          Number.isSafeInteger(saved.version) &&
          saved.values &&
          typeof saved.values === "object"
        ) {
          pending.current = saved;
          setValues(saved.values);
        }
      }
    } catch {
      reportError("无法恢复上次填写内容");
    }
  }, [submissionKey]);
  if (query.error)
    return (
      <main className="sheet-public">
        <div className="sheet-form-paper">
          <h1>暂时无法填写</h1>
          <p>收集已停止，或填写链接已失效。</p>
          <ActionButton size="sm" onClick={() => void query.refetch()}>
            重试
          </ActionButton>
        </div>
      </main>
    );
  if (!query.data) return <main className="sheet-public">正在加载表单…</main>;
  const form = query.data;
  async function submit() {

    for (const ff of form.config.fields) {
      const v = values[ff.field_id];
      if (
        ff.required &&
        (v == null || v === "" || (Array.isArray(v) && !v.length))
      ) {
        reportError(`请填写${form.fields.find((f) => f.id === ff.field_id)?.name}`);
        return;
      }
    }
    pending.current ??= {
      operation_id: newUUID(),
      version: form.version,
      values: structuredClone(values),
    };
    try {
      sessionStorage.setItem(submissionKey, JSON.stringify(pending.current));
    } catch {
      reportError("无法保存提交凭据，请允许浏览器存储后重试");
      return;
    }
    setBusy(true);
    try {
      await submitPublicForm(token, pending.current);
      sessionStorage.removeItem(submissionKey);
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status)) {
        pending.current = null;
        sessionStorage.removeItem(submissionKey);
      }
      reportError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="sheet-public">
      <form
        className="sheet-form-paper"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {done ? (
          <>
            <h1>提交成功</h1>
            <p>你的信息已保存，感谢填写。</p>
          </>
        ) : (
          <>
            <h1>{form.config.title}</h1>
            <p className="sheet-form-description">{form.config.description}</p>
            {form.config.fields.map((ff, i) => {
              const field = form.fields.find((f) => f.id === ff.field_id);
              return field ? (
                <section className="sheet-form-question" key={field.id}>
                  <label>
                    {ff.required && <em>*</em>}
                    {i + 1}. {field.name}
                  </label>
                  {ff.description && <p>{ff.description}</p>}
                  <ValueEditor
                    field={field}
                    value={values[field.id]}
                    publicMode
                    publicUpload={(file) =>
                      uploadPublicFormFile(token, field.id, file)
                    }
                    onChange={(value) => {
                      if (!pending.current)
                        setValues((old) => ({ ...old, [field.id]: value }));
                    }}
                  />
                </section>
              ) : null;
            })}

            <ActionButton
              size="sm"
              type="submit"
              variant="primary"
              className="sheet-primary"
              disabled={busy}
            >
              {busy ? "提交中…" : pending.current ? "重试提交" : "提交"}
            </ActionButton>
          </>
        )}
      </form>
    </main>
  );
}
