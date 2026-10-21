import { Paperclip, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  apiBlobRequest,
  apiRequest,
  workspacePath,
} from "../../shared/api/api-client";
import {
  authRequestOptions,
  useOptionalAuthRequest,
  type AuthRequestOptions,
} from "../../shared/auth/use-auth-request";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { SelectField } from "../../shared/ui/SelectField";
import { TextInput } from "../../shared/ui/TextInput";
import { showToast } from "../../shared/ui/Toast";
import { parseFileReference, uploadManagedFile } from "../files/managed-files";
import { KINDS, cellText, type Field, type Value } from "./model";

const MAX_CELL_ATTACHMENTS = 3;
const MAX_AUTOMATIC_IMAGE_BYTES = 1 << 20;
const ATTACHMENT_EDITOR_PAGE_SIZE = 8;

export function Attachment({
  id,
  image = false,
}: {
  id: string;
  image?: boolean;
}) {
  const auth = useOptionalAuthRequest(),
    [file, setFile] = useState<{ filename: string; size_bytes: number }>(),
    [url, setUrl] = useState("");
  useEffect(() => {
    if (!auth) return;
    const abort = new AbortController();
    let objectURL = "";
    setUrl("");
    void apiRequest(workspacePath(auth, `/assets/${id}`), {
      ...authRequestOptions(auth),
      signal: abort.signal,
    })
      .then(async (value) => {
        const metadata = value as { filename: string; size_bytes: number };
        if (abort.signal.aborted) return;
        setFile(metadata);
        // Large originals remain downloadable without decoding them during scrolling.
        if (image && metadata.size_bytes <= MAX_AUTOMATIC_IMAGE_BYTES) {
          const blob = await apiBlobRequest(
            workspacePath(auth, `/assets/${id}/content`),
            { ...authRequestOptions(auth), signal: abort.signal },
          );
          if (!abort.signal.aborted) {
            objectURL = URL.createObjectURL(blob);
            setUrl(objectURL);
          }
        }
      })
      .catch(() => {});
    return () => {
      abort.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [id, auth, image]);
  async function download() {
    if (!auth) return;
    const blob = await apiBlobRequest(
      workspacePath(auth, `/assets/${id}/content`),
      authRequestOptions(auth),
    );
    const u = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = u;
    link.download = file?.filename ?? "附件";
    link.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  return (
    <ActionButton
      size="sm"
      className="sheet-file"
      onClick={() =>
        void download().catch((e) =>
          showToast({
            title: "无法打开附件",
            description: e.message,
            tone: "danger",
          }),
        )
      }
      title={file?.filename ?? "附件"}
    >
      {image && url ? (
        <img src={url} alt={file?.filename ?? "图片"} />
      ) : (
        <>
          <Paperclip size={13} />
          {file?.filename ?? "附件"}
        </>
      )}
    </ActionButton>
  );
}
export function CellValue({
  field,
  value,
  interactive = false,
}: {
  field: Field;
  value?: Value;
  interactive?: boolean;
}) {
  if (field.kind === "checkbox")
    return (
      <input
        type="checkbox"
        tabIndex={-1}
        checked={Boolean(value)}
        disabled={!interactive}
        readOnly
        aria-label={field.name}
      />
    );
  if (value == null) return null;
  if (field.kind === "select" || field.kind === "multi_select") {
    const ids = Array.isArray(value) ? value : [String(value)];
    return (
      <span className="sheet-tags">
        {ids.map((id) => {
          const option = field.options.find((o) => o.id === id);
          return option ? (
            <span
              className="sheet-tag"
              style={{
                background: `var(--sheet-${option.color}, var(--sheet-gray))`,
              }}
              key={id}
            >
              {option.label}
            </span>
          ) : null;
        })}
      </span>
    );
  }
  if (field.kind === "rating")
    return (
      <span className="sheet-rating" aria-label={`${value} 星`}>
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            size={15}
            fill={i < Number(value) ? "currentColor" : "none"}
          />
        ))}
      </span>
    );
  if (field.kind === "progress")
    return (
      <span className="sheet-progress">
        <progress max={100} value={Number(value)} />
        {value}%
      </span>
    );
  if (field.kind === "attachment" || field.kind === "image")
    return (
      <span className="sheet-attachments">
        {(value as string[]).slice(0, MAX_CELL_ATTACHMENTS).map((id) => (
          <Attachment id={id} image={field.kind === "image"} key={id} />
        ))}
        {(value as string[]).length > MAX_CELL_ATTACHMENTS && (
          <small className="sheet-muted">
            +{(value as string[]).length - MAX_CELL_ATTACHMENTS}
          </small>
        )}
      </span>
    );
  if (
    field.kind === "person" ||
    field.kind === "created_by" ||
    field.kind === "updated_by"
  ) {
    const ids = Array.isArray(value) ? value : [String(value)];
    return (
      <span>
        {ids
          .map((id) => field.options.find((o) => o.id === id)?.label ?? "成员")
          .join("、")}
      </span>
    );
  }
  if (field.kind === "url")
    return (
      <a
        href={String(value)}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {String(value)}
      </a>
    );
  return <span>{cellText(field, value)}</span>;
}
export function ValueEditor({
  field,
  value,
  onChange,
  onCommit,
  autoFocus = false,
  auth,
  publicMode = false,
  publicUpload,
}: {
  field: Field;
  value?: Value;
  onChange: (v: Value) => void;
  onCommit?: () => void;
  autoFocus?: boolean;
  auth?: AuthRequestOptions | null;
  publicMode?: boolean;
  publicUpload?: (file: File) => Promise<string>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachmentLimit, setAttachmentLimit] = useState(
    ATTACHMENT_EDITOR_PAGE_SIZE,
  );
  const [error, setError] = useState(""),
    [uploading, setUploading] = useState(false),
    [fileNames, setFileNames] = useState<Record<string, string>>({});
  if (KINDS[field.kind].system)
    return <CellValue field={field} value={value} />;
  if (field.kind === "select" && publicMode)
    return (
      <div className="sheet-radio-options">
        {field.options.map((o) => (
          <label key={o.id}>
            <input
              type="radio"
              name={field.id}
              checked={value === o.id}
              onChange={() => onChange(o.id)}
            />
            {o.label}
          </label>
        ))}
      </div>
    );
  if (field.kind === "select")
    return (
      <SelectField
        aria-label={field.name}
        density="compact"
        value={String(value ?? "")}
        options={[
          { value: "", label: "请选择" },
          ...field.options.map((o) => ({ value: o.id, label: o.label })),
        ]}
        onChange={(v) => onChange(v || null)}
      />
    );
  if (field.kind === "multi_select" || field.kind === "person")
    return (
      <div className="sheet-multi-options">
        {field.options.map((o) => (
          <label key={o.id}>
            <input
              type="checkbox"
              checked={Array.isArray(value) && value.includes(o.id)}
              onChange={(e) => {
                const next = new Set(Array.isArray(value) ? value : []);
                if (e.target.checked) next.add(o.id);
                else next.delete(o.id);
                onChange([...next]);
              }}
            />
            {o.label}
          </label>
        ))}
        {!field.options.length && <span>暂无可选人员</span>}
      </div>
    );
  if (field.kind === "attachment" || field.kind === "image")
    return (
      <div>
        <div className="sheet-attachments">
          {(Array.isArray(value) ? value : [])
            .slice(0, attachmentLimit)
            .map((id) => (
              <span key={id}>
                {publicUpload && fileNames[id] ? (
                  <span>{fileNames[id]}</span>
                ) : (
                  <Attachment id={id} image={field.kind === "image"} />
                )}
                <ActionButton
                  size="sm"
                  aria-label="移除附件"
                  onClick={() =>
                    onChange((value as string[]).filter((v) => v !== id))
                  }
                >
                  <X size={12} />
                </ActionButton>
              </span>
            ))}
        </div>
        {Array.isArray(value) && value.length > attachmentLimit && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setAttachmentLimit(attachmentLimit + ATTACHMENT_EDITOR_PAGE_SIZE)
            }
          >
            查看更多附件（{value.length - attachmentLimit}）
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          icon={<Paperclip size={15} />}
          isPending={uploading}
          disabled={!auth && !publicUpload}
          onClick={() => fileInput.current?.click()}
        >
          {field.kind === "image" ? "上传图片" : "添加附件"}
        </Button>
        <input
          ref={fileInput}
          hidden
          aria-label={field.name}
          type="file"
          accept={field.kind === "image" ? "image/*" : undefined}
          multiple
          disabled={(!auth && !publicUpload) || uploading}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (!auth && !publicUpload) return;
            setUploading(true);
            try {
              const ids = [...(Array.isArray(value) ? value : [])];
              if (ids.length + files.length > 100)
                throw new Error("每个字段最多 100 个附件");
              for (const file of files) {
                const id = publicUpload
                  ? await publicUpload(file)
                  : parseFileReference(await uploadManagedFile(file, auth!))!;
                ids.push(id);
                setFileNames((old) => ({ ...old, [id]: file.name }));
                onChange([...ids]);
              }
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setUploading(false);
            }
          }}
        />
        {error && <p role="alert">{error}</p>}
      </div>
    );
  if (field.kind === "checkbox")
    return (
      <input
        autoFocus={autoFocus}
        aria-label={field.name}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (field.kind === "rating")
    return (
      <div className="sheet-rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <ActionButton
            size="sm"
            type="button"
            key={n}
            aria-label={`${n} 星`}
            aria-pressed={Number(value) >= n}
            onClick={() => onChange(n === value ? null : n)}
          >
            <Star
              size={22}
              fill={Number(value) >= n ? "currentColor" : "none"}
            />
          </ActionButton>
        ))}
      </div>
    );
  const date = field.kind === "datetime";
  const formatted =
    date && value
      ? new Date(Number(value) + 8 * 3600000)
          .toISOString()
          .slice(0, field.include_time ? 16 : 10)
      : String(value ?? "");
  return (
    <TextInput
      autoFocus={autoFocus}
      aria-label={field.name}
      placeholder="请输入"
      type={
        date
          ? field.include_time
            ? "datetime-local"
            : "date"
          : field.kind === "email"
            ? "email"
            : field.kind === "phone"
              ? "tel"
              : KINDS[field.kind].numeric
                ? "number"
                : "text"
      }
      value={formatted}
      maxLength={8192}
      min={field.kind === "progress" ? 0 : undefined}
      max={field.kind === "progress" ? 100 : undefined}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(
          !raw
            ? null
            : date
              ? Date.parse(
                  `${raw}${field.include_time ? "" : "T00:00:00"}+08:00`,
                )
              : KINDS[field.kind].numeric
                ? Number(raw)
                : raw,
        );
      }}
      onBlur={onCommit}
    />
  );
}
