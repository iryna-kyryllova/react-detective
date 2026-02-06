import { useState } from 'react'
import { ReactFlowProvider, type Node, type Edge } from '@xyflow/react'
import { useAppSelector } from './store/hooks'
import '@xyflow/react/dist/style.css'

import { usePanelBridge } from './hooks/usePanelBridge'
import { PanelDefault } from './components/PanelDefault'
import { PanelView } from './components/PanelView'
import { Sidebar } from './components/Sidebar'
import './App.css'

export default function App() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [shouldFitOnce, setShouldFitOnce] = useState(false)

  const status = useAppSelector((s) => s.panel.status)
  const analytics = useAppSelector((s) => s.panel.analytics)
  const counts = analytics.counts
  const reasons = analytics.reasons

  usePanelBridge({ setNodes, setEdges, setShouldFitOnce })

  if (status !== 'REACT_READY') {
    return <PanelDefault status={status} />
  }

  return (
    <div className='panel'>
      <div className='graph'>
        <ReactFlowProvider>
          <PanelView nodes={nodes} edges={edges} shouldFitOnce={shouldFitOnce} />
        </ReactFlowProvider>
      </div>
      <div className='sidebar'>
        <Sidebar counts={counts} reasons={reasons} />
      </div>
    </div>
  )
}
