import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  Background,
  Controls,
  Position
} from '@xyflow/react'
import dagre from 'dagre'
import { useAppDispatch, useAppSelector } from './store/hooks'
import { setStatus, setGraph, setAnalytics, resetAnalytics } from './store/panelSlice'

import '@xyflow/react/dist/style.css'
import { getSignature, buildStructureSignature } from './utils/graph-utils'

/**
 * DevTools panel (ReactFlow UI).
 * Receives events from background.js and renders:
 * - component tree graph
 * - simple rerender analytics
 */

const EVENT_TYPES = {
  INJECT_HOOK_FROM_PANEL: 'INJECT_HOOK_FROM_PANEL',
  PANEL_READY: 'PANEL_READY',
  STATUS: 'STATUS',
  FIBER_GRAPH: 'FIBER_GRAPH',
  FIBER_UPDATE: 'FIBER_UPDATE',
  FIBER_META: 'FIBER_META'
} as const

const NODE_WIDTH = 180
const NODE_HEIGHT = 44
const HIGHLIGHT_MS = 700
const MIN_GRAPH_NODES = 10
const GRAPH_THROTTLE_MS = 150
const PARTIAL_GRAPH_RATIO = 0.6

type GraphPayload = {
  rendererID: number
  rootId: number
  graph: {
    nodes: Array<{ id: string; name?: string }>
    edges: Array<{ from: string; to: string }>
  }
}

type FiberUpdatePayload = Array<{ id: string }>

type FiberMetaPayload = {
  commitIntervalMs: number
  diffs: Array<{
    id: string
    propsChanged: string[]
    stateChanged: string[]
    wasted: boolean
  }>
}

type StatusPayload = 'NO_HOOK' | 'NO_REACT' | 'REACT_READY'
type StatusMessage = { type: 'STATUS'; payload: StatusPayload }
type FiberGraphMessage = { type: 'FIBER_GRAPH'; payload: GraphPayload }
type FiberUpdateMessage = { type: 'FIBER_UPDATE'; payload: FiberUpdatePayload }
type FiberMetaMessage = { type: 'FIBER_META'; payload: FiberMetaPayload }
type UnknownMessage = { type: string; payload?: unknown }

type PanelMessage =
  | StatusMessage
  | FiberGraphMessage
  | FiberUpdateMessage
  | FiberMetaMessage
  | UnknownMessage

