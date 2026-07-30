import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../types'
import { generatedImageAttachment } from './chatGenerationImageAttachments'
import type { GenerationAutoRetryOptions } from './chatGenerationRuntime'
import {
  messageGenerationFailurePatch,
  registerGenerationAbortController,
  reportGenerationNotice as reportAssistantRunNotice,
} from './chatGenerationRuntime'
import {
  streamAssistantText as defaultStreamAssistantText,
  type StreamAssistantTextOptions,
} from './chatGenerationTextStream'
import {
  editImage as defaultEditImage,
  generateImage as defaultGenerateImage,
} from './lazy'
import {
  captureGenerationIncarnation,
  generationIncarnationExists,
  observeGenerationCommit,
  updateGenerationMessage,
  type GenerationIncarnation,
} from './generationOwnership'
import type { LocalSaveCommitPrecondition } from './localSaveQueueController'
import type { NoticeTone } from './uiRuntime'

type MutableRef<T> = {
  current: T
}

type SetNotice = (
  message: string,
  tone?: NoticeTone,
  target?: NoticeTarget,
  anchorId?: string,
) => void

type UpdateData = (
  updater: (current: AppData) => AppData,
  options?: { autoSync?: boolean },
) => AppData | null

type RunGenerationWithAutoRetry = <T>(
  operation: () => Promise<T>,
  options: Omit<GenerationAutoRetryOptions, 'setNotice' | 't'>,
) => Promise<T>

type StreamAssistantText = (
  options: StreamAssistantTextOptions,
) => Promise<void>

type GenerateImage = typeof defaultGenerateImage
type EditImage = typeof defaultEditImage

export { reportAssistantRunNotice }

interface AssistantRunBaseOptions {
  abortRef: MutableRef<AbortController | null>
  assistantId: string
  commitPublishedLocalSnapshot: (
    snapshot: AppData,
    precondition?: LocalSaveCommitPrecondition,
  ) => Promise<void>
  controller?: AbortController
  conversationId: string
  dataRef: MutableRef<AppData | null>
  errorMessage: (error: unknown) => string
  resetAssistantForRetry: (conversationId: string, messageId: string) => void
  runGenerationWithAutoRetry: RunGenerationWithAutoRetry
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  setNotice: SetNotice
  stoppedContent: string
  t: Translator
  updateData: UpdateData
}

async function commitAssistantTerminalSnapshot({
  assistantId,
  commitPublishedLocalSnapshot,
  incarnation,
  scheduleAutoSync,
  setNotice,
  snapshot,
  t,
}: {
  assistantId: string
  commitPublishedLocalSnapshot: (
    snapshot: AppData,
    precondition?: LocalSaveCommitPrecondition,
  ) => Promise<void>
  incarnation: GenerationIncarnation
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  setNotice: SetNotice
  snapshot: AppData | null
  t: Translator
}): Promise<'committed' | 'failed' | 'stale'> {
  if (!snapshot) {
    reportAssistantRunNotice(
      setNotice,
      () => t('notice.messageSaveUnavailable'),
      'error',
      'message',
      assistantId,
    )
    return 'failed'
  }

  if (!generationIncarnationExists(snapshot, incarnation)) {
    return 'stale'
  }

  const observation = observeGenerationCommit(incarnation)

  try {
    await commitPublishedLocalSnapshot(snapshot, observation.precondition)
  } catch {
    reportAssistantRunNotice(
      setNotice,
      () => t('notice.messageSaveUnavailable'),
      'error',
      'message',
      assistantId,
    )
    return 'failed'
  }

  const committedSnapshot = observation.result()

  if (committedSnapshot === null) {
    return 'stale'
  }

  try {
    scheduleAutoSync(committedSnapshot ?? snapshot, 0)
  } catch {
    // The durable local terminal state is authoritative; the data effect can retry sync.
  }
  return 'committed'
}

export interface RunTextAssistantGenerationOptions
  extends AssistantRunBaseOptions {
  apiKey: string
  baseMessages: StreamAssistantTextOptions['baseMessages']
  contextMessageLimit: number
  flushStreamingAssistantContent: (
    conversationId: string,
    messageId: string,
    content: string,
    incarnation?: GenerationIncarnation,
  ) => void
  latestInput: string
  model: string
  provider: ProviderConfig
  proxyToken: string
  streamAssistantText?: StreamAssistantText
}

