import type { GateGraph } from '../core/types';
import { layoutGraph, type GraphLayout } from '../core/layout';

interface GateGraphSvgProps {
  graph: GateGraph;
  /** 反例赋值；存在时按电平给节点着色 */
  assignment?: Readonly<Record<string, 0 | 1>> | null;
  /** 节点 id -> 该门具体复算值 */
  values?: ReadonlyMap<string, 0 | 1> | null;
  highlightedOutput?: boolean;
  testId?: string;
}

const KIND_COLORS: Record<string, string> = {
  INPUT: '#3b82f6',
  CONST0: '#64748b',
  CONST1: '#64748b',
  NOT: '#f59e0b',
  AND: '#10b981',
  OR: '#8b5cf6',
  XOR: '#ef4444',
};

function GateShape({
  layout,
  values,
  assignment,
}: {
  layout: GraphLayout;
  values?: ReadonlyMap<string, 0 | 1> | null;
  assignment?: Readonly<Record<string, 0 | 1>> | null;
}) {
  return (
    <>
      {layout.nodes.map((pn) => {
        const { node, x, y, width: w, height: h } = pn;
        const fill = KIND_COLORS[node.kind] ?? '#334155';
        const v = values?.get(node.id);
        const powered = v === 1;
        const label =
          node.kind === 'INPUT'
            ? node.name ?? node.id
            : node.kind === 'CONST0'
              ? '0'
              : node.kind === 'CONST1'
                ? '1'
                : node.kind;
        return (
          <g key={node.id} data-node-id={node.id} className={powered ? 'gate-powered' : ''}>
            {node.kind === 'AND' || node.kind === 'XOR' ? (
              <g opacity={values && !powered ? 0.45 : 1}>
                <path
                  d={andShapePath(x, y, w, h)}
                  fill={fill}
                  stroke="#0f172a"
                  strokeWidth={1.5}
                />
                {node.kind === 'XOR' && (
                  <path
                    d={`M ${x - 1} ${y} Q ${x + 9} ${y + h / 2} ${x - 1} ${y + h}`}
                    fill="none"
                    stroke="#0f172a"
                    strokeWidth={1.5}
                  />
                )}
              </g>
            ) : node.kind === 'OR' ? (
              <path
                d={orShapePath(x, y, w, h)}
                fill={fill}
                stroke="#0f172a"
                strokeWidth={1.5}
                opacity={values && !powered ? 0.45 : 1}
              />
            ) : node.kind === 'NOT' ? (
              <g opacity={values && !powered ? 0.45 : 1}>
                <path
                  d={`M ${x + 2} ${y + 2} L ${x + w - 10} ${y + h / 2} L ${x + 2} ${y + h - 2} Z`}
                  fill={fill}
                  stroke="#0f172a"
                  strokeWidth={1.5}
                />
                <circle cx={x + w - 5} cy={y + h / 2} r={4.5} fill="#fff" stroke="#0f172a" strokeWidth={1.5} />
              </g>
            ) : (
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={node.kind === 'INPUT' ? 8 : 4}
                fill={fill}
                stroke="#0f172a"
                strokeWidth={1.5}
                opacity={values && !powered ? 0.45 : 1}
              />
            )}
            <text
              x={x + w / 2 - (node.kind === 'NOT' ? 4 : 0)}
              y={y + h / 2 - (node.kind === 'INPUT' && assignment ? 6 : 2)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={13}
              fontWeight={700}
              fill="#ffffff"
            >
              {label}
            </text>
            <text
              x={x + w / 2}
              y={y + h + 14}
              textAnchor="middle"
              fontSize={10}
              fill="#475569"
            >
              {node.id}
            </text>
            {node.kind === 'INPUT' && assignment ? (
              <text
                x={x + w / 2}
                y={y + h / 2 + 12}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="#fef3c7"
              >
                = {assignment[node.name!]}
              </text>
            ) : null}
            {v !== undefined && node.kind !== 'INPUT' ? (
              <circle cx={x + w + 9} cy={y + h / 2} r={7} fill={v === 1 ? '#22c55e' : '#cbd5e1'} stroke="#0f172a" strokeWidth={1} />
            ) : null}
          </g>
        );
      })}
    </>
  );
}

function andShapePath(x: number, y: number, w: number, h: number): string {
  const r = h / 2;
  const arcStartX = x + w - r;
  return `M ${x} ${y} L ${arcStartX} ${y} A ${r} ${r} 0 0 1 ${arcStartX} ${y + h} L ${x} ${y + h} Z`;
}

function orShapePath(x: number, y: number, w: number, h: number): string {
  const r = h / 2;
  return `M ${x + 4} ${y}
          Q ${x + 14} ${y + h / 2} ${x + 4} ${y + h}
          Q ${x + w - r} ${y + h} ${x + w - 2} ${y + h / 2}
          Q ${x + w - r} ${y} ${x + 4} ${y} Z`;
}

export default function GateGraphSvg({
  graph,
  assignment,
  values,
  testId,
}: GateGraphSvgProps) {
  const layout = layoutGraph(graph);
  return (
    <svg
      data-testid={testId}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="gate-svg"
      role="img"
    >
      {layout.edges.map((e, i) => (
        <g key={`${e.from}-${e.to}-${i}`}>
          <path d={e.d} fill="none" stroke="#64748b" strokeWidth={1.8} />
        </g>
      ))}
      <GateShape layout={layout} values={values} assignment={assignment} />
    </svg>
  );
}
