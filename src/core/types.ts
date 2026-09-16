/**
 * 门图领域模型。
 *
 * 节点类型（受限集合）：
 * - INPUT  ：主输入，无入边，name 必须匹配 /^[A-Z][A-Z0-9_]{0,15}$/
 * - CONST0/CONST1：常量终端，无入边
 * - NOT    ：恰好一条入边
 * - AND/OR/XOR：恰好两条入边（按输入数组顺序，in[0]/in[1]）
 */
export type NodeKind =
  | 'INPUT'
  | 'CONST0'
  | 'CONST1'
  | 'NOT'
  | 'AND'
  | 'OR'
  | 'XOR';

export interface GateNode {
  id: string;
  kind: NodeKind;
  /** 仅 INPUT 使用；跨图同名 INPUT 视为同一变量 */
  name?: string;
  /** 被引用节点的 id；按粘贴 JSON 中输入位置升序排列 */
  inputs?: string[];
}

export interface GateGraph {
  /** 顶层须为对象；nodes 缺失时按语法错误拒绝 */
  nodes: GateNode[];
  /** 本图指定输出节点 id */
  output: string;
}

/** 校验错误。order 为“旧图优先、输入位置升序”的全局排序键。 */
export interface GraphError {
  /** 0 = 旧图(左栏)，1 = 新图(右栏) */
  graph: 0 | 1;
  graphLabel: string;
  /**
   * 输入位置（从 0 起，按 JSON 原文中节点出现顺序）；
   * 非节点级错误（output 等）使用哨兵值排到节点错误之后。
   */
  position: number;
  code:
    | 'SYNTAX'
    | 'DUPLICATE_ID'
    | 'UNKNOWN_REF'
    | 'ARITY'
    | 'OUTPUT'
    | 'CYCLE';
  message: string;
}

/** 0 终端 / 1 终端使用保留 id 表示 */
export const TERMINAL = { ZERO: 0, ONE: 1 } as const;
