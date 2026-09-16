import { BddManager, type BinOp } from './bdd';
import type { GateGraph } from './types';

export interface GateTraceEntry {
  nodeId: string;
  kind: string;
  inputs: string[];
  /** 该门在反例（或等价情形的零赋值）下的具体输出 0/1 */
  value: 0 | 1;
  /** 符号复算得到的 ROBDD 节点 id */
  bddNode: number;
}

export interface EquivalenceResult {
  verdict: 'equivalent' | 'counterexample';
  /** 变量判定顺序（共享变量按 ASCII 升序为其子序列） */
  variableOrder: string[];
  /** 仅两图共有的变量名，ASCII 升序 */
  sharedVariables: string[];
  /** 异或根节点 id；0 即等价 */
  miterRoot: number;
  /** 异或根可满足时，直接读取的唯一反例（跳过变量补 0） */
  counterexample: Record<string, 0 | 1> | null;
  oldTrace: GateTraceEntry[];
  newTrace: GateTraceEntry[];
  oldOutput: 0 | 1;
  newOutput: 0 | 1;
  stats: {
    uniqueNodes: number;
    applyCalls: number;
  };
}

/** 两图全部 INPUT 名的并集，ASCII 升序；共享变量是其 ASCII 升序子序列 */
export function collectVariableOrder(a: GateGraph, b: GateGraph): string[] {
  const names = new Set<string>();
  for (const g of [a, b]) {
    for (const n of g.nodes) {
      if (n.kind === 'INPUT') names.add(n.name!);
    }
  }
  return [...names].sort();
}

/**
 * 将一份门图符号编译为 ROBDD。
 * 按 DAG 的记忆化递归求值（环已在校验阶段拒绝）：
 * INPUT -> 文字节点；CONST -> 终端；NOT -> 否定；AND/OR/XOR -> Apply。
 */
export function compileGraph(
  mgr: BddManager,
  graph: GateGraph,
): Map<string, number> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const roots = new Map<string, number>();

  const build = (id: string): number => {
    const hit = roots.get(id);
    if (hit !== undefined) return hit;

    const node = byId.get(id)!;
    let root: number;
    switch (node.kind) {
      case 'INPUT':
        root = mgr.literal(node.name!);
        break;
      case 'CONST0':
        root = mgr.zero;
        break;
      case 'CONST1':
        root = mgr.one;
        break;
      case 'NOT':
        root = mgr.negate(build(node.inputs![0]));
        break;
      default: {
        const op = node.kind as BinOp;
        root = mgr.apply(op, build(node.inputs![0]), build(node.inputs![1]));
      }
    }
    roots.set(id, root);
    return root;
  };

  for (const n of graph.nodes) build(n.id);
  return roots;
}

/** 给定具体赋值，按门逐节点复算整张图的电平 */
export function evaluateGraph(
  graph: GateGraph,
  assignment: Readonly<Record<string, 0 | 1>>,
): Map<string, 0 | 1> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const values = new Map<string, 0 | 1>();

  const evalNode = (id: string): 0 | 1 => {
    const hit = values.get(id);
    if (hit !== undefined) return hit;
    const node = byId.get(id)!;
    let v: 0 | 1;
    switch (node.kind) {
      case 'INPUT':
        v = assignment[node.name!] ?? 0;
        break;
      case 'CONST0':
        v = 0;
        break;
      case 'CONST1':
        v = 1;
        break;
      case 'NOT':
        v = evalNode(node.inputs![0]) === 1 ? 0 : 1;
        break;
      case 'AND':
        v = evalNode(node.inputs![0]) === 1 && evalNode(node.inputs![1]) === 1 ? 1 : 0;
        break;
      case 'OR':
        v = evalNode(node.inputs![0]) === 1 || evalNode(node.inputs![1]) === 1 ? 1 : 0;
        break;
      case 'XOR':
        v = evalNode(node.inputs![0]) !== evalNode(node.inputs![1]) ? 1 : 0;
        break;
    }
    values.set(id, v);
    return v;
  };

  for (const n of graph.nodes) evalNode(n.id);
  return values;
}

