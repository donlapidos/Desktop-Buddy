// Recorded-window replay only: no desktop calls, timers or simulated success.
import { furthestStep, findControl, renderTree } from "./desktop.js";

export class ReplayDesktop {
  constructor(tree, next = []) {
    this.tree = tree;
    this.next = next;
    this.pending = null;
  }

  nodes() {
    const nodes = new Map();
    const walk = (node) => {
      if (node.ref_id && node.bounds && !(node.states ?? []).some((s) => s === "offscreen" || s === "disabled")) nodes.set(node.ref_id, node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(this.tree);
    return nodes;
  }

  reading() { return `window: ${this.tree.name ?? "Recorded window"}\n${renderTree(this.tree).text}`; }

  point(ref) {
    this.pending = null;
    const node = this.nodes().get(ref);
    if (!node) return null;
    this.pending = node.name;
    return node;
  }

  match(target, role) {
    const found = findControl(this.tree, target, role);
    return found?.node && this.nodes().has(found.node.ref_id) ? found : found?.candidates ? found : null;
  }

  progress(steps = []) {
    const needles = [].concat(steps).filter((s) => typeof s === "string" && s.trim()).map((s) => s.toLowerCase());
    const before = this.tree;
    const already = new Set(needles.filter((s) => furthestStep([s], new Set(), before) >= 0));
    const name = String(this.pending ?? "").toLowerCase().trim();
    const transition = this.next.find(([pattern]) => {
      pattern.lastIndex = 0;
      return name && pattern.test(name);
    });
    this.pending = null;
    if (transition) this.tree = transition[1];
    const step = furthestStep(needles, already, this.tree);
    return step >= 0 ? { status: "appeared", step }
      : { status: this.tree === before ? "timeout" : "changed", step: -1 };
  }
}
