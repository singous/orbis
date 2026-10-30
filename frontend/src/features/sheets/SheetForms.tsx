import { reportError } from "../../shared/api/request-feedback";
import { ArrowDown, ArrowUp, Copy, Plus, Send, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { Tag } from "../../shared/ui/Tag";
import { TextInput } from "../../shared/ui/TextInput";
import { ValueEditor } from "./Cell";
import { FieldIcon } from "./FieldIcon";
import {
  KINDS,
  newField,
  type Field,
  type Form,
  type Kind,
  type Value,
} from "./model";
import "./sheets.css";
import type { SheetController } from "./use-sheet";

function FormQR({ value }: { value: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, { width: 144, margin: 1 }).then((url) => {
      if (active) setSrc(url);
    });
    return () => {
      active = false;
    };
  }, [value]);
  return src ? (
    <img src={src} width={144} height={144} alt="表单填写二维码" />
  ) : null;
}

export function SheetForms({
  controller: c,
  form,
  fields,
  readOnly,
}: {
  controller: SheetController;
  form: Form;
  fields: Field[];
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState(structuredClone(form)),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [share, setShare] = useState(false),
    [copied, setCopied] = useState(false);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [describing, setDescribing] = useState<string | null>(null);
  const dirty = JSON.stringify(draft.config) !== JSON.stringify(form.config);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(enabled = draft.enabled) {
    setBusy(true);

    try {
      const saved = await c.api.saveForm(c.meta.data!.id, {
        ...draft,
        enabled,
      });
      setDraft(saved);
      await c.forms.refetch();
      return saved;
    } catch (e) { reportError(e);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const blocker = useBlocker(dirty && !readOnly);
  const savingOnLeave = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || savingOnLeave.current) return;
    savingOnLeave.current = true;
    void save()
      .then(() => blocker.proceed())
      .catch(() => blocker.reset())
      .finally(() => {
        savingOnLeave.current = false;
      });
  }, [blocker.state]);
  const available = fields.filter(
    (f) =>
      !KINDS[f.kind].system &&
      !draft.config.fields.some((ff) => ff.field_id === f.id),
  );
  const link = `${location.origin}/forms/${draft.token}`;
  async function addField(kind: Kind) {
    const field = newField(kind),
      table = c.meta.data!;
    setBusy(true);
    try {
      await c.update({
        ...table,
        definition: {
          fields: [...table.definition.fields, field],
          views: table.definition.views.map((v) => ({
            ...v,
            field_ids: [...v.field_ids, field.id],
          })),
        },
      });
      setDraft((old) => ({
        ...old,
        config: {
          ...old.config,
          fields: [
            ...old.config.fields,
            { field_id: field.id, required: false, description: "" },
          ],
        },
      }));
    } catch (e) { reportError(e);
    } finally {
      setBusy(false);
    }
  }
  function reorder(index: number, delta: number) {
    const next = [...draft.config.fields],
      to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    setDraft({ ...draft, config: { ...draft.config, fields: next } });
  }
  return (
    <div className="sheet-form-workspace">
      <div className="sheet-form-toolbar">
        <div className="sheet-segment">
          <ActionButton
            size="sm"
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            编辑表单
          </ActionButton>
          <ActionButton
            size="sm"
            aria-pressed={preview}
            onClick={() => {
              if (dirty && !readOnly)
                void save()
                  .then(() => setPreview(true))
                  .catch(() => {});
              else setPreview(true);
            }}
          >
            预览表单
          </ActionButton>
        </div>
        <span>{dirty ? "有未保存修改" : "已保存"}</span>
        {!readOnly && (
          <>
            <ActionButton
              size="sm"
              disabled={busy || !dirty}
              onClick={() => void save().catch(() => {})}
            >
              保存表单
            </ActionButton>
            {draft.enabled && <Tag tone="success">收集中</Tag>}
            <ActionButton
              size="sm"
              variant={draft.enabled ? "secondary" : "primary"}
              onClick={() => {
                if (!draft.enabled)
                  void save(true)
                    .then(() => setShare(true))
                    .catch(() => {});
                else setShare(true);
              }}
              disabled={busy}
            >
              <Send size={14} />
              {draft.enabled ? "分享表单" : "开始收集"}
            </ActionButton>
          </>
        )}
      </div>

      <div className="sheet-form-body">
        {!preview && !readOnly && (
          <aside className="sheet-form-palette">
            <strong>可添加字段</strong>
            {available.length ? (
              available.map((f) => (
                <ActionButton
                  size="sm"
                  key={f.id}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      config: {
                        ...draft.config,
                        fields: [
                          ...draft.config.fields,
                          { field_id: f.id, required: false, description: "" },
                        ],
                      },
                    })
                  }
                >
                  <FieldIcon kind={f.kind} />
                  {f.name}
                  <Plus size={13} />
                </ActionButton>
              ))
            ) : (
              <p>所有字段已添加</p>
            )}
            <strong>添加新字段</strong>
            <div className="sheet-form-new-fields">
              {Object.entries(KINDS)
                .filter(([, info]) => !info.system)
                .map(([kind, info]) => (
                  <ActionButton
                    size="sm"
                    key={kind}
                    disabled={busy}
                    onClick={() => void addField(kind as Kind)}
                  >
                    <FieldIcon kind={kind as Kind} />
                    {info.label}
                  </ActionButton>
                ))}
            </div>
          </aside>
        )}
        <div className="sheet-form-paper">
          <TextInput
            className="sheet-form-title"
            aria-label="表单标题"
            readOnly={preview || readOnly}
            value={draft.config.title}
            placeholder="表单"
            onChange={(e) =>
              setDraft({
                ...draft,
                config: { ...draft.config, title: e.target.value },
              })
            }
          />
          <textarea
            className="sheet-form-description"
            aria-label="表单描述"
            readOnly={preview || readOnly}
            placeholder="请输入表单描述"
            value={draft.config.description}
            onChange={(e) =>
              setDraft({
                ...draft,
                config: { ...draft.config, description: e.target.value },
              })
            }
          />
          {draft.config.fields.map((ff, index) => {
            const field = fields.find((f) => f.id === ff.field_id);
            if (!field) return null;
            return (
              <section key={field.id} className="sheet-form-question">
                <div>
                  <label>
                    {ff.required && <em>*</em>}
                    {index + 1}. {field.name}
                  </label>
                  {!preview && !readOnly && (
                    <div className="sheet-question-tools">
                      <ActionButton
                        size="sm"
                        onClick={() =>
                          setDescribing(
                            describing === ff.field_id ? null : ff.field_id,
                          )
                        }
                      >
                        说明
                      </ActionButton>
                      <label>
                        <input
                          type="checkbox"
                          checked={ff.required}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              config: {
                                ...draft.config,
                                fields: draft.config.fields.map((f) =>
                                  f.field_id === ff.field_id
                                    ? { ...f, required: e.target.checked }
                                    : f,
                                ),
                              },
                            })
                          }
                        />
                        必填
                      </label>
                      <ActionButton
                        size="sm"
                        aria-label="上移问题"
                        onClick={() => reorder(index, -1)}
                      >
                        <ArrowUp size={13} />
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        aria-label="下移问题"
                        onClick={() => reorder(index, 1)}
                      >
                        <ArrowDown size={13} />
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        aria-label="移除问题"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            config: {
                              ...draft.config,
                              fields: draft.config.fields.filter(
                                (f) => f.field_id !== ff.field_id,
                              ),
                            },
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </ActionButton>
                    </div>
                  )}
                </div>
                {(ff.description ||
                  (!preview && describing === ff.field_id)) && (
                  <TextInput
                    className="sheet-question-description"
                    aria-label={`${field.name}说明`}
                    placeholder="添加问题说明"
                    readOnly={preview || readOnly}
                    value={ff.description}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: {
                          ...draft.config,
                          fields: draft.config.fields.map((f) =>
                            f.field_id === ff.field_id
                              ? { ...f, description: e.target.value }
                              : f,
                          ),
                        },
                      })
                    }
                  />
                )}
                <ValueEditor
                  field={field}
                  value={values[field.id]}
                  auth={c.auth}
                  publicMode
                  onChange={(value) =>
                    setValues((old) => ({ ...old, [field.id]: value }))
                  }
                />
              </section>
            );
          })}
          {preview && (
            <p className="sheet-muted">
              当前为预览；请通过填写链接提交真实记录。
            </p>
          )}
        </div>
      </div>
      {share && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setShare(false);
          }}
        >
          <DialogContent
            title="收集表单"
            description="分享填写链接，提交内容将自动保存为新的记录。"
            className="sheet-share-dialog"
          >
            <div className="sheet-form-share">
              <p>获得链接的人可以填写并提交表单</p>
              <label className="sheet-check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => void save(e.target.checked).catch(() => {})}
                />
                允许收集
              </label>
              <div>
                <TextInput readOnly aria-label="填写链接" value={link} />
                <ActionButton
                  size="sm"
                  variant="primary"
                  className="sheet-primary"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(link)
                      .then(() => setCopied(true))
                      .catch(() => reportError("复制失败，请选中链接手动复制"));
                  }}
                >
                  <Copy size={14} />
                  {copied ? "已复制" : "复制填写链接"}
                </ActionButton>
              </div>
              <FormQR value={link} />
              <a href={link} target="_blank" rel="noreferrer">
                打开填写页面
              </a>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
