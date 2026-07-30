import type { FormEvent } from 'react'

import type { Translator } from '../i18n'
import type { NoticeTarget } from '../components/Notice'
import type {
  AppData,
  ProviderConfig,
} from '../types'
import { accessKeyFromPassword as defaultAccessKeyFromPassword } from './accessKey'
import {
  type GenerationAutoRetryOptions,
  registerGenerationAbortController,
  reportGenerationNotice as reportAudioTranscriptionNotice,
} from './chatGenerationRuntime'
import { browserProviderKey, providerForAiRequest } from './providerConfig'
import { generationRequiresProxyToken } from './generationRequirements'
import { audioSourceFileRejection } from './audioAttachments'
import {
  localFileTooLargeMessage,
  MAX_AUDIO_FILE_BYTES,
} from './localFileLimits'
import type { AudioTranscriptionResult } from './audioTranscription'
import { transcribeAudioFile as defaultTranscribeAudioFile } from './lazy'
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

type RunGenerationWithAutoRetry = <T>(
  operation: () => Promise<T>,
  options: Omit<GenerationAutoRetryOptions, 'setNotice' | 't'>,
) => Promise<T>

interface AudioTranscriptionServices {
  accessKeyFromPassword?: typeof defaultAccessKeyFromPassword
  transcribeAudioFile?: typeof defaultTranscribeAudioFile
}

export interface SendAudioTranscriptionOptions
  extends AudioTranscriptionServices {
  abortRef: MutableRef<AbortController | null>
  activeProvider: ProviderConfig
  audioSourceFile: File | null
  data: AppData
  draft: string
  draftRef: MutableRef<string>
  errorMessage: (error: unknown) => string
  finishSending: () => void
  isOnlineRef: MutableRef<boolean>
  providerKeys: Record<string, string>
  runGenerationWithAutoRetry: RunGenerationWithAutoRetry
  setAudioSource: (file: File | null) => void
  setComposerMode: (mode: 'chat') => void
  setDraft: (value: string) => void
  setNotice: SetNotice
  startSending: () => void
  syncPassphraseRef: MutableRef<string>
  t: Translator
}

function appendTranscriptionDraft(currentDraft: string, text: string): string {
  const trimmedDraft = currentDraft.trim()
  const trimmedText = text.trim()

  return trimmedDraft ? `${trimmedDraft}\n\n${trimmedText}` : trimmedText
}

export { reportAudioTranscriptionNotice }

export async function sendAudioTranscription({
  abortRef,
  accessKeyFromPassword = defaultAccessKeyFromPassword,
  activeProvider,
  audioSourceFile,
  data,
  draft,
  draftRef,
  errorMessage,
  finishSending,
  isOnlineRef,
  providerKeys,
  runGenerationWithAutoRetry,
  setAudioSource,
  setComposerMode,
  setDraft,
  setNotice,
  startSending,
  syncPassphraseRef,
  t,
  transcribeAudioFile = defaultTranscribeAudioFile,
}: SendAudioTranscriptionOptions): Promise<void> {
  if (!audioSourceFile) {
    reportAudioTranscriptionNotice(
      setNotice,
      () => t('notice.audioRequired'),
      'warning',
      'chat',
    )
    return
  }

  const audioSourceRejection = audioSourceFileRejection(audioSourceFile)

  if (audioSourceRejection) {
    reportAudioTranscriptionNotice(
      setNotice,
      () =>
        audioSourceRejection === 'too-large'
          ? localFileTooLargeMessage(t, MAX_AUDIO_FILE_BYTES)
          : t('notice.audioSourceUnsupported'),
      'warning',
      'chat',
    )
    return
  }

  if (!isOnlineRef.current) {
    reportAudioTranscriptionNotice(
      setNotice,
      () => t('notice.offlineAudioUnavailable'),
      'warning',
      'chat',
    )
    return
  }

  if (abortRef.current) {
    return
  }

  const requestProvider = providerForAiRequest(activeProvider, data)
  const apiKey = browserProviderKey(requestProvider, providerKeys)
  const controller = registerGenerationAbortController(abortRef)
  startSending()
  reportAudioTranscriptionNotice(setNotice, () => '')
  let proxyToken = ''

  try {
    if (generationRequiresProxyToken(requestProvider)) {
      proxyToken = await accessKeyFromPassword(syncPassphraseRef.current)
    }

    controller.signal.throwIfAborted()

    const result: AudioTranscriptionResult = await runGenerationWithAutoRetry(
      () =>
        transcribeAudioFile({
          apiKey,
          file: audioSourceFile,
          prompt: draft,
          provider: requestProvider,
          proxyToken,
          signal: controller.signal,
        }),
      {
        signal: controller.signal,
        target: 'chat',
      },
    )

    controller.signal.throwIfAborted()
    setDraft(appendTranscriptionDraft(draftRef.current, result.text))
    setAudioSource(null)
    setComposerMode('chat')
    reportAudioTranscriptionNotice(
      setNotice,
      () => t('notice.audioTranscribed', { model: result.model }),
      'success',
      'chat',
    )
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      reportAudioTranscriptionNotice(
        setNotice,
        () => t('notice.audioTranscriptionStopped'),
        'warning',
        'chat',
      )
      return
    }

    reportAudioTranscriptionNotice(
      setNotice,
      () =>
        t('notice.audioTranscriptionFailed', {
          message: errorMessage(error),
        }),
      'error',
      'chat',
    )
  } finally {
    if (abortRef.current === controller) {
      abortRef.current = null
    }
    finishSending()
  }
}

export function submitAudioTranscription(
  event: FormEvent | undefined,
  run: () => Promise<void>,
): Promise<void> {
  event?.preventDefault()
  return run()
}
