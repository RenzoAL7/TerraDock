import {
  ArrowUpRight,
  Braces,
  FileCode2,
  LockKeyhole,
  Save,
  X,
} from "lucide-react";
import type { Project, Property, Resource } from "../../lib/types";
import { ResourceIcon } from "../architecture/ArchitectureCanvas";
import { shortType } from "../architecture/graph";

export interface PropertyDraft {
  projectId: string;
  text: string;
  revision: string;
}
export function propertyKey(resource: Resource, property: Property) {
  return `${resource.id}:${property.name}`;
}
export function propertyInputValue(property: Property): string {
  return property.value === undefined
    ? property.expression
    : String(property.value);
}
export function parsePropertyInput(
  property: Property,
  text: string,
): string | number | boolean {
  if (typeof property.value === "boolean") return text === "true";
  if (typeof property.value === "number") {
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n))
      throw new Error("Introduce un número válido.");
    return n;
  }
  return text;
}

interface Props {
  resource: Resource;
  project: Project;
  drafts: Record<string, PropertyDraft>;
  fileDirty: boolean;
  busy: boolean;
  onDraft: (key: string, draft: PropertyDraft | null) => void;
  onSave: (
    resource: Resource,
    property: Property,
    draft: PropertyDraft,
  ) => Promise<void>;
  onCode: (file: string, line: number) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function Inspector({
  resource,
  project,
  drafts,
  fileDirty,
  busy,
  onDraft,
  onSave,
  onCode,
  onSelect,
  onClose,
}: Props) {
  const source = project.files.find((file) => file.path === resource.file);
  const editable = resource.properties.filter((p) => p.editable);
  const readOnly = resource.properties.filter((p) => !p.editable);
  return (
    <aside className="inspector" aria-label="Inspector de propiedades">
      <div className="panel-heading">
        <span>INSPECTOR</span>
        <button
          className="icon-button"
          aria-label="Cerrar inspector"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      <div className="inspector-identity">
        <span className={`large-resource-icon ${resource.category}`}>
          <ResourceIcon resource={resource} size={26} />
        </span>
        <div>
          <span className="eyebrow">{shortType(resource.type)}</span>
          <h2>{resource.label || resource.name}</h2>
        </div>
      </div>
      <div className="resource-address">
        <code>{resource.id}</code>
        <span>Declarado en Terraform</span>
      </div>
      <button
        className="source-link"
        onClick={() => onCode(resource.file, resource.line)}
      >
        <FileCode2 size={15} />
        <code>
          {resource.file}:{resource.line}
        </code>
        <ArrowUpRight size={15} />
      </button>
      <div className="inspector-scroll">
        <section className="property-section">
          <h3>
            Propiedades <span>{resource.properties.length}</span>
          </h3>
          {fileDirty && (
            <p className="field-note">
              Guarda o descarta el borrador de este archivo antes de cambiar sus
              propiedades.
            </p>
          )}
          {!project.valid && (
            <p className="field-note">
              Corrige los errores de sintaxis para editar propiedades. El
              gráfico muestra la última versión válida.
            </p>
          )}
          {editable.map((property) => {
            const key = propertyKey(resource, property),
              draft = drafts[key];
            const value = draft?.text ?? propertyInputValue(property);
            const update = (text: string) =>
              onDraft(
                key,
                text === propertyInputValue(property)
                  ? null
                  : {
                      text,
                      projectId: draft?.projectId ?? project.id,
                      revision: draft?.revision ?? source?.revision ?? "",
                    },
              );
            return (
              <div
                className={`property-field ${draft ? "field-dirty" : ""}`}
                key={key}
              >
                <label htmlFor={key}>
                  {property.name}
                  <span>literal</span>
                </label>
                {typeof property.value === "boolean" ? (
                  <select
                    id={key}
                    value={value}
                    onChange={(e) => update(e.target.value)}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    id={key}
                    value={value}
                    onChange={(e) => update(e.target.value)}
                    spellCheck={false}
                    inputMode={
                      typeof property.value === "number" ? "decimal" : "text"
                    }
                  />
                )}
                {draft && (
                  <div className="field-actions">
                    <button onClick={() => onDraft(key, null)}>
                      Descartar
                    </button>
                    <button
                      disabled={busy || fileDirty || !project.valid}
                      onClick={() => void onSave(resource, property, draft)}
                    >
                      <Save size={12} /> Guardar propiedad
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {readOnly.map((property, index) => (
            <div
              className="property-field read-only"
              key={`${property.name}-${index}`}
            >
              <label>
                <span>{property.name}</span>
                {property.kind === "expression" ? (
                  <span className="expression-badge">ƒx expresión</span>
                ) : (
                  <LockKeyhole size={12} />
                )}
              </label>
              <code className="property-expression" title={property.expression}>
                {property.expression}
              </code>
              {property.kind === "expression" && (
                <button
                  className="text-link"
                  onClick={() => onCode(resource.file, property.line)}
                >
                  Editar en código <ArrowUpRight size={12} />
                </button>
              )}
            </div>
          ))}
        </section>
        <section className="property-section">
          <h3>
            Referencias <span>{resource.dependsOn.length}</span>
          </h3>
          {resource.dependsOn.length ? (
            resource.dependsOn.map((id) => (
              <button
                className="reference-item"
                key={id}
                onClick={() => onSelect(id)}
                disabled={!project.resources.some((r) => r.id === id)}
              >
                <Braces size={14} />
                <code>{id}</code>
                <ArrowUpRight size={12} />
              </button>
            ))
          ) : (
            <p className="field-note">
              Sin referencias directas a otros recursos.
            </p>
          )}
        </section>
      </div>
      <div className="inspector-footnote">
        <LockKeyhole size={13} />
        <span>
          {project.mode === "demo"
            ? "Los cambios del ejemplo viven en memoria."
            : "Los cambios se guardan en tu equipo."}
        </span>
      </div>
    </aside>
  );
}
