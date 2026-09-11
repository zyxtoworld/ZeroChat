import type { AppData } from '../types'
import {
  assertSafeRemoteBaseUrl,
  normalizeProviderProxyRootUrl,
} from './providerUrlSafety'
import { workerProxyUrlFromSync } from './providerRequestMode'
import { providerTimeoutSignal } from './providerTimeoutSignal'

export { workerProxyUrlFromSync } from './providerRequestMode'

export interface ManagedProxyHostGroup {
  endpoint: string
  token: string
  baseUrls: string[]
}

export class ManagedProxyHostUpdateError extends Error {
  readonly failureCount: number

  constructor(failureCount: number) {
    super(
      `AI proxy host-list update failed for ${failureCount} Worker endpoint${failureCount === 1 ? '' : 's'}.`,
    )
    this.name = 'ManagedProxyHostUpdateError'
    this.failureCount = failureCount
  }
}

const DEFAULT_PROXY_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.deepseek.com',
  'api.x.ai',
  'openrouter.ai',
  'api.mistral.ai',
  'api.groq.com',
  'api.together.xyz',
  'api.fireworks.ai',
  'api.cerebras.ai',
  'integrate.api.nvidia.com',
  'api.deepinfra.com',
  'api.novita.ai',
  'api.siliconflow.cn',
  'api-inference.modelscope.cn',
  'dashscope.aliyuncs.com',
  'api.moonshot.cn',
  'open.bigmodel.cn',
  'qianfan.baidubce.com',
  'api.hunyuan.cloud.tencent.com',
  'api.minimax.io',
  'ark.cn-beijing.volces.com',
  'gateway.ai.cloudflare.com',
])
const MANAGED_PROXY_HOST_NETWORK_RETRY_DELAYS_MS = [400, 900, 1600, 2500] as const
const MANAGED_PROXY_HOST_REQUEST_TIMEOUT_MS = 10_000

function waitForManagedProxyHostRetry(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let listenerInstalled = false
    let settled = false
    let onAbort: () => void = () => undefined

    const cleanup = () => {
      if (listenerInstalled) {
        listenerInstalled = false
        try {
          signal?.removeEventListener('abort', onAbort)
        } catch {
          // Listener cleanup is best-effort; settlement must still complete.
        }
      }
      if (timer !== undefined) {
        const timerToClear = timer
        timer = undefined
        try {
          clearTimeout(timerToClear)
        } catch {
          // Timer cleanup is best-effort; settlement must still complete.
        }
      }
    }

    const settle = (finish: () => void) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      finish()
    }

    onAbort = () =>
      settle(() =>
        reject(new DOMException('Aborted', 'AbortError')),
      )

    const onTimer = () => settle(resolve)

    try {
      if (signal?.aborted) {
        onAbort()
        return
      }

      const scheduledTimer = setTimeout(onTimer, delayMs)
      if (settled) {
        return
      }

      timer = scheduledTimer
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
        listenerInstalled = true
        if (signal.aborted) {
          onAbort()
        }
      }
    } catch (error: unknown) {
      settle(() => reject(error))
    }
  })
}

function cancelManagedProxyHostResponseBody(response: Response): void {
  if (response.bodyUsed || !response.body) {
    return
  }

  try {
    void response.body.cancel().catch(() => undefined)
  } catch {
    // Response cleanup is best-effort and must not replace host-list status handling.
  }
}

async function updateManagedProxyHostGroup(
  endpoint: string,
  token: string,
  baseUrls: string[],
  sourceSignal?: AbortSignal,
): Promise<void> {
  for (
    let attemptIndex = 0;
    attemptIndex <= MANAGED_PROXY_HOST_NETWORK_RETRY_DELAYS_MS.length;
    attemptIndex += 1
  ) {
    let response: Response
    const timeoutSignal = providerTimeoutSignal(
      sourceSignal,
      MANAGED_PROXY_HOST_REQUEST_TIMEOUT_MS,
    )

    try {
      response = await fetch(`${endpoint}/proxy/hosts`, {
        method: 'PUT',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'x-zerochat-access-key': token,
        },
        body: JSON.stringify({ baseUrls }),
        signal: timeoutSignal.signal,
      })
    } catch (error: unknown) {
      const retryDelayMs = MANAGED_PROXY_HOST_NETWORK_RETRY_DELAYS_MS[attemptIndex]
      const retryableFetchFailure =
        error instanceof TypeError &&
        !timeoutSignal.timedOut() &&
        !timeoutSignal.sourceAborted()
      timeoutSignal.dispose()

      if (!retryableFetchFailure || retryDelayMs === undefined) {
        throw error
      }

      await waitForManagedProxyHostRetry(retryDelayMs, sourceSignal)
      continue
    }
    timeoutSignal.dispose()

    try {
      if (!response.ok && response.status !== 403) {
        throw new Error(`HTTP ${response.status}`)
      }
    } finally {
      cancelManagedProxyHostResponseBody(response)
    }

    return
  }
}

