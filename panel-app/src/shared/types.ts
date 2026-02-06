export const EVENT_TYPES = {
  INJECT_HOOK_FROM_PANEL: 'INJECT_HOOK_FROM_PANEL',
  PANEL_READY: 'PANEL_READY',
  STATUS: 'STATUS',
  FIBER_GRAPH: 'FIBER_GRAPH',
  FIBER_UPDATE: 'FIBER_UPDATE',
  FIBER_META: 'FIBER_META'
} as const

export type StatusPayload = 'NO_HOOK' | 'NO_REACT' | 'REACT_READY'

export type GraphPayload = {
  rendererID: number
  rootId: number
  graph: {
    nodes: Array<{ id: string; name?: string }>
    edges: Array<{ from: string; to: string }>
  }
}

export type FiberUpdatePayload = Array<{ id: string }>

export type FiberMetaPayload = {
  commitIntervalMs: number
  diffs: Array<{
    id: string
    propsChanged: string[]
    stateChanged: string[]
    wasted: boolean
  }>
}

export type StatusMessage = { type: typeof EVENT_TYPES.STATUS; payload: StatusPayload }
export type FiberGraphMessage = { type: typeof EVENT_TYPES.FIBER_GRAPH; payload: GraphPayload }
export type FiberUpdateMessage = {
  type: typeof EVENT_TYPES.FIBER_UPDATE
  payload: FiberUpdatePayload
}
export type FiberMetaMessage = { type: typeof EVENT_TYPES.FIBER_META; payload: FiberMetaPayload }
export type UnknownMessage = { type: string; payload?: unknown }

export type PanelMessage =
  | StatusMessage
  | FiberGraphMessage
  | FiberUpdateMessage
  | FiberMetaMessage
  | UnknownMessage
