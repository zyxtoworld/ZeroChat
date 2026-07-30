import { createServer } from 'node:net'

export const fetchSafeLoopbackHost = '127.0.0.1'
export const maxAutoFetchSafeLoopbackPortAttempts = 16

const fetchBlockedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87,
  95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139,
  143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548,
  554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659,
  4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697,
  10080,
])

export function isFetchSafeLoopbackPort(port) {
  return Number.isSafeInteger(port) && port > 0 && port <= 65535 && !fetchBlockedPorts.has(port)
}

function normalizeLoopbackPort(port, serverLabel) {
  const normalizedPort = Number(port)
  if (!Number.isSafeInteger(normalizedPort) || normalizedPort < 0 || normalizedPort > 65535) {
    throw new Error(`${serverLabel} port must be an integer from 0 to 65535.`)
  }

  return normalizedPort
}

function blockedPortError(serverLabel, port) {
  return new Error(
    `${serverLabel} refuses Fetch-blocked loopback port ${port}. Choose another port.`,
  )
}

async function listenLoopbackServer(server, port) {
  await new Promise((resolveListen, rejectListen) => {
    const rejectOnce = (error) => {
      server.off('listening', resolveOnce)
      rejectListen(error)
    }
    const resolveOnce = () => {
      server.off('error', rejectOnce)
      resolveListen()
    }

    server.once('error', rejectOnce)
    server.once('listening', resolveOnce)
    server.listen(port, fetchSafeLoopbackHost)
  })
}

export async function closeLoopbackServer(server) {
  if (!server.listening) {
    return
  }

  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  })
}

export async function listenOnFetchSafeLoopbackPort(
  server,
  port = 0,
  serverLabel = 'Loopback server',
) {
  const requestedPort = normalizeLoopbackPort(port, serverLabel)
  if (requestedPort !== 0 && !isFetchSafeLoopbackPort(requestedPort)) {
    throw blockedPortError(serverLabel, requestedPort)
  }

  const attempts = requestedPort === 0 ? maxAutoFetchSafeLoopbackPortAttempts : 1
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await listenLoopbackServer(server, requestedPort)
    const address = server.address()
    if (!address || typeof address === 'string') {
      await closeLoopbackServer(server)
      throw new Error(`Unable to resolve the ${serverLabel} address.`)
    }

    if (isFetchSafeLoopbackPort(address.port)) {
      return address
    }

    await closeLoopbackServer(server)
  }

  throw new Error(
    `Unable to obtain a Fetch-safe loopback port for ${serverLabel} after ${maxAutoFetchSafeLoopbackPortAttempts} attempts.`,
  )
}

export async function findFetchSafeLoopbackPort(serverLabel = 'Loopback server') {
  const server = createServer()

  try {
    const address = await listenOnFetchSafeLoopbackPort(server, 0, serverLabel)
    return address.port
  } finally {
    await closeLoopbackServer(server)
  }
}

export async function resolveFetchSafeLoopbackPort(configuredPort, serverLabel = 'Loopback server') {
  if (configuredPort === undefined || configuredPort === null || String(configuredPort).trim() === '') {
    return findFetchSafeLoopbackPort(serverLabel)
  }

  const port = normalizeLoopbackPort(configuredPort, serverLabel)
  if (port === 0) {
    return findFetchSafeLoopbackPort(serverLabel)
  }

  if (!isFetchSafeLoopbackPort(port)) {
    throw blockedPortError(serverLabel, port)
  }

  return port
}
