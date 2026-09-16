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

function err(
  graph: 0 | 1,
  position: number,
  code: GraphError['code'],
  message: string,
  slot = -1,
): GraphError & { slot: number } {
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
): { errors: (GraphError & { slot: number })[]; graph: GateGraph | null } {
  const errors: (GraphError & { slot: number })[] = [];
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

  const nodes: GateNode[] = [];
  const idFirstPosition = new Map<string, number>();
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
      nodes.push({ id, kind: 'INPUT' });
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

    const allIdStrings = new Set<string>();
    rawNodes.forEach((rn) => {
      const rid = (rn as Record<string, unknown> | null)?.id;
      if (typeof rid === 'string') allIdStrings.add(rid);
    });

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

    const node: GateNode = { id, kind };
    if (kind === 'INPUT') node.name = n.name as string | undefined;
    if (n.inputs !== undefined) node.inputs = inputs;
    nodes.push(node);
  });

  // 输出检查
  if (typeof parsed.output === 'string' && parsed.output.length > 0) {
    if (!knownIds.has(parsed.output)) {
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

  // 环检查（Tarjan SCC；自环也算环）。仅沿已知 id 的入边建图。
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    if (!knownIds.has(node.id)) continue;
    const refs = (node.inputs ?? []).filter((r) => knownIds.has(r));
    adjacency.set(node.id, refs);
  }

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycleMembers = new Set<string>();

  const strongConnect = (v: string) => {
    indices.set(v, nextIndex);
    lowlink.set(v, nextIndex);
    nextIndex += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      const hasSelfLoop = component.some((c) =>
        (adjacency.get(c) ?? []).includes(c),
      );
      if (component.length > 1 || hasSelfLoop) {
        component.forEach((c) => cycleMembers.add(c));
      }
    }
  };

  // 按节点位置升序启动 DFS，保证错误信息稳定
  for (const node of nodes) {
    if (knownIds.has(node.id) && !indices.has(node.id)) {
      strongConnect(node.id);
    }
  }

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

/** 收集两图共享的 INPUT 变量名（同名即同一变量），ASCII 升序 */
export function sharedVariables(a: GateGraph, b: GateGraph): string[] {
  const namesA = new Set(
    a.nodes.filter((n) => n.kind === 'INPUT').map((n) => n.name!),
  );
  const namesB = new Set(
    b.nodes.filter((n) => n.kind === 'INPUT').map((n) => n.name!),
  );
  return [...namesA].filter((n) => namesB.has(n)).sort();
}
