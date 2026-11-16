import { annotationLayouts } from "../annotations.js";

const root = document.getElementById("annotations");
const svgNS = "http://www.w3.org/2000/svg";
const svg = (name, attributes = {}) => {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};

function render(items) {
  root.replaceChildren();
  const figures = svg("svg", { id: "annotation-figures", viewBox: `0 0 ${innerWidth} ${innerHeight}` });
  const defs = svg("defs");
  const marker = svg("marker", { id: "annotation-head", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 9, markerHeight: 9, orient: "auto", markerUnits: "userSpaceOnUse" });
  marker.append(svg("path", { d: "M 1 1 L 9 5 L 1 9", fill: "none", stroke: "var(--buddy)", "stroke-width": 2, "stroke-linejoin": "round" }));
  defs.append(marker); figures.append(defs); root.append(figures);
  const layouts = annotationLayouts(items, innerWidth, innerHeight);
  for (const [i, item] of items.entries()) {
    const layout = layouts[i];
    if (!layout) continue;
    const group = svg("g", { "data-kind": item.kind });
    const b = layout.box;
    const shape = (name, attrs, extra = "") => {
      group.append(svg(name, { ...attrs, class: "annotation-outline" }));
      group.append(svg(name, { ...attrs, class: `annotation-ink ${extra}` }));
    };
    if (item.kind === "highlight") shape("rect", { ...b, rx: 6 }, "annotation-wash");
    else if (item.kind === "circle") shape("ellipse", { cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2, ry: b.height / 2 }, "annotation-wash");
    else if (layout.path) {
      group.append(svg("path", { d: layout.path, class: "annotation-outline" }));
      group.append(svg("path", { d: layout.path, class: `annotation-ink${item.kind === "drag" ? " annotation-drag" : ""}`, "marker-end": "url(#annotation-head)" }));
      if (item.kind === "drag") shape("circle", { cx: layout.start.x, cy: layout.start.y, r: 6 });
    }
    figures.append(group);
    if (item.showLabel !== false && item.label) {
      const label = document.createElement("div");
      label.className = "annotation-label";
      label.textContent = item.label;
      Object.assign(label.style, { left: `${layout.label.x}px`, top: `${layout.label.y}px`, width: `${layout.label.width}px` });
      root.append(label);
    }
    if (item.showLabel !== false && item.number) {
      const number = document.createElement("div");
      number.className = "annotation-number";
      number.textContent = String(item.number);
      Object.assign(number.style, { left: `${Math.max(4, item.bounds.x - 12)}px`, top: `${Math.max(4, item.bounds.y - 12)}px` });
      root.append(number);
    }
  }
}

window.buddy.onAnnotations(render);
window.buddy.onAnnotationsClear(() => root.replaceChildren());
addEventListener("resize", () => root.replaceChildren());
document.body.dataset.annotationsReady = "true";
