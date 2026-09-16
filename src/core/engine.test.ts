import { describe, expect, it } from 'vitest';
import { validatePair } from './validate';
import {
  checkEquivalence,
  collectVariableOrder,
  compileGraph,
  evaluateGraph,
} from './engine';
import { BddManager } from './bdd';
import type { GateGraph } from './types';

function parsePair(oldJson: string, newJson: string): [GateGraph, GateGraph] {
  const r = validatePair(oldJson, newJson);
  if (!r.graphs) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.graphs;
}

const G = {
  andAB: () =>
    JSON.stringify({
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'b', kind: 'INPUT', name: 'B' },
        { id: 'g', kind: 'AND', inputs: ['a', 'b'] },
      ],
      output: 'g',
    }),
  deMorgan: () =>
    JSON.stringify({
      nodes: [
        { id: 'x', kind: 'INPUT', name: 'A' },
        { id: 'y', kind: 'INPUT', name: 'B' },
        { id: 'nx', kind: 'NOT', inputs: ['x'] },
        { id: 'ny', kind: 'NOT', inputs: ['y'] },
        { id: 'o', kind: 'OR', inputs: ['nx', 'ny'] },
        { id: 'out', kind: 'NOT', inputs: ['o'] },
      ],
      output: 'out',
    }),
  orAB: () =>
    JSON.stringify({
      nodes: [
        { id: 'p', kind: 'INPUT', name: 'A' },
        { id: 'q', kind: 'INPUT', name: 'B' },
        { id: 'g', kind: 'OR', inputs: ['p', 'q'] },
      ],
      output: 'g',
    }),
};

describe('变量序', () => {
  it('两图全部 INPUT 名并集按 ASCII 升序', () => {
    const [a, b] = parsePair(
      JSON.stringify({
        nodes: [
          { id: '1', kind: 'INPUT', name: 'B' },
          { id: '2', kind: 'INPUT', name: 'A' },
        ],
        output: '1',
      }),
      JSON.stringify({
        nodes: [
          { id: '1', kind: 'INPUT', name: 'C' },
          { id: '2', kind: 'INPUT', name: 'A0' },
          { id: '3', kind: 'INPUT', name: 'A' },
        ],
        output: '1',
      }),
    );
    expect(collectVariableOrder(a, b)).toEqual(['A', 'A0', 'B', 'C']);
  });
});

describe('等价判定', () => {
  it('AND(A,B) 与 德摩根实现等价：异或根为 0', () => {
    const [a, b] = parsePair(G.andAB(), G.deMorgan());
    const r = checkEquivalence(a, b);
    expect(r.verdict).toBe('equivalent');
    expect(r.miterRoot).toBe(0);
    expect(r.counterexample).toBeNull();
    expect(r.sharedVariables).toEqual(['A', 'B']);
    // 逐门复算输出一致
    expect(r.oldOutput).toBe(r.newOutput);
  });

  it('NOT 实现为 XOR with 1 与门图 NOT 等价', () => {
    const oldG = JSON.stringify({
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'n', kind: 'NOT', inputs: ['a'] },
      ],
      output: 'n',
    });
    const newG = JSON.stringify({
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'one', kind: 'CONST1' },
        { id: 'x', kind: 'XOR', inputs: ['a', 'one'] },
      ],
      output: 'x',
    });
    const [a, b] = parsePair(oldG, newG);
    expect(checkEquivalence(a, b).verdict).toBe('equivalent');
  });

  it('两个常量图：CONST0 vs CONST0 等价，CONST0 vs CONST1 反例为空赋值', () => {
    const c0 = JSON.stringify({ nodes: [{ id: 'c', kind: 'CONST0' }], output: 'c' });
    const c1 = JSON.stringify({ nodes: [{ id: 'c', kind: 'CONST1' }], output: 'c' });
    let [a, b] = parsePair(c0, c0);
    expect(checkEquivalence(a, b).verdict).toBe('equivalent');
    [a, b] = parsePair(c0, c1);
    const r = checkEquivalence(a, b);
    expect(r.verdict).toBe('counterexample');
    expect(r.oldOutput).toBe(0);
    expect(r.newOutput).toBe(1);
    expect(r.sharedVariables).toEqual([]);
  });
});

