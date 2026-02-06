/**
 * page-hook.js
 *
 * Runs in the page context (MAIN world).
 * Connects to React DevTools global hook.
 * Forwards React Fiber data to the extension with window.postMessage.
 *
 * Event format:
 * { source, type, payload }
 */

;(function () {
  /**
   * A constant identifier to filter our own window messages.
   * The content script only forwards messages with this source.
   */
  const SOURCE = 'react-detective'

  /**
   * Event types used for messaging between page -> extension.
   * Kept as strings because this file runs in the page context.
   */
  const EVENT_TYPES = {
    STATUS: 'STATUS',
    FIBER_GRAPH: 'FIBER_GRAPH',
    FIBER_UPDATE: 'FIBER_UPDATE',
    FIBER_META: 'FIBER_META'
  }

  /**
   * Possible status values describing React availability on the page.
   */
  const STATUS_VALUES = {
    NO_HOOK: 'NO_HOOK', // React DevTools hook is not present
    NO_REACT: 'NO_REACT', // hook exists, but no React renderers detected
    REACT_READY: 'REACT_READY' // React is detected and can be tracked
  }

  /**
   * Limits / timing settings.
   * MAX_NODES prevents the graph from becoming too big and slow.
   */
  const MAX_NODES = 800
  const TIMEOUT_MS = 3000
  const POLL_MS = 50

  /**
   * Assign stable numeric ids to FiberRoot objects.
   * A page can have multiple React roots.
   *
   * WeakMap is used so roots can still be garbage-collected.
   */
  const rootIds = new WeakMap()
  let nextRootId = 1

  /**
   * Returns a stable numeric id for a given FiberRoot.
   *
   * @param {object} root - React FiberRoot object
   * @returns {number} stable root id
   */
  function getRootId(root) {
    if (!rootIds.has(root)) rootIds.set(root, nextRootId++)
    return rootIds.get(root)
  }

  /**
   * Sends an event to the extension.
   * The content script listens for these messages and forwards them to background/panel.
   *
   * @param {string} type - EVENT_TYPES.*
   * @param {any} payload - any serializable data
   */
  function send(type, payload) {
    window.postMessage({ source: SOURCE, type, payload }, '*')
  }

  /**
   * Prevents installing the hook more than once on the same page.
   * DevTools panel can be opened/closed multiple times, so we protect from double patching.
   *
   * @returns {boolean} true if already installed
   */
  function alreadyInstalled() {
    if (window.__REACT_DETECTIVE_INSTALLED__) return true
    window.__REACT_DETECTIVE_INSTALLED__ = true
    return false
  }

  /**
   * React DevTools global hook.
   * This is the official integration point that React DevTools uses.
   */
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__

  // If the hook doesn't exist, we can't track React at all.
  if (!hook) {
    send(EVENT_TYPES.STATUS, STATUS_VALUES.NO_HOOK)
    return
  }

  // Avoid patching multiple times.
  if (alreadyInstalled()) return

  /**
   * We will patch onCommitFiberRoot to get updates in real time.
   * Keep original function so we can call it afterwards (not to break DevTools).
   */
  const originalCommit = hook.onCommitFiberRoot
  let lastCommitTs = null

  /**
   * Wait until React renderers are registered inside the hook.
   * On some pages the hook exists before React is fully initialized.
   */
  waitForReactRenderers(hook, () => {
    // When ready, send a full graph for all roots we can currently see
    emitAllRoots(hook)
    send(EVENT_TYPES.STATUS, STATUS_VALUES.REACT_READY)
  })

  /**
   * Patch commit handler to track updates in real time.
   *
   * React calls onCommitFiberRoot after finishing a render commit.
   * We use it to:
   * - rebuild and send the full graph for the root
   * - detect which components updated (diffs)
   * - send analytics (props/state changed)
   */
  hook.onCommitFiberRoot = function (rendererID, root) {
    // commitIntervalMs = time between commits
    const now = performance.now()
    const commitIntervalMs = lastCommitTs == null ? 0 : Number((now - lastCommitTs).toFixed(2))
    lastCommitTs = now

    // Send full graph for this root (so UI stays in sync)
    emitFiberGraph(rendererID, root)

    // Find which components updated in this commit
    const updates = buildFiberUpdates(root.current, MAX_NODES)

    // For highlighting nodes in the panel we only need ids
    if (updates.length) {
      send(
        EVENT_TYPES.FIBER_UPDATE,
        updates.map((u) => ({ id: u.id }))
      )
    }

    // Send detailed info used in the sidebar (reasons)
    send(EVENT_TYPES.FIBER_META, {
      commitIntervalMs,
      diffs: updates
    })

    // Call original hook handler to avoid breaking React DevTools behavior
    if (originalCommit) {
      return originalCommit.apply(this, arguments)
    }
  }

  /**
   * Polls hook.renderers until React is detected or timeout happens.
   *
   * @param {any} hookInstance - __REACT_DEVTOOLS_GLOBAL_HOOK__
   * @param {Function} onReady - callback when renderers are present
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
   * Emits graphs for all currently known React roots across all renderers.
   *
   * @param {any} hookInstance
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
   *
   * @param {number} rendererID
   * @param {object} root - FiberRoot
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

  /**
   * Returns a readable name for a Fiber node.
   * Works for normal components and also for Context Provider/Consumer.
   *
   * @param {any} fiber
   * @returns {string}
   */
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

  /**
   * Simple check: is this Fiber a React component (function/class or special objects).
   *
   * @param {any} fiber
   * @returns {boolean}
   */
  function isReactComponent(fiber) {
    return (
      typeof fiber?.type === 'function' || (typeof fiber?.type === 'object' && fiber?.type !== null)
    )
  }

  /**
   * Compares two shallow objects and returns keys that changed.
   * We intentionally don't do deep comparison to keep it fast.
   *
   * @param {object|null|undefined} prev
   * @param {object|null|undefined} next
   * @returns {string[]} changed keys
   */
  function shallowDiff(prev, next) {
    // If there is no "prev" snapshot, treat all keys as changed
    if (!prev || !next) return Object.keys(next || {})

    const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
    const changed = []

    keys.forEach((k) => {
      if (prev[k] !== next[k]) changed.push(k)
    })

    return changed
  }

  /**
   * Builds a mapping Fiber -> { id, parentId } only for component-like nodes.
   * This keeps the graph stable and readable.
   *
   * Id format:
   * - ROOT/App[0]/Navbar[0]/NavLink[2]
   *
   * @param {any} rootFiber - root.current (Fiber node)
   * @param {number} maxNodes - safety limit
   * @returns {Map<any, {id: string, parentId: string|null}>}
   */
  function buildIdMap(rootFiber, maxNodes) {
    const idByFiber = new Map()
    const visited = new Set()
    const counters = new Map()

    /**
     * Makes instance indexes stable between siblings with the same name.
     *
     * @param {string|null} parentId
     * @param {string} name
     * @returns {number} next index for that name under the same parent
     */
    function nextIndex(parentId, name) {
      const key = `${parentId}::${name}`
      const cur = counters.get(key) ?? 0
      counters.set(key, cur + 1)
      return cur
    }

    let count = 0

    /**
     * DFS traversal through the Fiber tree.
     *
     * @param {any} fiber
     * @param {string|null} parentComponentId - id of the nearest component parent
     */
    function visit(fiber, parentComponentId) {
      if (!fiber || visited.has(fiber) || count >= maxNodes) return
      visited.add(fiber)

      // By default, children inherit the same parent component id
      let currentParentForChildren = parentComponentId

      // We only add nodes for React components (and the root fiber itself)
      const isComponent = fiber === rootFiber || isReactComponent(fiber)

      if (isComponent) {
        const name = getDisplayName(fiber)
        const idx = parentComponentId ? nextIndex(parentComponentId, name) : 0

        // Build a readable hierarchical id string
        const id = parentComponentId ? `${parentComponentId}/${name}[${idx}]` : `ROOT/${name}[0]`

        idByFiber.set(fiber, {
          id,
          parentId: parentComponentId
        })

        // Now this component becomes the parent for its children
        currentParentForChildren = id
        count++
      }

      // Continue DFS
      if (fiber.child) visit(fiber.child, currentParentForChildren)
      if (fiber.sibling) visit(fiber.sibling, parentComponentId)
    }

    visit(rootFiber, null)
    return idByFiber
  }

  /**
   * Builds a simplified graph:
   * - nodes: [{id, name}]
   * - edges: [{from, to}]
   *
   * @param {any} rootFiber
   * @param {number} maxNodes
   * @returns {{nodes: Array<{id: string, name: string}>, edges: Array<{from: string, to: string}>}}
   */
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

    // Parent-child edges between component nodes
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

  /**
   * Builds a list of updates for the current commit.
   * We use fiber.flags to detect "this fiber updated".
   *
   * For each updated component we also compute:
   * - propsChanged keys
   * - stateChanged keys
   * - wasted: true if neither props nor state changed (likely parent/context update)
   *
   * @param {any} rootFiber
   * @param {number} maxNodes
   * @returns {Array<{id: string, propsChanged: string[], stateChanged: string[], wasted: boolean}>}
   */
  function buildFiberUpdates(rootFiber, maxNodes) {
    const idByFiber = buildIdMap(rootFiber, maxNodes)
    const updates = []

    idByFiber.forEach((data, fiber) => {
      // fiber.flags !== 0 => React marked this Fiber as having work in this commit
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
