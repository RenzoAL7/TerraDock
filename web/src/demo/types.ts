import type { Diagnostic, Finding, Resource, ResourceEdge } from "../lib/types";

export interface Analysis {
  resources: Resource[];
  edges: ResourceEdge[];
  diagnostics: Diagnostic[];
  findings: Finding[];
  valid: boolean;
}

export interface DemoRequest {
  operation: "parse" | "edit";
  content: string;
  resourceId?: string;
  property?: string;
  value?: string | number | boolean;
}

export interface DemoResponse {
  content: string;
  analysis?: Analysis;
  error?: string;
}
