import { useLayoutEffect, useRef } from 'react'
import { ReactFlow, useReactFlow, type Node, type Edge, Background, Controls } from '@xyflow/react'

type Props = {
  nodes: Node[]
  edges: Edge[]
  shouldFitOnce: boolean
}

export function PanelView({ nodes, edges, shouldFitOnce }: Props) {
  const { fitView } = useReactFlow()
  const didFitRef = useRef(false)

  useLayoutEffect(() => {
    if (!shouldFitOnce) return
    if (didFitRef.current) return
    if (nodes.length === 0) return

    didFitRef.current = true

    requestAnimationFrame(() => {
      try {
        fitView({ padding: 0.2 })
      } catch {
        // Fit view failed, likely due to invalid node positions. Skipping
      }
    })
  }, [shouldFitOnce, nodes.length, fitView])

  return (
    <ReactFlow nodes={nodes} edges={edges}>
      <Background />
      <Controls />
    </ReactFlow>
  )
}
