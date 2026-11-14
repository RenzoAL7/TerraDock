import type { NewAttribute, NewResource, Resource } from "../../lib/types";

/**
 * One argument of a template. Literals are written as they are; `fromName`
 * derives a text from the resource name; `expression` is a fixed HCL
 * expression; `reference` points to a declaration the user picks.
 */
export type TemplateAttribute = { name: string } & (
  | { value: string | number | boolean }
  | {
      fromName: (name: string) => string;
      /** Why the derived value differs from the name, if it had to. */
      notice?: (name: string) => string;
    }
  | { expression: string }
  | {
      reference: {
        /** Resource type, or "variable" for an input variable. */
        type: string;
        /** Attribute of the referenced resource, e.g. `id` or `arn`. */
        attribute?: string;
        label: string;
        /** AWS requires it: say so when nothing is picked. */
        required: boolean;
      };
    }
);

export interface ResourceTemplate {
  type: string;
  label: string;
  description: string;
  defaultName: string;
  attributes: TemplateAttribute[];
  /** Shown in the dialog whenever the template is chosen. */
  notice?: string;
}

const lambdaTrust = `jsonencode({
  Version = "2012-10-17"
  Statement = [{
    Action    = "sts:AssumeRole"
    Effect    = "Allow"
    Principal = { Service = "lambda.amazonaws.com" }
  }]
})`;

/**
 * The AWS resources most often drawn first, each with the arguments AWS
 * requires and nothing else. Values are starting points, not recommendations.
 */
export const templates: ResourceTemplate[] = [
  {
    type: "aws_vpc",
    label: "VPC",
    description: "Red privada con su bloque CIDR.",
    defaultName: "main",
    attributes: [{ name: "cidr_block", value: "10.0.0.0/16" }],
  },
  {
    type: "aws_subnet",
    label: "Subred",
    description: "Rango de direcciones dentro de una VPC.",
    defaultName: "app",
    attributes: [
      {
        name: "vpc_id",
        reference: {
          type: "aws_vpc",
          attribute: "id",
          label: "VPC",
          required: true,
        },
      },
      { name: "cidr_block", value: "10.0.1.0/24" },
    ],
  },
  {
    type: "aws_security_group",
    label: "Grupo de seguridad",
    description: "Reglas de tráfico; sin reglas no permite entradas.",
    defaultName: "web",
    attributes: [
      { name: "name", fromName: (name) => name },
      { name: "description", value: "Administrado con Terraform" },
      {
        name: "vpc_id",
        reference: {
          type: "aws_vpc",
          attribute: "id",
          label: "VPC",
          required: false,
        },
      },
    ],
  },
  {
    type: "aws_instance",
    label: "Instancia EC2",
    description: "Máquina virtual con una AMI y un tipo de instancia.",
    defaultName: "web",
    attributes: [
      {
        name: "ami",
        reference: { type: "variable", label: "AMI", required: true },
      },
      { name: "instance_type", value: "t3.micro" },
      {
        name: "subnet_id",
        reference: {
          type: "aws_subnet",
          attribute: "id",
          label: "Subred",
          required: false,
        },
      },
    ],
  },
  {
    type: "aws_s3_bucket",
    label: "Bucket S3",
    description: "Almacenamiento de objetos con un prefijo de nombre.",
    defaultName: "assets",
    attributes: [
      {
        name: "bucket_prefix",
        fromName: bucketPrefix,
        notice: bucketNotice,
      },
    ],
  },
  {
    type: "aws_iam_role",
    label: "Rol IAM",
    description: "Rol que puede asumir una función Lambda.",
    defaultName: "lambda",
    attributes: [
      { name: "name", fromName: (name) => name },
      { name: "assume_role_policy", expression: lambdaTrust },
    ],
  },
  {
    type: "aws_lambda_function",
    label: "Función Lambda",
    description: "Código empaquetado en lambda.zip con un rol de ejecución.",
    defaultName: "handler",
    attributes: [
      { name: "function_name", fromName: (name) => name },
      {
        name: "role",
        reference: {
          type: "aws_iam_role",
          attribute: "arn",
          label: "Rol IAM",
          required: true,
        },
      },
      { name: "runtime", value: "python3.12" },
      { name: "handler", value: "index.handler" },
      { name: "filename", value: "lambda.zip" },
    ],
  },
  {
    type: "aws_db_instance",
    label: "Base de datos RDS",
    description:
      "PostgreSQL cifrado, con la contraseña gestionada por AWS; se puede destruir sin snapshot final.",
    defaultName: "db",
    attributes: [
      { name: "engine", value: "postgres" },
      { name: "instance_class", value: "db.t3.micro" },
      { name: "allocated_storage", value: 20 },
      { name: "username", value: "app" },
      { name: "manage_master_user_password", value: true },
      { name: "storage_encrypted", value: true },
      // Destroyable as is, so it can be created and removed in Floci.
      { name: "deletion_protection", value: false },
      { name: "skip_final_snapshot", value: true },
    ],
    notice:
      "Para AWS real, activa deletion_protection y quita skip_final_snapshot.",
  },
  {
    type: "aws_internet_gateway",
    label: "Internet gateway",
    description: "Salida a internet para una VPC.",
    defaultName: "main",
    attributes: [
      {
        name: "vpc_id",
        reference: {
          type: "aws_vpc",
          attribute: "id",
          label: "VPC",
          required: false,
        },
      },
    ],
  },
];

