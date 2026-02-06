/**
 * flow-utils.ts
 *
 * Utilities responsible for converting raw Fiber graph data
 * into ReactFlow-compatible nodes and edges.
 *
 * Important:
 * - page-hook.js builds a logical component graph (data only)
 * - this file prepares that data for visualization in ReactFlow
 *   (positions, styles, layout direction).
 */

import dagre from 'dagre'
import { Position, type Edge, type Node } from '@xyflow/react'

/**
 * Default node size used by dagre layout calculation.
 * Must match visual node size to avoid overlapping.
 */
const NODE_WIDTH = 180
const NODE_HEIGHT = 44

/**
 * Calculates node positions using dagre layout engine.
 *
 * Dagre builds a directed graph layout (top → bottom),
 * so React component hierarchy is displayed vertically.
 *
 * @param nodes - ReactFlow nodes without positions
 * @param edges - parent-child relationships
 * @returns nodes with calculated x/y positions
 */
export function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()

  // Required by dagre even if unused
  g.setDefaultEdgeLabel(() => ({}))

  // TB = Top → Bottom layout direction
  g.setGraph({ rankdir: 'TB' })

  // Register nodes with fixed size for layout calculations
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))

  // Register edges (connections between components)
  edges.forEach((e) => g.setEdge(e.source, e.target))

  // Calculate layout positions
  dagre.layout(g)

  // Apply calculated positions to ReactFlow nodes
  return nodes.map((n) => {
    const p = g.node(n.id)

    return {
      ...n,
      position: {
        // dagre returns center-based coordinates,
        // ReactFlow expects top-left coordinates
        x: p.x - NODE_WIDTH / 2,
        y: p.y - NODE_HEIGHT / 2
      },
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom
    }
  })
}

/**
 * Converts raw graph nodes into ReactFlow nodes.
 *
 * Adds:
 * - label for display
 * - default styling
 * - highlight styling if component updated recently
 *
 * @param graph - graph received from page-hook
 * @param isHighlightActive - function that checks if node should be highlighted
 * @returns ReactFlow nodes
 */
export function buildFlowNodes(graph: any, isHighlightActive: (id: string) => boolean): Node[] {
  return (graph.nodes || []).map((n: any) => {
    const id = String(n.id)

    // Used to temporarily highlight updated components
    const active = isHighlightActive(id)

    return {
      id,
      // Position is calculated later by dagre
      position: { x: 0, y: 0 },
      data: {
        label: n.name || 'Anonymous'
      },
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

/**
 * Converts raw graph edges into ReactFlow edges.
 *
 * Filters edges to ensure both nodes exist
 * (prevents ReactFlow warnings if graph changes mid-update).
 *
 * @param graph - graph received from page-hook
 * @param nodeIds - set of valid node ids
 * @returns ReactFlow edges
 */
export function buildFlowEdges(graph: any, nodeIds: Set<string>): Edge[] {
  return (graph.edges || [])
    .filter((e: any) => nodeIds.has(String(e.from)) && nodeIds.has(String(e.to)))
    .map((e: any, i: number) => ({
      // ReactFlow requires unique edge ids
      id: `e-${String(e.from)}-${String(e.to)}-${i}`,
      source: String(e.from),
      target: String(e.to)
    }))
}
