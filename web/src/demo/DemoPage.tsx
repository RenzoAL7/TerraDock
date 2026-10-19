import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Download,
  FileCode2,
  Layers3,
  Network,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import type { Property, Resource } from "../lib/types";
import { createDemoEngine } from "./engine";
import { examples } from "./examples";
import { DemoGraph } from "./DemoGraph";
import type { Analysis, DemoResponse } from "./types";
import parserLicensesUrl from "./generated/parser-licenses.txt?url";
import fontLicensesUrl from "../landing/font-licenses.txt?url";
import "./styles.css";

function EditableProperty({
  property,
  disabled,
  onApply,
}: {
  property: Property;
  disabled: boolean;
  onApply: (property: string, value: string | boolean | number) => void;
}) {
  const [value, setValue] = useState(String(property.value ?? ""));
  const boolean = typeof property.value === "boolean";
  const number = typeof property.value === "number";
  return (
    <form
      className="demo-property"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(
          property.name,
          boolean ? value === "true" : number ? Number(value) : value,
        );
      }}
    >
      <label htmlFor={`property-${property.name}`}>{property.name}</label>
      <div className="demo-property-input">
        {boolean ? (
          <select
            id={`property-${property.name}`}
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            id={`property-${property.name}`}
            value={value}
            disabled={disabled}
            type={number ? "number" : "text"}
            step={number ? "any" : undefined}
            maxLength={512}
            required={number}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        <button
          type="submit"
          disabled={disabled || value === String(property.value)}
          aria-label={`Aplicar cambio en ${property.name}`}
          title="Aplicar al código"
        >
          <Check size={17} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

function Inspector({
  resource,
  disabled,
  onApply,
  onSource,
}: {
  resource?: Resource;
  disabled: boolean;
  onApply: (property: string, value: string | number | boolean) => void;
  onSource: () => void;
}) {
  return (
    <aside className="demo-inspector" aria-labelledby="properties-title">
      <div className="demo-panel-title">
        <SlidersHorizontal size={16} aria-hidden="true" />
        <h2 id="properties-title">Propiedades</h2>
      </div>
      {resource ? (
        <div className="demo-inspector-body">
          <p className="demo-resource-kind">RECURSO SELECCIONADO</p>
          <h3>{resource.label}</h3>
          <code className="demo-resource-id">{resource.id}</code>
          <button
            type="button"
            className="demo-source-link"
            onClick={onSource}
            disabled={disabled}
          >
            <FileCode2 size={14} aria-hidden="true" /> main.tf:{resource.line}{" "}
            <span>Ver en código</span>
          </button>
          <p className="demo-field-help">
            Cambia un valor y pulsa <Check size={13} aria-label="Aplicar" />{" "}
            para actualizar el código.
          </p>
          {resource.properties.map((property) =>
            property.editable ? (
              <EditableProperty
                key={`${resource.id}:${property.name}:${property.expression}`}
                property={property}
                disabled={disabled}
                onApply={onApply}
              />
            ) : (
              <div
                className="demo-readonly-property"
                key={`${property.name}:${property.line}`}
              >
                <span>{property.name}</span>
                <code>{property.expression}</code>
                <small>Edítalo en el código</small>
              </div>
            ),
          )}
        </div>
      ) : (
        <p className="demo-empty">
          Selecciona un recurso en la arquitectura para ver sus propiedades.
        </p>
      )}
    </aside>
  );
}

export function DemoPage() {
  const [code, setCode] = useState(examples[0].content);
  const codeRef = useRef(code);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const engine = useRef<ReturnType<typeof createDemoEngine> | null>(null);
  const mounted = useRef(false);
  const [epoch, setEpoch] = useState(0);
  const [exampleId, setExampleId] = useState(examples[0].id);
  const [evaluation, setEvaluation] = useState<DemoResponse | null>(null);
  const [lastValid, setLastValid] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState("aws_instance.api");
  const [working, setWorking] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    mounted.current = true;
    const instance = createDemoEngine();
    engine.current = instance;
    return () => {
      mounted.current = false;
      instance.dispose();
      engine.current = null;
    };
  }, [epoch]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      engine.current
        ?.request({ operation: "parse", content: code })
        .then((result) => {
          if (!active || codeRef.current !== code) return;
          setEvaluation(result);
          if (result.analysis?.valid) setLastValid(result.analysis);
          setError("");
          setWorking(false);
        })
        .catch((reason: Error) => {
          if (!active || codeRef.current !== code) return;
          setError(reason.message);
          setWorking(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [code, epoch]);

  function changeCode(value: string) {
    codeRef.current = value;
    setCode(value);
    setWorking(true);
    setNotice("");
    setError("");
  }

  function loadExample(id: string) {
    const next = examples.find((example) => example.id === id)!;
    setExampleId(id);
    setSelected("aws_instance.api");
    changeCode(next.content);
    // A reset must still re-run analysis when the text already matches.
    if (next.content === code) setEpoch((value) => value + 1);
  }

  const fresh =
    evaluation?.content === code &&
    evaluation.analysis?.valid &&
    !working &&
    !error &&
    !editing;
  const resource = lastValid?.resources.find((item) => item.id === selected);

  async function applyProperty(
    property: string,
    value: string | number | boolean,
  ) {
    if (!fresh || !resource || !engine.current) return;
    const source = codeRef.current;
    setEditing(true);
    setNotice("");
    try {
      const result = await engine.current.request({
        operation: "edit",
        content: source,
        resourceId: resource.id,
        property,
        value,
      });
      if (!mounted.current || source !== codeRef.current) return;
      codeRef.current = result.content;
      setCode(result.content);
      setEvaluation(result);
      if (result.analysis?.valid) setLastValid(result.analysis);
      setNotice(`${property} actualizado en el código y en la arquitectura.`);
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "No se pudo aplicar el cambio.",
        );
    } finally {
      if (mounted.current) setEditing(false);
    }
  }

  function goToSource() {
    if (!fresh || !resource || !textarea.current) return;
    const start = code
      .split("\n")
      .slice(0, resource.line - 1)
      .reduce((offset, line) => offset + line.length + 1, 0);
    textarea.current.focus();
    textarea.current.setSelectionRange(
      start,
      code.indexOf("\n", start) < 0 ? code.length : code.indexOf("\n", start),
    );
    textarea.current.scrollTop = Math.max(0, (resource.line - 4) * 23);
    textarea.current.scrollIntoView({ block: "nearest" });
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([code], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "terradock-demo.tf";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      "Descarga preparada: terradock-demo.tf, con el contenido del editor.",
    );
  }

  const diagnostics =
    evaluation?.content === code
      ? (evaluation.analysis?.diagnostics ?? [])
      : [];
  const stale = !fresh && Boolean(lastValid);
  return (
    <div className="demo-page">
      <a className="skip-link" href="#demo-workspace">
        Saltar al editor
      </a>
      <header className="demo-header">
        <a
          className="brand"
          href="../"
          aria-label="TerraDock, volver a la portada"
        >
          <span className="brand-mark">
            <Layers3 size={23} aria-hidden="true" />
          </span>
          <span>TerraDock</span>
        </a>
        <span className="demo-badge">
          <span className="status-dot" /> Demo interactiva
        </span>
        <a className="demo-back" href="../">
          <ArrowLeft size={15} aria-hidden="true" /> Volver a la portada
        </a>
      </header>
      <main className="demo-main">
        <div className="demo-intro">
          <div>
            <p className="eyebrow">PRUÉBALO AQUÍ</p>
            <h1>Del código a la arquitectura.</h1>
            <p>
              Edita este ejemplo o selecciona un recurso para cambiar sus
              propiedades.
            </p>
          </div>
          <p className="demo-boundary">
            Solo en tu navegador. Sin cuenta ni credenciales.
            <br />
            No crea recursos en AWS ni ejecuta Terraform.
          </p>
        </div>
        <div className="demo-toolbar">
          <div className="demo-example-picker">
            <label htmlFor="demo-example">Ejemplo</label>
            <select
              id="demo-example"
              value={exampleId}
              onChange={(event) => loadExample(event.target.value)}
              disabled={editing}
            >
              {examples.map((example) => (
                <option key={example.id} value={example.id}>
                  {example.name}
                </option>
              ))}
            </select>
          </div>
          <span className="demo-toolbar-hint">
            Prueba a cambiar <code>t3.micro</code> por <code>t3.small</code>.
          </span>
          <button
            type="button"
            onClick={() => loadExample(exampleId)}
            disabled={editing}
          >
            <RotateCcw size={15} aria-hidden="true" /> Reiniciar ejemplo
          </button>
          <button type="button" onClick={download}>
            <Download size={15} aria-hidden="true" /> Descargar .tf
          </button>
        </div>
        <div className="demo-workspace" id="demo-workspace" tabIndex={-1}>
          <section className="demo-code-panel" aria-labelledby="code-title">
            <div className="demo-panel-title">
              <FileCode2 size={16} aria-hidden="true" />
              <h2 id="code-title">main.tf</h2>
              <span>HCL · editable</span>
            </div>
            <label className="sr-only" htmlFor="demo-code">
              Código Terraform del ejemplo
            </label>
            <textarea
              ref={textarea}
              id="demo-code"
              aria-describedby="code-help"
              value={code}
              onChange={(event) => changeCode(event.target.value)}
              readOnly={editing}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
            />
            <div className="demo-code-footer" id="code-help">
              <Code2 size={14} aria-hidden="true" /> Cambios en memoria · se
              pierden al recargar
            </div>
          </section>
          <section className="demo-graph-panel" aria-labelledby="graph-title">
            <div className="demo-panel-title">
              <Network size={16} aria-hidden="true" />
              <h2 id="graph-title">Arquitectura</h2>
              <span>
                {lastValid
                  ? `${lastValid.resources.length} recursos`
                  : "Cargando"}
              </span>
            </div>
            <p
              className={`demo-graph-status ${stale ? "is-stale" : ""}`}
              role="status"
            >
              {working
                ? "Interpretando el código…"
                : fresh
                  ? "Vista del código actual · selecciona un recurso"
                  : lastValid
                    ? "Última vista válida · corrige el código para actualizar"
                    : "Preparando el ejemplo…"}
            </p>
            {lastValid ? (
              <DemoGraph
                analysis={lastValid}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <p className="demo-empty">
                Cargando el analizador en tu navegador…
              </p>
            )}
          </section>
          <Inspector
            resource={resource}
            disabled={!fresh}
            onApply={(property, value) => void applyProperty(property, value)}
            onSource={goToSource}
          />
        </div>
        <div className="demo-notice" role="status">
          {notice}
        </div>
        {error && (
          <div className="demo-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                setError("");
                setWorking(true);
                setEpoch((value) => value + 1);
              }}
            >
              Reintentar análisis
            </button>
          </div>
        )}
        {diagnostics.length > 0 && (
          <section className="demo-diagnostics" aria-label="Diagnósticos HCL">
            <h2>Revisa el código</h2>
            <ul>
              {diagnostics.slice(0, 12).map((diagnostic, index) => (
                <li key={index}>
                  <strong>
                    Línea {diagnostic.line} ·{" "}
                    {diagnostic.severity === "error" ? "Error" : "Aviso"}
                  </strong>
                  <p>{diagnostic.message}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        <footer className="demo-footer">
          <p>
            Representa recursos declarados y referencias. No valida proveedores
            ni despliegues; las variables y los módulos no se evalúan.
          </p>
          <a href="https://github.com/RenzoAL7/TerraDock#probar-la-demo">
            Abrir tus archivos con la app local{" "}
            <ArrowRight size={14} aria-hidden="true" />
          </a>
          <div>
            <a href={parserLicensesUrl}>Licencias del analizador</a>
            <a href={fontLicensesUrl}>Licencias de fuentes</a>
          </div>
        </footer>
      </main>
    </div>
  );
}
