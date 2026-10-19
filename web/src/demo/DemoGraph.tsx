import { Box, Cpu, Hexagon, Network } from "lucide-react";
import type { Resource } from "../lib/types";
import type { Analysis } from "./types";

export function DemoGraph({
  analysis,
  selected,
  onSelect,
}: {
  analysis: Analysis;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const byId = new Map(
    analysis.resources.map((resource) => [resource.id, resource]),
  );
  const roots = analysis.resources.filter(
    (resource) => !resource.parentId || !byId.has(resource.parentId),
  );
  function node(resource: Resource) {
    const children = analysis.resources.filter(
      (item) => item.parentId === resource.id,
    );
    const scope = ["aws_vpc", "aws_subnet"].includes(resource.type);
    const Icon =
      resource.type === "aws_vpc"
        ? Hexagon
        : resource.type === "aws_subnet"
          ? Network
          : resource.type === "aws_instance"
            ? Cpu
            : Box;
    const value = resource.properties.find((property) =>
      ["cidr_block", "instance_type"].includes(property.name),
    );
    return (
      <div
        key={resource.id}
        className={`demo-node ${scope ? "demo-scope" : "demo-leaf"} ${resource.type === "aws_subnet" ? "demo-subnet" : ""}`}
      >
        <button
          type="button"
          className="demo-node-button"
          aria-label={`Seleccionar ${resource.id}`}
          aria-pressed={selected === resource.id}
          onClick={() => onSelect(resource.id)}
        >
          <span className="demo-node-icon">
            <Icon size={21} aria-hidden="true" />
          </span>
          <span className="demo-node-text">
            <strong>{resource.label}</strong>
            <code>{resource.type}</code>
            {value && <span>{String(value.value ?? value.expression)}</span>}
          </span>
        </button>
        {children.length > 0 && (
          <div className="demo-node-children">{children.map(node)}</div>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="demo-graph-canvas" aria-label="Recursos del ejemplo">
        {roots.length ? (
          roots.map(node)
        ) : (
          <p className="demo-empty">
            Todavía no hay recursos. Escribe un bloque <code>resource</code> o
            carga un ejemplo.
          </p>
        )}
      </div>
      {analysis.edges.length > 0 && (
        <details className="demo-relationships">
          <summary>{analysis.edges.length} referencias entre recursos</summary>
          <ul>
            {analysis.edges.map((edge) => (
              <li key={edge.id}>
                <code>{edge.source}</code>
                <span aria-label="referenciado por"> → </span>
                <code>{edge.target}</code>
                <small>{edge.label}</small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
