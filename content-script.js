/**
 * content-script.js
 *
 * Acts as a bridge between the page context and the background script.
 * Receives messages using window.postMessage.
 * Forwards validated events to the extension runtime.
 */

;(function () {
  /**
   * Message source identifier.
   * Used to filter ReactDetective events.
   */
  const SOURCE = 'react-detective'

  /**
   * Allowed event types from the page context.
   */
  const EVENT_TYPES = {
    STATUS: 'STATUS',
    FIBER_GRAPH: 'FIBER_GRAPH',
    FIBER_UPDATE: 'FIBER_UPDATE',
    FIBER_META: 'FIBER_META'
  }

  /**
   * Sends a message to the background script.
   *
   * @param {string} type
   * @param {*} payload
   */
  function safeSendMessage(type, payload) {
    try {
      chrome.runtime.sendMessage({ type, payload })
    } catch {
      // Extension context invalidated - safely ignore the error
    }
  }

  /**
   * Handles messages coming from the page context.
   */
  window.addEventListener('message', (event) => {
    // Ignore messages from other sources
    if (event.source !== window) return

    // Ignore messages not related to ReactDetective
    if (!event.data || event.data.source !== SOURCE) return

    const { type, payload } = event.data

    // Ignore unsupported event types
    if (!Object.prototype.hasOwnProperty.call(EVENT_TYPES, type)) return

    safeSendMessage(type, payload)
  })
})()
