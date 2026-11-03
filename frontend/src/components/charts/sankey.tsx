import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { sankey as d3sankey, sankeyLinkHorizontal } from "d3-sankey";

interface FlowData {
  category: string;
  amount: number;
}

interface CustomSankeyProps {
  /** Money that arrived, or money that left when spending is ahead of income. */
  income: number;
  /** Money kept; only a positive amount becomes the saved node. */
  savings: number;
  flows: FlowData[];
  formatCurrency: (amount: number) => string;
  /** Left-hand node name. */
  sourceLabel?: string;
  className?: string;
}

const SAGE = "var(--sage)";
const SAGE_TINT = "var(--sage-tint)";
const MUTED = "var(--muted-foreground)";
const INK = "var(--foreground)";
const RULE = "var(--border)";

const finite = (value: number) => (Number.isFinite(value) ? value : 0);

/** A share of the period's money, or a dash when there is no total to divide by. */
const shareLabel = (value: number, total: number) => {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return "—";
  return `${Math.round((value / total) * 100)}%`;
};

const CustomSankeyFlow: React.FC<CustomSankeyProps> = ({
  income,
  savings,
  flows,
  formatCurrency,
  sourceLabel = "Income",
  className = "",
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  // Follow the sheet's width so the diagram fits a phone without a sideways scroll.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const next = box.getBoundingClientRect().width;
      if (next > 0) setWidth(Math.round(next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Small bands get grouped: below 4% a label has no room and only adds noise.
  const drawn = useMemo(() => {
    const all = flows
      .map((flow) => ({ category: flow.category, amount: finite(flow.amount) }))
      .filter((flow) => flow.amount > 0.005)
      .sort((a, b) => b.amount - a.amount);
    const total = all.reduce((sum, flow) => sum + flow.amount, 0);
    const big = all.filter((flow, i) => i < 6 && flow.amount / (total || 1) >= 0.04);
    const rest = all.slice(big.length).reduce((sum, flow) => sum + flow.amount, 0);
    return rest > 0.005 ? [...big, { category: "Everything else", amount: rest }] : big;
  }, [flows]);

  const kept = Math.max(0, finite(savings));
  const height = Math.max(220, Math.min(480, 96 + drawn.length * 44));

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (drawn.length === 0 && kept <= 0) return;

    const innerWidth = Math.max(240, width);
    const innerHeight = height;

    /** 1. Nodes: where the money came from, where it went, and what stayed. */
    type NodeDatum = { id: string; name: string; kind: "source" | "category" | "saved" };
    type LinkDatum = { source: number; target: number; value: number; kind: "spend" | "saved" };

    const source: NodeDatum = { id: "__source", name: sourceLabel, kind: "source" };
    const categories: NodeDatum[] = drawn.map((flow) => ({
      id: flow.category,
      name: flow.category,
      kind: "category",
    }));
    const saved: NodeDatum[] = kept > 0 ? [{ id: "__saved", name: "Saved", kind: "saved" }] : [];
    const nodes: NodeDatum[] = [source, ...categories, ...saved];

    /** 2. Links. The source carries the sum of what leaves it, so the bands add up. */
    const indexOf = new Map(nodes.map((node, index) => [node.id, index]));
    const links: LinkDatum[] = [
      ...drawn.map((flow) => ({
        source: 0,
        target: indexOf.get(flow.category)!,
        value: flow.amount,
        kind: "spend" as const,
      })),
      ...(kept > 0
        ? [{ source: 0, target: indexOf.get("__saved")!, value: kept, kind: "saved" as const }]
        : []),
    ];

    /** 3. Layout */
    const sankeyGen = d3sankey<NodeDatum, LinkDatum>()
      .nodeWidth(10)
      .nodePadding(Math.max(10, Math.min(28, 320 / Math.max(1, nodes.length))))
      .extent([
        [0, 8],
        [Math.max(120, innerWidth - 190), innerHeight - 16],
      ]);

    const { nodes: layoutNodes, links: layoutLinks } = sankeyGen({
      nodes: nodes.map((node) => ({ ...node })),
      links: links.map((link) => ({ ...link })),
    });

    const g = svg.append("g").attr("transform", "translate(2,0)");

    /** 4. Bands: muted, thin, never a second color per category. */
    const bands = g
      .append("g")
      .attr("fill", "none")
      .selectAll("path")
      .data(layoutLinks)
      .enter()
      .append("path")
      .attr("d", sankeyLinkHorizontal())
      .attr("stroke", (link: any) => (link.kind === "saved" ? SAGE : MUTED))
      .attr("stroke-opacity", (link: any) => (link.kind === "saved" ? 0.3 : 0.18))
      .attr("stroke-width", (link: any) => Math.max(1, link.width ?? 1))
      .attr("data-kind", (link: any) => link.kind);

    bands
      .on("mouseover", function () {
        d3.select(this).attr("stroke-opacity", 0.34);
      })
      .on("mouseout", function (this: SVGPathElement, _event: unknown, link: any) {
        d3.select(this).attr("stroke-opacity", link.kind === "saved" ? 0.3 : 0.18);
      });

    /** 5. Node blocks: sage for where money comes from, sage tint for what stayed. */
    g.append("g")
      .selectAll("rect")
      .data(layoutNodes)
      .enter()
      .append("rect")
      .attr("x", (node: any) => node.x0 ?? 0)
      .attr("y", (node: any) => node.y0 ?? 0)
      .attr("width", (node: any) => Math.max(2, (node.x1 ?? 0) - (node.x0 ?? 0)))
      .attr("height", (node: any) => Math.max(2, (node.y1 ?? 0) - (node.y0 ?? 0)))
      .attr("rx", 2)
      .attr("fill", (node: any) =>
        node.kind === "source" ? SAGE : node.kind === "saved" ? SAGE_TINT : MUTED
      )
      .attr("fill-opacity", (node: any) => (node.kind === "category" ? 0.22 : 1))
      .attr("stroke", (node: any) =>
        node.kind === "saved" ? SAGE : node.kind === "source" ? SAGE : RULE
      )
      .attr("stroke-width", (node: any) => (node.kind === "saved" ? 1 : 0));

    /** 6. Labels in ink 13px, the amount beside them in muted 12px. */
    const labelX = (node: any) => {
      const onRightHalf = (node.x0 ?? 0) > innerWidth / 2 - 90;
      return onRightHalf ? (node.x0 ?? 0) - 10 : (node.x1 ?? 0) + 10;
    };
    const anchor = (node: any) => ((node.x0 ?? 0) > innerWidth / 2 - 90 ? "end" : "start");

    // On narrow sheets the source label would sit on top of the first category; the figures above already state it.
    const narrow = innerWidth < 560;
    const labels = g
      .append("g")
      .selectAll("g")
      .data(layoutNodes.filter((node: any) => !(narrow && node.kind === "source")))
      .enter()
      .append("g");

    labels
      .append("text")
      .attr("x", (node: any) => labelX(node))
      .attr("y", (node: any) => ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2 - 5)
      .attr("text-anchor", (node: any) => anchor(node))
      .attr("fill", INK)
      .attr("font-size", 13)
      .attr("font-weight", 500)
      .text((node: any) => node.name);

    labels
      .append("text")
      .attr("x", (node: any) => labelX(node))
      .attr("y", (node: any) => ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2 + 11)
      .attr("text-anchor", (node: any) => anchor(node))
      .attr("fill", MUTED)
      .attr("font-size", 12)
      .text((node: any) => {
        const value = finite(Number(node.value ?? 0));
        const total = finite(income) > 0 ? finite(income) : value;
        return `${formatCurrency(value)} · ${shareLabel(value, total)}`;
      });
  }, [income, kept, drawn, formatCurrency, sourceLabel, width, height]);

  return (
    <div ref={boxRef} className={className}>
      {drawn.length === 0 && kept <= 0 ? (
        <p className="text-[15px] text-muted-foreground">No cash flow to show for this period.</p>
      ) : (
        <svg
          ref={svgRef}
          width="100%"
          height={height}
          role="img"
          aria-label={`${sourceLabel} split across ${drawn.length} categories`}
        />
      )}
    </div>
  );
};

export default CustomSankeyFlow;
