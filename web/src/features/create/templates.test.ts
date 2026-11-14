import { describe, expect, it } from "vitest";
import type { Resource } from "../../lib/types";
import {
  bucketPrefix,
  buildResource,
  candidates,
  suggestName,
  templates,
  validFileName,
  validName,
} from "./templates";

const resource = (
  id: string,
  block: Resource["block"] = "resource",
): Resource => {
  const [type, name] =
    block === "variable" ? ["variable", id.slice(4)] : id.split(".");
  return {
    id,
    block,
    type,
    name,
    file: "main.tf",
    line: 1,
    category: "other",
    label: name,
    properties: [],
    dependsOn: [],
  };
};
const template = (type: string) => templates.find((t) => t.type === type)!;

describe("resource templates", () => {
  it("cover the common AWS types with unique, valid defaults", () => {
    const types = templates.map((t) => t.type);
    expect(new Set(types).size).toBe(types.length);
    for (const type of [
      "aws_vpc",
      "aws_subnet",
      "aws_security_group",
      "aws_instance",
      "aws_s3_bucket",
      "aws_iam_role",
      "aws_lambda_function",
      "aws_db_instance",
    ])
      expect(types).toContain(type);
    for (const t of templates) {
      expect(validName(t.defaultName)).toBe(true);
      const names = t.attributes.map((a) => a.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("builds literals, names and chosen references, leaving out unassigned ones", () => {
    expect(
      buildResource(template("aws_subnet"), "app", {
        vpc_id: "aws_vpc.main.id",
      }),
    ).toEqual({
      type: "aws_subnet",
      name: "app",
      attributes: [
        { name: "vpc_id", expression: "aws_vpc.main.id" },
        { name: "cidr_block", value: "10.0.1.0/24" },
      ],
    });
    expect(buildResource(template("aws_subnet"), "app", {}).attributes).toEqual(
      [{ name: "cidr_block", value: "10.0.1.0/24" }],
    );
    expect(
      buildResource(template("aws_s3_bucket"), "Static_Assets", {}).attributes,
    ).toEqual([{ name: "bucket_prefix", value: "static-assets-" }]);
  });

  it("derives a valid bucket_prefix from long names and names starting with _", () => {
    const valid = /^[a-z0-9][a-z0-9-]{0,35}-$/;
    for (const name of [
      "_logs",
      "__",
      "-",
      "A".repeat(64),
      "_".repeat(10) + "x",
    ])
      expect(bucketPrefix(name)).toMatch(valid);
    expect(bucketPrefix("_logs")).toBe("logs-");
    expect(bucketPrefix("__")).toBe("bucket-");
    expect(bucketPrefix("a".repeat(64))).toHaveLength(37);
    // Cut at a "-" without doubling it.
    expect(bucketPrefix("a".repeat(35) + "_b")).toBe("a".repeat(35) + "-");
    const s3 = template("aws_s3_bucket").attributes[0];
    expect("notice" in s3 && s3.notice!("a".repeat(40))).toContain("37");
    expect("notice" in s3 && s3.notice!("logs")).toBe("");
  });

  it("keeps the RDS template destroyable and says what to change for real AWS", () => {
    const rds = template("aws_db_instance");
    const attrs = buildResource(rds, "db", {}).attributes;
    expect(attrs).toContainEqual({ name: "storage_encrypted", value: true });
    expect(attrs).toContainEqual({ name: "deletion_protection", value: false });
    expect(attrs).toContainEqual({ name: "skip_final_snapshot", value: true });
    expect(rds.notice).toContain("deletion_protection");
    expect(rds.notice).toContain("skip_final_snapshot");
  });

  it("never derives a bucket_prefix S3 reserves", () => {
    expect(bucketPrefix("xn__logs")).toBe("bucket-xn--logs-");
    expect(bucketPrefix("sthree")).toBe("bucket-sthree-");
    expect(bucketPrefix("sthree_configurator")).toBe(
      "bucket-sthree-configurator-",
    );
    expect(bucketPrefix("amzn_s3_demo")).toBe("bucket-amzn-s3-demo-");
    expect(bucketPrefix("amzn_s3_demo_" + "x".repeat(40))).toHaveLength(37);
    // Close but not reserved: kept as is.
    expect(bucketPrefix("xn_logs")).toBe("xn-logs-");
    expect(bucketPrefix("amzn_s3")).toBe("amzn-s3-");
    const s3 = template("aws_s3_bucket").attributes[0];
    const notice = "notice" in s3 ? s3.notice! : () => "";
    expect(notice("sthree")).toContain("S3 reserva");
    expect(notice("sthree")).not.toContain("37");
    expect(notice("amzn_s3_demo_" + "x".repeat(40))).toContain("37");
  });

  it("offers only declarations of the referenced kind", () => {
    const all = [
      resource("aws_vpc.main"),
      resource("data.aws_vpc.shared", "data"),
      resource("var.ami_id", "variable"),
    ];
    expect(candidates(all, "aws_vpc").map((r) => r.id)).toEqual([
      "aws_vpc.main",
    ]);
    expect(candidates(all, "variable").map((r) => r.id)).toEqual([
      "var.ami_id",
    ]);
  });

  it("numbers the suggested name when it is taken", () => {
    const vpc = template("aws_vpc");
    expect(suggestName(vpc, [])).toBe("main");
    expect(
      suggestName(vpc, [resource("aws_vpc.main"), resource("aws_vpc.main_2")]),
    ).toBe("main_3");
    // Another type with the same name does not count.
    expect(suggestName(vpc, [resource("aws_subnet.main")])).toBe("main");
  });

  it("validates names and new file names like the server", () => {
    for (const name of ["a", "_x", "web-1", "Web_2"])
      expect(validName(name)).toBe(true);
    for (const name of ["", "1a", "a.b", "a b", "ñ", "x".repeat(65)])
      expect(validName(name)).toBe(false);
    for (const name of [
      "main.tf",
      "a.tf",
      "net-work_2.tf",
      "console.tf",
      "com10.tf",
    ])
      expect(validFileName(name)).toBe(true);
    for (const name of [
      ".tf",
      ".hidden.tf",
      "-x.tf",
      "../x.tf",
      "dir/x.tf",
      "x.tf.json",
      "a b.tf",
      "nul.tf",
      "NUL.tf",
      "con.backup.tf",
      "com1.tf",
      "Lpt9.tf",
    ])
      expect(validFileName(name)).toBe(false);
  });
});