export async function runTextAssistantGeneration({
  abortRef,
  apiKey,
  assistantId,
  baseMessages,
  commitPublishedLocalSnapshot,
  contextMessageLimit,
  controller: providedController,
  conversationId,
  dataRef,
  errorMessage,
  flushStreamingAssistantContent,
  latestInput,
  model,
  provider,
  proxyToken,
  resetAssistantForRetry,
  runGenerationWithAutoRetry,
  scheduleAutoSync,
  setNotice,
  stoppedContent,
  streamAssistantText = defaultStreamAssistantText,
  t,
  updateData,
}: RunTextAssistantGenerationOptions): Promise<void> {
  const controller = providedController ?? registerGenerationAbortController(abortRef)
  const incarnation = captureGenerationIncarnation(
    dataRef.current,
    conversationId,
    assistantId,
  )
  let assistantContent = ''

  if (!incarnation) {
    return
  }

  try {
    let terminalSnapshot: AppData | null

    try {
      await runGenerationWithAutoRetry(
        async () => {
          assistantContent = ''
          await streamAssistantText({
            provider,
            apiKey,
            proxyToken,
            model,
            baseMessages,
            contextMessageLimit,
            latestInput,
            snapshot: dataRef.current,
            signal: controller.signal,
            onToken: (token) => {
              assistantContent += token
              flushStreamingAssistantContent(
                conversationId,
                assistantId,
                assistantContent,
                incarnation,
              )
            },
          })
        },
        {
          signal: controller.signal,
          target: 'message',
          anchorId: assistantId,
          onRetry: () => {
            if (generationIncarnationExists(dataRef.current, incarnation)) {
              resetAssistantForRetry(conversationId, assistantId)
            }
          },
        },
      )
      terminalSnapshot = updateData(
        (current) =>
          updateGenerationMessage(current, incarnation, (message) => ({
            ...message,
            content: assistantContent,
            status: 'done',
          })),
        { autoSync: false },
      )
    } catch (error: unknown) {
      terminalSnapshot = patchFailedAssistant({
        assistantContent,
        error,
        errorMessage,
        incarnation,
        stoppedContent,
        updateData,
      })
    }

    const commitResult = await commitAssistantTerminalSnapshot({
      assistantId,
      commitPublishedLocalSnapshot,
      incarnation,
      scheduleAutoSync,
      setNotice,
      snapshot: terminalSnapshot,
      t,
    })

    if (commitResult !== 'committed') {
      return
    }

    reportAssistantRunNotice(setNotice, () => '')
  } finally {
    if (abortRef.current === controller) {
      abortRef.current = null
    }
  }
}

export interface RunImageAssistantGenerationOptions
  extends AssistantRunBaseOptions {
  apiKey: string
  editImage?: EditImage
  generateImage?: GenerateImage
  image?: File
  mask?: File
  model: string
  prompt: string
  provider: ProviderConfig
  proxyToken: string
  responsesModel?: string
}

export async function runImageAssistantGeneration({
  abortRef,
  apiKey,
  assistantId,
  commitPublishedLocalSnapshot,
  controller: providedController,
  conversationId,
  dataRef,
  editImage = defaultEditImage,
  errorMessage,
  generateImage = defaultGenerateImage,
  image,
  mask,
  model,
  prompt,
  provider,
  proxyToken,
  responsesModel,
  resetAssistantForRetry,
  runGenerationWithAutoRetry,
  scheduleAutoSync,
  setNotice,
  stoppedContent,
  t,
  updateData,
}: RunImageAssistantGenerationOptions): Promise<void> {
  const controller = providedController ?? registerGenerationAbortController(abortRef)
  const incarnation = captureGenerationIncarnation(
    dataRef.current,
    conversationId,
    assistantId,
  )

  if (!incarnation) {
    return
  }

  try {
    let terminalSnapshot: AppData | null

    try {
      const generated = await runGenerationWithAutoRetry(
        () =>
          image
            ? editImage({
                provider,
                apiKey,
                proxyToken,
                model,
                prompt,
                responsesModel,
                signal: controller.signal,
                image,
                mask,
              })
            : generateImage({
                provider,
                apiKey,
                proxyToken,
                model,
                prompt,
                responsesModel,
                signal: controller.signal,
              }),
        {
          signal: controller.signal,
          target: 'message',
          anchorId: assistantId,
          onRetry: () => {
            if (generationIncarnationExists(dataRef.current, incarnation)) {
              resetAssistantForRetry(conversationId, assistantId)
            }
          },
        },
      )
      const attachment = generatedImageAttachment({
        image: generated,
        model,
        prompt,
      })

      terminalSnapshot = updateData(
        (current) =>
          updateGenerationMessage(current, incarnation, (message) => ({
            ...message,
            content: '',
            status: 'done',
            attachments: [attachment],
          })),
        { autoSync: false },
      )
    } catch (error: unknown) {
      terminalSnapshot = patchFailedAssistant({
        assistantContent: '',
        error,
        errorMessage,
        incarnation,
        stoppedContent,
        updateData,
      })
    }

    const commitResult = await commitAssistantTerminalSnapshot({
      assistantId,
      commitPublishedLocalSnapshot,
      incarnation,
      scheduleAutoSync,
      setNotice,
      snapshot: terminalSnapshot,
      t,
    })

    if (commitResult !== 'committed') {
      return
    }

    reportAssistantRunNotice(setNotice, () => '')
  } finally {
    if (abortRef.current === controller) {
      abortRef.current = null
    }
  }
}

function patchFailedAssistant({
  assistantContent,
  error,
  errorMessage,
  incarnation,
  stoppedContent,
  updateData,
}: {
  assistantContent: string
  error: unknown
  errorMessage: (error: unknown) => string
  incarnation: GenerationIncarnation
  stoppedContent: string
  updateData: UpdateData
}): AppData | null {
  const failed = updateData(
    (current) =>
      updateGenerationMessage(current, incarnation, (message) =>
        messageGenerationFailurePatch({
          message,
          error,
          assistantContent,
          errorMessage,
          stoppedContent,
        }),
      ),
    { autoSync: false },
  )

  return failed
}
