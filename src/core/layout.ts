import type { GateGraph, GateNode } from './types';

export interface PositionedNode {
  node: GateNode;
  /** 粘贴 JSON 中的位置 */
  order: number;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  slot: number;
  d: string;
  /** 入边上是否取反（目标门为 NOT 时仅示意） */
  negated: boolean;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: PositionedNode[];
  edges: LayoutEdge[];
}

export const LAYOUT = {
  nodeWidth: 84,
  nodeHeight: 46,
  layerGap: 132,
  nodeGapY: 26,
  margin: 48,
} as const;

/**
 * 简单分层布局：
 * - INPUT/常量位于第 0 层；
 * - 门位于 max(输入层)+1；
 * - 同层按节点 id 排序后纵向均布；
 * - 边采用三次贝塞尔曲线，NOT 的入边绘制取反小圈。
 * DAG 前提由校验阶段保证。
 */
export function layoutGraph(graph: GateGraph): GraphLayout {
  const byId = new Map(graph.nodes.map((n, i) => [n.id, { node: n, order: i }]));
  const layerOf = new Map<string, number>();

  const computeLayer = (id: string): number => {
    const cached = layerOf.get(id);
    if (cached !== undefined) return cached;
    const { node } = byId.get(id)!;
    let layer: number;
    if (node.kind === 'INPUT' || node.kind === 'CONST0' || node.kind === 'CONST1') {
      layer = 0;
    } else {
      const inputs = node.inputs ?? [];
      layer = inputs.length === 0 ? 1 : Math.max(...inputs.map(computeLayer)) + 1;
    }
    layerOf.set(id, layer);
    return layer;
  };
  for (const n of graph.nodes) computeLayer(n.id);

  const maxLayer = Math.max(0, ...graph.nodes.map((n) => layerOf.get(n.id)!));

  const layers: GateNode[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of graph.nodes) layers[layerOf.get(n.id)!].push(n);
  for (const layer of layers) {
    layer.sort((a, b) => a.id.localeCompare(b.id));
  }

  const height =
    LAYOUT.margin * 2 +
    Math.max(...layers.map((l) => l.length)) *
      (LAYOUT.nodeHeight + LAYOUT.nodeGapY) -
    LAYOUT.nodeGapY;
  const width =
    LAYOUT.margin * 2 +
    (maxLayer + 1) * LAYOUT.nodeWidth +
    maxLayer * (LAYOUT.layerGap - LAYOUT.nodeWidth);

  const positioned = new Map<string, PositionedNode>();
  layers.forEach((layer, li) => {
    const layerTop =
      (height -
        (layer.length * (LAYOUT.nodeHeight + LAYOUT.nodeGapY) - LAYOUT.nodeGapY)) /
      2;
    layer.forEach((node, ni) => {
      const pn: PositionedNode = {
        node,
        order: byId.get(node.id)!.order,
        layer: li,
        x: LAYOUT.margin + li * LAYOUT.layerGap,
        y: layerTop + ni * (LAYOUT.nodeHeight + LAYOUT.nodeGapY),
        width: LAYOUT.nodeWidth,
        height: LAYOUT.nodeHeight,
      };
      positioned.set(node.id, pn);
    });
  });

  const edges: LayoutEdge[] = [];
  for (const n of graph.nodes) {
    (n.inputs ?? []).forEach((ref, slot) => {
      const a = positioned.get(ref);
      const b = positioned.get(n.id);
      if (!a || !b) return;
      const x1 = a.x + a.width;
      const y1 = a.y + a.height / 2;
      const x2 = b.x;
      const y2 =
        b.y +
        (n.kind === 'NOT'
          ? b.height / 2
          : slot === 0
            ? b.height * 0.28
            : b.height * 0.72);
      const dx = Math.max(40, (x2 - x1) / 2);
      edges.push({
        from: ref,
        to: n.id,
        slot,
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        negated: n.kind === 'NOT',
      });
    });
  }

  return {
    width: Math.max(width, 320),
    height: Math.max(height, 200),
    nodes: [...positioned.values()].sort((a, b) => a.order - b.order),
    edges,
  };
}