export function safeRemoteUrlForProxyHostManagement(value: string): string {
  try {
    return assertSafeRemoteBaseUrl(value, 'Base URL')
  } catch {
    return ''
  }
}

export function safeProxyRootUrlForHostManagement(value: string): string {
  try {
    return normalizeProviderProxyRootUrl(value, 'Proxy URL')
  } catch {
    return ''
  }
}

export function managedProxyHostGroups(
  data: AppData | null,
  accessKey: string,
): ManagedProxyHostGroup[] {
  if (!data) {
    return []
  }

  const syncWorkerEndpoint = workerProxyUrlFromSync(data)
  const groups = new Map<string, { token: string; baseUrls: Set<string> }>()

  for (const provider of data.providers) {
    if (!provider.enabled) {
      continue
    }

    if (provider.clientRequestMode) {
      continue
    }

    const endpoint = safeProxyRootUrlForHostManagement(
      provider.proxyUrl?.trim() || syncWorkerEndpoint,
    )
    const baseUrl = safeRemoteUrlForProxyHostManagement(provider.baseUrl)
    const baseHost = baseUrl ? new URL(baseUrl).host.toLowerCase() : ''
    if (!endpoint || !baseUrl || !accessKey || DEFAULT_PROXY_HOSTS.has(baseHost)) {
      continue
    }

    const group = groups.get(endpoint) ?? {
      token: accessKey,
      baseUrls: new Set<string>(),
    }

    group.baseUrls.add(baseUrl)
    groups.set(endpoint, group)
  }

  return Array.from(groups.entries())
    .map(([endpoint, group]) => ({
      endpoint,
      token: group.token,
      baseUrls: Array.from(group.baseUrls).sort(),
    }))
    .sort((left, right) => left.endpoint.localeCompare(right.endpoint))
}

export function managedProxyHostSignature(
  groups: ManagedProxyHostGroup[],
): string {
  return JSON.stringify(
    groups.map((group) => [
      group.endpoint,
      group.token ? 'token' : '',
      group.baseUrls,
    ]),
  )
}

function managedProxyHostGroupKey(group: ManagedProxyHostGroup): string {
  return JSON.stringify([group.endpoint, group.token])
}

export async function replaceManagedProxyHosts(
  currentGroups: ManagedProxyHostGroup[],
  previousGroups: ManagedProxyHostGroup[],
  { signal }: { signal?: AbortSignal } = {},
): Promise<void> {
  const currentByIdentity = new Map(
    currentGroups.map((group) => [managedProxyHostGroupKey(group), group]),
  )
  const previousByIdentity = new Map(
    previousGroups.map((group) => [managedProxyHostGroupKey(group), group]),
  )
  const groupIdentities = new Set([
    ...currentByIdentity.keys(),
    ...previousByIdentity.keys(),
  ])
  const failures: unknown[] = []

  await Promise.all(
    Array.from(groupIdentities).map(async (groupIdentity) => {
      const current = currentByIdentity.get(groupIdentity)
      const previous = previousByIdentity.get(groupIdentity)
      const group = current ?? previous
      const token = group?.token ?? ''

      if (!group || !token) {
        return
      }

      try {
        await updateManagedProxyHostGroup(
          group.endpoint,
          token,
          current?.baseUrls ?? [],
          signal,
        )
      } catch (error: unknown) {
        failures.push(error)
      }
    }),
  )

  if (failures.length > 0) {
    throw new ManagedProxyHostUpdateError(failures.length)
  }
}
