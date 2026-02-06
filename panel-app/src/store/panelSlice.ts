import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type StatusPayload = 'INIT' | 'NO_HOOK' | 'NO_REACT' | 'REACT_READY'

type GraphData = {
  nodes: Array<{ id: string; name?: string }>
  edges: Array<{ from: string; to: string }>
}

export type AnalyticsState = {
  counts: Record<string, number>
  reasons: Record<string, string>
}

type PanelState = {
  status: StatusPayload
  graph: GraphData | null
  analytics: AnalyticsState
}

const initialState: PanelState = {
  status: 'INIT',
  graph: null,
  analytics: {
    counts: {},
    reasons: {}
  }
}

const panelSlice = createSlice({
  name: 'panel',
  initialState,
  reducers: {
    setStatus(state, action: PayloadAction<StatusPayload>) {
      state.status = action.payload
    },
    setGraph(state, action: PayloadAction<GraphData | null>) {
      state.graph = action.payload
    },

    setAnalytics(state, action: PayloadAction<AnalyticsState>) {
      state.analytics = action.payload
    },

    resetAnalytics(state) {
      state.analytics = { counts: {}, reasons: {} }
    },

    resetPanel(state) {
      state.status = 'INIT'
      state.graph = null
      state.analytics = { counts: {}, reasons: {} }
    }
  }
})

export const { setStatus, setGraph, setAnalytics, resetAnalytics, resetPanel } = panelSlice.actions

export default panelSlice.reducer
