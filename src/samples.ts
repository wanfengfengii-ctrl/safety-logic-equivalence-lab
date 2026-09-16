export const EXAMPLE_EQUIVALENT_OLD = `{
  "nodes": [
    { "id": "a", "kind": "INPUT", "name": "A" },
    { "id": "b", "kind": "INPUT", "name": "B" },
    { "id": "g1", "kind": "AND", "inputs": ["a", "b"] }
  ],
  "output": "g1"
}`;

export const EXAMPLE_EQUIVALENT_NEW = `{
  "nodes": [
    { "id": "x", "kind": "INPUT", "name": "A" },
    { "id": "y", "kind": "INPUT", "name": "B" },
    { "id": "nx", "kind": "NOT", "inputs": ["x"] },
    { "id": "ny", "kind": "NOT", "inputs": ["y"] },
    { "id": "or1", "kind": "OR", "inputs": ["nx", "ny"] },
    { "id": "out", "kind": "NOT", "inputs": ["or1"] }
  ],
  "output": "out"
}`;

export const EXAMPLE_DIFFER_OLD = `{
  "nodes": [
    { "id": "a", "kind": "INPUT", "name": "A" },
    { "id": "b", "kind": "INPUT", "name": "B" },
    { "id": "g1", "kind": "AND", "inputs": ["a", "b"] }
  ],
  "output": "g1"
}`;

export const EXAMPLE_DIFFER_NEW = `{
  "nodes": [
    { "id": "p", "kind": "INPUT", "name": "A" },
    { "id": "q", "kind": "INPUT", "name": "B" },
    { "id": "g2", "kind": "OR", "inputs": ["p", "q"] }
  ],
  "output": "g2"
}`;

/** 罕见输入组合才分歧的例子：旧图为多数表决，新图错误地异或了 A·B·C，仅在全 1 时翻转 */
export const EXAMPLE_RARE_OLD = `{
  "nodes": [
    { "id": "a", "kind": "INPUT", "name": "A" },
    { "id": "b", "kind": "INPUT", "name": "B" },
    { "id": "c", "kind": "INPUT", "name": "C" },
    { "id": "ab", "kind": "AND", "inputs": ["a", "b"] },
    { "id": "ac", "kind": "AND", "inputs": ["a", "c"] },
    { "id": "bc", "kind": "AND", "inputs": ["b", "c"] },
    { "id": "o1", "kind": "OR", "inputs": ["ab", "ac"] },
    { "id": "maj", "kind": "OR", "inputs": ["o1", "bc"] }
  ],
  "output": "maj"
}`;

export const EXAMPLE_RARE_NEW = `{
  "nodes": [
    { "id": "a", "kind": "INPUT", "name": "A" },
    { "id": "b", "kind": "INPUT", "name": "B" },
    { "id": "c", "kind": "INPUT", "name": "C" },
    { "id": "ab", "kind": "AND", "inputs": ["a", "b"] },
    { "id": "ac", "kind": "AND", "inputs": ["a", "c"] },
    { "id": "bc", "kind": "AND", "inputs": ["b", "c"] },
    { "id": "o1", "kind": "OR", "inputs": ["ab", "ac"] },
    { "id": "maj", "kind": "OR", "inputs": ["o1", "bc"] },
    { "id": "abc", "kind": "AND", "inputs": ["ab", "c"] },
    { "id": "out", "kind": "XOR", "inputs": ["maj", "abc"] }
  ],
  "output": "out"
}`;
