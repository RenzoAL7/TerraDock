import { describe, expect, it } from "vitest";
import type { Property, Resource, ResourceEdge } from "../../lib/types";
import { buildGraph } from "./graph";
import { diagramToSvg, type ExportCaption } from "./exportDiagram";
import { escapeXml, iconFor, iconNodes } from "./diagramIcons";
import { MAX_PIXELS, pngScale } from "./rasterize";

const blocks: Record<string, Resource["block"]> = {
  var: "variable",
  local: "local",
  output: "output",
  provider: "provider",
};

function resource(
  id: string,
  parentId?: string,
  extra: Partial<Resource> = {},
): Resource {
  const [type, name] = id.split(".");
  return {
    id,
    block: blocks[type] ?? "resource",
    type,
    name,
    label: name,
    file: "main.tf",
    line: 1,
    category: "other",
    properties: [],
    dependsOn: [],
    parentId,
    ...extra,
  };
}

const edge = (source: string, target: string): ResourceEdge => ({
  id: `${source}:${target}`,
  source,
  target,
  label: "ref",
  kind: "reference",
});

const caption: ExportCaption = {
  project: "web-app",
  date: "13 nov 2026, 10:00",
  resources: 0,
};

/** Like the e2e fixture: VPC, subnet, group and instance, repeated. */
function large(count: number) {
  const resources: Resource[] = [];
  const edges: ResourceEdge[] = [];
  for (let i = 0; i < count; i++) {
    const vpc = `aws_vpc.v${Math.floor(i / 4) * 4}`;
    if (i % 4 === 0) resources.push(resource(`aws_vpc.v${i}`));
    else if (i % 4 === 1) resources.push(resource(`aws_subnet.s${i}`, vpc));
    else if (i % 4 === 2)
      resources.push(resource(`aws_security_group.g${i}`, vpc));
    else {
      resources.push(
        resource(`aws_instance.i${i}`, `aws_subnet.s${i - 2}`, {
          category: "compute",
        }),
      );
      edges.push(edge(`aws_security_group.g${i - 1}`, `aws_instance.i${i}`));
    }
  }
  return { resources, edges };
}

const viewBox = (svg: string) =>
  svg
    .match(/viewBox="([^"]+)"/)![1]
    .split(" ")
    .map(Number);

