import type { GateGraph, GateNode, GraphError, NodeKind } from './types';

export const POSITION_AFTER_NODES = Number.MAX_SAFE_INTEGER;

const CODE_ORDER: Record<GraphError['code'], number> = {
  SYNTAX: 0,
  DUPLICATE_ID: 1,
  UNKNOWN_REF: 2,
  ARITY: 3,
  OUTPUT: 4,
  CYCLE: 5,
};

const KINDS: ReadonlySet<string> = new Set([
  'INPUT',
  'CONST0',
  'CONST1',
  'NOT',
  'AND',
  'OR',
  'XOR',
]);

/** 输入变量名：大写字母开头，后跟 0–15 个大写字母/数字/下划线 */
export const INPUT_NAME_RE = /^[A-Z][A-Z0-9_]{0,15}$/;

const ARITY: Record<NodeKind, number> = {
  INPUT: 0,
  CONST0: 0,
  CONST1: 0,
  NOT: 1,
  AND: 2,
  OR: 2,
  XOR: 2,
};

interface RawGraph {
  nodes: unknown;
  output: unknown;
}

interface ValidationResult {
  errors: GraphError[];
  graphs: [GateGraph, GateGraph] | null;
}

type DetailedError = GraphError & { slot: number };

function err(
  graph: 0 | 1,
  position: number,
  code: GraphError['code'],
  message: string,
  slot = -1,
): DetailedError {
  return {
    graph,
    graphLabel: graph === 0 ? '旧图(A)' : '新图(B)',
    position,
    code,
    message,
    slot,
  };
}

/**
 * 校验单图。错误收集顺序天然为节点位置升序，
 * 最终由 validatePair 统一按 (图, 位置, 类别, 入边槽位) 稳定排序。
 */
