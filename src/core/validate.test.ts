import { describe, expect, it } from 'vitest';
import { validatePair, sharedVariables, INPUT_NAME_RE } from './validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function graph(nodes: any, output: unknown) {
  return JSON.stringify({ nodes, output });
}

const VALID_A = graph(
  [
    { id: 'a', kind: 'INPUT', name: 'A' },
    { id: 'b', kind: 'INPUT', name: 'B' },
    { id: 'g', kind: 'AND', inputs: ['a', 'b'] },
  ],
  'g',
);
const VALID_B = graph(
  [
    { id: 'x', kind: 'INPUT', name: 'A' },
    { id: 'y', kind: 'INPUT', name: 'B' },
    { id: 'g', kind: 'OR', inputs: ['x', 'y'] },
  ],
  'g',
);

describe('输入名规则', () => {
  it.each(['A', 'A1', 'AB', 'A_B', 'Z0', 'A'.repeat(16)])(
    '接受合法名 %s',
    (name) => {
      expect(INPUT_NAME_RE.test(name)).toBe(true);
    },
  );
  it.each(['', 'a', '1A', '_A', 'A-1', 'AB C', 'A'.repeat(17), 'A$'])(
    '拒绝非法名 %s',
    (name) => {
      expect(INPUT_NAME_RE.test(name)).toBe(false);
    },
  );
});