describe("diagramToSvg", () => {
  it("draws every one of 300 nodes and one path per edge", () => {
    const { resources, edges } = large(300);
    const graph = buildGraph(resources, edges, "");
    const { svg } = diagramToSvg({
      ...graph,
      caption: { ...caption, resources: 300 },
    });
    const ids = [...svg.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(300);
    expect(new Set(ids)).toEqual(new Set(resources.map((r) => r.id)));
    const paths = [...svg.matchAll(/<path data-edge="([^"]+)"/g)];
    expect(paths).toHaveLength(graph.edges.length);
    expect(graph.edges.length).toBe(75);
  });

  it("places nested nodes at the sum of their parents' positions", () => {
    const graph = buildGraph(
      [
        resource("aws_vpc.main"),
        resource("aws_subnet.app", "aws_vpc.main"),
        resource("aws_instance.web", "aws_subnet.app"),
      ],
      [],
      "",
    );
    const at = (id: string) => graph.nodes.find((n) => n.id === id)!;
    const x =
      at("aws_vpc.main").position.x +
      at("aws_subnet.app").position.x +
      at("aws_instance.web").position.x;
    const y =
      at("aws_vpc.main").position.y +
      at("aws_subnet.app").position.y +
      at("aws_instance.web").position.y;
    const { svg } = diagramToSvg({ ...graph, caption });
    const card = svg.match(
      /data-id="aws_instance\.web"[^>]*><svg x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/,
    )!;
    expect(Number(card[1])).toBe(x);
    expect(Number(card[2])).toBe(y);
    expect(Number(card[3])).toBe(214);
    expect(Number(card[4])).toBe(96);
  });

  it("escapes < > & \" ' and never writes a script or an event attribute", () => {
    const hostile = `<script>alert("x")</script> & 'q' <img onerror=1>`;
    const graph = buildGraph(
      [
        resource("aws_instance.web", undefined, { label: hostile }),
        resource("aws_s3_bucket.logs", undefined, {
          properties: [
            {
              name: "bucket_prefix",
              expression: `"a&b<c>"`,
              value: `a&b<c>`,
              kind: "literal",
              editable: true,
              line: 2,
            } as Property,
          ],
        }),
      ],
      [],
      "",
    );
    const { svg } = diagramToSvg({
      ...graph,
      caption: { ...caption, project: `"proyecto" <b>&</b>`, filter: hostile },
    });
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<img/i);
    // Text is escaped, so every "<" opens a tag this serializer wrote.
    const tags = svg.match(/<[^>]*>/g)!;
    expect(tags.filter((tag) => /\son[a-z]+\s*=/i.test(tag))).toEqual([]);
    expect(
      tags.map((tag) => tag.match(/^<\/?([a-zA-Z?!][\w-]*)/)?.[1]),
    ).not.toContain("script");
    expect(svg).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(svg).toContain("&amp; &apos;q&apos;");
    expect(svg).toContain("a&amp;b&lt;c&gt;");
    expect(svg).toContain("&quot;proyecto&quot; &lt;b&gt;&amp;&lt;/b&gt;");
    // Every & starts an entity: the XML stays well formed.
    expect(svg).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
  });

  it("replaces characters XML cannot hold, so the file still opens", () => {
    const value = "a\u0001b";
    const graph = buildGraph(
      [
        resource("aws_s3_bucket.logs", undefined, {
          label: value,
          properties: [
            {
              name: "bucket_prefix",
              expression: `"${value}"`,
              value,
              kind: "literal",
              editable: true,
              line: 2,
            } as Property,
          ],
        }),
      ],
      [],
      "",
    );
    const { svg } = diagramToSvg({
      ...graph,
      caption: { ...caption, project: value, filter: "\uFFFF" },
    });
    // XML 1.0 forbids C0 controls other than tab, LF and CR, and U+FFFE/F.
    const forbidden = [...svg].filter((char) => {
      const code = char.codePointAt(0)!;
      return (
        (code < 0x20 && ![0x09, 0x0a, 0x0d].includes(code)) ||
        code === 0xfffe ||
        code === 0xffff
      );
    });
    expect(forbidden).toEqual([]);
    expect(svg).toContain("a\uFFFDb");
    // Tab, line feed and carriage return are valid XML and stay.
    expect(escapeXml("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("frames all nodes plus a margin and the band in the viewBox", () => {
    const graph = buildGraph(
      [resource("aws_vpc.main"), resource("aws_s3_bucket.logs")],
      [],
      "",
    );
    const { svg, width, height } = diagramToSvg({ ...graph, caption });
    const [x, y, w, h] = viewBox(svg);
    const left = Math.min(...graph.nodes.map((n) => n.position.x));
    const top = Math.min(...graph.nodes.map((n) => n.position.y));
    const right = Math.max(
      ...graph.nodes.map((n) => n.position.x + Number(n.style!.width)),
    );
    const bottom = Math.max(
      ...graph.nodes.map((n) => n.position.y + Number(n.style!.height)),
    );
    expect(x).toBe(left - 40);
    expect(x + w).toBeGreaterThanOrEqual(right + 40);
    // The band sits above the diagram, inside the frame.
    expect(y).toBeLessThan(top - 40);
    expect(y + h).toBe(bottom + 40);
    expect([w, h]).toEqual([width, height]);
    expect(svg).toMatch(new RegExp(`width="${w}" height="${h}" viewBox`));
  });

  it("names project, date, count, filter and unsaved drafts in the band", () => {
    const graph = buildGraph([resource("aws_s3_bucket.logs")], [], "", "logs");
    const { svg } = diagramToSvg({
      ...graph,
      caption: { ...caption, resources: 1, filter: "logs", drafts: 2 },
    });
    const band = svg.match(/<g data-band="caption">.*?<\/g>/)![0];
    expect(band).toContain("web-app");
    expect(band).toContain("13 nov 2026, 10:00");
    expect(band).toContain("1 recurso");
    expect(band).toContain("Filtro activo: «logs»");
    expect(band).toContain("Incluye cambios sin guardar en 2 archivos");
    const plain = diagramToSvg({ ...graph, caption }).svg;
    expect(plain).toContain("Configuración declarada, no estado desplegado");
  });

  it("is deterministic and draws marks, faded nodes and hidden values like the canvas", () => {
    const secret = resource("var.token", undefined, {
      properties: [
        {
          name: "default",
          expression: `"s3cr3t"`,
          value: "s3cr3t",
          kind: "literal",
          editable: true,
          line: 2,
        } as Property,
        {
          name: "sensitive",
          expression: "true",
          value: true,
          kind: "literal",
          editable: true,
          line: 3,
        } as Property,
      ],
    });
    const graph = buildGraph(
      [resource("aws_instance.web"), secret],
      [],
      "",
      "web",
    );
    const nodes = graph.nodes.map((n) =>
      n.id === "aws_instance.web"
        ? { ...n, data: { ...n.data, mark: "deployed" } }
        : n,
    );
    const first = diagramToSvg({ nodes, edges: graph.edges, caption }).svg;
    expect(diagramToSvg({ nodes, edges: graph.edges, caption }).svg).toBe(
      first,
    );
    expect(first).toContain("✓ en Floci");
    expect(first).toContain("(sensible)");
    expect(first).not.toContain("s3cr3t");
    expect(first).toMatch(
      /data-id="var\.token" data-kind="resource" opacity="0\.3"/,
    );
  });

  it("returns a framed empty drawing for an empty diagram", () => {
    const { svg, width } = diagramToSvg({ nodes: [], edges: [], caption });
    expect(svg).not.toContain("data-id=");
    expect(width).toBe(640);
  });
});

describe("diagram icons", () => {
  it("reads the shapes of every icon the cards use", () => {
    for (const category of [
      "network",
      "compute",
      "security",
      "database",
      "storage",
      "loadbalancer",
      "variable",
      "local",
      "output",
      "provider",
      "other",
    ]) {
      const spec = iconFor(
        resource("aws_x.y", undefined, {
          category: category as Resource["category"],
        }),
      );
      expect(iconNodes(spec.Icon).length, category).toBeGreaterThan(0);
    }
  });
});

describe("pngScale", () => {
  it("keeps 2× for normal diagrams and caps very large ones near 16.7 M px", () => {
    expect(pngScale(1200, 800)).toBe(2);
    const scale = pngScale(20_000, 6_000);
    expect(20_000 * scale * 6_000 * scale).toBeLessThanOrEqual(MAX_PIXELS);
    expect(20_000 * scale).toBeLessThanOrEqual(16_384);
  });
});
