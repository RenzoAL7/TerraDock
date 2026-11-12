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
import type { FlociJob, FlociStatus } from "../../lib/types";

const actionLabel: Record<FlociJob["action"], string> = {
  start: "Iniciar Floci",
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
  resourceCount: number;
  onRun: (
    action: FlociJob["action"],
    variables?: Record<string, string>,
  ) => void;
  onCancel: () => void;
}

export function DeployPanel({
  status,
  available,
  error,
  running,
  hasUnsaved,
  resourceCount,
  onRun,
  onCancel,
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
          <h2>Integración con Floci no disponible</h2>
          <p>Este servidor se inició sin el ejecutor de despliegue local.</p>
        </div>
      </div>
    );

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
      <section className="deploy-status">
        <div className={`deploy-check ${status?.reachable ? "ok" : ""}`}>
          <i />
          <div>
            <strong>Floci</strong>
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
              <Power size={14} /> Iniciar Floci
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
            <strong>Estado en Floci</strong>
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
        reales de tu entorno se descartan. Floci no emula todos los servicios ni
        tipos de AWS (por ejemplo, solo algunos tipos de instancia); si un apply
        falla a mitad, «Destruir» elimina lo que se creó.
      </p>
      {hasUnsaved && (
        <p className="field-note deploy-warning">
          <TriangleAlert size={13} /> Hay borradores sin guardar. El plan usa la
          última versión guardada.
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
            usan en Floci y no se guardan en tu carpeta.
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
          title="Destruir recursos en Floci"
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
              Destruir en Floci
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
