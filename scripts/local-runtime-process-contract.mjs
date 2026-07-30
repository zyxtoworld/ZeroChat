export const zeroChatQaHarnessScriptMarkers = Object.freeze([
  'scripts/axe-accessibility-check.mjs',
  'scripts/browser-skill-smoke.mjs',
  'scripts/chat-context-window-smoke.mjs',
  'scripts/composer-autosize-smoke.mjs',
  'scripts/lighthouse-check.mjs',
  'scripts/live-provider-smoke-check.mjs',
  'scripts/live-provider-smoke.mjs',
  'scripts/live-provider-ui-proxy-harness.mjs',
  'scripts/live-provider-ui-smoke.mjs',
  'scripts/locale-runtime-smoke.mjs',
  'scripts/message-virtualization-smoke.mjs',
  'scripts/pwa-offline-smoke.mjs',
  'scripts/settings-overlay-preload-smoke.mjs',
  'scripts/visual-audit.mjs',
])

function normalize(value) {
  return String(value ?? '')
    .replaceAll('\\', '/')
    .toLowerCase()
}

export function isZeroChatQaHarnessProcess(entry) {
  const processName = normalize(entry?.processName)
  if (processName !== 'node' && processName !== 'node.exe') {
    return false
  }

  const commandLine = normalize(entry?.commandLine)
  return zeroChatQaHarnessScriptMarkers.some((marker) =>
    commandLine.includes(marker),
  )
}
