import type {
  Diagnostic,
  Finding,
  NewResource,
  Resource,
  ResourceEdge,
} from "../lib/types";

export interface Analysis {
  resources: Resource[];
  edges: ResourceEdge[];
  diagnostics: Diagnostic[];
  findings: Finding[];
  valid: boolean;
}

export interface DemoRequest {
  operation: "parse" | "edit" | "create";
  content: string;
  resourceId?: string;
  property?: string;
  value?: string | number | boolean;
  resource?: NewResource;
}

export interface DemoResponse {
  content: string;
  analysis?: Analysis;
  error?: string;
}
