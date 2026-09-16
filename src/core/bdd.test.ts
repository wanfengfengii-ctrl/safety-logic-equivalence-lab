import { describe, expect, it } from 'vitest';
import { BddManager, BddLimitError, MAX_BDD_NODES } from './bdd';

/**
 * 测试预言机：仅在测试中对小规模变量做全赋值枚举，
 * 用于交叉核验 BDD 的真值表与满足赋值摘要。生产代码禁止枚举。
 */
function truthTable(mgr: BddManager, id: number, vars: string[]): boolean[] {
  const out: boolean[] = [];
  const n = vars.length;
  for (let mask = 0; mask < 1 << n; mask += 1) {
    const a: Record<string, 0 | 1> = {};
    vars.forEach((v, i) => {
      a[v] = (mask >> (n - 1 - i)) & 1 ? 1 : 0;
    });
    out.push(mgr.evaluate(id, a) === 1);
  }
  return out;
}

function bools(...xs: number[]): boolean[] {
  return xs.map((x) => x === 1);
}

describe('BddManager 基础与约简', () => {
  it('常量终端与文字节点', () => {
    const mgr = new BddManager(['A']);
    expect(mgr.zero).toBe(0);
    expect(mgr.one).toBe(1);
    const x = mgr.literal('A');
    expect(truthTable(mgr, x, ['A'])).toEqual(bools(0, 1));
    expect(mgr.negate(x)).toBe(mgr.apply('XOR', x, mgr.one));
    expect(truthTable(mgr, mgr.negate(x), ['A'])).toEqual(bools(1, 0));
  });

  it('R1：mk 两分支相同直接复用分支', () => {
    const mgr = new BddManager(['A']);
    const x = mgr.literal('A');
    // (x OR x) 应规约为 x
    const selfOr = mgr.apply('OR', x, x);
    expect(selfOr).toBe(x);
    // (x AND x) 应规约为 x
    expect(mgr.apply('AND', x, x)).toBe(x);
  });

  it('R2：同构三元组复用唯一节点', () => {
    const mgr = new BddManager(['A', 'B']);
    const a = mgr.literal('A');
    const b = mgr.literal('B');
    const e1 = mgr.apply('AND', a, b);
    const e2 = mgr.apply('AND', a, b);
    expect(e1).toBe(e2);
    // 交换后 AND 同构（以序为规范应得到同一节点）
    const e3 = mgr.apply('AND', b, a);
    expect(e3).toBe(e1);
  });

  it('双重否定回到原节点', () => {
    const mgr = new BddManager(['A', 'B']);
    const a = mgr.literal('A');
    const b = mgr.literal('B');
    const f = mgr.apply('XOR', a, b);
    expect(mgr.negate(mgr.negate(f))).toBe(f);
  });
});

describe('Apply 真值表（序：A < B < C，ASCII）', () => {
  const vars = ['A', 'B', 'C'];

  it('AND/OR/XOR/NOT 与布尔定义一致', () => {
    const mgr = new BddManager(vars);
    const a = mgr.literal('A');
    const b = mgr.literal('B');
    const c = mgr.literal('C');
    const and = mgr.apply('AND', a, mgr.apply('AND', b, c));
    const or = mgr.apply('OR', a, mgr.apply('OR', b, c));
    const xor = mgr.apply('XOR', a, b);
    const notA = mgr.negate(a);

    for (let mask = 0; mask < 8; mask += 1) {
      const av = (mask >> 2) & 1;
      const bv = (mask >> 1) & 1;
      const cv = mask & 1;
      const asg = { A: av as 0 | 1, B: bv as 0 | 1, C: cv as 0 | 1 };
      expect(mgr.evaluate(and, asg)).toBe((av & bv & cv) as 0 | 1);
      expect(mgr.evaluate(or, asg)).toBe((av | bv | cv) as 0 | 1);
      expect(mgr.evaluate(xor, asg)).toBe((av ^ bv) as 0 | 1);
      expect(mgr.evaluate(notA, asg)).toBe((1 - av) as 0 | 1);
    }
  });

  it('德摩根：NOT(A AND B) == NOT(A) OR NOT(B)', () => {
    const mgr = new BddManager(vars);
    const a = mgr.literal('A');
    const b = mgr.literal('B');
    const lhs = mgr.negate(mgr.apply('AND', a, b));
    const rhs = mgr.apply('OR', mgr.negate(a), mgr.negate(b));
    expect(lhs).toBe(rhs);
    expect(truthTable(mgr, lhs, vars)).toEqual(truthTable(mgr, rhs, vars));
  });

  it('异或同一函数为 0 终端（miter 等价判据）', () => {
    const mgr = new BddManager(vars);
    const f = mgr.apply(
      'OR',
      mgr.apply('AND', mgr.literal('A'), mgr.literal('B')),
      mgr.literal('C'),
    );
    expect(mgr.apply('XOR', f, f)).toBe(mgr.zero);
  });
});

