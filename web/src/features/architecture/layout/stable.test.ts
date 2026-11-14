import { describe, expect, it } from "vitest";
import type { Resource } from "../../../lib/types";
import { buildGraph, type ResourceNode } from "../graph";
import { stabilize, type Remembered } from "./stable";
import {
  largeProject,
  overlapping,
  outside,
  positionsById,
  reference,
  resource,
} from "./testFixtures";

const at = (nodes: ResourceNode[], id: string) =>
  nodes.find((n) => n.id === id)!;

/** A VPC with four subnets in two columns, one instance in each. */
function vpcWithSubnets(extra: Resource[] = []) {
  const resources = [resource("aws_vpc.main")];
  for (let s = 0; s < 4; s++) {
    resources.push(resource(`aws_subnet.subnet_${s}`, "aws_vpc.main"));
    resources.push(resource(`aws_instance.i_${s}_0`, `aws_subnet.subnet_${s}`));
  }
  resources.push(resource("aws_s3_bucket.logs"));
  return [...resources, ...extra];
}

/** What the canvas does on each update: build (grid), then stabilize. */
function update(
  prev: ResourceNode[],
  resources: Resource[],
  edges = [] as ReturnType<typeof reference>[],
  remembered: Remembered = new Map(),
) {
  const graph = buildGraph(resources, edges, "");
  return stabilize(prev, graph.nodes, graph.edges, remembered);
}

