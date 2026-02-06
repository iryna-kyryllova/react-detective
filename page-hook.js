/**
 * page-hook.js
 *
 * Runs in the page context (MAIN world).
 * Connects to React DevTools global hook and sends events to the extension
 * via window.postMessage.
 *
 * Event format:
 * { source, type, payload }
 */

;(function () {
  const SOURCE = 'react-detective'

  // Event names (kept as strings because this file runs in page context)
  const EVENT_TYPES = {
    STATUS: 'STATUS',
    FIBER_GRAPH: 'FIBER_GRAPH',
    FIBER_UPDATE: 'FIBER_UPDATE',
    FIBER_META: 'FIBER_META'
  }

  const STATUS_VALUES = {
    NO_HOOK: 'NO_HOOK',
    NO_REACT: 'NO_REACT',
    REACT_READY: 'REACT_READY'
  }

  const MAX_NODES = 800
  const TIMEOUT_MS = 3000
  const POLL_MS = 50

  // Assigns stable ids to FiberRoot objects (multiple roots can exist on a page)
  const rootIds = new WeakMap()
  let nextRootId = 1

  /**
   * Returns a stable numeric id for a given FiberRoot.
   */
  function getRootId(root) {
    if (!rootIds.has(root)) rootIds.set(root, nextRootId++)
    return rootIds.get(root)
  }

  /**
   * Sends an event to the extension (content-script listens for it).
   */
  function send(type, payload) {
    window.postMessage({ source: SOURCE, type, payload }, '*')
  }

  /**
   * Prevents installing the hook more than once per page.
   */
  function alreadyInstalled() {
    if (window.__REACT_DETECTIVE_INSTALLED__) return true
    window.__REACT_DETECTIVE_INSTALLED__ = true
    return false
  }

  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__

  if (!hook) {
    send(EVENT_TYPES.STATUS, STATUS_VALUES.NO_HOOK)
    return
  }

  if (alreadyInstalled()) return

  const originalCommit = hook.onCommitFiberRoot
  let lastCommitTs = null

  /**
   * Waits until React renderers are registered in the hook.
   */
  waitForReactRenderers(hook, () => {
    emitAllRoots(hook)
    send(EVENT_TYPES.STATUS, STATUS_VALUES.REACT_READY)
  })

  /**
   * Patch commit handler to track updates in real time.
   */
  hook.onCommitFiberRoot = function (rendererID, root) {
    const now = performance.now()
    const commitIntervalMs = lastCommitTs == null ? 0 : Number((now - lastCommitTs).toFixed(2))

    lastCommitTs = now

    emitFiberGraph(rendererID, root)

    const updates = buildFiberUpdates(root.current, MAX_NODES)
    if (updates.length) {
      send(
        EVENT_TYPES.FIBER_UPDATE,
        updates.map((u) => ({ id: u.id }))
      )
    }

    send(EVENT_TYPES.FIBER_META, {
      commitIntervalMs,
      diffs: updates
    })

    if (originalCommit) {
      return originalCommit.apply(this, arguments)
    }
  }

  /**
   * Polls hook.renderers until React is detected or timeout happens.
   */
  function waitForReactRenderers(hookInstance, onReady) {
    const startedAt = Date.now()

    const intervalId = setInterval(() => {
      const hasRenderers = hookInstance.renderers && hookInstance.renderers.size > 0

      if (hasRenderers) {
        clearInterval(intervalId)
        onReady()
        return
      }

      if (Date.now() - startedAt > TIMEOUT_MS) {
        clearInterval(intervalId)
        send(EVENT_TYPES.STATUS, STATUS_VALUES.NO_REACT)
      }
    }, POLL_MS)
  }

  /**
   * Emits graphs for all currently known React roots.
   */
  function emitAllRoots(hookInstance) {
    hookInstance.renderers.forEach((_, rendererID) => {
      hookInstance.getFiberRoots(rendererID).forEach((root) => {
        emitFiberGraph(rendererID, root)
      })
    })
  }

  /**
   * Emits a full fiber graph for a given renderer/root.
   */
  function emitFiberGraph(rendererID, root) {
    const graph = buildFiberGraph(root.current, MAX_NODES)
    const rootId = getRootId(root)

    send(EVENT_TYPES.FIBER_GRAPH, {
      rendererID,
      rootId,
      graph
    })
  }

  function getDisplayName(fiber) {
    if (fiber?.type?.$$typeof === Symbol.for('react.provider')) {
      return fiber?.type?._context?.displayName || 'Context.Provider'
    }

    if (fiber?.type?.$$typeof === Symbol.for('react.context')) {
      return fiber?.type?._context?.displayName || 'Context.Consumer'
    }

    return (
      fiber?.type?.displayName ||
      fiber?.type?.name ||
      fiber?.elementType?.displayName ||
      fiber?.elementType?.name ||
      'Anonymous'
    )
  }

  function isReactComponent(fiber) {
    return (
      typeof fiber?.type === 'function' || (typeof fiber?.type === 'object' && fiber?.type !== null)
    )
  }

  function shallowDiff(prev, next) {
    if (!prev || !next) return Object.keys(next || {})

    const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
    const changed = []

    keys.forEach((k) => {
      if (prev[k] !== next[k]) changed.push(k)
    })

    return changed
  }

  function buildIdMap(rootFiber, maxNodes) {
    const idByFiber = new Map()
    const visited = new Set()
    const counters = new Map()

    function nextIndex(parentId, name) {
      const key = `${parentId}::${name}`
      const cur = counters.get(key) ?? 0
      counters.set(key, cur + 1)
      return cur
    }

    let count = 0

    function visit(fiber, parentComponentId) {
      if (!fiber || visited.has(fiber) || count >= maxNodes) return
      visited.add(fiber)

      let currentParentForChildren = parentComponentId

      const isComponent = fiber === rootFiber || isReactComponent(fiber)

      if (isComponent) {
        const name = getDisplayName(fiber)
        const idx = parentComponentId ? nextIndex(parentComponentId, name) : 0

        const id = parentComponentId ? `${parentComponentId}/${name}[${idx}]` : `ROOT/${name}[0]`

        idByFiber.set(fiber, {
          id,
          parentId: parentComponentId
        })

        currentParentForChildren = id
        count++
      }

      if (fiber.child) visit(fiber.child, currentParentForChildren)
      if (fiber.sibling) visit(fiber.sibling, parentComponentId)
    }

    visit(rootFiber, null)
    return idByFiber
  }

  function buildFiberGraph(rootFiber, maxNodes) {
    const idByFiber = buildIdMap(rootFiber, maxNodes)
    const nodes = []
    const edges = []

    idByFiber.forEach((data, fiber) => {
      nodes.push({
        id: data.id,
        name: getDisplayName(fiber)
      })
    })

    idByFiber.forEach((data) => {
      if (data.parentId) {
        edges.push({
          from: data.parentId,
          to: data.id
        })
      }
    })

    return { nodes, edges }
  }

  function buildFiberUpdates(rootFiber, maxNodes) {
    const idByFiber = buildIdMap(rootFiber, maxNodes)
    const updates = []

    idByFiber.forEach((data, fiber) => {
      if (fiber.flags && fiber.flags !== 0) {
        const alt = fiber.alternate

        const propsChanged = shallowDiff(alt?.memoizedProps, fiber.memoizedProps)

        const stateChanged = shallowDiff(alt?.memoizedState, fiber.memoizedState)

        updates.push({
          id: data.id,
          propsChanged,
          stateChanged,
          wasted: propsChanged.length === 0 && stateChanged.length === 0
        })
      }
    })

    return updates
  }
})()
