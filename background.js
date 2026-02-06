/**
 * background.js
 *
 * Chrome extension service worker.
 *
 * Responsibilities:
 * - Receives messages from content scripts and DevTools panel.
 * - Injects the ReactDetective page hook into the inspected tab.
 * - Broadcasts React-related events to all extension listeners.
 * - Stores the latest React status and Fiber graph for late subscribers.
 */

importScripts('shared/event-types.js')

let lastStatus = null
let lastGraph = null

/**
 * Safely broadcasts a message to extension listeners.
 * Prevents runtime errors if no listeners are available.
 *
 * @param {Object} message
 */
function safeBroadcast(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      // Ignore runtime.lastError if no listeners exist
      void chrome.runtime.lastError
    })
  } catch {
    // Extension context may be invalidated
  }
}

/**
 * Message handler map.
 * Each key represents a supported message type.
 */
const handlers = {
  /**
   * Injects the ReactDetective page hook into the inspected tab.
   * Triggered from the DevTools panel.
   */
  [EVENT_TYPES.INJECT_HOOK_FROM_PANEL]: function (message) {
    const { tabId } = message
    if (!tabId) return

    // Reset cached data for a new session
    lastStatus = null
    lastGraph = null

    try {
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['page-hook.js']
      })
    } catch {
      // Script injection may fail if tab is unavailable
    }
  },

  /**
   * React detection status update.
   * Cached and broadcast to listeners.
   */
  [EVENT_TYPES.STATUS]: function (message) {
    lastStatus = message
    safeBroadcast(message)
  },

  /**
   * Full React Fiber graph update.
   * Cached and broadcast to listeners.
   */
  [EVENT_TYPES.FIBER_GRAPH]: function (message) {
    lastGraph = message
    safeBroadcast(message)
  },

  /**
   * React Fiber update event.
   * Forwarded directly to listeners.
   */
  [EVENT_TYPES.FIBER_UPDATE]: function (message) {
    safeBroadcast(message)
  },

  /**
   * Additional React analytics data.
   * Forwarded directly to listeners.
   */
  [EVENT_TYPES.FIBER_META]: function (message) {
    safeBroadcast(message)
  },

  /**
   * Triggered when the DevTools panel becomes ready.
   * Sends the latest cached data to synchronize state.
   */
  [EVENT_TYPES.PANEL_READY]: function () {
    if (lastStatus) safeBroadcast(lastStatus)
    if (lastGraph) safeBroadcast(lastGraph)
  }
}

/**
 * Global message listener.
 * Routes incoming messages to the appropriate handler.
 */
chrome.runtime.onMessage.addListener((message) => {
  const handler = handlers[message?.type]
  if (handler) {
    handler(message)
  }
})
