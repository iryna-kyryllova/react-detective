/**
 * usePanelBridge.ts
 *
 * Listens to messages from the extension (background/page-hook)
 * and updates:
 * - Redux state (status, raw graph, analytics)
 * - ReactFlow UI state (nodes/edges + highlight)
 */

import { useEffect, useMemo, useRef } from 'react'
import type { Node, Edge } from '@xyflow/react'

import { useAppDispatch } from '../store/hooks'
import { setStatus, setGraph, setAnalytics, resetAnalytics } from '../store/panelSlice'

import {
  EVENT_TYPES,
  type PanelMessage,
  type GraphPayload,
  type FiberUpdatePayload,
  type FiberMetaPayload
} from '../shared/types'
import { getSignature, buildStructureSignature } from '../utils/graph-utils'
import { layout, buildFlowNodes, buildFlowEdges } from '../utils/flow-utils'

// UI/processing limits
const HIGHLIGHT_MS = 700
const MIN_GRAPH_NODES = 10
const GRAPH_THROTTLE_MS = 150
const PARTIAL_GRAPH_RATIO = 0.6

type Params = {
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  setShouldFitOnce: React.Dispatch<React.SetStateAction<boolean>>
}

/**
 * Hook that connects DevTools panel UI to extension events.
 *
 * @param setNodes - updates ReactFlow nodes
 * @param setEdges - updates ReactFlow edges
 * @param setShouldFitOnce - triggers initial fitView in PanelView
 */
export function usePanelBridge({ setNodes, setEdges, setShouldFitOnce }: Params) {
  const dispatch = useAppDispatch()

  // Used to detect when the component tree structure changed (navigation/new page)
  const prevStructureSigRef = useRef<string | null>(null)

  // Stores "highlight until" timestamps for node ids
  const highlightUntilRef = useRef<Map<string, number>>(new Map())
  const clearTimerRef = useRef<number | null>(null)

  // Throttle graph rebuilds to avoid heavy layout too often
  const lastGraphProcessRef = useRef<number>(0)

  // Keeps last good layout in case layout fails
  const lastGoodCountRef = useRef<number>(0)
  const lastGoodLayoutRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null)

  // Counts from the latest update (one commit)
  const lastCountsRef = useRef<Record<string, number>>({})

  /**
   * Checks if a node should be highlighted right now.
   */
  const isHighlightActive = useMemo(() => {
    return (id: string) => {
      const until = highlightUntilRef.current.get(id) ?? 0
      return until > Date.now()
    }
  }, [])

  useEffect(() => {
    // Avoid noisy ResizeObserver error inside DevTools iframe
    const onError = (e: ErrorEvent) => {
      const msg = String(e.message || '')
      if (msg.includes('ResizeObserver loop')) e.preventDefault()
    }

    window.addEventListener('error', onError)

    /**
     * Handles full graph updates from page-hook.
     * Rebuilds ReactFlow nodes/edges only when structure changed.
     */
    function handleFiberGraph(payload: GraphPayload) {
      const g = payload?.graph
      if (!g?.nodes || !g?.edges) return

      // Skip tiny graphs (usually means incomplete data)
      if (g.nodes.length < MIN_GRAPH_NODES) return

      // Ignore "partial" graphs compared to the last good one
      const prevGood = lastGoodCountRef.current
      const incoming = g.nodes.length
      if (prevGood > 0 && incoming < prevGood * PARTIAL_GRAPH_RATIO) return

      // Throttle heavy dagre layout
      const now = Date.now()
      if (now - lastGraphProcessRef.current < GRAPH_THROTTLE_MS) return
      lastGraphProcessRef.current = now

      // If structure did not change, don't rebuild layout
      const sig = buildStructureSignature(g)
      const structureChanged = prevStructureSigRef.current !== sig
      if (!structureChanged) return
      prevStructureSigRef.current = sig

      // When tree changes, reset "last update" analytics
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
        lastGoodLayoutRef.current = { nodes: laidOutNodes, edges: rfEdges }
      } catch {
        // Fallback to last successful layout
        const cached = lastGoodLayoutRef.current
        if (cached) {
          setNodes(cached.nodes)
          setEdges(cached.edges)
        }
      }
    }

    /**
     * Handles "which nodes updated" message.
     * Adds highlight and builds counts for the sidebar.
     */
    function applyFiberUpdate(payload: FiberUpdatePayload) {
      const now = Date.now()
      const ids = (payload || []).map((u) => String(u.id))

      // Mark nodes as highlighted for a short time
      ids.forEach((id) => highlightUntilRef.current.set(id, now + HIGHLIGHT_MS))

      // Update styles based on highlight state
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

      // Build "instances updated" counts for the last commit
      const nextCounts: Record<string, number> = {}
      ids.forEach((id) => {
        const key = getSignature(id)
        nextCounts[key] = (nextCounts[key] ?? 0) + 1
      })
      lastCountsRef.current = nextCounts

      // Clear highlight after timeout
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

    /**
     * Handles detailed meta info for the last commit (reasons).
     * Stores counts+reasons in Redux as "last update analytics".
     */
    function applyFiberMeta(payload: FiberMetaPayload) {
      const diffs = payload?.diffs || []
      const nextReasons: Record<string, string> = {}

      diffs.forEach((d) => {
        const key = getSignature(d.id)

        if (d.wasted) {
          nextReasons[key] = 'No props/state change (potential wasted render)'
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

    /**
     * Clears UI + analytics when React is not available on the page.
     */
    function resetUiForNonReact() {
      dispatch(setGraph(null))
      setNodes([])
      setEdges([])
      dispatch(resetAnalytics())

      prevStructureSigRef.current = null
      lastGoodCountRef.current = 0
      lastGoodLayoutRef.current = null
    }

    /**
     * Main message router from background -> panel.
     */
    const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (msg) => {
      const message = msg as PanelMessage

      if (message.type === EVENT_TYPES.STATUS) {
        dispatch(setStatus((message as any).payload))
        if ((message as any).payload !== 'REACT_READY') resetUiForNonReact()
        return false
      }

      if (message.type === EVENT_TYPES.FIBER_GRAPH) {
        const payload = (message as any).payload as GraphPayload
        dispatch(setGraph(payload.graph))
        handleFiberGraph(payload)
        return false
      }

      if (message.type === EVENT_TYPES.FIBER_UPDATE) {
        applyFiberUpdate((message as any).payload as FiberUpdatePayload)
        return false
      }

      if (message.type === EVENT_TYPES.FIBER_META) {
        applyFiberMeta((message as any).payload as FiberMetaPayload)
        return false
      }

      return false
    }

    // Start listening to events
    chrome.runtime.onMessage.addListener(handler)

    // Ask background to inject page-hook into the inspected tab
    chrome.runtime.sendMessage({
      type: EVENT_TYPES.INJECT_HOOK_FROM_PANEL,
      tabId: chrome.devtools.inspectedWindow.tabId
    })

    // Tell background the panel is ready (so it can send cached status/graph)
    chrome.runtime.sendMessage({ type: EVENT_TYPES.PANEL_READY })

    return () => {
      window.removeEventListener('error', onError)
      chrome.runtime.onMessage.removeListener(handler)
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    }
  }, [dispatch, isHighlightActive, setEdges, setNodes, setShouldFitOnce])
}
