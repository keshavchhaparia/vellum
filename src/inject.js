'use strict';

/**
 * Injects the annotation toolbar into an artifact's HTML before </body>.
 * Pure string manipulation — no DOM parsing dependency needed for this.
 */
function injectToolbar(html, { sessionId }) {
  const snippet = `
<script>window.__VELLUM_SESSION_ID__ = ${JSON.stringify(sessionId)};</script>
<script src="/view/${sessionId}/toolbar.js"></script>
`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, snippet + '</body>');
  }
  // No </body>? Just append — still works, just not spec-perfect HTML.
  return html + snippet;
}

module.exports = { injectToolbar };
