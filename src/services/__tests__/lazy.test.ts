import { describe, expect, it, vi } from 'vitest'

const chatServiceMocks = vi.hoisted(() => ({
  regenerateAssistantMessageGeneration: vi.fn(async () => true),
  submitEditedUserMessageGeneration: vi.fn(async () => true),
  synthesizeSpeechAudio: vi.fn(async () => ({
    blob: new Blob(['audio'], { type: 'audio/mpeg' }),
    model: 'speech-model',
  })),
  transcribeAudioFile: vi.fn(async () => ({
    model: 'transcription-model',
    text: 'transcribed text',
  })),
}))

vi.mock('../chat', () => chatServiceMocks)

import {
  loadCachedLazyService,
  regenerateAssistantMessageGeneration,
  submitEditedUserMessageGeneration,
  synthesizeSpeechAudio,
  transcribeAudioFile,
} from '../lazy'

describe('loadCachedLazyService', () => {
  it('reuses pending and resolved lazy service loads', async () => {
    let cached: Promise<{ ok: true }> | null = null
    const service = { ok: true } as const
    const load = vi.fn(async () => service)
    const getCached = () => cached
    const setCached = (promise: Promise<typeof service> | null) => {
      cached = promise
    }

    const first = loadCachedLazyService(getCached, setCached, load)
    const second = loadCachedLazyService(getCached, setCached, load)

    expect(second).toBe(first)
    await expect(first).resolves.toBe(service)
    expect(load).toHaveBeenCalledTimes(1)
    expect(loadCachedLazyService(getCached, setCached, load)).toBe(first)
  })

  it('clears rejected lazy service loads so later actions can retry', async () => {
    let cached: Promise<{ ok: true }> | null = null
    const service = { ok: true } as const
    const failure = new Error('chunk load failed')
    const load = vi
      .fn<() => Promise<typeof service>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(service)
    const getCached = () => cached
    const setCached = (promise: Promise<typeof service> | null) => {
      cached = promise
    }

    await expect(loadCachedLazyService(getCached, setCached, load)).rejects.toBe(
      failure,
    )
    expect(cached).toBeNull()
    await expect(loadCachedLazyService(getCached, setCached, load)).resolves.toBe(
      service,
    )
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('routes speech and transcription through the shared chat lazy runtime', async () => {
    const speechOptions = {} as Parameters<typeof synthesizeSpeechAudio>[0]
    const transcriptionOptions = {} as Parameters<typeof transcribeAudioFile>[0]

    await expect(synthesizeSpeechAudio(speechOptions)).resolves.toMatchObject({
      model: 'speech-model',
    })
    await expect(transcribeAudioFile(transcriptionOptions)).resolves.toEqual({
      model: 'transcription-model',
      text: 'transcribed text',
    })

    expect(chatServiceMocks.synthesizeSpeechAudio).toHaveBeenCalledWith(speechOptions)
    expect(chatServiceMocks.transcribeAudioFile).toHaveBeenCalledWith(
      transcriptionOptions,
    )
  })

  it('routes message reruns through the shared chat lazy runtime', async () => {
    const editedOptions = {} as Parameters<
      typeof submitEditedUserMessageGeneration
    >[0]
    const regenerateOptions = {} as Parameters<
      typeof regenerateAssistantMessageGeneration
    >[0]

    await expect(
      submitEditedUserMessageGeneration(editedOptions),
    ).resolves.toBe(true)
    await expect(
      regenerateAssistantMessageGeneration(regenerateOptions),
    ).resolves.toBe(true)

    expect(
      chatServiceMocks.submitEditedUserMessageGeneration,
    ).toHaveBeenCalledWith(editedOptions)
    expect(
      chatServiceMocks.regenerateAssistantMessageGeneration,
    ).toHaveBeenCalledWith(regenerateOptions)
  })
})
