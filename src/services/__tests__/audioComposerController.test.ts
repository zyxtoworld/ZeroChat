import { describe, expect, it } from 'vitest'

import {
  acceptedAudioSourceFromPicker,
  audioSourceDragStateForGeneration,
  audioSourcePickerSelection,
} from '../audioComposerController'

function fileList(files: File[]): FileList {
  return files as unknown as FileList
}

describe('audio composer controller helpers', () => {
  it('accepts only supported audio files from picker selections', () => {
    const unsupported = new File(['text'], 'note.txt', { type: 'text/plain' })
    const wav = new File(['audio'], 'voice.wav', { type: 'audio/wav' })

    expect(acceptedAudioSourceFromPicker(fileList([unsupported, wav]))).toBe(wav)
    expect(acceptedAudioSourceFromPicker(fileList([unsupported]))).toBeNull()
    expect(acceptedAudioSourceFromPicker(undefined)).toBeNull()
  })

  it('ignores delayed picker selections while generation is active', () => {
    const wav = new File(['audio'], 'voice.wav', { type: 'audio/wav' })

    expect(audioSourcePickerSelection(fileList([wav]), true)).toEqual({
      blocked: true,
      file: null,
      rejection: null,
    })
  })

  it('clears stale drag affordance when generation starts', () => {
    expect(
      audioSourceDragStateForGeneration({ active: true, rejected: false }, true),
    ).toEqual({
      active: false,
      rejected: false,
    })
    expect(
      audioSourceDragStateForGeneration({ active: false, rejected: true }, true),
    ).toEqual({
      active: false,
      rejected: false,
    })
    expect(
      audioSourceDragStateForGeneration({ active: true, rejected: false }, false),
    ).toEqual({
      active: true,
      rejected: false,
    })
  })

  it('reports unsupported picker selections only when generation is idle', () => {
    const unsupported = new File(['text'], 'note.txt', { type: 'text/plain' })
    const wav = new File(['audio'], 'voice.wav', { type: 'audio/wav' })

    expect(audioSourcePickerSelection(fileList([unsupported]), false)).toEqual({
      blocked: false,
      file: null,
      rejection: 'unsupported',
    })
    expect(audioSourcePickerSelection(fileList([unsupported, wav]), false)).toEqual({
      blocked: false,
      file: wav,
      rejection: null,
    })
  })

  it('distinguishes oversized supported audio from unsupported formats', () => {
    const oversized = {
      name: 'meeting.webm',
      size: 25_000_001,
      type: 'audio/webm',
    } as File

    expect(audioSourcePickerSelection(fileList([oversized]), false)).toEqual({
      blocked: false,
      file: null,
      rejection: 'too-large',
    })
  })
})