function layout(nodes: Node[], edges: Edge[]): Node[] {
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

function buildFlowNodes(graph: any, isHighlightActive: (id: string) => boolean): Node[] {
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

function buildFlowEdges(graph: any, nodeIds: Set<string>): Edge[] {
  return (graph.edges || [])
    .filter((e: any) => nodeIds.has(String(e.from)) && nodeIds.has(String(e.to)))
    .map((e: any, i: number) => ({
      id: `e-${String(e.from)}-${String(e.to)}-${i}`,
      source: String(e.from),
      target: String(e.to)
    }))
}

function PanelView(props: { nodes: Node[]; edges: Edge[]; shouldFitOnce: boolean }) {
  const { fitView } = useReactFlow()
  const didFitRef = useRef(false)

  useLayoutEffect(() => {
    if (!props.shouldFitOnce) return
    if (didFitRef.current) return
    if (props.nodes.length === 0) return

    didFitRef.current = true

    requestAnimationFrame(() => {
      try {
        fitView({ padding: 0.2 })
      } catch {
        // Fit view failed, likely due to invalid node positions. Skipping
      }
    })
  }, [props.shouldFitOnce, props.nodes.length, fitView])

  return (
    <ReactFlow nodes={props.nodes} edges={props.edges}>
      <Background />
      <Controls />
    </ReactFlow>
  )
}

export default function App() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [shouldFitOnce, setShouldFitOnce] = useState(false)

  const prevStructureSigRef = useRef<string | null>(null)
  const highlightUntilRef = useRef<Map<string, number>>(new Map())
  const clearTimerRef = useRef<number | null>(null)

  const lastGraphProcessRef = useRef<number>(0)
  const lastGoodCountRef = useRef<number>(0)
  const lastGoodLayoutRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null)
  const lastCountsRef = useRef<Record<string, number>>({})

  const dispatch = useAppDispatch()
  const status = useAppSelector((s) => s.panel.status)
  const analytics = useAppSelector((s) => s.panel.analytics)
  const counts = analytics.counts
  const reasons = analytics.reasons

  const isHighlightActive = useMemo(() => {
    return (id: string) => {
      const until = highlightUntilRef.current.get(id) ?? 0
      return until > Date.now()
    }
  }, [])

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const msg = String(e.message || '')
      if (msg.includes('ResizeObserver loop')) {
        e.preventDefault()
      }
    }

    window.addEventListener('error', onError)

    function handleFiberGraph(payload: GraphPayload) {
      const g = payload?.graph
      if (!g?.nodes || !g?.edges) return

      if (g.nodes.length < MIN_GRAPH_NODES) return

      const prevGood = lastGoodCountRef.current
      const incoming = g.nodes.length

      if (prevGood > 0 && incoming < prevGood * PARTIAL_GRAPH_RATIO) {
        return
      }

      const now = Date.now()
      if (now - lastGraphProcessRef.current < GRAPH_THROTTLE_MS) return
      lastGraphProcessRef.current = now

      const sig = buildStructureSignature(g)
      const structureChanged = prevStructureSigRef.current !== sig
      if (!structureChanged) return
      prevStructureSigRef.current = sig

      // коли структура дерева змінилась — теж чистимо "last update" дані
      dispatch(resetAnalytics())

      const rfNodes = buildFlowNodes(g, isHighlightActive)
      const idSet = new Set(rfNodes.map((n) => n.id))
      const rfEdges = buildFlowEdges(g, idSet)

      try {
        const laidOutNodes = layout(rfNodes, rfEdges)

        setNodes(laidOutNodes)
        setEdges(rfEdges)
        setShouldFitOnce(true)

        lastGoodCountRef.current = incoming
        lastGoodLayoutRef.current = {
          nodes: laidOutNodes,
          edges: rfEdges
        }
      } catch {
        const cached = lastGoodLayoutRef.current
        if (cached) {
          setNodes(cached.nodes)
          setEdges(cached.edges)
        }
      }
    }

    function applyFiberUpdate(payload: FiberUpdatePayload) {
      const now = Date.now()
      const ids = (payload || []).map((u) => String(u.id))

      ids.forEach((id) => highlightUntilRef.current.set(id, now + HIGHLIGHT_MS))

      setNodes((prev) =>
        prev.map((n) => {
          const until = highlightUntilRef.current.get(n.id) ?? 0
          const active = until > now

          return {
            ...n,
            style: {
              ...n.style,
              border: active ? '2px solid #e53935' : '1px solid #999',
              background: active ? '#ffecec' : '#fff'
            }
          }
        })
      )

      const nextCounts: Record<string, number> = {}

      ids.forEach((id) => {
        const key = getSignature(id)
        nextCounts[key] = (nextCounts[key] ?? 0) + 1
      })

      lastCountsRef.current = nextCounts

      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)

      clearTimerRef.current = window.setTimeout(() => {
        const t = Date.now()
        setNodes((prev) =>
          prev.map((n) => {
            const until = highlightUntilRef.current.get(n.id) ?? 0
            const active = until > t

            return {
              ...n,
              style: {
                ...n.style,
                border: active ? '2px solid #e53935' : '1px solid #999',
                background: active ? '#ffecec' : '#fff'
              }
            }
          })
        )
      }, HIGHLIGHT_MS + 30)
    }

    function applyFiberMeta(payload: FiberMetaPayload) {
      const diffs = payload?.diffs || []

      // setReasons(() => {
      //   const next = new Map<string, string>()

      //   diffs.forEach((d) => {
      //     const key = getSignature(d.id)

      //     if (d.wasted) {
      //       next.set(key, 'Parent or context update (Potential wasted render)')
      //       return
      //     }

      //     if (d.propsChanged?.length) {
      //       next.set(key, `Props changed: ${d.propsChanged.join(', ')}`)
      //       return
      //     }

      //     if (d.stateChanged?.length) {
      //       next.set(key, 'State changed')
      //     }
      //   })

      //   return next
      // })
      const nextReasons: Record<string, string> = {}

      diffs.forEach((d) => {
        const key = getSignature(d.id)

        if (d.wasted) {
          nextReasons[key] = 'Parent or context update (potential wasted render)'
        } else if (d.propsChanged?.length) {
          nextReasons[key] = `Props changed: ${d.propsChanged.join(', ')}`
        } else if (d.stateChanged?.length) {
          nextReasons[key] = 'State changed'
        }
      })

      dispatch(
        setAnalytics({
          counts: lastCountsRef.current,
          reasons: nextReasons
        })
      )
    }

    function resetUiForNonReact() {
      dispatch(setGraph(null))
      setNodes([])
      setEdges([])
      dispatch(resetAnalytics())
      prevStructureSigRef.current = null
      lastGoodCountRef.current = 0
      lastGoodLayoutRef.current = null
    }

    const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
      msg,
      _sender,
      _sendResponse
    ) => {
      const message = msg as PanelMessage

      if (message.type === EVENT_TYPES.STATUS) {
        dispatch(setStatus(message.payload as any))

        if (message.payload !== 'REACT_READY') {
          resetUiForNonReact()
        }
        return false
      }

      if (message.type === EVENT_TYPES.FIBER_GRAPH) {
        const payload = message.payload as GraphPayload
        dispatch(setGraph(payload.graph))
        handleFiberGraph(payload)
        return false
      }

      if (message.type === EVENT_TYPES.FIBER_UPDATE) {
        applyFiberUpdate(message.payload as FiberUpdatePayload)
        return false
      }

      if (message.type === EVENT_TYPES.FIBER_META) {
        applyFiberMeta(message.payload as FiberMetaPayload)
        return false
      }

      return false
    }

    chrome.runtime.onMessage.addListener(handler)

    chrome.runtime.sendMessage({
      type: EVENT_TYPES.INJECT_HOOK_FROM_PANEL,
      tabId: chrome.devtools.inspectedWindow.tabId
    })

    chrome.runtime.sendMessage({
      type: EVENT_TYPES.PANEL_READY
    })

    return () => {
      window.removeEventListener('error', onError)
      chrome.runtime.onMessage.removeListener(handler)
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    }
  }, [dispatch, isHighlightActive])

  const reasonList = Object.values(reasons)

  const hasPropsChanged = reasonList.some((r) => r.startsWith('Props changed'))
  const hasStateChanged = reasonList.some((r) => r.startsWith('State changed'))
  const hasPotentialWasted = reasonList.some((r) => r.includes('Potential wasted'))

  if (status !== 'REACT_READY') {
    const text =
      status === 'NO_HOOK'
        ? 'React DevTools hook не знайдено на сторінці.'
        : status === 'NO_REACT'
          ? 'React не знайдено на цій сторінці.'
          : 'Очікую дані...'

    return (
      <div style={{ padding: 16, fontFamily: 'system-ui' }}>
        <h3>ReactDetective</h3>
        <div style={{ color: '#555', marginTop: 8 }}>{text}</div>
        <div style={{ color: '#888', marginTop: 8, fontSize: 12 }}>
          Відкрий React-застосунок і перезавантаж сторінку, або відкрий DevTools ще раз.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
      <div style={{ flex: 2 }}>
        <ReactFlowProvider>
          <PanelView nodes={nodes} edges={edges} shouldFitOnce={shouldFitOnce} />
        </ReactFlowProvider>
      </div>

      <div
        style={{
          flex: 1,
          borderLeft: '1px solid #ddd',
          padding: 12,
          fontSize: 13
        }}>
        <h3>Page analytics</h3>

        {Object.entries(counts).map(([key, count]) => (
          <div key={key} style={{ marginBottom: 8 }}>
            <strong>{key}</strong>
            {count > 1 && <div>Instances updated: {count}</div>}
            {reasons[key] && <div style={{ color: '#555' }}>Reason: {reasons[key]}</div>}
          </div>
        ))}

        {counts.size === 0 && <div style={{ color: '#888' }}>No interactions on this page yet</div>}
        <hr />
        <h4>Recommendations</h4>

        {Object.keys(counts).length === 0 ? (
          <div style={{ color: '#888' }}>
            No suggestions yet. Interact with the page to collect data.
          </div>
        ) : (
          <div>
            {hasPropsChanged && (
              <>
                <strong>Props changed:</strong>
                <ul>
                  <li>
                    Try <code>React.memo</code> for heavy child components.
                  </li>
                  <li>
                    Keep props stable: memoize handlers with <code>useCallback</code> and
                    objects/arrays with <code>useMemo</code>.
                  </li>
                </ul>
              </>
            )}

            {hasStateChanged && (
              <>
                <strong>State changed:</strong>
                <ul>
                  <li>
                    Check if state can be more local (inside the component that really needs it).
                  </li>
                  <li>
                    If many children rerender because of one state, try splitting the component or
                    moving state lower/higher depending on who uses it.
                  </li>
                </ul>
              </>
            )}

            {hasPotentialWasted && (
              <>
                <strong>Parent or context update (Potential wasted render):</strong>
                <ul>
                  <li>Components updated without props/state changes.</li>
                  <li>
                    Consider memoizing children (<code>React.memo</code>), splitting large
                    components, and avoiding passing new references each render.
                  </li>
                </ul>
              </>
            )}

            {!hasPropsChanged && !hasStateChanged && !hasPotentialWasted && (
              <p style={{ color: '#888' }}>No clear patterns yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
