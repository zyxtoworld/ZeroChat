import { describe, expect, it, vi } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../../types'
import { defaultSkillSettings } from '../appData'
import {
  reportAudioTranscriptionNotice,
  sendAudioTranscription,
} from '../chatGenerationAudioTranscription'

const t: Translator = (key, values) =>
  values && typeof values === 'object'
    ? `${key}:${JSON.stringify(values)}`
    : key

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    ...providerFromPreset(providerPresets[0]),
    id: 'provider-1',
    name: 'Provider One',
    model: 'chat-model',
    imageModel: 'image-model',
    models: ['chat-model', 'gpt-4o-transcribe'],
    ...patch,
  }
}

function appData(providers: ProviderConfig[] = [provider()]): AppData {
  return {
    version: 1,
    providers,
    conversations: [],
    skills: [],
    skillSettings: defaultSkillSettings(),
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'system',
      compactMode: false,
    },
    updatedAt: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

function baseOptions() {
  const activeProvider = provider()

  return {
    abortRef: { current: null as AbortController | null },
    accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
    activeProvider,
    audioSourceFile: new File(['audio'], 'clip.webm', { type: 'audio/webm' }),
    data: appData([activeProvider]),
    draft: 'Speaker names',
    draftRef: { current: 'Speaker names' },
    errorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    finishSending: vi.fn(),
    isOnlineRef: { current: true },
    providerKeys: { [activeProvider.id]: 'provider-key' },
    runGenerationWithAutoRetry: vi.fn((operation) => operation()),
    setAudioSource: vi.fn(),
    setComposerMode: vi.fn(),
    setDraft: vi.fn(),
    setNotice: vi.fn(),
    startSending: vi.fn(),
    syncPassphraseRef: { current: 'passphrase' },
    t,
    transcribeAudioFile: vi.fn(async () => ({
      model: 'gpt-4o-transcribe',
      text: 'Transcript text',
    })),
  }
}

describe('chat generation audio transcription submit runtime', () => {
  it('contains audio transcription notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportAudioTranscriptionNotice(setNotice, () => {
        throw new Error('locale unavailable')
      }, 'error', 'chat'),
    ).not.toThrow()
    expect(setNotice).not.toHaveBeenCalled()

    expect(() =>
      reportAudioTranscriptionNotice(
        setNotice,
        () => 'notice.audioRequired',
        'warning',
        'chat',
      ),
    ).not.toThrow()
    expect(setNotice).toHaveBeenCalledWith(
      'notice.audioRequired',
      'warning',
      'chat',
    )
  })

  it('requires an audio source before starting generation', async () => {
    const options = {
      ...baseOptions(),
      audioSourceFile: null,
    }

    await sendAudioTranscription(options)

    expect(options.setNotice).toHaveBeenCalledWith(
      'notice.audioRequired',
      'warning',
      'chat',
    )
    expect(options.startSending).not.toHaveBeenCalled()
    expect(options.transcribeAudioFile).not.toHaveBeenCalled()
  })

  it('rejects unsupported and oversized audio before starting generation', async () => {
    const unsupported = {
      ...baseOptions(),
      audioSourceFile: new File(['midi'], 'song.mid', { type: 'audio/midi' }),
    }

    await sendAudioTranscription(unsupported)

    expect(unsupported.setNotice).toHaveBeenCalledWith(
      'notice.audioSourceUnsupported',
      'warning',
      'chat',
    )
    expect(unsupported.startSending).not.toHaveBeenCalled()
    expect(unsupported.transcribeAudioFile).not.toHaveBeenCalled()

    const oversized = {
      ...baseOptions(),
      audioSourceFile: {
        name: 'meeting.webm',
        size: 25_000_001,
        type: 'audio/webm',
      } as File,
    }

    await sendAudioTranscription(oversized)

    expect(oversized.setNotice).toHaveBeenCalledWith(
      'message.fileTooLarge:{"maxMb":25}',
      'warning',
      'chat',
    )
    expect(oversized.startSending).not.toHaveBeenCalled()
    expect(oversized.transcribeAudioFile).not.toHaveBeenCalled()
  })

  it('contains missing audio notice reporter failures without leaking the promise', async () => {
    const options = {
      ...baseOptions(),
      audioSourceFile: null,
      setNotice: vi.fn(() => {
        throw new Error('notice channel unavailable')
      }),
    }

    await expect(sendAudioTranscription(options)).resolves.toBeUndefined()

    expect(options.startSending).not.toHaveBeenCalled()
    expect(options.transcribeAudioFile).not.toHaveBeenCalled()
  })

  it('blocks audio transcription while offline', async () => {
    const options = {
      ...baseOptions(),
      isOnlineRef: { current: false },
    }

    await sendAudioTranscription(options)

    expect(options.setNotice).toHaveBeenCalledWith(
      'notice.offlineAudioUnavailable',
      'warning',
      'chat',
    )
    expect(options.startSending).not.toHaveBeenCalled()
    expect(options.transcribeAudioFile).not.toHaveBeenCalled()
  })

  it('contains offline audio notice reporter failures without leaking the promise', async () => {
    const options = {
      ...baseOptions(),
      isOnlineRef: { current: false },
      setNotice: vi.fn(() => {
        throw new Error('notice channel unavailable')
      }),
    }

    await expect(sendAudioTranscription(options)).resolves.toBeUndefined()

    expect(options.startSending).not.toHaveBeenCalled()
    expect(options.transcribeAudioFile).not.toHaveBeenCalled()
  })

  it('surfaces access-key derivation failures before starting transcription', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const options = {
      ...baseOptions(),
      activeProvider,
      data: appData([activeProvider]),
      providerKeys: {},
      accessKeyFromPassword: vi.fn(async () => {
        throw new Error('crypto unavailable')
      }),
    }

    await sendAudioTranscription(options)

    expect(options.setNotice).toHaveBeenCalledWith(
      'notice.audioTranscriptionFailed:{"message":"crypto unavailable"}',
      'error',
      'chat',
    )
    expect(options.startSending).toHaveBeenCalledTimes(1)
    expect(options.runGenerationWithAutoRetry).not.toHaveBeenCalled()
    expect(options.transcribeAudioFile).not.toHaveBeenCalled()
    expect(options.finishSending).toHaveBeenCalledTimes(1)
    expect(options.abortRef.current).toBeNull()
  })

  it('contains access-key failure notice reporter failures without starting transcription', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const options = {
      ...baseOptions(),
      activeProvider,
      data: appData([activeProvider]),
      providerKeys: {},
      accessKeyFromPassword: vi.fn(async () => {
        throw new Error('crypto unavailable')
      }),
      setNotice: vi.fn(() => {
        throw new Error('notice channel unavailable')
      }),
    }

    await expect(sendAudioTranscription(options)).resolves.toBeUndefined()

    expect(options.startSending).toHaveBeenCalledTimes(1)
    expect(options.runGenerationWithAutoRetry).not.toHaveBeenCalled()
    expect(options.transcribeAudioFile).not.toHaveBeenCalled()
    expect(options.finishSending).toHaveBeenCalledTimes(1)
    expect(options.abortRef.current).toBeNull()
  })

  it('claims proxied transcription before access-key derivation can overlap', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const options = {
      ...baseOptions(),
      activeProvider,
      data: appData([activeProvider]),
      providerKeys: {},
    }
    let releaseAccessKey: (value: string) => void = () => undefined
    options.accessKeyFromPassword = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseAccessKey = resolve
        }),
    )

    const first = sendAudioTranscription(options)
    const second = sendAudioTranscription(options)

    await expect(second).resolves.toBeUndefined()
    expect(options.startSending).toHaveBeenCalledTimes(1)
    expect(options.abortRef.current).not.toBeNull()
    releaseAccessKey('proxy-token')
    await first

    expect(options.accessKeyFromPassword).toHaveBeenCalledTimes(1)
    expect(options.transcribeAudioFile).toHaveBeenCalledTimes(1)
    expect(options.finishSending).toHaveBeenCalledTimes(1)
    expect(options.abortRef.current).toBeNull()
  })

  it('stops proxied transcription while access-key derivation is pending', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const options = {
      ...baseOptions(),
      activeProvider,
      data: appData([activeProvider]),
      providerKeys: {},
    }
    let releaseAccessKey: (value: string) => void = () => undefined
    options.accessKeyFromPassword = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseAccessKey = resolve
        }),
    )

    const pending = sendAudioTranscription(options)
    options.abortRef.current?.abort()
    releaseAccessKey('proxy-token')
    await pending

    expect(options.transcribeAudioFile).not.toHaveBeenCalled()
    expect(options.setNotice).toHaveBeenCalledWith(
      'notice.audioTranscriptionStopped',
      'warning',
      'chat',
    )
    expect(options.finishSending).toHaveBeenCalledTimes(1)
    expect(options.abortRef.current).toBeNull()
  })

  it('transcribes direct browser audio without deriving a proxy access key', async () => {
    const options = baseOptions()
    options.accessKeyFromPassword = vi.fn(async () => {
      throw new Error('proxy token should not be requested')
    })

    await sendAudioTranscription(options)

    expect(options.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(options.startSending).toHaveBeenCalledTimes(1)
    expect(options.runGenerationWithAutoRetry).toHaveBeenCalledTimes(1)
    expect(options.transcribeAudioFile).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'provider-key',
        file: options.audioSourceFile,
        prompt: 'Speaker names',
        proxyToken: '',
      }),
    )
    expect(options.setDraft).toHaveBeenCalledWith(
      'Speaker names\n\nTranscript text',
    )
    expect(options.setAudioSource).toHaveBeenCalledWith(null)
    expect(options.setComposerMode).toHaveBeenCalledWith('chat')
    expect(options.setNotice).toHaveBeenLastCalledWith(
      'notice.audioTranscribed:{"model":"gpt-4o-transcribe"}',
      'success',
      'chat',
    )
    expect(options.abortRef.current).toBeNull()
    expect(options.finishSending).toHaveBeenCalledTimes(1)
  })

  it('appends a transcript to the latest draft typed while transcription runs', async () => {
    const transcription = deferred<{
      model: string
      text: string
    }>()
    const options = baseOptions()
    const draftState = { current: options.draft }
    options.setDraft = vi.fn((value: string) => {
      draftState.current = value
    })
    options.transcribeAudioFile = vi.fn(() => transcription.promise)

    const pending = sendAudioTranscription(options)

    await vi.waitFor(() => {
      expect(options.transcribeAudioFile).toHaveBeenCalledTimes(1)
    })
    draftState.current = 'Follow-up note'
    options.draftRef.current = draftState.current
    transcription.resolve({
      model: 'gpt-4o-transcribe',
      text: 'Transcript text',
    })
    await pending

    expect(draftState.current).toBe('Follow-up note\n\nTranscript text')
  })

  it('contains audio transcription clear-notice reporter failures while dispatching transcription', async () => {
    const options = {
      ...baseOptions(),
      setNotice: vi.fn((message: string) => {
        if (message === '') {
          throw new Error('notice channel unavailable')
        }
      }),
    }

    await expect(sendAudioTranscription(options)).resolves.toBeUndefined()

    expect(options.startSending).toHaveBeenCalledTimes(1)
    expect(options.transcribeAudioFile).toHaveBeenCalledTimes(1)
    expect(options.setDraft).toHaveBeenCalledWith(
      'Speaker names\n\nTranscript text',
    )
    expect(options.setAudioSource).toHaveBeenCalledWith(null)
    expect(options.setComposerMode).toHaveBeenCalledWith('chat')
    expect(options.finishSending).toHaveBeenCalledTimes(1)
    expect(options.abortRef.current).toBeNull()
  })

  it('contains audio transcription success notice reporter failures after applying the transcript', async () => {
    const errorMessage = vi.fn((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    )
    const options = {
      ...baseOptions(),
      errorMessage,
      setNotice: vi.fn((message: string) => {
        if (message.startsWith('notice.audioTranscribed')) {
          throw new Error('notice channel unavailable')
        }
      }),
    }

    await expect(sendAudioTranscription(options)).resolves.toBeUndefined()

    expect(options.setDraft).toHaveBeenCalledWith(
      'Speaker names\n\nTranscript text',
    )
    expect(options.setAudioSource).toHaveBeenCalledWith(null)
    expect(options.setComposerMode).toHaveBeenCalledWith('chat')
    expect(errorMessage).not.toHaveBeenCalled()
    expect(options.setNotice).not.toHaveBeenCalledWith(
      expect.stringContaining('notice.audioTranscriptionFailed'),
      'error',
      'chat',
    )
    expect(options.abortRef.current).toBeNull()
    expect(options.finishSending).toHaveBeenCalledTimes(1)
  })

  it('derives a proxy access key only for proxied audio transcription', async () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const options = {
      ...baseOptions(),
      activeProvider,
      data: appData([activeProvider]),
      providerKeys: {},
    }

    await sendAudioTranscription(options)

    expect(options.accessKeyFromPassword).toHaveBeenCalledWith('passphrase')
    expect(options.transcribeAudioFile).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: '',
        proxyToken: 'proxy-token',
      }),
    )
    expect(options.setDraft).toHaveBeenCalledWith(
      'Speaker names\n\nTranscript text',
    )
  })

  it('shows a stopped notice for aborted audio transcriptions', async () => {
    const options = {
      ...baseOptions(),
      transcribeAudioFile: vi.fn(async () => {
        throw new DOMException('Aborted', 'AbortError')
      }),
    }

    await sendAudioTranscription(options)

    expect(options.setDraft).not.toHaveBeenCalled()
    expect(options.setNotice).toHaveBeenLastCalledWith(
      'notice.audioTranscriptionStopped',
      'warning',
      'chat',
    )
    expect(options.abortRef.current).toBeNull()
    expect(options.finishSending).toHaveBeenCalledTimes(1)
  })

  it('does not apply a late transcript when the provider ignores cancellation', async () => {
    const options = baseOptions()
    options.transcribeAudioFile = vi.fn(async () => {
      options.abortRef.current?.abort()
      return {
        model: 'gpt-4o-transcribe',
        text: 'Late transcript',
      }
    })

    await sendAudioTranscription(options)

    expect(options.setDraft).not.toHaveBeenCalled()
    expect(options.setAudioSource).not.toHaveBeenCalled()
    expect(options.setComposerMode).not.toHaveBeenCalled()
    expect(options.setNotice).toHaveBeenLastCalledWith(
      'notice.audioTranscriptionStopped',
      'warning',
      'chat',
    )
    expect(options.abortRef.current).toBeNull()
    expect(options.finishSending).toHaveBeenCalledTimes(1)
  })

  it('contains audio transcription failure notice reporter failures without leaking the promise', async () => {
    const options = {
      ...baseOptions(),
      setNotice: vi.fn(() => {
        throw new Error('notice channel unavailable')
      }),
      transcribeAudioFile: vi.fn(async () => {
        throw new Error('provider unavailable')
      }),
    }

    await expect(sendAudioTranscription(options)).resolves.toBeUndefined()

    expect(options.setDraft).not.toHaveBeenCalled()
    expect(options.abortRef.current).toBeNull()
    expect(options.finishSending).toHaveBeenCalledTimes(1)
  })
})
