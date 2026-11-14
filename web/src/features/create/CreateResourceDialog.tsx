import { useId, useState, type ReactNode } from "react";
import { Dialog } from "../../components/Dialog";
import type { NewResource, Resource } from "../../lib/types";
import {
  buildResource,
  candidates,
  referenceExpression,
  suggestName,
  templates,
  validFileName,
  validName,
  type ResourceTemplate,
} from "./templates";

const NEW_FILE = "\u0000nuevo";

export interface CreateTarget {
  /** Files of the project that can receive a resource (.tf only). */
  path: string;
  /** Why the file cannot receive it now (a draft in conflict…). */
  blocked?: string;
}

function defaultReferences(
  template: ResourceTemplate,
  resources: Resource[],
  preferred: string,
) {
  const chosen: Record<string, string> = {};
  for (const attr of template.attributes) {
    if (!("reference" in attr)) continue;
    const options = candidates(resources, attr.reference.type);
    const target =
      options.find((r) => r.id === preferred) ??
      (attr.reference.required ? options[0] : undefined);
    if (target)
      chosen[attr.name] = referenceExpression(target, attr.reference.attribute);
  }
  return chosen;
}

/** A labelled control; the error is announced as its description. */
function Field({
  label,
  error = "",
  children,
}: {
  label: string;
  error?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="create-field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        "aria-invalid": !!error,
        "aria-describedby": error ? `${id}-error` : undefined,
      })}
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

function shown(value: string | number | boolean) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function CreateResourceDialog({
  resources,
  files,
  defaultFile,
  preferred,
  busy,
  error,
  onCreate,
  onClose,
}: {
  resources: Resource[];
  files: CreateTarget[];
  defaultFile: string;
  /** Selected declaration, offered first for reference arguments. */
  preferred: string;
  busy: boolean;
  error: string;
  onCreate: (request: {
    resource: NewResource;
    path: string;
    newFile: boolean;
  }) => void;
  onClose: () => void;
}) {
  const [template, setTemplate] = useState(templates[0]);
  const [name, setName] = useState(() => suggestName(templates[0], resources));
  const [references, setReferences] = useState(() =>
    defaultReferences(templates[0], resources, preferred),
  );
  const usable = files.filter((f) => !f.blocked);
  const [file, setFile] = useState(() =>
    usable.some((f) => f.path === defaultFile)
      ? defaultFile
      : (usable[0]?.path ?? NEW_FILE),
  );
  const [newFile, setNewFile] = useState("");
  const choose = (next: ResourceTemplate) => {
    setTemplate(next);
    setName(suggestName(next, resources));
    setReferences(defaultReferences(next, resources, preferred));
    setNewFile("");
  };
  const creatingFile = file === NEW_FILE;
  const fileName = newFile || `${name || "recurso"}.tf`;
  const duplicate = resources.some(
    (r) =>
      r.block === "resource" && r.type === template.type && r.name === name,
  );
  const nameProblem = !name
    ? "Escribe un nombre."
    : !validName(name)
      ? "Usa letras, dígitos, _ o -, empezando por una letra o _ (máximo 64)."
      : duplicate
        ? `Ya existe ${template.type}.${name}.`
        : "";
  const fileProblem = !creatingFile
    ? ""
    : !validFileName(fileName)
      ? "El archivo nuevo debe terminar en .tf, sin carpetas ni espacios."
      : files.some((f) => f.path === fileName)
        ? "Ese archivo ya existe: elígelo en la lista."
        : "";
  const resource = buildResource(template, name, references);
  const missing = template.attributes.filter(
    (attr) =>
      "reference" in attr && attr.reference.required && !references[attr.name],
  );
  const notices = [
    ...template.attributes.map((attr) =>
      "notice" in attr && attr.notice ? attr.notice(name) : "",
    ),
    template.notice ?? "",
  ].filter(Boolean);
  return (
    <Dialog title="Crear recurso" onClose={onClose} wide>
      <form
        className="create-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (nameProblem || fileProblem || busy) return;
          onCreate({
            resource,
            path: creatingFile ? fileName : file,
            newFile: creatingFile,
          });
        }}
      >
        <p className="dialog-intro">
          En un archivo existente, TerraDock añade el bloque al final sin tocar
          el resto, y llega al disco con el autoguardado o al guardar (⌘/Ctrl +
          S), como cualquier otro cambio. Un archivo nuevo se escribe en el
          disco en cuanto pulsas Crear recurso.
        </p>
        <fieldset className="create-palette">
          <legend>Tipo de recurso</legend>
          {templates.map((t) => (
            <button
              type="button"
              key={t.type}
              aria-pressed={t.type === template.type}
              className={t.type === template.type ? "active" : ""}
              onClick={() => choose(t)}
            >
              <strong>{t.label}</strong>
              <code>{t.type}</code>
              <small>{t.description}</small>
            </button>
          ))}
        </fieldset>
        <div className="create-fields">
          <Field label="Nombre" error={nameProblem}>
            {(props) => (
              <input
                {...props}
                value={name}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Archivo">
            {(props) => (
              <select
                {...props}
                value={file}
                onChange={(e) => setFile(e.target.value)}
              >
                {files.map((f) => (
                  <option key={f.path} value={f.path} disabled={!!f.blocked}>
                    {f.blocked ? `${f.path} (${f.blocked})` : f.path}
                  </option>
                ))}
                <option value={NEW_FILE}>Archivo nuevo…</option>
              </select>
            )}
          </Field>
          {creatingFile && (
            <Field label="Nombre del archivo nuevo" error={fileProblem}>
              {(props) => (
                <input
                  {...props}
                  value={fileName}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setNewFile(e.target.value)}
                />
              )}
            </Field>
          )}
          {template.attributes.map((attr) => {
            if (!("reference" in attr)) return null;
            const options = candidates(resources, attr.reference.type);
            return (
              <Field
                key={attr.name}
                label={`${attr.reference.label} (${attr.name})`}
              >
                {(props) => (
                  <select
                    {...props}
                    value={references[attr.name] ?? ""}
                    onChange={(e) =>
                      setReferences((current) => ({
                        ...current,
                        [attr.name]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Sin asignar</option>
                    {options.map((r) => (
                      <option
                        key={r.id}
                        value={referenceExpression(r, attr.reference.attribute)}
                      >
                        {referenceExpression(r, attr.reference.attribute)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            );
          })}
        </div>
        {missing.length > 0 && (
          <p className="create-note" role="status">
            AWS exige {missing.map((attr) => attr.name).join(" y ")}. Sin
            asignar, el bloque se crea sin {missing.length > 1 ? "ellos" : "él"}
            : complétalo en el código antes de desplegar.
          </p>
        )}
        {notices.map((notice) => (
          <p className="create-note" role="status" key={notice}>
            {notice}
          </p>
        ))}
        <div className="create-preview">
          <span>
            {creatingFile ? `Nuevo archivo ${fileName}` : `Al final de ${file}`}
          </span>
          <pre>
            {`resource "${template.type}" "${name}" {\n`}
            {resource.attributes
              .map(
                (a) =>
                  `  ${a.name} = ${"expression" in a ? a.expression.replaceAll("\n", "\n  ") : shown(a.value)}\n`,
              )
              .join("")}
            {"}"}
          </pre>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-footer">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="button-primary"
            disabled={busy || !!nameProblem || !!fileProblem}
          >
            Crear recurso
          </button>
        </div>
      </form>
    </Dialog>
  );
}