describe("stabilize", () => {
  it("changes nothing when the structure did not change", () => {
    for (const layout of ["grid", "layered"] as const) {
      const prev = buildGraph(vpcWithSubnets(), [], "", "", layout).nodes;
      const next = update(prev, vpcWithSubnets());
      expect(positionsById(next)).toEqual(positionsById(prev));
      expect(next.map((n) => n.style)).toEqual(prev.map((n) => n.style));
    }
  });

  it("returns the built graph as is when there was nothing before", () => {
    const graph = buildGraph(vpcWithSubnets(), [], "");
    expect(stabilize([], graph.nodes, graph.edges)).toBe(graph.nodes);
  });

  it("pushes only the siblings a growing subnet overlaps (subnet_0 never covers subnet_2)", () => {
    const prev = buildGraph(vpcWithSubnets(), [], "").nodes;
    const grown = vpcWithSubnets([
      resource("aws_instance.i_0_1", "aws_subnet.subnet_0"),
      resource("aws_instance.i_0_2", "aws_subnet.subnet_0"),
    ]);
    const next = update(prev, grown);
    expect(overlapping(next)).toEqual([]);
    expect(outside(next)).toEqual([]);
    const subnet0 = at(next, "aws_subnet.subnet_0");
    expect(Number(subnet0.style!.height)).toBeGreaterThan(
      Number(at(prev, "aws_subnet.subnet_0").style!.height),
    );
    // The grown subnet and the column beside it stay; the one below moves.
    for (const id of [
      "aws_subnet.subnet_0",
      "aws_subnet.subnet_1",
      "aws_subnet.subnet_3",
      "aws_instance.i_0_0",
    ])
      expect(at(next, id).position).toEqual(at(prev, id).position);
    expect(at(next, "aws_subnet.subnet_2").position.y).toBeGreaterThanOrEqual(
      subnet0.position.y + Number(subnet0.style!.height),
    );
    // The VPC fits its children; its sibling bucket did not overlap it.
    expect(at(next, "aws_s3_bucket.logs").position).toEqual(
      at(prev, "aws_s3_bucket.logs").position,
    );
  });

  it("puts a resource inserted mid-file in a free place without moving the others", () => {
    const base = vpcWithSubnets([
      resource("aws_instance.i_1_1", "aws_subnet.subnet_1"),
    ]);
    const prev = buildGraph(base, [], "", "", "layered").nodes;
    // Declared before the existing instance of subnet_1, as if typed above it.
    const inserted = [...base];
    inserted.splice(
      inserted.findIndex((r) => r.id === "aws_instance.i_1_0"),
      0,
      resource("aws_instance.typed", "aws_subnet.subnet_1"),
    );
    const next = update(prev, inserted);
    expect(overlapping(next)).toEqual([]);
    expect(outside(next)).toEqual([]);
    for (const n of prev)
      if (n.parentId === "aws_subnet.subnet_1")
        expect(at(next, n.id).position).toEqual(n.position);
  });

  it.each([
    // Below the last bucket of the column the place is free.
    ["aws_s3_bucket.c", 0, 120],
    // Below the middle one it is taken (by c): the next free place in that
    // column, closer than the one beside it.
    ["aws_s3_bucket.b", 0, 240],
  ])(
    "places a new top-level resource next to its first neighbor (%s)",
    (neighbor, dx, dy) => {
      const resources = [
        resource("aws_s3_bucket.a"),
        resource("aws_s3_bucket.b"),
        resource("aws_s3_bucket.c"),
      ];
      const prev = buildGraph(resources, [], "", "", "layered").nodes;
      const next = update(
        prev,
        [...resources, resource("aws_lambda_function.fn")],
        [reference(neighbor, "aws_lambda_function.fn")],
      );
      const n = at(next, neighbor),
        fn = at(next, "aws_lambda_function.fn");
      expect(Math.abs(fn.position.x - n.position.x)).toBe(dx);
      expect(fn.position.y - n.position.y).toBe(dy);
      expect(overlapping(next)).toEqual([]);
      expect(positionsById(next.filter((m) => m.id !== fn.id))).toEqual(
        positionsById(prev),
      );
    },
  );

  it("keeps dragged nodes where the user left them and fits a created one without references in", () => {
    const resources = [resource("aws_vpc.main"), resource("aws_s3_bucket.a")];
    // As if dragged: neither is where a layout would put it.
    const prev = buildGraph(resources, [], "", "", "layered").nodes.map(
      (n, i) => ({ ...n, position: { x: 400 + i * 7, y: 3 + i * 300 } }),
    );
    const next = update(prev, [...resources, resource("aws_vpc.edge")]);
    expect(positionsById(next.filter((n) => n.id !== "aws_vpc.edge"))).toEqual(
      positionsById(prev),
    );
    expect(overlapping(next)).toEqual([]);
    expect(at(next, "aws_vpc.edge").position.x).toBeGreaterThanOrEqual(0);
    expect(at(next, "aws_vpc.edge").position.y).toBeGreaterThanOrEqual(0);
  });

  it("gives a renamed resource the place of the old name", () => {
    const prev = buildGraph(vpcWithSubnets(), [], "", "", "layered").nodes;
    const renamed = vpcWithSubnets().map((r) =>
      r.id === "aws_instance.i_2_0"
        ? resource("aws_instance.renamed", "aws_subnet.subnet_2")
        : r,
    );
    const next = update(prev, renamed);
    expect(at(next, "aws_instance.renamed").position).toEqual(
      at(prev, "aws_instance.i_2_0").position,
    );
    expect(overlapping(next)).toEqual([]);
  });

  it("keeps a renamed container and its children in place", () => {
    const prev = buildGraph(vpcWithSubnets(), [], "", "", "layered").nodes;
    const renamed = vpcWithSubnets().map((r) =>
      r.id === "aws_subnet.subnet_3"
        ? resource("aws_subnet.web", "aws_vpc.main")
        : r.parentId === "aws_subnet.subnet_3"
          ? { ...r, parentId: "aws_subnet.web" }
          : r,
    );
    const next = update(prev, renamed);
    expect(at(next, "aws_subnet.web").position).toEqual(
      at(prev, "aws_subnet.subnet_3").position,
    );
    expect(at(next, "aws_instance.i_3_0").position).toEqual(
      at(prev, "aws_instance.i_3_0").position,
    );
  });

  it("returns a removed resource to its place when it comes back (undo)", () => {
    const remembered: Remembered = new Map();
    const all = vpcWithSubnets([resource("aws_s3_bucket.z")]);
    const prev = buildGraph(all, [], "", "", "layered").nodes;
    const without = update(
      prev,
      all.filter((r) => r.id !== "aws_s3_bucket.z"),
      [],
      remembered,
    );
    expect(remembered.has("aws_s3_bucket.z")).toBe(true);
    const back = update(without, all, [], remembered);
    expect(at(back, "aws_s3_bucket.z").position).toEqual(
      at(prev, "aws_s3_bucket.z").position,
    );
    // React may run a state updater twice: the second run agrees.
    expect(update(without, all, [], remembered)).toEqual(back);
  });

  it("puts a returning resource next to its old place if that place was taken", () => {
    const remembered: Remembered = new Map();
    const all = [resource("aws_s3_bucket.a"), resource("aws_s3_bucket.z")];
    const prev = buildGraph(all, [], "", "", "layered").nodes;
    const old = at(prev, "aws_s3_bucket.z").position;
    const gone = update(prev, [all[0]], [], remembered);
    // Something else took the place meanwhile.
    const other = gone.concat({
      ...at(prev, "aws_s3_bucket.z"),
      id: "aws_sqs_queue.q",
      data: {
        ...at(prev, "aws_s3_bucket.z").data,
        resource: resource("aws_sqs_queue.q"),
      },
    });
    const back = update(
      other,
      [...all, resource("aws_sqs_queue.q")],
      [],
      remembered,
    );
    const z = at(back, "aws_s3_bucket.z").position;
    expect(overlapping(back)).toEqual([]);
    expect(Math.abs(z.x - old.x) + Math.abs(z.y - old.y)).toBeLessThan(400);
  });

  it("arranges the children of a new container and places it without overlap", () => {
    const prev = buildGraph(vpcWithSubnets(), [], "", "", "layered").nodes;
    const next = update(prev, [
      ...vpcWithSubnets(),
      resource("aws_vpc.edge"),
      resource("aws_subnet.edge_a", "aws_vpc.edge"),
      resource("aws_instance.edge_1", "aws_subnet.edge_a"),
    ]);
    expect(overlapping(next)).toEqual([]);
    expect(outside(next)).toEqual([]);
    for (const n of prev) expect(at(next, n.id).position).toEqual(n.position);
  });

  it("shrinks a container to its children when one is removed, moving nothing", () => {
    const base = vpcWithSubnets([
      resource("aws_instance.i_0_1", "aws_subnet.subnet_0"),
    ]);
    const prev = buildGraph(base, [], "", "", "layered").nodes;
    const next = update(
      prev,
      base.filter((r) => r.id !== "aws_instance.i_0_1"),
    );
    expect(
      Number(at(next, "aws_subnet.subnet_0").style!.height),
    ).toBeLessThanOrEqual(
      Number(at(prev, "aws_subnet.subnet_0").style!.height),
    );
    for (const n of next) expect(n.position).toEqual(at(prev, n.id).position);
  });

  it("is deterministic: the same input twice gives the same result", () => {
    const prev = buildGraph(vpcWithSubnets(), [], "", "", "layered").nodes;
    const input = vpcWithSubnets([
      resource("aws_instance.new", "aws_subnet.subnet_1"),
      resource("aws_s3_bucket.new"),
    ]);
    expect(update(prev, input, [], new Map())).toEqual(
      update(prev, input, [], new Map()),
    );
  });

  it("fits hundreds of new resources at once among a thousand without overlap", () => {
    const base = largeProject(1000);
    const prev = buildGraph(
      base.resources,
      base.edges,
      "",
      "",
      "layered",
    ).nodes;
    const instances = base.resources.filter((r) => r.type === "aws_instance");
    const added = Array.from({ length: 500 }, (_, k) =>
      resource(`aws_s3_bucket.b${k}`),
    );
    // Half of them next to an instance, the other half with no neighbor.
    const links = added
      .filter((_, k) => k % 2 === 0)
      .map((r, k) => reference(instances[k % instances.length].id, r.id));
    const next = update(
      prev,
      [...base.resources, ...added],
      [...base.edges, ...links],
    );
    expect(overlapping(next)).toEqual([]);
    expect(outside(next)).toEqual([]);
    for (const n of prev) expect(at(next, n.id).position).toEqual(n.position);
  });

  it("keeps new resources off a very large container", () => {
    const resources = [
      resource("aws_vpc.big"),
      resource("aws_instance.far", "aws_vpc.big"),
      resource("aws_s3_bucket.a"),
    ];
    // Dragged far inside the VPC, so the VPC spans thousands of pixels.
    const prev = buildGraph(resources, [], "", "", "layered").nodes.map((n) =>
      n.id === "aws_instance.far"
        ? { ...n, position: { x: 4000, y: 4000 } }
        : n,
    );
    const laidOut = update(prev, resources);
    expect(Number(at(laidOut, "aws_vpc.big").style!.width)).toBeGreaterThan(
      4000,
    );
    const added = Array.from({ length: 30 }, (_, k) =>
      resource(`aws_sqs_queue.q${k}`),
    );
    const next = update(
      laidOut,
      [...resources, ...added],
      [reference("aws_vpc.big", "aws_sqs_queue.q0")],
    );
    expect(overlapping(next)).toEqual([]);
    for (const n of laidOut)
      expect(at(next, n.id).position).toEqual(n.position);
  });
});