describe('反例直接读取', () => {
  it('AND vs OR：摘要为 A=0,B=1（低优先）且两图输出分歧', () => {
    const [a, b] = parsePair(G.andAB(), G.orAB());
    const r = checkEquivalence(a, b);
    expect(r.verdict).toBe('counterexample');
    expect(r.counterexample).toEqual({ A: 0, B: 1 });
    expect(r.oldOutput).toBe(0);
    expect(r.newOutput).toBe(1);
  });

  it('反例逐门复算：旧图 AND 门输出 0，新图 OR 门输出 1', () => {
    const [a, b] = parsePair(G.andAB(), G.orAB());
    const r = checkEquivalence(a, b);
    const oldGate = r.oldTrace.find((t) => t.nodeId === 'g')!;
    const newGate = r.newTrace.find((t) => t.nodeId === 'g')!;
    expect(oldGate.value).toBe(0);
    expect(newGate.value).toBe(1);
  });

  it('罕见组合分歧：新图仅在全 1 时翻转，摘要即唯一反例 111', () => {
    const maj = JSON.stringify({
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'b', kind: 'INPUT', name: 'B' },
        { id: 'c', kind: 'INPUT', name: 'C' },
        { id: 'ab', kind: 'AND', inputs: ['a', 'b'] },
        { id: 'ac', kind: 'AND', inputs: ['a', 'c'] },
        { id: 'bc', kind: 'AND', inputs: ['b', 'c'] },
        { id: 'o1', kind: 'OR', inputs: ['ab', 'ac'] },
        { id: 'maj', kind: 'OR', inputs: ['o1', 'bc'] },
      ],
      output: 'maj',
    });
    const modified = JSON.stringify({
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'b', kind: 'INPUT', name: 'B' },
        { id: 'c', kind: 'INPUT', name: 'C' },
        { id: 'ab', kind: 'AND', inputs: ['a', 'b'] },
        { id: 'ac', kind: 'AND', inputs: ['a', 'c'] },
        { id: 'bc', kind: 'AND', inputs: ['b', 'c'] },
        { id: 'o1', kind: 'OR', inputs: ['ab', 'ac'] },
        { id: 'maj', kind: 'OR', inputs: ['o1', 'bc'] },
        { id: 'abc', kind: 'AND', inputs: ['ab', 'c'] },
        { id: 'out', kind: 'XOR', inputs: ['maj', 'abc'] },
      ],
      output: 'out',
    });
    const [a, b] = parsePair(maj, modified);
    const r = checkEquivalence(a, b);
    expect(r.verdict).toBe('counterexample');

    // 测试预言机：8 种赋值中恰有 1 种分歧
    const differences: Record<string, 0 | 1>[] = [];
    for (let mask = 0; mask < 8; mask += 1) {
      const asg = {
        A: ((mask >> 2) & 1) as 0 | 1,
        B: ((mask >> 1) & 1) as 0 | 1,
        C: (mask & 1) as 0 | 1,
      };
      if (
        evaluateGraph(a, asg).get(a.output) !==
        evaluateGraph(b, asg).get(b.output)
      ) {
        differences.push(asg);
      }
    }
    expect(differences).toEqual([{ A: 1, B: 1, C: 1 }]);
    // 摘要直接读出该唯一反例（低优先策略下沿高分支到达）
    expect(r.counterexample).toEqual({ A: 1, B: 1, C: 1 });
    expect(r.oldOutput).toBe(1);
    expect(r.newOutput).toBe(0);
  });

  it('非共享变量参与反例：A∨Z 与 A 在 Z=1（A=0）时分歧', () => {
    const oldG = JSON.stringify({
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'z', kind: 'INPUT', name: 'Z' },
        { id: 'g', kind: 'OR', inputs: ['a', 'z'] },
      ],
      output: 'g',
    });
    const newG = JSON.stringify({
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'g', kind: 'NOT', inputs: ['na'] },
        { id: 'na', kind: 'NOT', inputs: ['a'] },
      ],
      output: 'g',
    });
    const [a, b] = parsePair(oldG, newG);
    const r = checkEquivalence(a, b);
    expect(r.verdict).toBe('counterexample');
    expect(r.sharedVariables).toEqual(['A']);
    expect(r.counterexample).toEqual({ A: 0, Z: 1 });
    expect(r.oldOutput).toBe(1);
    expect(r.newOutput).toBe(0);
  });

  it('未挂接到输出的非共享 INPUT 不影响等价性，摘要补 0', () => {
    const oldG = JSON.stringify({
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'z', kind: 'INPUT', name: 'Z' },
        { id: 'g', kind: 'NOT', inputs: ['a'] },
      ],
      output: 'g',
    });
    const newG = JSON.stringify({
      nodes: [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'g', kind: 'XOR', inputs: ['a', 'one'] },
        { id: 'one', kind: 'CONST1' },
      ],
      output: 'g',
    });
    const [a, b] = parsePair(oldG, newG);
    const r = checkEquivalence(a, b);
    expect(r.verdict).toBe('equivalent');
    expect(r.sharedVariables).toEqual(['A']);
  });
});

describe('编译与求值', () => {
  it('compileGraph 为每个节点产出 BDD 根', () => {
    const [a] = parsePair(G.andAB(), G.andAB());
    const mgr = new BddManager(['A', 'B']);
    const roots = compileGraph(mgr, a);
    expect(roots.size).toBe(a.nodes.length);
    expect(mgr.evaluate(roots.get('g')!, { A: 1, B: 1 })).toBe(1);
    expect(mgr.evaluate(roots.get('g')!, { A: 1, B: 0 })).toBe(0);
  });
});
