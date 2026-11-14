import { describe, expect, it } from "vitest";
import { buildGraph, laneOf } from "../graph";
import { liftEdges } from "./layered";
import {
  centers,
  largeProject,
  outside,
  overlapping,
  positionsById,
  reference,
  resource,
  shuffled,
} from "./testFixtures";

const layered = (
  ...[resources, edges]: [
    Parameters<typeof buildGraph>[0],
    Parameters<typeof buildGraph>[1],
  ]
) => buildGraph(resources, edges, "", "", "layered");

describe("layered layout", () => {
  it("gives the same places whatever the order of the declarations", () => {
    const { resources, edges } = largeProject(120);
    const first = positionsById(layered(resources, edges).nodes);
    for (const seed of [1, 2, 3]) {
      const again = layered(shuffled(resources, seed), shuffled(edges, seed));
      expect(positionsById(again.nodes)).toEqual(first);
    }
  });

  it("keeps providers, variables and locals in columns on the left and outputs on the right", () => {
    const resources = [
      resource("aws_vpc.main"),
      resource("aws_subnet.app", "aws_vpc.main"),
      resource("aws_instance.top"),
      resource("aws_instance.bottom"),
      resource("aws_s3_bucket.logs"),
      resource("provider.aws"),
      // Named in the opposite order of their neighbors.
      resource("var.a_bottom"),
      resource("var.z_top"),
      resource("local.name"),
      resource("output.ip"),
    ];
    const edges = [
      reference("aws_instance.top", "aws_instance.bottom"),
      reference("var.z_top", "aws_instance.top"),
      reference("var.a_bottom", "aws_instance.bottom"),
      reference("aws_instance.bottom", "output.ip"),
    ];
    const { nodes } = layered(resources, edges);
    const at = (id: string) => nodes.find((n) => n.id === id)!;
    const main = nodes.filter(
      (n) => !n.parentId && laneOf(n.data.resource) === 0,
    );
    const mainLeft = Math.min(...main.map((n) => n.position.x));
    const mainRight = Math.max(
      ...main.map((n) => n.position.x + Number(n.style!.width)),
    );
    const x = (id: string) => at(id).position.x;
    expect(x("provider.aws")).toBeLessThan(x("var.z_top"));
    expect(x("var.z_top")).toBe(x("var.a_bottom"));
    expect(x("var.z_top")).toBeLessThan(x("local.name"));
    expect(x("local.name") + 214).toBeLessThan(mainLeft);
    expect(x("output.ip")).toBeGreaterThan(mainRight);
    // Ordered by where their neighbors are, not by name.
    expect(at("aws_instance.top").position.y).toBeLessThan(
      at("aws_instance.bottom").position.y,
    );
    expect(at("var.z_top").position.y).toBeLessThan(
      at("var.a_bottom").position.y,
    );
    expect(overlapping(nodes)).toEqual([]);
  });

  it.each([300, 1000])(
    "with %i resources: no overlaps, children inside, references downward",
    (count) => {
      const { resources, edges } = largeProject(count);
      const graph = layered(resources, edges);
      expect(overlapping(graph.nodes)).toEqual([]);
      expect(outside(graph.nodes)).toEqual([]);
      const c = centers(graph.nodes);
      const lane = new Set(
        graph.nodes.filter((n) => laneOf(n.data.resource) > 0).map((n) => n.id),
      );
      // Lanes are columns beside the diagram, ordered by their neighbors.
      const drawn = graph.edges.filter(
        (e) => !lane.has(e.source) && !lane.has(e.target),
      );
      const down = drawn.filter((e) => c.get(e.target)!.y > c.get(e.source)!.y);
      expect(drawn.length).toBeGreaterThan(count / 5);
      expect(down.length / drawn.length).toBeGreaterThan(0.9);
    },
  );

  it("draws more than 90 % of references downward across containers", () => {
    // References between VPCs and from loose resources into subnets.
    const resources = [];
    const edges = [];
    for (let v = 0; v < 6; v++) {
      resources.push(resource(`aws_vpc.v${v}`));
      for (let s = 0; s < 3; s++) {
        resources.push(resource(`aws_subnet.s${v}_${s}`, `aws_vpc.v${v}`));
        resources.push(
          resource(`aws_instance.i${v}_${s}`, `aws_subnet.s${v}_${s}`),
        );
        resources.push(
          resource(`aws_db_instance.d${v}_${s}`, `aws_subnet.s${v}_${s}`),
        );
        edges.push(
          reference(`aws_instance.i${v}_${s}`, `aws_db_instance.d${v}_${s}`),
        );
      }
      resources.push(resource(`aws_security_group.g${v}`, `aws_vpc.v${v}`));
      for (let s = 0; s < 3; s++)
        edges.push(
          reference(`aws_security_group.g${v}`, `aws_instance.i${v}_${s}`),
        );
      resources.push(resource(`aws_iam_role.r${v}`));
      edges.push(reference(`aws_iam_role.r${v}`, `aws_instance.i${v}_0`));
      if (v) edges.push(reference(`aws_vpc.v0`, `aws_security_group.g${v}`));
    }
    const graph = layered(resources, edges);
    const c = centers(graph.nodes);
    const down = graph.edges.filter(
      (e) => c.get(e.target)!.y > c.get(e.source)!.y,
    );
    expect(down.length / graph.edges.length).toBeGreaterThan(0.9);
    expect(overlapping(graph.nodes)).toEqual([]);
  });

  it("lifts references to the children of the closest common container", () => {
    const resources = [
      resource("aws_vpc.main"),
      resource("aws_subnet.a", "aws_vpc.main"),
      resource("aws_subnet.b", "aws_vpc.main"),
      resource("aws_instance.x", "aws_subnet.a"),
      resource("aws_instance.y", "aws_subnet.b"),
      resource("aws_s3_bucket.logs"),
    ];
    const { nodes } = buildGraph(resources, [], "");
    const lifted = liftEdges(nodes, [
      { source: "aws_instance.x", target: "aws_instance.y" },
      { source: "aws_s3_bucket.logs", target: "aws_instance.x" },
      // A node and its own container: nothing to connect.
      { source: "aws_instance.x", target: "aws_vpc.main" },
      { source: "aws_vpc.main", target: "aws_instance.y" },
      { source: "aws_subnet.a", target: "aws_instance.x" },
    ]);
    expect(Object.fromEntries(lifted)).toEqual({
      "aws_vpc.main": [["aws_subnet.a", "aws_subnet.b"]],
      undefined: [["aws_s3_bucket.logs", "aws_vpc.main"]],
    });
  });

  it("does not fail on references from a child to its container, cycles or self-references", () => {
    const resources = [
      resource("aws_vpc.main"),
      resource("aws_subnet.app", "aws_vpc.main"),
      resource("aws_instance.web", "aws_subnet.app"),
      resource("aws_instance.worker", "aws_subnet.app"),
    ];
    const edges = [
      reference("aws_instance.web", "aws_vpc.main"),
      reference("aws_instance.web", "aws_subnet.app"),
      reference("aws_instance.web", "aws_instance.worker"),
      reference("aws_instance.worker", "aws_instance.web"),
      reference("aws_instance.web", "aws_instance.web"),
    ];
    const graph = layered(resources, edges);
    expect(graph.nodes).toHaveLength(4);
    expect(overlapping(graph.nodes)).toEqual([]);
    expect(outside(graph.nodes)).toEqual([]);
  });

  it("packs unconnected parts in rows instead of one long line", () => {
    const resources = Array.from({ length: 40 }, (_, i) =>
      resource(`aws_s3_bucket.b${String(i).padStart(2, "0")}`),
    );
    const { nodes } = layered(resources, []);
    const xs = new Set(nodes.map((n) => n.position.x));
    const ys = new Set(nodes.map((n) => n.position.y));
    expect(xs.size).toBeGreaterThan(3);
    expect(ys.size).toBeGreaterThan(3);
    const width =
      Math.max(...nodes.map((n) => n.position.x)) + 214 - nodes[0].position.x;
    const height = Math.max(...nodes.map((n) => n.position.y)) + 96;
    expect(width / height).toBeGreaterThan(1);
    expect(width / height).toBeLessThan(4);
  });
});

describe("layered layout timing (Node)", () => {
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  it.each([
    [300, 50],
    [1000, 200],
  ])("lays out %i resources in less than %i ms", (count, limit) => {
    const { resources, edges } = largeProject(count);
    layered(resources, edges);
    const times: number[] = [];
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      layered(resources, edges);
      times.push(performance.now() - started);
    }
    expect(median(times)).toBeLessThan(limit);
  });
});