function makeTrace(
  graph: GateGraph,
  bddRoots: Map<string, number>,
  values: Map<string, 0 | 1>,
): GateTraceEntry[] {
  // 按粘贴 JSON 的节点位置升序逐门列出，便于人工复算
  return graph.nodes.map((n) => ({
    nodeId: n.id,
    kind: n.kind,
    inputs: n.inputs ?? [],
    value: values.get(n.id)!,
    bddNode: bddRoots.get(n.id)!,
  }));
}

/**
 * 主判定流程：
 *   1) 共享变量 ASCII 升序建立 ROBDD 管理器（唯一表/计算表）；
 *   2) 符号编译两图；
 *   3) miter = XOR(root旧, root新)；根为 0 终端 => equivalent；
 *   4) 否则直接读取异或根的满足赋值摘要作为唯一反例（无搜索/回溯）；
 *   5) 用该赋值对两图逐门具体复算。
 */
export function checkEquivalence(
  oldGraph: GateGraph,
  newGraph: GateGraph,
): EquivalenceResult {
  const variableOrder = collectVariableOrder(oldGraph, newGraph);
  const mgr = new BddManager(variableOrder);

  const oldBdd = compileGraph(mgr, oldGraph);
  const newBdd = compileGraph(mgr, newGraph);

  const rootOld = oldBdd.get(oldGraph.output)!;
  const rootNew = newBdd.get(newGraph.output)!;
  const miter = mgr.apply('XOR', rootOld, rootNew);

  const shared = new Set(
    oldGraph.nodes.filter((n) => n.kind === 'INPUT').map((n) => n.name!),
  );
  const sharedVariables = newGraph.nodes
    .filter((n) => n.kind === 'INPUT' && shared.has(n.name!))
    .map((n) => n.name!)
    .sort();

  if (miter === mgr.zero) {
    // 等价时以全 0 赋值逐门复算（输出必然相同）
    const zeroAssignment = Object.fromEntries(
      variableOrder.map((v) => [v, 0 as const]),
    );
    const oldValues = evaluateGraph(oldGraph, zeroAssignment);
    const newValues = evaluateGraph(newGraph, zeroAssignment);
    return {
      verdict: 'equivalent',
      variableOrder,
      sharedVariables,
      miterRoot: miter,
      counterexample: null,
      oldTrace: makeTrace(oldGraph, oldBdd, oldValues),
      newTrace: makeTrace(newGraph, newBdd, newValues),
      oldOutput: oldValues.get(oldGraph.output)!,
      newOutput: newValues.get(newGraph.output)!,
      stats: { uniqueNodes: mgr.uniqueNodeCount, applyCalls: mgr.applyCalls },
    };
  }

  // 直接读取摘要——唯一反例
  const counterexample = mgr.satisfyingAssignment(miter);
  const oldValues = evaluateGraph(oldGraph, counterexample);
  const newValues = evaluateGraph(newGraph, counterexample);

  // 不变量自检：摘要必须真正使两输出分歧（仅校验，不参与反例搜索）
  const o = oldValues.get(oldGraph.output)!;
  const n = newValues.get(newGraph.output)!;
  if ((o ^ n) !== 1) {
    throw new Error('内部错误：满足赋值摘要未能使异或根成立');
  }

  return {
    verdict: 'counterexample',
    variableOrder,
    sharedVariables,
    miterRoot: miter,
    counterexample,
    oldTrace: makeTrace(oldGraph, oldBdd, oldValues),
    newTrace: makeTrace(newGraph, newBdd, newValues),
    oldOutput: o,
    newOutput: n,
    stats: { uniqueNodes: mgr.uniqueNodeCount, applyCalls: mgr.applyCalls },
  };
}
