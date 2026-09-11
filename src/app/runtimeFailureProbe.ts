const loopbackHostnames = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

type ProbeLocation = Pick<Location, 'hostname' | 'protocol' | 'search'>

export function appTestBridgeRequested(location: ProbeLocation): boolean {
  if (!['http:', 'https:'].includes(location.protocol)) return false
  if (!loopbackHostnames.has(location.hostname.toLowerCase())) return false

  return new URLSearchParams(location.search).get('app-test') === '1'
}

export function runtimeFailureProbeRequested(
  name: string,
  location: ProbeLocation,
): boolean {
  if (!appTestBridgeRequested(location)) return false

  return new URLSearchParams(location.search).get(name) === '1'
}
