/**
 * devtools.js
 *
 * Registers the ReactDetective panel inside Chrome DevTools.
 * The panel provides a custom UI for visualizing React Fiber data.
 */

chrome.devtools.panels.create(
  'ReactDetective', // Panel title
  'images/icon-16.png', // Panel icon
  'panel-dist/index.html', // Panel HTML entry point
  function () {
    console.log('[ReactDetective] DevTools panel created')
  }
)
