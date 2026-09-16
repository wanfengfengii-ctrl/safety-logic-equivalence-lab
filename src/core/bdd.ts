/**
 * 自行实现的 ROBDD（Reduced Ordered Binary Decision Diagram）。
 *
 * 严禁全赋值枚举：所有布尔运算均通过 Shannon 递归 + Apply 计算表记忆化完成，
 * 不随变量数做指数展开。节点由唯一表（unique table）去重，建点时执行两条约简：
 *   (R1) 低/高分支相同 => 直接返回该分支（冗余判定消去）；
 *   (R2) (varIndex, low, high) 三元组已存在 => 复用既有节点（同构共享）。
 *
 * 变量序：调用方给定的全序（本工作台为两图全部 INPUT 名的 ASCII 升序，
 * 因而共享变量天然按 ASCII 升序出现）。
 *
 * 每个唯一化节点额外维护“最小满足赋值摘要” sat: Uint8Array：
 *   - 终端 1 的摘要为全 0（已被满足，无剩余决策）；
 *   - 节点 v：低分支可满足（low !== 0，ROBDD 中非 0 节点必可满足）时取低分支，
 *     sat[v] = 0，其余复制 sat(low)；
 *   - 否则取高分支，sat[v] = 1，其余复制 sat(high)；
 *   - 摘要中跳过的变量一律补 0。
 * 该摘要只在建点（mk）时随约简一同计算与复用，Apply/否定返回的都是 mk 的产物，
 * 因此不变量在任何约简后仍然成立。异或根的摘要即可直接读出为反例，
 * 无需任何路径搜索或回溯。
 */

export type BinOp = 'AND' | 'OR' | 'XOR';

const TERMINAL_ZERO = 0;
const TERMINAL_ONE = 1;
export const MAX_BDD_NODES = 200_000;

export class BddLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BddLimitError';
  }
}

interface InternalNode {
  /** 变量在全序中的下标；终端使用 order.length 作为哨兵 */
  varIndex: number;
  low: number;
  high: number;
  /** 到终端 1 的最小满足赋值摘要（长度 = 变量数） */
  sat: Uint8Array;
}

export class BddManager {
  readonly order: string[];
  readonly varIndex: ReadonlyMap<string, number>;
  /** nodes[0] / nodes[1] 为两个终端 */
  readonly nodes: InternalNode[] = [];
  /** 唯一表：`varIndex|low|high` -> 节点 id */
  readonly uniqueTable = new Map<string, number>();
  /** Apply 计算表：`op|f|g` -> 节点 id */
  readonly computedTable = new Map<string, number>();
  /** 变量文字节点缓存：varIndex -> x（非 x 由高/低互换得到） */
  private readonly literals = new Map<number, number>();
  /** 否定结果缓存（sat 由 mk 维护） */
  private readonly negCache = new Map<number, number>();

  applyCalls = 0;

  constructor(order: string[]) {
    this.order = order;
    const m = new Map<string, number>();
    order.forEach((name, i) => m.set(name, i));
    this.varIndex = m;
    const zeroSat = new Uint8Array(order.length);
    this.nodes.push(
      { varIndex: order.length, low: -1, high: -1, sat: zeroSat },
      { varIndex: order.length, low: -1, high: -1, sat: zeroSat },
    );
  }

  get zero(): number {
    return TERMINAL_ZERO;
  }
  get one(): number {
    return TERMINAL_ONE;
  }

  get uniqueNodeCount(): number {
    return this.nodes.length;
  }

