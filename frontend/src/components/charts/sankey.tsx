import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import { sankey as d3sankey, sankeyLinkHorizontal } from "d3-sankey";

interface FlowData {
  category: string;
  amount: number;
  color: string;
  children?: FlowData[];
}

interface CustomSankeyProps {
  income: number;
  savings: number;
  flows: FlowData[];
  formatCurrency: (amount: number) => string;
  className?: string;
}

const CustomSankeyFlow: React.FC<CustomSankeyProps> = ({
  income,
  savings,
  flows,
  formatCurrency,
  className = "",
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const width = 950;
    const height = 550;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    /** 1. Build nodes */
    type NodeDatum = { id: string; name: string; color: string };
    type LinkDatum = { source: number; target: number; value: number; color?: string };

    let nodes: NodeDatum[] = [];
    nodes.push({ id: "Income", name: "Income", color: "#10b981" });

    flows.forEach((parent) => {
      nodes.push({
        id: parent.category,
        name: parent.category,
        color: parent.color,
      });
      parent.children?.forEach((child) => {
        nodes.push({
          id: child.category,
          name: child.category,
          color: child.color,
        });
      });
    });

    if (savings > 0) {
      nodes.push({ id: "Savings", name: "Savings", color: "#3b82f6" });
    }

    /** 2. Build raw links */
    let rawLinks: { source: string; target: string; value: number; color?: string }[] =
      [];

    flows.forEach((parent) => {
      rawLinks.push({
        source: "Income",
        target: parent.category,
        value: parent.amount,
        color: parent.color,
      });

      parent.children?.forEach((child) => {
        rawLinks.push({
          source: parent.category,
          target: child.category,
          value: child.amount,
          color: child.color,
        });
      });
    });

    if (savings > 0) {
      rawLinks.push({
        source: "Income",
        target: "Savings",
        value: savings,
        color: "#3b82f6",
      });
    }

    /** 3. Convert string IDs → numeric indices */
    const idToIndex = new Map(nodes.map((d, i) => [d.id, i]));
    const links: LinkDatum[] = rawLinks.map((l) => ({
      source: idToIndex.get(l.source)!,
      target: idToIndex.get(l.target)!,
      value: l.value,
      color: l.color,
    }));

    /** 4. Sankey layout */
    const sankeyGen = d3sankey<NodeDatum, LinkDatum>()
      .nodeWidth(40)
      .nodePadding(30)
      .extent([
        [0, 0],
        [width - 50, height - 50],
      ]);

    const { nodes: sankeyNodes, links: sankeyLinks } = sankeyGen({
      nodes: nodes.map((d) => ({ ...d })),
      links: links.map((l) => ({ ...l })),
    });

    const g = svg.append("g").attr("transform", "translate(20,20)");

    /** 5. Draw links with gradients */
    const defs = svg.append("defs");

    sankeyLinks.forEach((link, i) => {
      const gradientId = `gradient-${i}`;

      const gradient = defs
        .append("linearGradient")
        .attr("id", gradientId)
        .attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", (link.source as any).x1)
        .attr("x2", (link.target as any).x0)
        .attr("y1", 0)
        .attr("y2", 0);

      gradient
        .append("stop")
        .attr("offset", "0%")
        .attr("stop-color", (link.source as any).color || "#999")
        .attr("stop-opacity", 0.8);

      gradient
        .append("stop")
        .attr("offset", "100%")
        .attr("stop-color", (link.target as any).color || "#999")
        .attr("stop-opacity", 0.8);

      const lw = (link as any).width ?? 1;
      g.append("path")
        .attr("d", sankeyLinkHorizontal()(link as any)!)
        .attr("stroke", `url(#${gradientId})`)
        .attr("stroke-width", Math.max(1, lw))
        .attr("fill", "none")
        .attr("opacity", 0.7)
        .on("mouseover", function () {
          d3.select(this).attr("opacity", 1).attr("stroke-width", (lw + 2));
        })
        .on("mouseout", function () {
          d3.select(this).attr("opacity", 0.7).attr("stroke-width", lw);
        });
    });

    /** 6. Draw nodes */
    const nodesG = g
      .selectAll(".node")
      .data(sankeyNodes)
      .enter()
      .append("g")
      .attr("class", "node");

    nodesG
      .append("rect")
      .attr("x", (d) => d.x0!)
      .attr("y", (d) => d.y0!)
      .attr("height", (d) => Math.max(1, (d.y1 ?? 0) - (d.y0 ?? 0)))
      .attr("width", (d) => (d.x1 ?? 0) - (d.x0 ?? 0))
      .style("fill", (d) => (d as any).color || "#999")
      .style("stroke", "#fff");

    /** 7. Node labels (name, amount, %) */
    nodesG
      .append("text")
      .attr("x", (d) => ((d.x0 ?? 0) < width / 2 ? d.x1! + 8 : d.x0! - 8))
      .attr("y", (d) => ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2)
      .attr("dy", "-0.2em")
      .attr("text-anchor", (d) =>
        (d.x0 ?? 0) < width / 2 ? "start" : "end"
      )
      .style("font-weight", "600")
      .style("fill", "#111827")
      .text((d) => (d as any).name);

    nodesG
      .append("text")
      .attr("x", (d) => ((d.x0 ?? 0) < width / 2 ? d.x1! + 8 : d.x0! - 8))
      .attr("y", (d) => ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2 + 14)
      .attr("text-anchor", (d) =>
        (d.x0 ?? 0) < width / 2 ? "start" : "end"
      )
      .style("font-size", d => ((d.y1 ?? 0) - (d.y0 ?? 0) < 20 ? "10px" : "13px"))
      .style("fill", "#6b7280")
      .text((d) => {
        const value = Number((d as any).value ?? 0);
        const percent = income ? ((value / income) * 100).toFixed(1) : "0.0";
        return `${formatCurrency(value)} (${percent}%)`;
      });

    /** 8. Title */
    svg
      .append("text")
      .attr("x", width / 2)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .style("font-size", "14px")
      .style("font-weight", "600")
      .style("fill", "#111827")
      .text("Cash Flow Analysis");
  }, [income, savings, flows, formatCurrency]);

  return (
    <div className={`bg-white rounded-lg border p-6 ${className}`}>
      <div className="mb-3 text-center text-gray-500 text-sm">
        Income flows across categories. Width = relative amount.
      </div>
      <svg ref={svgRef} width={950} height={550} />
    </div>
  );
};

export default CustomSankeyFlow;