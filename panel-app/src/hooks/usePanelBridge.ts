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

const HIGHLIGHT_MS = 700
const MIN_GRAPH_NODES = 10
const GRAPH_THROTTLE_MS = 150
const PARTIAL_GRAPH_RATIO = 0.6

type Params = {
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  setShouldFitOnce: React.Dispatch<React.SetStateAction<boolean>>
}

export function usePanelBridge({ setNodes, setEdges, setShouldFitOnce }: Params) {
  const dispatch = useAppDispatch()

  const prevStructureSigRef = useRef<string | null>(null)
  const highlightUntilRef = useRef<Map<string, number>>(new Map())
  const clearTimerRef = useRef<number | null>(null)

  const lastGraphProcessRef = useRef<number>(0)
  const lastGoodCountRef = useRef<number>(0)
  const lastGoodLayoutRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null)
  const lastCountsRef = useRef<Record<string, number>>({})

  const isHighlightActive = useMemo(() => {
    return (id: string) => {
      const until = highlightUntilRef.current.get(id) ?? 0
      return until > Date.now()
    }
  }, [])

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const msg = String(e.message || '')
      if (msg.includes('ResizeObserver loop')) e.preventDefault()
    }

    window.addEventListener('error', onError)

    function handleFiberGraph(payload: GraphPayload) {
      const g = payload?.graph
      if (!g?.nodes || !g?.edges) return

      if (g.nodes.length < MIN_GRAPH_NODES) return

      const prevGood = lastGoodCountRef.current
      const incoming = g.nodes.length

      if (prevGood > 0 && incoming < prevGood * PARTIAL_GRAPH_RATIO) return

      const now = Date.now()
      if (now - lastGraphProcessRef.current < GRAPH_THROTTLE_MS) return
      lastGraphProcessRef.current = now

      const sig = buildStructureSignature(g)
      const structureChanged = prevStructureSigRef.current !== sig
      if (!structureChanged) return
      prevStructureSigRef.current = sig

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

    function resetUiForNonReact() {
      dispatch(setGraph(null))
      setNodes([])
      setEdges([])
      dispatch(resetAnalytics())

      prevStructureSigRef.current = null
      lastGoodCountRef.current = 0
      lastGoodLayoutRef.current = null
    }

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

    chrome.runtime.onMessage.addListener(handler)

    chrome.runtime.sendMessage({
      type: EVENT_TYPES.INJECT_HOOK_FROM_PANEL,
      tabId: chrome.devtools.inspectedWindow.tabId
    })

    chrome.runtime.sendMessage({ type: EVENT_TYPES.PANEL_READY })

    return () => {
      window.removeEventListener('error', onError)
      chrome.runtime.onMessage.removeListener(handler)
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    }
  }, [dispatch, isHighlightActive, setEdges, setNodes, setShouldFitOnce])
}
