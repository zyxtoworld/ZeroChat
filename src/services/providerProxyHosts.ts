import type { AppData } from '../types'
import {
  assertSafeRemoteBaseUrl,
  normalizeProviderProxyRootUrl,
} from './providerSafety'

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

export function workerProxyUrlFromSync(data: AppData | null): string {
  const endpoint = data?.sync.workerEndpoint?.trim() ?? ''

  if (data?.sync.mode !== 'cloudflare' || !endpoint.startsWith('https://')) {
    return ''
  }

  return endpoint
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

export async function replaceManagedProxyHosts(
  currentGroups: ManagedProxyHostGroup[],
  previousGroups: ManagedProxyHostGroup[],
): Promise<void> {
  const currentByEndpoint = new Map(
    currentGroups.map((group) => [group.endpoint, group]),
  )
  const previousByEndpoint = new Map(
    previousGroups.map((group) => [group.endpoint, group]),
  )
  const endpoints = new Set([
    ...currentByEndpoint.keys(),
    ...previousByEndpoint.keys(),
  ])
  const failures: unknown[] = []

  await Promise.all(
    Array.from(endpoints).map(async (endpoint) => {
      const current = currentByEndpoint.get(endpoint)
      const previous = previousByEndpoint.get(endpoint)
      const token = current?.token || previous?.token || ''

      if (!token) {
        return
      }

      let response: Response | undefined
      try {
        response = await fetch(`${endpoint}/proxy/hosts`, {
          method: 'PUT',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            'x-zerochat-access-key': token,
          },
          body: JSON.stringify({
            baseUrls: current?.baseUrls ?? [],
          }),
        })
        if (!response.ok && response.status !== 403) {
          throw new Error(`HTTP ${response.status}`)
        }
      } catch (error: unknown) {
        failures.push(error)
      } finally {
        if (response) {
          cancelManagedProxyHostResponseBody(response)
        }
      }
    }),
  )

  if (failures.length > 0) {
    throw new ManagedProxyHostUpdateError(failures.length)
  }
}