  /** 从某函数根实际可达的唯一节点数（死节点不计） */
  reachableNodeCount(root: number): number {
    const seen = new Set<number>();
    const stack = [root];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id <= 1 || seen.has(id)) continue;
      seen.add(id);
      const n = this.nodes[id];
      stack.push(n.low, n.high);
    }
    // 可达集合 + 两个终端
    return seen.size + 2;
  }

  /**
   * 规范建点：执行 R1/R2 约简并维护 sat 不变量。
   */
  mk(varIndex: number, low: number, high: number): number {
    // R1：两分支等价，变量冗余
    if (low === high) return low;

    const key = `${varIndex}|${low}|${high}`;
    const existing = this.uniqueTable.get(key);
    if (existing !== undefined) return existing;

    if (this.nodes.length >= MAX_BDD_NODES) {
      throw new BddLimitError(
        `ROBDD 唯一表节点数超过上限 ${MAX_BDD_NODES}，疑似中间 BDD 爆炸，已停止`,
      );
    }

    // 不变量：低分支可满足则走低分支（本变量取 0），否则走高分支（取 1）。
    // ROBDD 中 low !== 0 当且仅当 low 子函数可满足。
    const source = low !== TERMINAL_ZERO ? low : high;
    const sat = new Uint8Array(this.nodes[source].sat);
    sat[varIndex] = low !== TERMINAL_ZERO ? 0 : 1;

    const id = this.nodes.length;
    this.nodes.push({ varIndex, low, high, sat });
    this.uniqueTable.set(key, id);
    return id;
  }

  /** 变量文字 x（取 1 走高分支） */
  literal(name: string): number {
    const v = this.varIndex.get(name)!;
    const cached = this.literals.get(v);
    if (cached !== undefined) return cached;
    const id = this.mk(v, TERMINAL_ZERO, TERMINAL_ONE);
    this.literals.set(v, id);
    return id;
  }

  private indexOf(id: number): number {
    return id <= 1 ? this.order.length : this.nodes[id].varIndex;
  }

  /** 令 id 在变量 v 处取 branch（0=低,1=高）；若 id 不判定 v 则保持 id */
  private cofactor(id: number, v: number, branch: 0 | 1): number {
    if (id <= 1 || this.nodes[id].varIndex !== v) return id;
    return branch === 0 ? this.nodes[id].low : this.nodes[id].high;
  }

  /**
   * 布尔否定：终端互换；内部节点由 mk 重建（R1/R2 与 sat 自动维护）。
   * 双向缓存保证对合性 ¬(¬f) === f（同一节点 id），这是奇偶等函数
   * 完全共享（每变量层恰好两个节点）的必要条件。
   */
  negate(id: number): number {
    if (id === TERMINAL_ZERO) return TERMINAL_ONE;
    if (id === TERMINAL_ONE) return TERMINAL_ZERO;
    const cached = this.negCache.get(id);
    if (cached !== undefined) return cached;
    const n = this.nodes[id];
    const result = this.mk(
      n.varIndex,
      this.negate(n.low),
      this.negate(n.high),
    );
    this.negCache.set(id, result);
    if (result > 1) this.negCache.set(result, id);
    return result;
  }

  /**
   * Apply：按 Shannon 展开递归合成 op(f, g)，计算表记忆化。
   * 递归深度不超过变量数（每层严格推进到序中下一变量）。
   */
  apply(op: BinOp, f: number, g: number): number {
    // 终端短路
    const terminal = this.applyTerminal(op, f, g);
    if (terminal !== null) return terminal;

    const key = `${op}|${f}|${g}`;
    const cached = this.computedTable.get(key);
    if (cached !== undefined) return cached;
    this.applyCalls += 1;

    const v = Math.min(this.indexOf(f), this.indexOf(g));
    const fLow = this.cofactor(f, v, 0);
    const fHigh = this.cofactor(f, v, 1);
    const gLow = this.cofactor(g, v, 0);
    const gHigh = this.cofactor(g, v, 1);

    const low = this.apply(op, fLow, gLow);
    const high = this.apply(op, fHigh, gHigh);
    const result = this.mk(v, low, high);
    this.computedTable.set(key, result);
    return result;
  }

  private applyTerminal(op: BinOp, f: number, g: number): number | null {
    if (f > 1 && g > 1) return null;
    switch (op) {
      case 'AND':
        if (f === TERMINAL_ZERO || g === TERMINAL_ZERO) return TERMINAL_ZERO;
        if (f === TERMINAL_ONE) return g;
        return f; // g === 1
      case 'OR':
        if (f === TERMINAL_ONE || g === TERMINAL_ONE) return TERMINAL_ONE;
        if (f === TERMINAL_ZERO) return g;
        return f; // g === 0
      case 'XOR':
        if (f <= 1 && g <= 1) return f ^ g;
        if (f === TERMINAL_ZERO) return g;
        if (g === TERMINAL_ZERO) return f;
        if (f === TERMINAL_ONE) return this.negate(g);
        return this.negate(f); // g === 1
    }
  }

  /** 直接读取节点摘要为“变量名 -> 0/1”，不做任何搜索 */
  satisfyingAssignment(id: number): Record<string, 0 | 1> {
    if (id === TERMINAL_ZERO) {
      throw new Error('终端 0 不可满足，无满足赋值摘要');
    }
    const sat = this.nodes[id].sat;
    const assignment: Record<string, 0 | 1> = {};
    this.order.forEach((name, i) => {
      assignment[name] = sat[i] === 1 ? 1 : 0;
    });
    return assignment;
  }

  /** 沿 BDD 按给定赋值求值（用于交叉核验，不参与反例产生） */
  evaluate(id: number, assignment: Readonly<Record<string, 0 | 1>>): 0 | 1 {
    let cur = id;
    while (cur > 1) {
      const n = this.nodes[cur];
      cur = assignment[this.order[n.varIndex]] === 1 ? n.high : n.low;
    }
    return cur === 1 ? 1 : 0;
  }
}