describe('语法与结构校验', () => {
  it('合法双图通过', () => {
    const r = validatePair(VALID_A, VALID_B);
    expect(r.errors).toEqual([]);
    expect(r.graphs).not.toBeNull();
  });

  it('JSON 语法错误', () => {
    const r = validatePair('{not json', VALID_B);
    expect(r.errors[0].code).toBe('SYNTAX');
    expect(r.graphs).toBeNull();
  });

  it('顶层必须为对象', () => {
    const r = validatePair('[]', VALID_B);
    expect(r.errors[0].code).toBe('SYNTAX');
  });

  it('nodes 必须为数组', () => {
    const r = validatePair(graph({}, 'x'), VALID_B);
    expect(r.errors.some((e) => e.code === 'SYNTAX')).toBe(true);
  });

  it('非法类型', () => {
    const r = validatePair(
      graph([{ id: 'a', kind: 'NAND', inputs: [] }], 'a'),
      VALID_B,
    );
    expect(r.errors[0].code).toBe('SYNTAX');
  });

  it('重复 id', () => {
    const r = validatePair(
      graph(
        [
          { id: 'a', kind: 'INPUT', name: 'A' },
          { id: 'a', kind: 'CONST0' },
        ],
        'a',
      ),
      VALID_B,
    );
    expect(r.errors.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
  });

  it('未知引用', () => {
    const r = validatePair(
      graph(
        [
          { id: 'a', kind: 'INPUT', name: 'A' },
          { id: 'g', kind: 'NOT', inputs: ['ghost'] },
        ],
        'g',
      ),
      VALID_B,
    );
    expect(r.errors.some((e) => e.code === 'UNKNOWN_REF')).toBe(true);
  });

  it('元数：INPUT/常量无入边，NOT 一条，其余两条', () => {
    const r = validatePair(
      graph(
        [
          { id: 'a', kind: 'INPUT', name: 'A', inputs: ['x'] },
          { id: 'n', kind: 'NOT', inputs: [] },
          { id: 'g', kind: 'AND', inputs: ['a'] },
          { id: 'h', kind: 'XOR', inputs: ['a', 'n', 'g'] },
        ],
        'g',
      ),
      VALID_B,
    );
    const arity = r.errors.filter((e) => e.code === 'ARITY');
    expect(arity.length).toBe(4);
  });

  it('缺省 inputs 按空入边计元数错误', () => {
    const r = validatePair(
      graph([{ id: 'g', kind: 'AND' }], 'g'),
      VALID_B,
    );
    expect(r.errors.some((e) => e.code === 'ARITY')).toBe(true);
  });

  it('output 缺失/非字符串/未知均拒绝', () => {
    expect(validatePair(graph([], 3), VALID_B).errors[0].code).toBe('OUTPUT');
    const r2 = validatePair(graph([{ id: 'a', kind: 'CONST1' }], 'zzz'), VALID_B);
    expect(r2.errors.some((e) => e.code === 'OUTPUT')).toBe(true);
  });

  it('自环拒绝', () => {
    const r = validatePair(
      graph([{ id: 'g', kind: 'NOT', inputs: ['g'] }], 'g'),
      VALID_B,
    );
    expect(r.errors.some((e) => e.code === 'CYCLE')).toBe(true);
  });

  it('两节点环拒绝', () => {
    const r = validatePair(
      graph(
        [
          { id: 'a', kind: 'INPUT', name: 'A' },
          { id: 'g', kind: 'NOT', inputs: ['h'] },
          { id: 'h', kind: 'NOT', inputs: ['g'] },
        ],
        'g',
      ),
      VALID_B,
    );
    expect(r.errors.filter((e) => e.code === 'CYCLE').length).toBe(2);
  });

  it('允许前向引用（非环）', () => {
    const r = validatePair(
      graph(
        [
          { id: 'g', kind: 'NOT', inputs: ['a'] },
          { id: 'a', kind: 'INPUT', name: 'A' },
        ],
        'g',
      ),
      VALID_B,
    );
    expect(r.errors).toEqual([]);
  });

  it('非 INPUT 携带 name 视为语法错误', () => {
    const r = validatePair(
      graph([{ id: 'c', kind: 'CONST0', name: 'X' }], 'c'),
      VALID_B,
    );
    expect(r.errors[0].code).toBe('SYNTAX');
  });
});

describe('错误排序：旧图优先、输入位置升序', () => {
  it('旧图错误全部排在新图之前', () => {
    const badOld = graph(
      [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'g', kind: 'AND', inputs: ['a', 'nope'] },
      ],
      'g',
    );
    const badNew = graph(
      [{ id: 'x', kind: 'INPUT', name: 'X' }],
      'missing-out',
    );
    const r = validatePair(badOld, badNew);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
    expect(r.errors[0].graph).toBe(0);
    const firstNew = r.errors.findIndex((e) => e.graph === 1);
    const lastOld = r.errors.map((e) => e.graph).lastIndexOf(0);
    expect(lastOld).toBeLessThan(firstNew);
  });

  it('同图内按节点位置升序', () => {
    const bad = graph(
      [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'g1', kind: 'NOT', inputs: ['miss1'] },
        { id: 'g2', kind: 'NOT', inputs: ['miss2'] },
      ],
      'g2',
    );
    const r = validatePair(bad, VALID_B);
    const positions = r.errors
      .filter((e) => e.graph === 0 && Number.isFinite(e.position))
      .map((e) => e.position);
    expect([...positions]).toEqual([...positions].sort((x, y) => x - y));
    expect(r.errors.find((e) => e.message.includes('miss1'))!.position).toBeLessThan(
      r.errors.find((e) => e.message.includes('miss2'))!.position,
    );
  });

  it('同一位置多条入边错误按槽位升序', () => {
    const bad = graph(
      [
        { id: 'a', kind: 'INPUT', name: 'A' },
        { id: 'g', kind: 'AND', inputs: ['u1', 'u2'] },
      ],
      'g',
    );
    const r = validatePair(bad, VALID_B);
    const slots = r.errors
      .filter((e) => e.code === 'UNKNOWN_REF')
      .map((e) => e.message);
    expect(slots[0]).toContain('u1');
    expect(slots[1]).toContain('u2');
  });

  it('任一错误整次拒绝（无可用图）', () => {
    const r = validatePair(VALID_A, 'garbage');
    expect(r.graphs).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('共享变量', () => {
  it('跨图同名 INPUT 为同一变量，按 ASCII 升序', () => {
    const r = validatePair(
      graph(
        [
          { id: 'b', kind: 'INPUT', name: 'B' },
          { id: 'a', kind: 'INPUT', name: 'A' },
          { id: 'c', kind: 'INPUT', name: 'A0' },
        ],
        'b',
      ),
      graph(
        [
          { id: 'x', kind: 'INPUT', name: 'A' },
          { id: 'y', kind: 'INPUT', name: 'C' },
          { id: 'z', kind: 'INPUT', name: 'A0' },
        ],
        'x',
      ),
    );
    const [g1, g2] = r.graphs!;
    expect(sharedVariables(g1, g2)).toEqual(['A', 'A0']);
  });
});
