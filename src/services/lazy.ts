import type { ChatService } from './chatServiceTypes'

type CryptoService = typeof import('./crypto')
type MarkdownService = typeof import('./markdownWorkerClient')
type SkillService = typeof import('./skills')
type SyncService = typeof import('./sync')

let chatServicePromise: Promise<ChatService> | null = null
let cryptoServicePromise: Promise<CryptoService> | null = null
let markdownServicePromise: Promise<MarkdownService> | null = null
let skillServicePromise: Promise<SkillService> | null = null
let syncServicePromise: Promise<SyncService> | null = null

export function loadCachedLazyService<T>(
  getCached: () => Promise<T> | null,
  setCached: (promise: Promise<T> | null) => void,
  load: () => Promise<T>,
): Promise<T> {
  const cached = getCached()

  if (cached) {
    return cached
  }

  const promise = Promise.resolve()
    .then(load)
    .catch((error: unknown) => {
      if (getCached() === promise) {
        setCached(null)
      }

      throw error
    })
  setCached(promise)
  return promise
}

export function loadChatService(): Promise<ChatService> {
  return loadCachedLazyService(
    () => chatServicePromise,
    (promise) => {
      chatServicePromise = promise
    },
    () => import('./chat'),
  )
}

export function loadCryptoService(): Promise<CryptoService> {
  return loadCachedLazyService(
    () => cryptoServicePromise,
    (promise) => {
      cryptoServicePromise = promise
    },
    () => import('./crypto'),
  )
}

export function loadMarkdownService(): Promise<MarkdownService> {
  return loadCachedLazyService(
    () => markdownServicePromise,
    (promise) => {
      markdownServicePromise = promise
    },
    () => import('./markdownWorkerClient'),
  )
}

export function loadSkillService(): Promise<SkillService> {
  return loadCachedLazyService(
    () => skillServicePromise,
    (promise) => {
      skillServicePromise = promise
    },
    () => import('./skills'),
  )
}

export function loadSyncService(): Promise<SyncService> {
  return loadCachedLazyService(
    () => syncServicePromise,
    (promise) => {
      syncServicePromise = promise
    },
    () => import('./sync'),
  )
}

export async function editImage(
  ...args: Parameters<ChatService['editImage']>
): ReturnType<ChatService['editImage']> {
  const service = await loadChatService()
  return service.editImage(...args)
}

export async function synthesizeSpeechAudio(
  ...args: Parameters<ChatService['synthesizeSpeechAudio']>
): ReturnType<ChatService['synthesizeSpeechAudio']> {
  const service = await loadChatService()
  return service.synthesizeSpeechAudio(...args)
}

export async function transcribeAudioFile(
  ...args: Parameters<ChatService['transcribeAudioFile']>
): ReturnType<ChatService['transcribeAudioFile']> {
  const service = await loadChatService()
  return service.transcribeAudioFile(...args)
}

export async function generateImage(
  ...args: Parameters<ChatService['generateImage']>
): ReturnType<ChatService['generateImage']> {
  const service = await loadChatService()
  return service.generateImage(...args)
}

export async function executeProviderCapabilityRequestPlan(
  ...args: Parameters<ChatService['executeProviderCapabilityRequestPlan']>
): ReturnType<ChatService['executeProviderCapabilityRequestPlan']> {
  const service = await loadChatService()
  return service.executeProviderCapabilityRequestPlan(...args)
}

export async function listProviderModels(
  ...args: Parameters<ChatService['listProviderModels']>
): ReturnType<ChatService['listProviderModels']> {
  const service = await loadChatService()
  return service.listProviderModels(...args)
}

export async function streamChat(
  ...args: Parameters<ChatService['streamChat']>
): ReturnType<ChatService['streamChat']> {
  const service = await loadChatService()
  return service.streamChat(...args)
}