function validateOne(
  rawText: string,
  graphIndex: 0 | 1,
): { errors: DetailedError[]; graph: GateGraph | null } {
  const errors: DetailedError[] = [];
  const label = graphIndex === 0 ? '旧图(A)' : '新图(B)';

  let parsed: RawGraph;
  try {
    parsed = JSON.parse(rawText) as RawGraph;
  } catch (e) {
    return {
      errors: [
        err(
          graphIndex,
          POSITION_AFTER_NODES,
          'SYNTAX',
          `JSON 解析失败：${(e as Error).message}`,
        ),
      ],
      graph: null,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      errors: [
        err(
          graphIndex,
          POSITION_AFTER_NODES,
          'SYNTAX',
          '顶层必须是包含 nodes 与 output 的 JSON 对象',
        ),
      ],
      graph: null,
    };
  }

  if (!Array.isArray(parsed.nodes)) {
    errors.push(
      err(graphIndex, POSITION_AFTER_NODES, 'SYNTAX', 'nodes 必须为数组'),
    );
    if (typeof parsed.output !== 'string' || parsed.output.length === 0) {
      errors.push(
        err(graphIndex, POSITION_AFTER_NODES, 'OUTPUT', 'output 必须指定一个节点 id'),
      );
    }
    return { errors, graph: null };
  }
  const rawNodes: unknown[] = parsed.nodes;

  if (typeof parsed.output !== 'string' || parsed.output.length === 0) {
    errors.push(
      err(graphIndex, POSITION_AFTER_NODES, 'OUTPUT', 'output 必须指定一个节点 id'),
    );
  }

  // 预扫一遍收集全部 id 字符串（含重复 id），避免在每节点处重复扫描（万级节点时防 O(n^2)）
  const allIdStrings = new Set<string>();
  for (const rn of rawNodes) {
    const rid = (rn as Record<string, unknown> | null)?.id;
    if (typeof rid === 'string' && rid.length > 0) allIdStrings.add(rid);
  }

  const nodes: GateNode[] = [];
  const idFirstPosition = new Map<string, number>();
  // knownIds 仅保留首次出现的 id（重复 id 的后续副本不建图、不参与环检测）
  const knownIds = new Set<string>();

  rawNodes.forEach((item, position) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push(
        err(graphIndex, position, 'SYNTAX', `位置 ${position}：节点必须为 JSON 对象`),
      );
      return;
    }
    const n = item as Record<string, unknown>;

    if (typeof n.id !== 'string' || n.id.length === 0) {
      errors.push(
        err(graphIndex, position, 'SYNTAX', `位置 ${position}：节点 id 缺失或非字符串`),
      );
      return;
    }
    const id = n.id;

    if (idFirstPosition.has(id)) {
      errors.push(
        err(
          graphIndex,
          position,
          'DUPLICATE_ID',
          `位置 ${position}：节点 id "${id}" 重复（首次出现于位置 ${idFirstPosition.get(id)}）`,
        ),
      );
    } else {
      idFirstPosition.set(id, position);
      knownIds.add(id);
    }

    if (typeof n.kind !== 'string' || !KINDS.has(n.kind)) {
      errors.push(
        err(
          graphIndex,
          position,
          'SYNTAX',
          `位置 ${position}（id "${id}"）：类型 "${String(n.kind)}" 非法，仅允许 INPUT/CONST0/CONST1/NOT/AND/OR/XOR`,
        ),
      );
      // 类型未知，后续元数检查无意义
      if (knownIds.has(id)) nodes.push({ id, kind: 'INPUT' });
      return;
    }
    const kind = n.kind as NodeKind;

    if (kind === 'INPUT') {
      if (typeof n.name !== 'string' || !INPUT_NAME_RE.test(n.name)) {
        errors.push(
          err(
            graphIndex,
            position,
            'SYNTAX',
            `位置 ${position}（id "${id}"）：INPUT 名 "${String(n.name)}" 不匹配 [A-Z][A-Z0-9_]{0,15}`,
          ),
        );
      }
    } else if (n.name !== undefined) {
      errors.push(
        err(
          graphIndex,
          position,
          'SYNTAX',
          `位置 ${position}（id "${id}"）：仅 INPUT 节点允许 name 字段`,
        ),
      );
    }

    const inputs: string[] = [];
    if (n.inputs === undefined) {
      // 缺省按空入边处理，交给元数检查
    } else if (!Array.isArray(n.inputs)) {
      errors.push(
        err(
          graphIndex,
          position,
          'ARITY',
          `位置 ${position}（id "${id}"）：inputs 必须为数组`,
        ),
      );
    } else {
      n.inputs.forEach((ref, slot) => {
        if (typeof ref !== 'string' || ref.length === 0) {
          errors.push(
            err(
              graphIndex,
              position,
              'SYNTAX',
              `位置 ${position}（id "${id}"）：第 ${slot} 条入边引用必须为非空字符串`,
              slot,
            ),
          );
        } else {
          inputs.push(ref);
        }
      });
    }

    const expected = ARITY[kind];
    if (inputs.length !== expected) {
      errors.push(
        err(
          graphIndex,
          position,
          'ARITY',
          `位置 ${position}（id "${id}"，${kind}）：入边数为 ${inputs.length}，应为 ${expected}`,
        ),
      );
    }

    inputs.forEach((ref, slot) => {
      // 前向引用允许（门图不要求拓扑序）
      if (!allIdStrings.has(ref)) {
        errors.push(
          err(
            graphIndex,
            position,
            'UNKNOWN_REF',
            `位置 ${position}（id "${id}"）：第 ${slot} 条入边引用未知节点 "${ref}"`,
            slot,
          ),
        );
      }
    });

    if (knownIds.has(id)) {
      const node: GateNode = { id, kind };
      if (kind === 'INPUT') node.name = n.name as string | undefined;
      if (n.inputs !== undefined) node.inputs = inputs;
      nodes.push(node);
    }
  });

  // 输出检查
  if (typeof parsed.output === 'string' && parsed.output.length > 0) {
    if (!allIdStrings.has(parsed.output)) {
      errors.push(
        err(
          graphIndex,
          POSITION_AFTER_NODES,
          'OUTPUT',
          `${label}：输出节点 "${parsed.output}" 不在 nodes 中`,
        ),
      );
    }
  }

  const cycleMembers = detectCycleMembers(nodes, knownIds);

  const positionById = new Map<string, number>();
  rawNodes.forEach((rn, i) => {
    const rid = (rn as Record<string, unknown> | null)?.id;
    if (typeof rid === 'string') positionById.set(rid, i);
  });
  Array.from(cycleMembers)
    .sort((a, b) => (positionById.get(a) ?? 0) - (positionById.get(b) ?? 0))
    .forEach((id) => {
      errors.push(
        err(
          graphIndex,
          positionById.get(id) ?? POSITION_AFTER_NODES,
          'CYCLE',
          `${label}：节点 "${id}" 位于有向环中（门图必须为 DAG）`,
        ),
      );
    });

  const graph: GateGraph = {
    nodes,
    output: typeof parsed.output === 'string' ? parsed.output : '',
  };
  return { errors, graph };
}

