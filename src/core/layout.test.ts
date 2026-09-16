import { describe, expect, it } from 'vitest';
import { layoutGraph } from './layout';
import type { GateGraph } from './types';

describe('layoutGraph', () => {
  it('INPUT/常量在第 0 层，门按输入最大层 +1 分层', () => {
    const graph: GateGraph = {
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'b', kind: 'INPUT', name: 'B' },
        { id: 'n', kind: 'NOT', inputs: ['a'] },
        { id: 'g', kind: 'AND', inputs: ['n', 'b'] },
      ],
      output: 'g',
    };
    const layout = layoutGraph(graph);
    const byId = new Map(layout.nodes.map((n) => [n.node.id, n]));
    expect(byId.get('a')!.layer).toBe(0);
    expect(byId.get('b')!.layer).toBe(0);
    expect(byId.get('n')!.layer).toBe(1);
    expect(byId.get('g')!.layer).toBe(2);
    expect(layout.edges.length).toBe(3);
  });

  it('前向引用不影响分层结果', () => {
    const graph: GateGraph = {
      nodes: [
        { id: 'g', kind: 'OR', inputs: ['x', 'y'] },
        { id: 'x', kind: 'INPUT', name: 'X' },
        { id: 'y', kind: 'CONST1' },
      ],
      output: 'g',
    };
    const layout = layoutGraph(graph);
    const byId = new Map(layout.nodes.map((n) => [n.node.id, n]));
    expect(byId.get('g')!.layer).toBe(1);
  });

  it('每个节点都有位置且边数等于入边总数', () => {
    const graph: GateGraph = {
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'b', kind: 'INPUT', name: 'B' },
        { id: 'g1', kind: 'XOR', inputs: ['a', 'b'] },
        { id: 'g2', kind: 'NOT', inputs: ['g1'] },
      ],
      output: 'g2',
    };
    const layout = layoutGraph(graph);
    expect(layout.nodes.length).toBe(4);
    expect(layout.edges.length).toBe(3);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});
