import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { sankey as d3sankey, sankeyLinkHorizontal } from "d3-sankey";
import { money } from "@/lib/money";

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
const MUTED_FOREGROUND = "var(--muted-foreground)";
const INK = "var(--foreground)";
/** Bands are a warm muted wash, never a second color per category. */
const BAND = "var(--border)";

const finite = (value: number) => (Number.isFinite(value) ? value : 0);

/** The share of a total, as a percentage, or `null` when there is no total to divide by. */
const shareOf = (value: number, total: number): number | null => {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return (value / total) * 100;
};

/** A share already in percent, or a dash when the row has no denominator. */
const shareLabel = (percent: number | null) => {
  if (percent === null || !Number.isFinite(percent) || percent <= 0) return "—";
  return `${Math.round(percent)}%`;
};

/** Below 640 px the sheet has no room for a diagram, so the same numbers print as a list. */
const NARROW_QUERY = "(max-width: 639px)";

const useNarrow = () => {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(NARROW_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return narrow;
};

/** Cut a label to the width it may occupy, so it never runs under the edge of the sheet. */
const fitText = (text: string, maxWidth: number, fontSize: number) => {
  const perCharacter = fontSize * 0.53;
  const room = Math.max(4, Math.floor(maxWidth / perCharacter));
  return text.length > room ? `${text.slice(0, room - 1)}…` : text;
};

const CustomSankeyFlow: React.FC<CustomSankeyProps> = ({
  income,
  savings,
  flows,
  formatCurrency = money,
  sourceLabel = "Income",
  className = "",
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const narrow = useNarrow();

  // Follow the sheet's width so the diagram fits without a sideways scroll.
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
  }, [narrow]);

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
  const spent = drawn.reduce((sum, flow) => sum + flow.amount, 0);

  // Every path the money took, largest first, then what stayed.
  const ranked = useMemo(() => {
    const largest = Math.max(
      kept,
      drawn.reduce((max, flow) => Math.max(max, flow.amount), 0)
    );
    const total = finite(income) > 0 ? finite(income) : spent + kept;
    return [
      ...drawn.map((flow) => ({ ...flow, kind: "spend" as const })),
      ...(kept > 0 ? [{ category: "Saved", amount: kept, kind: "saved" as const }] : []),
    ].map((flow) => ({
      ...flow,
      share: shareOf(flow.amount, total),
      width: largest > 0 ? Math.min(100, (flow.amount / largest) * 100) : 0,
    }));
  }, [drawn, kept, spent, income]);

  const height = Math.max(220, Math.min(480, 96 + drawn.length * 44));

  useEffect(() => {
    if (narrow || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (drawn.length === 0 && kept <= 0) return;

    const innerWidth = Math.max(320, width);
    const innerHeight = height;

    /**
     * Label gutters: names and amounts live outside the bands, in the empty sides of the
     * spread — the source on the left, each category to the right of its node.
     */
    const leftGutter = Math.round(Math.min(120, innerWidth * 0.22));
    const rightGutter = Math.round(Math.min(200, Math.max(120, innerWidth * 0.32)));
    const rightEdge = Math.max(leftGutter + 120, innerWidth - rightGutter);

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

    /** 3. Layout, with the label gutters reserved in the extent. */
    const sankeyGen = d3sankey<NodeDatum, LinkDatum>()
      .nodeWidth(10)
      .nodePadding(Math.max(10, Math.min(28, 320 / Math.max(1, nodes.length))))
      .extent([
        [leftGutter, 8],
        [rightEdge, innerHeight - 16],
      ]);

    const { nodes: layoutNodes, links: layoutLinks } = sankeyGen({
      nodes: nodes.map((node) => ({ ...node })),
      links: links.map((link) => ({ ...link })),
    });

    const g = svg.append("g");

    /** 4. Bands: one warm muted wash, sage tint for what stayed. */
    const bands = g
      .append("g")
      .attr("data-layer", "bands")
      .attr("fill", "none")
      .selectAll("path")
      .data(layoutLinks)
      .enter()
      .append("path")
      .attr("d", sankeyLinkHorizontal())
      .attr("stroke", (link: any) => (link.kind === "saved" ? SAGE_TINT : BAND))
      .attr("stroke-opacity", 1)
      .attr("stroke-width", (link: any) => Math.max(1, link.width ?? 1))
      .attr("data-kind", (link: any) => link.kind);

    bands
      .on("mouseover", function (this: SVGPathElement, _event: unknown, link: any) {
        d3.select(this)
          .attr("stroke", link.kind === "saved" ? SAGE : "var(--muted-foreground)")
          .attr("stroke-opacity", 0.32);
      })
      .on("mouseout", function (this: SVGPathElement, _event: unknown, link: any) {
        d3.select(this)
          .attr("stroke", link.kind === "saved" ? SAGE_TINT : BAND)
          .attr("stroke-opacity", 1);
      });

    /** 5. Node blocks: sage where money comes from, sage tint for what stayed, ink for spending. */
    g.append("g")
      .attr("data-layer", "nodes")
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
        node.kind === "source" ? SAGE : node.kind === "saved" ? SAGE_TINT : INK
      )
      .attr("stroke", (node: any) => (node.kind === "saved" ? SAGE : "none"))
      .attr("stroke-width", (node: any) => (node.kind === "saved" ? 1 : 0));

    /**
     * 6. Labels outside the bands: the source to the left of its node, every category to
     * the right of the right-hand node, in ink 13px with the amount and share below it.
     */
    const labelled = layoutNodes.map((node: any) => {
      const center = ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2;
      const value = finite(Number(node.value ?? 0));
      const total = finite(income) > 0 ? finite(income) : value;
      return {
        node,
        y: center,
        name: String(node.name ?? ""),
        detail: `${formatCurrency(value)} · ${shareLabel(shareOf(value, total))}`,
      };
    });

    // Nudge labels apart so a thin band's label never lands on its neighbour's.
    const minGap = 34;
    labelled.sort((a, b) => a.y - b.y);
    labelled.forEach((label, index) => {
      const previous = index > 0 ? labelled[index - 1].y : -Infinity;
      label.y = Math.max(label.y, previous + minGap, 16);
    });
    const overflow = labelled.length > 0 ? labelled[labelled.length - 1].y - (innerHeight - 16) : 0;
    if (overflow > 0) labelled.forEach((label) => (label.y -= overflow));

    const labels = g
      .append("g")
      .attr("data-layer", "labels")
      .selectAll("g")
      .data(labelled)
      .enter()
      .append("g");

    const isSource = (node: any) => node.kind === "source";
    const labelX = (node: any) => (isSource(node) ? (node.x0 ?? 0) - 10 : (node.x1 ?? 0) + 10);
    const anchor = (node: any) => (isSource(node) ? "end" : "start");
    /** The label may use whatever the node has to the edge of the sheet, minus a little air. */
    const room = (node: any) =>
      isSource(node) ? (node.x0 ?? 0) - 14 : innerWidth - (node.x1 ?? 0) - 14;

    labels
      .append("text")
      .attr("x", (row: any) => labelX(row.node))
      .attr("y", (row: any) => row.y - 5)
      .attr("text-anchor", (row: any) => anchor(row.node))
      .attr("fill", INK)
      .attr("font-size", 13)
      .attr("font-weight", 500)
      .attr("data-role", "label-name")
      .text((row: any) => fitText(row.name, room(row.node), 13));

    labels
      .append("text")
      .attr("x", (row: any) => labelX(row.node))
      .attr("y", (row: any) => row.y + 11)
      .attr("text-anchor", (row: any) => anchor(row.node))
      .attr("fill", MUTED_FOREGROUND)
      .attr("font-size", 12)
      .attr("data-role", "label-detail")
      .text((row: any) => row.detail);
  }, [narrow, income, kept, drawn, formatCurrency, sourceLabel, width, height]);

  if (drawn.length === 0 && kept <= 0) {
    return (
      <div ref={boxRef} className={className}>
        <p className="text-[15px] text-muted-foreground">No cash flow to show for this period.</p>
      </div>
    );
  }

  // Phone: no diagram. The same flows as ranked ledger rows with a thin ink bar each.
  if (narrow) {
    return (
      <div ref={boxRef} className={className}>
        <ul data-testid="cash-flow-list">
          {ranked.map((flow) => (
            <li key={`${flow.kind}-${flow.category}`} className="ledger-line py-3 text-[15px]">
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate">
                  {flow.category}
                </span>
                <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {shareLabel(flow.share)}
                </span>
                <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                  {formatCurrency(flow.amount)}
                </span>
              </div>
              <span className="mt-2 block h-1.5 w-full rounded-sm bg-muted" aria-hidden>
                <span
                  data-bar-fill={flow.kind === "saved" ? "saved" : "spending"}
                  className={`block h-1.5 rounded-sm ${flow.kind === "saved" ? "bg-sage" : "bg-ink"}`}
                  style={{ width: `${flow.width}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div ref={boxRef} className={className}>
      <svg
        ref={svgRef}
        data-testid="cash-flow-diagram"
        width="100%"
        height={height}
        role="img"
        aria-label={`${sourceLabel} split across ${drawn.length} categories`}
      />
    </div>
  );
};

export default CustomSankeyFlow;