/**
 * 环检测：迭代式 Kosaraju（两趟显式栈 DFS），万级串联门链不会栈溢出。
 * 边 id -> 其入边引用（信号流向为 引用方 -> 被引用方）。
 * 返回处于非平凡强连通分量（多节点 SCC 或自环）中的节点集合。
 */
function detectCycleMembers(
  nodes: GateNode[],
  knownIds: Set<string>,
): Set<string> {
  const adj = new Map<string, string[]>();
  const radj = new Map<string, string[]>();
  for (const id of knownIds) {
    adj.set(id, []);
    radj.set(id, []);
  }
  for (const node of nodes) {
    if (!knownIds.has(node.id)) continue;
    for (const r of node.inputs ?? []) {
      if (knownIds.has(r)) {
        adj.get(node.id)!.push(r);
        radj.get(r)!.push(node.id);
      }
    }
  }

  // 第一趟：在原图上迭代 DFS，记录完成序
  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const start of knownIds) {
    if (visited.has(start)) continue;
    // 帧 [节点, 下一条邻接边下标]
    const stack: Array<[string, number]> = [[start, 0]];
    visited.add(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const [v, nextEdge] = frame;
      const neighbors = adj.get(v) ?? [];
      if (nextEdge < neighbors.length) {
        frame[1] = nextEdge + 1;
        const w = neighbors[nextEdge];
        if (!visited.has(w)) {
          visited.add(w);
          stack.push([w, 0]);
        }
      } else {
        finishOrder.push(v);
        stack.pop();
      }
    }
  }

  // 第二趟：按完成序逆序在反图上 DFS，每次展开得到一个 SCC
  const assigned = new Set<string>();
  const cycleMembers = new Set<string>();
  for (let i = finishOrder.length - 1; i >= 0; i -= 1) {
    const start = finishOrder[i];
    if (assigned.has(start)) continue;
    const component: string[] = [];
    const dfsStack = [start];
    assigned.add(start);
    while (dfsStack.length > 0) {
      const v = dfsStack.pop()!;
      component.push(v);
      for (const w of radj.get(v) ?? []) {
        if (!assigned.has(w)) {
          assigned.add(w);
          dfsStack.push(w);
        }
      }
    }
    const hasSelfLoop = component.some((c) => (adj.get(c) ?? []).includes(c));
    if (component.length > 1 || hasSelfLoop) {
      component.forEach((c) => cycleMembers.add(c));
    }
  }
  return cycleMembers;
}

/**
 * 校验两份门图。旧图(graph 0)错误整体排在新图之前，
 * 同图内按输入位置（JSON 中节点下标）升序。
 */
export function validatePair(
  oldText: string,
  newText: string,
): ValidationResult {
  const a = validateOne(oldText, 0);
  const b = validateOne(newText, 1);
  const all = [...a.errors, ...b.errors].sort((x, y) => {
    if (x.graph !== y.graph) return x.graph - y.graph;
    if (x.position !== y.position) return x.position - y.position;
    if (x.code !== y.code) return CODE_ORDER[x.code] - CODE_ORDER[y.code];
    return x.slot - y.slot;
  });

  if (all.length > 0 || !a.graph || !b.graph) {
    return { errors: all, graphs: null };
  }
  return { errors: [], graphs: [a.graph, b.graph] };
}

/** 收集两图共享的 INPUT 变量名（同名即同一变量，按名去重，ASCII 升序） */
export function sharedVariables(a: GateGraph, b: GateGraph): string[] {
  const namesA = new Set(
    a.nodes.filter((n) => n.kind === 'INPUT').map((n) => n.name!),
  );
  const namesB = new Set(
    b.nodes.filter((n) => n.kind === 'INPUT').map((n) => n.name!),
  );
  return [...namesA].filter((n) => namesB.has(n)).sort();
}
