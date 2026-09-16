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
 * 每个唯一化节点额外维护“最小满足赋值摘要”。为避免每节点保存长度为
 * 变量数的数组（O(节点数 × 变量数) 内存），摘要以建点时即唯一确定的
 * 父指针链增量存储（satParent）：
 *   - 终端 1 为链终点（satParent = -1，已被满足，无剩余决策）；
 *   - 节点 v：低分支可满足（low !== 0，ROBDD 中非 0 节点必可满足）时取低分支，
 *     satParent = low（本变量取值 0）；否则取高分支，satParent = high（取值 1）；
 *   - 读取时从该节点沿 satParent 下降到 1 终端，途经变量写入其取值，
 *     链上跳过的变量一律保持 0。
 * 下降路径在 mk 建点时已唯一确定，读取只是把既定链式摘要展开，
 * 不是路径搜索或回溯。摘要只在建点（mk）时随约简一同确定与复用，
 * Apply/否定返回的都是 mk 的产物，因此不变量在任何约简后仍然成立。
 * 异或根的摘要展开即可直接读出为反例。
 */

export type BinOp = 'AND' | 'OR' | 'XOR';

const TERMINAL_ZERO = 0;
const TERMINAL_ONE = 1;
export const MAX_BDD_NODES = 2_000_000;

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
  /** 满足摘要链：本节点取何分支可到达 1 终端（建点时按低优先确定） */
  satParent: number;
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
    this.nodes.push(
      { varIndex: order.length, low: -1, high: -1, satParent: -1 },
      { varIndex: order.length, low: -1, high: -1, satParent: -1 },
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
    // ROBDD 中 low !== 0 当且仅当 low 子函数可满足。每节点仅 O(1) 摘要存储，
    // 具体赋值由 satisfyingAssignment 沿此既定链展开（非搜索）。
    const satParent = low !== TERMINAL_ZERO ? low : high;
    const id = this.nodes.length;
    this.nodes.push({ varIndex, low, high, satParent });
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
   * 双向缓存保证对合性 ¬(¬f) === f（同一节点 id）。
   * 使用显式栈做记忆化后序展开，串联数万级非门链也不会栈溢出。
   */
  negate(id: number): number {
    if (id === TERMINAL_ZERO) return TERMINAL_ONE;
    if (id === TERMINAL_ONE) return TERMINAL_ZERO;
    const cached0 = this.negCache.get(id);
    if (cached0 !== undefined) return cached0;

    interface NegFrame {
      id: number;
      lowR: number | undefined;
      highR: number | undefined;
    }
    const stack: NegFrame[] = [{ id, lowR: undefined, highR: undefined }];

    while (stack.length > 0) {
      const f = stack[stack.length - 1];
      const n = this.nodes[f.id];

      if (f.lowR === undefined) {
        const r = n.low <= 1 ? 1 - n.low : this.negCache.get(n.low);
        if (r === undefined) {
          stack.push({ id: n.low, lowR: undefined, highR: undefined });
          continue;
        }
        f.lowR = r;
      }
      if (f.highR === undefined) {
        const r = n.high <= 1 ? 1 - n.high : this.negCache.get(n.high);
        if (r === undefined) {
          stack.push({ id: n.high, lowR: undefined, highR: undefined });
          continue;
        }
        f.highR = r;
      }

      const result = this.mk(n.varIndex, f.lowR, f.highR);
      this.negCache.set(f.id, result);
      if (result > 1) this.negCache.set(result, f.id);
      stack.pop();
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (parent.lowR === undefined) parent.lowR = result;
        else parent.highR = result;
      }
    }

    return this.negCache.get(id)!;
  }

  /**
   * Apply：按 Shannon 展开递归合成 op(f, g)，计算表记忆化。
   * 每展开一层严格推进到序中下一变量（终止性保证）。
   * 使用显式工作栈做后序求值，超长门链（数千~数万级）不会栈溢出。
   */
  apply(op: BinOp, f: number, g: number): number {
    const direct = this.applyTerminal(op, f, g);
    if (direct !== null) return direct;
    // 幂等短路：XOR(f,f)=0；AND/OR(f,f)=f。
    // 两份完全相同门图的 miter 因此立即归约为 0，无需任何展开。
    if (f === g) {
      const idem = op === 'XOR' ? TERMINAL_ZERO : f;
      this.computedTable.set(`${op}|${f}|${g}`, idem);
      return idem;
    }
    const rootKey = `${op}|${f}|${g}`;
    if (this.computedTable.has(rootKey)) return this.computedTable.get(rootKey)!;

    interface ApplyFrame {
      f: number;
      g: number;
      v: number;
      low: number | undefined;
      high: number | undefined;
    }
    const makeFrame = (ff: number, gg: number): ApplyFrame => ({
      f: ff,
      g: gg,
      v: Math.min(this.indexOf(ff), this.indexOf(gg)),
      low: undefined,
      high: undefined,
    });
    // 返回已确定结果（终端短路或计算表命中），否则 undefined 表示需入栈展开
    const resolve = (ff: number, gg: number): number | undefined => {
      const t = this.applyTerminal(op, ff, gg);
      if (t !== null) return t;
      return this.computedTable.get(`${op}|${ff}|${gg}`);
    };

    const stack: ApplyFrame[] = [makeFrame(f, g)];
    while (stack.length > 0) {
      const fr = stack[stack.length - 1];

      if (fr.low === undefined) {
        const r = resolve(this.cofactor(fr.f, fr.v, 0), this.cofactor(fr.g, fr.v, 0));
        if (r === undefined) {
          stack.push(makeFrame(this.cofactor(fr.f, fr.v, 0), this.cofactor(fr.g, fr.v, 0)));
          continue;
        }
        fr.low = r;
      }
      if (fr.high === undefined) {
        const r = resolve(this.cofactor(fr.f, fr.v, 1), this.cofactor(fr.g, fr.v, 1));
        if (r === undefined) {
          stack.push(makeFrame(this.cofactor(fr.f, fr.v, 1), this.cofactor(fr.g, fr.v, 1)));
          continue;
        }
        fr.high = r;
      }

      const result = this.mk(fr.v, fr.low, fr.high);
      this.computedTable.set(`${op}|${fr.f}|${fr.g}`, result);
      this.applyCalls += 1;
      stack.pop();
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (parent.low === undefined) parent.low = result;
        else parent.high = result;
      }
    }

    return this.computedTable.get(rootKey)!;
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

  /**
   * 沿建点时确定的 satParent 链直接展开为“变量名 -> 0/1”。
   * 链在 mk 中唯一确定，此处不做任何搜索或回溯；未途经的变量保持 0。
   */
  satisfyingAssignment(id: number): Record<string, 0 | 1> {
    if (id === TERMINAL_ZERO) {
      throw new Error('终端 0 不可满足，无满足赋值摘要');
    }
    const assignment: Record<string, 0 | 1> = {};
    for (const name of this.order) assignment[name] = 0;
    let cur = id;
    while (cur > TERMINAL_ONE) {
      const n = this.nodes[cur];
      assignment[this.order[n.varIndex]] = n.satParent === n.high ? 1 : 0;
      cur = n.satParent;
    }
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