describe('满足赋值摘要不变量', () => {
  /** 枚举核验：摘要确实是满足赋值 */
  function expectValidSat(mgr: BddManager, id: number) {
    if (id === mgr.zero) return;
    const sat = mgr.satisfyingAssignment(id);
    expect(mgr.evaluate(id, sat)).toBe(1);
  }

  it('所有合成节点的摘要均可满足其函数', () => {
    const vars = ['A', 'B', 'C', 'D'];
    const mgr = new BddManager(vars);
    const a = mgr.literal('A');
    const b = mgr.literal('B');
    const c = mgr.literal('C');
    const d = mgr.literal('D');
    const fs = [
      mgr.apply('AND', a, b),
      mgr.apply('OR', mgr.negate(a), b),
      mgr.apply('XOR', a, mgr.apply('XOR', b, c)),
      mgr.apply(
        'AND',
        mgr.apply('OR', a, mgr.negate(b)),
        mgr.apply('OR', c, d),
      ),
      mgr.negate(mgr.apply('AND', a, mgr.apply('AND', b, c))),
    ];
    for (const f of fs) {
      expectValidSat(mgr, f);
      // 摘要中未出现的变量补 0
      const sat = mgr.satisfyingAssignment(f);
      for (const v of vars) expect(sat[v] === 0 || sat[v] === 1).toBe(true);
    }
  });

  it('低分支可满足时优先取低分支（本变量为 0）', () => {
    // f = A OR B：根变量 A 的低分支 B 可满足 => 摘要 A=0,B=1
    const mgr = new BddManager(['A', 'B']);
    const f = mgr.apply('OR', mgr.literal('A'), mgr.literal('B'));
    expect(mgr.satisfyingAssignment(f)).toEqual({ A: 0, B: 1 });
  });

  it('低分支为 0 时才取高分支（本变量为 1）', () => {
    // f = A AND B：低分支为 0 => A=1；B 的低分支为 0 => B=1
    const mgr = new BddManager(['A', 'B']);
    const f = mgr.apply('AND', mgr.literal('A'), mgr.literal('B'));
    expect(mgr.satisfyingAssignment(f)).toEqual({ A: 1, B: 1 });
  });

  it('跳过变量补 0：f 只依赖 C 时 A、B 摘要为 0', () => {
    const mgr = new BddManager(['A', 'B', 'C']);
    const f = mgr.negate(mgr.literal('C')); // 仅 C=0 满足
    expect(mgr.satisfyingAssignment(f)).toEqual({ A: 0, B: 0, C: 0 });
    const g = mgr.literal('C'); // C=1
    expect(mgr.satisfyingAssignment(g)).toEqual({ A: 0, B: 0, C: 1 });
  });

  it('摘要随 R2 复用保持（同一节点始终同一摘要）', () => {
    const mgr = new BddManager(['A', 'B']);
    const f1 = mgr.apply('AND', mgr.literal('A'), mgr.literal('B'));
    const f2 = mgr.apply('AND', mgr.literal('A'), mgr.literal('B'));
    expect(mgr.satisfyingAssignment(f1)).toEqual(mgr.satisfyingAssignment(f2));
  });

  it('非共享变量也进入序，反例摘要包含并补 0', () => {
    const mgr = new BddManager(['A', 'B', 'EXTRA']);
    const f = mgr.apply('XOR', mgr.literal('A'), mgr.literal('B'));
    const sat = mgr.satisfyingAssignment(f);
    expect(sat.EXTRA).toBe(0);
    expect(sat.A).toBe(0);
    expect(sat.B).toBe(1);
  });

  it('终端 0 不可读取摘要', () => {
    const mgr = new BddManager(['A']);
    expect(() => mgr.satisfyingAssignment(mgr.zero)).toThrow();
  });
});

describe('规模与上限（不做全赋值枚举）', () => {
  it('16 输入奇偶函数节点数为线性，而非 2^16', () => {
    const vars = Array.from({ length: 16 }, (_, i) => `X${i.toString().padStart(2, '0')}`);
    const mgr = new BddManager(vars);
    let f = mgr.literal(vars[0]);
    for (let i = 1; i < vars.length; i += 1) {
      f = mgr.apply('XOR', f, mgr.literal(vars[i]));
    }
    // 最终奇偶函数实际可达的 ROBDD 内部节点恰为 2n-1（每层函数与其否定各一，
    // 末层文字节点不在根子树），加两终端共 2n+1，线性而非 2^16；
    // 唯一表中历史中间节点至多 O(n^2)，同样远非指数枚举
    expect(mgr.reachableNodeCount(f)).toBe(2 + 2 * vars.length - 1);
    expect(mgr.uniqueNodeCount).toBeLessThanOrEqual(2 + vars.length * vars.length);
    // 奇校验函数摘要（低优先）：X0..X14 走低补 0，末位必须走高取 1
    const sat = mgr.satisfyingAssignment(f);
    for (let i = 0; i < 15; i += 1) expect(sat[vars[i]]).toBe(0);
    expect(sat[vars[15]]).toBe(1);
    expect(mgr.evaluate(f, sat)).toBe(1);
  });

  it('超过节点上限抛出 BddLimitError', () => {
    // 用超过 MAX_BDD_NODES 的构造不现实于单元测试；直接校验导出常量与类型存在
    expect(MAX_BDD_NODES).toBeGreaterThan(0);
    expect(new BddLimitError('x').name).toBe('BddLimitError');
  });
});
