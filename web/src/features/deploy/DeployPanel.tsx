import { useEffect, useRef, useState } from "react";
import {
  CircleStop,
  ClipboardList,
  Play,
  Power,
  RefreshCw,
  Rocket,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Dialog } from "../../components/Dialog";
import type { EmulatorId, FlociJob, FlociStatus } from "../../lib/types";

const actionLabel: Record<FlociJob["action"], string> = {
  start: "Iniciar emulador",
  plan: "Plan",
  apply: "Aplicar",
  destroy: "Destruir",
  refresh: "Leer estado",
};
const stateLabel: Record<FlociJob["state"], string> = {
  running: "En curso",
  succeeded: "Completado",
  failed: "Con errores",
  canceled: "Cancelado",
};

interface Props {
  status: FlociStatus | null;
  available: boolean;
  error: string;
  running: boolean;
  hasUnsaved: boolean;
  /** .tf.json files of the project: the local copy leaves them out. */
  jsonFiles: string[];
  resourceCount: number;
  onRun: (
    action: FlociJob["action"],
    variables?: Record<string, string>,
  ) => void;
  onCancel: () => void;
  onSelectEmulator: (emulator: EmulatorId) => void;
}

export function DeployPanel({
  status,
  available,
  error,
  running,
  hasUnsaved,
  jsonFiles,
  resourceCount,
  onRun,
  onCancel,
  onSelectEmulator,
}: Props) {
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const logRef = useRef<HTMLPreElement>(null);
  const job = status?.job;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [job?.log.length]);

  if (!available)
    return (
      <div className="deploy-content">
        <div className="empty-state">
          <Rocket size={35} />
          <h2>Despliegue local no disponible</h2>
          <p>Este servidor se inició sin el ejecutor de despliegue local.</p>
        </div>
      </div>
    );

  const emulators = status?.emulators ?? [];
  const current = emulators.find((e) => e.id === status?.emulator);
  const name = current?.name ?? "Emulador";
  const plan = status?.plan;
  const ready = !!status?.reachable && !!status.terraform;
  const counts = plan?.counts ?? {};
  const variables = status?.variables ?? [];
  const missing = variables.filter(
    (v) => v.required && !v.provided && !values[v.name]?.trim(),
  );
  const entered = Object.fromEntries(
    Object.entries(values).filter(([, v]) => v.trim()),
  );
  return (
    <div className="deploy-content">
      {emulators.length > 1 && (
        <div
          className="deploy-emulators"
          role="radiogroup"
          aria-label="Emulador local"
        >
          {emulators.map((e) => (
            <button
              key={e.id}
              role="radio"
              aria-checked={e.id === status?.emulator}
              className={e.id === status?.emulator ? "active" : ""}
              disabled={running}
              title={running ? "Espera a que termine la operación" : e.endpoint}
              onClick={() =>
                e.id !== status?.emulator && onSelectEmulator(e.id)
              }
            >
              {e.name}
              {e.experimental && <small>experimental</small>}
            </button>
          ))}
        </div>
      )}
      <section className="deploy-status">
        <div className={`deploy-check ${status?.reachable ? "ok" : ""}`}>
          <i />
          <div>
            <strong>{name}</strong>
            <span>
              {status
                ? status.reachable
                  ? `Conectado · ${status.endpoint}`
                  : `Sin respuesta en ${status.endpoint}`
                : "Comprobando…"}
            </span>
          </div>
          {status && !status.reachable && status.canStart && (
            <button
              className="button-secondary"
              disabled={running}
              onClick={() => onRun("start")}
            >
              <Power size={14} /> Iniciar {name}
            </button>
          )}
        </div>
        <div className={`deploy-check ${status?.terraform ? "ok" : ""}`}>
          <i />
          <div>
            <strong>Terraform</strong>
            <span>
              {status?.terraform
                ? `v${status.terraformVersion || "?"} · ${status.terraform}`
                : "No se encontró terraform ni tofu en el PATH"}
            </span>
          </div>
        </div>
        <div className="deploy-check ok">
          <i />
          <div>
            <strong>Estado en {name}</strong>
            <span>
              {status?.deployed.length ?? 0} de {resourceCount} recursos
              desplegados
            </span>
          </div>
        </div>
      </section>

      <p className="analysis-note">
        TerraDock ejecuta Terraform sobre una copia privada de los archivos
        guardados. Tu carpeta no se modifica: los endpoints, las credenciales de
        prueba y el estado local solo existen en esa copia. Las credenciales AWS
        reales de tu entorno se descartan. Ningún emulador reproduce AWS por
        completo; si un apply falla a mitad, «Destruir» elimina lo que se creó.
      </p>
      {status?.emulator === "floci" && (
        <p className="field-note" data-testid="emulator-note">
          Floci no emula todos los servicios ni tipos de AWS (por ejemplo, solo
          algunos tipos de instancia).
        </p>
      )}
      {status?.emulator === "aws" && (
        <p className="field-note deploy-warning" data-testid="emulator-note">
          <TriangleAlert size={13} />
          <span>
            AWS Emulator es el emulador oficial de AWS y está en desarrollo
            activo. Se ejecuta en Docker; la primera vez construye su imagen
            (descarga ~200 MB). Guarda los recursos solo en memoria: al
            reiniciarlo se pierden y TerraDock descarta el estado anterior. Por
            ahora rechaza <code>aws_instance</code> sin{" "}
            <code>availability_zone</code> y <code>aws_db_instance</code> sin{" "}
            <code>engine_version</code>.
          </span>
        </p>
      )}
      {hasUnsaved && (
        <p className="field-note deploy-warning">
          <TriangleAlert size={13} /> Hay borradores sin guardar. El plan usa la
          última versión guardada.
        </p>
      )}
      {jsonFiles.length > 0 && (
        <p className="field-note deploy-warning" data-testid="floci-json">
          <TriangleAlert size={13} /> El despliegue local omite{" "}
          {jsonFiles.length === 1 ? "el archivo" : "los archivos"}{" "}
          {jsonFiles.join(", ")}: el plan solo usa los archivos .tf.
        </p>
      )}
      {error && (
        <p className="field-note deploy-warning" role="alert">
          <TriangleAlert size={13} /> {error}
        </p>
      )}

      {variables.length > 0 && (
        <section className="deploy-variables">
          <h3>Variables</h3>
          <p className="field-note">
            Se leen de <code>terraform.tfvars</code> y{" "}
            <code>*.auto.tfvars</code>. Los valores que escribas aquí solo se
            usan en el emulador y no se guardan en tu carpeta.
          </p>
          {variables.map((v) => (
            <label
              key={v.name}
              className={`deploy-variable ${v.required && !v.provided && !values[v.name] ? "missing" : ""}`}
            >
              <span>
                <code>{v.name}</code>
                {v.description && <small>{v.description}</small>}
              </span>
              <input
                aria-label={`Variable ${v.name}`}
                value={values[v.name] ?? ""}
                placeholder={
                  v.provided
                    ? "Definida"
                    : v.required
                      ? "Obligatoria"
                      : "Usa el valor por defecto"
                }
                spellCheck={false}
                onChange={(e) =>
                  setValues((current) => ({
                    ...current,
                    [v.name]: e.target.value,
                  }))
                }
              />
            </label>
          ))}
        </section>
      )}

      <div className="deploy-actions">
        <button
          className="button-primary"
          disabled={!ready || running || missing.length > 0}
          title={
            missing.length
              ? `Faltan variables: ${missing.map((v) => v.name).join(", ")}`
              : ""
          }
          onClick={() => onRun("plan", entered)}
        >
          <ClipboardList size={15} /> Generar plan
        </button>
        <button
          className="button-primary"
          disabled={!ready || running || !plan || plan.stale}
          title={plan?.stale ? "Los archivos cambiaron: genera otro plan" : ""}
          onClick={() => onRun("apply")}
        >
          <Play size={15} /> Aplicar plan
        </button>
        <button
          className="button-secondary"
          disabled={!ready || running}
          onClick={() => onRun("refresh")}
        >
          <RefreshCw size={15} /> Leer estado
        </button>
        <button
          className="button-secondary danger"
          disabled={!ready || running || !status?.deployed.length}
          onClick={() => setConfirmDestroy(true)}
        >
          <Trash2 size={15} /> Destruir
        </button>
        {running && (
          <button className="button-secondary" onClick={onCancel}>
            <CircleStop size={15} /> Cancelar
          </button>
        )}
      </div>

      {plan && (
        <div className={`plan-summary ${plan.stale ? "stale" : ""}`}>
          <span className="plan-create">+{counts.create ?? 0} crear</span>
          <span className="plan-update">~{counts.update ?? 0} actualizar</span>
          <span className="plan-replace">
            ±{counts.replace ?? 0} reemplazar
          </span>
          <span className="plan-delete">−{counts.delete ?? 0} eliminar</span>
          {plan.stale && (
            <strong>Plan desactualizado: los archivos cambiaron.</strong>
          )}
        </div>
      )}

      {job && (
        <section className={`deploy-job ${job.state}`}>
          <header>
            <strong>{actionLabel[job.action]}</strong>
            <span>{stateLabel[job.state]}</span>
            {job.error && <em>{job.error}</em>}
          </header>
          <pre ref={logRef} data-testid="deploy-log">
            {job.log.join("\n") || "Preparando…"}
          </pre>
        </section>
      )}

      {confirmDestroy && (
        <Dialog
          title={`Destruir recursos en ${name}`}
          onClose={() => setConfirmDestroy(false)}
        >
          <p className="dialog-intro">
            Se eliminarán del emulador los {status?.deployed.length} recursos de
            este proyecto. No afecta a tus archivos ni a AWS.
          </p>
          <div className="dialog-footer">
            <button
              className="button-secondary"
              onClick={() => setConfirmDestroy(false)}
            >
              Cancelar
            </button>
            <button
              className="button-primary"
              onClick={() => {
                setConfirmDestroy(false);
                onRun("destroy");
              }}
            >
              Destruir en {name}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
