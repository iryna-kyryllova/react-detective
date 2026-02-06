import dagre from 'dagre'
import { Position, type Edge, type Node } from '@xyflow/react'

const NODE_WIDTH = 180
const NODE_HEIGHT = 44

export function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB' })

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach((e) => g.setEdge(e.source, e.target))

  dagre.layout(g)

  return nodes.map((n) => {
    const p = g.node(n.id)
    return {
      ...n,
      position: {
        x: p.x - NODE_WIDTH / 2,
        y: p.y - NODE_HEIGHT / 2
      },
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom
    }
  })
}

export function buildFlowNodes(graph: any, isHighlightActive: (id: string) => boolean): Node[] {
  return (graph.nodes || []).map((n: any) => {
    const id = String(n.id)
    const active = isHighlightActive(id)

    return {
      id,
      position: { x: 0, y: 0 },
      data: { label: n.name || 'Anonymous' },
      style: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        padding: 6,
        fontSize: 12,
        border: active ? '2px solid #e53935' : '1px solid #999',
        background: active ? '#ffecec' : '#fff'
      }
    }
  })
}

export function buildFlowEdges(graph: any, nodeIds: Set<string>): Edge[] {
  return (graph.edges || [])
    .filter((e: any) => nodeIds.has(String(e.from)) && nodeIds.has(String(e.to)))
    .map((e: any, i: number) => ({
      id: `e-${String(e.from)}-${String(e.to)}-${i}`,
      source: String(e.from),
      target: String(e.to)
    }))
}
