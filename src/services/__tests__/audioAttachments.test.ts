import { describe, expect, it } from 'vitest'

import {
  AUDIO_SOURCE_ACCEPT,
  acceptedAudioSourceFromDrop,
  audioSourceFileRejection,
  dragHasAcceptedAudioSource,
  isAcceptedAudioSourceFile,
} from '../audioAttachments'

function audioFile(name: string, type = 'audio/webm'): File {
  return new File(['audio-bytes'], name, { type, lastModified: 123 })
}

function textFile(name = 'note.txt'): File {
  return new File(['hello'], name, { type: 'text/plain' })
}

function dataTransfer({
  files = [],
  items = [],
}: {
  files?: File[]
  items?: Array<Partial<DataTransferItem>>
}): DataTransfer {
  return {
    files,
    items,
  } as unknown as DataTransfer
}

function item(file: File | null, type = file?.type ?? ''): Partial<DataTransferItem> {
  return {
    kind: 'file',
    type,
    getAsFile: () => file,
  }
}

function textItem(): Partial<DataTransferItem> {
  return {
    kind: 'string',
    type: 'text/plain',
    getAsFile: () => null,
  }
}

describe('audio attachment helpers', () => {
  it('accepts common audio files by MIME type or filename', () => {
    expect(isAcceptedAudioSourceFile(audioFile('clip.webm'))).toBe(true)
    expect(isAcceptedAudioSourceFile(audioFile('voice.mp3', 'audio/mpeg'))).toBe(true)
    expect(isAcceptedAudioSourceFile(audioFile('browser-voice', 'audio/x-wav'))).toBe(true)
    expect(isAcceptedAudioSourceFile(audioFile('meeting.m4a', ''))).toBe(true)
    expect(isAcceptedAudioSourceFile(audioFile('screen.mp4', 'video/mp4'))).toBe(true)
    expect(isAcceptedAudioSourceFile(textFile())).toBe(false)
  })

  it('keeps the browser picker contract aligned with supported transcription formats', () => {
    expect(AUDIO_SOURCE_ACCEPT.split(',')).toEqual(
      expect.arrayContaining([
        'audio/mpeg',
        'audio/mp4',
        'audio/wav',
        'audio/webm',
        'video/mp4',
        'video/webm',
        '.mp3',
        '.mp4',
        '.mpeg',
        '.mpga',
        '.m4a',
        '.wav',
        '.webm',
      ]),
    )
    expect(AUDIO_SOURCE_ACCEPT).not.toContain('audio/aac')
    expect(AUDIO_SOURCE_ACCEPT).not.toContain('.ogg')
  })

  it('reads accepted audio sources from drag and drop payloads', () => {
    const source = audioFile('voice.wav', 'audio/wav')
    const unsupported = textFile()

    expect(
      dragHasAcceptedAudioSource(
        dataTransfer({ items: [item(source), textItem()] }),
      ),
    ).toBe(true)
    expect(
      dragHasAcceptedAudioSource(dataTransfer({ items: [textItem()] })),
    ).toBe(false)
    expect(
      dragHasAcceptedAudioSource(dataTransfer({ files: [unsupported, source] })),
    ).toBe(true)
    expect(
      acceptedAudioSourceFromDrop(dataTransfer({ files: [unsupported, source] })),
    ).toBe(source)
    expect(
      acceptedAudioSourceFromDrop(dataTransfer({ files: [unsupported] })),
    ).toBeNull()
  })

  it('keeps drag affordance and drop acceptance aligned for supported MIME types', () => {
    const browserAudio = audioFile('recording', 'audio/x-wav')
    const browserVideo = audioFile('camera', 'video/mp4')

    expect(
      dragHasAcceptedAudioSource(
        dataTransfer({ items: [item(browserAudio, browserAudio.type)] }),
      ),
    ).toBe(true)
    expect(
      acceptedAudioSourceFromDrop(dataTransfer({ files: [browserAudio] })),
    ).toBe(browserAudio)

    expect(
      dragHasAcceptedAudioSource(
        dataTransfer({ items: [item(browserVideo, browserVideo.type)] }),
      ),
    ).toBe(true)
    expect(
      acceptedAudioSourceFromDrop(dataTransfer({ files: [browserVideo] })),
    ).toBe(browserVideo)
  })

  it('rejects arbitrary media MIME types and files above the upload boundary', () => {
    const midi = audioFile('song.mid', 'audio/midi')
    const quickTime = audioFile('camera.mov', 'video/quicktime')
    const oversized = {
      name: 'meeting.webm',
      size: 25_000_001,
      type: 'audio/webm',
    } as File

    expect(audioSourceFileRejection(midi)).toBe('unsupported')
    expect(audioSourceFileRejection(quickTime)).toBe('unsupported')
    expect(audioSourceFileRejection(oversized)).toBe('too-large')
    expect(isAcceptedAudioSourceFile(midi)).toBe(false)
    expect(isAcceptedAudioSourceFile(quickTime)).toBe(false)
    expect(isAcceptedAudioSourceFile(oversized)).toBe(false)
    expect(
      dragHasAcceptedAudioSource(dataTransfer({ items: [item(midi)] })),
    ).toBe(false)
    expect(
      dragHasAcceptedAudioSource(
        dataTransfer({ items: [item(oversized, oversized.type)] }),
      ),
    ).toBe(false)
  })
})
