import { describe, expect, it } from "vitest";
import type { Resource, ResourceEdge } from "../../lib/types";
import { buildGraph } from "./graph";

function resource(id: string, parentId?: string, label = id): Resource {
  const [type, name] = id.split(".");
  return {
    id,
    type,
    name,
    label,
    file: "main.tf",
    line: 1,
    category: "other",
    properties: [],
    dependsOn: [],
    parentId,
  };
}

function reference(
  source: string,
  target: string,
  label = "subnet_id",
): ResourceEdge {
  return {
    id: `${source}:${target}:${label}`,
    source,
    target,
    label,
    kind: "reference",
  };
}

describe("architecture graph", () => {
  it("places every parent before its children and keeps all nodes within their containers", () => {
    // The API orders declarations by source, which need not be a hierarchy.
    const resources = [
      resource("aws_instance.web", "aws_subnet.app"),
      resource("aws_subnet.app", "aws_vpc.main"),
      resource("aws_security_group.app", "aws_vpc.main"),
      resource("aws_vpc.main"),
      resource("aws_subnet.data", "aws_vpc.main"),
      resource("aws_instance.worker", "aws_subnet.app"),
      resource("aws_db_instance.database", "aws_subnet.data"),
    ];
    const { nodes } = buildGraph(resources, [], "");
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const index = new Map(nodes.map((node, i) => [node.id, i]));

    expect(new Set(nodes.map((node) => node.id))).toEqual(
      new Set(resources.map((r) => r.id)),
    );
    expect(byId.get("aws_vpc.main")?.data.childCount).toBe(3);
    expect(byId.get("aws_subnet.app")?.data.childCount).toBe(2);
    expect(byId.get("aws_subnet.app")?.type).toBe("scope");
    expect(byId.get("aws_instance.web")?.type).toBe("resource");

    for (const node of nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
      if (!node.parentId) continue;
      const parent = byId.get(node.parentId)!;
      expect(index.get(parent.id)).toBeLessThan(index.get(node.id)!);
      expect(node.extent).toBe("parent");
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
      expect(node.position.x + Number(node.style?.width)).toBeLessThanOrEqual(
        Number(parent.style?.width),
      );
      expect(node.position.y + Number(node.style?.height)).toBeLessThanOrEqual(
        Number(parent.style?.height),
      );
    }
  });

  it("accommodates multiple subnet rows and children without overlapping sibling rectangles", () => {
    const resources = [resource("aws_vpc.main")];
    for (let subnet = 0; subnet < 5; subnet++) {
      const id = `aws_subnet.subnet_${subnet}`;
      resources.push(resource(id, "aws_vpc.main"));
      for (let instance = 0; instance <= subnet; instance++) {
        resources.push(
          resource(`aws_instance.instance_${subnet}_${instance}`, id),
        );
      }
    }
    const { nodes } = buildGraph(resources, [], "");
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.parentId !== b.parentId) continue;
        const overlapX =
          a.position.x < b.position.x + Number(b.style?.width) &&
          b.position.x < a.position.x + Number(a.style?.width);
        const overlapY =
          a.position.y < b.position.y + Number(b.style?.height) &&
          b.position.y < a.position.y + Number(a.style?.height);
        expect(overlapX && overlapY, `${a.id} overlaps ${b.id}`).toBe(false);
      }
      const node = nodes[i];
      if (!node.parentId) continue;
      const parent = nodes.find((candidate) => candidate.id === node.parentId)!;
      expect(node.position.y + Number(node.style?.height)).toBeLessThanOrEqual(
        Number(parent.style?.height),
      );
    }
  });

  it("keeps cross-resource edge direction and reason while using containment for parent links", () => {
    const resources = [
      resource("aws_vpc.main"),
      resource("aws_subnet.app", "aws_vpc.main"),
      resource("aws_instance.web", "aws_subnet.app"),
      resource("aws_security_group.app", "aws_vpc.main"),
    ];
    const relationship = reference(
      "aws_security_group.app",
      "aws_instance.web",
      "vpc_security_group_ids",
    );
    const relationships = [
      reference("aws_vpc.main", "aws_subnet.app", "vpc_id"),
      reference("aws_subnet.app", "aws_instance.web"),
      relationship,
    ];
    const { edges } = buildGraph(resources, relationships, "");
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: relationship.id,
      source: "aws_security_group.app",
      target: "aws_instance.web",
      data: { reason: "vpc_security_group_ids" },
    });
  });

  it("drops dangling edges and treats missing or unsuitable containers as roots", () => {
    const resources = [
      resource("aws_instance.web", "aws_subnet.missing"),
      resource("aws_security_group.app"),
      resource("aws_instance.worker", "aws_security_group.app"),
    ];
    const relationships = [
      reference("aws_subnet.missing", "aws_instance.web"),
      reference("aws_instance.web", "aws_instance.missing"),
      reference(
        "aws_security_group.app",
        "aws_instance.worker",
        "security_groups",
      ),
    ];
    const { nodes, edges } = buildGraph(resources, relationships, "");
    expect(nodes.every((node) => node.parentId === undefined)).toBe(true);
    expect(edges).toHaveLength(1);
    const ids = new Set(nodes.map((node) => node.id));
    expect(
      edges.every((edge) => ids.has(edge.source) && ids.has(edge.target)),
    ).toBe(true);
  });

  it("rejects cycles, self-parenting and subnet-to-subnet containment without losing declarations", () => {
    const resources = [
      resource("aws_vpc.main", "aws_subnet.app"),
      resource("aws_subnet.app", "aws_vpc.main"),
      resource("aws_subnet.second", "aws_subnet.third"),
      resource("aws_subnet.third", "aws_subnet.second"),
      resource("aws_subnet.self", "aws_subnet.self"),
      resource("aws_instance.web", "aws_instance.worker"),
      resource("aws_instance.worker", "aws_instance.web"),
    ];
    const { nodes } = buildGraph(resources, [], "");
    expect(nodes).toHaveLength(resources.length);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(resources.length);
    expect(
      nodes
        .filter((node) => node.parentId)
        .map((node) => [node.id, node.parentId]),
    ).toEqual([["aws_subnet.app", "aws_vpc.main"]]);
  });

  it("highlights only the selected node and its incident relationships", () => {
    const resources = [
      resource("aws_instance.a"),
      resource("aws_instance.b"),
      resource("aws_instance.c"),
    ];
    const relationships = [
      reference("aws_instance.a", "aws_instance.b"),
      reference("aws_instance.b", "aws_instance.c"),
    ];
    const { nodes, edges } = buildGraph(
      resources,
      relationships,
      "aws_instance.a",
    );
    expect(
      nodes.filter((node) => node.selected).map((node) => node.id),
    ).toEqual(["aws_instance.a"]);
    expect(Number(edges[0].style?.opacity)).toBeGreaterThan(
      Number(edges[1].style?.opacity),
    );
    expect(Number(edges[0].style?.strokeWidth)).toBeGreaterThan(
      Number(edges[1].style?.strokeWidth),
    );
    const unselected = buildGraph(resources, relationships, "");
    expect(unselected.nodes.some((node) => node.selected)).toBe(false);
    expect(unselected.edges[0].style).toEqual(unselected.edges[1].style);
  });

  it.each(["checkout", "AWS_INSTANCE", "instance.web"])(
    "searches label/type/address without deleting graph context: %s",
    (query) => {
      const resources = [
        resource("aws_vpc.main"),
        resource("aws_instance.web", "aws_vpc.main", "Checkout API"),
      ];
      const { nodes } = buildGraph(resources, [], "aws_instance.web", query);
      expect(nodes).toHaveLength(2);
      expect(
        nodes.find((node) => node.id === "aws_instance.web")?.data.muted,
      ).toBe(false);
      expect(nodes.find((node) => node.id === "aws_vpc.main")?.data.muted).toBe(
        true,
      );
      expect(
        nodes.find((node) => node.id === "aws_instance.web")?.selected,
      ).toBe(true);
    },
  );

  it("handles empty input and keeps source models immutable across recomputations", () => {
    expect(buildGraph([], [], "", "search")).toEqual({ nodes: [], edges: [] });
    const resources = [
      resource("aws_vpc.main"),
      resource("aws_instance.web", "aws_vpc.main"),
    ];
    const relationships = [
      reference("aws_vpc.main", "aws_instance.web", "vpc_id"),
    ];
    const before = structuredClone({ resources, relationships });
    const first = buildGraph(resources, relationships, "");
    buildGraph(resources, relationships, "aws_instance.web", "web");
    expect(buildGraph(resources, relationships, "")).toEqual(first);
    expect({ resources, relationships }).toEqual(before);
  });
});
