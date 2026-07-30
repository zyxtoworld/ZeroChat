import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertLocalByteSize,
  assertLocalFileSize,
  MAX_AUDIO_FILE_BYTES,
  MAX_ENCRYPTED_BACKUP_FILE_BYTES,
  MAX_IMAGE_FILE_BYTES,
  MAX_SKILL_FILE_BYTES,
  readLocalFileAsDataUrl,
  readLocalFileText,
} from '../localFileLimits'

describe('local file limits', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the cross-platform business budgets stable', () => {
    expect(MAX_AUDIO_FILE_BYTES).toBe(25_000_000)
    expect(MAX_ENCRYPTED_BACKUP_FILE_BYTES).toBe(50_000_000)
    expect(MAX_SKILL_FILE_BYTES).toBe(2_000_000)
    expect(MAX_IMAGE_FILE_BYTES).toBe(20_000_000)
  })

  it('accepts the exact byte boundary and rejects overflow', () => {
    expect(() =>
      assertLocalFileSize({ size: 4 }, 4, 'too large'),
    ).not.toThrow()
    expect(() => assertLocalFileSize({ size: 5 }, 4, 'too large')).toThrow(
      'too large',
    )
    expect(() => assertLocalByteSize(4, 4, 'too large')).not.toThrow()
    expect(() => assertLocalByteSize(5, 4, 'too large')).toThrow('too large')
  })

  it('rejects oversized text files before invoking the browser reader', async () => {
    const text = vi.fn(() => Promise.resolve('should not be read'))
    const file = { size: 5, text } as unknown as File

    await expect(readLocalFileText(file, 4, 'too large')).rejects.toThrow(
      'too large',
    )
    expect(text).not.toHaveBeenCalled()
  })

  it('rejects oversized image files before constructing FileReader', async () => {
    const FileReaderConstructor = vi.fn()
    vi.stubGlobal('FileReader', FileReaderConstructor)
    const file = { size: 5 } as File

    await expect(
      readLocalFileAsDataUrl(file, 4, 'too large'),
    ).rejects.toThrow('too large')
    expect(FileReaderConstructor).not.toHaveBeenCalled()
  })

  it('rejects invalid limits instead of silently disabling the boundary', () => {
    expect(() => assertLocalFileSize({ size: 0 }, -1, 'too large')).toThrow(
      RangeError,
    )
    expect(() =>
      assertLocalFileSize({ size: 0 }, Number.MAX_VALUE, 'too large'),
    ).toThrow(RangeError)
    expect(() => assertLocalByteSize(-1, 4, 'too large')).toThrow(RangeError)
  })
})