/** Longest bucket_prefix base: AWS allows 37 characters with the "-". */
const BUCKET_BASE = 36;
/** Lowercase, "-" for "_", starting with a letter or digit. */
function bucketBase(name: string) {
  return (
    name
      .toLowerCase()
      .replaceAll("_", "-")
      .replace(/^[^a-z0-9]+/, "") || "bucket"
  );
}
/** Bucket name prefixes S3 reserves for its own use. */
const RESERVED_PREFIXES = ["xn--", "sthree-", "amzn-s3-demo-"];
const reservedPrefix = (prefix: string) =>
  RESERVED_PREFIXES.some((reserved) => prefix.startsWith(reserved));
function cutPrefix(base: string) {
  return `${base.slice(0, BUCKET_BASE).replace(/-+$/, "")}-`;
}
/** A valid S3 bucket_prefix derived from the resource name. */
export function bucketPrefix(name: string) {
  const prefix = cutPrefix(bucketBase(name));
  return reservedPrefix(prefix)
    ? cutPrefix(`bucket-${bucketBase(name)}`)
    : prefix;
}
function bucketNotice(name: string) {
  const base = bucketBase(name);
  const reserved = reservedPrefix(cutPrefix(base));
  const notes = [];
  if (reserved)
    notes.push(
      "bucket_prefix empieza por bucket- porque S3 reserva los nombres que empiezan por xn--, sthree- o amzn-s3-demo-.",
    );
  if ((reserved ? `bucket-${base}` : base).length > BUCKET_BASE)
    notes.push(
      `bucket_prefix se recorta a ${BUCKET_BASE + 1} caracteres: AWS no admite más.`,
    );
  return notes.join(" ");
}

/** Same rule the server applies to resource names. */
export function validName(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name);
}

/** Same rule the server applies to the name of a new file. */
export function validFileName(name: string) {
  // Windows device names, with any extension (nul.tf is the NUL device).
  const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
  return (
    /^[A-Za-z0-9_][A-Za-z0-9._-]*\.tf$/.test(name) &&
    name.length <= 128 &&
    !reserved.test(name)
  );
}

/** Declarations a reference argument can point to. */
export function candidates(resources: Resource[], type: string) {
  return resources.filter((r) =>
    type === "variable"
      ? r.block === "variable"
      : r.block === "resource" && r.type === type,
  );
}

export function referenceExpression(
  target: Resource,
  attribute: string | undefined,
) {
  return attribute ? `${target.id}.${attribute}` : target.id;
}

/** The template's default name, numbered if a resource already uses it. */
export function suggestName(template: ResourceTemplate, resources: Resource[]) {
  const taken = new Set(
    resources
      .filter((r) => r.block === "resource" && r.type === template.type)
      .map((r) => r.name),
  );
  if (!taken.has(template.defaultName)) return template.defaultName;
  for (let n = 2; ; n++) {
    const name = `${template.defaultName}_${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * The request for the server. `references` maps an argument name to the
 * chosen expression; an unassigned reference is left out of the block.
 */
export function buildResource(
  template: ResourceTemplate,
  name: string,
  references: Record<string, string>,
): NewResource {
  const attributes: NewAttribute[] = [];
  for (const attr of template.attributes) {
    if ("value" in attr)
      attributes.push({ name: attr.name, value: attr.value });
    else if ("fromName" in attr)
      attributes.push({ name: attr.name, value: attr.fromName(name) });
    else if ("expression" in attr)
      attributes.push({ name: attr.name, expression: attr.expression });
    else if (references[attr.name])
      attributes.push({ name: attr.name, expression: references[attr.name] });
  }
  return { type: template.type, name, attributes };
}
