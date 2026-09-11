export type Mode = "demo" | "local";
export type Category =
  | "network"
  | "compute"
  | "security"
  | "storage"
  | "database"
  | "loadbalancer"
  | "other";
export interface SourceFile {
  path: string;
  content: string;
  revision: string;
}
export interface Property {
  name: string;
  expression: string;
  value?: string | number | boolean;
  kind: "literal" | "expression";
  editable: boolean;
  line: number;
}
export interface Resource {
  id: string;
  type: string;
  name: string;
  file: string;
  line: number;
  category: Category;
  label: string;
  properties: Property[];
  dependsOn: string[];
  parentId?: string;
}
export interface ResourceEdge {
  id: string;
  source: string;
  target: string;
  kind: "reference" | "dependency";
  label: string;
}
export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  file: string;
  line: number;
}
export interface Finding {
  id: string;
  severity: "warning" | "info";
  resourceId: string;
  title: string;
  detail: string;
  file: string;
  line: number;
}
export interface Project {
  id: string;
  instanceId: string;
  sequence: number;
  name: string;
  mode: Mode;
  path: string;
  revision: string;
  files: SourceFile[];
  resources: Resource[];
  edges: ResourceEdge[];
  diagnostics: Diagnostic[];
  findings: Finding[];
  valid: boolean;
}
export interface Session {
  token: string;
  instanceId: string;
  root: string;
  mode: Mode;
  version: string;
}
export interface Directory {
  path: string;
  parent: string;
  root: string;
  entries: { name: string; path: string; hasTerraform: boolean }[];
}
export interface Draft {
  projectId: string;
  content: string;
  baseRevision: string;
}

export function normalizeProject(project: Project): Project {
  return {
    ...project,
    files: project.files ?? [],
    resources: (project.resources ?? []).map((r) => ({
      ...r,
      properties: r.properties ?? [],
      dependsOn: r.dependsOn ?? [],
    })),
    edges: project.edges ?? [],
    diagnostics: project.diagnostics ?? [],
    findings: project.findings ?? [],
  };
}
